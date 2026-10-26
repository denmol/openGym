// ENGINE: the primary LLM. Generation only. It never sees a Jev decision, a confidence or a
// gate verdict; on retry it gets a plain-language reason string and nothing else.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CONFIG, TIER_MODELS } from './config.js';

const SYSTEM = `You are the written voice of a gym coaching desk. Answer the member's message directly and concretely: numbers, sets/reps, grams, or steps where relevant. 120-220 words. Plain text, short lists allowed. Never diagnose an injury or advise training through pain; if the message mentions pain, dizziness or chest symptoms, tell them to stop and see a doctor or physio. No supplements dosing, no extreme diets.`;

// Builds the plain-text prompt for engines that take one string (the CLI).
export function buildPrompt({ input, history = [], feedback }) {
  const turns = history.map((t) => `${t.r === 'a' ? 'Coach' : 'Member'}: ${t.t}`).join('\n');
  return `${SYSTEM}\n\nReply with the answer text only. Do not run commands, read files or use tools.\n\n${turns ? turns + '\n' : ''}Member: ${input}${feedback ? `\n\n[Desk note: a previous draft was rejected because: ${feedback}. Write a better answer.]` : ''}`;
}

// Tier -> reasoning effort. Model names are NOT hard-coded: the account's default model is
// used unless CODEX_MODEL_FAST / _BALANCED / _THOROUGH override it.
const TIER_EFFORT = { fast: 'low', balanced: 'medium', thorough: 'high' };

/**
 * ENGINE via the Codex CLI signed in with a ChatGPT account (`codex login`), i.e. no API key.
 * Runs `codex exec` read-only in an empty temp dir; the prompt goes in on stdin and only the
 * final message is read back. Uses the account's plan limits; one process per generation.
 */
export class CodexEngine {
  mode = 'codex';
  constructor({ bin = 'codex', spawnImpl = spawn, env = process.env } = {}) {
    Object.assign(this, { bin, spawn: spawnImpl, env });
  }
  async generate({ tier, input, history = [], feedback }) {
    const dir = await mkdtemp(path.join(tmpdir(), 'coachdesk-codex-'));
    const outFile = path.join(dir, 'answer.txt');
    const model = this.env[`CODEX_MODEL_${tier.toUpperCase()}`];
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never',
      '-C', dir, '-o', outFile, '-c', `model_reasoning_effort="${TIER_EFFORT[tier]}"`, ...(model ? ['-m', model] : []), '-'];
    try {
      await new Promise((resolve, reject) => {
        const child = this.spawn(this.bin, args, { stdio: ['pipe', 'ignore', 'pipe'], env: this.env });
        let err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('codex timeout')); }, CONFIG.ENGINE_TIMEOUT_MS);
        child.stderr?.on('data', (d) => { err = (err + d).slice(-600); });
        child.on('error', (e) => { clearTimeout(timer); reject(new Error(`codex not runnable: ${e.message}`)); });
        child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`codex exit ${code}: ${err.trim().split('\n').pop()}`)); });
        child.stdin.end(buildPrompt({ input, history, feedback }));
      });
      const text = (await readFile(outFile, 'utf8')).trim();
      if (!text) throw new Error('codex returned no answer');
      return { text, model: `codex:${model ?? 'default'}:${TIER_EFFORT[tier]}` };
    } finally {
      rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function codexLoggedIn({ bin = 'codex', spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    try {
      const c = spawnImpl(bin, ['login', 'status'], { stdio: 'ignore' });
      c.on('error', () => resolve(false));
      c.on('close', (code) => resolve(code === 0));
    } catch { resolve(false); }
  });
}

export class AnthropicEngine {
  mode = 'anthropic';
  constructor({ apiKey, baseUrl = 'https://api.anthropic.com', fetchImpl = fetch } = {}) {
    Object.assign(this, { apiKey, baseUrl, fetch: fetchImpl });
  }
  async generate({ tier, input, history = [], feedback }) {
    const model = TIER_MODELS[tier];
    const messages = [
      ...history.map((t) => ({ role: t.r === 'a' ? 'assistant' : 'user', content: t.t })),
      { role: 'user', content: feedback ? `${input}\n\n[Desk note: a previous draft was rejected because: ${feedback}. Write a better answer.]` : input },
    ];
    const res = await this.fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 600, system: SYSTEM, messages }),
      signal: AbortSignal.timeout(CONFIG.ENGINE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`engine HTTP ${res.status}`);
    const body = await res.json();
    return { text: body.content.map((b) => b.text ?? '').join('').trim(), model };
  }
}

// Offline stub so the app runs with no keys. Template text, flagged as stub in every response.
const STUB = {
  workout_plan: (i) => `Here is a starting structure for "${i}":\n\n- Day 1 upper: bench press 3x6-8, row 3x8-10, overhead press 3x8-10, curls 2x12\n- Day 2 lower: squat 3x5-8, Romanian deadlift 3x8, split squat 2x10, calf raise 3x12\n- Day 3 rest or easy cardio 20 minutes\n- Day 4 upper and Day 5 lower, mirrored with 1-2 reps more per set\n\nAdd 2.5 kg when you hit the top of the rep range on every set. Keep 1-2 reps in reserve and track every session.`,
  nutrition: (i) => `For "${i}": aim for roughly 1.6-2.2 g of protein per kg of body weight per day, spread over 3-4 meals of 25-40 g. For a cut, keep calories about 300-500 kcal under maintenance, which loses around 0.5% of body weight per week. Fill the rest with carbs around training and keep fats near 0.8 g/kg. Weigh yourself daily and judge the weekly average, not single days.`,
  form_check: (i) => `About "${i}": film a set from the side at hip height and compare it with these checks. Keep a neutral spine through the whole rep, brace before you pull, and stop the set when your back position changes. Lower the load by 10-15% and do 3x5 with a 2 second pause just off the floor. If form holds for two sessions, add weight again. A coach can review the video if you send it.`,
  injury_pain: () => `Stop training the painful area and don't test it under load. Pain like this needs a doctor or physio to examine it; a human coach will follow up with you.`,
  account_billing: () => `A human coach on the billing team will review your account and reply with the next steps.`,
  other: () => `Could you tell me a bit more about what you need help with?`,
};

export class StubEngine {
  mode = 'stub';
  async generate({ tier, input, category = 'other', feedback }) {
    await new Promise((r) => setTimeout(r, 20));
    const text = (STUB[category] ?? STUB.other)(input.slice(0, 80)) + (feedback ? '\n\nRevised after review: more specific numbers above.' : '');
    return { text, model: `stub-${tier}` };
  }
}

/**
 * ENGINE=anthropic | codex | stub forces a choice. Unset = first available of:
 * ANTHROPIC_API_KEY -> Codex CLI logged in with a ChatGPT account -> offline stub.
 */
export async function makeEngine(env = process.env, deps = {}) {
  const want = env.ENGINE?.toLowerCase();
  if (want === 'stub') return new StubEngine();
  if (want === 'codex') {
    if (!(await (deps.codexLoggedIn ?? codexLoggedIn)())) throw new Error('ENGINE=codex but `codex login status` failed: run `codex login` and choose "Sign in with ChatGPT"');
    return new CodexEngine({ env });
  }
  if ((want === 'anthropic' || !want) && env.ANTHROPIC_API_KEY) return new AnthropicEngine({ apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL || undefined });
  if (want === 'anthropic') throw new Error('ENGINE=anthropic but ANTHROPIC_API_KEY is not set');
  if (!want && (await (deps.codexLoggedIn ?? codexLoggedIn)())) return new CodexEngine({ env });
  return new StubEngine();
}

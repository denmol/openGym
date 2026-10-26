import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { CodexEngine, buildPrompt, makeEngine, StubEngine } from '../src/engine.js';

// Fake `codex` process: records argv + stdin, writes the -o file, exits with `code`.
function fakeSpawn({ code = 0, answer = 'Eat 160 g protein a day, 4 meals of 40 g.', error } = {}) {
  const calls = [];
  const fn = (bin, args) => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    let stdin = '';
    child.stdin = { end: async (d) => {
      stdin = d; calls.push({ bin, args, stdin });
      if (error) return child.emit('error', error);
      if (code === 0 && answer !== null) await writeFile(args[args.indexOf('-o') + 1], answer);
      if (code) child.stderr.emit('data', 'not logged in');
      child.emit('close', code);
    } };
    child.kill = () => {};
    return child;
  };
  fn.calls = calls;
  return fn;
}
const req = { tier: 'balanced', input: 'How much protein?', history: [{ r: 'u', t: 'hi' }] };

test('codex engine: read-only, ephemeral, prompt on stdin, effort from tier, answer from -o file', async () => {
  const sp = fakeSpawn();
  const out = await new CodexEngine({ spawnImpl: sp, env: {} }).generate(req);
  const { args, stdin } = sp.calls[0];
  assert.equal(out.text, 'Eat 160 g protein a day, 4 meals of 40 g.');
  assert.deepEqual(args.slice(0, 2), ['exec', '--skip-git-repo-check']);
  assert.ok(args.includes('--ephemeral'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(args.includes('model_reasoning_effort="medium"'));
  assert.ok(!args.includes('-m'), 'no hard-coded model');
  assert.equal(args.at(-1), '-');
  assert.match(stdin, /Member: How much protein\?/);
  assert.match(stdin, /Member: hi/);
});

test('codex engine: tier -> effort, model override via env, retry feedback in prompt', async () => {
  const sp = fakeSpawn();
  const e = new CodexEngine({ spawnImpl: sp, env: { CODEX_MODEL_THOROUGH: 'my-model' } });
  await e.generate({ ...req, tier: 'thorough', feedback: 'quality 2 < 3' });
  const { args, stdin } = sp.calls[0];
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.equal(args[args.indexOf('-m') + 1], 'my-model');
  assert.match(stdin, /rejected because: quality 2 < 3/);
});

test('codex engine: non-zero exit, empty answer, missing binary all reject (orchestrator -> human_review)', async () => {
  await assert.rejects(new CodexEngine({ spawnImpl: fakeSpawn({ code: 1 }) }).generate(req), /codex exit 1: not logged in/);
  await assert.rejects(new CodexEngine({ spawnImpl: fakeSpawn({ answer: '  ' }) }).generate(req), /no answer/);
  await assert.rejects(new CodexEngine({ spawnImpl: fakeSpawn({ error: new Error('ENOENT') }) }).generate(req), /not runnable/);
});

test('prompt never carries Jev decisions (only input/history/feedback)', () => {
  assert.doesNotMatch(buildPrompt(req), /confidence|needs_human|safe_to_return/);
});

test('makeEngine selection: explicit, auto order, and loud failure when forced', async () => {
  const yes = { codexLoggedIn: async () => true }, no = { codexLoggedIn: async () => false };
  assert.equal((await makeEngine({ ENGINE: 'stub' }, yes)).mode, 'stub');
  assert.equal((await makeEngine({ ENGINE: 'codex' }, yes)).mode, 'codex');
  assert.equal((await makeEngine({}, yes)).mode, 'codex');
  assert.equal((await makeEngine({ ANTHROPIC_API_KEY: 'k' }, yes)).mode, 'anthropic');
  assert.ok((await makeEngine({}, no)) instanceof StubEngine);
  await assert.rejects(makeEngine({ ENGINE: 'codex' }, no), /codex login/);
  await assert.rejects(makeEngine({ ENGINE: 'anthropic' }, no), /ANTHROPIC_API_KEY/);
});

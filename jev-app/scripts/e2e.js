// End-to-end: five realistic member messages through intake+routing -> engine -> gate.
// Writes logs/e2e-results.jsonl (one line per request: every decision, confidence, latency)
// and logs/e2e-summary.md. Uses JEV_URL / ANTHROPIC_API_KEY if set, else SimJev + StubEngine;
// each log line records which, so results can never be mistaken for real-Jev numbers.

import { writeFile, mkdir } from 'node:fs/promises';
import { Orchestrator } from '../src/orchestrator.js';
import { makeJev } from '../src/jev.js';
import { makeEngine } from '../src/engine.js';

const CASES = [
  { id: 'E1', expect: 'ok', input: 'Build me a 4 day upper/lower split, I only have dumbbells, 45 min sessions, goal hypertrophy' },
  { id: 'E2', expect: 'ok', input: 'How much protein should I eat to cut at 82 kg?' },
  { id: 'E3', expect: 'ok', input: 'My lower back rounds at the bottom of my deadlift, is my form ok?' },
  { id: 'E4', expect: 'human_review', input: "Sharp pain in my shoulder since bench yesterday, I can't lift my arm" },
  { id: 'E5', expect: 'needs_clarification', input: 'hmm idk lol' },
];

const jev = await makeJev();
const engine = makeEngine();
const o = new Orchestrator({ jev, engine });
await mkdir(new URL('../logs/', import.meta.url), { recursive: true });

const lines = [];
const rows = [];
for (const c of CASES) {
  const t0 = performance.now();
  const r = await o.handle({ input: c.input });
  const total = Math.round(performance.now() - t0);
  const d = r.decisions;
  const rec = {
    id: c.id, input: c.input, expected_status: c.expect, status: r.status, reason: r.reason ?? null, total_ms: total,
    jev_source: r.jev_source, engine_mode: r.engine_mode, state_tokens: r.state.tokens,
    intake: d.intake && { answer: d.intake.answer, field_confidence: d.intake.field_confidence, confidence: d.intake.confidence, latency_ms: d.intake.latency_ms },
    routing: d.routing && { answer: d.routing.answer, applied: d.routing.applied, field_confidence: d.routing.field_confidence, confidence: d.routing.confidence, latency_ms: d.routing.latency_ms },
    gate_attempts: r.gate_attempts.map((g) => ({ answer: g.answer, field_confidence: g.field_confidence, confidence: g.confidence, latency_ms: g.latency_ms })),
    review_flags: r.review_flags, trail: r.trail, output_chars: r.output?.length ?? 0, model: r.model ?? null,
  };
  lines.push(JSON.stringify(rec));
  const g = r.gate_attempts.at(-1);
  rows.push(`| ${c.id} | ${r.status}${r.status === c.expect ? '' : ' ⚠ expected ' + c.expect} | ${d.intake.answer.category} ${d.intake.confidence.toFixed(2)} (${d.intake.latency_ms}ms) | ${d.routing.applied.model_tier}/${d.routing.applied.needs_human ? 'human' : 'auto'}/p${d.routing.applied.priority} ${d.routing.confidence.toFixed(2)} (${d.routing.latency_ms}ms) | ${g ? `q${g.answer.quality_score} safe=${g.answer.safe_to_return} ${g.confidence.toFixed(2)} (${g.latency_ms}ms)` : '— (no output generated)'} | ${r.review_flags.map((f) => f.decision).join(',') || '—'} | ${total}ms |`);
  console.log(`${c.id} ${r.status.padEnd(20)} intake=${d.intake.confidence} routing=${d.routing.confidence} gate=${g?.confidence ?? '-'} total=${total}ms`);
  if (r.status !== c.expect) process.exitCode = 1;
}

await writeFile(new URL('../logs/e2e-results.jsonl', import.meta.url), lines.join('\n') + '\n');
await writeFile(new URL('../logs/e2e-summary.md', import.meta.url),
`# E2E run — jev=${jev.source}, engine=${engine.mode}

${jev.source === 'sim' ? '> **Jev here is the local stand-in (SimJev), not Jev.** Confidences and latencies describe the stand-in. Re-run with JEV_URL set for real numbers.\n' : ''}${engine.mode === 'stub' ? '> **Engine here is the offline stub**, not an LLM. Set ANTHROPIC_API_KEY for real generation.\n' : ''}
| # | Final status | Intake (category conf, latency) | Routing (applied tier/handler/priority conf, latency) | Gate (final attempt) | Review flags | Total |
|---|---|---|---|---|---|---|
${rows.join('\n')}
`);

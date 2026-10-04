// Every path through the pipeline, driven by scripted Jev + engine fakes so each fallback is
// triggered on purpose. Names say which fallback the test proves.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Orchestrator } from '../src/orchestrator.js';
import { fakeJev, fakeEngine, GOOD } from './helpers.js';
import { CONFIG } from '../src/config.js';

const REQ = { input: 'Build me a 4 day upper/lower split with dumbbells, 45 minute sessions' };
const mk = (jevScript, engineTexts) => {
  const jev = fakeJev(jevScript), engine = fakeEngine(engineTexts);
  return { jev, engine, o: new Orchestrator({ jev, engine }) };
};
const gate = (answer, conf = 0.9) => ({ answer: { matches_intent: true, safe_to_return: true, quality_score: 4, ...answer }, conf });

test('happy path: ok, all three decisions returned, tier applied, LLM called once', async () => {
  const { o, engine } = mk();
  const r = await o.handle(REQ);
  assert.equal(r.status, 'ok');
  assert.ok(r.output);
  assert.ok(r.decisions.intake && r.decisions.routing && r.decisions.gate);
  assert.equal(r.model_tier, 'balanced');
  assert.equal(r.priority, 2);
  assert.equal(engine.calls.length, 1);
  assert.equal(engine.calls[0].tier, 'balanced');
  assert.deepEqual(r.review_flags, []);
  for (const d of [r.decisions.intake, r.decisions.routing, r.decisions.gate]) {
    assert.equal(typeof d.confidence, 'number');
    assert.equal(typeof d.latency_ms, 'number');
  }
});

test('layering: every Jev call receives the identical state object (===), built once', async () => {
  const { o, jev } = mk();
  await o.handle(REQ);
  assert.equal(jev.calls.length, 3);
  assert.ok(jev.calls.every((c) => c.state === jev.calls[0].state));
});

test('layering: intake/routing never see LLM output; only the gate gets the candidate', async () => {
  const { o, jev } = mk(undefined, ['SECRET-ENGINE-TEXT with 3 sets']);
  const r = await o.handle(REQ);
  for (const c of jev.calls) {
    assert.ok(!JSON.stringify(c.state).includes('SECRET-ENGINE-TEXT'));
    assert.equal(c.candidate !== undefined, c.schema === 'gate');
  }
  assert.ok(!JSON.stringify(r.state.snapshot).includes('SECRET-ENGINE-TEXT'));
});

test('layering: the engine never receives a Jev decision, confidence, or gate result', async () => {
  const { o, engine } = mk({ gate: [gate({ quality_score: 2 }), gate({})] });
  await o.handle(REQ);
  for (const c of engine.calls) assert.deepEqual(Object.keys(c).filter((k) => !['tier', 'input', 'history', 'category', 'feedback', 'at'].includes(k)), []);
});

test('parallel: intake and routing both start before either finishes; LLM waits for both', async () => {
  const { o, jev, engine } = mk({ intake: { ...GOOD.intake, delay: 60 }, routing: { ...GOOD.routing, delay: 60 } });
  const t0 = performance.now();
  await o.handle(REQ);
  const [i, r] = ['intake', 'routing'].map((n) => jev.calls.find((c) => c.schema === n).at);
  assert.ok(Math.abs(i - r) < 20, `started ${Math.abs(i - r)}ms apart`);
  assert.ok(engine.calls[0].at - Math.max(i, r) >= 55, 'LLM must start after both resolve');
  assert.ok(performance.now() - t0 < 200, 'sequential would be >= 120ms+');
});

test('FALLBACK intake<0.65: blocked, needs_clarification, LLM never called, routing still reported', async () => {
  const { o, engine } = mk({ intake: { ...GOOD.intake, conf: 0.64 } });
  const r = await o.handle(REQ);
  assert.equal(r.status, 'needs_clarification');
  assert.equal(r.reason, 'intake_low_confidence');
  assert.equal(engine.calls.length, 0);
  assert.equal(r.output, null);
  assert.ok(r.decisions.routing);
  assert.equal(r.decisions.gate, null);
});

test('boundary: intake exactly 0.65 proceeds', async () => {
  const { o } = mk({ intake: { ...GOOD.intake, conf: 0.65 } });
  assert.equal((await o.handle(REQ)).status, 'ok');
});

test('FALLBACK not actionable: clarification without calling the LLM', async () => {
  const { o, engine } = mk({ intake: { answer: { ...GOOD.intake.answer, is_actionable: false }, conf: 0.9 } });
  const r = await o.handle(REQ);
  assert.equal(r.status, 'needs_clarification');
  assert.equal(r.reason, 'not_actionable');
  assert.equal(engine.calls.length, 0);
});

test('FALLBACK routing.needs_human: human_review, LLM never called, priority preserved', async () => {
  const { o, engine } = mk({ routing: { answer: { model_tier: 'fast', needs_human: true, priority: 1 }, conf: 0.9 } });
  const r = await o.handle({ input: 'Sharp pain in my shoulder since bench yesterday' });
  assert.equal(r.status, 'human_review');
  assert.equal(r.reason, 'routing_needs_human');
  assert.equal(r.priority, 1);
  assert.equal(engine.calls.length, 0);
});

test('FALLBACK routing<0.60: tier forced to thorough and review flag raised', async () => {
  const { o, engine } = mk({ routing: { answer: { model_tier: 'fast', needs_human: false, priority: 3 }, conf: 0.55 } });
  const r = await o.handle(REQ);
  assert.equal(r.model_tier, CONFIG.ROUTING_LOW_CONF_TIER);
  assert.equal(engine.calls[0].tier, 'thorough');
  assert.deepEqual(r.review_flags.map((f) => f.decision), ['routing']);
});

test('priority decision becomes queue order', async () => {
  const started = [];
  const jevFor = (priority) => ({ routing: { answer: { model_tier: 'fast', needs_human: false, priority }, conf: 0.9 } });
  const slow = { mode: 'fake', async generate({ input }) { started.push(input); await new Promise((r) => setTimeout(r, 40)); return { text: 'ok answer 3 sets', model: 'm' }; } };
  const { PriorityQueue } = await import('../src/queue.js');
  const queue = new PriorityQueue(1);
  const run = (input, p) => new Orchestrator({ jev: fakeJev(jevFor(p)), engine: slow, queue }).handle({ input });
  const all = [run('first-blocker', 3), run('low', 3), run('urgent', 1)];
  await Promise.all(all);
  assert.deepEqual(started, ['first-blocker', 'urgent', 'low']);
});

test('FALLBACK gate quality<3: retry once on thorough, then ok', async () => {
  const { o, engine, jev } = mk({ gate: [gate({ quality_score: 2 }), gate({ quality_score: 4 })] }, ['thin', 'much better answer with 3 sets']);
  const r = await o.handle(REQ);
  assert.equal(r.status, 'ok');
  assert.equal(r.attempts, 2);
  assert.equal(engine.calls.length, 2);
  assert.equal(engine.calls[1].tier, 'thorough');
  assert.match(engine.calls[1].feedback, /quality 2/);
  assert.equal(r.output, 'much better answer with 3 sets');
  assert.equal(r.gate_attempts.length, 2);
  assert.equal(jev.calls.filter((c) => c.schema === 'intake').length, 1, 'retry must not redo intake');
});

test('FALLBACK gate unsafe twice: human_review, no output returned', async () => {
  const { o, engine } = mk({ gate: gate({ safe_to_return: false }) });
  const r = await o.handle(REQ);
  assert.equal(r.status, 'human_review');
  assert.equal(r.reason, 'gate_failed');
  assert.equal(r.output, null);
  assert.equal(engine.calls.length, 1 + CONFIG.MAX_RETRIES);
  assert.equal(r.gate_attempts.length, 2);
});

test('FALLBACK gate unsafe first, safe second: retry recovers', async () => {
  const { o } = mk({ gate: [gate({ safe_to_return: false }), gate({})] });
  assert.equal((await o.handle(REQ)).status, 'ok');
});

test('FALLBACK matches_intent=false is a gate failure', async () => {
  const { o } = mk({ gate: gate({ matches_intent: false }) });
  assert.equal((await o.handle(REQ)).status, 'human_review');
});

test('FALLBACK gate confidence<0.60 is not a pass, even if the typed answer says pass', async () => {
  const { o } = mk({ gate: gate({}, 0.5) });
  const r = await o.handle(REQ);
  assert.equal(r.status, 'human_review');
  assert.equal(r.output, null);
  assert.ok(r.review_flags.some((f) => f.decision === 'gate'));
});

test('boundary: gate quality exactly 3 passes', async () => {
  const { o } = mk({ gate: gate({ quality_score: 3 }) });
  assert.equal((await o.handle(REQ)).status, 'ok');
});

test('ALL THREE low confidence at once: blocked at intake, three review flags, nothing returned', async () => {
  const low = { ...GOOD };
  const { o, engine } = mk({
    intake: { ...low.intake, conf: 0.3 }, routing: { ...low.routing, conf: 0.3 }, gate: { ...low.gate, conf: 0.3 },
  });
  const r = await o.handle(REQ);
  assert.equal(r.status, 'needs_clarification');
  assert.equal(engine.calls.length, 0);
  assert.equal(r.output, null);
  assert.deepEqual(r.review_flags.map((f) => f.decision).sort(), ['intake', 'routing']);
});

test('ALL THREE low confidence, intake just passing: routing->thorough, gate fails closed after retry', async () => {
  const { o, engine } = mk({ intake: { ...GOOD.intake, conf: 0.66 }, routing: { ...GOOD.routing, conf: 0.4 }, gate: { ...GOOD.gate, conf: 0.4 } });
  const r = await o.handle(REQ);
  assert.equal(r.status, 'human_review');
  assert.equal(r.output, null);
  assert.equal(engine.calls[0].tier, 'thorough');
  assert.equal(r.decisions.gate.confidence, 0.4);
  assert.deepEqual([...new Set(r.review_flags.map((f) => f.decision))].sort(), ['gate', 'routing']);
});

test('FALLBACK Jev down at intake: fail closed to human, LLM never called', async () => {
  const { o, engine } = mk({ intake: new Error('boom') });
  const r = await o.handle(REQ);
  assert.equal(r.status, 'human_review');
  assert.equal(r.reason, 'intake_unavailable');
  assert.equal(engine.calls.length, 0);
  assert.equal(r.decisions.intake.unavailable, true);
  assert.equal(r.decisions.intake.confidence, 0);
});

test('FALLBACK Jev down at routing: human review with strongest tier recorded', async () => {
  const { o, engine } = mk({ routing: new Error('timeout after 1500ms') });
  const r = await o.handle(REQ);
  assert.equal(r.status, 'human_review');
  assert.equal(r.reason, 'routing_unavailable');
  assert.equal(r.model_tier, 'thorough');
  assert.equal(r.decisions.routing.unavailable, true);
  assert.equal(engine.calls.length, 0);
});

test('FALLBACK Jev down at gate: output withheld, no blind retry', async () => {
  const { o, engine } = mk({ gate: new Error('gate down') });
  const r = await o.handle(REQ);
  assert.equal(r.status, 'human_review');
  assert.equal(r.output, null);
  assert.equal(engine.calls.length, 1, 'cannot verify -> do not regenerate blindly');
  assert.equal(r.decisions.gate.unavailable, true);
});

test('FALLBACK engine error: human_review, no output, no gate call', async () => {
  const { o, jev } = mk(undefined, [new Error('LLM 500')]);
  const r = await o.handle(REQ);
  assert.equal(r.status, 'human_review');
  assert.equal(r.reason, 'engine_error');
  assert.equal(jev.calls.filter((c) => c.schema === 'gate').length, 0);
});

test('events stream in order: state, intake/routing, llm_start, output, gate, final', async () => {
  const { o } = mk();
  const ev = [];
  await o.handle(REQ, (e) => ev.push(e.type));
  assert.equal(ev[0], 'state');
  assert.ok(ev.indexOf('llm_start') > ev.indexOf('intake') && ev.indexOf('llm_start') > ev.indexOf('routing'));
  assert.ok(ev.indexOf('gate') > ev.indexOf('output'));
  assert.equal(ev.at(-1), 'final');
});

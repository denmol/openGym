import test from 'node:test';
import assert from 'node:assert/strict';
import { GuardedJev, canary, startCanary } from '../src/guard.js';
import { SimJev } from '../src/jev-sim.js';
import { Orchestrator } from '../src/orchestrator.js';
import { StubEngine } from '../src/engine.js';
import { decide } from '../src/jev.js';
import { buildState } from '../src/state.js';
import { reply } from './helpers.js';

const REQ = { input: 'How much protein should I eat to cut at 82 kg?' };

// A Jev that is up, fast, schema-valid, and wrong: "proceed" to everything.
const yesMan = {
  source: 'yes-man',
  async raw(schema) {
    const a = { intake: { category: 'workout_plan', is_actionable: true, complexity: 2 }, routing: { model_tier: 'fast', needs_human: false, priority: 3 }, gate: { matches_intent: true, safe_to_return: true, quality_score: 5 } }[schema.name];
    return reply(schema.name, a, 0.99);
  },
};

test('breaker: opens after N consecutive failures, then fails fast (no timeout wait)', async () => {
  let calls = 0;
  const dead = { source: 'dead', async raw() { calls++; throw new Error('down'); } };
  const g = new GuardedJev(dead, { threshold: 3, cooldownMs: 10_000 });
  const s = buildState({ input: 'hello coach' });
  for (let i = 0; i < 3; i++) await assert.rejects(decide(g, 'intake', s));
  assert.equal(g.state, 'open');
  const t0 = performance.now();
  await assert.rejects(decide(g, 'intake', s), /circuit open/);
  assert.ok(performance.now() - t0 < 20);
  assert.equal(calls, 3, 'adapter not called while open');
});

test('breaker: closes again after cooldown when Jev recovers', async () => {
  let t = 0, healthy = false;
  const flaky = { source: 'flaky', async raw(schema, state, c) { if (!healthy) throw new Error('down'); return new SimJev().raw(schema, state, c); } };
  const g = new GuardedJev(flaky, { threshold: 2, cooldownMs: 1000, now: () => t });
  const s = buildState({ input: 'How much protein should I eat to cut?' });
  for (let i = 0; i < 2; i++) await assert.rejects(decide(g, 'intake', s));
  assert.equal(g.state, 'open');
  t = 1500; healthy = true;
  assert.equal(g.state, 'closed');
  await decide(g, 'intake', s);
  assert.equal(g.consecutiveFailures, 0);
});

test('orchestrator + open breaker: every request goes straight to human review, no LLM, fast', async () => {
  const g = new GuardedJev(new SimJev(), {});
  g.trip('test');
  const engine = new StubEngine(); let gen = 0; const orig = engine.generate.bind(engine); engine.generate = (a) => (gen++, orig(a));
  const t0 = performance.now();
  const r = await new Orchestrator({ jev: g, engine }).handle(REQ);
  assert.equal(r.status, 'human_review');
  assert.equal(r.reason, 'intake_unavailable');
  assert.equal(gen, 0);
  assert.ok(performance.now() - t0 < 50);
});

test('canary: passes on a sane Jev', async () => {
  assert.deepEqual((await canary(new SimJev())).failures, []);
});

test('canary: catches a Jev that is up but wrong, and trips the breaker (fail closed)', async () => {
  const res = await canary(yesMan);
  assert.equal(res.ok, false);
  assert.equal(res.failures.length, 3);
  const g = new GuardedJev(yesMan);
  const { first, stop } = startCanary(g, { everyMs: 60_000 });
  await first; stop();
  assert.equal(g.state, 'open');
  const r = await new Orchestrator({ jev: g, engine: new StubEngine() }).handle({ input: 'Sharp pain in my shoulder since bench yesterday' });
  assert.equal(r.status, 'human_review', 'wrong-but-up Jev must not be able to wave unsafe traffic through');
});

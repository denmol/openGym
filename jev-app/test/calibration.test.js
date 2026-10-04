// Decision-path tests per schema (proceed / review / uncertain) against SimJev, plus the
// Brier score on the uncertain sets. Against real Jev, run with JEV_URL set: same suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState } from '../src/state.js';
import { decide } from '../src/jev.js';
import { makeJev } from '../src/jev.js';
import { CONFIG } from '../src/config.js';
import { SCHEMAS, fieldCorrect } from '../src/schemas.js';
import { INTAKE_HELDOUT, ROUTING_HELDOUT, GATE_HELDOUT } from './heldout.js';
import { CANON, INTAKE_UNCERTAIN, ROUTING_UNCERTAIN, GATE_UNCERTAIN } from './fixtures.js';

const jev = await makeJev();
const run = (schema, input, candidate) => decide(jev, schema, buildState({ input }), { candidate });

export function brier(rows) {
  const per = rows.map(({ pred, gold }) =>
    Object.keys(gold).map((k) => (pred.field_confidence[k] - (fieldCorrect(SCHEMAS[pred.decision].fields[k], pred.answer[k], gold[k]) ? 1 : 0)) ** 2));
  const flat = per.flat();
  return flat.reduce((a, b) => a + b, 0) / flat.length;
}

test('intake: proceed — clear request is classified, actionable, above the block line', async () => {
  const d = await run('intake', CANON.intake.proceed.input);
  assert.equal(d.answer.category, 'workout_plan');
  assert.equal(d.answer.is_actionable, true);
  assert.ok(d.confidence >= CONFIG.INTAKE_BLOCK_BELOW, `conf ${d.confidence}`);
});

test('intake: review — noise falls below the block line (or is non-actionable)', async () => {
  const d = await run('intake', CANON.intake.review.input);
  assert.ok(d.confidence < CONFIG.INTAKE_BLOCK_BELOW || !d.answer.is_actionable, JSON.stringify(d));
});

test('intake: uncertain — real mixed message never reaches high confidence on every field', async () => {
  const d = await run('intake', CANON.intake.uncertain.input);
  console.log('  intake uncertain ->', JSON.stringify(d.answer), d.field_confidence);
  assert.ok(Object.values(d.field_confidence).some((c) => c < 0.97));
});

test('routing: proceed — simple nutrition question goes to a model, no human', async () => {
  const d = await run('routing', CANON.routing.proceed.input);
  assert.equal(d.answer.needs_human, false);
  assert.ok(d.confidence >= CONFIG.REVIEW_FLAG_BELOW, `conf ${d.confidence}`);
});

test('routing: review — acute pain routes to a human at priority 1', async () => {
  const d = await run('routing', CANON.routing.review.input);
  assert.equal(d.answer.needs_human, true);
  assert.equal(d.answer.priority, 1);
});

test('routing: uncertain — underspecified request does not claim near-certainty', async () => {
  const d = await run('routing', CANON.routing.uncertain.input);
  console.log('  routing uncertain ->', JSON.stringify(d.answer), d.field_confidence);
  assert.ok(Object.values(d.field_confidence).some((c) => c < 0.97));
});

test('gate: proceed — a specific, on-topic, safe answer passes', async () => {
  const c = CANON.gate.proceed;
  const d = await run('gate', c.input, c.candidate);
  assert.equal(d.answer.safe_to_return, true);
  assert.equal(d.answer.matches_intent, true);
  assert.ok(d.answer.quality_score >= CONFIG.GATE_MIN_QUALITY);
});

test('gate: review — "push through the pain" is unsafe', async () => {
  const c = CANON.gate.review;
  const d = await run('gate', c.input, c.candidate);
  assert.equal(d.answer.safe_to_return, false);
});

test('gate: uncertain — thin generic answer lands mid-scale', async () => {
  const c = CANON.gate.uncertain;
  const d = await run('gate', c.input, c.candidate);
  console.log('  gate uncertain ->', JSON.stringify(d.answer), d.field_confidence);
  assert.ok(d.answer.quality_score <= 4);
});

for (const [label, name, set, mk] of [
  ['tuned', 'intake', INTAKE_UNCERTAIN, ([input, gold]) => ({ args: [input], gold })],
  ['tuned', 'routing', ROUTING_UNCERTAIN, ([input, gold]) => ({ args: [input], gold })],
  ['tuned', 'gate', GATE_UNCERTAIN, ([input, cand, gold]) => ({ args: [input, cand], gold })],
  ['held-out', 'intake', INTAKE_HELDOUT, ([input, gold]) => ({ args: [input], gold })],
  ['held-out', 'routing', ROUTING_HELDOUT, ([input, gold]) => ({ args: [input], gold })],
  ['held-out', 'gate', GATE_HELDOUT, ([input, cand, gold]) => ({ args: [input, cand], gold })],
]) {
  test(`brier[${label}]: ${name} uncertain set (n=${set.length}) <= ${CONFIG.BRIER_MAX}`, async () => {
    const rows = [];
    for (const item of set) {
      const { args, gold } = mk(item);
      rows.push({ pred: await run(name, ...args), gold });
    }
    const score = brier(rows);
    const misses = rows.flatMap(({ pred, gold }, i) =>
      Object.keys(gold).filter((k) => !fieldCorrect(SCHEMAS[name].fields[k], pred.answer[k], gold[k]))
        .map((k) => `#${i} ${k}: said ${pred.answer[k]} (${pred.field_confidence[k]}), gold ${gold[k]}`));
    console.log(`  brier[${label}][${name}] = ${score.toFixed(3)}  misses: ${misses.length ? '\n    ' + misses.join('\n    ') : 'none'}`);
    assert.ok(score <= CONFIG.BRIER_MAX, `Brier ${score.toFixed(3)} > ${CONFIG.BRIER_MAX}`);
  });
}

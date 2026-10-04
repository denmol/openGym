import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, HttpJev, JevUnavailable } from '../src/jev.js';
import { validateReply, SCHEMAS, SchemaError } from '../src/schemas.js';
import { buildState } from '../src/state.js';
import { fakeJev, GOOD, reply } from './helpers.js';

const state = buildState({ input: 'hello there coach' });

test('schema: confidence is the min over fields', () => {
  const v = validateReply(SCHEMAS.intake, { answer: GOOD.intake.answer, field_confidence: { category: 0.9, is_actionable: 0.7, complexity: 0.95 } });
  assert.equal(v.confidence, 0.7);
});

test('schema: rejects out-of-enum, out-of-range, wrong type, bad confidence', () => {
  const bad = [
    [{ ...GOOD.intake.answer, category: 'cardio' }], [{ ...GOOD.intake.answer, complexity: 6 }], [{ ...GOOD.intake.answer, complexity: 2.5 }],
    [{ ...GOOD.intake.answer, is_actionable: 'yes' }],
  ];
  for (const [a] of bad) assert.throws(() => validateReply(SCHEMAS.intake, reply('intake', a, 0.9)), SchemaError);
  assert.throws(() => validateReply(SCHEMAS.intake, reply('intake', GOOD.intake.answer, 1.2)), SchemaError);
  assert.throws(() => validateReply(SCHEMAS.intake, null), SchemaError);
});

test('decide: invalid reply -> JevUnavailable (never a malformed decision)', async () => {
  const jev = fakeJev({ intake: { answer: { category: 'nope', is_actionable: true, complexity: 3 }, conf: 0.9 } });
  await assert.rejects(decide(jev, 'intake', state), JevUnavailable);
});

test('decide: timeout -> JevUnavailable', async () => {
  await assert.rejects(decide(fakeJev({ intake: 'hang' }), 'intake', state, { timeoutMs: 40 }), /timeout/);
});

test('decide: reports latency_ms and source', async () => {
  const d = await decide(fakeJev({ intake: { ...GOOD.intake, delay: 30 } }), 'intake', state);
  assert.ok(d.latency_ms >= 25 && d.latency_ms < 500, String(d.latency_ms));
  assert.equal(d.source, 'fake');
});

test('HttpJev: wire format, auth header, HTTP error -> JevUnavailable', async () => {
  let seen;
  const ok = new HttpJev({ url: 'http://jev.test/', apiKey: 'k', fetchImpl: async (u, init) => { seen = { u, init }; return { ok: true, json: async () => reply('intake', GOOD.intake.answer, 0.9) }; } });
  const d = await decide(ok, 'intake', state);
  assert.equal(seen.u, 'http://jev.test/decide');
  assert.equal(seen.init.headers.authorization, 'Bearer k');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(Object.keys(body).sort(), ['fields', 'schema', 'state']);
  assert.equal(d.source, 'jev');
  const down = new HttpJev({ url: 'http://jev.test', fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(decide(down, 'intake', state), /503/);
  const gateBody = [];
  const g = new HttpJev({ url: 'http://jev.test', fetchImpl: async (u, i) => { gateBody.push(JSON.parse(i.body)); return { ok: true, json: async () => reply('gate', GOOD.gate.answer, 0.9) }; } });
  await decide(g, 'gate', state, { candidate: 'answer text' });
  assert.equal(gateBody[0].candidate, 'answer text');
});

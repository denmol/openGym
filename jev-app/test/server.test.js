import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { Orchestrator } from '../src/orchestrator.js';
import { SimJev } from '../src/jev-sim.js';
import { StubEngine } from '../src/engine.js';

async function withServer(fn) {
  const server = createApp({ orchestrator: new Orchestrator({ jev: new SimJev(), engine: new StubEngine() }) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}
const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('API: every response carries all three Jev decision slots + output + gate', async () => {
  await withServer(async (base) => {
    const r = await (await post(base, '/api/ask', { input: 'How much protein should I eat to cut at 82 kg?' })).json();
    assert.equal(r.status, 'ok');
    assert.ok(r.output);
    for (const k of ['intake', 'routing', 'gate']) assert.ok(r.decisions[k].answer && typeof r.decisions[k].confidence === 'number');
    assert.ok(r.state.tokens < 400);
  });
});

test('API: human-review response still carries intake + routing, gate null, output null', async () => {
  await withServer(async (base) => {
    const r = await (await post(base, '/api/ask', { input: 'Sharp pain in my shoulder since bench yesterday, I cannot lift my arm' })).json();
    assert.equal(r.status, 'human_review');
    assert.equal(r.output, null);
    assert.ok(r.decisions.intake && r.decisions.routing);
    assert.equal(r.decisions.gate, null);
  });
});

test('API: NDJSON stream emits decisions as they resolve and ends with final', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/api/ask/stream', { input: 'How much protein should I eat to cut at 82 kg?' });
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    const types = events.map((e) => e.type);
    assert.ok(types.includes('intake') && types.includes('routing') && types.includes('gate'));
    assert.equal(types.at(-1), 'final');
  });
});

test('API: validation — empty input 400, bad JSON 400, oversize 413, unknown route 404', async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, '/api/ask', { input: '   ' })).status, 400);
    assert.equal((await fetch(base + '/api/ask', { method: 'POST', body: '{nope' })).status, 400);
    assert.equal((await post(base, '/api/ask', { input: 'x'.repeat(20000) })).status, 413);
    assert.equal((await fetch(base + '/nope')).status, 404);
  });
});

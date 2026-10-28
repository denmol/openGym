import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileStore, createBlobStore, ConflictError } from './store.js';
import { createDailyCounter } from './counters.js';
import { createQuality, problemKind, OUTCOMES } from './quality.js';

/* the same fake of @vercel/blob that store.test.js uses: create-only and ifMatch really conflict */
function fakeBlob() {
  class BlobNotFoundError extends Error {}
  class BlobPreconditionFailedError extends Error {}
  const files = new Map(); let n = 0;
  return {
    BlobNotFoundError, BlobPreconditionFailedError, files,
    async get(k) { const f = files.get(k); return f ? { statusCode: 200, stream: new Response(f.text).body, blob: { etag: f.etag } } : null; },
    async put(k, text, o) {
      const f = files.get(k);
      if (o.ifMatch !== undefined) { if (!f || f.etag !== o.ifMatch) throw new BlobPreconditionFailedError('etag'); }
      else if (f && !o.allowOverwrite) throw new Error('This blob already exists');
      const etag = '"e' + (++n) + '"'; files.set(k, { text, etag }); return { etag };
    },
    async del(k) { files.delete(k); }
  };
}
const stores = [
  ['file', () => createFileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'og-cnt-')))],
  ['blob', () => createBlobStore(fakeBlob())]
];

for (const [label, make] of stores) {
  test(label + ': a counter counts per user and refuses at the limit', async () => {
    const c = createDailyCounter(make(), 'ai', 3);
    assert.deepEqual(await c.status('u1'), { used: 0, left: 3 });
    assert.equal(await c.reserve('u1'), true);
    assert.equal(await c.reserve('u1'), true);
    assert.deepEqual(await c.status('u1'), { used: 2, left: 1 });
    assert.equal(await c.reserve('u1'), true);
    assert.equal(await c.reserve('u1'), false);
    assert.deepEqual(await c.status('u1'), { used: 3, left: 0 });
    assert.equal(await c.reserve('u2'), true, 'another user is unaffected');
  });

  test(label + ': two instances sharing a store share the count', async () => {
    const store = make();
    const a = createDailyCounter(store, 'ai', 4), b = createDailyCounter(store, 'ai', 4);
    await a.reserve('u'); await b.reserve('u'); await a.reserve('u');
    assert.equal((await b.status('u')).used, 3);
    assert.equal(await b.reserve('u'), true);
    assert.equal(await a.reserve('u'), false);
  });

  test(label + ': a call can cost more than one unit and is refused if it would pass the limit', async () => {
    const c = createDailyCounter(make(), 'photo', 5);
    assert.equal(await c.reserve('u', 2), true);
    assert.equal(await c.reserve('u', 2), true);
    assert.equal(await c.reserve('u', 2), false, '4 + 2 passes 5');
    assert.equal(await c.reserve('u'), true, 'one still fits');
    assert.deepEqual(await c.status('u'), { used: 5, left: 0 });
  });

  test(label + ': concurrent reservations never exceed the limit', async () => {
    const store = make();
    const counters = [0, 1, 2, 3].map(() => createDailyCounter(store, 'ai', 5, { retries: 20 }));
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => counters[i % 4].reserve('u').catch(e => e)));
    const granted = results.filter(r => r === true).length;
    assert.ok(granted <= 5, 'granted ' + granted);
    assert.equal((await counters[0].status('u')).used, granted);
  });

  test(label + ': a new day starts from zero', async () => {
    const store = make();
    let when = new Date('2026-10-27T10:00:00Z');
    const c = createDailyCounter(store, 'ai', 1, { now: () => when });
    assert.equal(await c.reserve('u'), true);
    assert.equal(await c.reserve('u'), false);
    when = new Date('2026-10-28T00:00:01Z');
    assert.deepEqual(await c.status('u'), { used: 0, left: 1 });
    assert.equal(await c.reserve('u'), true);
  });

  test(label + ': an unreadable document starts the day over instead of locking people out', async () => {
    const store = make();
    await store.put('ai-' + new Date().toISOString().slice(0, 10) + '.json', 'not json');
    assert.equal(await createDailyCounter(store, 'ai', 2).reserve('u'), true);
  });
}

test('the counter gives up with a ConflictError, not a free pass, when the store will not settle', async () => {
  const always = { async get() { return { text: '{"counts":{}}', etag: 'x' }; }, async put() { throw new ConflictError('x'); }, async del() {} };
  await assert.rejects(createDailyCounter(always, 'ai', 5, { retries: 3 }).reserve('u'), ConflictError);
});

test('an old day document is cleaned up when a new day begins', async () => {
  const store = createBlobStore(fakeBlob());
  let when = new Date('2026-10-25T10:00:00Z');
  const c = createDailyCounter(store, 'ai', 5, { now: () => when });
  await c.reserve('u');
  when = new Date('2026-10-26T10:00:00Z'); await c.reserve('u');
  when = new Date('2026-10-27T10:00:00Z'); await c.reserve('u');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(await store.get('ai-2026-10-25.json'), null);
  assert.ok(await store.get('ai-2026-10-26.json'));
});

/* ---------------------------------- quality ---------------------------------- */

for (const [label, make] of stores) {
  test(label + ': quality counts outcomes and the kind of rule that failed, nothing else', async () => {
    const q = createQuality(make());
    await q.record('trainer', 'ok1');
    await q.record('trainer', 'ok2', ['number not in the findings: 99']);
    await q.record('trainer', 'ok2', ['number not in the findings: 12', 'citation not backed by the findings in this paragraph']);
    await q.record('trainer', 'rejected', ['percentage not in the findings: 7']);
    await q.record('trainer', 'local');
    const s = (await q.summary()).features.trainer;
    assert.deepEqual({ ok1: s.ok1, ok2: s.ok2, rejected: s.rejected, local: s.local }, { ok1: 1, ok2: 2, rejected: 1, local: 1 });
    assert.equal(s.calls, 4);                       // local is not a call to the model
    assert.deepEqual(s.rates, { ok1: 0.25, ok2: 0.5, rejected: 0.25 });
    assert.equal(s.problems['number not in the findings'], 2);
    assert.equal(s.problems['percentage not in the findings'], 1);
  });
}

test('quality keeps features apart, ignores bad input and never throws', async () => {
  const q = createQuality(createBlobStore(fakeBlob()));
  assert.equal(await q.record('nutrition', 'ok1'), true);
  assert.equal(await q.record('Trainer!', 'ok1'), false);
  assert.equal(await q.record('trainer', 'bogus'), false);
  const broken = createQuality({ async get() { throw new Error('store down'); }, async put() {} });
  assert.equal(await broken.record('trainer', 'ok1'), false);
  const s = await q.summary();
  assert.deepEqual(Object.keys(s.features), ['nutrition']);
});

test('quality summarises only the requested days', async () => {
  const store = createBlobStore(fakeBlob());
  let when = new Date('2026-08-01T10:00:00Z');
  const q = createQuality(store, { now: () => when });
  await q.record('trainer', 'rejected');
  when = new Date('2026-10-27T10:00:00Z');
  await q.record('trainer', 'ok1');
  const s = (await q.summary(30)).features.trainer;
  assert.equal(s.ok1, 1);
  assert.equal(s.rejected, 0, 'the August call is outside 30 days');
  const doc = JSON.parse((await store.get('quality.json')).text);
  assert.equal(Object.keys(doc.days).length, 2, 'pruning keeps the last 45 days that have data, however far apart');
});

test('problemKind strips the instance and keeps the rule', () => {
  assert.equal(problemKind('number not in the findings: 99'), 'number not in the findings');
  assert.equal(problemKind('bad paragraph text'), 'bad paragraph text');
  assert.equal(problemKind(''), 'unknown');
  assert.ok(OUTCOMES.includes('ok1'));
});

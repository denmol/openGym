import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileStore, createBlobStore, storeFromEnv, blobConfigured, ConflictError } from './store.js';

/* A fake of the parts of @vercel/blob the store uses, with the real error classes' behaviour:
   create-only writes fail when the name is taken, ifMatch fails when the etag has moved. */
function fakeBlob() {
  class BlobNotFoundError extends Error {}
  class BlobPreconditionFailedError extends Error {}
  const files = new Map(); let n = 0;
  return {
    BlobNotFoundError, BlobPreconditionFailedError, files,
    async get(k, o) {
      assert.equal(o.access, 'private'); assert.equal(o.useCache, false);
      const f = files.get(k); if (!f) return null;
      return { statusCode: 200, stream: new Response(f.text).body, blob: { etag: f.etag } };
    },
    async put(k, text, o) {
      assert.equal(o.access, 'private'); assert.equal(o.addRandomSuffix, false);
      const f = files.get(k);
      if (o.ifMatch !== undefined) { if (!f || f.etag !== o.ifMatch) throw new BlobPreconditionFailedError('etag'); }
      else if (f && !o.allowOverwrite) throw new Error('This blob already exists');
      const etag = '"e' + (++n) + '"'; files.set(k, { text, etag }); return { etag };
    },
    async del(k) { files.delete(k); }
  };
}

for (const [label, make] of [
  ['file', () => createFileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'og-store-')))],
  ['blob', () => createBlobStore(fakeBlob())]
]) {
  test(label + ': get of a missing name is null', async () => {
    assert.equal(await make().get('nope.json'), null);
  });
  test(label + ': put then get round-trips text, nested names included', async () => {
    const s = make();
    await s.put('off/123.json', '{"a":1}');
    assert.equal((await s.get('off/123.json')).text, '{"a":1}');
  });
  test(label + ': create refuses to overwrite, plain put does', async () => {
    const s = make();
    await s.put('secret', 'one', { create: true });
    await assert.rejects(s.put('secret', 'two', { create: true }), ConflictError);
    assert.equal((await s.get('secret')).text, 'one');
    await s.put('secret', 'three');
    assert.equal((await s.get('secret')).text, 'three');
  });
  test(label + ': ifMatch only succeeds against the etag that was read', async () => {
    const s = make();
    await s.put('db.json', 'v1');
    const { etag } = await s.get('db.json');
    await s.put('db.json', 'v2', { ifMatch: etag });
    await assert.rejects(s.put('db.json', 'v3', { ifMatch: etag }), ConflictError);   // stale
    assert.equal((await s.get('db.json')).text, 'v2');
  });
  test(label + ': ifMatch on a missing name conflicts', async () => {
    await assert.rejects(make().put('db.json', 'x', { ifMatch: 'whatever' }), ConflictError);
  });
  test(label + ': del removes, and deleting twice is fine', async () => {
    const s = make();
    await s.put('a', 'x'); await s.del('a'); await s.del('a');
    assert.equal(await s.get('a'), null);
  });
}

test('blob store keeps everything under its prefix', async () => {
  const b = fakeBlob(); await createBlobStore(b, 'x/').put('db.json', '{}');
  assert.deepEqual([...b.files.keys()], ['x/db.json']);
});

test('storeFromEnv: blob only on Vercel with a store configured', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-env-'));
  const fake = async () => fakeBlob();
  assert.equal((await storeFromEnv({ DATA_DIR: dir }, fake)).kind, 'file');
  assert.equal((await storeFromEnv({ VERCEL: '1', DATA_DIR: dir }, fake)).kind, 'file');
  assert.equal((await storeFromEnv({ VERCEL: '1', BLOB_STORE_ID: 'store_x' }, fake)).kind, 'blob');
  assert.equal((await storeFromEnv({ VERCEL: '1', BLOB_READ_WRITE_TOKEN: 't' }, fake)).kind, 'blob');
  assert.equal(blobConfigured({}), false);
});

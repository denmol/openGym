/* Storage behind the API: a directory on disk (self-hosted, the default) or private Vercel Blob
   (Vercel has no persistent disk). Both speak the same small interface so server.js never
   knows which one it has:

     get(name)            -> { text, etag } | null
     put(name, text, o)   -> etag        o.create: fail if it exists · o.ifMatch: fail if etag moved
     del(name)

   A failed precondition throws a ConflictError — the caller decides whether to retry or tell
   the client. `name` is a relative path such as 'db.json' or 'off/123.json'. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class ConflictError extends Error {
  constructor(name) { super('conflict writing ' + name); this.name = 'ConflictError'; this.code = 'CONFLICT'; }
}

const etagOf = text => crypto.createHash('sha1').update(text).digest('hex');

export function createFileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = name => path.join(dir, name);
  const read = name => { try { return fs.readFileSync(file(name), 'utf8'); } catch { return null; } };
  return {
    kind: 'file',
    async get(name) {
      const text = read(name);
      return text === null ? null : { text, etag: etagOf(text) };
    },
    async put(name, text, o = {}) {
      const cur = read(name);
      if (o.create && cur !== null) throw new ConflictError(name);
      if (o.ifMatch !== undefined && (cur === null || etagOf(cur) !== o.ifMatch)) throw new ConflictError(name);
      fs.mkdirSync(path.dirname(file(name)), { recursive: true });
      const tmp = file(name) + '.tmp';
      fs.writeFileSync(tmp, text, { mode: o.private ? 0o600 : 0o644 });
      fs.renameSync(tmp, file(name));
      return etagOf(text);
    },
    async del(name) { try { fs.unlinkSync(file(name)); } catch {} }
  };
}

/* `blob` is the @vercel/blob module (injected so the tests can pass a fake). Objects are stored
   private under `prefix`, one per name, with the content type of JSON/plain text. */
export function createBlobStore(blob, prefix = 'opengym/') {
  const key = name => prefix + name;
  const conflict = e => e && (e instanceof blob.BlobPreconditionFailedError
    || /already exists|precondition/i.test(e.message || ''));
  return {
    kind: 'blob',
    async get(name) {
      let r;
      try { r = await blob.get(key(name), { access: 'private', useCache: false }); }
      catch (e) { if (e instanceof blob.BlobNotFoundError) return null; throw e; }
      if (!r || r.statusCode !== 200) return null;
      return { text: await new Response(r.stream).text(), etag: r.blob.etag };
    },
    async put(name, text, o = {}) {
      const opts = { access: 'private', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 };
      if (o.ifMatch !== undefined) opts.ifMatch = o.ifMatch;     // implies allowOverwrite
      else if (!o.create) opts.allowOverwrite = true;
      try { return (await blob.put(key(name), text, opts)).etag; }
      catch (e) { if (conflict(e)) throw new ConflictError(name); throw e; }
    },
    async del(name) {
      try { await blob.del(key(name)); } catch (e) { if (!(e instanceof blob.BlobNotFoundError)) throw e; }
    }
  };
}

/* Blob mode needs a store the SDK can reach: a read-write token, or a store id (OIDC on Vercel). */
export const blobConfigured = env => !!(env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID);

export async function storeFromEnv(env, loadBlob = () => import('@vercel/blob')) {
  if (env.VERCEL && blobConfigured(env)) return createBlobStore(await loadBlob());
  return createFileStore(env.DATA_DIR || '/data');
}

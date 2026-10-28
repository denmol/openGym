/* Per-user, per-day counters that every server instance agrees on.

   The AI cap and the barcode cap used to live in a Map in the process. That is exact on a
   machine of one, and wrong on serverless hosting, where each request may land on a different
   instance with its own empty Map: a cap of 20 became 20 per instance. The count now lives in
   the store, one small document per counter per UTC day, written with a precondition so two
   instances reserving at the same moment cannot both take the last call.

   A reservation costs one read and one write. If the store is too contended to settle after a
   few tries, the call is refused (ConflictError) rather than allowed: a cap that lets calls
   through when it cannot count them is not a cap. */
import { ConflictError } from './store.js';

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const daysAgo = (n, now = new Date()) => utcDay(new Date(now.getTime() - n * 86400000));

export function createDailyCounter(store, name, limit, { now = () => new Date(), retries = 6 } = {}) {
  const file = day => `${name}-${day}.json`;
  async function read(day) {
    const r = await store.get(file(day));
    if (!r) return { counts: {}, etag: null };
    try { return { counts: JSON.parse(r.text).counts || {}, etag: r.etag }; }
    catch { return { counts: {}, etag: r.etag }; }       // unreadable: start the day over rather than lock everyone out
  }
  return {
    limit,
    /** { used, left } for this user today. */
    async status(uid) {
      const { counts } = await read(utcDay(now()));
      const used = counts[uid] || 0;
      return { used, left: Math.max(0, limit - used) };
    },
    /** Take `n` calls (a photo costs more than a text question). false when that would pass the limit. */
    async reserve(uid, n = 1) {
      for (let i = 0; i < retries; i++) {
        const day = utcDay(now());
        const { counts, etag } = await read(day);
        const used = counts[uid] || 0;
        if (used + n > limit) return false;
        counts[uid] = used + n;
        try {
          await store.put(file(day), JSON.stringify({ counts }), etag === null ? { create: true } : { ifMatch: etag });
        } catch (e) {
          if (e instanceof ConflictError) continue;       // someone else counted first: read again
          throw e;
        }
        // First call of a new day: drop the document from two days ago. Best effort.
        if (etag === null) store.del(file(daysAgo(2, now()))).catch(() => {});
        return true;
      }
      throw new ConflictError(file(utcDay(now())));
    }
  };
}

/* How well the AI paths are doing, as counts.

   Every answer from a model is checked before anyone sees it (trainer.js, nutrition-context.js),
   and a failed check costs a call and gives the person fixed text instead. Whether that happens
   one time in fifty or one in three is the difference between a prompt that is fine and one
   that needs work, and nothing recorded it. This does, and only as counts: what the outcome
   was, and the kind of rule an answer broke ("number not in the findings"), never the answer,
   the question or who asked.

   Outcomes:  ok1 accepted first try · ok2 accepted after the repair round · rejected failed twice
              scope the model said the log cannot answer · local the model was kept out (health
              flag, age) · error the provider failed (timeout, quota, key, other)

   Recording never throws and never blocks an answer: a counter that breaks a reply is worse
   than a missing count. */
import { ConflictError } from './store.js';

export const OUTCOMES = ['ok1', 'ok2', 'rejected', 'scope', 'local', 'error'];
const KEEP_DAYS = 45;           // days that have data: the document stays small however long the app runs
const FILE = 'quality.json';

/** "number not in the findings: 99" -> "number not in the findings": the kind, not the instance. */
export const problemKind = p => String(p || '').replace(/:.*$/s, '').replace(/\d+/g, 'N').trim().slice(0, 60) || 'unknown';

export function createQuality(store, { now = () => new Date(), retries = 4 } = {}) {
  const day = () => now().toISOString().slice(0, 10);
  async function read() {
    const r = await store.get(FILE);
    if (!r) return { doc: { days: {} }, etag: null };
    try { const d = JSON.parse(r.text); return { doc: { days: d && d.days ? d.days : {} }, etag: r.etag }; }
    catch { return { doc: { days: {} }, etag: r.etag }; }
  }
  return {
    async record(feature, outcome, problems = []) {
      if (!OUTCOMES.includes(outcome) || !/^[a-z]{2,20}$/.test(feature)) return false;
      try {
        for (let i = 0; i < retries; i++) {
          const { doc, etag } = await read();
          const d = (doc.days[day()] ||= {});
          const f = (d[feature] ||= { problems: {} });
          f[outcome] = (f[outcome] || 0) + 1;
          for (const p of problems) { const k = problemKind(p); f.problems[k] = (f.problems[k] || 0) + 1; }
          const keep = Object.keys(doc.days).sort().slice(-KEEP_DAYS);
          for (const k of Object.keys(doc.days)) if (!keep.includes(k)) delete doc.days[k];
          try {
            await store.put(FILE, JSON.stringify(doc), etag === null ? { create: true } : { ifMatch: etag });
            return true;
          } catch (e) { if (!(e instanceof ConflictError)) throw e; }
        }
      } catch (e) { console.error('quality record', e.message); }
      return false;
    },
    /** Totals per feature over the last `days` days, with the share each outcome had. */
    async summary(days = 30) {
      const { doc } = await read();
      const from = new Date(now().getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);
      const out = {};
      for (const [d, feats] of Object.entries(doc.days)) {
        if (d < from) continue;
        for (const [feature, c] of Object.entries(feats)) {
          const t = (out[feature] ||= { calls: 0, problems: {}, ...Object.fromEntries(OUTCOMES.map(o => [o, 0])) });
          for (const o of OUTCOMES) t[o] += c[o] || 0;
          for (const [k, n] of Object.entries(c.problems || {})) t.problems[k] = (t.problems[k] || 0) + n;
        }
      }
      for (const t of Object.values(out)) {
        // "calls" are the times a model was asked and answered or failed; local and scope are not failures.
        t.calls = t.ok1 + t.ok2 + t.rejected + t.error + t.scope;
        const answered = t.ok1 + t.ok2 + t.rejected;
        t.rates = answered ? { ok1: t.ok1 / answered, ok2: t.ok2 / answered, rejected: t.rejected / answered } : null;
        t.problems = Object.fromEntries(Object.entries(t.problems).sort((a, b) => b[1] - a[1]).slice(0, 8));
      }
      return { days, features: out };
    }
  };
}

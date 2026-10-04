import { SCHEMAS } from '../src/schemas.js';

export const GOOD = {
  intake: { answer: { category: 'workout_plan', is_actionable: true, complexity: 3 }, conf: 0.9 },
  routing: { answer: { model_tier: 'balanced', needs_human: false, priority: 2 }, conf: 0.85 },
  gate: { answer: { matches_intent: true, safe_to_return: true, quality_score: 4 }, conf: 0.9 },
};

/** Build a raw Jev reply with every field at confidence `conf`. */
export function reply(schemaName, answer, conf) {
  const keys = Object.keys(SCHEMAS[schemaName].fields);
  return { answer, field_confidence: Object.fromEntries(keys.map((k) => [k, conf])) };
}

/**
 * Scriptable Jev. script[schema] is a spec {answer, conf}, an Error (rejects), 'hang'
 * (never resolves), a function (state, candidate, callIndex) -> spec, or an array of specs
 * consumed per call (last one repeats). Every call is recorded in .calls.
 */
export function fakeJev(script = {}) {
  const jev = {
    source: 'fake',
    calls: [],
    async raw(schema, state, candidate) {
      const n = jev.calls.filter((c) => c.schema === schema.name).length;
      jev.calls.push({ schema: schema.name, state, candidate, at: performance.now() });
      let spec = script[schema.name] ?? GOOD[schema.name];
      if (Array.isArray(spec)) spec = spec[Math.min(n, spec.length - 1)];
      if (typeof spec === 'function') spec = spec(state, candidate, n);
      if (spec === 'hang') return new Promise(() => {});
      if (spec instanceof Error) throw spec;
      if (spec.delay) await new Promise((r) => setTimeout(r, spec.delay));
      return reply(schema.name, spec.answer, spec.conf);
    },
  };
  return jev;
}

export function fakeEngine(texts = ['A good answer with 3 sets of 8 reps.']) {
  const e = {
    mode: 'fake',
    calls: [],
    async generate(args) {
      e.calls.push({ ...args, at: performance.now() });
      const t = texts[Math.min(e.calls.length - 1, texts.length - 1)];
      if (t instanceof Error) throw t;
      return { text: t, model: `fake-${args.tier}` };
    },
  };
  return e;
}

// SimJev: a deterministic, offline stand-in for Jev. It is lexicon evidence -> softmax,
// i.e. a toy. It exists so the whole pipeline (schemas, thresholds, fallbacks, UI, tests)
// can run without a Jev endpoint. Its confidences say nothing about real Jev's calibration;
// swap in HttpJev (JEV_URL) and re-run `npm test && npm run e2e` to get numbers that do.

const LEX = {
  workout_plan: ['plan', 'program', 'routine', 'split', 'schedule', 'week', 'days', 'build me', 'beginner', 'hypertrophy', 'strength', 'stronger', 'dumbbells', 'sessions', 'sets', 'reps', 'compound', 'train', 'goal', 'where do i start', 'stuck', 'plateau', 'full body', 'deload', 'workout'],
  form_check: ['back', 'brace', 'straight', 'spine', 'hips', 'film', 'form', 'technique', 'rounds', 'knees', 'cave', 'depth', 'grip', 'setup', 'cue', 'bar path', 'butt wink', 'check my', 'is my'],
  nutrition: ['protein', 'calories', 'burn', 'kcal', 'carbs', 'macros', 'diet', 'meal', 'eat', 'cutting', 'bulking', 'creatine', 'supplement', 'fat loss', 'maintenance'],
  injury_pain: ['pain', 'hurts', 'hurt', 'injury', 'injured', 'sharp', 'numb', 'tingling', 'swollen', 'dizzy', 'chest', 'torn', 'popped', "can't lift", 'sprain', 'sore', 'weird', 'feels off'],
  account_billing: ['charged', 'billed', 'billing', 'refund', 'invoice', 'subscription', 'cancel', 'payment', 'twice', 'price', 'account', 'login', 'password'],
};
const URGENT = ['pain', 'sharp', 'numb', 'dizzy', 'chest', 'faint', "can't", 'urgent', 'asap', 'today', 'torn', 'popped'];
const HUMAN = ['cancel', 'billed', 'weird', 'feels off', 'pain', 'sharp', 'numb', 'tingling', 'swollen', 'dizzy', 'chest', 'faint', 'torn', 'popped', 'sprain', 'injury', 'injured', 'refund', 'charged twice', 'chargeback', 'lawyer', 'eating disorder', 'pregnan'];
const UNSAFE_OUT = [
  /\b(push|train|work) through (the )?pain\b/i, /\bignore (the )?pain\b/i, /\byou (probably )?(have|tore|sprained|fractured)\b/i,
  /\b(take|use) \d+\s?(mg|iu)\b/i, /\b(steroid|sarm|clenbuterol|anavar)\b/i, /\b(under|below) ?1[0-1]\d\d ?(kcal|calories)\b/i, /\bfast for \d+ days\b/i,
];
const REFERRAL = /\b(doctor|physio|physician|medical|clinician|professional|coach will|human coach|healthcare)\b/i;
const STOP = new Set('the a an and or of to in on for with is are my me i you your it that this be as at by from have has do does can how what'.split(' '));

const lower = (s) => s.toLowerCase();
const hits = (text, words) => words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const tokens = (s) => lower(s).match(/[a-z']{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];

function softmax(scores, temp = 1) {
  const m = Math.max(...Object.values(scores));
  const ex = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.exp((v - m) / temp)]));
  const z = Object.values(ex).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, v / z]));
}
const argmax = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0];

// Discretised belief over an ordinal 1..n around a continuous score; returns [value, P(|err|<=tol)].
function ordinal(score, n, sigma, tol) {
  const p = {};
  for (let k = 1; k <= n; k++) p[k] = Math.exp(-((k - score) ** 2) / (2 * sigma ** 2));
  const z = Object.values(p).reduce((a, b) => a + b, 0);
  const v = Number(argmax(p)[0]);
  const within = Object.entries(p).reduce((s, [k, x]) => s + (Math.abs(k - v) <= tol ? x / z : 0), 0);
  return [v, within];
}

function intake(state) {
  const t = lower(state.input);
  const raw = {};
  for (const [c, words] of Object.entries(LEX)) raw[c] = hits(t, words) * 1.6 + (c === 'injury_pain' && state.signals.pain ? 1.5 : 0);
  raw.other = state.signals.words < 6 ? 1.2 : 0.6;
  // Very short, no domain evidence: "other" must dominate and stay uncertain.
  const total = Object.entries(raw).filter(([c]) => c !== 'other').reduce((s, [, v]) => s + v, 0);
  if (total === 0) raw.other = state.signals.words < 4 ? 1.2 : 2.2; // 1-3 words, no evidence: 'other' is a guess, not a finding
  const probs = softmax(raw, 1);
  const [category, pCat] = argmax(probs);
  const evidence = total;
  const words = state.signals.words;

  const actionable = category !== 'other' && words >= 4 && (evidence > 1.5 || state.signals.q);
  const pAct = clamp(sigmoid((evidence - 1.2) * 1.1 + (words >= 8 ? 0.8 : -0.8)), 0.5, 0.97);
  const act = actionable ? pAct : clamp(1 - pAct * 0.55, 0.5, 0.97);

  const cScore = 1 + (words > 12) + (words > 25) + (state.signals.num ? 0.8 : 0) + (state.signals.food && state.signals.ex ? 0.9 : 0) + (category === 'workout_plan' ? 0.7 : 0) + (category === 'injury_pain' ? 0.6 : 0);
  const [complexity, pCx] = ordinal(clamp(cScore, 1, 5), 5, evidence > 0 ? 0.9 : 1.8, 1);

  return {
    answer: { category, is_actionable: actionable, complexity },
    field_confidence: { category: round(pCat), is_actionable: round(act), complexity: round(pCx) },
  };
}

function routing(state) {
  const t = lower(state.input);
  const humanHits = hits(t, HUMAN) + (state.signals.pain ? 1 : 0);
  const needs = humanHits >= 1;
  const pHuman = needs ? clamp(sigmoid(humanHits * 1.3 - 0.4), 0.55, 0.98) : clamp(1 - 0.3 * Math.exp(-state.signals.words / 12) - (state.signals.words < 5 ? 0.3 : 0), 0.5, 0.95);

  const load = 1 + (state.signals.words > 14) + (state.signals.words > 28) + (state.signals.num ? 0.6 : 0) + (state.signals.food && state.signals.ex ? 0.8 : 0) + (/\b(plan|program|split|routine)\b/.test(t) ? 1 : 0) + (state.history.length ? 0.4 : 0);
  // Tier definition (see schemas.js): fast = one fact; balanced = advice or a short plan;
  // thorough = multi-constraint program. Anything that asks for advice is at least balanced.
  const advice = /\b(should|how do|how can|why|stuck|fix|want to|need|help|stronger|plan|program|routine)\b/.test(t) || state.history.length > 0;
  const tierScore = load >= 3.3 ? 'thorough' : load >= 2 || advice ? 'balanced' : 'fast';
  const edge = tierScore === 'fast' ? Math.max(0, 2 - load) : Math.min(Math.abs(load - 2), Math.abs(load - 3.3));
  const pTier = clamp(0.5 + edge * 0.3, 0.5, 0.9) - (state.signals.words < 4 ? 0.25 : 0) - (state.signals.words < 9 ? 0.1 : 0);

  const urg = hits(t, URGENT);
  // Schema: 1 = safety/time-critical cue, 2 = DEFAULT for an ordinary ask, 3 = casual (no ask).
  const ask = state.signals.q || advice || /\b(build|give|make|write|create|design|suggest) me\b/.test(t);
  const priority = urg >= 1 ? 1 : ask ? 2 : 3;
  const pPri = clamp((urg >= 2 ? 0.88 : urg === 1 ? 0.7 : ask ? 0.72 : 0.62) - (state.signals.words < 4 ? 0.25 : 0), 0.4, 0.9);

  return {
    answer: { model_tier: tierScore, needs_human: needs, priority },
    field_confidence: { model_tier: round(pTier), needs_human: round(pHuman), priority: round(pPri) },
  };
}

function topicOf(text) {
  const t = lower(text);
  const scored = Object.entries(LEX).map(([c, w]) => [c, hits(t, w)]).sort((a, b) => b[1] - a[1]);
  return scored[0][1] > 0 ? scored[0][0] : 'other';
}

function gate(state, candidate = '') {
  const out = String(candidate);
  const inTok = new Set(tokens(state.input));
  const outTok = new Set(tokens(out));
  let overlap = 0;
  inTok.forEach((w) => outTok.has(w) && overlap++);
  const cover = inTok.size ? overlap / inTok.size : 0;
  // Intent match = same topic as the question, or enough shared vocabulary. Word overlap alone
  // misses on-topic answers that rephrase ("form" -> "keep your back straight").
  const sameTopic = topicOf(state.input) !== 'other' && topicOf(state.input) === topicOf(out);
  const matches = out.length > 30 && (sameTopic || cover >= 0.34);
  const pMatch = clamp(0.58 + Math.abs(cover - 0.2) * 0.9 + (sameTopic ? 0.15 : 0), 0.5, 0.92) - (out.length < 60 ? 0.12 : 0);

  const unsafeHit = UNSAFE_OUT.some((r) => r.test(out));
  const missingReferral = state.signals.pain && !REFERRAL.test(out);
  const safe = !(unsafeHit || missingReferral);
  const pSafe = unsafeHit ? 0.93 : missingReferral ? 0.78 : state.signals.pain ? 0.82 : 0.9;

  const words = out.split(/\s+/).filter(Boolean).length;
  const structure = /(\n[-*•\d])|(\n\n)/.test(out) ? 1 : 0;
  const concrete = (out.match(/\d/g)?.length ?? 0) > 2 ? 1 : 0;
  const q = clamp(1 + (words > 8) * 1 + (words > 25) * 1 + (words > 50) * 0.5 + structure + concrete * 0.8 + (matches ? 0.4 : pMatch > 0.8 ? -1 : -0.2) - (unsafeHit ? 2 : 0), 1, 5);
  const [quality, pQ] = ordinal(q, 5, 1.1, 1);

  return {
    answer: { matches_intent: matches, safe_to_return: safe, quality_score: quality },
    field_confidence: { matches_intent: round(pMatch), safe_to_return: round(pSafe), quality_score: round(pQ) },
  };
}

const round = (x) => Math.round(x * 100) / 100;

export class SimJev {
  source = 'sim';
  async raw(schema, state, candidate) {
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 15)); // reflex-sized latency
    if (schema.name === 'intake') return intake(state);
    if (schema.name === 'routing') return routing(state);
    return gate(state, candidate);
  }
}

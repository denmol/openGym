// The level test: a short, safe starting check that tells the trainer where someone is
// before there is a log to read.
//
// Until four workouts are logged the trainer says "not enough data" and nothing else
// (lib/trainer.js). This gives it something true to say from the first day: how long the
// person has trained, what they can do with their own body weight, and — if they want —
// what a comfortable set of eight looks like on three lifts. Nothing here is a maximal
// attempt: the loaded lifts are submaximal sets stopped with reps left in reserve, and the
// bodyweight tests end at form breakdown, with a cap.
//
// Honesty about the numbers. The thresholds below are rules of thumb in the style of the
// bodyweight-ratio tables lifters know, not norms from a study; they are labelled that way
// in every finding. The result is a level (new / some / experienced) with a confidence that
// says how much it rests on, never a grade.

import { estimate1RM } from './onerm.js'

export const CAL_VERSION = 1
export const TEST_REPS = 8          // the set the lifts are reported for
export const TEST_RIR = 2           // reps left in the tank
export const START_FRACTION = 0.9   // first prescription: a little under the tested weight
export const RETEST_WEEKS = 8
export const LB_PER_KG = 2.2046226218

// Each threshold row is [value that scores 1, value that scores 2, value that scores 3];
// below the first the score rises from 0 in proportion, above the last it stays at 3.
export const BODYWEIGHT_TESTS = {
  pushups: { name: 'Push-ups', area: 'push', max: 60, thresholds: { male: [10, 25, 40], female: [5, 15, 25] } },
  squats: { name: 'Bodyweight squats in 60 seconds', area: 'legs', max: 80, thresholds: { male: [20, 40, 60], female: [20, 40, 60] } },
  plank: { name: 'Plank (seconds)', area: 'core', max: 180, thresholds: { male: [30, 60, 120], female: [30, 60, 120] } }
}

// Barbell lifts, rated as estimated one-rep max over body weight. Dumbbell and machine
// versions are tested too (they give starting weights) but not rated: the same ratios
// would be a guess.
export const LIFTS = {
  squat: { name: 'Squat', area: 'legs', ex: { barbell: '0043', dumbbell: '0413', machine: '0739' }, ratio: { male: [1.0, 1.5, 2.0], female: [0.75, 1.1, 1.5] } },
  bench: { name: 'Bench press', area: 'push', ex: { barbell: '0025', dumbbell: '0289', machine: '0577' }, ratio: { male: [0.75, 1.1, 1.5], female: [0.4, 0.7, 1.0] } },
  row: { name: 'Row', area: 'pull', ex: { barbell: '0027', dumbbell: '0293', machine: '1350' }, ratio: { male: [0.6, 0.9, 1.2], female: [0.4, 0.65, 0.9] } }
}
export const AREA_NAME = { push: 'Pushing', pull: 'Pulling', legs: 'Legs', core: 'Core' }
export const MONTHS_CHOICES = [
  { v: 0, label: 'Not yet' }, { v: 1, label: 'Under 6 months' }, { v: 2, label: '6 months to 2 years' }, { v: 3, label: 'More than 2 years' }
]
export const RECENT_CHOICES = [
  { v: 0, label: 'None' }, { v: 1, label: 'About 1 a week' }, { v: 2, label: 'About 2 a week' }, { v: 3, label: '3 or more a week' }
]

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sexOf = s => (s === 'female' ? 'female' : 'male')

/** Piecewise-linear score 0–3 against three thresholds. */
export function scoreAgainst(value, [a, b, c]) {
  const v = num(value)
  if (v == null || v < 0) return null
  if (v <= a) return a > 0 ? v / a : 0
  if (v <= b) return 1 + (v - a) / (b - a)
  if (v <= c) return 2 + (v - b) / (c - b)
  return 3
}

/** A bodyweight test result as a 0–3 score. Knee push-ups count for half. Over 50 the bars are 30% lower. */
export function scoreBodyweightTest(id, value, { sex, age, variant } = {}) {
  const t = BODYWEIGHT_TESTS[id]
  const raw = num(value)
  if (!t || raw == null || raw < 0) return null
  const reps = Math.min(raw, t.max) * (id === 'pushups' && variant === 'knee' ? 0.5 : 1)
  const f = num(age) != null && age >= 50 ? 0.7 : 1
  return scoreAgainst(reps, t.thresholds[sexOf(sex)].map(x => x * f))
}

/** Estimated one-rep max for a set of eight stopped with two in reserve. */
export const e1rmOf = w => estimate1RM(w, TEST_REPS + TEST_RIR)

export const toKg = (w, unit) => (unit === 'lb' ? w / LB_PER_KG : w)

/** Round a starting weight to a step a gym has: 2.5 kg / 5 lb on a barbell, 2 kg / 5 lb otherwise. */
export function startWeight(w, { unit = 'kg', equipment = 'barbell' } = {}) {
  const n = num(w)
  if (n == null || n <= 0) return null
  const step = unit === 'lb' ? 5 : equipment === 'barbell' ? 2.5 : 2
  const out = Math.round(n * START_FRACTION / step) * step
  return Math.max(step, out)
}

function scoreLift(id, w, { sex, bodyweightKg, unit, equipment }) {
  const l = LIFTS[id]
  const e = e1rmOf(toKg(w, unit))
  if (!l || e == null || equipment !== 'barbell' || !(bodyweightKg > 0)) return null
  return scoreAgainst(e / bodyweightKg, l.ratio[sexOf(sex)])
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * answers: { months, recent, pushups: {reps, variant}, squats, plank,
 *            lifts: { squat: { w, equipment }, bench: ..., row: ... } }
 * person:  { sex, age, bodyweightKg, unit }
 */
export function calibrate(answers = {}, person = {}) {
  const unit = person.unit === 'lb' ? 'lb' : 'kg'
  const ctx = { sex: person.sex, age: person.age, bodyweightKg: person.bodyweightKg, unit }
  const months = [0, 1, 2, 3].includes(answers.months) ? answers.months : null
  const recent = [0, 1, 2, 3].includes(answers.recent) ? answers.recent : null
  if (months == null || recent == null) return null

  const bw = {}
  for (const id of Object.keys(BODYWEIGHT_TESTS)) {
    const a = answers[id]
    const value = typeof a === 'object' && a ? a.reps : a
    const s = scoreBodyweightTest(id, value, { ...ctx, variant: a && a.variant })
    if (s != null) bw[id] = { value: num(value), score: s, ...(a && a.variant ? { variant: a.variant } : {}) }
  }
  const lifts = {}
  for (const id of Object.keys(LIFTS)) {
    const a = answers.lifts && answers.lifts[id]
    const w = a && num(a.w)
    if (!(w > 0)) continue
    const equipment = ['barbell', 'dumbbell', 'machine'].includes(a.equipment) ? a.equipment : 'barbell'
    const e = e1rmOf(toKg(w, unit))
    lifts[id] = {
      w, equipment, e1rm: e == null ? null : Math.round(e * 10) / 10,
      score: scoreLift(id, w, { ...ctx, equipment }), start: startWeight(w, { unit, equipment })
    }
  }

  const parts = {
    history: 0.6 * months + 0.4 * recent,
    bodyweight: mean(Object.values(bw).map(x => x.score)),
    lifts: mean(Object.values(lifts).map(x => x.score).filter(s => s != null))
  }
  const weights = { history: parts.bodyweight == null && parts.lifts == null ? 1 : parts.lifts == null ? 0.5 : 0.3, bodyweight: 0.5, lifts: 0.5 }
  if (parts.lifts != null) weights.bodyweight = 0.2
  let sum = 0, used = 0
  for (const k of Object.keys(parts)) if (parts[k] != null) { sum += parts[k] * weights[k]; used += weights[k] }
  const score = Math.round(sum / used * 100) / 100

  let level = score < 1 ? 'new' : score < 2 ? 'some' : 'experienced'
  if (months === 0) level = 'new'
  else if (months === 1 && level === 'experienced') level = 'some'

  const tests = Object.keys(bw).length, rated = Object.values(lifts).filter(x => x.score != null).length
  const confidence = tests >= 2 && rated >= 2 ? 'high' : tests >= 2 || rated >= 1 ? 'medium' : 'low'

  const areas = {}
  const add = (area, s) => { if (s != null) (areas[area] ||= []).push(s) }
  for (const [id, x] of Object.entries(bw)) add(BODYWEIGHT_TESTS[id].area, x.score)
  for (const [id, x] of Object.entries(lifts)) add(LIFTS[id].area, x.score)
  const ranked = Object.entries(areas).map(([area, xs]) => [area, mean(xs)]).sort((a, b) => b[1] - a[1])
  const strong = ranked.length >= 2 && ranked[0][1] - ranked.at(-1)[1] >= 0.7 ? ranked[0][0] : null
  const weak = strong ? ranked.at(-1)[0] : null

  return {
    v: CAL_VERSION, unit, level, score, confidence, strong, weak,
    answers: { months, recent }, bodyweight: bw, lifts,
    parts: { history: Math.round(parts.history * 100) / 100, bodyweight: parts.bodyweight, lifts: parts.lifts }
  }
}

/**
 * What the trainer can say before there is a log. Rule-of-thumb findings (basis 'heuristic'),
 * so the written check-in is held to the same numbers as every other finding.
 */
export function calibrationFindings(cal) {
  if (!cal || cal.v !== CAL_VERSION || !cal.level) return []
  const facts = { level: cal.level, confidence: cal.confidence, tests: Object.keys(cal.bodyweight || {}).length + Object.keys(cal.lifts || {}).length, retest: RETEST_WEEKS, unit: cal.unit || 'kg' }
  for (const [id, x] of Object.entries(cal.lifts || {})) if (x.start != null) facts[id + 'Start'] = x.start
  const out = [{ code: 'calibration_start', kind: 'act', basis: 'heuristic', evidence: [], facts }]
  if (cal.strong) out.push({ code: 'calibration_strong', kind: 'good', basis: 'heuristic', evidence: [], facts: { area: AREA_NAME[cal.strong] } })
  if (cal.weak) out.push({ code: 'calibration_weak', kind: 'watch', basis: 'heuristic', evidence: [], facts: { area: AREA_NAME[cal.weak] } })
  return out
}

/** Exercise ids and starting weights to seed, for lifts that have no working weight yet. */
export function seedWeights(cal, exWeights = {}, date) {
  const out = {}
  for (const [id, x] of Object.entries((cal && cal.lifts) || {})) {
    const ex = LIFTS[id] && LIFTS[id].ex[x.equipment]
    if (ex && x.start != null && !exWeights[ex]) out[ex] = { w: x.start, d: date }
  }
  return out
}

/** One line for the plan prompt: what the person reported, in plain English. */
export function calibrationSummary(cal) {
  if (!cal || cal.v !== CAL_VERSION) return null
  const bits = []
  const bw = cal.bodyweight || {}
  if (bw.pushups) bits.push(`${bw.pushups.value} ${bw.pushups.variant === 'knee' ? 'knee ' : ''}push-ups`)
  if (bw.squats) bits.push(`${bw.squats.value} bodyweight squats in 60 s`)
  if (bw.plank) bits.push(`${bw.plank.value} s plank`)
  for (const [id, x] of Object.entries(cal.lifts || {})) bits.push(`${LIFTS[id].name.toLowerCase()} ${x.w} ${cal.unit || 'kg'} for ${TEST_REPS} reps with ${TEST_RIR} in reserve (${x.equipment})`)
  return `self-tested, ${cal.level}${bits.length ? ': ' + bits.join('; ') : ''}`
}

// Diabetes mode: what was measured, what was taken, and nothing that follows from them.
//
// THE LINE THIS FILE DOES NOT CROSS
//
// There is no bolus calculator here, no insulin-to-carb ratio, no correction factor, no
// insulin-on-board, and no suggestion about what to eat when a reading is low. Those are
// dose decisions. A dose decision made from a wrong number in a hobby app is an injury,
// and the app cannot know about a blocked cannula, an illness, exercise two hours ago, or
// what the care team last said. So this records and it reports, and where a number would
// look like a recommendation it is left out on purpose.
//
// Everything below is logging, arithmetic over what was logged, and export.
//
// STORAGE UNIT
//
// Readings are stored in mmol/L, always, whatever the profile displays. Two units in one
// list is how a 5.5 becomes a 5.5 mg/dL, and the conversion belongs at the two edges
// (typing in, showing back) rather than scattered through every reader.

import { todayISO, uid } from './format.js'

/* ------------------------------------------------------------- profile ---- */

export const DIABETES_TYPES = ['type1', 'type2', 'lada', 'gestational', 'other']

// English source strings, so they double as i18n keys (see lib/i18n.js).
export const TYPE_NAME = {
  type1: 'Type 1', type2: 'Type 2', lada: 'LADA',
  gestational: 'Gestational diabetes', other: 'Other'
}

// How it is treated. Several can be true at once — a pump user still carries a pen, and
// type 2 on tablets may add basal insulin — so this is a set, not a choice.
export const MEDS = ['pump', 'pen', 'tablets', 'diet']
export const MED_NAME = {
  pump: 'Insulin pump', pen: 'Insulin pen', tablets: 'Tablets', diet: 'Diet only'
}

export const GLUCOSE_UNITS = ['mmol', 'mgdl']
export const UNIT_NAME = { mmol: 'mmol/L', mgdl: 'mg/dL' }

// The international consensus reporting range for time in range. It is the default because
// a report has to start somewhere and this is the one care teams read; it is editable
// because the range that applies to a person comes from their care team, not from an app.
export const DEFAULT_TARGET = { lo: 3.9, hi: 10.0 }

export const DEF_HEALTH = {
  on: false,            // diabetes mode off until someone turns it on — this is a family app
  type: null,
  meds: [],
  gUnit: 'mmol',
  target: { ...DEFAULT_TARGET },
  updated: null
}

/** The stored health profile overlaid on the defaults — an older build is missing keys. */
export const healthOf = S => {
  const h = (S && S.health) || {}
  return {
    ...DEF_HEALTH,
    ...h,
    meds: Array.isArray(h.meds) ? h.meds.filter(m => MEDS.includes(m)) : [],
    target: { ...DEFAULT_TARGET, ...(h.target || {}) }
  }
}

/** Is diabetes mode showing? Off is the default and a perfectly ordinary state. */
export const diabetesOn = S => healthOf(S).on === true

/* --------------------------------------------------------------- units ---- */

// 18.0182 is the molar mass conversion for glucose. Rounded constants (18) drift by half a
// mg/dL at the top of the range, which shows up as a reading that will not round-trip.
export const MGDL_PER_MMOL = 18.0182

// Number(null) is 0, and Number('') is 0. A reading that failed to parse would therefore
// arrive as a perfectly finite zero: counted below range, dragging the average down, and
// painted as a hypo. Nothing is a number here unless it looks like one.
const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v))

export const toMmol = v => Math.round((num(v) / MGDL_PER_MMOL) * 10) / 10
export const toMgdl = v => Math.round(num(v) * MGDL_PER_MMOL)

/** A stored (mmol/L) value in the profile's display unit. */
export const showGlucose = (mmol, unit) =>
  unit === 'mgdl' ? toMgdl(mmol) : Math.round(num(mmol) * 10) / 10

/** A value the user typed, in their unit, as the stored mmol/L. */
export const storeGlucose = (v, unit) =>
  unit === 'mgdl' ? toMmol(v) : Math.round(num(v) * 10) / 10

// What a glucose meter can physically report. Outside this the entry is a typo — a
// decimal point in the wrong place, or mg/dL typed into a mmol/L field — and letting it
// through would drag every average and every percentage with it.
export const GLUCOSE_RANGE = { lo: 1.0, hi: 35.0 }

export const plausibleGlucose = mmol => {
  const n = num(mmol)
  return Number.isFinite(n) && n >= GLUCOSE_RANGE.lo && n <= GLUCOSE_RANGE.hi
}

/* -------------------------------------------------------------- entries --- */

// When the reading was taken, which is what makes it readable later. Deliberately not a
// judgement: "low" says a hypo was recorded, not what should be done about it.
export const GLUCOSE_TAGS = ['fasting', 'before', 'after', 'bed', 'night', 'low', 'exercise']
export const TAG_NAME = {
  fasting: 'Fasting', before: 'Before a meal', after: 'After a meal', bed: 'Bedtime',
  night: 'During the night', low: 'Hypo', exercise: 'Around exercise'
}

// What the dose was for. Labels only — the app never works out what any of them should be.
export const DOSE_KINDS = ['meal', 'correction', 'basal']
export const DOSE_NAME = { meal: 'Meal dose', correction: 'Correction', basal: 'Basal' }

const nowHM = (d = new Date()) =>
  String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')

/**
 * A glucose entry, ready to store. `v` arrives in `unit` and is stored as mmol/L.
 * Returns null for a value no meter could have produced, so a caller cannot store a typo
 * by forgetting to check.
 */
export function newGlucose({ v, unit = 'mmol', d, t, tag, note } = {}) {
  const mmol = storeGlucose(v, unit)
  if (!plausibleGlucose(mmol)) return null
  const now = new Date()
  return {
    id: uid(),
    d: d || todayISO(),
    t: t || nowHM(now),
    v: mmol,
    ...(GLUCOSE_TAGS.includes(tag) ? { tag } : {}),
    ...(note ? { note: String(note).slice(0, 200) } : {})
  }
}

// A pump delivers to 0.025 U and a pen to 0.5 U; two decimals covers both and stops
// floating-point noise reaching the stored entry.
const round2 = n => Math.round(n * 100) / 100

/** An insulin dose entry, ready to store. Units as given — insulin has only one unit. */
export function newDose({ u, kind, d, t, note } = {}) {
  const units = round2(num(u))
  if (!Number.isFinite(units) || units <= 0 || units > 250) return null
  const now = new Date()
  return {
    id: uid(),
    d: d || todayISO(),
    t: t || nowHM(now),
    u: units,
    kind: DOSE_KINDS.includes(kind) ? kind : 'meal',
    ...(note ? { note: String(note).slice(0, 200) } : {})
  }
}

const byTime = (a, b) => String(a.t || '').localeCompare(String(b.t || ''))

/** Every glucose reading on a date, in the order they were taken. */
export const glucoseOn = (S, iso) => ((S && S.glucose) || []).filter(g => g.d === iso).slice().sort(byTime)

/** Every dose on a date, in the order they were given. */
export const dosesOn = (S, iso) => ((S && S.doses) || []).filter(x => x.d === iso).slice().sort(byTime)

/** Readings between two dates inclusive, oldest first. */
export function glucoseBetween(S, from, to) {
  return ((S && S.glucose) || [])
    .filter(g => g.d >= from && g.d <= to)
    .slice()
    .sort((a, b) => (a.d === b.d ? byTime(a, b) : a.d < b.d ? -1 : 1))
}

/** Doses between two dates inclusive, oldest first. */
export function dosesBetween(S, from, to) {
  return ((S && S.doses) || [])
    .filter(x => x.d >= from && x.d <= to)
    .slice()
    .sort((a, b) => (a.d === b.d ? byTime(a, b) : a.d < b.d ? -1 : 1))
}

/* ---------------------------------------------------------- the numbers --- */

const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : 0)

/**
 * Time in range, over whatever readings are handed in.
 *
 * Named "share of readings" everywhere it is shown, not "time", because that is what it
 * is: fingersticks are not evenly spaced, and four readings on a good day and twelve on a
 * bad one do not add up to a day. A CGM feed would make this an actual time share, which
 * is a phase 4 problem. Reporting it as time from spot checks would flatter or damn a
 * week for no reason other than how often someone happened to test.
 */
export function timeInRange(readings, target = DEFAULT_TARGET) {
  const rs = (readings || []).filter(r => Number.isFinite(num(r && r.v)))
  const n = rs.length
  let below = 0, within = 0, above = 0
  for (const r of rs) {
    if (r.v < target.lo) below++
    else if (r.v > target.hi) above++
    else within++
  }
  return { n, below, within, above, belowPct: pct(below, n), withinPct: pct(within, n), abovePct: pct(above, n) }
}

/**
 * Summary of a set of readings.
 *
 * There is deliberately no estimated HbA1c or GMI here. Both are defined over a CGM's
 * near-continuous trace; computed from a handful of fingersticks they read like a lab
 * result while carrying none of the reliability of one, and someone would take that number
 * to an appointment.
 */
export function glucoseStats(readings, target = DEFAULT_TARGET) {
  const rs = (readings || []).filter(r => Number.isFinite(num(r && r.v)))
  const n = rs.length
  if (!n) return { n: 0, mean: null, min: null, max: null, sd: null, ...timeInRange([], target) }
  const vals = rs.map(r => num(r.v))
  const mean = vals.reduce((a, b) => a + b, 0) / n
  // Population SD: these are the readings there are, not a sample drawn from more.
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n)
  return {
    n,
    mean: Math.round(mean * 10) / 10,
    min: Math.round(Math.min(...vals) * 10) / 10,
    max: Math.round(Math.max(...vals) * 10) / 10,
    sd: Math.round(sd * 10) / 10,
    ...timeInRange(rs, target)
  }
}

/** Insulin given, split by what it was for. */
export function doseTotals(doses) {
  const out = { meal: 0, correction: 0, basal: 0, total: 0, n: 0 }
  for (const x of doses || []) {
    const u = num(x && x.u)
    if (!Number.isFinite(u) || u <= 0) continue
    const k = DOSE_KINDS.includes(x.kind) ? x.kind : 'meal'
    out[k] = round2(out[k] + u)
    out.total = round2(out.total + u)
    out.n++
  }
  return out
}

/** Where a reading sits against the target — for colour, never for advice. */
export function bandOf(mmol, target = DEFAULT_TARGET) {
  const v = num(mmol)
  if (!Number.isFinite(v)) return 'none'
  if (v < target.lo) return 'below'
  if (v > target.hi) return 'above'
  return 'in'
}

/** The dates a period covers, oldest first. Used by the report and the day strip. */
export function daysBack(n, from = todayISO()) {
  const out = []
  const d = new Date(from + 'T12:00:00')
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d)
    x.setDate(x.getDate() - i)
    out.push(x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'))
  }
  return out
}

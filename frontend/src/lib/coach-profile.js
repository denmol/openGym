// The training profile the AI coach programs from (issue: AI coach v1).
//
// Kept separate from the rest of the settings because it answers a different question:
// the settings say how the app should behave, this says who is training. It is written
// once during onboarding and edited rarely, so every field is optional except the
// equipment — that one decides which exercises the coach may pick from at all, and a
// wrong answer there produces a plan you cannot perform.

export const LEVELS = ['new', 'some', 'experienced']
export const GOALS = ['strength', 'muscle', 'fatloss', 'health']

// English source strings, so they double as the i18n keys (see lib/i18n.js).
export const LEVEL_NAME = {
  new: 'New to training',
  some: 'A year or two in',
  experienced: 'Training for years'
}
export const GOAL_NAME = {
  strength: 'Get stronger',
  muscle: 'Build muscle',
  fatloss: 'Lose fat',
  health: 'General health'
}

export const DEF_COACH = {
  age: null,
  heightCm: null,
  sex: null,            // falls back to S.body, which the body diagram already sets
  level: null,
  days: 3,
  minutes: 60,
  equipment: [],        // eq values from the catalogue; [] means "not answered yet"
  goal: null,
  limits: '',
  dislikes: '',
  updated: null
}

// Sessions and session length the plan is allowed to ask for. The ceilings are not
// opinions about training — they are what the validator can still reason about.
export const DAYS_RANGE = [1, 7]
export const MINUTES_RANGE = [20, 150]

/**
 * The stored profile overlaid on the defaults. A profile saved by an older build (or a
 * half-finished wizard) is missing keys, and every reader wants the whole shape.
 */
export const coachProfileOf = S => ({
  ...DEF_COACH,
  ...(S && S.coachProfile ? S.coachProfile : {}),
  sex: (S && S.coachProfile && S.coachProfile.sex) || (S && S.body) || null
})

/** Enough answered to build a prompt: equipment is the only hard requirement. */
export const isCoachReady = p => !!(p && Array.isArray(p.equipment) && p.equipment.length)

const clampNum = (v, [lo, hi]) => {
  if (v == null || typeof v === 'boolean' || (typeof v === 'string' && !v.trim())) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null
}

/**
 * Normalise what the wizard collected before it is stored: out-of-range numbers become
 * null rather than travelling into the prompt, where "age: 900" would be taken seriously.
 */
export function cleanCoachProfile(p) {
  const out = { ...DEF_COACH, ...(p || {}) }
  out.age = typeof out.age === 'number' && Number.isInteger(out.age) && out.age >= 12 && out.age <= 100 ? out.age : null
  out.heightCm = clampNum(out.heightCm, [120, 230])
  out.days = clampNum(out.days, DAYS_RANGE) ?? DEF_COACH.days
  out.minutes = clampNum(out.minutes, MINUTES_RANGE) ?? DEF_COACH.minutes
  if (!LEVELS.includes(out.level)) out.level = null
  if (!GOALS.includes(out.goal)) out.goal = null
  if (out.sex !== 'male' && out.sex !== 'female') out.sex = null
  out.equipment = Array.isArray(out.equipment) ? [...new Set(out.equipment)] : []
  out.limits = String(out.limits || '').trim().slice(0, 500)
  out.dislikes = String(out.dislikes || '').trim().slice(0, 500)
  return out
}

/* ------------------------------- medical scope ------------------------------- */

// The coach programs around ordinary limitations ("sore shoulder", "bad knee") and stops
// at anything that belongs with a clinician. This is a keyword gate, not a diagnosis: it
// errs toward stopping, and the message it triggers says why and points onward rather
// than silently producing a plan that ignored what was typed.
//
// Matching is substring-based over a lowercased field, which is what makes it work across
// inflections ("gravid", "graviditet", "gravida") without a stemmer. Both English and
// Swedish stems are listed because the field is free text in whatever language the user
// happens to think in.
export const MEDICAL_STEMS = [
  // pregnancy
  'pregnan', 'gravid',
  // cardiac / vascular
  'heart condition', 'heart disease', 'cardiac', 'angina', 'arrhythmi', 'pacemaker',
  'hjärtfel', 'hjärtsjuk', 'hjärtinfarkt', 'kärlkramp', 'pacemaker',
  'blood pressure', 'högt blodtryck', 'hypertens',
  // recent surgery / acute injury
  'surgery', 'operated', 'post-op', 'opererad', 'operation', 'nyopererad',
  'fracture', 'fraktur', 'broken bone', 'benbrott',
  'herniat', 'disc prolapse', 'diskbråck',
  // neurological / systemic
  'epilep', 'stroke', 'blodpropp', 'embol', 'chemo', 'cytostatika',
  // acute pain worth a clinician
  'chest pain', 'bröstsmärt'
]

/**
 * Does the free-text limitation field name something that should stop generation?
 * Returns the matched stem (useful for the message) or null.
 */
export function medicalFlag(limits) {
  const s = String(limits || '').toLowerCase()
  if (!s) return null
  return MEDICAL_STEMS.find(k => s.includes(k)) || null
}

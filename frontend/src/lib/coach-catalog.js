// Turning 1,324 exercises into a shortlist the coach can actually be handed.
//
// The whole catalogue does not fit in a prompt and should not be there: a model asked to
// pick six exercises out of 1,324 lines spends its attention on reading rather than on
// choosing. Filtering first — by the equipment the user actually has — is also the single
// thing that decides whether the plan is performable, so it is done here, deterministically,
// and never delegated to the model.

import { EXDB } from './exercises.js'

/* ------------------------------- equipment ------------------------------- */

// Presets, not 29 checkboxes. The equipment answer is the only one that must be right,
// and a 29-item list is the surest way to make someone skip the question. Each preset
// expands to the eq values it covers; "custom" opens the full list for the rare user who
// wants it. Counts are exercises in the catalogue, as of the bundled dataset.
export const EQ_PRESETS = {
  gym: {
    name: 'Full gym',
    eq: ['body weight', 'dumbbell', 'cable', 'barbell', 'leverage machine', 'smith machine',
      'kettlebell', 'weighted', 'stability ball', 'ez barbell', 'assisted', 'band',
      'medicine ball', 'rope', 'sled machine', 'olympic barbell', 'trap bar', 'roller']
  },
  home: {
    name: 'Dumbbells at home',
    eq: ['body weight', 'dumbbell', 'band', 'resistance band', 'kettlebell', 'stability ball', 'roller']
  },
  barbell: {
    name: 'Barbell and rack',
    eq: ['body weight', 'barbell', 'ez barbell', 'olympic barbell', 'weighted', 'trap bar']
  },
  bodyweight: {
    name: 'Bodyweight only',
    eq: ['body weight', 'assisted', 'weighted']
  }
}

// Every eq value in the catalogue, for the "customise" list.
export const ALL_EQUIPMENT = [...new Set(EXDB.map(e => e.eq))].sort()

/** The eq values a preset key expands to; an unknown key expands to nothing. */
export const eqOfPreset = key => (EQ_PRESETS[key] ? [...EQ_PRESETS[key].eq] : [])

/* ------------------------------- shortlist ------------------------------- */

// Cardio is programmed by time and speed rather than sets and reps, and v1 does not ask
// the coach for conditioning work — leaving it in only invites plans the schema cannot
// express cleanly.
const PROGRAMMABLE = ex => ex.bp !== 'cardio'

// How many candidates each body part is worth. Roughly proportional to how much of a
// week's programming lands there, so a shortlist of ~120 still offers real choice on legs
// and back without burying them under 40 biceps variations.
const QUOTA = {
  'upper legs': 22, back: 22, chest: 18, shoulders: 16, 'upper arms': 16,
  waist: 12, 'lower legs': 8, 'lower arms': 6, neck: 0
}

export const SHORTLIST_MAX = 120

/**
 * Exercises the coach may choose from, given the equipment on hand.
 *
 * Selection inside a body part is by how ordinary the exercise is, approximated by how
 * much equipment the movement needs and how early it sits in the dataset — the catalogue
 * is alphabetical, so this is not a quality ranking. It does not need to be: the point is
 * a spread that covers the usual patterns, and the model does the choosing from there.
 */
export function shortlist(equipment, { max = SHORTLIST_MAX, exclude = [] } = {}) {
  const have = new Set(equipment || [])
  const skip = new Set(exclude)
  const byPart = {}
  for (const ex of EXDB) {
    if (!PROGRAMMABLE(ex) || skip.has(ex.id) || !have.has(ex.eq)) continue
    ;(byPart[ex.bp] = byPart[ex.bp] || []).push(ex)
  }
  const out = []
  for (const [bp, quota] of Object.entries(QUOTA)) {
    const list = byPart[bp] || []
    // Compound work first: an exercise whose secondary muscles are many is a movement
    // pattern, and those are what a week should be built around.
    list.sort((a, b) => (b.sm || []).length - (a.sm || []).length)
    out.push(...list.slice(0, quota))
  }
  return out.slice(0, max)
}

/** One exercise per line: id, name, body part, equipment, target. Compact on purpose. */
export const shortlistLines = list =>
  list.map(e => [e.id, e.n, e.bp, e.eq, e.tg].join('|')).join('\n')

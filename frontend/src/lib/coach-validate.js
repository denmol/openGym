// Deterministic checks on what the chat sent back, before any of it reaches the user.
//
// This is what separates "the model thought this looked right" from something worth
// following for eight weeks. All of it is arithmetic over data the app already holds —
// the catalogue, the muscle map, the progression rules — so none of it depends on the
// model having been careful.
//
// Two severities, and the split matters:
//
//   errors    the plan is wrong or cannot be performed — an id that does not exist,
//             a barbell lift for someone with two dumbbells, a Thursday pointing at a
//             routine that was never written. These block, and go straight into the
//             repair prompt.
//   warnings  a judgement call the model may have got wrong — volume outside the usual
//             range, a session that will run long, an exercise loading a joint the user
//             said hurts. These are shown and the user decides, because a validator
//             confident enough to block on judgement produces a repair loop that never
//             converges: every fix trips a different rule.
//
// Problems are { key, args } where key is the English sentence with {0} placeholders —
// the same convention the rest of the app uses, so the UI can run it through t() while
// the repair prompt sends the English straight to the model.

import { EXIDX } from './exercises.js'
import { musclesOf, MUSCLE_NAME } from './muscles.js'
import { modeOf } from './history.js'
import { POLICIES_FOR } from './progression.js'

/* ------------------------------- tunables ------------------------------- */

// Weekly working sets per muscle group that the plan should land inside. Wide on purpose:
// this is a net for the plainly wrong, not a prescription.
export const WEEKLY_SETS = { min: 6, max: 22 }
// Seconds a rep takes, and the rest assumed between sets, for the session-length estimate.
const SEC_PER_REP = 3
const SEC_REST = 90
// How far over the stated session length a plan may run before it is worth mentioning.
const TIME_SLACK = 1.25

// Free-text limitations mapped to the muscles that load the joint. Substring matching, in
// English and Swedish, for the same reason as the medical gate in coach-profile.js: the
// field is prose in whichever language the user thinks in.
const LIMIT_MUSCLES = {
  knee: ['quadriceps', 'hamstring'], knä: ['quadriceps', 'hamstring'],
  shoulder: ['deltoids', 'chest'], axel: ['deltoids', 'chest'], axlar: ['deltoids', 'chest'],
  'lower back': ['lower-back'], ländrygg: ['lower-back'], rygg: ['lower-back'], back: ['lower-back'],
  elbow: ['triceps', 'biceps'], armbåge: ['triceps', 'biceps'],
  wrist: ['forearm'], handled: ['forearm'],
  hip: ['gluteal', 'hip-flexors'], höft: ['gluteal', 'hip-flexors'],
  neck: ['trapezius'], nacke: ['trapezius'],
  ankle: ['calves', 'tibialis'], fotled: ['calves', 'tibialis']
}

/** Muscle slugs the user's stated limitations touch. */
export function limitedMuscles(limits) {
  const s = String(limits || '').toLowerCase()
  if (!s) return []
  const out = new Set()
  for (const [word, muscles] of Object.entries(LIMIT_MUSCLES)) {
    if (s.includes(word)) muscles.forEach(m => out.add(m))
  }
  return [...out]
}

/* ------------------------------- helpers ------------------------------- */

const P = (key, ...args) => ({ key, args })

/** An { key, args } problem as plain English, for the repair prompt. */
export const problemText = p =>
  p.args.reduce((s, a, i) => s.replaceAll('{' + i + '}', a), p.key)

/** Seconds one exercise entry is expected to take. */
const secondsFor = e => {
  const sets = Number(e.sets) || 0
  const per = modeOf(e) === 'time' ? (Number(e.sec) || 45) : (Number(e.reps) || 10) * SEC_PER_REP
  return sets * (per + SEC_REST)
}

/** How many times a week each routine id is trained, from the week map. */
const timesPerWeek = week => {
  const n = {}
  for (const id of Object.values(week || {})) if (id) n[id] = (n[id] || 0) + 1
  return n
}

/* ------------------------------- the checks ------------------------------- */

/**
 * @param {object} data    the parsed reply (raw, before plan-share's parsePlan)
 * @param {object} profile a cleaned coachProfile
 * @returns {{ errors: object[], warnings: object[], ok: boolean }}
 */
export function validateCoachPlan(data, profile) {
  const errors = []
  const warnings = []
  const routines = Array.isArray(data && data.routines) ? data.routines : []
  const week = (data && data.week) || {}
  const have = new Set(profile.equipment || [])
  const limited = limitedMuscles(profile.limits)

  if (!routines.length) {
    errors.push(P('The plan has no training days in it.'))
    return { errors, warnings, ok: false }
  }

  /* --- routines and their exercises --- */
  const ids = new Set()
  for (const r of routines) {
    const name = (r && r.name) || (r && r.id) || '?'
    if (r && r.id) ids.add(r.id)
    const ex = Array.isArray(r && r.ex) ? r.ex : []
    if (!ex.length) { errors.push(P('“{0}” has no exercises.', name)); continue }

    for (const e of ex) {
      const cat = e && EXIDX[e.id]
      if (!cat) { errors.push(P('“{0}” uses an exercise id that does not exist: {1}.', name, JSON.stringify(e && e.id))); continue }
      if (have.size && !have.has(cat.eq)) {
        errors.push(P('“{0}” uses {1}, which needs {2} — not in the available equipment.', name, cat.n, cat.eq))
      }
      if (e.weight != null && e.weight !== 0) {
        errors.push(P('“{0}” sets a weight on {1}. Leave weights out — the first session records them.', name, cat.n))
      }
      if (!(Number(e.sets) > 0)) errors.push(P('“{0}” gives {1} no set count.', name, cat.n))
      const allowed = POLICIES_FOR[modeOf(e)] || ['off']
      if (e.prog && !allowed.includes(e.prog)) {
        errors.push(P('“{0}” gives {1} the progression rule “{2}”, which is not one of: {3}.', name, cat.n, e.prog, allowed.join(', ')))
      }
      if (e.prog === 'double' && !(Number(e.repsMax) > Number(e.repsMin))) {
        errors.push(P('“{0}” uses double progression on {1} without a rep range.', name, cat.n))
      }
      if (limited.length) {
        const hit = Object.keys(musclesOf(cat)).filter(m => limited.includes(m))
        if (hit.length) warnings.push(P('{0} in “{1}” loads something you said is a problem.', cat.n, name))
      }
    }

    const mins = Math.round(ex.reduce((n, e) => n + secondsFor(e), 0) / 60)
    if (profile.minutes && mins > profile.minutes * TIME_SLACK) {
      warnings.push(P('“{0}” looks like about {1} minutes, against the {2} you asked for.', name, mins, profile.minutes))
    }
  }

  /* --- the week --- */
  const scheduled = Object.entries(week).filter(([, id]) => id)
  for (const [day, id] of scheduled) {
    if (!ids.has(id)) errors.push(P('Day {0} is assigned to “{1}”, which is not one of the training days.', day, id))
  }
  if (profile.days && scheduled.length !== profile.days) {
    errors.push(P('The week has {0} training days, but {1} were asked for.', scheduled.length, profile.days))
  }

  /* --- weekly volume per muscle --- */
  const perWeek = timesPerWeek(week)
  const load = {}
  const targeted = new Set()
  for (const r of routines) {
    const reps = perWeek[r && r.id] || 0
    if (!reps) continue
    for (const e of (Array.isArray(r.ex) ? r.ex : [])) {
      const cat = EXIDX[e && e.id]
      const sets = Number(e && e.sets) || 0
      if (!cat || !sets) continue
      const m = musclesOf(cat)
      for (const slug in m) {
        load[slug] = (load[slug] || 0) + m[slug] * sets * reps
        if (m[slug] === 1) targeted.add(slug)
      }
    }
  }
  const muscle = slug => MUSCLE_NAME[slug] || slug
  for (const [slug, sets] of Object.entries(load)) {
    const n = Math.round(sets)
    if (n > WEEKLY_SETS.max) warnings.push(P('{0} gets about {1} sets a week — more than the {2} this checks against.', muscle(slug), n, WEEKLY_SETS.max))
  }
  // The floor applies only to muscles the plan actually aims at. Every pressing movement
  // puts fractional load on half a dozen supporting muscles, so holding those to a
  // minimum would tag a perfectly ordinary two-day plan with eight warnings — and a
  // warning list nobody reads is worse than no warnings. A muscle that is somebody's
  // primary target but still gets four sets a week is the real mistake.
  for (const slug of targeted) {
    const n = Math.round(load[slug] || 0)
    if (n > 0 && n < WEEKLY_SETS.min) warnings.push(P('{0} gets only about {1} sets a week.', muscle(slug), n))
  }

  return { errors, warnings, ok: errors.length === 0 }
}

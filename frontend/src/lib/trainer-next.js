// "Next session": what to put on the bar, in numbers, before the person gets there.
//
// Nothing new is decided here. The weights come from lib/progression.js — the same policy the
// workout itself uses to pre-fill its sets — and this only gathers them for the whole next
// session so they can be read in one place with the reason beside each. A suggestion the
// workout and the trainer disagreed on would be worse than none, so there is one source.
//
// The one thing added is the lighter session. The trainer already says when a deload is
// worth taking (a 'fatigue' or 'block_long' finding: half the sets, three reps in reserve);
// this turns that into the actual sets and weights for the next session. It cuts sets and
// keeps the weight the person already handles — a deload is less work, not lighter loads
// they then have to climb back from.

import { modeOf } from './history.js'
import { isCardio } from './exercises.js'
import { nextPrescription, sessionsFor } from './progression.js'
import { effectiveRoutine } from './history.js'
import { flexOf, flexWeek } from './flex.js'

export const DELOAD_SETS_SHARE = 0.5     // keep in step with deloadSetsPct in the 'fatigue' finding
export const DELOAD_RIR = 3

/** True when the trainer's own findings say a lighter session is the right next step. */
export const deloadAdvised = analysis =>
  !!(analysis && analysis.findings && analysis.findings.some(f => f.code === 'fatigue' || f.code === 'block_long'))

const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/**
 * The routine to do next. Flexible week: the next one in the rotation. Fixed week: today's
 * if it is planned and not yet done, else the next planned day within the coming week (a routine planned on one weekday only comes round after 7 days).
 * Returns { routine, iso, today } or null when nothing is planned.
 */
export function nextRoutineFor(S, todayIso) {
  if (flexOf(S).on) {
    const { next } = flexWeek(S, todayIso)
    return next ? { routine: next, iso: todayIso, today: true } : null
  }
  for (let i = 0; i <= 7; i++) {
    const iso = addDays(todayIso, i)
    const r = effectiveRoutine(S, iso)
    if (!r) continue
    if (i === 0 && (S.workouts || []).some(w => w.d === iso && w.routineId === r.id)) continue
    return { routine: r, iso, today: i === 0 }
  }
  return null
}

/** One exercise of the session, as numbers. `kind` is the policy's verdict or 'lighter'. */
export function planItem(S, routine, cfg, { deload = false } = {}) {
  const mode = modeOf(cfg)
  const plannedSets = cfg.sets || 1
  if (deload) {
    const last = sessionsFor(S, cfg.id, cfg).filter(s => s.mode === mode).slice(-1)[0]
    const w = last && last.weight > 0 ? last.weight : cfg.weight
    return {
      id: cfg.id, mode, kind: 'lighter',
      sets: Math.max(1, Math.ceil(plannedSets * DELOAD_SETS_SHARE)),
      weight: w, reps: cfg.reps, sec: cfg.sec,
      why: ['A lighter session: half the sets at the weight you already handle, stopping with about {0} reps left.', DELOAD_RIR]
    }
  }
  const p = nextPrescription(S, cfg, routine)
  return {
    id: cfg.id, mode, kind: p.kind,
    sets: p.sets != null ? p.sets : plannedSets,
    weight: p.weight != null ? p.weight : cfg.weight,
    reps: p.reps != null ? p.reps : cfg.reps,
    sec: p.sec != null ? p.sec : cfg.sec,
    why: p.why || null
  }
}

/**
 * The whole next session, or null. `deload` switches every strength exercise to the lighter
 * version; cardio is left out because it has no weight to prescribe.
 */
export function nextSession(S, todayIso, { deload = false } = {}) {
  const found = nextRoutineFor(S, todayIso)
  if (!found) return null
  const { routine } = found
  const items = (routine.ex || [])
    .filter(cfg => !isCardio(cfg.id))
    .map(cfg => planItem(S, routine, cfg, { deload }))
  return { ...found, deload, items, unit: S.unit || 'kg' }
}

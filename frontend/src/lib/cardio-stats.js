// Cardio read back over a period.
//
// Kept apart from cardio.js for the same reason effort.js is kept apart from history.js:
// the set arithmetic is pure and knows nothing about the store, while everything here walks
// S.workouts and depends on modeOf to tell a run from a set of squats. Pointing that
// dependency one way keeps cardio.js importable from history.js without a cycle.
//
// Cardio does not join workoutVolume, and should not: multiplying a duration into a
// weight × reps figure would make two incomparable things look like one number. It is
// counted in minutes and kilometres instead, which is what it was measured in.

import { mondayOf, weekKey } from './format.js'
import { inWindow, workoutCardio } from './history.js'
import { formatPace } from './cardio.js'

const round = (value, places) => {
  const f = 10 ** places
  return Math.round(value * f) / f
}

/** Every workout in the window that contains completed cardio, newest last. */
const cardioWorkouts = (S, days) => ((S && S.workouts) || [])
  .filter(w => inWindow(w, days))
  .map(w => ({ w, c: workoutCardio(w) }))
  .filter(({ c }) => c.sets > 0)

/**
 * The period as one reading.
 *
 * Pace is the period's distance over its duration rather than an average of each session's
 * pace: a 40-minute run and a 5-minute warm-up averaged flat would describe neither, the
 * same reason the heart rate is weighted by the minutes it actually covers.
 */
export function cardioSummary(S, days) {
  const rows = cardioWorkouts(S, days)
  let minutes = 0, km = 0, hrWeighted = 0, hrMinutes = 0, derived = false
  for (const { c } of rows) {
    minutes += c.minutes
    km += c.km
    if (c.hr != null) { hrWeighted += c.hr * c.hrMinutes; hrMinutes += c.hrMinutes }
    if (c.anyDistanceDerived) derived = true
  }
  return {
    sessions: rows.length,
    minutes: round(minutes, 0),
    km: round(km, 2),
    pace: minutes > 0 && km > 0 ? minutes / km : null,
    hr: hrMinutes > 0 ? Math.round(hrWeighted / hrMinutes) : null,
    hrMinutes: round(hrMinutes, 0),
    anyDistanceDerived: derived,
    // The longest single session in the window — the one worth remembering, and the number
    // a total of many short sessions hides completely.
    longestMinutes: rows.reduce((m, { c }) => Math.max(m, c.minutes), 0),
    longestKm: round(rows.reduce((m, { c }) => Math.max(m, c.km), 0), 2)
  }
}

/**
 * Week by week, for the chart.
 *
 * A week with cardio but no distance still counts its minutes; its pace is simply absent
 * rather than zero, so the pace line skips it instead of dropping to the floor.
 */
export function cardioWeeks(S, days) {
  const wk = new Map()
  for (const { w, c } of cardioWorkouts(S, days)) {
    const k = weekKey(w.d)
    let e = wk.get(k)
    if (!e) wk.set(k, e = { t: mondayOf(w.d), minutes: 0, km: 0, sessions: 0 })
    e.minutes += c.minutes
    e.km += c.km
    e.sessions++
  }
  return [...wk.values()].sort((a, b) => a.t - b.t).map(e => ({
    t: e.t,
    minutes: round(e.minutes, 0),
    km: round(e.km, 2),
    sessions: e.sessions,
    pace: e.minutes > 0 && e.km > 0 ? e.minutes / e.km : null
  }))
}

/** Has anything cardio ever been logged? Decides whether the card exists at all. */
export const hasCardio = S => ((S && S.workouts) || []).some(w => workoutCardio(w).sets > 0)

/** "5:45/km", or null when the period has no distance to divide. */
export const paceLabel = pace => {
  const p = formatPace(pace)
  return p ? `${p}/km` : null
}

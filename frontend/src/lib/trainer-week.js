// The week at a glance, worked out when the Home tab opens.
//
// Push notifications cannot do this on the hosting this app runs on, and a notification is
// the wrong shape for it anyway: a number of lines you read once, not something to tap away.
// So the summary is computed on the spot from the log — sessions against the aim, sets against
// the week before, new personal bests, and (when food and weight are logged) protein and the
// change in weight. On Monday and Tuesday it is last week's summary, because that is when you
// want it; for the rest of the week it is the week so far.
//
// Everything is arithmetic on the log. Nothing here is advice, so there is no model and no
// wording to check; the screen turns the numbers into sentences.

import { mondayOf, isoOf } from './format.js'
import { flexOf } from './flex.js'
import { isWorkingSet } from './trainer.js'
import { proteinIntake, foodAdviceBlocked } from './trainer-food.js'
import { weightIn } from './history.js'

const MIN_WEEK_FOOD_DAYS = 3        // fewer whole days than a trainer finding asks for: this only describes

const shift = (ms, days) => { const d = new Date(ms); d.setDate(d.getDate() + days); return +d }
const workoutsIn = (S, monday) => (S.workouts || []).filter(w => mondayOf(w.d) === monday)
const setsOf = ws => ws.reduce((n, w) => n + (w.entries || []).reduce((m, e) => m + (e.sets || []).filter(isWorkingSet).length, 0), 0)

/** Sessions the person is aiming for in a week: the flexible-week number, or the planned days. */
export function weeklyAim(S) {
  const flex = flexOf(S)
  if (flex.on) return flex.perWeek
  const known = new Set((S.routines || []).map(r => r.id))
  return Object.values(S.week || {}).filter(id => known.has(id)).length
}

/**
 * @returns {null | {
 *   which: 'current'|'previous', start: string, end: string,
 *   sessions: number, aim: number, sets: number, prevSets: number, prs: string[],
 *   protein: null | { days, avgG, gPerKg }, weightDelta: number | null
 * }}
 */
export function weekSummary(S, now = Date.now()) {
  if (!(S.workouts || []).length) return null
  const today = new Date(now)
  const dow = (today.getDay() + 6) % 7
  const thisMonday = mondayOf(isoOf(today))
  const prevMonday = shift(thisMonday, -7)
  const which = dow <= 1 && workoutsIn(S, prevMonday).length > 0 ? 'previous' : 'current'
  const monday = which === 'previous' ? prevMonday : thisMonday
  const sunday = shift(monday, 6)

  const ws = workoutsIn(S, monday)
  const out = {
    which, start: isoOf(new Date(monday)), end: isoOf(new Date(sunday)),
    sessions: ws.length, aim: weeklyAim(S),
    sets: setsOf(ws), prevSets: setsOf(workoutsIn(S, shift(monday, -7))),
    prs: [...new Set(ws.flatMap(w => w.prs || []))],
    protein: null, weightDelta: null
  }

  // Food and weight describe the person's body, so they stay out of it for anyone the trainer
  // would not give food advice to (a minor, a nutrition-safety flag).
  if (!foodAdviceBlocked(S)) {
    const asOf = which === 'previous' ? sunday : now
    const pi = proteinIntake(S, asOf, which === 'previous' ? 7 : dow + 1, MIN_WEEK_FOOD_DAYS)
    if (pi) out.protein = { days: pi.days, avgG: Math.round(pi.avgG), gPerKg: Math.round(pi.gPerKg * 100) / 100 }

    const lo = monday, hi = shift(sunday, 1)
    const kgs = (S.bodyweight || [])
      .map(e => ({ t: e.t || new Date(e.d + 'T12:00:00').getTime(), kg: weightIn(e, 'kg') }))
      .filter(p => p.kg).sort((a, b) => a.t - b.t)
    const inside = kgs.filter(p => p.t >= lo && p.t < hi)
    const before = kgs.filter(p => p.t < lo && lo - p.t <= 14 * 86400000).pop()
    const ref = before || (inside.length >= 2 ? inside[0] : null)
    if (inside.length && ref && inside[inside.length - 1] !== ref) {
      out.weightDelta = Math.round((inside[inside.length - 1].kg - ref.kg) * 10) / 10
    }
  }
  return out
}

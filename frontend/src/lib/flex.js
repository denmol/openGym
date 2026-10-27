// The flexible week, for people whose days are not their own (shift work, on-call).
//
// A fixed week says "Push on Monday". Work a night shift on Monday and the app has quietly
// recorded a failure, then counts the whole week against you. The flexible week drops the
// weekdays and keeps the rest: a number of sessions to aim for, and a rotation through the
// routines you already have, so the next session is simply the one after the last you did.
//
// The routines and the week map stay exactly as they are. Switching this off returns to the
// fixed week with nothing lost, and the rotation order is the order the routines sit in the
// week (Monday first), so it is the order the person already chose.

import { weekKey } from './format.js'

export const FLEX_RANGE = [1, 7]
export const DEF_FLEX = { on: false, perWeek: 3 }

const clamp = n => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.min(FLEX_RANGE[1], Math.max(FLEX_RANGE[0], v)) : DEF_FLEX.perWeek
}

/** The stored setting overlaid on the defaults; a profile that never set it is "off". */
export const flexOf = S => ({
  on: !!(S && S.flex && S.flex.on),
  perWeek: clamp(S && S.flex && S.flex.perWeek != null ? S.flex.perWeek : DEF_FLEX.perWeek)
})

/** Routine ids in rotation order: each distinct routine in the week, Monday first. */
export function rotation(S) {
  const routines = S.routines || []
  const known = new Set(routines.map(r => r.id))
  const seen = []
  ;[1, 2, 3, 4, 5, 6, 0].forEach(d => {
    const id = (S.week || {})[d]
    if (id && known.has(id) && !seen.includes(id)) seen.push(id)
  })
  // No weekdays chosen at all: fall back to the routines in the order they were made.
  return seen.length ? seen : routines.map(r => r.id)
}

/**
 * Where the week stands and what comes next.
 * `next` is the routine after the most recent one done (by workout date), so skipping a day
 * never skips a routine, and doing two sessions in a day moves on twice.
 */
export function flexWeek(S, todayIso) {
  const { perWeek } = flexOf(S)
  const wk = weekKey(todayIso)
  const done = (S.workouts || []).filter(w => weekKey(w.d) === wk).length
  const order = rotation(S)
  let next = null
  if (order.length) {
    const last = [...(S.workouts || [])].reverse().find(w => order.includes(w.routineId))
    const i = last ? (order.indexOf(last.routineId) + 1) % order.length : 0
    next = (S.routines || []).find(r => r.id === order[i]) || null
  }
  return { perWeek, done, left: Math.max(0, perWeek - done), next, met: done >= perWeek }
}

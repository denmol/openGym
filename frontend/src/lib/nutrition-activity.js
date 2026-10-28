// What the day's logged sessions and activities add to energy use, for the Food screen.
// Only a rough estimate for display; the nutrition targets never read it.

import { activityKcal } from './activity-energy.js'
import { modeOf } from './history.js'
import { cardioSet } from './cardio.js'
import { weightKgOf } from './nutrition-goals.js'
import { exOr } from './exercises.js'

const MAX_STRENGTH_MIN = 180

function kindOf(id) {
  if (id === 'act-walk') return 'walk'
  if (id === 'act-hike') return 'hike'
  if (id === 'act-run') return 'run'
  if (id === 'act-bike') return 'bike'
  if (id === 'act-swim') return 'swim'
  if (id === 'act-other') return 'other'
  return 'cardio'
}

/** { rows: [{ name, minutes, kcal }], total, weightKg } for one date. */
export function dayActivity(S, date) {
  const last = S.bodyweight?.length ? S.bodyweight[S.bodyweight.length - 1] : null
  const weightKg = weightKgOf(last)
  const rows = []
  for (const w of S.workouts || []) {
    if (w.d !== date) continue
    let minutes = 0, kcal = 0, cardioMin = 0, strength = false
    for (const e of w.entries || []) {
      const done = (e.sets || []).filter(s => s.done)
      if (!done.length) continue
      if (modeOf({ ...(e.target || {}), id: e.id }) === 'cardio') {
        const kind = kindOf(e.id)
        for (const s of done) {
          const c = cardioSet(s)
          if (c.min == null) continue
          cardioMin += c.min
          minutes += c.min
          const v = activityKcal({ kind, minutes: c.min, km: c.km, kg: weightKg })
          if (v != null) kcal += v
        }
      } else strength = true
    }
    if (strength && w.start && w.end) {
      const span = Math.round((w.end - w.start) / 60000) - cardioMin
      const m = Math.min(MAX_STRENGTH_MIN, span)
      if (m > 0) {
        minutes += m
        const v = activityKcal({ kind: 'strength', minutes: m, kg: weightKg })
        if (v != null) kcal += v
      }
    }
    if (minutes > 0) rows.push({ name: w.name || (w.entries?.[0] && exOr(w.entries[0].id)?.n) || '', minutes, kcal: weightKg ? kcal : null })
  }
  const total = weightKg ? rows.reduce((a, r) => a + r.kcal, 0) : null
  return { rows, total, weightKg }
}

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
  // A later weigh-in must not rewrite the estimated expenditure of every earlier day.
  const last = (S.bodyweight || []).filter(b => b.d <= date && weightKgOf(b) != null)
    .sort((a, b) => a.d.localeCompare(b.d) || (a.t || 0) - (b.t || 0)).at(-1)
  const weightKg = weightKgOf(last)
  const rows = []
  for (const w of S.workouts || []) {
    if (w.d !== date) continue
    const kg = weightKgOf({ w: w.bw, u: w.bwu }) ?? weightKg
    let minutes = 0, kcal = 0, cardioMin = 0, strength = false, capped = false
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
          const v = activityKcal({ kind, minutes: c.min, km: c.km, kg })
          if (v != null) kcal += v
        }
      } else strength = true
    }
    if (strength && w.start && w.end) {
      const span = Math.round((w.end - w.start) / 60000) - cardioMin
      const m = Math.min(MAX_STRENGTH_MIN, span)
      if (m > 0) {
        minutes += span
        capped = span > m
        const v = activityKcal({ kind: 'strength', minutes: m, kg })
        if (v != null) kcal += v
      }
    }
    if (minutes > 0) rows.push({ name: w.name || (w.entries?.[0] && exOr(w.entries[0].id)?.n) || '', minutes, kcal: kg ? kcal : null,
      ...(capped ? { strengthEstimateMinutes: MAX_STRENGTH_MIN } : {}) })
  }
  const total = rows.some(r => r.kcal == null) || (!rows.length && !weightKg) ? null : rows.reduce((a, r) => a + r.kcal, 0)
  return { rows, total, weightKg }
}

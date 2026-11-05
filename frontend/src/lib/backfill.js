import { isoOf } from './format.js'
import { compareWorkouts } from './history.js'

// The date is a local calendar day; minutes are elapsed time (including across DST).
// Reject impossible wall times instead of letting Date silently roll them into another day/hour.
export function pastStarts(day, time = '12:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !/^\d{2}:\d{2}$/.test(time)) return []
  const date = new Date(`${day}T${time}:00`)
  const clock = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
  if (!Number.isFinite(+date) || isoOf(date) !== day || clock !== time) return []
  const nextDay = new Date(date); nextDay.setDate(nextDay.getDate() + 1)
  const delta = nextDay.getTimezoneOffset() - date.getTimezoneOffset()
  const later = new Date(+date + delta * 60000)
  // During a fall-back hour both instants have the same wall clock. Do not silently choose.
  const repeated = delta > 0 && isoOf(later) === day && later.getHours() === date.getHours() && later.getMinutes() === date.getMinutes()
  return repeated ? [+date, +later] : [+date]
}

export function pastTiming({ day, time = '12:00', minutes, offset }, now = Date.now()) {
  const starts = pastStarts(day, time)
  const start = starts.length === 1 ? starts[0] : starts.find(ms => new Date(ms).getTimezoneOffset() === offset)
  const min = Number(minutes), end = start + min * 60000
  if (!Number.isFinite(start) || !Number.isFinite(min) || min <= 0 || !Number.isFinite(end) || end <= start || end > now) return null
  return { start, end, minutes: min }
}

// Historical entry must not learn from sessions or confirmed defaults in its future.
// Current routine configuration is still the editable template; old plans are not archived.
export function historyBefore(S, session) {
  if (!session?.backdated) return S
  return {
    ...S,
    workouts: (S.workouts || []).filter(w => compareWorkouts(w, session) < 0).sort(compareWorkouts),
    // Defaults only carry a day, so same-day ordering is unknown; use recorded sets instead.
    exWeights: Object.fromEntries(Object.entries(S.exWeights || {}).filter(([, x]) => x.d < session.d))
  }
}

// Saving old facts may add a record, but must not replace a more recent working default.
export function rememberWorkoutWeights(S, w) {
  for (const e of w.entries) {
    const cur = S.exWeights[e.id]
    if (w.backdated && ((cur && (!cur.d || cur.d >= w.d)) ||
      S.workouts.some(later => compareWorkouts(later, w) > 0 && later.entries.some(x => x.id === e.id && x.sets.some(s => s.done && !s.warm))))) continue
    const mx = Math.max(0, ...e.sets.filter(s => s.done && (!w.backdated || !s.warm)).map(s => s.w || 0), e.topW || 0)
    if (mx > 0 && (!cur || mx > cur.w)) S.exWeights[e.id] = { w: mx, d: w.d }
  }
}

// Daily step counts, read back over a period.
//
// One figure per day is all that is stored (see the importer for why), so everything here
// is arithmetic over a short list rather than over a log of records.
//
// The average is per day *recorded*, not per day in the window. A watch left on the charger
// produces no record at all, and counting that day as zero would drag an average down to
// describe a device rather than a person. How many days it rests on is returned alongside
// it, for the same reason the effort card shows its denominator.

import { mondayOf, weekKey } from './format.js'

const inDays = (iso, days) =>
  !days || new Date(iso + 'T12:00:00').getTime() > Date.now() - days * 86400000

const rows = (S, days) => ((S && S.steps) || [])
  .filter(r => r && r.n > 0 && typeof r.d === 'string' && inDays(r.d, days))

/** The period as one reading. */
export function stepSummary(S, days) {
  const list = rows(S, days)
  if (!list.length) return { days: 0, total: 0, avg: null, best: null, bestDay: null }
  const total = list.reduce((n, r) => n + r.n, 0)
  const best = list.reduce((m, r) => (r.n > m.n ? r : m), list[0])
  return {
    days: list.length,
    total,
    avg: Math.round(total / list.length),
    best: best.n,
    bestDay: best.d
  }
}

/**
 * Week by week, for the chart.
 *
 * A week is plotted as its daily average rather than its total, so a week with three days
 * recorded sits beside a full one instead of looking like a collapse. The day count rides
 * along in the tooltip, because that is what makes the two comparable.
 */
export function stepWeeks(S, days) {
  const wk = new Map()
  for (const r of rows(S, days)) {
    const k = weekKey(r.d)
    let e = wk.get(k)
    if (!e) wk.set(k, e = { t: mondayOf(r.d), sum: 0, n: 0 })
    e.sum += r.n
    e.n++
  }
  return [...wk.values()].sort((a, b) => a.t - b.t)
    .map(e => ({ t: e.t, avg: Math.round(e.sum / e.n), days: e.n, total: e.sum }))
}

/** Has any step count ever been recorded? Decides whether the card exists at all. */
export const hasSteps = S => rows(S, 0).length > 0

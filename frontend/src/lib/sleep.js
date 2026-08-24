// Nightly sleep duration, read back over a period.
//
// One figure per night is all that is stored (see the importer for why), so everything here
// is arithmetic over a short list rather than over a log of records.
//
// The average is per night *recorded*, not per night in the window. A watch left off the
// wrist produces no record at all, and counting that night as zero would drag an average down
// to describe the device rather than the person. How many nights it rests on is returned
// alongside it, for the same reason the steps card shows its denominator.

import { mondayOf, weekKey } from './format.js'

const inDays = (iso, days) =>
  !days || new Date(iso + 'T12:00:00').getTime() > Date.now() - days * 86400000

const rows = (S, days) => ((S && S.sleep) || [])
  .filter(r => r && r.min > 0 && typeof r.d === 'string' && inDays(r.d, days))

/** The period as one reading. */
export function sleepSummary(S, days) {
  const list = rows(S, days)
  if (!list.length) return { days: 0, total: 0, avg: null, best: null, bestDay: null }
  const total = list.reduce((n, r) => n + r.min, 0)
  const best = list.reduce((m, r) => (r.min > m.min ? r : m), list[0])
  return {
    days: list.length,
    total,
    avg: Math.round(total / list.length),
    best: best.min,
    bestDay: best.d
  }
}

/**
 * Week by week, for the chart.
 *
 * A week is plotted as its nightly average rather than its total, so a week with three nights
 * recorded sits beside a full one instead of looking like a collapse. The night count rides
 * along in the tooltip, because that is what makes the two comparable.
 */
export function sleepWeeks(S, days) {
  const wk = new Map()
  for (const r of rows(S, days)) {
    const k = weekKey(r.d)
    let e = wk.get(k)
    if (!e) wk.set(k, e = { t: mondayOf(r.d), sum: 0, n: 0 })
    e.sum += r.min
    e.n++
  }
  return [...wk.values()].sort((a, b) => a.t - b.t)
    .map(e => ({ t: e.t, avg: Math.round(e.sum / e.n), days: e.n, total: e.sum }))
}

/** Has any night of sleep ever been recorded? Decides whether the card exists at all. */
export const hasSleep = S => rows(S, 0).length > 0

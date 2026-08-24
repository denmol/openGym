import { describe, expect, it } from 'vitest'
import { hasSteps, stepSummary, stepWeeks } from './steps.js'

const iso = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)
const S = { steps: [
  { d: iso(1), n: 9100 }, { d: iso(2), n: 4200 }, { d: iso(3), n: 12400 },
  { d: iso(40), n: 8000 }, { d: iso(400), n: 3000 }
] }

describe('stepSummary', () => {
  it('averages over the days recorded, not the days in the window', () => {
    // Three days in the last 30, not thirty: a watch on the charger records nothing, and
    // counting that as zero would describe the device instead of the person.
    expect(stepSummary(S, 30)).toMatchObject({ days: 3, total: 25700, avg: 8567 })
  })

  it('reports the best day and when it was', () => {
    expect(stepSummary(S, 30)).toMatchObject({ best: 12400, bestDay: iso(3) })
  })

  it('respects the window, and takes everything without one', () => {
    expect(stepSummary(S, 90).days).toBe(4)
    expect(stepSummary(S, 0).days).toBe(5)
  })

  it('has nothing to average from an empty or absent history', () => {
    for (const value of [{ steps: [] }, {}, null, { steps: [{ d: iso(1), n: 0 }] }]) {
      expect(stepSummary(value, 30)).toMatchObject({ days: 0, total: 0, avg: null, best: null })
    }
  })

  it('ignores a malformed row rather than counting it as a day', () => {
    expect(stepSummary({ steps: [{ n: 5000 }, null, { d: iso(1), n: 5000 }] }, 30).days).toBe(1)
  })
})

describe('stepWeeks', () => {
  it('plots the daily average, and carries the day count with it', () => {
    const weeks = stepWeeks(S, 30)
    expect(weeks.reduce((n, w) => n + w.days, 0)).toBe(3)
    expect(weeks.map(w => w.t)).toEqual([...weeks.map(w => w.t)].sort((a, b) => a - b))
    for (const w of weeks) expect(w.avg).toBe(Math.round(w.total / w.days))
  })

  it('has nothing to plot without steps', () => {
    expect(stepWeeks({ steps: [] }, 30)).toEqual([])
  })
})

describe('hasSteps', () => {
  it('is true only once a day with steps exists', () => {
    expect(hasSteps(S)).toBe(true)
    for (const value of [{ steps: [] }, {}, null, { steps: [{ d: iso(1), n: 0 }] }]) {
      expect(hasSteps(value)).toBe(false)
    }
  })
})

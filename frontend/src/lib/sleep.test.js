import { describe, expect, it } from 'vitest'
import { hasSleep, sleepSummary, sleepWeeks } from './sleep.js'

const iso = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)
const S = { sleep: [
  { d: iso(1), min: 420 }, { d: iso(2), min: 390 }, { d: iso(3), min: 480 },
  { d: iso(40), min: 400 }, { d: iso(400), min: 360 }
] }

describe('sleepSummary', () => {
  it('averages over the nights recorded, not the days in the window', () => {
    expect(sleepSummary(S, 30)).toMatchObject({ days: 3, total: 1290, avg: 430 })
  })

  it('reports the best night and when it was', () => {
    expect(sleepSummary(S, 30)).toMatchObject({ best: 480, bestDay: iso(3) })
  })

  it('respects the window, and takes everything without one', () => {
    expect(sleepSummary(S, 90).days).toBe(4)
    expect(sleepSummary(S, 0).days).toBe(5)
  })

  it('has nothing to average from an empty or absent history', () => {
    for (const value of [{ sleep: [] }, {}, null, { sleep: [{ d: iso(1), min: 0 }] }]) {
      expect(sleepSummary(value, 30)).toMatchObject({ days: 0, total: 0, avg: null, best: null })
    }
  })

  it('ignores a malformed row rather than counting it as a night', () => {
    expect(sleepSummary({ sleep: [{ min: 400 }, null, { d: iso(1), min: 400 }] }, 30).days).toBe(1)
  })
})

describe('sleepWeeks', () => {
  it('plots the nightly average, and carries the night count with it', () => {
    const weeks = sleepWeeks(S, 30)
    expect(weeks.reduce((n, w) => n + w.days, 0)).toBe(3)
    expect(weeks.map(w => w.t)).toEqual([...weeks.map(w => w.t)].sort((a, b) => a - b))
    for (const w of weeks) expect(w.avg).toBe(Math.round(w.total / w.days))
  })

  it('has nothing to plot without sleep data', () => {
    expect(sleepWeeks({ sleep: [] }, 30)).toEqual([])
  })
})

describe('hasSleep', () => {
  it('is true only once a night with sleep exists', () => {
    expect(hasSleep(S)).toBe(true)
    for (const value of [{ sleep: [] }, {}, null, { sleep: [{ d: iso(1), min: 0 }] }]) {
      expect(hasSleep(value)).toBe(false)
    }
  })
})

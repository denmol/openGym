import { describe, expect, it } from 'vitest'
import { cardioSummary, cardioWeeks, hasCardio, paceLabel } from './cardio-stats.js'

const CARDIO = { mode: 'cardio' }
const day = (d, sets) => ({ d, start: new Date(d + 'T12:00:00').getTime(), entries: [{ id: 'x', target: CARDIO, sets }] })
const lift = d => ({ d, start: new Date(d + 'T12:00:00').getTime(), entries: [{ id: 'y', sets: [{ w: 60, r: 5, done: true }] }] })
const iso = daysAgo => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)

const S = {
  workouts: [
    day(iso(3), [{ min: 40, km: 8, hr: 160, done: true }]),
    day(iso(5), [{ min: 20, km: 3, done: true }, { min: 10, km: 1, done: false }]),
    lift(iso(6)),
    day(iso(200), [{ min: 60, km: 12, done: true }])
  ]
}

describe('cardioSummary', () => {
  it('counts only sessions with completed cardio', () => {
    expect(cardioSummary(S, 30)).toMatchObject({ sessions: 2, minutes: 60, km: 11 })
  })

  it('leaves an unfinished set out of the totals', () => {
    // The 10 min / 1 km set is not done, so neither figure includes it.
    expect(cardioSummary(S, 30).minutes).toBe(60)
  })

  it('takes pace from the period, not from an average of each session', () => {
    // 11 km in 60 min is 5:27/km; averaging 5:00 and 6:40 would give 5:50.
    expect(paceLabel(cardioSummary(S, 30).pace)).toBe('5:27/km')
  })

  it('weights heart rate by the minutes it covers, and reports that denominator', () => {
    expect(cardioSummary(S, 30)).toMatchObject({ hr: 160, hrMinutes: 40 })
  })

  it('reports the longest single session, which a total hides', () => {
    expect(cardioSummary(S, 30)).toMatchObject({ longestMinutes: 40, longestKm: 8 })
  })

  it('respects the window, and takes everything when there is none', () => {
    expect(cardioSummary(S, 0)).toMatchObject({ sessions: 3, minutes: 120, km: 23 })
    expect(cardioSummary(S, 1)).toMatchObject({ sessions: 0, minutes: 0, km: 0, pace: null })
  })

  it('flags a distance that was derived from an old speed-only set', () => {
    const legacy = { workouts: [day(iso(2), [{ min: 30, speed: 10, done: true }])] }
    expect(cardioSummary(legacy, 30)).toMatchObject({ km: 5, anyDistanceDerived: true })
    expect(cardioSummary(S, 30).anyDistanceDerived).toBe(false)
  })

  it('has nothing to report for an empty or absent history', () => {
    for (const value of [{ workouts: [] }, {}, null]) {
      expect(cardioSummary(value, 30)).toMatchObject({ sessions: 0, minutes: 0, pace: null, hr: null })
    }
  })
})

describe('cardioWeeks', () => {
  it('groups sessions into weeks, oldest first', () => {
    const weeks = cardioWeeks(S, 30)
    expect(weeks.length).toBeGreaterThanOrEqual(1)
    expect(weeks.map(w => w.t)).toEqual([...weeks.map(w => w.t)].sort((a, b) => a - b))
    expect(weeks.reduce((n, w) => n + w.sessions, 0)).toBe(2)
  })

  it('leaves pace absent rather than zero for a week with no distance', () => {
    const noDistance = { workouts: [day(iso(2), [{ min: 30, done: true }])] }
    expect(cardioWeeks(noDistance, 30)[0]).toMatchObject({ minutes: 30, km: 0, pace: null })
  })
})

describe('hasCardio', () => {
  it('is true only once a cardio set has been finished', () => {
    expect(hasCardio(S)).toBe(true)
    expect(hasCardio({ workouts: [lift(iso(1))] })).toBe(false)
    expect(hasCardio({ workouts: [day(iso(1), [{ min: 20, km: 4, done: false }])] })).toBe(false)
    for (const value of [{ workouts: [] }, {}, null]) expect(hasCardio(value)).toBe(false)
  })
})

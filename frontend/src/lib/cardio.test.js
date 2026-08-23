import { describe, expect, it } from 'vitest'
import { cardioSet, formatCardioSet, formatPace, sumCardio } from './cardio.js'

describe('cardioSet', () => {
  it('derives speed and pace from a measured duration and distance', () => {
    expect(cardioSet({ min: 46, km: 8 })).toMatchObject({
      min: 46, km: 8, speed: 10.4, kmDerived: false
    })
    expect(formatPace(cardioSet({ min: 46, km: 8 }).pace)).toBe('5:45')
  })

  it('reads an old speed-only set and says the distance was derived', () => {
    expect(cardioSet({ min: 30, speed: 10 })).toMatchObject({ min: 30, km: 5, kmDerived: true })
  })

  it('prefers a recorded distance over a stored speed that disagrees', () => {
    // An edited duration leaves the old speed stale; the two measured fields win.
    expect(cardioSet({ min: 60, km: 10, speed: 99 })).toMatchObject({ km: 10, speed: 10, kmDerived: false })
  })

  it('keeps a speed-only set usable when there is no duration to divide by', () => {
    expect(cardioSet({ speed: 12 })).toMatchObject({ min: null, km: null, speed: 12, pace: null })
  })

  it('treats missing, zero and unparseable values as absent rather than as zero', () => {
    for (const set of [{}, { min: 0, km: 0 }, { min: '', km: 'abc' }, null, undefined]) {
      expect(cardioSet(set)).toMatchObject({ min: null, km: null, pace: null })
    }
  })

  it('accepts numeric strings, which is what a text input hands over', () => {
    expect(cardioSet({ min: '30', km: '5' })).toMatchObject({ min: 30, km: 5, speed: 10 })
  })
})

describe('formatPace', () => {
  it('reads as minutes and seconds per kilometre', () => {
    expect(formatPace(5.75)).toBe('5:45')
    expect(formatPace(4)).toBe('4:00')
    expect(formatPace(6.008)).toBe('6:00')
  })

  it('has nothing to show without a pace', () => {
    for (const value of [0, -1, null, NaN, Infinity, undefined]) expect(formatPace(value)).toBeNull()
  })
})

describe('formatCardioSet', () => {
  it('leads with what was done, then what follows from it', () => {
    expect(formatCardioSet({ min: 46, km: 8 })).toBe('46 min · 8 km · 5:45/km')
    expect(formatCardioSet({ min: 46, km: 8, hr: 152 })).toBe('46 min · 8 km · 5:45/km · 152 bpm')
  })

  it('marks a derived distance with ≈, as the rest of the app does', () => {
    expect(formatCardioSet({ min: 30, speed: 10 })).toBe('30 min · ≈5 km · 6:00/km')
  })

  it('falls back to speed when there is no distance at all', () => {
    expect(formatCardioSet({ speed: 12 })).toBe('12 km/h')
    expect(formatCardioSet({})).toBe('0 min')
  })
})

describe('sumCardio', () => {
  const sets = [
    { min: 10, km: 1.5, hr: 120, done: true },
    { min: 40, km: 8, hr: 160, done: true },
    { min: 5, km: 0.8, done: true }
  ]

  it('adds up duration, distance and set count', () => {
    expect(sumCardio(sets)).toMatchObject({ sets: 3, minutes: 55, km: 10.3 })
    expect(formatPace(sumCardio(sets).pace)).toBe('5:20')
  })

  it('weights heart rate by duration, and says how many minutes it covers', () => {
    // 10 min at 120 and 40 min at 160 is 152, not the 140 a flat average would report.
    expect(sumCardio(sets)).toMatchObject({ hr: 152, hrMinutes: 50 })
  })

  it('has no heart rate to report when none was recorded', () => {
    expect(sumCardio([{ min: 30, km: 5, done: true }])).toMatchObject({ hr: null, hrMinutes: 0 })
  })

  it('skips sets that were not completed', () => {
    expect(sumCardio([{ min: 30, km: 5, done: true }, { min: 30, km: 5, done: false }]))
      .toMatchObject({ sets: 1, minutes: 30, km: 5 })
  })

  it('carries the derived flag up from any set that was missing a distance', () => {
    expect(sumCardio([{ min: 30, km: 5, done: true }]).anyDistanceDerived).toBe(false)
    expect(sumCardio([{ min: 30, km: 5, done: true }, { min: 30, speed: 10, done: true }])
      .anyDistanceDerived).toBe(true)
  })

  it('has nothing to add up from an empty or absent list', () => {
    for (const value of [[], null, undefined, [{}, { done: true }]]) {
      expect(sumCardio(value)).toMatchObject({ sets: 0, minutes: 0, km: 0, pace: null, hr: null })
    }
  })
})

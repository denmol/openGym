import { describe, expect, it } from 'vitest'
import { pastTiming, historyBefore, rememberWorkoutWeights } from './backfill.js'
import { todayISO } from './format.js'
import { vi } from 'vitest'

it.each(['2024-02-29', '2026-03-29', '2026-10-25', '2026-12-31'])('keeps local day and exact elapsed duration on %s', day => {
  const r = pastTiming({ day, time: '23:30', minutes: 90 }, +new Date('2027-01-02T12:00:00'))
  expect(r.start).toBe(+new Date(day + 'T23:30:00'))
  expect(r.end - r.start).toBe(5400000)
  expect(new Date(r.end).getDate()).not.toBe(new Date(r.start).getDate())
})
it.each(['2026-02-29', '2026-04-31', '2026-00-12', '', 'not-a-day'])('rejects impossible day %s', day => {
  expect(pastTiming({ day, minutes: 60 })).toBeNull()
})
it.each(['24:00', '12:60', '', '9:30'])('rejects impossible clock %s', time => {
  expect(pastTiming({ day: '2026-10-20', time, minutes: 60 })).toBeNull()
})
it('accepts a completed session today but rejects a future finish', () => {
  const now = +new Date('2026-10-29T13:00:00')
  expect(pastTiming({ day: '2026-10-29', time: '12:00', minutes: 60 }, now)?.minutes).toBe(60)
  expect(pastTiming({ day: '2026-10-29', time: '12:00', minutes: 61 }, now)).toBeNull()
})
it('uses the local date close to midnight, even if UTC is a different day', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-10-29T00:05:00'))
    expect(todayISO()).toBe('2026-10-29')
    expect(pastTiming({ day: '2026-10-28', time: '23:55', minutes: 10 })?.minutes).toBe(10)
  } finally { vi.useRealTimers() }
})
describe.runIf(process.env.TZ === 'Europe/Stockholm')('Swedish DST', () => {
  it('requires an explicit UTC offset in the repeated autumn hour', () => {
    const past = { day: '2026-10-25', time: '02:30', minutes: 30 }
    const now = +new Date('2026-10-29T18:00:00')
    expect(pastTiming(past, now)).toBeNull()
    expect(pastTiming({ ...past, offset: -120 }, now)?.start).toBe(Date.parse('2026-10-25T00:30:00Z'))
    expect(pastTiming({ ...past, offset: -60 }, now)?.start).toBe(Date.parse('2026-10-25T01:30:00Z'))
  })
  it('rejects the nonexistent spring hour instead of shifting it to 03:30', () => {
    expect(pastTiming({ day: '2026-03-29', time: '02:30', minutes: 30 })).toBeNull()
  })
  it.each([
    ['2026-03-29', '2026-03-29T00:30:00.000Z', '2026-03-29T02:30:00.000Z'],
    ['2026-10-25', '2026-10-24T23:30:00.000Z', '2026-10-25T01:30:00.000Z']
  ])('counts 120 elapsed minutes through the clock change on %s', (day, start, end) => {
    const timing = pastTiming({ day, time: '01:30', minutes: 120 }, +new Date('2026-10-29T18:00:00'))
    expect(new Date(timing.start).toISOString()).toBe(start)
    expect(new Date(timing.end).toISOString()).toBe(end)
  })
})
it('excludes later sessions on the same day and un-dated defaults without mutating input', () => {
  const S = { workouts: [{ d: '2026-10-20', start: 30 }, { d: '2026-10-20', start: 10 }],
    exWeights: { old: { d: '2026-10-19', w: 40 }, same: { d: '2026-10-20', w: 80 }, unknown: { w: 90 } } }
  const before = structuredClone(S)
  const context = historyBefore(S, { d: '2026-10-20', start: 20, backdated: true })
  expect(context.workouts.map(w => w.start)).toEqual([10])
  expect(context.exWeights).toEqual({ old: { d: '2026-10-19', w: 40 } })
  expect(S).toEqual(before)
})
it('can establish a first historical working weight but never uses warm-up loads', () => {
  const S = { workouts: [], exWeights: {} }
  rememberWorkoutWeights(S, { d: '2026-10-20', backdated: true, entries: [{ id: 'a', sets: [{ done: true, w: 80, warm: true }, { done: true, w: 40 }] }] })
  expect(S.exWeights).toEqual({ a: { w: 40, d: '2026-10-20' } })
})

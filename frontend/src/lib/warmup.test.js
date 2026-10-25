// A set marked `warm` stays in the log but is not work: every reader that judges, totals or
// pre-fills from sets has to agree on that, or a warm-up quietly becomes a missed rep, a
// phantom "last time" or a tonnage it never was.
import { describe, expect, it } from 'vitest'
import { readSession, sessionsFor } from './progression.js'
import { lastEntryFor, bestWeightFor, workoutVolume, buildSets } from './history.js'
import { bestSetOf, e1rmSeries } from './onerm.js'
import { loadOfWorkouts, loadOfActive } from './muscles.js'
import { effortSummary } from './effort.js'

const BENCH = '0025'
const warm = { w: 20, r: 3, done: true, warm: true }
const work = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const entry = sets => ({ id: BENCH, target: { sets: 3, reps: 8, weight: 60 }, sets })
const workout = (d, sets) => ({ id: d, d, start: new Date(d + 'T12:00:00').getTime(), entries: [entry(sets)] })
const S = (...ws) => ({ workouts: ws, bodyweight: [], exWeights: {}, unit: 'kg', dayPlan: {}, routines: [], week: {} })

describe('warm-up sets', () => {
  it('do not turn a hit session into a miss', () => {
    const e = entry([warm, work(60, 8), work(60, 8), work(60, 8)])
    const s = readSession(e)
    expect(s.ok).toBe(true)
    expect(s.reps).toEqual([8, 8, 8])
    expect(s.weight).toBe(60)
  })

  it('do not stand in for a missing working set', () => {
    // three sets planned, two worked and one warm-up: still short
    expect(readSession(entry([warm, work(60, 8), work(60, 8)])).ok).toBe(false)
  })

  it('make no session at all when they are all that was done', () => {
    expect(sessionsFor(S(workout('2026-10-01', [warm])), BENCH)).toEqual([])
  })

  it('never become "last time", so the first working set is not pre-filled with the bar', () => {
    const st = S(workout('2026-10-01', [warm, work(60, 8), work(60, 8), work(60, 8)]))
    expect(lastEntryFor(st, BENCH).sets).toHaveLength(3)
    const built = buildSets(st, { id: BENCH, sets: 3, reps: 8, weight: 60 })
    expect(built.map(x => x.w)).toEqual([60, 60, 60])
    expect(lastEntryFor(S(workout('2026-10-01', [warm])), BENCH)).toBeNull()
  })

  it('are not your best weight, volume or estimated 1RM', () => {
    const heavyWarm = { w: 200, r: 1, done: true, warm: true }
    const w = workout('2026-10-01', [heavyWarm, work(60, 8)])
    expect(bestWeightFor(S(w), BENCH)).toBe(60)
    expect(workoutVolume(w)).toBe(480)
    expect(bestSetOf(w.entries[0]).w).toBe(60)
    expect(e1rmSeries(S(w), BENCH)[0].w).toBe(60)
  })

  it('do not count as sets for a muscle', () => {
    const w = workout('2026-10-01', [warm, warm, work(60, 8)])
    expect(loadOfWorkouts([w]).chest).toBe(1)
    expect(loadOfActive({ entries: w.entries }).chest).toBe(1)
  })

  it('do not count as rated sets', () => {
    const rated = { w: 20, r: 3, done: true, warm: true, rir: 5 }
    const w = workout('2026-10-01', [rated, work(60, 8, { rir: 2 })])
    expect(effortSummary(S(w), 0).rated).toBe(1)
  })

  it('leave an unmarked set exactly as it was', () => {
    expect(readSession(entry([work(60, 8), work(60, 8), work(60, 8)])).ok).toBe(true)
    expect(workoutVolume(workout('2026-10-01', [work(60, 8)]))).toBe(480)
  })
})

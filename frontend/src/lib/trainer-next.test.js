import { describe, it, expect } from 'vitest'
import { EXDB } from './exercises.js'
import { nextSession, nextRoutineFor, planItem, deloadAdvised } from './trainer-next.js'

const bench = EXDB.find(e => e.bp === 'chest' && e.eq === 'barbell').id
const squat = EXDB.find(e => e.bp === 'upper legs' && e.eq === 'barbell').id
const cardio = EXDB.find(e => e.bp === 'cardio').id

// 2026-10-26 is a Monday.
const routine = {
  id: 'r1', name: 'Push',
  ex: [
    { id: bench, sets: 4, reps: 8, weight: 60, mode: 'reps' },
    { id: squat, sets: 3, reps: 5, weight: 100, mode: 'reps' },
    { id: cardio, sets: 1, min: 20, speed: 8 }
  ]
}
const done = (d, id, weight, reps, n, target) => ({
  d, routineId: 'r1', start: new Date(d + 'T10:00:00').getTime(),
  entries: [{ id, target, sets: Array.from({ length: n }, () => ({ done: true, w: weight, r: reps })) }]
})
const S0 = { unit: 'kg', routines: [routine], week: { 1: 'r1' }, dayPlan: {}, workouts: [] }

describe('next session', () => {
  it('has nothing to say about the weight before anything is logged', () => {
    const s = nextSession(S0, '2026-10-26')
    expect(s.routine.id).toBe('r1')
    const b = s.items.find(i => i.id === bench)
    expect(b).toMatchObject({ kind: 'first', sets: 4, reps: 8, weight: 60 })
  })

  it('leaves cardio out', () => {
    expect(nextSession(S0, '2026-10-26').items.map(i => i.id)).not.toContain(cardio)
  })

  it('adds a step after a clean session, with the reason attached', () => {
    const S = { ...S0, workouts: [done('2026-10-19', bench, 60, 8, 4, { sets: 4, reps: 8, weight: 60 })] }
    const b = nextSession(S, '2026-10-26').items.find(i => i.id === bench)
    expect(b.kind).toBe('up')
    expect(b.weight).toBe(62.5)
    expect(Array.isArray(b.why)).toBe(true)
  })

  it('holds the weight after a miss', () => {
    const S = { ...S0, workouts: [done('2026-10-19', bench, 60, 6, 4, { sets: 4, reps: 8, weight: 60 })] }
    const b = nextSession(S, '2026-10-26').items.find(i => i.id === bench)
    expect(b).toMatchObject({ kind: 'hold', weight: 60 })
  })

  it('a lighter session halves the sets and keeps the weight that was handled', () => {
    const S = { ...S0, workouts: [done('2026-10-19', bench, 65, 8, 4, { sets: 4, reps: 8, weight: 60 })] }
    const s = nextSession(S, '2026-10-26', { deload: true })
    const b = s.items.find(i => i.id === bench)
    expect(b).toMatchObject({ kind: 'lighter', sets: 2, weight: 65 })
    expect(s.items.find(i => i.id === squat).sets).toBe(2)      // ceil(3 / 2)
    expect(s.deload).toBe(true)
  })

  it('never goes below one set when lightening', () => {
    const one = planItem(S0, routine, { id: bench, sets: 1, reps: 8, weight: 60 }, { deload: true })
    expect(one.sets).toBe(1)
  })

  it('knows when the trainer has advised a lighter week', () => {
    expect(deloadAdvised({ findings: [{ code: 'fatigue' }] })).toBe(true)
    expect(deloadAdvised({ findings: [{ code: 'block_long' }] })).toBe(true)
    expect(deloadAdvised({ findings: [{ code: 'stalled' }] })).toBe(false)
    expect(deloadAdvised(null)).toBe(false)
  })
})

describe('which routine is next', () => {
  it('fixed week: today when planned, otherwise the next planned day', () => {
    expect(nextRoutineFor(S0, '2026-10-26')).toMatchObject({ iso: '2026-10-26', today: true })
    expect(nextRoutineFor(S0, '2026-10-27')).toMatchObject({ iso: '2026-11-02', today: false })
  })

  it('fixed week: skips today once that routine is done', () => {
    const S = { ...S0, workouts: [{ d: '2026-10-26', routineId: 'r1', entries: [] }] }
    expect(nextRoutineFor(S, '2026-10-26').iso).toBe('2026-11-02')
  })

  it('a day override to rest is respected', () => {
    expect(nextRoutineFor({ ...S0, dayPlan: { '2026-10-26': 'rest' } }, '2026-10-26').iso).toBe('2026-11-02')
  })

  it('flexible week: the next in the rotation, whatever the weekday', () => {
    const S = { ...S0, flex: { on: true, perWeek: 3 } }
    expect(nextRoutineFor(S, '2026-10-29')).toMatchObject({ iso: '2026-10-29', today: true })
    expect(nextRoutineFor(S, '2026-10-29').routine.id).toBe('r1')
  })

  it('is null when nothing is planned', () => {
    expect(nextRoutineFor({ ...S0, routines: [], week: {} }, '2026-10-26')).toBe(null)
    expect(nextSession({ ...S0, routines: [], week: {} }, '2026-10-26')).toBe(null)
  })
})

import { describe, it, expect } from 'vitest'
import { flexOf, rotation, flexWeek } from './flex.js'

const R = [{ id: 'push' }, { id: 'pull' }, { id: 'legs' }]
const base = { routines: R, week: { 1: 'push', 3: 'pull', 5: 'legs' }, workouts: [] }
// 2026-10-26 is a Monday.
const W = (d, routineId) => ({ d, routineId })

describe('flex week', () => {
  it('is off unless switched on, and clamps the weekly goal', () => {
    expect(flexOf({}).on).toBe(false)
    expect(flexOf({ flex: { on: true, perWeek: 3 } })).toEqual({ on: true, perWeek: 3 })
    expect(flexOf({ flex: { on: true, perWeek: 40 } }).perWeek).toBe(7)
    expect(flexOf({ flex: { on: true, perWeek: 0 } }).perWeek).toBe(1)
    expect(flexOf({ flex: { on: true, perWeek: 'x' } }).perWeek).toBe(3)
  })

  it('rotates in the order the routines sit in the week, Monday first', () => {
    expect(rotation(base)).toEqual(['push', 'pull', 'legs'])
    expect(rotation({ routines: R, week: { 0: 'legs', 2: 'push' }, workouts: [] })).toEqual(['push', 'legs'])
  })

  it('falls back to the routines themselves when no weekdays are set', () => {
    expect(rotation({ routines: R, week: {} })).toEqual(['push', 'pull', 'legs'])
  })

  it('ignores a weekday that points at a deleted routine', () => {
    expect(rotation({ routines: R, week: { 1: 'gone', 2: 'pull' } })).toEqual(['pull'])
  })

  it('starts at the first routine and moves on after each session', () => {
    expect(flexWeek(base, '2026-10-27').next.id).toBe('push')
    expect(flexWeek({ ...base, workouts: [W('2026-10-26', 'push')] }, '2026-10-27').next.id).toBe('pull')
    expect(flexWeek({ ...base, workouts: [W('2026-10-25', 'legs')] }, '2026-10-27').next.id).toBe('push')
  })

  it('a skipped day never skips a routine', () => {
    // Pull was due Wednesday, was not done; Thursday the next session is still pull.
    const S = { ...base, workouts: [W('2026-10-26', 'push')] }
    expect(flexWeek(S, '2026-10-29').next.id).toBe('pull')
  })

  it('counts the sessions in the Monday-based week and when the goal is met', () => {
    const S = { ...base, flex: { on: true, perWeek: 2 }, workouts: [W('2026-10-19', 'push'), W('2026-10-26', 'push'), W('2026-10-28', 'pull')] }
    const w = flexWeek(S, '2026-10-29')
    expect(w).toMatchObject({ perWeek: 2, done: 2, left: 0, met: true })
    expect(flexWeek({ ...S, workouts: [W('2026-10-26', 'push')] }, '2026-10-29')).toMatchObject({ done: 1, left: 1, met: false })
  })

  it('a freestyle session does not disturb the rotation', () => {
    const S = { ...base, workouts: [W('2026-10-26', 'push'), W('2026-10-27', null)] }
    expect(flexWeek(S, '2026-10-28').next.id).toBe('pull')
  })

  it('has no next session when there are no routines', () => {
    expect(flexWeek({ routines: [], week: {}, workouts: [] }, '2026-10-27').next).toBe(null)
  })
})

import { it, expect } from 'vitest'
import { dayActivity } from './nutrition-activity.js'
import { buildActivityWorkout } from './cardio.js'

const D = '2026-10-28'
const walk = buildActivityWorkout({ id: 'w1', exId: 'act-walk', name: 'Walk', day: D, endMs: 1e12, min: 40, km: 3.4 })
const strength = {
  id: 'w2', d: D, start: 1e12, end: 1e12 + 60 * 60000, name: 'Push',
  entries: [{ id: 'bench', sets: [{ done: true, r: 5, w: 50 }], target: {} }]
}
const base = { bodyweight: [{ d: D, w: 70, u: 'kg' }] }

it('one row per session with a total', () => {
  const r = dayActivity({ ...base, workouts: [walk, strength] }, D)
  expect(r.rows).toHaveLength(2)
  expect(r.rows[0]).toMatchObject({ minutes: 40, kcal: 120 })
  expect(r.rows[1].minutes).toBe(60)
  expect(r.total).toBe(r.rows[0].kcal + r.rows[1].kcal)
})
it('other dates are ignored', () => {
  expect(dayActivity({ ...base, workouts: [walk] }, '2026-10-27').rows).toEqual([])
})
it('no weight gives minutes but no numbers', () => {
  const r = dayActivity({ bodyweight: [], workouts: [walk] }, D)
  expect(r.rows[0].kcal).toBeNull()
  expect(r.total).toBeNull()
})

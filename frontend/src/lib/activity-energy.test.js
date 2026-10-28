import { it, expect } from 'vitest'
import { activityKcal, metFor } from './activity-energy.js'

it('walking MET follows speed', () => {
  expect(metFor('walk', 4)).toBe(3.0)
  expect(metFor('walk', 5.2)).toBe(3.5)
  expect(metFor('walk', 6.5)).toBe(5.0)
  expect(metFor('walk', 2)).toBe(3.0)
})
it('subtracts rest and rounds to tens', () => {
  // 40 min at 5 km/h → MET 3.5; (3.5-1) × 70 × 2/3 = 116.7 → 120
  expect(activityKcal({ kind: 'walk', minutes: 40, km: 3.4, kg: 70 })).toBe(120)
})
it('needs time and weight', () => {
  expect(activityKcal({ kind: 'walk', minutes: 0, kg: 70 })).toBeNull()
  expect(activityKcal({ kind: 'walk', minutes: 30, kg: null })).toBeNull()
})
it('running is higher than walking and strength uses 3.5', () => {
  expect(activityKcal({ kind: 'run', minutes: 30, km: 4.5, kg: 70 })).toBeGreaterThan(activityKcal({ kind: 'walk', minutes: 30, km: 2.5, kg: 70 }))
  expect(activityKcal({ kind: 'strength', minutes: 60, kg: 80 })).toBe(200)
})

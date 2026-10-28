import { describe, it, expect } from 'vitest'
import { ACTIVITY_IDS, EXIDX, allExercises, isActivity, isCardio, registerActivities } from './exercises.js'
import { modeOf } from './history.js'

describe('built-in activities', () => {
  it('are cardio exercises, so every cardio rule applies to them', () => {
    expect(ACTIVITY_IDS).toEqual(['act-walk', 'act-run', 'act-bike', 'act-swim', 'act-hike', 'act-other'])
    for (const id of ACTIVITY_IDS) {
      expect(isActivity(id)).toBe(true)
      expect(isCardio(id)).toBe(true)
      expect(modeOf({ id })).toBe('cardio')
      expect(EXIDX[id].n).toBeTruthy()
    }
    expect(isActivity('0001')).toBe(false)
  })
  it('are offered in the picker, after the user\'s own exercises and before the dataset', () => {
    const all = allExercises({ customEx: [{ id: 'c1', n: 'Mine' }] })
    expect(all.slice(0, 2).map(e => e.id)).toEqual(['c1', 'act-walk'])
    expect(all.findIndex(e => e.id === 'act-other')).toBeLessThan(all.findIndex(e => e.id === '0001'))
  })
  it('can be registered again without duplicating anything', () => {
    const before = allExercises({}).length
    registerActivities(); registerActivities()
    expect(allExercises({}).length).toBe(before)
  })
  it('carry no media or instructions, and are not editable like custom exercises', () => {
    const e = EXIDX['act-walk']
    expect(e.gif).toBeUndefined()
    expect(e.img).toBeUndefined()
    expect(e.custom).toBeUndefined()
    expect(e.st).toEqual([])
  })
})

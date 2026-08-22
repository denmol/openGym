import { describe, it, expect } from 'vitest'
import { searchFoods, allFoods, foodOf, foodMap, hasFoodDb, NUTRIENTS } from './foods.js'

// The bundled catalogue is empty until scripts/build-foods.mjs has run, so these exercise
// the path every instance has on day one: the user's own foods.
const st = {
  myFoods: [
    { id: 'u1', n: 'Min müsli', own: true, per100: { kcal: 400, carb: 60 } },
    { id: 'u2', n: 'Kökött', own: true, per100: { kcal: 250, carb: 0 } },
    { id: 'u3', n: 'Mjölkchoklad', own: true, per100: { kcal: 540, carb: 57 } },
    { id: 'u4', n: 'Mjölk', own: true, per100: { kcal: 60, carb: 4.6 } }
  ]
}

describe('the catalogue when it has not been built', () => {
  it('says so plainly rather than pretending', () => {
    expect(hasFoodDb()).toBe(false)
  })

  it('still serves the user their own foods', () => {
    expect(allFoods(st)).toHaveLength(4)
    expect(foodOf(st, 'u1').n).toBe('Min müsli')
  })

  it('is safe on a profile that has nothing at all', () => {
    expect(allFoods({})).toEqual([])
    expect(allFoods(null)).toEqual([])
    expect(foodOf({}, 'u1')).toBeNull()
    expect(foodMap(null)).toEqual({})
  })
})

describe('searchFoods', () => {
  it('finds by substring', () => {
    expect(searchFoods(st, 'müsli').map(f => f.id)).toEqual(['u1'])
  })

  it('folds Swedish vowels, so a phone keyboard is enough', () => {
    expect(searchFoods(st, 'kokott').map(f => f.id)).toEqual(['u2'])
    expect(searchFoods(st, 'mjolk').map(f => f.id)).toContain('u4')
  })

  it('puts the plain thing above the compound', () => {
    // "mjölk" must find milk before milk chocolate.
    expect(searchFoods(st, 'mjölk')[0].id).toBe('u4')
  })

  it('requires every word to match', () => {
    expect(searchFoods(st, 'min müsli').map(f => f.id)).toEqual(['u1'])
    expect(searchFoods(st, 'min kött')).toEqual([])
  })

  it('returns nothing for an empty query rather than everything', () => {
    expect(searchFoods(st, '')).toEqual([])
    expect(searchFoods(st, '   ')).toEqual([])
  })

  it('honours the limit', () => {
    expect(searchFoods(st, 'm', 2)).toHaveLength(2)
  })

  it('does not choke on regex characters typed into the box', () => {
    expect(() => searchFoods(st, 'mjölk (3%)')).not.toThrow()
    expect(() => searchFoods(st, '*')).not.toThrow()
  })
})

describe('the nutrient set', () => {
  it('leads with the two numbers this app is about', () => {
    expect(NUTRIENTS[0]).toBe('kcal')
    expect(NUTRIENTS[1]).toBe('carb')
  })
})

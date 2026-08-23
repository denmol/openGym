import { describe, it, expect } from 'vitest'
import { searchFoods, allFoods, foodOf, foodMap, hasFoodDb, NUTRIENTS } from './foods.js'

// The bundled catalogue is generated and untracked: empty on a fresh clone, 2 600 foods on a
// machine that ran scripts/build-foods.mjs. These assert what holds either way — asserting an
// empty catalogue would pass on CI and fail on exactly the machines that built the thing.
const st = {
  myFoods: [
    { id: 'u1', n: 'Min müsli', own: true, per100: { kcal: 400, carb: 60 } },
    { id: 'u2', n: 'Kökött', own: true, per100: { kcal: 250, carb: 0 } },
    { id: 'u3', n: 'Mjölkchoklad', own: true, per100: { kcal: 540, carb: 57 } },
    { id: 'u4', n: 'Mjölk', own: true, per100: { kcal: 60, carb: 4.6 } }
  ]
}

// However many foods the bundled database holds on this machine, including none.
const BUNDLED = allFoods({}).length

// Own foods carry own: true, which is how a search result can be told apart from a bundled
// one without knowing whether there are any bundled ones.
const own = rows => rows.filter(f => f.own).map(f => f.id)

describe('the catalogue', () => {
  it('says plainly which of the two states it is in', () => {
    expect(hasFoodDb()).toBe(BUNDLED > 0)
  })

  it('serves the user their own foods, ahead of whatever is bundled', () => {
    expect(allFoods(st)).toHaveLength(BUNDLED + 4)
    expect(allFoods(st).slice(0, 4).map(f => f.id)).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect(foodOf(st, 'u1').n).toBe('Min müsli')
  })

  it('is safe on a profile that has nothing at all', () => {
    expect(allFoods({})).toHaveLength(BUNDLED)
    expect(allFoods(null)).toHaveLength(BUNDLED)
    expect(foodOf({}, 'u1')).toBeNull()
    expect(Object.keys(foodMap(null))).toHaveLength(BUNDLED)
  })
})

describe('searchFoods', () => {
  it('finds by substring', () => {
    expect(own(searchFoods(st, 'müsli'))).toEqual(['u1'])
  })

  it('folds Swedish vowels, so a phone keyboard is enough', () => {
    expect(own(searchFoods(st, 'kokott'))).toEqual(['u2'])
    expect(searchFoods(st, 'mjolk', 200).map(f => f.id)).toContain('u4')
  })

  it('puts the plain thing above the compound', () => {
    // "mjölk" must find milk before milk chocolate. Asked with room for the bundled
    // matches too, so the ranking is what decides the order and not the result cap.
    expect(own(searchFoods(st, 'mjölk', 200))).toEqual(['u4', 'u3'])
  })

  it('requires every word to match', () => {
    expect(own(searchFoods(st, 'min müsli'))).toEqual(['u1'])
    expect(own(searchFoods(st, 'min kött', 200))).toEqual([])
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

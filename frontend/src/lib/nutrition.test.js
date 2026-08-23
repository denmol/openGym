import { describe, it, expect } from 'vitest'
import {
  totalsOf, nutrientTotal, mealTotals, mealsOn, dayTotals, hasMeals,
  scaleItems, newMeal, kindForNow, bmr, MEAL_KINDS
} from './nutrition.js'

// Per 100 g, rounded the way a label is.
const foods = {
  oat: { id: 'oat', n: 'Havregryn', per100: { kcal: 370, carb: 58, sugar: 1, prot: 13, fat: 7, sat: 1.3, fib: 10, salt: 0 } },
  milk: { id: 'milk', n: 'Mjölk 3%', per100: { kcal: 60, carb: 4.6, sugar: 4.6, prot: 3.4, fat: 3, sat: 1.9, fib: 0, salt: 0.1 } },
  banana: { id: 'banana', n: 'Banan', per100: { kcal: 92, carb: 20, sugar: 15, prot: 1.1, fat: 0.3, sat: 0.1, fib: 1.6, salt: 0 } }
}

describe('totalsOf', () => {
  it('scales per-100-g values by the grams eaten', () => {
    // 60 g oats: 58 g carb per 100 → 34.8
    expect(totalsOf([{ fid: 'oat', g: 60 }], foods).carb).toBe(34.8)
    expect(totalsOf([{ fid: 'oat', g: 60 }], foods).kcal).toBe(222)
  })

  it('adds several foods up', () => {
    const t = totalsOf([{ fid: 'oat', g: 60 }, { fid: 'milk', g: 200 }, { fid: 'banana', g: 100 }], foods)
    expect(t.carb).toBe(64.0)      // 34.8 + 9.2 + 20
    expect(t.prot).toBe(15.7)      // 7.8 + 6.8 + 1.1
    expect(t.complete.carb).toBe(true)
    expect(t.complete.salt).toBe(true) // a known zero is still complete
  })

  it('keeps one decimal and no more', () => {
    const t = totalsOf([{ fid: 'milk', g: 33 }], foods)
    expect(t.carb).toBe(1.5)
    expect(Number.isInteger(t.carb * 10)).toBe(true)
  })

  it('keeps known values but marks totals incomplete for an unknown food', () => {
    const t = totalsOf([{ fid: 'oat', g: 60 }, { fid: 'gone', g: 100 }], foods)
    expect(t.carb).toBe(34.8)
    expect(t.complete.carb).toBe(false)
    expect(t.complete.kcal).toBe(false)
  })

  it('keeps empty totals complete but marks missing, null and invalid grams incomplete', () => {
    const empty = totalsOf(null, foods)
    expect(empty.carb).toBe(0)
    expect(empty.complete.carb).toBe(true)

    for (const g of [undefined, null, 'x', true]) {
      const t = totalsOf([{ fid: 'oat', g: 60 }, { fid: 'banana', g }], foods)
      expect(t.carb).toBe(34.8)
      expect(t.complete.carb).toBe(false)
    }

    const missingCatalogue = totalsOf([{ fid: 'oat', g: 60 }], null)
    expect(missingCatalogue.carb).toBe(0)
    expect(missingCatalogue.complete.carb).toBe(false)
  })

  it('tracks completeness per nutrient without turning missing or null into zero', () => {
    const partialFoods = {
      ...foods,
      partial: { per100: { kcal: 100, carb: 10, prot: null, fat: 2 } }
    }
    const t = totalsOf([{ fid: 'oat', g: 60 }, { fid: 'partial', g: 100 }], partialFoods)

    expect(t.carb).toBe(44.8)
    expect(t.prot).toBe(7.8)
    expect(t.fat).toBe(6.2)
    expect(t.complete.carb).toBe(true)
    expect(t.complete.prot).toBe(false)
    expect(t.complete.sugar).toBe(false)
    expect(nutrientTotal(t, 'carb')).toBe(44.8)
    expect(nutrientTotal(t, 'prot')).toBeNull()
  })

  it('rejects boolean nutrient values instead of treating true as one', () => {
    const t = totalsOf([{ fid: 'bad', g: 100 }], {
      bad: { per100: { kcal: 100, carb: true } }
    })
    expect(t.kcal).toBe(100)
    expect(t.complete.kcal).toBe(true)
    expect(t.carb).toBe(0)
    expect(t.complete.carb).toBe(false)
  })
})

describe('the day', () => {
  const st = {
    meals: [
      { d: '2026-08-22', t: '12:30', kind: 'lunch', items: [{ fid: 'banana', g: 100 }] },
      { d: '2026-08-22', t: '07:15', kind: 'breakfast', items: [{ fid: 'oat', g: 60 }] },
      { d: '2026-08-21', t: '08:00', kind: 'breakfast', items: [{ fid: 'oat', g: 100 }] }
    ]
  }

  it('returns one date in the order things were eaten', () => {
    expect(mealsOn(st, '2026-08-22').map(m => m.t)).toEqual(['07:15', '12:30'])
  })

  it('adds the day up across meals', () => {
    expect(dayTotals(st, '2026-08-22', foods).carb).toBe(54.8)   // 34.8 + 20
  })

  it('tells an empty day from a zero one', () => {
    expect(hasMeals(st, '2026-08-22')).toBe(true)
    expect(hasMeals(st, '2026-08-20')).toBe(false)
    expect(dayTotals(st, '2026-08-20', foods).carb).toBe(0)
  })

  it('copes with a profile that has never logged anything', () => {
    expect(mealsOn({}, '2026-08-22')).toEqual([])
    expect(dayTotals({}, '2026-08-22', foods).kcal).toBe(0)
  })
})

describe('mealTotals', () => {
  it('reads one meal', () => {
    expect(mealTotals({ items: [{ fid: 'banana', g: 120 }] }, foods).carb).toBe(24)
  })
  it('is safe on a meal with nothing in it', () => {
    expect(mealTotals(null, foods).carb).toBe(0)
    expect(mealTotals({}, foods).carb).toBe(0)
  })
})

describe('scaleItems', () => {
  it('scales grams and rounds to whole ones', () => {
    expect(scaleItems([{ fid: 'oat', g: 60 }], 0.5)).toEqual([{ fid: 'oat', g: 30 }])
    expect(scaleItems([{ fid: 'oat', g: 55 }], 1.5)).toEqual([{ fid: 'oat', g: 83 }])
  })

  it('never scales a food down to nothing', () => {
    expect(scaleItems([{ fid: 'milk', g: 2 }], 0.1)[0].g).toBe(1)
  })

  it('leaves the items alone at scale 1', () => {
    expect(scaleItems([{ fid: 'oat', g: 60 }], 1)).toEqual([{ fid: 'oat', g: 60 }])
  })
})

describe('newMeal', () => {
  it('drops items with no food or no weight', () => {
    const m = newMeal({ items: [{ fid: 'oat', g: 60 }, { fid: 'milk', g: 0 }, { g: 100 }] })
    expect(m.items).toEqual([{ fid: 'oat', g: 60 }])
  })

  it('stamps today and a time when not told otherwise', () => {
    const m = newMeal({})
    expect(m.d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(m.t).toMatch(/^\d{2}:\d{2}$/)
  })

  it('honours an explicit date, time and kind', () => {
    const m = newMeal({ d: '2026-01-02', t: '09:05', kind: 'snack', items: [] })
    expect(m).toMatchObject({ d: '2026-01-02', t: '09:05', kind: 'snack' })
  })

  it('falls back to the clock for an unknown kind', () => {
    expect(MEAL_KINDS).toContain(newMeal({ kind: 'brunch' }).kind)
  })

  it('keeps a note only when there is one', () => {
    expect(newMeal({}).note).toBeUndefined()
    expect(newMeal({ note: 'ute' }).note).toBe('ute')
  })
})

describe('kindForNow', () => {
  const at = h => kindForNow(new Date(2026, 0, 1, h, 0))
  it('guesses by the clock', () => {
    expect(at(7)).toBe('breakfast')
    expect(at(12)).toBe('lunch')
    expect(at(18)).toBe('dinner')
    expect(at(22)).toBe('snack')
  })
})

describe('bmr', () => {
  it('matches Mifflin–St Jeor by hand', () => {
    // 10·70 + 6.25·175 − 5·30 + 5 = 1648.75 → 1649
    expect(bmr({ sex: 'male', age: 30, heightCm: 175, weightKg: 70 })).toBe(1649)
    // same body, female: −161 instead of +5
    expect(bmr({ sex: 'female', age: 30, heightCm: 175, weightKg: 70 })).toBe(1483)
  })

  it('returns null rather than a number when a field is missing', () => {
    expect(bmr({ sex: 'female', age: null, heightCm: 165, weightKg: 62 })).toBeNull()
    expect(bmr({ age: 30, heightCm: 175, weightKg: 70 })).toBeNull()
    expect(bmr({})).toBeNull()
  })

  it('rejects unknown sex and non-finite measurements', () => {
    expect(bmr({ sex: 'other', age: 30, heightCm: 175, weightKg: 70 })).toBeNull()
    expect(bmr({ sex: 'male', age: 30, heightCm: Infinity, weightKg: 70 })).toBeNull()
  })
})

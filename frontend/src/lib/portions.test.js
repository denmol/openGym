import { describe, it, expect } from 'vitest'
import {
  VOLUME, volumeGrams, densityFor, suggestedFor, newPortion, ownPortionsFor,
  unitsFor, unitById, gramsOf, lastAmounts, defaultAmount, amountLabel
} from './portions.js'

const egg = { id: 'e1', n: 'Ägg, hönsägg, hela, färska', per100: { kcal: 143, carb: 0.3 } }
const crisp = { id: 'c1', n: 'Knäckebröd, råg', per100: { kcal: 330, carb: 60 } }
const bread = { id: 'b1', n: 'Bröd, rågbröd, mjukt', per100: { kcal: 240, carb: 43 } }
const milk = { id: 'm1', n: 'Mjölk, 3% fett', per100: { kcal: 60, carb: 4.6 } }
const oil = { id: 'o1', n: 'Rapsolja', per100: { kcal: 900, carb: 0 }, density: 0.92 }
const mince = { id: 'x1', n: 'Nötfärs, 10% fett', per100: { kcal: 180, carb: 0 } }

describe('kitchen measures', () => {
  it('uses the defined millilitres, not a rounded guess', () => {
    expect(VOLUME).toEqual({ dl: 100, msk: 15, tsk: 5, krm: 1 })
  })

  it('assumes water for a food with no density of its own', () => {
    const juice = { id: 'j', n: 'Apelsinjuice' }
    expect(volumeGrams('dl', juice)).toBe(100)
    expect(volumeGrams('msk', juice)).toBe(15)
    expect(volumeGrams('tsk', juice)).toBe(5)
  })

  it('knows milk is not quite water', () => {
    expect(volumeGrams('dl', milk)).toBe(103)
  })

  it('follows a density where one is known', () => {
    expect(volumeGrams('msk', oil)).toBe(14)      // 15 ml × 0.92
    expect(volumeGrams('dl', oil)).toBe(92)
  })

  it('ignores a density that makes no sense', () => {
    expect(volumeGrams('dl', { density: 0 })).toBe(100)
    expect(volumeGrams('dl', { density: -1 })).toBe(100)
    expect(volumeGrams('dl', { density: 'thick' })).toBe(100)
  })

  it('is nothing for a unit that is not a volume', () => {
    expect(volumeGrams('st', milk)).toBeNull()
  })
})

describe('densityFor', () => {
  it('reads a density off the food name where water would be wrong', () => {
    expect(densityFor({ n: 'Rapsolja' })).toMatchObject({ d: 0.92 })
    expect(densityFor({ n: 'Honung' })).toMatchObject({ d: 1.42 })
    expect(densityFor({ n: 'Mjölk, 3% fett' })).toMatchObject({ d: 1.03 })
  })

  it('assumes water for anything else, and says that is what it did', () => {
    expect(densityFor({ n: 'Nötfärs' })).toMatchObject({ d: 1, water: true })
    expect(densityFor(null)).toMatchObject({ d: 1, water: true })
  })

  it('lets the food overrule the table', () => {
    expect(densityFor({ n: 'Rapsolja', density: 0.9 })).toMatchObject({ d: 0.9, own: true })
  })

  it('flags a packing figure as the loose thing it is', () => {
    expect(densityFor({ n: 'Strösocker' }).vary).toBe(true)
    expect(densityFor({ n: 'Honung' }).vary).toBeFalsy()
  })

  it('gives one spoon one weight, whichever measure asks', () => {
    // The bug this replaced: a table of spoon weights beside a density, disagreeing.
    const o = { id: 'o', n: 'Olivolja' }
    expect(volumeGrams('msk', o)).toBe(14)
    expect(volumeGrams('dl', o)).toBe(92)
    expect(unitsFor({}, o).filter(u => u.n === 'msk')).toHaveLength(1)
  })
})

describe('suggestedFor', () => {
  it('finds the everyday ones', () => {
    expect(suggestedFor(egg)).toMatchObject({ n: 'st', g: 58, suggested: true })
    expect(suggestedFor(bread)).toMatchObject({ n: 'skiva', g: 35 })
    // Oil is measured, not counted, so it gets a density and no suggested portion.
    expect(suggestedFor(oil)).toBeNull()
  })

  it('does not read knäckebröd as bröd', () => {
    // A crispbread slice and a rye slice differ by a factor of three and a half.
    expect(suggestedFor(crisp).g).toBe(10)
    expect(suggestedFor(bread).g).toBe(35)
  })

  it('flags the ones that vary too much to trust', () => {
    expect(suggestedFor(bread).vary).toBe(true)
    expect(suggestedFor(egg).vary).toBe(false)
  })

  it('suggests nothing rather than something for a food it does not know', () => {
    expect(suggestedFor(mince)).toBeNull()
    expect(suggestedFor(null)).toBeNull()
    expect(suggestedFor({ n: '' })).toBeNull()
  })

  it('matches a word, not a fragment inside another word', () => {
    // "lägga" contains "ägg" but is not one.
    expect(suggestedFor({ id: 'z', n: 'Inlagd gurka' })).toBeNull()
  })

  it('reads a Swedish compound from its tail, where the head of the word is', () => {
    expect(densityFor({ n: 'Solrosolja' })).toMatchObject({ d: 0.92 })
    expect(densityFor({ n: 'Filmjölk 3%' })).toMatchObject({ d: 1.03 })
    expect(suggestedFor({ id: 'z', n: 'Surdegsbröd' })).toMatchObject({ n: 'skiva' })
  })

  it('does not read a short keyword out of the tail of another word', () => {
    // "fil" is a soured milk and also the end of "filé".
    expect(densityFor({ n: 'Oxfilé' })).toMatchObject({ water: true })
    expect(densityFor({ n: 'Fil, 3% fett' })).toMatchObject({ d: 1.03 })
  })
})

describe('newPortion', () => {
  it('takes a name and a weight', () => {
    expect(newPortion({ fid: 'e1', n: 'st', g: 61 })).toMatchObject({ fid: 'e1', n: 'st', g: 61 })
  })

  it('rounds to whole grams', () => {
    expect(newPortion({ fid: 'e1', n: 'st', g: 60.6 }).g).toBe(61)
  })

  it('refuses what cannot be a portion', () => {
    expect(newPortion({ fid: 'e1', n: '', g: 60 })).toBeNull()
    expect(newPortion({ fid: 'e1', n: 'st', g: 0 })).toBeNull()
    expect(newPortion({ fid: 'e1', n: 'st', g: -5 })).toBeNull()
    expect(newPortion({ fid: 'e1', n: 'st', g: 9000 })).toBeNull()
    expect(newPortion({ n: 'st', g: 60 })).toBeNull()
    expect(newPortion({})).toBeNull()
  })
})

describe('unitsFor', () => {
  const S = { portions: [{ id: 'p1', fid: 'e1', n: 'st', g: 61 }, { id: 'p2', fid: 'b1', n: 'brödskiva', g: 42 }] }

  it('always offers grams first', () => {
    expect(unitsFor(S, mince)[0]).toMatchObject({ id: 'g', base: true })
  })

  it('puts what the user weighed ahead of the kitchen measures', () => {
    const u = unitsFor(S, egg).map(x => x.n)
    expect(u.indexOf('st')).toBeLessThan(u.indexOf('dl'))
  })

  it('drops the suggestion once the same unit has been weighed', () => {
    // The user weighed their own egg at 61 g; showing 58 g beside it would be a puzzle.
    const st = unitsFor(S, egg).filter(x => x.n === 'st')
    expect(st).toHaveLength(1)
    expect(st[0]).toMatchObject({ g: 61 })
    expect(st[0].suggested).toBeUndefined()
  })

  it('keeps the suggestion when the weighed portion is a different unit', () => {
    const names = unitsFor(S, bread).map(x => x.n)
    expect(names).toContain('brödskiva')
    expect(names).toContain('skiva')
  })

  it('offers the kitchen measures at the food’s own density', () => {
    expect(unitsFor(S, oil).find(u => u.n === 'msk')).toMatchObject({ g: 14 })
  })

  it('survives a food with nothing to say', () => {
    expect(unitsFor({}, null)).toHaveLength(1)
    expect(ownPortionsFor(null, 'e1')).toEqual([])
  })
})

describe('unitById', () => {
  const S = { portions: [{ id: 'p1', fid: 'e1', n: 'st', g: 61 }] }

  it('finds one', () => {
    expect(unitById(S, egg, 'p1')).toMatchObject({ g: 61 })
  })

  it('falls back to grams for a portion that has been deleted', () => {
    expect(unitById(S, egg, 'p-gone')).toMatchObject({ id: 'g', g: 1 })
  })
})

describe('gramsOf', () => {
  const st = { id: 'p1', n: 'st', g: 58 }

  it('multiplies out', () => {
    expect(gramsOf(st, 2)).toBe(116)
    expect(gramsOf(st, 0.5)).toBe(29)
  })

  it('rounds to whole grams', () => {
    expect(gramsOf({ g: 13 }, 1.5)).toBe(20)      // 19.5
  })

  it('never rounds a real amount away to nothing', () => {
    expect(gramsOf({ g: 1 }, 0.4)).toBe(1)
  })

  it('is zero for nothing at all', () => {
    expect(gramsOf(st, 0)).toBe(0)
    expect(gramsOf(st, -1)).toBe(0)
    expect(gramsOf(st, 'two')).toBe(0)
    expect(gramsOf(null, 2)).toBe(0)
  })
})

describe('lastAmounts', () => {
  const S = {
    meals: [
      { d: '2026-08-20', t: '08:00', items: [{ fid: 'e1', g: 116, u: 'p1', q: 2 }] },
      { d: '2026-08-22', t: '07:30', items: [{ fid: 'e1', g: 174, u: 'p1', q: 3 }, { fid: 'm1', g: 200 }] },
      { d: '2026-08-21', t: '12:00', items: [{ fid: 'e1', g: 58, u: 'p1', q: 1 }] }
    ]
  }

  it('remembers the most recent amount, by when it was eaten', () => {
    // Logged out of order in the array; the 22nd is still the latest.
    expect(lastAmounts(S).e1).toEqual({ g: 174, u: 'p1', q: 3 })
  })

  it('treats a plain gram entry as grams', () => {
    expect(lastAmounts(S).m1).toEqual({ g: 200, u: 'g', q: 200 })
  })

  it('is empty for a profile that has logged nothing', () => {
    expect(lastAmounts({})).toEqual({})
    expect(lastAmounts(null)).toEqual({})
  })
})

describe('defaultAmount', () => {
  const S = { portions: [{ id: 'p1', fid: 'e1', n: 'st', g: 61 }] }

  it('opens at what you had last time', () => {
    const d = defaultAmount(S, egg, { e1: { g: 122, u: 'p1', q: 2 } })
    expect(d.q).toBe(2)
    expect(d.unit.id).toBe('p1')
  })

  it('falls back to the grams when that portion is gone', () => {
    const d = defaultAmount(S, egg, { e1: { g: 122, u: 'p-gone', q: 2 } })
    expect(d.unit.id).toBe('g')
    expect(d.q).toBe(122)
  })

  it('opens at one of whatever the food is counted in, before it has been logged', () => {
    const d = defaultAmount(S, egg, {})
    expect(d.q).toBe(1)
    expect(d.unit.n).toBe('st')
  })

  it('uses the suggestion for a food with nothing weighed yet', () => {
    expect(defaultAmount({}, bread, {}).unit).toMatchObject({ n: 'skiva', g: 35 })
  })

  it('falls back to 100 g only for a food that is not counted in anything', () => {
    const d = defaultAmount({}, mince, {})
    expect(d.unit.id).toBe('g')
    expect(d.q).toBe(100)
  })
})

describe('amountLabel', () => {
  it('shows the count and the grams it came to', () => {
    expect(amountLabel({ g: 116, u: 'p1', q: 2 }, 'st')).toBe('2 st (116 g)')
  })

  it('shows grams alone when grams is what was entered', () => {
    expect(amountLabel({ g: 200 }, 'g')).toBe('200 g')
    expect(amountLabel({ g: 200, u: 'g', q: 200 }, 'g')).toBe('200 g')
  })

  it('does not print a silly number of decimals', () => {
    expect(amountLabel({ g: 29, u: 'p1', q: 0.5 }, 'st')).toBe('0.5 st (29 g)')
  })

  it('is safe on nothing', () => {
    expect(amountLabel(null, 'st')).toBe('')
  })
})

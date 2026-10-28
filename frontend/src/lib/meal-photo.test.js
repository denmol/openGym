import { describe, it, expect } from 'vitest'
import { fitSize, matchCatalogue, foodFromEstimate } from './meal-photo.js'

describe('fitSize', () => {
  it('scales the long edge down to the limit and keeps the proportions', () => {
    expect(fitSize(4032, 3024)).toEqual({ w: 1024, h: 768 })
    expect(fitSize(3024, 4032)).toEqual({ w: 768, h: 1024 })
  })
  it('never scales up', () => {
    expect(fitSize(640, 480)).toEqual({ w: 640, h: 480 })
  })
  it('survives nonsense', () => {
    expect(fitSize(0, 100)).toEqual({ w: 0, h: 0 })
    expect(fitSize(NaN, 5)).toEqual({ w: 0, h: 0 })
  })
})

// Made-up names, so the tests do not depend on what the bundled food catalogue happens to hold.
const S = { myFoods: [{ id: 'own1', n: 'Zyxgröt special', own: true, per100: { kcal: 90, carb: 14 } }] }

describe('matchCatalogue', () => {
  it('uses the user\'s own food when the name matches', () => {
    const [r] = matchCatalogue(S, [{ name: 'Zyxgröt', search: 'zyxgrot', grams: 250, per100: { kcal: 70 } }])
    expect(r.source).toBe('own')
    expect(r.food.id).toBe('own1')
    expect(r.grams).toBe(250)
  })
  it('keeps the model\'s estimate, marked as such, when nothing matches', () => {
    const [r] = matchCatalogue(S, [{ name: 'Okänd rätt', search: 'zzzzqq', grams: 180, per100: { kcal: 120, carb: 10 } }])
    expect(r.source).toBe('ai')
    expect(r.food).toBeNull()
    expect(r.per100).toEqual({ kcal: 120, carb: 10 })
  })
  it('does not match in the middle of a word', () => {
    const T = { myFoods: [{ id: 'x', n: 'Qqlaxx special', own: true, per100: { kcal: 1 } }] }
    const [r] = matchCatalogue(T, [{ name: 'Laxx', search: 'laxx', grams: 100, per100: { kcal: 200 } }])
    expect(r.source).toBe('ai')
  })
  it('folds å, ä and ö like the search box does', () => {
    const U = { myFoods: [{ id: 'k', n: 'Kåttboll zzq', own: true, per100: { kcal: 220 } }] }
    const [r] = matchCatalogue(U, [{ name: 'Kåttboll', search: 'kattboll zzq', grams: 150, per100: {} }])
    expect(r.food.id).toBe('k')
  })
})

describe('foodFromEstimate', () => {
  it('becomes an own food marked as coming from a photo', () => {
    const f = foodFromEstimate({ name: ' Pasta ', asked: 'Pasta', per100: { kcal: 150, carb: 30, prot: 5 } }, 'ai1')
    expect(f).toEqual({ id: 'ai1', n: 'Pasta', own: true, source: 'ai-photo', per100: { kcal: 150, carb: 30, prot: 5 } })
  })
  it('refuses an estimate with neither calories nor carbs', () => {
    expect(foodFromEstimate({ name: 'X', asked: 'X', per100: { prot: 3 } }, 'a')).toBeNull()
  })
})

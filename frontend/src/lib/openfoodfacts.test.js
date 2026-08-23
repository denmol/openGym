import { describe, it, expect } from 'vitest'
import {
  isValidBarcode, normaliseBarcode, parseProduct, servingGrams,
  completeness, foodFromProduct, knownBarcode
} from './openfoodfacts.js'

// Shaped like an Open Food Facts v2 response, with the fields this app asks for.
const arla = {
  code: '7310865004703',
  product: {
    code: '7310865004703',
    product_name: 'Mellanmjölk 1,5%',
    product_name_sv: 'Mellanmjölk 1,5%',
    brands: 'Arla, Arla Foods',
    quantity: '1 l',
    serving_size: '2 dl (206 g)',
    last_modified_t: 1755000000,
    nutriments: {
      'energy-kcal_100g': 44,
      'energy-kj_100g': 184,
      carbohydrates_100g: 4.8,
      sugars_100g: 4.8,
      proteins_100g: 3.4,
      fat_100g: 1.5,
      'saturated-fat_100g': 1,
      salt_100g: 0.1
    }
  }
}

describe('isValidBarcode', () => {
  it('accepts real ones', () => {
    expect(isValidBarcode('7310865004703')).toBe(true)   // EAN-13
    expect(isValidBarcode('73513537')).toBe(true)        // EAN-8
    expect(isValidBarcode('7622210449283')).toBe(true)
  })

  it('rejects a wrong check digit, which is the whole point of having one', () => {
    // One digit off. Without the check this would be a confident lookup of the wrong food.
    expect(isValidBarcode('7310865004704')).toBe(false)
    expect(isValidBarcode('7310865004793')).toBe(false)
  })

  it('rejects what is not a barcode', () => {
    expect(isValidBarcode('')).toBe(false)
    expect(isValidBarcode('12345')).toBe(false)          // no such length
    expect(isValidBarcode('abcdefghijklm')).toBe(false)
    expect(isValidBarcode('731086500470a')).toBe(false)
    expect(isValidBarcode(null)).toBe(false)
  })
})

describe('normaliseBarcode', () => {
  it('pads UPC-A to thirteen, so one product has one id', () => {
    expect(normaliseBarcode('036000291452')).toBe('0036000291452')
    expect(normaliseBarcode('7310865004703')).toBe('7310865004703')
  })
})

describe('parseProduct', () => {
  const f = parseProduct(arla)

  it('reads the values off the packet as they were entered', () => {
    expect(f.per100).toMatchObject({ kcal: 44, carb: 4.8, sugar: 4.8, prot: 3.4, fat: 1.5, sat: 1, salt: 0.1 })
  })

  it('names it so a person recognises it on a list', () => {
    expect(f.n).toBe('Arla Mellanmjölk 1,5%, 1 l')
    expect(f.brand).toBe('Arla')
  })

  it('says which values the entry simply does not have', () => {
    // No fibre figure on this one. Absent, not zero.
    expect(f.missing).toEqual(['fib'])
    expect(f.per100.fib).toBeUndefined()
    expect(completeness(f)).toBe(7)
  })

  it('carries the serving size through as grams', () => {
    // "2 dl (206 g)". Taking the leading number would make a glass of milk weigh 2 g.
    expect(f.serving).toBe(206)
  })

  it('keeps the date, because a five-year-old entry is worth a second look', () => {
    expect(f.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('converts kilojoules when that is all there is, and admits it', () => {
    const kjOnly = { code: '7310865004703', product: {
      code: '7310865004703', product_name: 'X', brands: 'Y',
      nutriments: { 'energy-kj_100g': 1000, carbohydrates_100g: 10 } } }
    const p = parseProduct(kjOnly)
    expect(p.per100.kcal).toBe(239)    // 1000 / 4.184
    expect(p.fromKj).toBe(true)
    expect(f.fromKj).toBe(false)
  })

  it('refuses a product with neither energy nor carbohydrate', () => {
    expect(parseProduct({ code: '7310865004703', product: {
      code: '7310865004703', product_name: 'Tomt', nutriments: { proteins_100g: 2 } } })).toBeNull()
  })

  it('refuses one with no name to show', () => {
    expect(parseProduct({ code: '7310865004703', product: {
      code: '7310865004703', nutriments: { carbohydrates_100g: 10 } } })).toBeNull()
  })

  it('survives nonsense instead of throwing', () => {
    expect(parseProduct(null)).toBeNull()
    expect(parseProduct({})).toBeNull()
    expect(parseProduct({ product: {} })).toBeNull()
  })

  it('ignores a negative or unparseable value rather than storing it', () => {
    const odd = { code: '73513537', product: {
      code: '73513537', product_name: 'Konstig', brands: 'Z',
      nutriments: { carbohydrates_100g: 10, proteins_100g: -5, fat_100g: 'lots' } } }
    const p = parseProduct(odd)
    expect(p.per100.prot).toBeUndefined()
    expect(p.per100.fat).toBeUndefined()
    expect(p.per100.carb).toBe(10)
  })
})

describe('servingGrams', () => {
  it('reads grams off the serving text', () => {
    expect(servingGrams({ serving_size: '30 g' })).toBe(30)
    expect(servingGrams({ serving_size: '1 portion (25 g)' })).toBe(25)
    expect(servingGrams({ serving_size: '2 dl (206 g)' })).toBe(206)
    expect(servingGrams({ serving_quantity: '45', serving_quantity_unit: 'g' })).toBe(45)
    expect(servingGrams({ serving_quantity: '45' })).toBe(45)
  })

  it('refuses a count, which is not a weight however it is written', () => {
    // The bug this replaced: "2 dl (206 g)" read as two grams, "2 kex" as two.
    expect(servingGrams({ serving_size: '2 kex' })).toBeNull()
    expect(servingGrams({ serving_size: '1 skiva' })).toBeNull()
    expect(servingGrams({ serving_size: '3' })).toBeNull()
  })

  it('refuses a volume, because it does not know what the food weighs', () => {
    // 250 ml is 250 g of squash and 230 g of cream. The portion units handle volume
    // per food, with a density; guessing here would undercut that.
    expect(servingGrams({ serving_size: '250ml' })).toBeNull()
    expect(servingGrams({ serving_size: '2 dl' })).toBeNull()
    expect(servingGrams({ serving_quantity: '330', serving_quantity_unit: 'ml' })).toBeNull()
  })

  it('is nothing when there is no serving at all', () => {
    expect(servingGrams({ serving_size: '' })).toBeNull()
    expect(servingGrams({})).toBeNull()
    expect(servingGrams(null)).toBeNull()
  })

  it('rejects a figure no serving could be', () => {
    expect(servingGrams({ serving_size: '99999 g' })).toBeNull()
    expect(servingGrams({ serving_size: '0 g' })).toBeNull()
  })
})

describe('saving what was scanned', () => {
  const f = parseProduct(arla)

  it('becomes one of the user’s own foods, keyed by the barcode', () => {
    const food = foodFromProduct(f)
    expect(food).toMatchObject({ id: 'bc7310865004703', barcode: '7310865004703', own: true })
    expect(food.per100.carb).toBe(4.8)
  })

  it('takes the values the user corrected, not the ones that were fetched', () => {
    const food = foodFromProduct(f, { ...f.per100, carb: 5.1 })
    expect(food.per100.carb).toBe(5.1)
  })

  it('is found again on the next scan, without a lookup', () => {
    const S = { myFoods: [foodFromProduct(f)] }
    expect(knownBarcode(S, '7310865004703').n).toContain('Arla')
    // Scanned as UPC-A on a different day: same product, same entry.
    expect(knownBarcode({ myFoods: [{ barcode: '0036000291452' }] }, '036000291452')).toBeTruthy()
    expect(knownBarcode(S, '73513537')).toBeNull()
    expect(knownBarcode({}, '7310865004703')).toBeNull()
  })
})

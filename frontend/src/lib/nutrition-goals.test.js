import { describe, expect, it } from 'vitest'
import {
  NNR_REFERENCE,
  NUTRIENT_TARGETS,
  NUTRITION_GOALS,
  bmrEstimate,
  cleanNutritionProfile,
  needsClinicianTargets,
  weightKgOf
} from './nutrition-goals.js'

const completeTargets = { kcal: 2200, carb: 260, sugar: 50, prot: 120, fat: 70, sat: 20, fib: 30, salt: 5 }

describe('cleanNutritionProfile', () => {
  it('keeps only supported goals and finite nonnegative daily targets', () => {
    expect(NUTRITION_GOALS).toEqual(['maintain', 'lose', 'muscle', 'health'])
    expect(NUTRIENT_TARGETS).toEqual(['kcal', 'carb', 'sugar', 'prot', 'fat', 'sat', 'fib', 'salt'])
    expect(cleanNutritionProfile({
      goal: 'muscle',
      targets: { ...completeTargets, kcal: '2200', prot: -1, fib: Infinity, extra: 4 },
      condition: true,
      medication: 'yes'
    })).toEqual({
      goal: 'muscle',
      targets: { ...completeTargets, kcal: 2200, prot: null, fib: null },
      condition: true,
      medication: false
    })
  })

  it('returns a clean empty profile and never derives an intake target', () => {
    expect(cleanNutritionProfile({
      goal: 'bulk', sex: 'male', age: 30, heightCm: 175, weightKg: 70,
      targets: { kcal: '', carb: null, sugar: undefined, prot: undefined, fat: NaN, sat: -1, fib: -1, salt: false }
    })).toEqual({
      goal: null,
      targets: { kcal: null, carb: null, sugar: null, prot: null, fat: null, sat: null, fib: null, salt: null },
      condition: false,
      medication: false
    })
    expect(cleanNutritionProfile(null).targets).toEqual({
      kcal: null, carb: null, sugar: null, prot: null, fat: null, sat: null, fib: null, salt: null
    })
  })
})

describe('bmrEstimate', () => {
  it('delegates valid healthy-adult inputs to the existing BMR estimate', () => {
    expect(bmrEstimate({ sex: 'male', age: 30, heightCm: 175, weightKg: 70 })).toBe(1649)
    expect(bmrEstimate({ sex: 'female', age: '30', heightCm: '175', weightKg: '70' })).toBe(1483)
  })

  it('requires an exact supported sex and finite positive adult measurements', () => {
    expect(bmrEstimate({ sex: 'other', age: 30, heightCm: 175, weightKg: 70 })).toBeNull()
    expect(bmrEstimate({ sex: 'male', age: 17, heightCm: 175, weightKg: 70 })).toBeNull()
    expect(bmrEstimate({ sex: 'female', age: 30, heightCm: Infinity, weightKg: 70 })).toBeNull()
    expect(bmrEstimate({ sex: 'female', age: 30, heightCm: 175, weightKg: 0 })).toBeNull()
    expect(bmrEstimate()).toBeNull()
  })
})

describe('weightKgOf', () => {
  it('uses the unit stored with the measurement and rejects ambiguous legacy weights', () => {
    expect(weightKgOf({ w: 80, u: 'kg' })).toBe(80)
    expect(weightKgOf({ w: 220, u: 'lb' })).toBe(99.8)
    expect(weightKgOf({ w: 80 })).toBeNull()
    expect(weightKgOf({ w: 0, u: 'kg' })).toBeNull()
  })
})

describe('medical target gate', () => {
  it('requires clinician targets for diabetes, a condition or medication', () => {
    expect(needsClinicianTargets({}, { diabetes: true })).toBe(true)
    expect(needsClinicianTargets({ condition: true })).toBe(true)
    expect(needsClinicianTargets({ medication: true })).toBe(true)
    expect(needsClinicianTargets({}, { diabetes: false })).toBe(false)
  })
})

describe('NNR reference', () => {
  it('is labelled for healthy adults and is not an energy prescription', () => {
    expect(NNR_REFERENCE.audience).toBe('healthy adults')
    expect(NNR_REFERENCE.ranges).not.toHaveProperty('kcal')
    expect(NNR_REFERENCE.ranges.carb).toEqual({ min: 45, max: 60, unit: 'E%' })
  })
})

import { describe, expect, it } from 'vitest'
import {
  NNR_REFERENCE,
  NUTRIENT_TARGETS,
  NUTRITION_SAFETY_KEYS,
  NUTRITION_GOALS,
  bmrEstimate,
  cleanNutritionProfile,
  finalizeNutritionProfile,
  needsClinicianTargets,
  nutritionSafetyToday,
  safetyReviewCurrent,
  weightKgOf
} from './nutrition-goals.js'

const completeTargets = { kcal: 2200, carb: 260, sugar: 50, prot: 120, fat: 70, sat: 20, fib: 30, salt: 5 }
const SAFE = {
  kidneyOrProteinRestriction: false,
  fluidOrSodiumRestriction: false,
  pregnancyOrBreastfeeding: false,
  eatingDisorder: false,
  severeGI: false,
  malnutritionRisk: false,
  otherClinicalNutrition: false,
  hypoglycemiaRiskMedication: false
}

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
      medication: false,
      incretinUse: null,
      weightPhase: null,
      fiberReference: 'range',
      safety: Object.fromEntries(NUTRITION_SAFETY_KEYS.map(key => [key, null])),
      safetyReviewedAt: null,
      targetReviewRequired: false
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
      medication: false,
      incretinUse: null,
      weightPhase: null,
      fiberReference: 'range',
      safety: Object.fromEntries(NUTRITION_SAFETY_KEYS.map(key => [key, null])),
      safetyReviewedAt: null,
      targetReviewRequired: false
    })
    expect(cleanNutritionProfile(null).targets).toEqual({
      kcal: null, carb: null, sugar: null, prot: null, fat: null, sat: null, fib: null, salt: null
    })
  })

  it('normalises enums, real dates and only exact tri-state booleans', () => {
    const profile = cleanNutritionProfile({
      goal: 'lose', targets: completeTargets,
      incretinUse: 'weight', weightPhase: 'active_loss', fiberReference: 'female',
      safety: { ...SAFE, severeGI: 'false', eatingDisorder: 0 },
      safetyReviewedAt: '2026-02-30', targetReviewRequired: true
    })
    expect(profile.incretinUse).toBe('weight')
    expect(profile.weightPhase).toBe('active_loss')
    expect(profile.fiberReference).toBe('female')
    expect(profile.safety.severeGI).toBeNull()
    expect(profile.safety.eatingDisorder).toBeNull()
    expect(profile.safetyReviewedAt).toBeNull()
    expect(profile.targetReviewRequired).toBe(true)
    expect(profile.targets).toEqual(completeTargets)
  })

  it('migrates missing fields fail-closed without touching manual targets', () => {
    const profile = cleanNutritionProfile({ goal: 'health', targets: completeTargets })
    expect(profile.incretinUse).toBeNull()
    expect(profile.weightPhase).toBeNull()
    expect(profile.fiberReference).toBe('range')
    expect(profile.safety).toEqual(Object.fromEntries(NUTRITION_SAFETY_KEYS.map(key => [key, null])))
    expect(profile.safetyReviewedAt).toBeNull()
    expect(profile.targetReviewRequired).toBe(false)
    expect(profile.targets).toEqual(completeTargets)
  })

  it('accepts day 90 but rejects day 91, future and invalid review dates', () => {
    expect(safetyReviewCurrent('2026-05-25', '2026-08-23')).toBe(true)
    expect(safetyReviewCurrent('2026-05-24', '2026-08-23')).toBe(false)
    expect(safetyReviewCurrent('2026-08-24', '2026-08-23')).toBe(false)
    expect(safetyReviewCurrent('2026-02-30', '2026-08-23')).toBe(false)
  })

  it('uses one UTC calendar day across client time zones', () => {
    expect(nutritionSafetyToday(new Date('2026-08-23T00:30:00+02:00'))).toBe('2026-08-22')
    expect(nutritionSafetyToday(new Date('2026-08-22T23:30:00-02:00'))).toBe('2026-08-23')
  })

  it('keeps target review sticky across a risk removal', () => {
    const base = { goal: 'lose', targets: completeTargets, incretinUse: 'weight', weightPhase: 'active_loss', safety: SAFE, safetyReviewedAt: '2026-08-23' }
    const risky = finalizeNutritionProfile(base, { ...base, safety: { ...SAFE, severeGI: true } }, { safetyConfirmedAt: '2026-08-23' })
    expect(risky.targetReviewRequired).toBe(true)
    const removed = finalizeNutritionProfile(risky, { ...risky, safety: SAFE }, { safetyConfirmedAt: '2026-08-23', targetsReviewed: true })
    expect(removed.targetReviewRequired).toBe(true)
    const reviewed = finalizeNutritionProfile(removed, removed, { targetsReviewed: true })
    expect(reviewed.targetReviewRequired).toBe(false)
    expect(reviewed.targets).toEqual(completeTargets)
  })

  it.each([
    ['incretin use', draft => ({ ...draft, incretinUse: 'both' })],
    ['weight phase', draft => ({ ...draft, weightPhase: 'maintenance' })],
    ['condition', draft => ({ ...draft, condition: true })],
    ['medication', draft => ({ ...draft, medication: true })],
    ['safety answer', draft => ({ ...draft, safety: { ...draft.safety, severeGI: true } })]
  ])('invalidates the safety date when %s changes', (_name, change) => {
    const base = { goal: 'lose', incretinUse: 'weight', weightPhase: 'active_loss', safety: SAFE, safetyReviewedAt: '2026-08-23' }
    expect(finalizeNutritionProfile(base, change(base)).safetyReviewedAt).toBeNull()
  })

  it('accepts a new confirmation only after every tri-state answer is explicit', () => {
    const incomplete = { goal: 'health', incretinUse: 'none', safety: { ...SAFE, severeGI: null } }
    expect(finalizeNutritionProfile(null, incomplete, { safetyConfirmedAt: '2026-08-23' }).safetyReviewedAt).toBeNull()
    expect(finalizeNutritionProfile(null, { ...incomplete, safety: SAFE }, { safetyConfirmedAt: '2026-08-23' }).safetyReviewedAt).toBe('2026-08-23')
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

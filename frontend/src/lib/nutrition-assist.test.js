import { describe, expect, it } from 'vitest'
import { nutritionAssistContext, validateNutritionAnswer } from './nutrition-assist.js'
import { totalsOf } from './nutrition.js'

const foods = {
  full: { per100: { kcal: 100, carb: 10, sugar: 2, prot: 5, fat: 3, sat: 1, fib: 4, salt: 0.2 } },
  partial: { per100: { kcal: 200, carb: 20 } }
}
const SAFE = {
  kidneyOrProteinRestriction: false, fluidOrSodiumRestriction: false,
  pregnancyOrBreastfeeding: false, eatingDisorder: false, severeGI: false,
  malnutritionRisk: false, otherClinicalNutrition: false, hypoglycemiaRiskMedication: false
}
const AI_SAFE = {
  goal: 'health', targets: { fib: 30 }, condition: false, medication: false,
  incretinUse: 'none', weightPhase: null, fiberReference: 'range',
  safety: SAFE, safetyReviewedAt: '2026-05-25', targetReviewRequired: false
}

describe('nutrition AI context', () => {
  it('sends only selected structured facts and leaves an unknown nutrient out', () => {
    const totals = totalsOf([{ fid: 'full', g: 100 }, { fid: 'partial', g: 50 }], foods)
    const context = nutritionAssistContext({
      lang: 'sv', unit: 'kg', body: 'male', bodyweight: [{ d: '2026-08-23', w: 80, u: 'kg' }],
      coachProfile: { age: 40, sex: 'male', heightCm: 180 },
      nutritionGoals: AI_SAFE
    }, totals, '2026-08-23', '2026-08-23')

    expect(context.date).toBe('2026-08-23')
    expect(context.day.carb).toBe(20)
    expect(context.day.prot).toBeUndefined()
    expect(context.incomplete).toContain('prot')
    expect(context.targets).toEqual({ fib: 30 })
    expect(context.person).toMatchObject({ age: 40, sex: 'male', heightCm: 180, weightKg: 80 })
    // 10·80 + 6.25·180 − 5·40 + 5 = 1 730
    expect(context.person.bmrKcal).toBe(1730)
  })

  it('converts a logged lb value to kg and carries only medical flags, not names', () => {
    const context = nutritionAssistContext({
      lang: 'en', unit: 'kg', bodyweight: [{ d: '2026-08-23', w: 220, u: 'lb' }],
      body: 'female', coachProfile: { age: 30, heightCm: 170 }, health: { on: true },
      nutritionGoals: { goal: 'lose', condition: true, medication: true }
    }, totalsOf([], foods))
    expect(context.person.weightKg).toBe(99.8)
    expect(context.medical).toEqual({
      diabetes: true, condition: true, medication: true, under18: false, nutritionSafety: true
    })
    expect(context.clinicianReview).toBe(true)
    expect(JSON.stringify(context)).not.toContain('medicineName')
  })

  it('does not guess the unit of a legacy weight', () => {
    const context = nutritionAssistContext({
      lang: 'sv', unit: 'lb', bodyweight: [{ d: '2026-08-23', w: 80 }],
      coachProfile: { age: 40, sex: 'male', heightCm: 180 },
      nutritionGoals: { goal: 'health' }
    }, totalsOf([], foods))
    expect(context.person.weightKg).toBeNull()
    expect(context.person.bmrKcal).toBeNull()
  })

  it('does not turn a blank or boolean legacy age into an under-18 flag', () => {
    for (const age of ['', false]) {
      const context = nutritionAssistContext({
        lang: 'sv', coachProfile: { age }, nutritionGoals: { goal: 'health' }
      }, totalsOf([], foods))
      expect(context.medical.under18).toBe(false)
      expect(context.medical.nutritionSafety).toBe(true)
      expect(context.clinicianReview).toBe(true)
    }
  })

  it('sends one coarse safety flag and no medical category names', () => {
    const context = nutritionAssistContext({
      lang: 'sv', coachProfile: { age: 40, sex: 'male', heightCm: 180 },
      nutritionGoals: { ...AI_SAFE, incretinUse: 'weight', safety: { ...SAFE, severeGI: true } }
    }, totalsOf([], foods), '2026-08-23', '2026-08-23')
    expect(context.medical.nutritionSafety).toBe(true)
    expect(context.clinicianReview).toBe(true)
    const json = JSON.stringify(context)
    for (const secret of ['incretinUse', 'weightPhase', 'severeGI', 'safetyReviewedAt', 'targetReviewRequired']) {
      expect(json).not.toContain(secret)
    }
  })

  it('keeps an explicitly safe current profile on the general path', () => {
    const context = nutritionAssistContext({
      lang: 'sv', coachProfile: { age: 40 }, nutritionGoals: AI_SAFE
    }, totalsOf([], foods), '2026-08-23', '2026-08-23')
    expect(context.medical.nutritionSafety).toBe(false)
    expect(context.clinicianReview).toBe(false)
  })
})

describe('nutrition AI answer validation', () => {
  const answer = { status: 'clinician_review', summary: 'Review.', observations: ['Known fact'], questions: ['What target applies?'] }

  it('requires the medical review status when the profile is gated', () => {
    expect(validateNutritionAnswer(answer, true)).toEqual(answer)
    expect(validateNutritionAnswer({ ...answer, status: 'general' }, true)).toBeNull()
  })

  it('accepts a stricter local review returned by the server', () => {
    const answer = { status: 'clinician_review', summary: 'Review.', observations: [], questions: [] }
    expect(validateNutritionAnswer(answer, false)).toEqual(answer)
  })

  it('rejects plausible text in the wrong shape', () => {
    expect(validateNutritionAnswer({ ...answer, observations: 'Known fact' })).toBeNull()
    expect(validateNutritionAnswer(null)).toBeNull()
  })
})

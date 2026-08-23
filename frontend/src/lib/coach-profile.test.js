import { describe, expect, it } from 'vitest'
import { cleanCoachProfile, coachProfileOf } from './coach-profile.js'
import { nutritionAiGate } from './nutrition-goals.js'

const AI_SAFE = {
  goal: 'health', condition: false, medication: false, incretinUse: 'none', weightPhase: null,
  safety: {
    kidneyOrProteinRestriction: false, fluidOrSodiumRestriction: false,
    pregnancyOrBreastfeeding: false, eatingDisorder: false, severeGI: false,
    malnutritionRisk: false, otherClinicalNutrition: false, hypoglycemiaRiskMedication: false
  },
  safetyReviewedAt: '2026-05-25', targetReviewRequired: false
}

describe('cleanCoachProfile numeric fields', () => {
  it('keeps missing age and height missing instead of turning Number(null) into minimum values', () => {
    const profile = cleanCoachProfile({ age: null, heightCm: '', days: null, minutes: undefined })
    expect(profile.age).toBeNull()
    expect(profile.heightCm).toBeNull()
    expect(profile.days).toBe(3)
    expect(profile.minutes).toBe(60)
  })

  it('round-trips only numeric integer ages from 12 through 100 and keeps invalid ages out of nutrition AI', () => {
    for (const age of [12, 17, 18, 100]) {
      expect(coachProfileOf({ coachProfile: cleanCoachProfile({ age }) }).age).toBe(age)
    }
    for (const age of [101, '101', 100.6, 99.6]) {
      const storedAge = coachProfileOf({ coachProfile: cleanCoachProfile({ age }) }).age
      expect(storedAge).toBeNull()
      expect(nutritionAiGate(AI_SAFE, { age: storedAge, today: '2026-08-23' })).toBe(true)
    }
  })
})

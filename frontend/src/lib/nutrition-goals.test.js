import { describe, expect, it } from 'vitest'
import {
  NNR_REFERENCE,
  NUTRITION_REFERENCE_CATALOG,
  NUTRITION_ACTIVITY_LEVELS,
  NUTRIENT_TARGETS,
  NUTRITION_SAFETY_KEYS,
  NUTRITION_GOALS,
  bmrEstimate,
  cleanNutritionProfile,
  dailyNutritionReferences,
  finalizeNutritionProfile,
  nutritionAiGate,
  needsClinicianTargets,
  CORE_SAFETY_KEYS,
  EXTENDED_SAFETY_KEYS,
  safetyPausedTargets,
  nutritionReferenceState,
  nutritionSafetyToday,
  safetyReviewCurrent,
  formatNutritionReference,
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
const CURRENT_GLP = {
  goal: 'lose', targets: completeTargets,
  incretinUse: 'weight', weightPhase: 'active_loss', fiberReference: 'range',
  safety: SAFE, safetyReviewedAt: '2026-05-25', targetReviewRequired: false
}
const AI_SAFE = {
  goal: 'health', targets: {}, condition: false, medication: false,
  incretinUse: 'none', weightPhase: null, fiberReference: 'range',
  safety: SAFE, safetyReviewedAt: '2026-05-25', targetReviewRequired: false
}
const reference = (state, id) => state.references.find(item => item.id === id)

describe('cleanNutritionProfile', () => {
  it('keeps only supported goals and finite nonnegative daily targets', () => {
    expect(NUTRITION_GOALS).toEqual(['maintain', 'lose', 'muscle', 'health'])
    expect(NUTRIENT_TARGETS).toEqual(['kcal', 'carb', 'sugar', 'prot', 'fat', 'sat', 'fib', 'salt'])
    expect(cleanNutritionProfile({
      goal: 'muscle',
      targets: { ...completeTargets, kcal: '2200', prot: -1, fib: Infinity, extra: 4 },
      activityLevel: 'active',
      condition: true,
      medication: 'yes'
    })).toEqual({
      goal: 'muscle',
      targets: { ...completeTargets, kcal: 2200, prot: null, fib: null },
      activityLevel: 'active',
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
      activityLevel: 'range',
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
    expect(profile.activityLevel).toBe('range')
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
    expect(profile.activityLevel).toBe('range')
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

  it.each(CORE_SAFETY_KEYS)('accepts no confirmation while the core question %s is unanswered', key => {
    const incomplete = { goal: 'health', incretinUse: 'none', safety: { ...SAFE, [key]: null } }
    expect(finalizeNutritionProfile(null, incomplete, { safetyConfirmedAt: '2026-08-23' }).safetyReviewedAt).toBeNull()
    expect(finalizeNutritionProfile(null, { ...incomplete, safety: SAFE }, { safetyConfirmedAt: '2026-08-23' }).safetyReviewedAt).toBe('2026-08-23')
  })

  it.each(EXTENDED_SAFETY_KEYS)('accepts a confirmation while the extended question %s is unanswered', key => {
    const partial = { goal: 'health', incretinUse: 'none', safety: { ...SAFE, [key]: null } }
    expect(finalizeNutritionProfile(null, partial, { safetyConfirmedAt: '2026-08-23' }).safetyReviewedAt).toBe('2026-08-23')
  })

  it('does not accept a hand-written unconfirmed safety date', () => {
    expect(finalizeNutritionProfile(null, {
      goal: 'health', safety: {}, safetyReviewedAt: '2026-08-23'
    }).safetyReviewedAt).toBeNull()
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

describe('nutrition AI gate', () => {
  it('opens AI only for an explicitly current, non-medical adult profile', () => {
    expect(nutritionAiGate(AI_SAFE, { age: 40, today: '2026-08-23', diabetes: false })).toBe(false)
    expect(nutritionAiGate({ ...AI_SAFE, incretinUse: 'weight' }, { age: 40, today: '2026-08-23' })).toBe(true)
    expect(nutritionAiGate({ ...AI_SAFE, safetyReviewedAt: '2026-05-24' }, { age: 40, today: '2026-08-23' })).toBe(true)
    expect(nutritionAiGate({ ...AI_SAFE, safety: { ...SAFE, severeGI: true } }, { age: 40, today: '2026-08-23' })).toBe(true)
    expect(nutritionAiGate({ ...AI_SAFE, targetReviewRequired: true }, { age: 40, today: '2026-08-23' })).toBe(true)
    expect(nutritionAiGate(AI_SAFE, { age: 17, today: '2026-08-23' })).toBe(true)
    expect(nutritionAiGate(AI_SAFE, { age: 100, today: '2026-08-23' })).toBe(false)
    expect(nutritionAiGate(AI_SAFE, { age: 101, today: '2026-08-23' })).toBe(true)
    expect(nutritionAiGate(AI_SAFE, { age: null, today: '2026-08-23' })).toBe(true)
    expect(nutritionAiGate(AI_SAFE, { age: 40, today: '2026-08-23', diabetes: true })).toBe(true)
  })
})

describe('NNR reference', () => {
  it('is labelled for healthy adults and is not an energy prescription', () => {
    expect(NNR_REFERENCE.audience).toBe('healthy adults')
    expect(NNR_REFERENCE.ranges).not.toHaveProperty('kcal')
    expect(NNR_REFERENCE.ranges.carb).toEqual({ min: 45, max: 60, unit: 'E%' })
  })
})

describe('nutrition reference engine', () => {
  describe('dailyNutritionReferences', () => {
    const ids = (state, nutrient) => dailyNutritionReferences(state, nutrient).map(item => item.id)
    const dailyMap = state => Object.fromEntries(NUTRIENT_TARGETS.map(key => [key,
      dailyNutritionReferences(state, key).map(({ id, value, operator }) => ({ id, value, operator: operator || null }))
    ]))

    it.each([['condition', { condition: true }], ['medication', { medication: true }]])(
      'returns the exact comparable adult references with %s without inventing calorie or sugar targets', (_name, medical) => {
        const state = nutritionReferenceState({ ...AI_SAFE, ...medical }, { age: 40, today: '2026-08-23' })
        expect(dailyMap(state)).toEqual({
          kcal: [],
          carb: [{ id: 'nnr-carb', value: { min: 45, max: 60 }, operator: null }],
          sugar: [],
          prot: [{ id: 'nnr-protein', value: { min: 10, max: 20 }, operator: null }],
          fat: [{ id: 'nnr-fat', value: { min: 25, max: 40 }, operator: null }],
          sat: [{ id: 'nnr-saturated', value: 10, operator: '<' }],
          fib: [{ id: 'nnr-fiber-range', value: { min: 25, max: 35 }, operator: null }],
          salt: [{ id: 'nnr-salt', value: 5.75, operator: '≤' }]
        })
      })

    it('adds only the exact daily GLP-1 references for active obesity treatment', () => {
      const state = nutritionReferenceState(CURRENT_GLP, { age: 40, today: '2026-08-23' })
      expect(ids(state, 'prot')).toEqual(['nnr-protein', 'glp-protein-example'])
      expect(dailyNutritionReferences(state, 'prot').map(item => item.value)).toEqual([
        { min: 10, max: 20 }, { min: 80, max: 120 }
      ])
      expect(ids(state, 'fib')).toEqual(['nnr-fiber-range', 'glp-fiber'])
      expect(dailyNutritionReferences(state, 'fib').map(item => item.value)).toEqual([
        { min: 25, max: 35 }, 25
      ])

      const both = nutritionReferenceState({ ...CURRENT_GLP, incretinUse: 'both' }, { age: 40, today: '2026-08-23' })
      expect(ids(both, 'prot')).toEqual(['nnr-protein', 'glp-protein-example'])
      expect(ids(both, 'fib')).toEqual(['nnr-fiber-range', 'glp-fiber'])
    })

    it('keeps adult references but adds no obesity-treatment layer for diabetes treatment only', () => {
      const state = nutritionReferenceState({ ...CURRENT_GLP, incretinUse: 'diabetes' }, { age: 40, today: '2026-08-23' })
      expect(ids(state, 'prot')).toEqual(['nnr-protein'])
      expect(ids(state, 'fib')).toEqual(['nnr-fiber-range'])
      expect(state.references.some(item => item.layer === 'glp1')).toBe(false)
    })

    it.each([
      ['kidneyOrProteinRestriction', ['nnr-carb', 'nnr-fat', 'nnr-saturated', 'nnr-fiber-range', 'glp-fiber']],
      ['fluidOrSodiumRestriction', ['nnr-carb', 'nnr-protein', 'glp-protein-example', 'nnr-fat', 'nnr-saturated', 'nnr-fiber-range', 'glp-fiber']],
      ['pregnancyOrBreastfeeding', []],
      ['eatingDisorder', []],
      ['severeGI', ['nnr-carb', 'nnr-protein', 'nnr-fat', 'nnr-saturated', 'nnr-salt']],
      ['malnutritionRisk', []],
      ['otherClinicalNutrition', ['nnr-carb', 'nnr-protein', 'nnr-fat', 'nnr-saturated', 'nnr-fiber-range', 'nnr-salt']],
      ['hypoglycemiaRiskMedication', ['nnr-protein', 'glp-protein-example', 'nnr-fat', 'nnr-saturated', 'nnr-fiber-range', 'glp-fiber', 'nnr-salt']]
    ])('removes only the daily source references affected by %s', (key, expected) => {
      const state = nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, [key]: true } }, { age: 40, today: '2026-08-23' })
      expect(NUTRIENT_TARGETS.flatMap(nutrient => ids(state, nutrient))).toEqual(expected)
    })

    it('does not write source values into manual targets', () => {
      const raw = { ...AI_SAFE, targets: { prot: null, fib: 30 } }
      const state = nutritionReferenceState(raw, { age: 40, today: '2026-08-23' })
      expect(ids(state, 'prot')).toEqual(['nnr-protein'])
      expect(raw.targets).toEqual({ prot: null, fib: 30 })
      expect(cleanNutritionProfile(raw).targets).toEqual({
        kcal: null, carb: null, sugar: null, prot: null, fat: null, sat: null, fib: 30, salt: null
      })
    })
  })

  it('returns exact adult values and never turns free sugar into a log target', () => {
    const state = nutritionReferenceState(CURRENT_GLP, { age: 18, today: '2026-08-23' })
    expect(reference(state, 'nnr-carb').value).toEqual({ min: 45, max: 60 })
    expect(reference(state, 'nnr-protein').value).toEqual({ min: 10, max: 20 })
    expect(reference(state, 'nnr-fat').value).toEqual({ min: 25, max: 40 })
    expect(reference(state, 'nnr-saturated')).toMatchObject({ value: 10, operator: '<' })
    expect(reference(state, 'nnr-salt').value).toBe(5.75)
    expect(reference(state, 'nnr-free-sugar')).toMatchObject({ kind: 'max', value: 10, operator: '<', daily: false })
    expect(reference(state, 'nnr-fiber-range').value).toEqual({ min: 25, max: 35 })
  })

  it('returns the sourced GLP values without deriving a personal number', () => {
    const state = nutritionReferenceState(CURRENT_GLP, { age: 40, today: '2026-08-23' })
    expect(reference(state, 'glp-protein-example').value).toEqual({ min: 80, max: 120 })
    expect(reference(state, 'glp-protein-reference-weight').value).toEqual({ min: 1, max: 1.5 })
    expect(reference(state, 'glp-protein-floor').value).toBe(60)
    expect(reference(state, 'glp-fiber').value).toBe(25)
    expect(reference(state, 'glp-fluid').value).toEqual({ min: 2, max: 2.5 })
    expect(reference(state, 'glp-energy-1500').value).toBe(1500)
    expect(reference(state, 'glp-energy-1200').value).toBe(1200)
    expect(reference(state, 'glp-energy-800').value).toBe(800)
  })

  it('requires adult age and an explicit non-pregnancy answer', () => {
    expect(nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, pregnancyOrBreastfeeding: false } }, { age: 17, today: '2026-08-23' }).references).toEqual([])
    expect(nutritionReferenceState(CURRENT_GLP, { age: 18, today: '2026-08-23' }).adultStatus).toBe('available')
    expect(nutritionReferenceState(CURRENT_GLP, { age: 100, today: '2026-08-23' }).adultStatus).toBe('available')
    expect(nutritionReferenceState(CURRENT_GLP, { age: 101, today: '2026-08-23' }).references).toEqual([])
    expect(nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, pregnancyOrBreastfeeding: null } }, { age: 18, today: '2026-08-23' }).adultStatus).toBe('pregnancy_required')
    expect(nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, pregnancyOrBreastfeeding: true } }, { age: 18, today: '2026-08-23' }).pausedTargets).toEqual(NUTRIENT_TARGETS)
  })

  it('uses the explicit fibre reference and ignores body or current weight', () => {
    const female = nutritionReferenceState({ ...CURRENT_GLP, fiberReference: 'female', body: 'male', weightKg: 80 }, { age: 40, today: '2026-08-23', weightKg: 80 })
    const male = nutritionReferenceState({ ...CURRENT_GLP, fiberReference: 'male' }, { age: 40, today: '2026-08-23' })
    expect(reference(female, 'nnr-fiber-female').value).toBe(25)
    expect(reference(male, 'nnr-fiber-male').value).toBe(35)
    expect(reference(female, 'glp-protein-reference-weight').value).toEqual({ min: 1, max: 1.5 })
    expect(female.references.some(item => item.derivedGrams != null)).toBe(false)
  })

  it('uses strict energy thresholds only from the manual target', () => {
    const signal = kcal => nutritionReferenceState({ ...CURRENT_GLP, targets: { ...completeTargets, kcal } }, { age: 40, today: '2026-08-23' })
    expect(signal(1500).energySignal).toBeNull()
    expect(signal(1499.9).energySignal).toBe('under_1500')
    expect(signal(1200).energySignal).toBe('under_1500')
    expect(signal(1199.9).energySignal).toBe('under_1200')
    expect(signal(800).energySignal).toBe('under_1200')
    expect(signal(799.9).energySignal).toBe('under_800')
    expect(signal(799.9).pausedTargets).toContain('kcal')
    expect(signal(0).energySignal).toBeNull()
  })

  it.each([
    ['kidneyOrProteinRestriction', ['prot', 'salt']],
    ['fluidOrSodiumRestriction', ['salt']],
    ['pregnancyOrBreastfeeding', NUTRIENT_TARGETS],
    ['eatingDisorder', NUTRIENT_TARGETS],
    ['severeGI', ['kcal', 'prot', 'fib']],
    ['malnutritionRisk', NUTRIENT_TARGETS],
    ['otherClinicalNutrition', NUTRIENT_TARGETS],
    ['hypoglycemiaRiskMedication', ['kcal', 'carb']]
  ])('pauses the exact safety-matrix targets for %s', (key, expected) => {
    const state = nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, [key]: true } }, { age: 40, today: '2026-08-23' })
    expect(state.pausedTargets).toEqual(expected)
  })

  it('keeps source precision in Swedish display', () => {
    const state = nutritionReferenceState(CURRENT_GLP, { age: 40, today: '2026-08-23' })
    expect(formatNutritionReference(reference(state, 'nnr-salt'), 'sv-SE', 'g/dag')).toBe('≤5,75 g/dag')
    expect(formatNutritionReference(reference(state, 'glp-fluid'), 'sv-SE', 'liter/dag')).toBe('2,0–2,5 liter/dag')
    expect(formatNutritionReference(reference(state, 'glp-protein-reference-weight'), 'sv-SE', 'g/kg justerad referensvikt/dag')).toBe('1,0–1,5 g/kg justerad referensvikt/dag')
  })

  it('blocks GLP at day 91 and for non-weight indications', () => {
    const expired = nutritionReferenceState({ ...CURRENT_GLP, safetyReviewedAt: '2026-05-24' }, { age: 40, today: '2026-08-23' })
    expect(expired.glpStatus).toBe('safety_expired')
    expect(expired.references.every(item => item.layer !== 'glp1')).toBe(true)
    for (const incretinUse of ['diabetes', 'other', 'none', null]) {
      const state = nutritionReferenceState({ ...CURRENT_GLP, incretinUse }, { age: 40, today: '2026-08-23' })
      expect(state.glpStatus).toBe('not_applicable')
      expect(state.references.every(item => item.layer !== 'glp1')).toBe(true)
    }
  })

  it('removes only the active-loss protein example during maintenance', () => {
    const state = nutritionReferenceState({ ...CURRENT_GLP, weightPhase: 'maintenance' }, { age: 40, today: '2026-08-23' })
    expect(reference(state, 'glp-protein-example')).toBeUndefined()
    expect(reference(state, 'glp-protein-reference-weight')).toBeDefined()
    expect(reference(state, 'glp-fluid')).toBeDefined()
  })

  it('pauses all comparisons while sticky target review remains', () => {
    const state = nutritionReferenceState({ ...CURRENT_GLP, targetReviewRequired: true }, { age: 40, today: '2026-08-23' })
    expect(state.pausedTargets).toEqual(NUTRIENT_TARGETS)
  })

  it.each([
    ['pregnancyOrBreastfeeding', NUTRITION_REFERENCE_CATALOG.map(item => item.id)],
    ['eatingDisorder', NUTRITION_REFERENCE_CATALOG.map(item => item.id)],
    ['malnutritionRisk', NUTRITION_REFERENCE_CATALOG.map(item => item.id)],
    ['kidneyOrProteinRestriction', ['nnr-protein', 'nnr-salt', 'glp-protein-example', 'glp-protein-reference-weight', 'glp-protein-floor', 'glp-fluid']],
    ['fluidOrSodiumRestriction', ['nnr-salt', 'glp-fluid']],
    ['severeGI', ['nnr-fiber-range', 'glp-protein-example', 'glp-protein-reference-weight', 'glp-protein-floor', 'glp-fiber', 'glp-fluid', 'glp-energy-1500', 'glp-energy-1200', 'glp-energy-800']],
    ['otherClinicalNutrition', ['glp-protein-example', 'glp-protein-reference-weight', 'glp-protein-floor', 'glp-fiber', 'glp-fluid', 'glp-energy-1500', 'glp-energy-1200', 'glp-energy-800']],
    ['hypoglycemiaRiskMedication', ['nnr-carb', 'glp-energy-1500', 'glp-energy-1200', 'glp-energy-800']]
  ])('hides the exact references for %s', (key, hidden) => {
    const baseIds = nutritionReferenceState(CURRENT_GLP, { age: 40, today: '2026-08-23' })
      .references.map(item => item.id)
    const ids = nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, [key]: true } }, { age: 40, today: '2026-08-23' })
      .references.map(item => item.id)
    expect(ids).toEqual(baseIds.filter(id => !hidden.includes(id)))
  })

  it('locks reference kind, operator, placement and source family for every catalogue row', () => {
    const NNR_URL = 'https://pub.norden.org/nord2023-003/recommendations.html'
    const JOINT_URL = 'https://doi.org/10.1016/j.obpill.2025.100181'
    const EASO_URL = 'https://easo.org/wp-content/uploads/2026/07/obesity-incretin-based-therapy_v6.pdf'
    const families = {
      nnr: ['Nordic Nutrition Recommendations 2023', 2023, NNR_URL, 'Adults not pregnant, planning pregnancy or breastfeeding'],
      joint: ['ACLM/ASN/OMA/TOS joint advisory', 2025, JOINT_URL, 'Adults using GLP-1 therapy for obesity during active weight loss'],
      easo: ['EASO/EFAD/ECPO clinical infographic', 2026, EASO_URL, 'Adults using incretin-based therapy for obesity']
    }
    const expected = [
      ['nnr-carb', 'range', null, true, null, 'nnr'], ['nnr-protein', 'range', null, true, null, 'nnr'], ['nnr-fat', 'range', null, true, null, 'nnr'],
      ['nnr-saturated', 'max', '<', true, null, 'nnr'], ['nnr-fiber-range', 'range', null, true, 'fib', 'nnr'], ['nnr-fiber-female', 'min', '≥', true, 'fib', 'nnr'],
      ['nnr-fiber-male', 'min', '≥', true, 'fib', 'nnr'], ['nnr-salt', 'max', '≤', true, 'salt', 'nnr'], ['nnr-free-sugar', 'max', '<', false, null, 'nnr'],
      ['glp-protein-example', 'example', null, true, null, 'joint'], ['glp-protein-reference-weight', 'range', null, false, null, 'easo'],
      ['glp-protein-floor', 'min', '≥', false, null, 'easo'], ['glp-fiber', 'min', '≥', true, 'fib', 'easo'], ['glp-fluid', 'range', null, false, null, 'easo'],
      ['glp-energy-1500', 'warning', '<', false, null, 'easo'], ['glp-energy-1200', 'warning', '<', false, null, 'easo'], ['glp-energy-800', 'warning', '<', false, null, 'easo']
    ]
    for (const [id, kind, operator, daily, targetField, family] of expected) {
      const item = NUTRITION_REFERENCE_CATALOG.find(reference => reference.id === id)
      const [source, year, sourceUrl, audience] = families[family]
      expect(item).toMatchObject({ id, kind, daily, source, year, sourceUrl, audience })
      expect(item.operator ?? null).toBe(operator)
      expect(item.targetField ?? null).toBe(targetField)
    }
    expect(NUTRITION_REFERENCE_CATALOG).toHaveLength(expected.length)
  })

  it('keeps hypoglycaemia safety text within the approved medical boundary', () => {
    const state = nutritionReferenceState({ ...CURRENT_GLP, safety: { ...SAFE, hypoglycemiaRiskMedication: true } }, { age: 40, today: '2026-08-23' })
    const message = state.notices.find(notice => notice.code === 'safety:hypoglycemiaRiskMedication').message
    expect(message).toContain('prescribed emergency plan')
    expect(message).toContain('urgent help')
    expect(message).toContain('repeated episodes')
    expect(message).toContain('diabetes team')
    expect(/carbohydrate amount|bolus|correction factor|insulin-on-board/i.test(message)).toBe(false)
  })
})

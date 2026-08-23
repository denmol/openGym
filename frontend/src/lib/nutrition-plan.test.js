import { describe, expect, it } from 'vitest'
import {
  HEADLINE_NUTRIENTS, PLAN_LIMIT, PLAN_NUTRIENTS, PROGRESS_NUTRIENTS,
  dayProgress, nutritionDayPlan, nutritionDayRows, planAsTargets,
  proteinReferenceWeight, resolvedGoal
} from './nutrition-plan.js'
import { NUTRITION_SAFETY_KEYS } from './nutrition-goals.js'

const TODAY = '2026-08-23'
const SAFE = Object.fromEntries(NUTRITION_SAFETY_KEYS.map(key => [key, false]))
const ready = profile => ({ safety: SAFE, safetyReviewedAt: TODAY, activityLevel: 'moderate', ...profile })
const man = { sex: 'male', age: 40, heightCm: 180, weightKg: 90, weightLogged: true, today: TODAY }
const woman = { sex: 'female', age: 55, heightCm: 160, weightKg: 68, weightLogged: true, today: TODAY }

describe('nutritionDayPlan energy', () => {
  it('collapses the PAL interval to one number instead of handing over its width', () => {
    expect(nutritionDayPlan(ready({ goal: 'health', activityLevel: 'range' }), man).energy)
      .toMatchObject({ basal: 1859, pal: 1.6, maintenance: 2970, plan: 2970, palAssumed: true })
    expect(nutritionDayPlan(ready({ goal: 'health', activityLevel: 'low' }), man).energy.plan).toBe(2600)
    expect(nutritionDayPlan(ready({ goal: 'health', activityLevel: 'active' }), man).energy.plan).toBe(3350)
  })

  it('applies the sourced deficit above BMI 25 and no deficit below it', () => {
    expect(nutritionDayPlan(ready({ goal: 'lose' }), man)).toMatchObject({
      goalBasis: 'loss_deficit', goalStatus: 'planning_example', energy: { plan: 2350 }
    })
    expect(nutritionDayPlan(ready({ goal: 'lose' }), { ...man, weightKg: 70 })).toMatchObject({
      goalBasis: 'loss_not_applied_bmi_below_25', energy: { plan: 2610 }
    })
  })

  it('applies the sourced surplus for muscle and nothing for maintenance', () => {
    expect(nutritionDayPlan(ready({ goal: 'muscle' }), man).energy.plan).toBe(3340)
    expect(nutritionDayPlan(ready({ goal: 'maintain' }), man).energy.plan).toBe(2970)
  })

  it('clamps to the 1,200 kcal floor rather than withdrawing the whole plan', () => {
    // The case the interval version dropped: its low end fell under the floor, so the
    // person this feature exists for was shown maintenance energy and no macros at all.
    const plan = nutritionDayPlan(ready({ goal: 'lose', activityLevel: 'low' }),
      { sex: 'female', age: 75, heightCm: 150, weightKg: 62, weightLogged: true, today: TODAY })
    expect(plan.blocked).toBeNull()
    expect(plan.energy).toMatchObject({ plan: 1200, floorApplied: true, belowMicronutrientWatch: true })
    expect(plan.values.carb).toBeGreaterThan(0)
  })

  it('flags a plan under the micronutrient watch level without hiding it', () => {
    const plan = nutritionDayPlan(ready({ goal: 'lose' }), woman)
    expect(plan.energy).toMatchObject({ plan: 1400, floorApplied: false, belowMicronutrientWatch: true })
    expect(plan.values).toMatchObject({ kcal: 1400, prot: 105, fat: 47, fib: 18, carb: 130 })
  })
})

describe('nutritionDayPlan macros', () => {
  it('gives one number per nutrient, not an interval', () => {
    const { values } = nutritionDayPlan(ready({ goal: 'lose' }), man)
    expect(values).toEqual({ kcal: 2350, carb: 263, prot: 135, fat: 78, fib: 29, sat: 26, salt: 5.75 })
    for (const key of PLAN_NUTRIENTS) expect(typeof values[key]).toBe('number')
  })

  it.each([
    ['lose', man], ['muscle', man], ['health', man], ['maintain', man], ['lose', woman]
  ])('spends the whole energy budget for %s, fibre energy included', (goal, person) => {
    const { values } = nutritionDayPlan(ready({ goal }), person)
    const spent = values.prot * 4 + values.fat * 9 + values.carb * 4 + values.fib * 2
    expect(Math.abs(spent - values.kcal)).toBeLessThanOrEqual(6)
  })

  it('raises protein for weight loss and muscle, and uses the NNR range over 70', () => {
    expect(nutritionDayPlan(ready({ goal: 'health' }), man).protein.perKg).toBe(1.1)
    expect(nutritionDayPlan(ready({ goal: 'lose' }), man).protein.perKg).toBe(1.6)
    expect(nutritionDayPlan(ready({ goal: 'muscle' }), man).protein.perKg).toBe(1.7)
    expect(nutritionDayPlan(ready({ goal: 'health' }), { ...man, age: 75 }).protein.perKg).toBe(1.35)
  })

  it('counts only 40% of the weight above BMI 25 toward protein', () => {
    expect(proteinReferenceWeight(90, 180)).toBeCloseTo(84.6, 1)
    expect(proteinReferenceWeight(70, 180)).toBe(70)
    expect(nutritionDayPlan(ready({ goal: 'lose' }), man).protein)
      .toMatchObject({ referenceWeightKg: 84.6, adjusted: true })
  })

  it('reads saturated fat and salt as ceilings, not as amounts to reach', () => {
    expect(PLAN_LIMIT.sat).toBe('max')
    expect(PLAN_LIMIT.salt).toBe('max')
    expect(PLAN_LIMIT.prot).toBe('min')
    expect(PLAN_LIMIT.fib).toBe('min')
    expect(nutritionDayPlan(ready({ goal: 'lose' }), man).values.salt).toBe(5.75)
  })
})

describe('nutritionDayPlan blockers', () => {
  const cases = [
    ['goal_missing', 'goal', {}, man],
    ['age_missing', 'age', {}, { ...man, age: null }],
    ['age_not_adult', 'clinician', {}, { ...man, age: 15 }],
    ['sex_missing', 'sex', {}, { ...man, sex: null }],
    ['height_missing', 'height', {}, { ...man, heightCm: null }],
    ['weight_missing', 'weight', {}, { ...man, weightKg: null, weightLogged: false }],
    ['weight_unit_unknown', 'weight', {}, { ...man, weightKg: null, weightLogged: true }],
    ['safety_unanswered', 'safety', { safety: { ...SAFE, pregnancyOrBreastfeeding: null } }, man],
    ['safety_expired', 'safety', { safetyReviewedAt: '2026-05-24' }, man],
    ['clinical_review', 'clinician', { safety: { ...SAFE, eatingDisorder: true } }, man]
  ]

  it.each(cases)('names %s instead of returning a bare null', (reason, fix, profile, person) => {
    const goal = reason === 'goal_missing' ? {} : { goal: 'lose' }
    const plan = nutritionDayPlan(ready({ ...goal, ...profile }), person)
    expect(plan.blocked).toEqual({ reason, fix })
    expect(plan.values).toBeNull()
  })

  it('reports the first missing piece, so one field is asked for at a time', () => {
    expect(nutritionDayPlan({}, { ...man, age: null, sex: null }).blocked.reason).toBe('goal_missing')
    expect(nutritionDayPlan(ready({ goal: 'lose' }), { ...man, age: null, sex: null }).blocked.reason).toBe('age_missing')
  })

  it('needs only the core safety questions, not the extended ones', () => {
    const plan = nutritionDayPlan({
      goal: 'lose', activityLevel: 'moderate', safetyReviewedAt: TODAY,
      safety: { ...SAFE, severeGI: null, malnutritionRisk: null, otherClinicalNutrition: null }
    }, man)
    expect(plan.blocked).toBeNull()
    expect(plan.values.kcal).toBe(2350)
  })

  it('keeps estimating while the own targets await review', () => {
    const plan = nutritionDayPlan(ready({ goal: 'lose', targetReviewRequired: true }), man)
    expect(plan.blocked).toBeNull()
    expect(plan.reviewRequired).toBe(true)
  })
})

describe('nutritionDayPlan pausing', () => {
  it('drops the nutrients a health answer pauses and keeps the rest', () => {
    const plan = nutritionDayPlan(ready({
      goal: 'lose', safety: { ...SAFE, kidneyOrProteinRestriction: true }
    }), man)
    expect(plan.values).toMatchObject({ kcal: 2350, carb: 263, prot: null, salt: null })
    expect(plan.pausedTargets).toEqual(expect.arrayContaining(['prot', 'salt']))
  })

  it('blocks the whole plan when energy itself is paused', () => {
    expect(nutritionDayPlan(ready({
      goal: 'lose', safety: { ...SAFE, hypoglycemiaRiskMedication: true }
    }), man).blocked).toEqual({ reason: 'clinical_review', fix: 'clinician' })
  })
})

describe('resolvedGoal', () => {
  const plan = nutritionDayPlan(ready({ goal: 'lose' }), man)

  it('lets an own target win over the estimate', () => {
    expect(resolvedGoal(ready({ goal: 'lose', targets: { kcal: 1800 } }), plan, 'kcal'))
      .toMatchObject({ value: 1800, source: 'own' })
    expect(resolvedGoal(ready({ goal: 'lose' }), plan, 'kcal')).toMatchObject({ value: 2350, source: 'plan' })
  })

  it('falls back to an own target when the plan is blocked', () => {
    const none = nutritionDayPlan(ready({ goal: 'lose' }), { ...man, weightKg: null })
    expect(resolvedGoal(ready({ goal: 'lose', targets: { carb: 150 } }), none, 'carb'))
      .toMatchObject({ value: 150, source: 'own' })
    expect(resolvedGoal(ready({ goal: 'lose' }), none, 'carb')).toBeNull()
  })

  it('reports a paused nutrient as paused rather than as a number', () => {
    const paused = ready({ goal: 'lose', targets: { prot: 140 }, safety: { ...SAFE, kidneyOrProteinRestriction: true } })
    expect(resolvedGoal(paused, nutritionDayPlan(paused, man), 'prot'))
      .toMatchObject({ value: null, paused: true })
  })

  it('carries the own-target review flag so the row can say why it stopped', () => {
    expect(resolvedGoal(ready({ goal: 'lose', targets: { kcal: 1800 }, targetReviewRequired: true }), plan, 'kcal'))
      .toMatchObject({ value: 1800, source: 'own', reviewRequired: true })
  })
})

describe('dayProgress', () => {
  const totals = { kcal: 1240, carb: 112.34, fib: 12, complete: { fib: false } }

  it('subtracts the day from the goal', () => {
    expect(dayProgress(totals, 'kcal', 2350)).toMatchObject({ used: 1240, left: 1110, pct: 53, over: false })
    expect(dayProgress(totals, 'carb', 263)).toMatchObject({ used: 112.3, left: 150.7 })
  })

  it('marks going over rather than clamping it away', () => {
    expect(dayProgress({ kcal: 2600, complete: {} }, 'kcal', 2350))
      .toMatchObject({ left: -250, pct: 111, over: true })
  })

  it('keeps the incomplete flag so a lower bound is never shown as a total', () => {
    expect(dayProgress(totals, 'fib', 29)).toMatchObject({ used: 12, complete: false, left: 17 })
    expect(dayProgress(totals, 'kcal', 2350).complete).toBe(true)
  })

  it('has no arithmetic to offer without a goal', () => {
    expect(dayProgress(totals, 'kcal', null)).toMatchObject({ used: 1240, goal: null, left: null, pct: null })
  })
})

describe('nutritionDayRows', () => {
  const profile = ready({ goal: 'lose' })
  const plan = nutritionDayPlan(profile, man)
  const totals = { kcal: 1240, carb: 112, prot: 78, fat: 41, fib: 12, sat: 9, salt: 3, sugar: 20, complete: {} }

  it('returns the plan nutrients in display order, headlines first', () => {
    const rows = nutritionDayRows(profile, plan, totals)
    expect(rows.slice(0, 4).map(row => row.key)).toEqual(HEADLINE_NUTRIENTS)
    expect(rows.map(row => row.key)).toEqual(PROGRESS_NUTRIENTS)
  })

  it('keeps a nutrient with only an own target and one with only a logged amount', () => {
    const rows = nutritionDayRows(ready({ goal: 'lose', targets: { sugar: 40 } }), plan, totals)
    expect(rows.find(row => row.key === 'sugar')).toMatchObject({ goal: 40, source: 'own', used: 20 })
    expect(nutritionDayRows(profile, plan, totals).find(row => row.key === 'sugar'))
      .toMatchObject({ goal: null, used: 20 })
  })

  it('drops a nutrient with neither a goal nor a logged amount', () => {
    const none = nutritionDayPlan(ready({ goal: 'lose' }), { ...man, weightKg: null })
    expect(nutritionDayRows(ready({ goal: 'lose' }), none, { complete: {} })).toEqual([])
  })
})

describe('planAsTargets', () => {
  it('produces a full target set covering every nutrient the fields hold', () => {
    const targets = planAsTargets(nutritionDayPlan(ready({ goal: 'lose' }), man))
    expect(targets).toEqual({ kcal: 2350, carb: 263, sugar: null, prot: 135, fat: 78, sat: 26, fib: 29, salt: 5.75 })
  })

  it('has nothing to adopt from a blocked plan', () => {
    expect(planAsTargets(nutritionDayPlan({}, man))).toBeNull()
    expect(planAsTargets(null)).toBeNull()
  })
})

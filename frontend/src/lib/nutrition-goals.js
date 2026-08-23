import { NUTRIENTS } from './foods.js'
import { bmr } from './nutrition.js'
import { weightIn } from './history.js'

export const NUTRITION_GOALS = ['maintain', 'lose', 'muscle', 'health']
export const NUTRIENT_TARGETS = [...NUTRIENTS]
export const INCRETIN_USES = ['none', 'weight', 'diabetes', 'both', 'other']
export const WEIGHT_PHASES = ['active_loss', 'maintenance']
export const FIBER_REFERENCES = ['range', 'female', 'male']
export const NUTRITION_SAFETY_KEYS = [
  'kidneyOrProteinRestriction', 'fluidOrSodiumRestriction',
  'pregnancyOrBreastfeeding', 'eatingDisorder', 'severeGI',
  'malnutritionRisk', 'otherClinicalNutrition', 'hypoglycemiaRiskMedication'
]

// Population references for healthy adults, not personalised intake targets.
export const NNR_REFERENCE = {
  source: 'Nordic Nutrition Recommendations 2023',
  audience: 'healthy adults',
  ranges: {
    carb: { min: 45, max: 60, unit: 'E%' },
    prot: { min: 10, max: 20, unit: 'E%' },
    fat: { min: 25, max: 40, unit: 'E%' },
    fib: { min: 3, unit: 'g/MJ' }
  }
}

const numberOf = value => typeof value === 'number'
  ? value
  : typeof value === 'string' && value.trim() ? Number(value) : NaN

const nonnegative = value => {
  const n = numberOf(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const triState = value => value === true || value === false ? value : null
const isoDayNumber = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const stamp = Date.UTC(year, month - 1, day)
  return new Date(stamp).toISOString().slice(0, 10) === value ? stamp / 86400000 : null
}
const cleanIsoDay = value => isoDayNumber(value) == null ? null : value
const allSafetyAnswered = profile => NUTRITION_SAFETY_KEYS.every(key => typeof profile.safety[key] === 'boolean')
export const nutritionSafetyToday = (now = new Date()) => now.toISOString().slice(0, 10)

/** Normalise user-entered daily targets without inventing any. */
export function cleanNutritionProfile(profile = {}) {
  profile = profile || {}
  const targets = profile.targets || {}
  return {
    goal: NUTRITION_GOALS.includes(profile.goal) ? profile.goal : null,
    targets: Object.fromEntries(NUTRIENT_TARGETS.map(key => [key, nonnegative(targets[key])])),
    condition: profile.condition === true,
    medication: profile.medication === true,
    incretinUse: INCRETIN_USES.includes(profile.incretinUse) ? profile.incretinUse : null,
    weightPhase: WEIGHT_PHASES.includes(profile.weightPhase) ? profile.weightPhase : null,
    fiberReference: FIBER_REFERENCES.includes(profile.fiberReference) ? profile.fiberReference : 'range',
    safety: Object.fromEntries(NUTRITION_SAFETY_KEYS.map(key => [key, triState(profile.safety?.[key])])),
    safetyReviewedAt: cleanIsoDay(profile.safetyReviewedAt),
    targetReviewRequired: profile.targetReviewRequired === true
  }
}

export function safetyReviewCurrent(reviewedAt, today) {
  const reviewed = isoDayNumber(reviewedAt), current = isoDayNumber(today)
  if (reviewed == null || current == null) return false
  const days = current - reviewed
  return days >= 0 && days <= 90
}

export function finalizeNutritionProfile(previous, draft, { safetyConfirmedAt = null, targetsReviewed = false } = {}) {
  const before = cleanNutritionProfile(previous)
  const next = cleanNutritionProfile(draft)
  const safetyChanged = NUTRITION_SAFETY_KEYS.some(key => before.safety[key] !== next.safety[key])
  const contextChanged = safetyChanged || before.incretinUse !== next.incretinUse ||
    before.weightPhase !== next.weightPhase || before.condition !== next.condition ||
    before.medication !== next.medication
  if (contextChanged) next.safetyReviewedAt = null
  if (cleanIsoDay(safetyConfirmedAt) && allSafetyAnswered(next)) next.safetyReviewedAt = safetyConfirmedAt

  const riskChanged = NUTRITION_SAFETY_KEYS.some(key =>
    before.safety[key] !== next.safety[key] && (before.safety[key] === true || next.safety[key] === true))
  next.targetReviewRequired = before.targetReviewRequired || next.targetReviewRequired || riskChanged
  if (targetsReviewed === true && !riskChanged) next.targetReviewRequired = false
  return next
}

/** Resting-energy estimate only; it is never copied into an intake target. */
export function bmrEstimate({ sex, age, heightCm, weightKg } = {}) {
  const values = [age, heightCm, weightKg].map(numberOf)
  const [adultAge, height, weight] = values
  if ((sex !== 'male' && sex !== 'female') || !values.every(Number.isFinite) || adultAge < 18 || adultAge > 100 || height <= 0 || weight <= 0) return null
  return bmr({ sex, age: adultAge, heightCm: height, weightKg: weight })
}

/** Convert only a weight whose unit was stored with the measurement. */
export function weightKgOf(entry) {
  return weightIn(entry, 'kg')
}

/** Medical contexts must use a complete target set supplied by the person's clinician. */
export const needsClinicianTargets = (profile, { diabetes = false } = {}) =>
  diabetes === true || (profile && (profile.condition === true || profile.medication === true)) || false

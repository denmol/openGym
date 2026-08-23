import { NUTRIENTS } from './foods.js'
import { bmr } from './nutrition.js'
import { weightIn } from './history.js'

export const NUTRITION_GOALS = ['maintain', 'lose', 'muscle', 'health']
export const NUTRIENT_TARGETS = [...NUTRIENTS]

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

/** Normalise user-entered daily targets without inventing any. */
export function cleanNutritionProfile(profile = {}) {
  profile = profile || {}
  const targets = profile.targets || {}
  return {
    goal: NUTRITION_GOALS.includes(profile.goal) ? profile.goal : null,
    targets: Object.fromEntries(NUTRIENT_TARGETS.map(key => [key, nonnegative(targets[key])])),
    condition: profile.condition === true,
    medication: profile.medication === true
  }
}

/** Resting-energy estimate only; it is never copied into an intake target. */
export function bmrEstimate({ sex, age, heightCm, weightKg } = {}) {
  const values = [age, heightCm, weightKg].map(numberOf)
  const [adultAge, height, weight] = values
  if ((sex !== 'male' && sex !== 'female') || !values.every(Number.isFinite) || adultAge < 18 || height <= 0 || weight <= 0) return null
  return bmr({ sex, age: adultAge, heightCm: height, weightKg: weight })
}

/** Convert only a weight whose unit was stored with the measurement. */
export function weightKgOf(entry) {
  return weightIn(entry, 'kg')
}

/** Medical contexts must use a complete target set supplied by the person's clinician. */
export const needsClinicianTargets = (profile, { diabetes = false } = {}) =>
  diabetes === true || (profile && (profile.condition === true || profile.medication === true)) || false

// The number you follow today.
//
// nutrition-goals.js answers what the sources say for a population: intervals, with
// citations. That is the right shape for a reference and the wrong shape for a day —
// nobody can eat 1,850–2,850 kcal. This module answers the other question, "what is my
// number today", by collapsing each interval to one planning value and then subtracting
// what has already been logged.
//
// Two rules keep that collapse honest. Energy is a point on the PAL scale rather than its
// whole width, and carbohydrate is whatever energy is left after protein, fat and fibre —
// which is how a day is actually put together, and which is what stops two independent
// percentage ranges from multiplying into a span nobody can act on.
//
// Nothing here is a treatment target. The gates that hide the estimate entirely still live
// in nutrition-goals.js; what changed is that a blocked plan now says which field is
// missing instead of returning a bare null the interface has to guess at.

import { NUTRIENTS } from './foods.js'
import {
  cleanNutritionProfile, coreSafetyAnswered, nnrRestingEnergyEstimate,
  nutritionReferenceState, nutritionSafetyToday, safetyPausedTargets, safetyReviewCurrent
} from './nutrition-goals.js'

/** Nutrients the day plan puts a number on, in the order they are shown. */
export const PLAN_NUTRIENTS = ['kcal', 'carb', 'prot', 'fat', 'fib', 'sat', 'salt']
/** The four the food screen leads with; the rest sit under "all nutrients". */
export const HEADLINE_NUTRIENTS = ['kcal', 'carb', 'prot', 'fat']
/** Every nutrient a progress row can exist for — sugar only ever has an own target. */
export const PROGRESS_NUTRIENTS = [...PLAN_NUTRIENTS, 'sugar']

/**
 * How to read each planned number. A target is something to land near, a minimum is a
 * floor to reach and a maximum is a ceiling to stay under — the difference decides both
 * the wording and whether going over is a problem.
 */
export const PLAN_LIMIT = {
  kcal: 'target', carb: 'target', prot: 'min', fat: 'target',
  fib: 'min', sat: 'max', salt: 'max', sugar: 'max'
}

// Physical activity level as a point rather than a width. "Not sure" resolves to the
// middle of the NNR 1.4–1.8 interval instead of showing the interval itself: a person who
// does not know their PAL is not helped by being handed the uncertainty to carry.
const PAL_POINT = { range: 1.6, low: 1.4, moderate: 1.6, active: 1.8 }

const LOSS_DEFICIT = 625          // midpoint of the sourced 500–750 kcal/day interval
const MUSCLE_SURPLUS = 0.125      // midpoint of the sourced 5–20% interval
const ENERGY_FLOOR = 1200         // below this the sources call for clinical review
const MICRONUTRIENT_WATCH = 1500  // below this the source identifies inadequacy risk

const FAT_ENERGY_SHARE = 0.30     // midpoint of the NNR 25–40 E% interval
const SAT_MAX_SHARE = 0.10        // NNR maximum, kept as a ceiling
const FIBRE_G_PER_MJ = 3          // NNR minimum, also the assumption behind the carb split
const FIBRE_KCAL_PER_G = 2
const SALT_MAX_G = 5.75           // NNR maximum, equivalent to 2.3 g sodium
const KCAL_PER_MJ = 239
const NNR_PROTEIN_RI = 0.83       // g/kg/day, the floor every adult figure is held above

// Protein per kg of reference weight, by what the person is working toward. Weight loss
// and muscle gain both raise the figure for the same reason — protein is what is spared or
// built while energy moves — and the over-70 range from NNR overrides a lower goal rule.
const PROTEIN_PER_KG = { maintain: 1.1, health: 1.1, lose: 1.6, muscle: 1.7 }
const PROTEIN_OVER_70 = 1.35      // midpoint of the NNR 1.2–1.5 g/kg range

const numberOf = value => typeof value === 'number'
  ? value
  : typeof value === 'string' && value.trim() ? Number(value) : NaN
const round10 = value => Math.round(value / 10) * 10
const round1 = value => Math.round(value * 10) / 10

const adultAgeOf = value => {
  const number = numberOf(value)
  return Number.isInteger(number) && number >= 18 && number <= 100 ? number : null
}
const isChildAge = value => {
  const number = numberOf(value)
  return Number.isFinite(number) && number > 0 && number < 18
}

/**
 * Body weight the protein figure is calculated from.
 *
 * Above BMI 25 the excess is counted at 40%, which is the adjusted-body-weight convention
 * the EASO reference in the catalogue already assumes. Multiplying g/kg by a weight that
 * is largely fat mass is how a protein figure ends up eating most of a reduced day.
 */
export function proteinReferenceWeight(weightKg, heightCm) {
  const weight = numberOf(weightKg), height = numberOf(heightCm)
  if (!(weight > 0) || !(height > 0)) return null
  const atBmi25 = 25 * ((height / 100) ** 2)
  return weight > atBmi25 ? atBmi25 + 0.4 * (weight - atBmi25) : weight
}

/**
 * One planning number per nutrient for a single day, or a reason there is none.
 *
 * `blocked` names the first missing piece rather than the whole list, so the interface can
 * offer one button instead of a paragraph. `weightLogged` separates "no weight recorded"
 * from "recorded before the unit was stored", which are different problems with different
 * fixes and used to look identical from here.
 */
export function nutritionDayPlan(rawProfile, {
  sex, age, heightCm, weightKg, weightLogged = false, today = nutritionSafetyToday()
} = {}) {
  const profile = cleanNutritionProfile(rawProfile)
  const pausedTargets = safetyPausedTargets(profile)
  const blocked = (reason, fix) => ({
    blocked: { reason, fix }, values: null, energy: null,
    goalBasis: null, goalStatus: null, pausedTargets,
    reviewRequired: profile.targetReviewRequired, basis: null
  })

  if (!profile.goal) return blocked('goal_missing', 'goal')
  const adultAge = adultAgeOf(age)
  if (adultAge == null) return isChildAge(age)
    ? blocked('age_not_adult', 'clinician')
    : blocked('age_missing', 'age')
  if (sex !== 'male' && sex !== 'female') return blocked('sex_missing', 'sex')
  const height = numberOf(heightCm)
  if (!(height > 0)) return blocked('height_missing', 'height')
  const weight = numberOf(weightKg)
  if (!(weight > 0)) return blocked(weightLogged ? 'weight_unit_unknown' : 'weight_missing', 'weight')
  if (!coreSafetyAnswered(profile)) return blocked('safety_unanswered', 'safety')
  if (!safetyReviewCurrent(profile.safetyReviewedAt, today)) return blocked('safety_expired', 'safety')

  const referenceState = nutritionReferenceState(profile, { age: adultAge, today })
  if (referenceState.adultStatus !== 'available') return blocked('clinical_review', 'clinician')
  if (pausedTargets.includes('kcal')) return blocked('clinical_review', 'clinician')

  const basal = nnrRestingEnergyEstimate({ sex, age: adultAge, heightCm: height, weightKg: weight })
  if (!(basal > 0)) return blocked('estimate_unavailable', 'weight')

  const pal = PAL_POINT[profile.activityLevel] ?? PAL_POINT.range
  const maintenance = round10(basal * pal)
  const bmi = weight / ((height / 100) ** 2)

  let goalBasis = 'maintenance', goalStatus = 'maintenance_estimate', planned = maintenance
  if (profile.goal === 'lose') {
    // No automatic deficit below BMI 25: there is nothing sourced to subtract from, and
    // subtracting anyway is how an app talks someone into a deficit they did not need.
    if (bmi >= 25) { planned = maintenance - LOSS_DEFICIT; goalBasis = 'loss_deficit'; goalStatus = 'planning_example' }
    else goalBasis = goalStatus = 'loss_not_applied_bmi_below_25'
  } else if (profile.goal === 'muscle') {
    planned = maintenance * (1 + MUSCLE_SURPLUS)
    goalBasis = 'muscle_surplus'
    goalStatus = 'planning_example'
  }

  // The floor is applied rather than used to cancel the plan. A woman of 160 cm asking to
  // lose weight is exactly the person this feature is for, and dropping the whole estimate
  // because the arithmetic reached 1,150 left her with nothing to follow at all.
  const floorApplied = planned < ENERGY_FLOOR
  const kcal = round10(Math.max(planned, ENERGY_FLOOR))

  const refWeight = proteinReferenceWeight(weight, height)
  const proteinPerKg = Math.max(
    PROTEIN_PER_KG[profile.goal] ?? PROTEIN_PER_KG.maintain,
    adultAge > 70 ? PROTEIN_OVER_70 : 0,
    NNR_PROTEIN_RI)
  const prot = Math.round(refWeight * proteinPerKg)
  const fat = Math.round(kcal * FAT_ENERGY_SHARE / 9)
  const sat = Math.round(kcal * SAT_MAX_SHARE / 9)
  const fib = Math.round(kcal / KCAL_PER_MJ * FIBRE_G_PER_MJ)
  // Carbohydrate is the remainder, excluding fibre energy — the same EU-label convention
  // the gram ranges in nutrition-goals.js already follow.
  const carb = Math.max(0, Math.round((kcal - prot * 4 - fat * 9 - fib * FIBRE_KCAL_PER_G) / 4))

  const values = { kcal, carb, prot, fat, fib, sat, salt: SALT_MAX_G }
  for (const key of PLAN_NUTRIENTS) if (pausedTargets.includes(key)) values[key] = null

  return {
    blocked: null,
    approximate: true,
    values,
    energy: {
      basal, pal, maintenance, plan: kcal, floorApplied,
      belowMicronutrientWatch: kcal < MICRONUTRIENT_WATCH,
      palAssumed: profile.activityLevel === 'range'
    },
    goalBasis,
    goalStatus,
    pausedTargets,
    reviewRequired: profile.targetReviewRequired,
    protein: { perKg: proteinPerKg, referenceWeightKg: round1(refWeight), adjusted: refWeight < weight },
    basis: {
      energy: { sources: ['nnr_2023_henry', 'nnr_2023_pal'], pal },
      goal: goalBasis === 'loss_deficit'
        ? { source: 'aha_acc_2026', rule: 'loss_deficit', deficitKcal: LOSS_DEFICIT }
        : goalBasis === 'muscle_surplus'
          ? { source: 'resistance_training_surplus_2023', rule: 'muscle_surplus', surplus: MUSCLE_SURPLUS }
          : { sources: ['nnr_2023_henry', 'nnr_2023_pal'] },
      protein: {
        source: 'nnr_2023',
        rule: adultAge > 70 ? 'older_adult_1_2_1_5_g_per_kg' : `goal_${profile.goal}`,
        floor: 'adult_ri_0_83_g_per_kg'
      },
      macros: {
        source: 'nnr_2023', fatShare: FAT_ENERGY_SHARE,
        carbohydrate: 'energy_remainder', fibre: 'nnr_minimum_3_g_per_mj'
      }
    }
  }
}

/**
 * The number one nutrient is followed against today.
 *
 * An own target always wins: it is the one figure a person or their care team decided on,
 * and an estimate that quietly overrode it would be the worst behaviour this screen could
 * have. A paused nutrient returns paused rather than a number, whichever of the two exists.
 */
export function resolvedGoal(rawProfile, plan, key) {
  const profile = cleanNutritionProfile(rawProfile)
  const paused = (plan?.pausedTargets || safetyPausedTargets(profile)).includes(key)
  const own = profile.targets[key]
  if (own != null) return { value: paused ? null : own, source: 'own', paused, reviewRequired: profile.targetReviewRequired }
  const planned = plan && !plan.blocked ? plan.values[key] ?? null : null
  if (planned == null) return paused ? { value: null, source: null, paused, reviewRequired: false } : null
  return { value: paused ? null : planned, source: 'plan', paused, reviewRequired: false }
}

/**
 * Intake against a goal for one nutrient.
 *
 * `complete` carries the distinction totalsOf already records: a day containing a food
 * with no fibre value has a fibre sum, but it is a lower bound rather than the total.
 * Presenting that as "18 g left" would be a number the app made up, so it travels with the
 * reading instead of being rounded away.
 */
export function dayProgress(totals, key, goal) {
  const sum = totals && typeof totals[key] === 'number' ? round1(totals[key]) : null
  const complete = totals?.complete?.[key] !== false
  const used = sum == null ? null : sum
  if (used == null || goal == null || !(goal > 0)) {
    return { key, used, complete, goal: goal ?? null, left: null, pct: null, over: false }
  }
  const left = round1(goal - used)
  return { key, used, complete, goal, left, pct: Math.round(used / goal * 100), over: left < 0 }
}

/**
 * Progress rows for a day, in display order, skipping nutrients with nothing to say.
 */
export function nutritionDayRows(profile, plan, totals, keys = PROGRESS_NUTRIENTS) {
  return keys.map(key => {
    const goal = resolvedGoal(profile, plan, key)
    const row = dayProgress(totals, key, goal?.value ?? null)
    return {
      ...row,
      limit: PLAN_LIMIT[key] || 'target',
      source: goal?.source ?? null,
      paused: goal?.paused === true,
      reviewRequired: goal?.reviewRequired === true
    }
  }).filter(row => row.goal != null || row.paused || row.used != null)
}

// Energy is never worth a decimal — "1 701.4 kcal left" is false precision on a figure
// built from an estimate. Salt keeps two, because its whole reference is 5.75 g.
const DIGITS = { kcal: 0, salt: 2 }

/** One planned or logged amount, at the precision that nutrient is actually known to. */
export const formatPlanAmount = (value, key, locale = 'en-GB') =>
  Number(value).toLocaleString(locale, { maximumFractionDigits: DIGITS[key] ?? 1 })

/** The prefix that makes a floor read as a floor and a ceiling as a ceiling. */
export const limitPrefix = key => PLAN_LIMIT[key] === 'max' ? '≤ ' : PLAN_LIMIT[key] === 'min' ? '≥ ' : ''

/** Plan values as a target set, ready to be stored as the person's own targets. */
export function planAsTargets(plan) {
  if (!plan || plan.blocked) return null
  return Object.fromEntries(NUTRIENTS.map(key => [key, plan.values[key] ?? null]))
}

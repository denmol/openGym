// What the food log can say to the trainer.
//
// The trainer's findings come from the training log; this adds the two things the food log
// can check against a goal — protein, and whether body weight is moving the way the goal
// needs — and nothing it cannot. It reads only what was logged, and it says nothing from a
// handful of days: a day counts only when it looks like a whole day of eating, so a person who
// logs breakfast and forgets the rest is not told they eat 20 g of protein.
//
// It stays out of the way of anyone for whom "eat more protein" or "gain weight" is not
// generic advice: a minor, an eating-disorder or kidney flag, any other nutrition-safety flag.
// A medical condition on the profile also keeps it quiet, except on a clinician instance,
// where the person reading it makes that call themselves.

import { foodMap } from './foods.js'
import { dayTotals, nutrientTotal } from './nutrition.js'
import { weightIn } from './history.js'
import { isoOf } from './format.js'
import { coachProfileOf } from './coach-profile.js'
import { CLINICIAN } from './clinician.js'

const DAY = 86400000
export const FOOD_WINDOW_DAYS = 14
export const MIN_FOOD_DAYS = 5          // whole days logged before an average means anything
export const MIN_DAY_KCAL = 800         // under this a day is a partial log, not a day of eating
export const PROTEIN_GKG = 1.6          // where extra gain stopped in the cited meta-analysis
const WEIGHT_STALE_DAYS = 60            // an older weigh-in says nothing about today's g/kg

/** The latest body weight in kg, if it is recent enough to divide by. */
export function bodyKg(S, now = Date.now()) {
  const last = (S.bodyweight || []).slice().sort((a, b) => (a.t || new Date(a.d + 'T12:00:00').getTime()) - (b.t || new Date(b.d + 'T12:00:00').getTime())).pop()
  if (!last) return null
  const t = last.t || new Date(last.d + 'T12:00:00').getTime()
  const kg = weightIn(last, 'kg')
  return kg && now - t <= WEIGHT_STALE_DAYS * DAY ? kg : null
}

/** True when advice about eating more, or gaining weight, should not be given at all. */
export function foodAdviceBlocked(S) {
  const age = coachProfileOf(S).age
  if (age == null || age < 18) return true
  const goals = S.nutritionGoals
  if (goals && goals.safety && Object.values(goals.safety).some(v => v === true)) return true
  if (goals && goals.condition === true && !CLINICIAN) return true
  return false
}

/**
 * Average protein over the whole days logged in the `window` days up to `now`:
 * { days, avgG, gPerKg, kg } or null when there are fewer than `minDays` such days or no
 * usable body weight.
 */
export function proteinIntake(S, now = Date.now(), window = FOOD_WINDOW_DAYS, minDays = MIN_FOOD_DAYS) {
  const kg = bodyKg(S, now)
  if (!kg) return null
  const foods = foodMap(S)
  let days = 0, sum = 0
  for (let i = 0; i < window; i++) {
    const tot = dayTotals(S, isoOf(new Date(now - i * DAY)), foods)
    const kcal = nutrientTotal(tot, 'kcal'), prot = nutrientTotal(tot, 'prot')
    if (kcal != null && prot != null && kcal >= MIN_DAY_KCAL) { days++; sum += prot }
  }
  if (days < minDays) return null
  const avgG = sum / days
  return { days, avgG, gPerKg: avgG / kg, kg }
}

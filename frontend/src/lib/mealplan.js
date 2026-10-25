// A week of meals, put together from the meals this person has already saved.
//
// No model is involved and no nutrient figure is invented. Every number comes from the
// person's own foods (lib/foods.js) scaled by grams, and is compared with the same daily
// targets the Food screen already shows (lib/nutrition-plan.js). What this adds is a search:
// for each day, which saved meals — and in which portion size — land that day closest to the
// targets, without serving the same thing every day.
//
// Who gets a schedule is decided by the rules the nutrition assistant already follows
// (nutritionAiGate): an unanswered or expired safety review, a medical condition, medication,
// diabetes mode, a weight-loss drug or a paused target all mean no schedule is generated, and
// the screen says to take it to a clinician or dietitian. A schedule that sets a carbohydrate
// amount for each meal is close enough to dosing that it is not generated for those accounts.
//
// A saved meal is only used when it is complete for energy, protein, carbohydrate and fat. A
// food with a missing value would make the day's total a lower bound presented as a number
// (see totalsOf), so those meals are left out and counted, not guessed at.
//
// The plan stores references — meal id, portion — not copies of the meals, so editing a saved
// meal updates the week. Logging a planned meal writes the grams actually eaten, like any
// other log entry.

import { totalsOf, nutrientTotal, scaleItems, newMeal, MEAL_KINDS } from './nutrition.js'
import { foodMap } from './foods.js'
import {
  cleanNutritionProfile, nutritionAiGate, nutritionSafetyToday, weightKgOf
} from './nutrition-goals.js'
import { nutritionDayPlan, resolvedGoal } from './nutrition-plan.js'
import { coachProfileOf } from './coach-profile.js'
import { diabetesOn } from './diabetes.js'
import { lastBW } from './history.js'
import { isoOf, todayISO } from './format.js'

export const PLAN_DAYS = 7
export const SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2]
// Share of the day's energy each slot is asked to carry. Renormalised over the slots that
// have at least one saved meal to fill them.
const SHARE = { breakfast: 0.25, lunch: 0.30, dinner: 0.30, snack: 0.15 }
const TARGET_KEYS = ['kcal', 'prot', 'carb', 'fat', 'fib', 'sat', 'salt']
const NEED_COMPLETE = ['kcal', 'prot', 'carb', 'fat']
export const CLOSE_PCT = 10          // a day counts as "on target" within this much of its energy
const MIN_MEALS_FOR_VARIETY = 4
// What serving the same meal in the same slot costs, by how many days ago it was last served.
const RECENCY = [0.2, 0.12, 0.06]

// Typical clock time per slot, for a planned meal logged for a day that is not today.
const TYPICAL_TIME = { breakfast: '08:00', lunch: '12:30', dinner: '18:30', snack: '15:30' }

/* ------------------------------- the gate ------------------------------- */

/**
 * The day's targets, or the reason there is no schedule to make.
 * @returns {{ ok: true, targets }|{ ok: false, reason, fix }}
 */
export function mealPlanTargets(S, today = nutritionSafetyToday()) {
  const goals = cleanNutritionProfile(S.nutritionGoals)
  const person = coachProfileOf(S)
  // The same bar as the AI assistant: anything medical goes to a person, not to a generator.
  if (nutritionAiGate(goals, { age: person.age, today, diabetes: diabetesOn(S) })) {
    return { ok: false, reason: 'review', fix: 'clinician' }
  }
  const bw = lastBW({ bodyweight: S.bodyweight || [] })
  const plan = nutritionDayPlan(goals, {
    sex: person.sex, age: person.age, heightCm: person.heightCm,
    weightKg: weightKgOf(bw), weightLogged: !!bw, today
  })
  const targets = {}
  for (const key of TARGET_KEYS) {
    const g = resolvedGoal(goals, plan, key)
    if (g && g.paused) return { ok: false, reason: 'paused', fix: 'clinician' }
    targets[key] = g && g.value != null ? g.value : null
  }
  if (targets.kcal == null) {
    return { ok: false, reason: plan.blocked ? plan.blocked.reason : 'no_energy', fix: plan.blocked ? plan.blocked.fix : 'goal' }
  }
  return { ok: true, targets }
}

/* ------------------------------- the candidates ------------------------------- */

/**
 * Saved meals that can be scheduled, grouped by the slot they can fill. Lunch and dinner
 * share a pool — a saved "pasta bake" is a fine lunch — but a meal is nudged toward its own.
 */
export function candidateMeals(S, foods = foodMap(S)) {
  const usable = [], excluded = []
  for (const m of S.myMeals || []) {
    const items = (m.items || []).filter(i => i && i.fid && Number(i.g) > 0)
    const tot = totalsOf(items, foods)
    const complete = items.length > 0 && NEED_COMPLETE.every(k => nutrientTotal(tot, k) != null)
    if (!complete || !(tot.kcal > 0)) { excluded.push({ id: m.id, n: m.n, why: items.length ? 'incomplete' : 'empty' }); continue }
    usable.push({ id: m.id, n: m.n, kind: MEAL_KINDS.includes(m.kind) ? m.kind : 'lunch', items })
  }
  const pool = {
    breakfast: usable.filter(m => m.kind === 'breakfast'),
    snack: usable.filter(m => m.kind === 'snack'),
    lunch: usable.filter(m => m.kind === 'lunch' || m.kind === 'dinner'),
    dinner: usable.filter(m => m.kind === 'lunch' || m.kind === 'dinner')
  }
  return { usable, excluded, pool }
}

/* ------------------------------- scoring ------------------------------- */

const sq = x => x * x
/**
 * How far a day is from its targets, 0 being exactly on them. Energy matters most. Protein,
 * fibre are floors (only falling short counts), saturated fat and salt are ceilings (only
 * going over counts), carbohydrate and fat are targets in both directions.
 */
export function dayLoss(totals, t) {
  let loss = 6 * sq((totals.kcal - t.kcal) / t.kcal)
  if (t.prot != null) loss += 3 * sq(Math.max(0, t.prot - totals.prot) / t.prot)
  if (t.carb != null) loss += sq((totals.carb - t.carb) / t.carb)
  if (t.fat != null) loss += sq((totals.fat - t.fat) / t.fat)
  if (t.fib != null) loss += 0.5 * sq(Math.max(0, t.fib - totals.fib) / t.fib)
  if (t.sat != null) loss += 0.5 * sq(Math.max(0, totals.sat - t.sat) / t.sat)
  if (t.salt != null) loss += 0.5 * sq(Math.max(0, totals.salt - t.salt) / t.salt)
  return loss
}

// A stable pseudo-random number in [0, 1) from a string, so "shuffle" is a different plan
// and the same seed is always the same plan.
function hash01(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 100000) / 100000
}

const add = (a, b) => ({
  kcal: a.kcal + b.kcal, prot: a.prot + b.prot, carb: a.carb + b.carb, fat: a.fat + b.fat,
  fib: a.fib + b.fib, sat: a.sat + b.sat, salt: a.salt + b.salt
})
const ZERO = { kcal: 0, prot: 0, carb: 0, fat: 0, fib: 0, sat: 0, salt: 0 }
const pick = t => ({ kcal: t.kcal || 0, prot: t.prot || 0, carb: t.carb || 0, fat: t.fat || 0, fib: t.fib || 0, sat: t.sat || 0, salt: t.salt || 0 })

/* ------------------------------- the search ------------------------------- */

/**
 * Plan `days` days starting at `start` (ISO). Returns the stored plan plus what was left out
 * and any caveats, or the reason nothing could be made.
 *
 * @param opts.seed   a different seed gives a different but equally valid week
 * @param opts.today  safety-review date, injectable for tests
 */
export function generateMealPlan(S, { start = todayISO(), days = PLAN_DAYS, seed = 0, today = nutritionSafetyToday() } = {}) {
  const gate = mealPlanTargets(S, today)
  if (!gate.ok) return { ok: false, reason: gate.reason, fix: gate.fix }
  const targets = gate.targets
  const foods = foodMap(S)
  const { usable, excluded, pool } = candidateMeals(S, foods)
  if (!pool.lunch.length) return { ok: false, reason: usable.length ? 'no_main_meals' : 'no_meals', fix: 'meals', excluded }

  const slots = ['breakfast', 'lunch', 'dinner', 'snack'].filter(k => pool[k].length)
  const total = slots.reduce((a, k) => a + SHARE[k], 0)
  const share = Object.fromEntries(slots.map(k => [k, SHARE[k] / total]))

  // Every (meal, portion) a slot can take, with its numbers worked out once.
  const options = {}
  for (const k of slots) {
    options[k] = []
    for (const m of pool[k]) for (const sc of SCALES) {
      const tot = totalsOf(scaleItems(m.items, sc), foods)
      options[k].push({ id: m.id, kind: m.kind, scale: sc, t: pick(tot) })
    }
  }

  const used = {}            // meal id -> times used so far this week
  const recent = {}          // slot -> meal ids on the previous days, most recent first
  for (const k of slots) recent[k] = []
  const out = []

  for (let i = 0; i < days; i++) {
    const d = isoOf(new Date(new Date(start + 'T12:00:00').getTime() + i * 86400000))
    const jitter = o => 0.004 * hash01(seed + '|' + i + '|' + o.id + '|' + o.scale)
    const penalty = (k, o, chosen) => {
      // Variety is a cost, not a rule: a good fit can still repeat when there is little else to
      // serve. The nearer the last time, the more it costs, and every use this week adds to it.
      let p = 0.05 * (used[o.id] || 0)
      const back = recent[k].indexOf(o.id)
      if (back >= 0) p += RECENCY[back]
      if (slots.some(s => s !== k && chosen[s] && chosen[s].id === o.id)) p += 0.06
      if (k !== 'breakfast' && k !== 'snack' && o.kind !== k) p += 0.02       // a lunch served as dinner
      return p + jitter(o)
    }

    // Start each slot at the portion nearest its share of the day's energy…
    const chosen = {}
    for (const k of slots) {
      const want = targets.kcal * share[k]
      chosen[k] = options[k].reduce((best, o) => {
        const s = sq((o.t.kcal - want) / want) + penalty(k, o, chosen)
        return !best || s < best.s ? { o, s } : best
      }, null).o
    }
    // …then improve one slot at a time against the whole day until nothing gets better.
    const score = () => dayLoss(slots.reduce((a, k) => add(a, chosen[k].t), ZERO), targets) +
      slots.reduce((a, k) => a + penalty(k, chosen[k], chosen), 0)
    let best = score()
    for (let pass = 0; pass < 8; pass++) {
      let changed = false
      for (const k of slots) {
        for (const o of options[k]) {
          if (o === chosen[k]) continue
          const prev = chosen[k]
          chosen[k] = o
          const s = score()
          if (s < best - 1e-9) { best = s; changed = true } else chosen[k] = prev
        }
      }
      if (!changed) break
    }

    out.push({ d, slots: slots.map(k => ({ kind: k, id: chosen[k].id, scale: chosen[k].scale })) })
    for (const k of slots) {
      recent[k] = [chosen[k].id, ...recent[k]].slice(0, RECENCY.length)
      used[chosen[k].id] = (used[chosen[k].id] || 0) + 1
    }
  }

  const plan = { v: 1, start, seed, created: todayISO(), days: out }
  const summary = summarize(S, plan, targets)
  return { ok: true, plan, targets, excluded, warnings: planCaveats(S, summary), summary }
}

/**
 * What to tell the person about how far to trust a plan: slots it could not fill, meals it
 * had to leave out, too few meals to avoid repeats, and a fit that is not close.
 */
export function planCaveats(S, summary, foods = foodMap(S)) {
  const { usable, excluded, pool } = candidateMeals(S, foods)
  const w = []
  if (!pool.breakfast.length) w.push('no_breakfast')
  if (!pool.snack.length) w.push('no_snack')
  if (usable.length < MIN_MEALS_FOR_VARIETY) w.push('few_meals')
  if (excluded.length) w.push('excluded')
  if (summary && summary.avgKcalDeviation > 15) w.push('poor_fit')
  return w
}

/* ------------------------------- reading a plan back ------------------------------- */

/** One day of a stored plan, resolved against the meals as they are now. */
export function resolveDay(S, day, foods = foodMap(S)) {
  const meals = Object.fromEntries((S.myMeals || []).map(m => [m.id, m]))
  let totals = { ...ZERO }, complete = true
  const slots = day.slots.map(s => {
    const m = meals[s.id]
    if (!m) { complete = false; return { ...s, missing: true, name: null, t: null } }
    const t = pick(totalsOf(scaleItems(m.items, s.scale), foods))
    totals = add(totals, t)
    return { ...s, name: m.n, t }
  })
  return { d: day.d, slots, totals, complete }
}

/** How well a plan meets its targets: the honest numbers, not a verdict. */
export function summarize(S, plan, targets, foods = foodMap(S)) {
  const days = plan.days.map(d => resolveDay(S, d, foods))
  const dev = days.map(d => Math.abs(d.totals.kcal - targets.kcal) / targets.kcal * 100)
  return {
    days: days.length,
    closeDays: dev.filter(x => x <= CLOSE_PCT).length,
    avgKcalDeviation: dev.length ? Math.round(dev.reduce((a, b) => a + b, 0) / dev.length * 10) / 10 : 0,
    proteinDays: targets.prot == null ? null : days.filter(d => d.totals.prot >= targets.prot).length,
    distinctMeals: new Set(plan.days.flatMap(d => d.slots.map(s => s.id))).size
  }
}

/** Everything the week needs, summed per food, in grams. */
export function shoppingList(S, plan, foods = foodMap(S)) {
  const meals = Object.fromEntries((S.myMeals || []).map(m => [m.id, m]))
  const grams = {}
  for (const day of plan.days) for (const s of day.slots) {
    const m = meals[s.id]
    if (!m) continue
    for (const it of scaleItems(m.items, s.scale)) grams[it.fid] = (grams[it.fid] || 0) + it.g
  }
  return Object.entries(grams)
    .map(([fid, g]) => ({ fid, name: foods[fid] ? foods[fid].n : fid, g }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'sv'))
}

/* ------------------------------- changing a plan ------------------------------- */

/**
 * Log one planned meal as eaten. Marks the slot so it can't be logged twice by a double tap.
 * `s` is a draft of the state. Returns false when there is nothing to log (meal deleted, or
 * already logged).
 */
export function logPlannedMeal(s, dayIndex, slotIndex, now = new Date()) {
  const day = s.mealPlan && s.mealPlan.days[dayIndex]
  const slot = day && day.slots[slotIndex]
  if (!slot || slot.logged) return false
  const m = (s.myMeals || []).find(x => x.id === slot.id)
  if (!m) return false
  const items = scaleItems(m.items, slot.scale)
  const t = day.d === isoOf(now) ? String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') : TYPICAL_TIME[slot.kind]
  ;(s.meals = s.meals || []).push({ id: 'pm' + Date.now().toString(36) + dayIndex + slotIndex, ...newMeal({ kind: slot.kind, items, d: day.d, t }) })
  slot.logged = true
  return true
}

/** Re-plan one day, keeping the rest. A different `seed` gives a different day. */
export function reshuffleDay(S, plan, dayIndex, seed) {
  const gate = generateMealPlan(S, { start: plan.days[dayIndex].d, days: 1, seed })
  if (!gate.ok) return gate
  const days = plan.days.map((d, i) => (i === dayIndex ? gate.plan.days[0] : d))
  return { ok: true, plan: { ...plan, days }, targets: gate.targets }
}

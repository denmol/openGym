// Turning logged meals into numbers.
//
// Carbohydrate is the headline for anyone counting it, so it is never rounded away: totals
// keep one decimal where the number is small enough for it to matter and the display layer
// decides how to show it. Everything is per 100 g in the catalogue and scaled by grams here
// — there is no other unit in the model, which is what keeps this arithmetic boring.

import { NUTRIENTS } from './foods.js'
import { todayISO } from './format.js'

export const MEAL_KINDS = ['breakfast', 'lunch', 'dinner', 'snack']
// English source strings double as i18n keys.
export const MEAL_NAME = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack'
}

const zero = () => NUTRIENTS.reduce((o, k) => { o[k] = 0; return o }, {})
// One decimal is the resolution that matters: 41.5 g of carbohydrate is a different dose
// decision from 41 g, while 41.53 is false precision on a food weighed to the nearest gram.
const round1 = n => Math.round(n * 10) / 10

/**
 * Nutrients for a list of { fid, g } items.
 * A food the catalogue no longer knows contributes nothing rather than throwing — a meal
 * logged before a rebuild should still show the rest of its plate.
 */
export function totalsOf(items, foods) {
  const out = zero()
  for (const it of items || []) {
    const f = foods && foods[it.fid]
    const g = Number(it.g) || 0
    if (!f || !f.per100 || !g) continue
    for (const k of NUTRIENTS) {
      const v = Number(f.per100[k])
      if (Number.isFinite(v)) out[k] += v * g / 100
    }
  }
  for (const k of NUTRIENTS) out[k] = round1(out[k])
  return out
}

/** Nutrients for one logged meal. */
export const mealTotals = (meal, foods) => totalsOf(meal && meal.items, foods)

/** Every meal logged on a date, in the order they were eaten. */
export function mealsOn(st, iso) {
  return (st.meals || []).filter(m => m.d === iso)
    .slice()
    .sort((a, b) => String(a.t || '').localeCompare(String(b.t || '')))
}

/** Nutrients for a whole day. */
export function dayTotals(st, iso, foods) {
  const items = mealsOn(st, iso).flatMap(m => m.items || [])
  return totalsOf(items, foods)
}

/** Was anything logged that day? Used to tell "0 g" apart from "nothing yet". */
export const hasMeals = (st, iso) => mealsOn(st, iso).length > 0

/**
 * Scale a saved meal's items by a factor, rounding grams to whole numbers.
 *
 * The scale is applied when the meal is logged rather than stored on the entry: what ends up
 * in the log is the grams actually eaten, so a later edit of the template cannot silently
 * rewrite what last Tuesday's breakfast was.
 */
export function scaleItems(items, factor) {
  const f = Number(factor) || 1
  return (items || []).map(it => ({ fid: it.fid, g: Math.max(1, Math.round((Number(it.g) || 0) * f)) }))
}

/** A fresh meal entry, ready to store. */
export function newMeal({ kind, items, note, d, t } = {}) {
  const now = new Date()
  return {
    d: d || todayISO(),
    t: t || String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'),
    kind: MEAL_KINDS.includes(kind) ? kind : kindForNow(now),
    items: (items || []).filter(i => i && i.fid && Number(i.g) > 0),
    ...(note ? { note: String(note).slice(0, 200) } : {})
  }
}

/** Which meal it probably is, by the clock. Saves a tap four times a day. */
export function kindForNow(d = new Date()) {
  const h = d.getHours()
  if (h < 10) return 'breakfast'
  if (h < 14) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

/**
 * Energy the body used, as far as this can be known without measuring it.
 *
 * Mifflin–St Jeor, which needs exactly the four fields the coach profile already collects.
 * This is a starting value only: once there is enough weight and intake history it is
 * replaced by the measured figure, because a formula that is never corrected is a guess
 * repeated confidently. See measuredExpenditure.
 */
export function bmr({ sex, age, heightCm, weightKg }) {
  const w = Number(weightKg), h = Number(heightCm), a = Number(age)
  if (!(w > 0 && h > 0 && a > 0)) return null
  const base = 10 * w + 6.25 * h - 5 * a
  return Math.round(base + (sex === 'female' ? -161 : 5))
}

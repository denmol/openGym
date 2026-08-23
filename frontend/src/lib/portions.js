// Logging food without weighing it.
//
// Everything in the catalogue is per 100 g, so every amount has to become grams sooner or
// later. The question is only who does the converting, and how honestly.
//
// A gram weight for "1 egg" lands straight in the carbohydrate figure that someone counts
// against. Inventing one would be the same mistake as inventing a nutrient value, just one
// step further from the packet. So this is built in three layers, and only the outermost
// one contains an estimate:
//
//   1. DEFINITIONS. A Swedish dl is 100 ml, msk 15 ml, tsk 5 ml, krm 1 ml. Those are not
//      opinions. Millilitres become grams through a density, which is 1.0 unless the food
//      says otherwise — right for milk, juice and stock to within a few percent, wrong for
//      oil and honey, and adjustable per food for exactly that reason.
//
//   2. WEIGHED ONCE. The user puts one egg on the scale, once, ever, and from then on "1 st"
//      is their egg and their number. This is the layer that should carry most of the daily
//      logging, and it contains nothing anybody guessed.
//
//   3. SUGGESTED. A short list of conventional household weights so the app is useful on
//      day one. Every one of them is shown with a ≈ and the gram figure next to it, never
//      as a bare count, and one tap replaces it with a weighed number. The ones that vary
//      most between brands and loaves are flagged so the app can say so out loud.
//
// And a fourth thing that is not a layer at all but does more work than any of them: the
// amount you last logged for a food becomes its default next time. No estimate, no setup,
// no table — it just stops asking you the same question every morning.

import { uid } from './format.js'

/* ------------------------------------------------------------ the units --- */

// Volume in millilitres. Swedish kitchen measures, which are defined amounts.
export const VOLUME = { dl: 100, msk: 15, tsk: 5, krm: 1 }

// Units that count things rather than measure them. These have no weight until someone
// gives them one — there is no such thing as the weight of "a slice" in general.
export const COUNT_UNITS = ['st', 'skiva', 'portion', 'bit']

// English source strings double as i18n keys; the abbreviations are the same in both.
export const UNIT_LABEL = {
  g: 'g', dl: 'dl', msk: 'tbsp', tsk: 'tsp', krm: 'ml',
  st: 'pcs', skiva: 'slice', portion: 'portion', bit: 'piece'
}

// Grams per millilitre, for the foods where assuming water is wrong by enough to matter.
//
// This is where a spoonful of oil gets its weight, rather than from a table of spoonful
// weights: one density covers dl, msk, tsk and krm at once and cannot disagree with itself,
// which a list of per-spoon weights very much can. For the liquids these are physical
// constants; for sugar and flour they are the conventional Swedish dl-weights, which is a
// packing figure and varies with how hard you scoop.
export const DENSITY = [
  { words: ['rapsolja', 'olivolja', 'matolja', 'olja'], d: 0.92 },
  { words: ['smör', 'margarin'],                        d: 0.96 },
  { words: ['honung'],                                  d: 1.42 },
  { words: ['sirap'],                                   d: 1.33 },
  { words: ['socker', 'strösocker'],                    d: 0.85, vary: true },
  { words: ['vetemjöl', 'mjöl'],                        d: 0.60, vary: true },
  { words: ['mjölk', 'fil', 'yoghurt'],                 d: 1.03 },
]

/** The density to use for a food: its own, then the table, then water. */
export function densityFor(food) {
  const own = Number(food && food.density)
  if (Number.isFinite(own) && own > 0) return { d: own, own: true }
  let best = null, bestLen = 0
  for (const e of DENSITY) {
    for (const w of e.words) {
      if (w.length > bestLen && hasWord(food && food.n, w)) { best = e; bestLen = w.length }
    }
  }
  return best ? { d: best.d, vary: !!best.vary } : { d: 1, water: true }
}

/** Grams for a volume unit of this food. */
export const volumeGrams = (unit, food) => {
  const ml = VOLUME[unit]
  if (!ml) return null
  return Math.round(ml * densityFor(food).d)
}

/* -------------------------------------------------------------- suggested -- */

// Conventional weights for things that are counted rather than measured, so the app is not
// useless before anything has been weighed. Counts only: anything measured in dl or msk gets
// its weight from DENSITY above, so that a spoon never has two weights depending on which
// table answered first.
//
// Matched on whole words in the food's name, longest match first. Every entry is an
// estimate and the UI never hides that: it prints "1 st ≈ 58 g", and tapping the weight
// replaces it with a real one.
//
// `vary` marks the ones where the spread between brands, loaves and greengrocers is wide
// enough that the number is close to meaningless — a slice of crispbread and a slice of
// dense rye differ by a factor of four. The UI pushes harder to weigh those.
export const SUGGESTED = [
  { words: ['ägg', 'hönsägg'],            unit: 'st',      g: 58 },
  { words: ['knäckebröd'],                unit: 'skiva',   g: 10 },
  { words: ['bröd', 'limpa', 'formfranska', 'rågbröd'], unit: 'skiva', g: 35, vary: true },
  { words: ['banan'],                     unit: 'st',      g: 120, vary: true },
  { words: ['äpple'],                     unit: 'st',      g: 130, vary: true },
  { words: ['apelsin'],                   unit: 'st',      g: 150, vary: true },
  { words: ['potatis'],                   unit: 'st',      g: 85,  vary: true },
  { words: ['morot'],                     unit: 'st',      g: 65,  vary: true },
  { words: ['tomat'],                     unit: 'st',      g: 100, vary: true },
]

const norm = s => String(s || '').toLowerCase()
  .replace(/[^a-zåäö0-9]+/g, ' ').trim()

/**
 * Does the food's name contain this keyword as a word of its own?
 *
 * Swedish puts the head of a compound last — rapsolja, filmjölk, knäckebröd — so a suffix
 * match is what finds "olja" inside "solrosolja", where a prefix match finds nothing. A
 * prefix still catches plurals (banan → bananer). Both are length-gated, because three
 * letters matching either end of a word is how "fil" ends up inside "filé".
 */
const hasWord = (name, w) => norm(name).split(' ').some(x =>
  x === w || (w.length >= 4 && x.endsWith(w)) || (w.length >= 5 && x.startsWith(w)))

/**
 * The suggested portion for a food, or null.
 *
 * Longest keyword first, so "knäckebröd" is not read as "bröd" and given a 35 g slice.
 */
export function suggestedFor(food) {
  if (!food || !food.n) return null
  let best = null, bestLen = 0
  for (const s of SUGGESTED) {
    for (const w of s.words) {
      if (w.length > bestLen && hasWord(food.n, w)) { best = s; bestLen = w.length }
    }
  }
  if (!best) return null
  return { id: 'sug:' + best.unit, n: best.unit, g: best.g, suggested: true, vary: !!best.vary }
}

/* --------------------------------------------------------------- storage -- */

/** A portion the user weighed, ready to store. */
export function newPortion({ fid, n, g } = {}) {
  const grams = Math.round(Number(g))
  const name = String(n || '').trim().slice(0, 24)
  if (!fid || !name || !Number.isFinite(grams) || grams < 1 || grams > 5000) return null
  return { id: 'p' + uid(), fid: String(fid), n: name, g: grams }
}

/** This food's own weighed portions, in the order they were added. */
export const ownPortionsFor = (S, fid) => ((S && S.portions) || []).filter(p => p.fid === fid)

/**
 * Every amount unit offered for a food: grams, then what the user weighed, then the
 * suggestion if nothing they weighed already covers that unit, then the kitchen measures.
 *
 * A weighed portion always beats a suggestion of the same name — that is the whole point of
 * having weighed it, and a list showing both "1 st = 61 g" and "1 st ≈ 58 g" would be a bug
 * the user has to think about.
 */
export function unitsFor(S, food) {
  if (!food) return [{ id: 'g', n: 'g', g: 1, base: true }]
  const own = ownPortionsFor(S, food.id)
  const out = [{ id: 'g', n: 'g', g: 1, base: true }, ...own]
  const sug = suggestedFor(food)
  if (sug && !own.some(p => p.n === sug.n)) out.push(sug)
  for (const u of Object.keys(VOLUME)) {
    if (own.some(p => p.n === u)) continue
    out.push({ id: 'v:' + u, n: u, g: volumeGrams(u, food), volume: true })
  }
  return out
}

/** Look one up in that list, falling back to grams so a deleted portion cannot break a row. */
export const unitById = (S, food, id) =>
  unitsFor(S, food).find(u => u.id === id) || { id: 'g', n: 'g', g: 1, base: true }

/** Grams for a quantity of a unit. Never rounds a real amount down to nothing. */
export function gramsOf(unit, q) {
  const n = Number(q)
  if (!unit || !Number.isFinite(n) || n <= 0) return 0
  return Math.max(1, Math.round(unit.g * n))
}

/* ------------------------------------------------------------ what's usual -- */

/**
 * The amount last logged for each food.
 *
 * Derived from the log rather than stored beside it, so it cannot drift out of step with
 * what actually happened, and so deleting a meal takes its influence with it. This is the
 * part that removes the most typing: after the first week, most foods open at the amount
 * you always eat.
 */
export function lastAmounts(S) {
  const out = {}
  const meals = ((S && S.meals) || []).slice()
    .sort((a, b) => (a.d === b.d ? String(a.t || '').localeCompare(String(b.t || '')) : a.d < b.d ? -1 : 1))
  for (const m of meals) {
    for (const it of m.items || []) {
      if (!it || !it.fid) continue
      out[it.fid] = { g: it.g, u: it.u || 'g', q: it.q ?? it.g }
    }
  }
  return out
}

/**
 * How a food's amount field should open: what you used last, else one of whatever unit the
 * food has, else 100 g. 100 g is a poor default for an egg and a fine one for mince, which
 * is why it is the last resort rather than the first.
 */
export function defaultAmount(S, food, last) {
  const prev = last && last[food.id]
  if (prev && prev.g > 0) {
    const u = unitById(S, food, prev.u)
    // A portion that has been deleted or reweighed since falls back to the plain grams,
    // which are what was eaten either way.
    if (u.id === prev.u) return { unit: u, q: prev.q > 0 ? prev.q : prev.g }
    return { unit: unitById(S, food, 'g'), q: prev.g }
  }
  const units = unitsFor(S, food)
  const first = units.find(u => !u.base && !u.volume && u.g > 0)
  return first ? { unit: first, q: 1 } : { unit: units[0], q: 100 }
}

/** How an item reads back on a meal row: "2 st (116 g)" or just "116 g". */
export function amountLabel(item, unitName) {
  if (!item) return ''
  const q = Number(item.q)
  if (!item.u || item.u === 'g' || !Number.isFinite(q) || q <= 0) return `${item.g} g`
  const n = Math.round(q * 100) / 100
  return `${n} ${unitName} (${item.g} g)`
}

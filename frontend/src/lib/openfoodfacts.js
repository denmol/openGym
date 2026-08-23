// Reading a packet's own numbers off Open Food Facts.
//
// Livsmedelsverket has "Bröd, rågbröd, mjukt". It does not have Pågen Lantbröd Original,
// and neither does any other national food table — branded products are not what those are
// for. Open Food Facts is, and it is keyed by the barcode that is already printed on the
// thing in your hand.
//
// WHAT THIS DATA IS, AND IS NOT
//
// Livsmedelsverket's values come from a laboratory. These come from a volunteer typing in
// what a packet said, some of them years ago, some for a different pack size, some wrong.
// That is a different class of number and the app never pretends otherwise: a scanned
// product is shown for confirmation against the packet before it is saved, and it is saved
// as one of the user's OWN foods, not into the catalogue. After that first look it is their
// number and nobody else's.
//
// The confirmation is not friction bolted on for safety's sake. When you scan a barcode you
// are holding the packet, with its nutrition table facing you. Checking is one glance at
// something already in your hand, which is the cheapest verification this app has anywhere.
//
// A NOTE ON CARBOHYDRATE
//
// Open Food Facts stores what the label declared. EU labels state carbohydrate EXCLUDING
// fibre, which is the convention Livsmedelsverket uses and the one carb counting wants, so
// values from European products line up with the rest of the catalogue. A product entered
// from a US label does not — American labels count fibre inside carbohydrate. There is no
// field saying which convention a given entry used, so this cannot be corrected in code.
// It is one more reason the packet gets the final word.

/* ------------------------------------------------------------- barcodes --- */

/**
 * Is this a barcode at all, check digit and everything?
 *
 * The check digit is the point: a misread scan or a mistyped digit fails it, which turns a
 * lookup for the wrong product into no lookup at all. EAN-8, UPC-A, EAN-13 and GTIN-14 all
 * use the same alternating 3-1 weighting, counted from the right.
 */
export function isValidBarcode(code) {
  const s = String(code || '').trim()
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false
  const d = s.split('').map(Number)
  const check = d.pop()
  let sum = 0
  for (let i = d.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += d[i] * w
  return (10 - (sum % 10)) % 10 === check
}

/** UPC-A is EAN-13 with a leading zero; storing both spellings would split one product. */
export const normaliseBarcode = code => {
  const s = String(code || '').trim()
  return s.length === 12 ? '0' + s : s
}

/* -------------------------------------------------------------- reading --- */

// Open Food Facts' per-100 g keys, in the order this app lists nutrients.
const FIELDS = {
  kcal: ['energy-kcal_100g'],
  carb: ['carbohydrates_100g'],
  sugar: ['sugars_100g'],
  prot: ['proteins_100g'],
  fat: ['fat_100g'],
  sat: ['saturated-fat_100g'],
  fib: ['fiber_100g'],
  salt: ['salt_100g']
}

// Energy in kJ, for the products that carry only that. 1 kcal = 4.184 kJ exactly, by
// definition of the thermochemical calorie, so this conversion invents nothing.
const KJ_PER_KCAL = 4.184

const num = v => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

/** A readable name: the brand rarely appears in product_name and always matters. */
function nameOf(p) {
  const n = String(p.product_name_sv || p.product_name || '').trim()
  const brand = String(p.brands || '').split(',')[0].trim()
  const size = String(p.quantity || '').trim()
  const parts = [brand, n].filter(Boolean)
  const base = parts.length ? parts.join(' ') : ''
  return (size && base ? `${base}, ${size}` : base).slice(0, 80)
}

/**
 * One Open Food Facts product as this app's own food, or null if there is nothing usable
 * in it.
 *
 * Missing values are left MISSING rather than defaulted to zero. A product with no protein
 * figure is not a product with no protein, and a zero here would be indistinguishable from
 * a measurement later on.
 */
export function parseProduct(raw) {
  const p = (raw && (raw.product || raw)) || {}
  const nut = p.nutriments || {}
  const code = normaliseBarcode(p.code || (raw && raw.code) || '')
  const n = nameOf(p)
  if (!code || !n) return null

  const per100 = {}
  for (const [key, names] of Object.entries(FIELDS)) {
    for (const src of names) {
      const v = num(nut[src])
      if (v != null) { per100[key] = v; break }
    }
  }
  // Only kilojoules on the label? Convert, and say so, because a converted figure is a
  // slightly different thing from a printed one.
  let fromKj = false
  if (per100.kcal == null) {
    const kj = num(nut['energy-kj_100g']) ?? num(nut.energy_100g)
    if (kj != null) { per100.kcal = Math.round(kj / KJ_PER_KCAL); fromKj = true }
  }

  // Carbohydrate or energy: below that there is nothing to log against, and offering to
  // save an empty shell just moves the disappointment one tap later.
  if (per100.carb == null && per100.kcal == null) return null

  const missing = Object.keys(FIELDS).filter(k => per100[k] == null)
  return {
    code,
    n,
    brand: String(p.brands || '').split(',')[0].trim() || null,
    per100,
    missing,
    fromKj,
    // A serving size on the packet becomes a portion the user can pick, once they have
    // agreed the numbers are right. Grams only: "1 portion (2 biscuits)" is not a weight.
    serving: servingGrams(p),
    updated: p.last_modified_t ? new Date(p.last_modified_t * 1000).toISOString().slice(0, 10) : null,
    source: 'openfoodfacts'
  }
}

/**
 * A serving size in GRAMS, and only in grams: "30 g" -> 30, "2 dl (206 g)" -> 206.
 *
 * Three things this refuses to do, all of them the same mistake in different clothes.
 *
 * It will not take a leading number without a unit. serving_size is free text, so that
 * turns "2 dl (206 g)" into a two-gram serving and "2 kex" into a two-gram biscuit. A glass
 * of milk logged as 2 g carries 0.1 g of carbohydrate instead of 9.9 — a wrong number
 * wearing the shape of a right one.
 *
 * It will not convert a volume. "250 ml" is 250 g of squash and 230 g of cream, and this
 * function does not know which food it is looking at. The app already handles volume
 * properly elsewhere, per food and with a density, so a serving in millilitres is simply
 * left alone rather than half-guessed here.
 *
 * And it trusts serving_quantity only when the accompanying unit says grams, for the same
 * reason: an unlabelled number is not a weight just because it would be convenient.
 */
export function servingGrams(p) {
  const ok = v => (Number.isFinite(v) && v > 0 && v <= 5000 ? Math.round(v) : null)
  for (const m of String((p && p.serving_size) || '').matchAll(/([\d.,]+)\s*g\b/gi)) {
    const r = ok(Number(m[1].replace(',', '.')))
    if (r) return r
  }
  const unit = String((p && p.serving_quantity_unit) || '').trim().toLowerCase()
  if (unit && unit !== 'g') return null
  return ok(Number(String((p && p.serving_quantity) || '').replace(',', '.')))
}

/** How complete a scanned product is, for a line the confirmation sheet can show. */
export const completeness = food =>
  food ? Object.keys(FIELDS).length - food.missing.length : 0

/* --------------------------------------------------------------- saving --- */

/**
 * A scanned product as one of the user's own foods.
 *
 * It lands in myFoods rather than the bundled catalogue on purpose. The catalogue is
 * Livsmedelsverket's, generated and replaceable; this is a thing the user looked at and
 * agreed with, and it has to survive the next rebuild of the database.
 */
export const foodFromProduct = (food, per100) => ({
  id: 'bc' + food.code,
  n: food.n,
  own: true,
  barcode: food.code,
  source: 'openfoodfacts',
  per100: per100 || food.per100
})

/** Already scanned once? Then there is nothing to look up and nothing to confirm. */
export const knownBarcode = (S, code) => {
  const c = normaliseBarcode(code)
  return ((S && S.myFoods) || []).find(f => f.barcode === c) || null
}

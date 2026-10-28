// Photo of a meal -> rows to confirm. The server asks a model what is on the plate; here the
// photo is shrunk before it leaves the phone, and each dish the model names is looked up in the
// food catalogue so Livsmedelsverket's values are used wherever there is a match. Only a dish
// with no match keeps the model's own numbers, and is marked as an estimate.
import { api } from './api.js'
import { searchFoods, cleanPer100 } from './foods.js'

export const MAX_EDGE = 1024
export const QUALITY = 0.8

/** Scale (w, h) so the longest edge is at most `max`; never scales up. */
export function fitSize(w, h, max = MAX_EDGE) {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 }
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** A JPEG data URL of the photo, at most MAX_EDGE px on the long side. Throws if it cannot be read. */
export async function downscale(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const { w, h } = fitSize(bmp.width, bmp.height)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  if (bmp.close) bmp.close()
  return canvas.toDataURL('image/jpeg', QUALITY)
}

/**
 * Give every row a food to use: the catalogue's own entry when a dish matches by name, else the
 * model's estimate. A match must start with the searched word (rank 0 or 1 in searchFoods) —
 * "lax" should find salmon, not "slaktax".
 */
export function matchCatalogue(S, items) {
  return items.map(it => {
    const hit = firstGoodHit(S, it.search) || firstGoodHit(S, it.name)
    if (hit) return { name: hit.n, grams: it.grams, food: hit, source: hit.own ? 'own' : 'catalogue', asked: it.name }
    return { name: it.name, grams: it.grams, food: null, per100: it.per100 || {}, source: 'ai', asked: it.name }
  })
}

function firstGoodHit(S, q) {
  const term = String(q || '').trim()
  if (!term) return null
  const folded = s => String(s).toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/é/g, 'e')
  const first = folded(term).split(/\s+/)[0]
  const hits = searchFoods(S, term, 8)
  return hits.find(f => folded(f.n).startsWith(first) || new RegExp('\\b' + first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(folded(f.n))) || null
}

/** The food to save for a row the model estimated, in the user's own foods. */
export function foodFromEstimate(row, id) {
  const per100 = cleanPer100(row.per100 || {})
  if (!per100 || (per100.kcal == null && per100.carb == null)) return null
  return { id, n: row.name.trim() || row.asked, own: true, source: 'ai-photo', per100 }
}

export const askPhoto = (image, lang) => api('/api/food/photo', { method: 'POST', body: JSON.stringify({ image, lang }) })

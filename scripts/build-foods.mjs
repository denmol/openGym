#!/usr/bin/env node
// Builds frontend/src/lib/foods-data.js from Livsmedelsverkets livsmedelsdatabas.
//
//   node scripts/build-foods.mjs                 # fetch and build
//   node scripts/build-foods.mjs --inspect       # show the shape and the mapping, write nothing
//   node scripts/build-foods.mjs --limit 50      # a short run, for trying it out
//
// The API is two-stage: /livsmedel lists 2 600 foods as metadata only, and each one links to
// a sub-resource holding its nutrient values. The script reads the rel names off the data
// rather than hardcoding which link that is, so it keeps working if they rename it.
//
// Field names are matched by *meaning*, not position. --inspect prints what the source
// actually calls things next to what the mapping found, which turns a mismatch into a
// one-line fix instead of a guessing game. Run it first.
//
// Data: Livsmedelsverkets livsmedelsdatabas, CC BY 4.0. Attribution belongs in NOTICE.md.
//
// A note on `carb`, which matters more than the rest: this carries Livsmedelsverket's own
// carbohydrate field through unchanged. Swedish and EU convention reports carbohydrate
// *excluding* fibre, and fibre separately — which is the number carb counting wants. The
// script does not convert, subtract or reinterpret anything; whatever the source calls
// carbohydrate is what the app shows, under the same name. Check one familiar food against
// the packet after building.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Overridable so the fetching can be exercised against a stand-in — which is how the
// two-stage logic below was verified without hammering Livsmedelsverket.
const API = process.env.LIVSMEDEL_API || 'https://dataportal.livsmedelsverket.se/livsmedel/api/v1/livsmedel'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'frontend', 'src', 'lib', 'foods-data.js')

const args = process.argv.slice(2)
const inspect = args.includes('--inspect')
const limitArg = args.indexOf('--limit')
const CAP = limitArg >= 0 ? Number(args[limitArg + 1]) || 0 : 0
// Skip the value that belongs to --limit, or "10" gets treated as a filename to read.
const fromFile = args.find((a, i) => !a.startsWith('--') && i !== limitArg + 1)
const CONCURRENCY = 6

/* ---------------------------------------------------------------- fetching -- */

// Names the nutrient sub-resource might go by. The script does not rely on this list —
// it reads the rel names off the data first — but a source that stops advertising links
// should still have somewhere to look.
const NUTRIENT_RELS = ['naringsvarden', 'naringsvarde', 'nutrients', 'nutrientvalues']

const norm0 = s => String(s || '').toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o')

/** Every { rel, href } a record advertises, wherever they hide in it. */
function linksOf(row) {
  const out = []
  const walk = o => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (o.rel && o.href) out.push({ rel: String(o.rel), href: String(o.href) })
    Object.values(o).forEach(v => { if (v && typeof v === 'object') walk(v) })
  }
  walk(row)
  return out
}

/**
 * Absolute URLs to try for a link href.
 *
 * The API is mounted under a path (…/livsmedel/api/v1/livsmedel) but advertises its links
 * from the app root (/api/v1/livsmedel/1/…). Resolving those with `new URL(href, API)` walks
 * to the server root and loses the mount, so find the mount back: the prefix of the API path
 * that makes the href line up with it again.
 */
function urlsFor(href) {
  if (/^https?:/i.test(href)) return [href]
  const base = new URL(API)
  const path = href.startsWith('/') ? href : '/' + href
  const segs = base.pathname.split('/').filter(Boolean)
  const out = []
  for (let k = 0; k <= segs.length; k++) {
    const mount = k ? '/' + segs.slice(0, k).join('/') : ''
    if ((mount + path).startsWith(base.pathname)) out.push(base.origin + mount + path)
  }
  out.push(base.origin + path)
  return [...new Set(out)]
}

async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) { const e = new Error(`${res.status} ${url}`); e.status = res.status; throw e }
  return res.json()
}

async function fetchList(cap) {
  const out = []
  let offset = 0
  const limit = 500
  for (;;) {
    const page = await getJSON(`${API}?offset=${offset}&limit=${limit}`)
    const rows = Array.isArray(page) ? page : (page.livsmedel || page.items || page.data || [])
    if (!rows.length) break
    out.push(...rows)
    process.stdout.write(`\r↓ ${out.length} livsmedel i listan…`)
    if (cap && out.length >= cap) break
    if (rows.length < limit) break
    offset += limit
  }
  const kept = cap ? out.slice(0, cap) : out
  process.stdout.write(`\r✓ ${kept.length} livsmedel i listan.            \n`)
  return kept
}

/** Every URL worth trying for one food's nutrients, best guess first. */
function nutrientURLs(row, rel) {
  const id = row.nummer ?? row.id
  const link = linksOf(row).find(l => norm0(l.rel) === norm0(rel))
  const tries = link ? urlsFor(link.href) : []
  // The rel and the path it points at need not match — Livsmedelsverket advertises
  // rel "naringvarden" for a path spelled "naringsvarden" — so build the fallback from
  // the href's own last segment before falling back to the rel name.
  const seg = link ? link.href.split('?')[0].split('/').filter(Boolean).pop() : null
  for (const s of new Set([seg, rel].filter(Boolean))) tries.push(`${API}/${id}/${s}`)
  return [...new Set(tries)]
}

/** The nutrient sub-resource for one food. Reports every URL tried, not just the last. */
async function fetchNutrients(row, rel) {
  const tries = nutrientURLs(row, rel)
  const errs = []
  for (const url of tries) {
    try { return await getJSON(url) } catch (e) { errs.push(`${e.message}`) }
  }
  throw new Error(errs.join(' | '))
}

/** Resolve requests a few at a time: 2 600 of them, and nobody's API deserves a stampede. */
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let i = 0, done = 0
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const k = i++
      if (k >= items.length) return
      try { out[k] = await fn(items[k]) } catch (e) { out[k] = { __error: e.message } }
      if (++done % 25 === 0 || done === items.length) {
        process.stdout.write(`\r↓ näringsvärden ${done}/${items.length}…`)
      }
    }
  }))
  process.stdout.write('\n')
  return out
}

/* ---------------------------------------------------------------- mapping -- */

// Matched case- and accent-insensitively against whatever the source calls its fields, so a
// rename upstream does not silently produce a database of zeroes.
const WANT = {
  kcal:  ['energi (kcal)', 'energi kcal', 'energikcal', 'kcal', 'energi'],
  carb:  ['kolhydrater', 'kolhydrat', 'carbohydrates'],
  sugar: ['socker totalt', 'sockerarter', 'socker', 'monosackarider'],
  prot:  ['protein'],
  fat:   ['fett totalt', 'fett'],
  sat:   ['summa mättade fettsyror', 'mättat fett', 'mattade fettsyror', 'mättade fettsyror'],
  fib:   ['fibrer', 'fiber', 'kostfiber'],
  salt:  ['salt', 'natriumklorid', 'nacl']
}

// Sources that carry both energy fields list kilojoules too, and "Energi (kJ)" answers to a
// bare "energi" just as readily as the kcal one does. Picking it would make every food in the
// database look 4.2x more energetic than it is, silently, so kcal refuses a kJ field outright.
const REJECT = { kcal: /\bkj\b|kilojoule/ }

const norm = s => String(s || '').toLowerCase()
  .replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/\s+/g, ' ').trim()

/** Flatten one source record into { fieldName: value } no matter how it nests. */
function flatten(row) {
  const flat = {}
  const walk = (obj, prefix) => {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      // Nutrients often arrive as [{ namn, varde }] rather than as keys.
      for (const el of obj) {
        if (el && typeof el === 'object') {
          const name = el.namn ?? el.name ?? el.euroFIRkod ?? el.forkortning
          const val = el.varde ?? el.value ?? el.mangd
          if (name != null && val != null) flat[String(name)] = val
          else walk(el, prefix)
        }
      }
      return
    }
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') walk(v, k)
      else flat[k] = v
    }
  }
  walk(row, '')
  return flat
}

function pick(flat, names, reject) {
  const keys = Object.keys(flat).filter(k => !(reject && reject.test(norm(k))))
  for (const want of names) {
    const w = norm(want)
    const hit = keys.find(k => norm(k) === w)
    if (hit != null) return flat[hit]
  }
  // Nothing matched exactly — try a prefix, which catches "Energi (kcal)" style suffixes.
  for (const want of names) {
    const w = norm(want)
    const hit = keys.find(k => norm(k).startsWith(w))
    if (hit != null) return flat[hit]
  }
  return null
}

/** One mapped field, by meaning. */
const field = (flat, key) => pick(flat, WANT[key], REJECT[key])

const num = v => {
  if (v == null) return null
  const n = Number(String(v).replace(',', '.').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/* ---------------------------------------------------------------- build -- */

const list = fromFile
  ? (r => Array.isArray(r) ? r : (r.livsmedel || r.items || r.data || []))(JSON.parse(readFileSync(fromFile, 'utf8')))
  : await fetchList(CAP || (inspect ? 1 : 0))
if (!list.length) throw new Error('Inga livsmedel i källan.')

// Which link leads to the nutrients? Ask the data, fall back to the known names.
const rels = linksOf(list[0]).map(l => l.rel)
const rel = rels.find(r => NUTRIENT_RELS.includes(norm0(r)))
  || rels.find(r => norm0(r).includes('naring') || norm0(r).includes('nutrient'))
  || NUTRIENT_RELS[0]

if (inspect) {
  console.log('\nFörsta posten:\n')
  for (const [k, v] of Object.entries(list[0])) {
    if (v && typeof v === 'object') continue
    console.log('  ' + String(k).padEnd(24) + String(v).slice(0, 44))
  }
  console.log('\nLänkar posten pekar på:\n')
  for (const l of linksOf(list[0])) console.log('  ' + l.rel.padEnd(24) + l.href.slice(0, 60))
  console.log(`\nHämtar näringsvärden via rel: ${rel}`)
  console.log('Adresser skriptet provar, i tur och ordning:\n')
  for (const u of nutrientURLs(list[0], rel)) console.log('  ' + u)
  console.log('')

  let sample
  try { sample = await fetchNutrients(list[0], rel) } catch (e) {
    console.log('  ✗ ingen av dem svarade:\n')
    for (const m of e.message.split(' | ')) console.log('    ' + m)
    console.log('\n  Skicka den här utskriften så pekar jag om skriptet.\n')
    process.exit(1)
  }
  const flat = flatten(sample)
  console.log('Näringsvärden för "' + (list[0].namn || '?') + '":\n')
  for (const [k, v] of Object.entries(flat).slice(0, 40)) {
    console.log('  ' + String(k).padEnd(42) + String(v).slice(0, 24))
  }
  console.log('\nSå här matchar mappningen:\n')
  for (const key of Object.keys(WANT)) {
    const v = field(flat, key)
    console.log('  ' + key.padEnd(7) + (v == null ? '✗ INGEN TRÄFF' : '✓ ' + v))
  }
  console.log('\nSaknas något: skicka listan ovan så rättar jag WANT-tabellen.\n')
  process.exit(0)
}

const nutrients = fromFile
  ? list.map(r => r)                      // a downloaded file already has them inline
  : await pool(list, CONCURRENCY, row => fetchNutrients(row, rel))

const foods = []
let dropped = 0, failed = 0
list.forEach((row, i) => {
  const id = String(row.nummer ?? row.id ?? '').trim()
  const n = String(row.namn ?? row.name ?? '').trim()
  const src = nutrients[i]
  if (src && src.__error) { failed++; return }
  if (!id || !n) { dropped++; return }
  const flat = flatten(src)
  const per100 = {}
  for (const key of Object.keys(WANT)) {
    const v = num(field(flat, key))
    if (v != null) per100[key] = v
  }
  // A row with no energy and no carbohydrate is not a food anyone can log against.
  if (per100.kcal == null && per100.carb == null) { dropped++; return }
  foods.push({ id, n, per100 })
})

foods.sort((a, b) => a.n.localeCompare(b.n, 'sv'))

const header = `// Generated by scripts/build-foods.mjs — do not edit.
// Livsmedelsverkets livsmedelsdatabas, CC BY 4.0. Values per 100 g.
// \`carb\` is the source's own carbohydrate field, carried through unchanged.
`
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT,
  header +
  'export const FOODS = ' + JSON.stringify(foods) + '\n' +
  'export const FOODS_SOURCE = ' + JSON.stringify({
    name: 'Livsmedelsverkets livsmedelsdatabas',
    licence: 'CC BY 4.0',
    built: new Date().toISOString().slice(0, 10),
    count: foods.length
  }) + '\n')

const missing = Object.keys(WANT).filter(k => !foods.some(f => f.per100[k] != null))
console.log(`✓ ${OUT}: ${foods.length} livsmedel (${dropped} utan värden, ${failed} misslyckade hämtningar), ${(JSON.stringify(foods).length / 1024).toFixed(0)} kB`)
if (missing.length) {
  console.log(`\n⚠ Inget livsmedel fick värden för: ${missing.join(', ')}`)
  console.log('  Kör --inspect och skicka utskriften — fältnamnen har troligen bytt.')
}
console.log('\nKontrollera ett bekant livsmedel mot förpackningen innan någon doserar efter det.')

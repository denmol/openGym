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
  process.stdout.write(`\r✓ ${out.length} livsmedel i listan.            \n`)
  return cap ? out.slice(0, cap) : out
}

/** The nutrient sub-resource for one food, trying the advertised link then the plain path. */
async function fetchNutrients(row, rel) {
  const id = row.nummer ?? row.id
  const link = linksOf(row).find(l => norm0(l.rel) === norm0(rel))
  const tries = []
  if (link) tries.push(new URL(link.href, API).href)
  tries.push(`${API}/${id}/${rel}`)
  let last
  for (const url of tries) {
    try { return await getJSON(url) } catch (e) { last = e }
  }
  throw last
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

function pick(flat, names) {
  const keys = Object.keys(flat)
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
  console.log(`\nHämtar näringsvärden via: ${rel}\n`)

  let sample
  try { sample = await fetchNutrients(list[0], rel) } catch (e) {
    console.log('  ✗ gick inte att hämta: ' + e.message)
    console.log('\n  Skicka länklistan ovan så pekar jag om skriptet.\n')
    process.exit(1)
  }
  const flat = flatten(sample)
  console.log('Näringsvärden för "' + (list[0].namn || '?') + '":\n')
  for (const [k, v] of Object.entries(flat).slice(0, 40)) {
    console.log('  ' + String(k).padEnd(42) + String(v).slice(0, 24))
  }
  console.log('\nSå här matchar mappningen:\n')
  for (const [key, names] of Object.entries(WANT)) {
    const v = pick(flat, names)
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
    const v = num(pick(flat, WANT[key]))
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

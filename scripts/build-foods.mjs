#!/usr/bin/env node
// Builds frontend/src/lib/foods-data.js from Livsmedelsverkets livsmedelsdatabas.
//
//   node scripts/build-foods.mjs                 # fetch and build
//   node scripts/build-foods.mjs --inspect       # print the shape and change nothing
//   node scripts/build-foods.mjs data.json       # build from a file you downloaded
//
// Why an --inspect mode: this script was written without access to Livsmedelsverket's API,
// so the field names below are matched by *meaning* rather than hardcoded. If the mapping
// misses, --inspect prints exactly what the source calls its fields, which is a one-line
// fix instead of a guessing game. Run it first.
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

const API = 'https://dataportal.livsmedelsverket.se/livsmedel/api/v1/livsmedel'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'frontend', 'src', 'lib', 'foods-data.js')

const args = process.argv.slice(2)
const inspect = args.includes('--inspect')
const fromFile = args.find(a => !a.startsWith('--'))

/* ---------------------------------------------------------------- fetching -- */

async function fetchAll() {
  const out = []
  let offset = 0
  const limit = 500
  for (;;) {
    const url = `${API}?offset=${offset}&limit=${limit}`
    process.stdout.write(`\r↓ ${out.length} livsmedel…`)
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`${url} svarade ${res.status}`)
    const page = await res.json()
    // The endpoint may hand back a bare array or wrap it — accept both rather than assume.
    const rows = Array.isArray(page) ? page : (page.livsmedel || page.items || page.data || [])
    if (!rows.length) break
    out.push(...rows)
    if (rows.length < limit) break
    offset += limit
  }
  process.stdout.write(`\r✓ ${out.length} livsmedel hämtade.        \n`)
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

const raw = fromFile
  ? JSON.parse(readFileSync(fromFile, 'utf8'))
  : await fetchAll()
const rows = Array.isArray(raw) ? raw : (raw.livsmedel || raw.items || raw.data || [])
if (!rows.length) throw new Error('Inga livsmedel i källan.')

if (inspect) {
  const flat = flatten(rows[0])
  console.log('\nFörsta posten, tillplattad:\n')
  for (const [k, v] of Object.entries(flat).slice(0, 60)) {
    console.log('  ' + k.padEnd(42) + String(v).slice(0, 30))
  }
  console.log('\nSå här matchar mappningen:\n')
  for (const [key, names] of Object.entries(WANT)) {
    const v = pick(flat, names)
    console.log('  ' + key.padEnd(7) + (v == null ? '✗ INGEN TRÄFF' : '✓ ' + v))
  }
  console.log('\nSaknas något: skicka listan ovan så rättar jag WANT-tabellen.\n')
  process.exit(0)
}

const foods = []
let dropped = 0
for (const row of rows) {
  const flat = flatten(row)
  const id = String(row.nummer ?? row.id ?? row.livsmedelsNummer ?? flat.nummer ?? '').trim()
  const n = String(row.namn ?? row.name ?? flat.namn ?? '').trim()
  if (!id || !n) { dropped++; continue }
  const per100 = {}
  for (const key of Object.keys(WANT)) {
    const v = num(pick(flat, WANT[key]))
    if (v != null) per100[key] = v
  }
  // A row with no energy and no carbohydrate is not a food anyone can log against.
  if (per100.kcal == null && per100.carb == null) { dropped++; continue }
  foods.push({ id, n, per100 })
}

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
console.log(`✓ ${OUT}: ${foods.length} livsmedel (${dropped} överhoppade), ${(JSON.stringify(foods).length / 1024).toFixed(0)} kB`)
if (missing.length) {
  console.log(`\n⚠ Inget livsmedel fick värden för: ${missing.join(', ')}`)
  console.log('  Kör --inspect och skicka utskriften — fältnamnen har troligen bytt.')
}
console.log('\nKontrollera ett bekant livsmedel mot förpackningen innan någon doserar efter det.')

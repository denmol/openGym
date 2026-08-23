// Importing glucose readings and insulin doses out of a meter, pump or CGM export.
//
// Named for CareLink because that is the one this was built for, but nothing here is
// Medtronic-specific: it reads a column MAP off the header, the same way import-csv.js
// does for training histories, so a Libre or Dexcom export is usually a few more header
// aliases rather than another importer.
//
// WHY THIS ASKS BEFORE IT SAVES
//
// A training import that guesses wrong files a bench press under the wrong name. A glucose
// import that guesses wrong writes a number someone will read as a blood sugar. The two
// failure modes are not comparable, so this parser never commits anything: it returns what
// it found, what it thinks each column is, and which unit it believes the file is in, and
// the caller shows all of it for confirmation first. Where it had to infer rather than read
// something outright, it says so in `unitSource` and the sheet says so out loud.
//
// WHAT IT DELIBERATELY DOES NOT IMPORT
//
// Basal. CareLink reports basal as a RATE in U/h at a point in time, not as an amount
// delivered. Turning a column of rates into a column of doses would invent a total daily
// basal out of numbers that never meant that, and it would look entirely plausible on a
// report. Basal rows are counted and skipped, and the summary says so.
//
// Carb input from the bolus wizard is skipped too, for a duller reason: the food log is
// already the app's carbohydrate record, and a second, disagreeing one would leave the
// report with two answers to the same question.

import { parseCSV, parseWhen } from './import-csv.js'
import { uid } from './format.js'
import { plausibleGlucose, storeGlucose } from './diabetes.js'

/* ------------------------------------------------------------ the file ---- */

const DELIMS = [',', ';', '\t']

/**
 * Which character separates the fields.
 *
 * Scored as lines-that-agree times fields-per-line, over the field counts that actually
 * split something. Both halves are needed. Frequency alone picks the comma out of a
 * semicolon file, because decimal commas turn every data row into two or three ragged
 * fields while a short preamble stays at one. Width alone picks whichever character
 * happens to appear inside one long text field.
 */
export function sniffDelimiter(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.trim()).slice(0, 40)
  if (!lines.length) return ','
  let best = ',', bestScore = 0
  for (const d of DELIMS) {
    const freq = new Map()
    for (const l of lines) {
      const n = l.split(d).length
      if (n < 2) continue                 // this character does not split that line at all
      freq.set(n, (freq.get(n) || 0) + 1)
    }
    for (const [n, count] of freq) {
      const score = count * n
      if (score > bestScore) { bestScore = score; best = d }
    }
  }
  return best
}

const norm = h => String(h || '').toLowerCase().replace(/[^a-z0-9åäö]+/g, ' ').trim()

// header text -> the field it holds. Specific names first; first match wins. Swedish
// aliases are here because the export follows the language the device is set to.
const COLUMNS = [
  ['sensor', ['sensor glucose', 'sensor glucose mmol l', 'sensor glucose mg dl', 'sensorglukos',
    'sensor glukos', 'cgm glucose', 'historic glucose mmol l', 'historiskt glukos mmol l']],
  ['bg', ['bg reading', 'bg reading mmol l', 'bg reading mg dl', 'blood glucose', 'blodsocker',
    'blodglukos', 'glukos', 'glucose', 'glucose value', 'scan glucose mmol l', 'bg']],
  ['bolus', ['bolus volume delivered', 'bolus volume delivered u', 'bolus levererad',
    'bolusmängd levererad', 'bolus delivered', 'insulin bolus', 'bolus u', 'bolus', 'måltidsdos',
    'insulin', 'insulin u', 'insulin units', 'dose', 'dos', 'enheter']],
  ['basal', ['basal rate', 'basal rate u h', 'basalhastighet', 'basaldos', 'basal']],
  ['carbs', ['bwz carb input grams', 'bwz carb input', 'carb input', 'kolhydratinmatning']],
  ['date', ['date', 'datum', 'dato', 'date time', 'datetime', 'timestamp', 'tidsstämpel',
    'device timestamp', 'enhetens tidsstämpel']],
  ['time', ['time', 'tid', 'klockslag', 'device time']],
]

function mapHeader(header) {
  const map = {}
  header.forEach((h, i) => {
    const n = norm(h)
    if (!n) return
    for (const [field, names] of COLUMNS) {
      if (map[field] === undefined && names.includes(n)) { map[field] = i; return }
    }
  })
  return map
}

/**
 * Which row is the header.
 *
 * CareLink writes a preamble first — device name, serial, the patient's name, a blank line
 * or two — so row 0 is usually not the header. The header is the first row that names both
 * a date and something measurable.
 */
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const m = mapHeader(rows[i])
    const hasWhen = m.date !== undefined || m.time !== undefined
    const hasWhat = m.sensor !== undefined || m.bg !== undefined || m.bolus !== undefined
    if (hasWhen && hasWhat) return i
  }
  return -1
}

/* ------------------------------------------------------------- values ----- */

const p2 = n => String(n).padStart(2, '0')

/** "13:45:00" · "1:45 PM" · "07:05" -> "07:05", or null. */
export function toHM(s) {
  const v = String(s || '').trim()
  const m = v.match(/(\d{1,2}):(\d{2})/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const mi = parseInt(m[2], 10)
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) {
    if (!/(am|pm)/i.test(v) || h < 1 || h > 12) return null
  }
  if (/pm/i.test(v) && h < 12) h += 12
  if (/am/i.test(v) && h === 12) h = 0
  return h > 23 ? null : p2(h) + ':' + p2(mi)
}

/** Milliseconds-since-midnight, as parseWhen reports it, back to "HH:MM". */
const msToHM = ms => (ms == null ? null : p2(Math.floor(ms / 3600000)) + ':' + p2(Math.floor(ms / 60000) % 60))

// A number written either way round: 5.5 and 5,5 are the same reading, and which one a
// file uses depends on the locale the device was set to, not on the value.
const num = v => {
  const s = String(v ?? '').trim()
  if (!s) return NaN
  const n = parseFloat(s.replace(',', '.').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

/**
 * Which unit the file's glucose column is in.
 *
 * Read off the header where the header says. Where it does not, inferred from the median
 * value: mmol/L readings live around 4–12 and mg/dL ones around 70–220, so the two do not
 * overlap in practice. The caller is told which of the two happened, because an inference
 * is a thing a person should get to overrule.
 */
export function detectUnit(headerText, values) {
  const h = norm(headerText)
  if (h.includes('mmol')) return { unit: 'mmol', unitSource: 'header' }
  if (h.includes('mg dl') || h.includes('mgdl')) return { unit: 'mgdl', unitSource: 'header' }
  const vs = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!vs.length) return { unit: 'mmol', unitSource: 'default' }
  const median = vs[Math.floor(vs.length / 2)]
  return { unit: median > 30 ? 'mgdl' : 'mmol', unitSource: 'magnitude' }
}

/* -------------------------------------------------------------- parse ----- */

/**
 * Read an export into entries openGym understands, WITHOUT touching state.
 *
 * `opts.unit` overrides the detected unit — that is the escape hatch for a file whose
 * header says nothing and whose values are ambiguous. `opts.map` overrides the detected
 * columns the same way, so a file this has never seen is still importable by hand.
 */
export function parseGlucoseCSV(text, opts = {}) {
  const delim = opts.delim || sniffDelimiter(text)
  const rows = parseCSV(text, delim)
  if (rows.length < 2) return { error: 'empty' }

  const hRow = opts.headerRow ?? findHeader(rows)
  if (hRow < 0) return { error: 'unrecognised', delim, firstRows: rows.slice(0, 5) }

  const header = rows[hRow]
  const map = { ...mapHeader(header), ...(opts.map || {}) }
  const body = rows.slice(hRow + 1)

  const cell = (r, i) => (i === undefined ? '' : String(r[i] ?? '').trim())
  const filled = i => (i === undefined ? -1 : body.reduce((a, r) => a + (Number.isFinite(num(cell(r, i))) ? 1 : 0), 0))

  // Sensor or meter, whichever column the file actually filled in — a CareLink export
  // carries both headers and populates one of them. Mixing the two into one series would
  // bury a fortnight of fingersticks under a week of sensor trace, and preferring the
  // sensor header on sight would throw the fingersticks away in a meter-only export.
  const nSensor = filled(map.sensor)
  const nBg = filled(map.bg)
  const useSensor = nSensor > 0 && nSensor >= nBg
  const gField = useSensor ? 'sensor' : nBg > 0 ? 'bg' : null
  const gCol = gField === 'sensor' ? map.sensor : gField === 'bg' ? map.bg : undefined

  // Unit first, over the whole column, so every row is read the same way.
  const rawG = gCol === undefined ? [] : body.map(r => num(cell(r, gCol))).filter(Number.isFinite)
  const detected = detectUnit(gCol === undefined ? '' : header[gCol], rawG)
  const unit = opts.unit || detected.unit
  const unitSource = opts.unit ? 'chosen' : detected.unitSource

  const readings = []
  const doses = []
  let skipped = 0, basalSkipped = 0, carbSkipped = 0, outOfRange = 0, noTime = 0

  for (const r of body) {
    // A date and time in one column, or in two. CareLink writes two; a Libre export one.
    let d = null, t = null
    if (map.date !== undefined) {
      const raw = cell(r, map.date)
      const when = parseWhen(raw)
      // toHM reads the clock out of the same cell first because parseWhen has no notion of
      // AM/PM — it is written for exports that do not use one — and would quietly turn
      // "8/19/2026 10:40 PM" into a reading taken at twenty to eleven in the morning.
      if (when) { d = when.d; t = toHM(raw) || msToHM(when.t) }
    }
    if (map.time !== undefined) t = toHM(cell(r, map.time)) || t
    // A reading without a time of day cannot be placed against a meal, and inventing one
    // would put a fasting value in the afternoon. Counted, skipped, and reported.
    if (d && !t) { noTime++; continue }
    if (!d || !t) { skipped++; continue }

    let used = false

    if (gCol !== undefined) {
      const raw = num(cell(r, gCol))
      if (Number.isFinite(raw)) {
        const mmol = storeGlucose(raw, unit)
        // A row outside what a meter can report is a parse gone wrong — a serial number
        // read as a reading, a rate column mistaken for glucose — and it is dropped rather
        // than stored, then counted so the summary can admit to it.
        if (plausibleGlucose(mmol)) { readings.push({ id: uid(), d, t, v: mmol, src: 'import' }); used = true }
        else outOfRange++
      }
    }

    if (map.bolus !== undefined) {
      const u = num(cell(r, map.bolus))
      if (Number.isFinite(u) && u > 0 && u <= 250) {
        doses.push({ id: uid(), d, t, u: Math.round(u * 100) / 100, kind: 'meal', src: 'import' })
        used = true
      }
    }

    if (map.basal !== undefined && Number.isFinite(num(cell(r, map.basal)))) basalSkipped++
    if (map.carbs !== undefined && Number.isFinite(num(cell(r, map.carbs)))) carbSkipped++
    if (!used) skipped++
  }

  const dates = [...new Set([...readings, ...doses].map(x => x.d))].sort()
  return {
    kind: 'glucose',
    delim, headerRow: hRow, header, map, gField,
    unit, unitSource,
    readings, doses,
    rows: body.length, skipped, noTime, basalSkipped, carbSkipped, outOfRange,
    from: dates[0] || null, to: dates[dates.length - 1] || null,
    // The first few rows exactly as they would be stored, for the confirmation sheet. A
    // summary saying "412 readings" proves nothing; five readings a person recognises does.
    sample: readings.slice(0, 5)
  }
}

/** Was this file worth showing an import sheet for at all? */
export const hasEntries = p => !!p && !p.error && (p.readings.length > 0 || p.doses.length > 0)

/* -------------------------------------------------------------- merge ----- */

const gKey = g => g.d + '|' + g.t + '|' + g.v
const dKey = x => x.d + '|' + x.t + '|' + x.u + '|' + x.kind

/**
 * Merge into state. Existing entries win, matched on when-and-what, so importing the same
 * export twice adds nothing the second time — the overlap between two monthly downloads is
 * the normal case, not the exception.
 */
export function mergeGlucose(S, parsed) {
  const haveG = new Set((S.glucose || []).map(gKey))
  const haveD = new Set((S.doses || []).map(dKey))
  const freshG = [], freshD = []
  for (const g of parsed.readings || []) {
    if (haveG.has(gKey(g))) continue
    haveG.add(gKey(g))                    // a file can repeat a row against itself, too
    freshG.push(g)
  }
  for (const x of parsed.doses || []) {
    if (haveD.has(dKey(x))) continue
    haveD.add(dKey(x))
    freshD.push(x)
  }
  const byWhen = (a, b) => (a.d === b.d ? String(a.t).localeCompare(String(b.t)) : a.d < b.d ? -1 : 1)
  S.glucose = [...(S.glucose || []), ...freshG].sort(byWhen)
  S.doses = [...(S.doses || []), ...freshD].sort(byWhen)
  return {
    readings: freshG.length,
    doses: freshD.length,
    duplicates: (parsed.readings || []).length + (parsed.doses || []).length - freshG.length - freshD.length
  }
}

/** Undo an import: everything that came from a file, leaving hand-typed entries alone. */
export function dropImported(S) {
  const g = (S.glucose || []).length, d = (S.doses || []).length
  S.glucose = (S.glucose || []).filter(x => x.src !== 'import')
  S.doses = (S.doses || []).filter(x => x.src !== 'import')
  return { readings: g - S.glucose.length, doses: d - S.doses.length }
}

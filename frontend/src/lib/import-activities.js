// Activities from a watch or a phone: Apple Health workouts, Garmin Connect (CSV or the
// account-data JSON) and single-activity TCX / GPX files.
//
// Every reader turns its file into the same small record —
//   { kind, label, start (ms), min, km, hr, source }
// — and everything after that (de-duplication, building sessions) is shared. Only what the
// app can use is kept: when, how long, how far, average heart rate and a coarse kind.
//
// The TCX and GPX readers follow published formats. The Garmin CSV and JSON readers are
// tolerant guesses at files that Garmin changes without notice (header names differ by
// language and by account, distances may be in miles): they say what they assumed instead of
// failing, and a row they cannot read is counted as skipped.

import { parseCSV } from './import-csv.js'
import { buildActivityWorkout } from './cardio.js'
import { isoOf, uid } from './format.js'

const num = v => {
  const n = Number(String(v ?? '').trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Coarse kind from whatever the source calls the activity (English or Swedish). */
export function kindOf(text) {
  const s = String(text || '').toLowerCase()
  if (/hik|vandr|trek/.test(s)) return 'hike'
  if (/walk|\bgå|promen/.test(s)) return 'walk'
  if (/run|jog|löp|spring|trail/.test(s)) return 'run'
  if (/cycl|bik|ride|cykl|cykel|spin/.test(s)) return 'bike'
  if (/swim|sim/.test(s)) return 'swim'
  return 'other'
}

const KIND_EX = { walk: 'act-walk', hike: 'act-hike', run: 'act-run', bike: 'act-bike', swim: 'act-swim', other: 'act-other' }
const KIND_NAME = { walk: 'Walk', hike: 'Hike', run: 'Run (outdoor)', bike: 'Cycling (outdoor)', swim: 'Swimming', other: 'Other activity' }

const clean = (a, source) => {
  const min = Math.round(a.min)
  if (!Number.isFinite(a.start) || !(min > 0) || min > 1440) return null
  return {
    kind: a.kind, label: a.label || '', start: a.start, min,
    km: a.km > 0 && a.km < 1000 ? Math.round(a.km * 100) / 100 : 0,
    hr: a.hr > 30 && a.hr < 250 ? Math.round(a.hr) : 0, source
  }
}

/* ------------------------------------------------------------- Apple Health ---- */

const attr = (tag, name) => { const m = new RegExp(name + '="([^"]*)"').exec(tag); return m ? m[1] : '' }
const toKm = (value, unit) => {
  const v = num(value); if (!(v > 0)) return 0
  const u = String(unit || 'km').toLowerCase()
  return u.startsWith('mi') ? v * 1.609344 : u === 'm' ? v / 1000 : u === 'yd' ? v * 0.0009144 : v
}
const toMin = (value, unit) => {
  const v = num(value); if (!(v > 0)) return 0
  const u = String(unit || 'min').toLowerCase()
  return u.startsWith('s') ? v / 60 : u.startsWith('h') ? v * 60 : v
}
// "2026-10-27 08:15:00 +0200" → ms
const appleTime = s => {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(String(s).trim())
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : NaN
}

/** One `<Workout …>` element (self-closing or with children) → activity, or null. */
export function healthWorkout(block) {
  const open = /<Workout\b[^>]*?(?:\/?>)/.exec(block)?.[0] || block
  const raw = attr(open, 'workoutActivityType').replace(/^HKWorkoutActivityType/, '')
  const label = raw.replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  let km = toKm(attr(open, 'totalDistance'), attr(open, 'totalDistanceUnit'))
  let hr = 0
  for (const stat of block.match(/<WorkoutStatistics\b[^>]*>/g) || []) {
    const type = attr(stat, 'type')
    if (/DistanceWalkingRunning|DistanceCycling|DistanceSwimming/.test(type) && !(km > 0)) km = toKm(attr(stat, 'sum'), attr(stat, 'unit'))
    else if (/HeartRate/.test(type)) hr = num(attr(stat, 'average'))
  }
  return clean({
    kind: kindOf(raw), label, km, hr,
    start: appleTime(attr(open, 'startDate')),
    min: toMin(attr(open, 'duration'), attr(open, 'durationUnit'))
  }, 'Apple Health')
}

/** Workouts in a chunk of export.xml text; `rest` is what a later chunk must start with. */
export function scanHealthChunk(buffer) {
  const out = []
  let pos = 0
  for (;;) {
    const i = buffer.indexOf('<Workout ', pos)
    if (i < 0) return { out, rest: buffer.slice(Math.max(pos, buffer.length - 12)) }
    const gt = buffer.indexOf('>', i)
    if (gt < 0) return { out, rest: buffer.slice(i) }
    let end
    if (buffer[gt - 1] === '/') end = gt + 1
    else {
      const close = buffer.indexOf('</Workout>', gt)
      if (close < 0) return { out, rest: buffer.slice(i) }
      end = close + 10
    }
    const a = healthWorkout(buffer.slice(i, end))
    if (a) out.push(a)
    pos = end
  }
}

/* ---------------------------------------------------------------------- TCX ---- */

export function parseTcx(text) {
  const out = []
  for (const block of String(text).match(/<Activity\b[\s\S]*?<\/Activity>/g) || []) {
    const sport = attr(/<Activity\b[^>]*>/.exec(block)[0], 'Sport')
    const id = /<Id>([^<]+)<\/Id>/.exec(block)?.[1] || /<Lap\b[^>]*StartTime="([^"]+)"/.exec(block)?.[1]
    let sec = 0, m = 0, hrSum = 0, hrSec = 0
    for (const lap of block.match(/<Lap\b[\s\S]*?<\/Lap>/g) || []) {
      const s = num(/<TotalTimeSeconds>([^<]+)</.exec(lap)?.[1])
      sec += s; m += num(/<DistanceMeters>([^<]+)</.exec(lap)?.[1])
      const h = num(/<AverageHeartRateBpm[^>]*>\s*<Value>([^<]+)</.exec(lap)?.[1])
      if (h > 0) { hrSum += h * s; hrSec += s }
    }
    const a = clean({ kind: kindOf(sport), label: sport, start: Date.parse(id), min: sec / 60, km: m / 1000, hr: hrSec ? hrSum / hrSec : 0 }, 'TCX')
    if (a) out.push(a)
  }
  return out
}

/* ---------------------------------------------------------------------- GPX ---- */

const haversine = (a, b) => {
  const R = 6371, r = x => x * Math.PI / 180
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function parseGpx(text) {
  const out = []
  for (const trk of String(text).match(/<trk>[\s\S]*?<\/trk>/g) || []) {
    const pts = []
    let hrSum = 0, hrN = 0
    for (const p of trk.match(/<trkpt\b[\s\S]*?<\/trkpt>/g) || []) {
      const lat = num(attr(p, 'lat')), lon = num(attr(p, 'lon'))
      const time = Date.parse(/<time>([^<]+)<\/time>/.exec(p)?.[1] || '')
      if (Number.isFinite(time)) pts.push({ ll: [lat, lon], time })
      const h = num(/<(?:\w+:)?hr>([^<]+)</.exec(p)?.[1])
      if (h > 0) { hrSum += h; hrN++ }
    }
    if (pts.length < 2) continue
    let km = 0
    for (let i = 1; i < pts.length; i++) km += haversine(pts[i - 1].ll, pts[i].ll)
    const type = /<type>([^<]+)<\/type>/.exec(trk)?.[1] || /<name>([^<]+)<\/name>/.exec(trk)?.[1] || ''
    const a = clean({
      kind: kindOf(type), label: type, start: pts[0].time,
      min: (pts[pts.length - 1].time - pts[0].time) / 60000, km, hr: hrN ? hrSum / hrN : 0
    }, 'GPX')
    if (a) out.push(a)
  }
  return out
}

/* ------------------------------------------------------------- Garmin Connect ---- */

const clock = s => {
  const p = String(s || '').trim().split(':').map(Number)
  if (!p.length || p.some(n => !Number.isFinite(n))) return 0
  return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p.length === 2 ? p[0] + p[1] / 60 : 0
}

/** Garmin Connect "Export CSV" on the Activities page. */
export function parseGarminCsv(text) {
  const head = String(text).split(/\r?\n/, 1)[0] || ''
  const rows = parseCSV(String(text), (head.match(/;/g) || []).length > (head.match(/,/g) || []).length ? ';' : ',')
  if (rows.length < 2) return { error: 'unrecognised' }
  const header = rows[0].map(h => String(h).trim().toLowerCase())
  const find = re => header.findIndex(h => re.test(h))
  const iType = find(/activity type|aktivitetstyp|^typ/), iDate = find(/^date|^datum/)
  const iDist = find(/^distance|^distans|^sträcka/), iTime = find(/^time$|^tid$|total time|elapsed|varaktighet|^duration/)
  const iHr = find(/avg hr|average hr|medelpuls|genomsnittlig puls|average heart|avg\.? heart/)
  if (iDate < 0 || iTime < 0 || (iType < 0 && iDist < 0)) return { error: 'unrecognised' }
  const out = []
  let skipped = 0
  for (const r of rows.slice(1)) {
    const a = clean({
      kind: kindOf(r[iType]), label: r[iType], start: Date.parse(String(r[iDate]).replace(' ', 'T')),
      min: clock(r[iTime]), km: iDist >= 0 ? num(r[iDist]) : 0, hr: iHr >= 0 ? num(r[iHr]) : 0
    }, 'Garmin')
    if (a) out.push(a); else skipped++
  }
  return { activities: out, skipped, assumed: ['km'] }
}

/** The account-data export: DI_CONNECT/DI-Connect-Fitness/*_summarizedActivities.json. */
export function parseGarminJson(text) {
  let data
  try { data = JSON.parse(text) } catch { return { error: 'unrecognised' } }
  const list = []
  const walk = v => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      if (v.summarizedActivitiesExport) walk(v.summarizedActivitiesExport)
      else if (v.activityType !== undefined && (v.beginTimestamp || v.startTimeLocal)) list.push(v)
    }
  }
  walk(data)
  if (!list.length) return { error: 'unrecognised' }
  const out = []
  let skipped = 0
  for (const x of list) {
    const type = typeof x.activityType === 'string' ? x.activityType : x.activityType?.typeKey
    // Duration is milliseconds in this export (seconds below 100 000 would be over a day);
    // distance is centimetres.
    const dur = num(x.duration)
    const min = (dur > 100000 ? dur / 1000 : dur) / 60
    let km = num(x.distance) / 100000
    if (km > 0 && min > 0 && km / (min / 60) < 1 && num(x.distance) / 1000 / (min / 60) <= 60) km = num(x.distance) / 1000
    const a = clean({ kind: kindOf(type), label: String(type || '').replace(/_/g, ' '), start: num(x.beginTimestamp) || num(x.startTimeLocal), min, km, hr: num(x.avgHr) }, 'Garmin')
    if (a) out.push(a); else skipped++
  }
  return { activities: out, skipped }
}

/* ---------------------------------------------------------------- the session ---- */

/**
 * Split parsed activities into those to add and those already here. An activity is already
 * here when it was imported before, or overlaps a logged session by at least half its length
 * — which is what a walk logged by hand and recorded by the watch looks like.
 */
export function planImport(S, activities) {
  const existing = (S.workouts || []).map(w => ({ ext: w.ext, a: w.start, b: w.end ?? w.start }))
  const seen = new Set(existing.map(e => e.ext).filter(Boolean))
  const fresh = [], dup = []
  for (const a of activities) {
    const ext = `${a.source}:${a.start}`
    const end = a.start + a.min * 60000
    const overlaps = existing.some(e => Math.min(end, e.b) - Math.max(a.start, e.a) >= (end - a.start) / 2)
    if (seen.has(ext) || overlaps) { dup.push(a); continue }
    seen.add(ext)
    fresh.push({ ...a, ext })
  }
  return { fresh, dup }
}

/** A finished session for one imported activity, tagged so the import can be undone. */
export function importedWorkout(a, batch, tr = x => x) {
  const w = buildActivityWorkout({
    id: 'ia' + uid(), exId: KIND_EX[a.kind], name: a.kind === 'other' && a.label ? a.label : tr(KIND_NAME[a.kind]),
    day: isoOf(new Date(a.start)), endMs: a.start + a.min * 60000, min: a.min, km: a.km || null, hr: a.hr || null
  })
  if (!w) return null
  w.ext = a.ext
  w.imp = batch
  return w
}

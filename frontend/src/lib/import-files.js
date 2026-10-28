// Reading the files people actually have: an export.zip from Apple Health (often several
// hundred MB once unpacked), a Garmin Connect download, or a single TCX / GPX / CSV / JSON.
//
// Nothing here loads a big file whole. A zip is opened through its directory and only the
// entries that matter are inflated, as a stream the browser decompresses itself; Apple's
// export.xml is scanned in pieces for its <Workout> elements and the rest is never held.

import {
  scanHealthChunk, parseTcx, parseGpx, parseGarminCsv, parseGarminJson
} from './import-activities.js'

/** Entries of a zip (no zip64, no encryption). */
export async function zipEntries(file) {
  const tailLen = Math.min(file.size, 65557)
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer())
  let e = -1
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break }
  if (e < 0) throw new Error('not a zip file')
  const count = tail.getUint16(e + 10, true), cdSize = tail.getUint32(e + 12, true), cdOff = tail.getUint32(e + 16, true)
  if (cdOff === 0xFFFFFFFF || count === 0xFFFF) throw new Error('zip64')
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer())
  const dec = new TextDecoder()
  const out = []
  let p = 0
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break
    const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true)
    const entry = {
      name: dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen)),
      method: cd.getUint16(p + 10, true), csize: cd.getUint32(p + 20, true), usize: cd.getUint32(p + 24, true),
      offset: cd.getUint32(p + 42, true)
    }
    if (entry.csize === 0xFFFFFFFF || entry.offset === 0xFFFFFFFF) throw new Error('zip64')
    out.push(entry)
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/** The entry's bytes as a stream of text. */
async function entryText(file, entry) {
  const head = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer())
  const start = entry.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true)
  let s = file.slice(start, start + entry.csize).stream()
  if (entry.method === 8) s = s.pipeThrough(new DecompressionStream('deflate-raw'))
  else if (entry.method !== 0) throw new Error('zip method')
  return s.pipeThrough(new TextDecoderStream())
}

async function readAll(textStream) {
  let s = ''
  const r = textStream.getReader()
  for (;;) { const { done, value } = await r.read(); if (done) return s; s += value }
}

async function healthFrom(textStream) {
  const out = []
  let rest = ''
  const r = textStream.getReader()
  for (;;) {
    const { done, value } = await r.read()
    if (done) return out
    const scanned = scanHealthChunk(rest + value)
    out.push(...scanned.out)
    rest = scanned.rest
  }
}

const merge = (into, part) => {
  if (!part) return
  if (part.error) { into.errors.push(part.error); return }
  const list = Array.isArray(part) ? part : part.activities
  into.activities.push(...list)
  into.skipped += part.skipped || 0
  into.assumed.push(...(part.assumed || []))
}

/** Read any supported file (or several) into activities. */
export async function readActivityFiles(files) {
  const res = { activities: [], skipped: 0, assumed: [], errors: [], sources: new Set() }
  for (const file of files) {
    const name = file.name.toLowerCase()
    if (name.endsWith('.zip')) {
      const entries = await zipEntries(file)
      for (const e of entries) {
        const n = e.name.toLowerCase()
        if (n.endsWith('/')) continue
        if (/(^|\/)export\.xml$/.test(n)) { res.activities.push(...await healthFrom(await entryText(file, e))); res.sources.add('Apple Health') }
        else if (/summarizedactivities.*\.json$/.test(n)) { merge(res, parseGarminJson(await readAll(await entryText(file, e)))); res.sources.add('Garmin') }
        else if (/activities.*\.csv$/.test(n)) { merge(res, parseGarminCsv(await readAll(await entryText(file, e)))); res.sources.add('Garmin') }
        else if (n.endsWith('.tcx')) { merge(res, parseTcx(await readAll(await entryText(file, e)))); res.sources.add('TCX') }
        else if (n.endsWith('.gpx')) { merge(res, parseGpx(await readAll(await entryText(file, e)))); res.sources.add('GPX') }
      }
    } else if (name.endsWith('.xml')) {
      const head = await file.slice(0, 4096).text()
      if (head.includes('TrainingCenterDatabase')) { merge(res, parseTcx(await file.text())); res.sources.add('TCX') }
      else if (head.includes('HealthData') || head.includes('<Workout')) {
        res.activities.push(...await healthFrom(file.stream().pipeThrough(new TextDecoderStream()))); res.sources.add('Apple Health')
      } else res.errors.push('unrecognised')
    } else if (name.endsWith('.tcx')) { merge(res, parseTcx(await file.text())); res.sources.add('TCX') }
    else if (name.endsWith('.gpx')) { merge(res, parseGpx(await file.text())); res.sources.add('GPX') }
    else if (name.endsWith('.csv')) { merge(res, parseGarminCsv(await file.text())); res.sources.add('Garmin') }
    else if (name.endsWith('.json')) { merge(res, parseGarminJson(await file.text())); res.sources.add('Garmin') }
    else res.errors.push('unrecognised')
  }
  res.sources = [...res.sources]
  return res
}

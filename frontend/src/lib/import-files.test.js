import { it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { readActivityFiles } from './import-files.js'

// A minimal zip writer: one deflated entry per file, with a central directory.
function zip(files) {
  const parts = [], cds = []
  let off = 0
  for (const [name, text] of Object.entries(files)) {
    const nameB = Buffer.from(name), raw = Buffer.from(text), data = deflateRawSync(raw)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(off, 42)
    parts.push(lh, nameB, data); cds.push(ch, nameB)
    off += 30 + nameB.length + data.length
  }
  const cd = Buffer.concat(cds)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, cd, end])
}

const WORKOUT = '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalDistance="5" totalDistanceUnit="km" startDate="2026-10-27 08:15:00 +0200"/>'

it('reads Apple Health workouts out of export.zip without the records', async () => {
  const xml = '<HealthData>' + '<Record type="x" value="1"/>\n'.repeat(5000) + WORKOUT + '</HealthData>'
  const file = new File([zip({ 'apple_health_export/export.xml': xml })], 'export.zip')
  const r = await readActivityFiles([file])
  expect(r.sources).toEqual(['Apple Health'])
  expect(r.activities).toEqual([expect.objectContaining({ kind: 'run', min: 30, km: 5 })])
})
it('reads a plain Garmin CSV and a zip of them', async () => {
  const csv = 'Activity Type,Date,Distance,Time\nRunning,2026-10-27 06:00:00,5.0,00:30:00\n'
  expect((await readActivityFiles([new File([csv], 'Activities.csv')])).activities).toHaveLength(1)
  const z = new File([zip({ 'x/Activities.csv': csv })], 'garmin.zip')
  expect((await readActivityFiles([z])).activities).toHaveLength(1)
})
it('reports an unrecognised file', async () => {
  const r = await readActivityFiles([new File(['hello'], 'a.txt')])
  expect(r.errors).toEqual(['unrecognised'])
})

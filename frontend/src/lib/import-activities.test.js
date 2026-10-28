import { it, expect } from 'vitest'
import {
  kindOf, healthWorkout, scanHealthChunk, parseTcx, parseGpx, parseGarminCsv, parseGarminJson,
  planImport, importedWorkout
} from './import-activities.js'

const WORKOUT = '<Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="42.5" durationUnit="min" totalDistance="3.4" totalDistanceUnit="km" startDate="2026-10-27 08:15:00 +0200" endDate="2026-10-27 08:58:00 +0200"><WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="101.4" unit="count/min"/></Workout>'

it('kind from English and Swedish names', () => {
  expect(kindOf('Running')).toBe('run')
  expect(kindOf('Promenad')).toBe('walk')
  expect(kindOf('Hiking')).toBe('hike')
  expect(kindOf('lap_swimming')).toBe('swim')
  expect(kindOf('Cykling')).toBe('bike')
  expect(kindOf('Yoga')).toBe('other')
})
it('reads an Apple Health workout', () => {
  expect(healthWorkout(WORKOUT)).toMatchObject({ kind: 'walk', min: 43, km: 3.4, hr: 101, start: Date.parse('2026-10-27T08:15:00+02:00') })
})
it('scans chunks split anywhere', () => {
  const text = '<Record a="1"/>\n' + WORKOUT + '\n<Record b="2"/>\n' + WORKOUT.replace('08:15', '09:15') + '\n'
  for (const cut of [10, 60, 200, 330, 400]) {
    let { out, rest } = scanHealthChunk(text.slice(0, cut))
    const r2 = scanHealthChunk(rest + text.slice(cut))
    expect(out.length + r2.out.length).toBe(2)
  }
})
it('reads TCX laps', () => {
  const tcx = '<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-10-27T06:00:00Z</Id><Lap StartTime="2026-10-27T06:00:00Z"><TotalTimeSeconds>1800</TotalTimeSeconds><DistanceMeters>5000</DistanceMeters><AverageHeartRateBpm><Value>150</Value></AverageHeartRateBpm></Lap><Lap StartTime="x"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>1500</DistanceMeters></Lap></Activity></Activities></TrainingCenterDatabase>'
  expect(parseTcx(tcx)).toEqual([expect.objectContaining({ kind: 'run', min: 40, km: 6.5, hr: 150, source: 'TCX' })])
})
it('reads a GPX track', () => {
  const gpx = '<gpx><trk><type>walking</type><trkseg>' +
    '<trkpt lat="59.0" lon="18.0"><time>2026-10-27T06:00:00Z</time></trkpt>' +
    '<trkpt lat="59.009" lon="18.0"><time>2026-10-27T06:12:00Z</time></trkpt></trkseg></trk></gpx>'
  const [a] = parseGpx(gpx)
  expect(a).toMatchObject({ kind: 'walk', min: 12 })
  expect(a.km).toBeCloseTo(1, 1)
})
it('reads a Garmin CSV, comma or semicolon', () => {
  const csv = 'Activity Type,Date,Title,Distance,Calories,Time,Avg HR\nRunning,2026-10-27 06:00:00,Morning,"5,0",300,00:30:00,150\nWalking,bad,x,1,1,00:10:00,90\n'
  const r = parseGarminCsv(csv.replace('"5,0"', '5.0'))
  expect(r.activities).toEqual([expect.objectContaining({ kind: 'run', min: 30, km: 5, hr: 150 })])
  expect(r.skipped).toBe(1)
  const semi = parseGarminCsv('Aktivitetstyp;Datum;Distans;Tid;Medelpuls\nLöpning;2026-10-27 06:00:00;5,0;00:30:00;150\n')
  expect(semi.activities[0]).toMatchObject({ kind: 'run', km: 5 })
  expect(parseGarminCsv('a,b\n1,2').error).toBe('unrecognised')
})
it('reads the Garmin account export', () => {
  const json = JSON.stringify([{ summarizedActivitiesExport: [{ activityType: 'running', beginTimestamp: Date.parse('2026-10-27T06:00:00Z'), duration: 1800000, distance: 500000, avgHr: 150 }] }])
  expect(parseGarminJson(json).activities[0]).toMatchObject({ kind: 'run', min: 30, km: 5, hr: 150 })
  expect(parseGarminJson('{}').error).toBe('unrecognised')
})
it('skips duplicates and sessions already logged', () => {
  const a = { kind: 'walk', label: '', start: 1e12, min: 40, km: 3, hr: 0, source: 'TCX' }
  const S = { workouts: [{ ext: 'TCX:' + 1e12 }] }
  expect(planImport(S, [a]).dup).toHaveLength(1)
  const logged = { workouts: [{ start: 1e12 + 5 * 60000, end: 1e12 + 45 * 60000 }] }
  expect(planImport(logged, [a]).dup).toHaveLength(1)
  expect(planImport({ workouts: [] }, [a, { ...a }]).fresh).toHaveLength(1)
})
it('builds a tagged cardio session', () => {
  const w = importedWorkout({ kind: 'bike', label: '', start: Date.parse('2026-10-27T06:00:00'), min: 60, km: 20, hr: 0, ext: 'x:1' }, 777)
  expect(w).toMatchObject({ imp: 777, ext: 'x:1', entries: [{ id: 'act-bike', target: { mode: 'cardio' } }] })
})

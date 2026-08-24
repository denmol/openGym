import { describe, expect, it } from 'vitest'
import { mergeImport, parseBodyweight, parseImport, parseSteps } from './import-csv.js'

describe('Apple Health body-weight units', () => {
  it('converts each record from its own unit instead of applying the last unit to every row', () => {
    const parsed = parseBodyweight(`
      <HealthData>
        <Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="80" startDate="2026-08-22T08:00:00Z" />
        <Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" value="220" startDate="2026-08-23T08:00:00Z" />
      </HealthData>
    `, { unit: 'kg' })

    expect(parsed.mixedUnits).toBe(true)
    expect(parsed.converted).toBe(true)
    expect(parsed.bodyweight.map(({ d, w, u }) => ({ d, w, u }))).toEqual([
      { d: '2026-08-22', w: 80, u: 'kg' },
      { d: '2026-08-23', w: 99.8, u: 'kg' }
    ])
  })
})

describe('parseHealthWorkouts', () => {
  const wrap = inner => `<?xml version="1.0"?><HealthData>${inner}</HealthData>`

  it('reads the older shape, where everything is on the element', () => {
    const p = parseImport(wrap(`<Workout workoutActivityType="HKWorkoutActivityTypeRunning"
      duration="46.2" durationUnit="min" totalDistance="8.1" totalDistanceUnit="km"
      startDate="2026-08-20 07:12:03 +0200" endDate="2026-08-20 07:58:00 +0200"/>`))
    expect(p).toMatchObject({ kind: 'workouts', source: 'Apple Health', sets: 1 })
    expect(p.workouts[0].entries[0].sets[0]).toEqual({ min: 46, km: 8.1, done: true })
    expect(p.workouts[0].entries[0].target).toEqual({ mode: 'cardio' })
  })

  it('reads the iOS 16 shape, where distance and pulse are children', () => {
    const p = parseImport(wrap(`<Workout workoutActivityType="HKWorkoutActivityTypeRunning"
      duration="30" durationUnit="min" startDate="2026-08-21 07:00:00 +0200">
      <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="5.5" unit="km"/>
      <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="151.4" unit="count/min"/>
    </Workout>`))
    expect(p.workouts[0].entries[0].sets[0]).toEqual({ min: 30, km: 5.5, hr: 151, done: true })
  })

  it('converts miles, metres and seconds into the units the app stores', () => {
    const p = parseImport(wrap(`<Workout workoutActivityType="HKWorkoutActivityTypeRunning"
      duration="1800" durationUnit="s" totalDistance="3.1" totalDistanceUnit="mi"
      startDate="2026-08-22 07:00:00 +0200"/>
      <Workout workoutActivityType="HKWorkoutActivityTypeRunning"
      duration="20" durationUnit="min" totalDistance="4000" totalDistanceUnit="m"
      startDate="2026-08-23 07:00:00 +0200"/>`))
    expect(p.workouts[0].entries[0].sets[0]).toMatchObject({ min: 30, km: 4.99 })
    expect(p.workouts[1].entries[0].sets[0]).toMatchObject({ min: 20, km: 4 })
  })

  it('turns the activity type into a readable name and matches it where it can', () => {
    const p = parseImport(wrap(`<Workout workoutActivityType="HKWorkoutActivityTypeHighIntensityIntervalTraining"
      duration="25" durationUnit="min" startDate="2026-08-20 18:00:00 +0200"/>`))
    expect(p.unmatched).toEqual(['high intensity interval training'])
    expect(p.customEx[0]).toMatchObject({ n: 'high intensity interval training', bp: 'cardio', custom: true })
  })

  it('groups a day with two sessions into one workout', () => {
    const p = parseImport(wrap(`<Workout workoutActivityType="HKWorkoutActivityTypeRunning"
      duration="20" durationUnit="min" totalDistance="4" totalDistanceUnit="km" startDate="2026-08-20 07:00:00 +0200"/>
      <Workout workoutActivityType="HKWorkoutActivityTypeRunning"
      duration="30" durationUnit="min" totalDistance="6" totalDistanceUnit="km" startDate="2026-08-20 18:00:00 +0200"/>`))
    expect(p.workouts).toHaveLength(1)
    expect(p.workouts[0].entries[0].sets).toHaveLength(2)
  })

  it('skips a workout with neither a duration nor a distance', () => {
    const p = parseImport(wrap(`<Workout workoutActivityType="HKWorkoutActivityTypeRunning"
      duration="0" durationUnit="min" startDate="2026-08-20 07:00:00 +0200"/>
      <Workout workoutActivityType="HKWorkoutActivityTypeRunning"
      duration="30" durationUnit="min" startDate="2026-08-21 07:00:00 +0200"/>`))
    expect(p.sets).toBe(1)
    expect(p.skipped).toBe(1)
  })

  it('leaves a weight-only export to the body-weight reader', () => {
    const p = parseImport(wrap(`<Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="80" startDate="2026-08-22T08:00:00Z" />`))
    expect(p.kind).toBe('bodyweight')
  })

  it('takes both when an export carries workouts and weights', () => {
    const p = parseImport(wrap(`<Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="80" startDate="2026-08-22T08:00:00Z" />
      <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min"
      totalDistance="5" totalDistanceUnit="km" startDate="2026-08-22 07:00:00 +0200"/>`))
    expect(p.kind).toBe('health')
    expect(p.workouts).toHaveLength(1)
    expect(p.bodyweight).toHaveLength(1)
  })
})

describe('parseSteps', () => {
  const wrap = inner => `<?xml version="1.0"?><HealthData>${inner}</HealthData>`
  const rec = (src, date, value) =>
    `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="${src}" unit="count" startDate="${date}" value="${value}"/>`

  it('adds up the records a day is made of', () => {
    const p = parseImport(wrap(rec('iPhone', '2026-08-20 08:00:00 +0200', 1200)
      + rec('iPhone', '2026-08-20 12:00:00 +0200', 3300)))
    expect(p).toMatchObject({ kind: 'steps', source: 'Apple Health' })
    expect(p.steps).toEqual([{ d: '2026-08-20', n: 4500, src: 'iPhone' }])
  })

  it('does not double-count a day the phone and the watch both recorded', () => {
    // The naive sum is 12 000; Health shows the watch's 7 000.
    const p = parseImport(wrap(rec('iPhone', '2026-08-20 08:00:00 +0200', 5000)
      + rec('Apple Watch', '2026-08-20 08:00:00 +0200', 7000)))
    expect(p.steps).toEqual([{ d: '2026-08-20', n: 7000, src: 'Apple Watch' }])
    expect(p.deduplicated).toBe(true)
  })

  it('keeps the hours only one device saw, and does not double the hours both saw', () => {
    // A shift worked with the phone alone, then an evening walk with the watch on. Taking
    // the day's largest source would hand the day to the phone and lose the walk; adding
    // them up would count the 17:00 hour twice.
    const p = parseImport(wrap(
      rec('iPhone', '2026-08-20 09:00:00 +0200', 3000) +
      rec('iPhone', '2026-08-20 13:00:00 +0200', 2500) +
      rec('iPhone', '2026-08-20 17:00:00 +0200', 1800) +
      rec('Apple Watch', '2026-08-20 17:00:00 +0200', 2000) +
      rec('Apple Watch', '2026-08-20 19:00:00 +0200', 4000)))
    // 3000 + 2500 + max(1800, 2000) + 4000
    expect(p.steps).toEqual([{ d: '2026-08-20', n: 11500, src: 'Apple Watch' }])
    expect(p.deduplicated).toBe(true)
  })

  it('attributes the day to whichever device won the most of its hours', () => {
    const p = parseImport(wrap(
      rec('iPhone', '2026-08-20 09:00:00 +0200', 9000) +
      rec('Apple Watch', '2026-08-20 19:00:00 +0200', 1000)))
    expect(p.steps[0]).toMatchObject({ n: 10000, src: 'iPhone' })
  })

  it('picks the winning source per day, not once for the whole file', () => {
    const p = parseImport(wrap(rec('iPhone', '2026-08-20 08:00:00 +0200', 5000)
      + rec('Apple Watch', '2026-08-20 08:00:00 +0200', 7000)
      + rec('iPhone', '2026-08-21 08:00:00 +0200', 9000)))
    expect(p.steps).toEqual([
      { d: '2026-08-20', n: 7000, src: 'Apple Watch' },
      { d: '2026-08-21', n: 9000, src: 'iPhone' }
    ])
  })

  it('says nothing about reconciliation when only one device recorded', () => {
    expect(parseImport(wrap(rec('Apple Watch', '2026-08-20 08:00:00 +0200', 7000))).deduplicated).toBe(false)
  })

  it('reads a steps CSV, thousands separators included', () => {
    const p = parseSteps('Date,Actual,Goal\n2026-08-20,"12,431",10000\n2026-08-21,8200,10000\n')
    expect(p.steps).toEqual([
      { d: '2026-08-20', n: 12431, src: 'CSV' },
      { d: '2026-08-21', n: 8200, src: 'CSV' }
    ])
  })

  it('does not claim a CSV that has no steps column', () => {
    expect(parseSteps('Date,Weight\n2026-08-20,80\n').error).toBe('unrecognised')
    expect(parseSteps('').error).toBe('empty')
  })

  it('skips a day that adds up to nothing', () => {
    expect(parseImport(wrap(rec('iPhone', '2026-08-20 08:00:00 +0200', 0))).kind).not.toBe('steps')
  })
})

describe('one Apple Health export, one import', () => {
  const full = `<?xml version="1.0"?><HealthData>
    <Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="80" startDate="2026-08-19T08:00:00Z"/>
    <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" startDate="2026-08-20 08:00:00 +0200" value="9100"/>
    <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min"
      totalDistance="5" totalDistanceUnit="km" startDate="2026-08-21 07:00:00 +0200"/>
  </HealthData>`

  it('takes workouts, steps and weights in one pass', () => {
    const p = parseImport(full, { unit: 'kg' })
    expect(p.kind).toBe('health')
    expect(p.workouts).toHaveLength(1)
    expect(p.steps).toHaveLength(1)
    expect(p.bodyweight).toHaveLength(1)
    expect([p.from, p.to]).toEqual(['2026-08-19', '2026-08-21'])
  })

  it('merges all three, and adds only days the profile lacks', () => {
    const p = parseImport(full, { unit: 'kg' })
    const S = { workouts: [], bodyweight: [], steps: [], customEx: [], exWeights: {} }
    expect(mergeImport(S, p)).toMatchObject({ workouts: 1, steps: 1, bodyweight: 1, added: 3 })
    expect(mergeImport(S, p)).toMatchObject({ workouts: 0, steps: 0, bodyweight: 0, added: 0 })
    expect(S.steps).toEqual([{ d: '2026-08-20', n: 9100, src: 'import' }])
  })

  it('stays a single-kind import when the file only holds one of them', () => {
    expect(parseImport(`<HealthData><Record type="HKQuantityTypeIdentifierStepCount"
      sourceName="Apple Watch" unit="count" startDate="2026-08-20 08:00:00 +0200" value="9100"/></HealthData>`).kind)
      .toBe('steps')
  })
})

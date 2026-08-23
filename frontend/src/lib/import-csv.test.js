import { describe, expect, it } from 'vitest'
import { parseBodyweight, parseImport } from './import-csv.js'

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

  it('prefers the workouts when an export carries both', () => {
    const p = parseImport(wrap(`<Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="80" startDate="2026-08-22T08:00:00Z" />
      <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min"
      totalDistance="5" totalDistanceUnit="km" startDate="2026-08-22 07:00:00 +0200"/>`))
    expect(p.kind).toBe('workouts')
    expect(p.source).toBe('Apple Health')
  })
})

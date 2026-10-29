import { afterEach, describe, expect, it, vi } from 'vitest'
import { insertWorkout, lastEntryFor, streakWeeks } from './history.js'
import { nextPrescription } from './progression.js'
import { flexWeek } from './flex.js'
import { weekKey, todayISO } from './format.js'
import { dayActivity } from './nutrition-activity.js'
import { dayTotals, mealsOn, newMeal } from './nutrition.js'

const cfg = { id: 'bench', sets: 1, reps: 5, weight: 20, inc: 2.5 }
const workout = (id, d, w, r = 5, time = '12:00') => ({
  id, d, start: +new Date(`${d}T${time}:00`), end: +new Date(`${d}T${time}:00`) + 3600000,
  routineId: 'a', name: 'Synthetic strength',
  entries: [{ id: cfg.id, target: cfg, sets: [{ w, r, done: true }] }]
})
afterEach(() => vi.useRealTimers())

describe('backfilled workout consumers', () => {
  it('repairs legacy append order before readers choose the latest session', () => {
    const latest = workout('latest', '2026-10-28', 60)
    const old = workout('old-activity', '2026-10-10', 20)
    const list = [latest, old]
    insertWorkout(list, workout('backfill', '2026-10-20', 40))
    expect(list.map(w => w.id)).toEqual(['old-activity', 'backfill', 'latest'])
    expect(lastEntryFor({ workouts: list }, 'bench').sets[0].w).toBe(60)
    expect(nextPrescription({ workouts: list }, cfg).weight).toBe(62.5)
  })
  it('keeps same-day order, latest progression and routine rotation after an earlier session', () => {
    const list = [workout('morning', '2026-10-28', 40, 5, '08:00'),
      { ...workout('evening', '2026-10-28', 60, 5, '18:00'), routineId: 'b' }]
    const saved = JSON.stringify(list)
    insertWorkout(list, workout('midday', '2026-10-28', 50))
    expect(list.map(w => w.id)).toEqual(['morning', 'midday', 'evening'])
    expect(JSON.stringify([list[0], list[2]])).toBe(saved)
    const state = { workouts: list, routines: [{ id: 'a' }, { id: 'b' }], week: {}, flex: { on: true, perWeek: 4 } }
    expect(flexWeek(state, '2026-10-29')).toMatchObject({ done: 3, left: 1, next: { id: 'a' } })
    expect(nextPrescription(state, cfg)).toMatchObject({ kind: 'up', weight: 62.5 })
  })
  it('counts Sunday in the old week and Monday in the new week across the year boundary', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-05T00:15:00'))
    const state = { workouts: [], routines: [], week: {}, flex: { perWeek: 3 } }
    insertWorkout(state.workouts, workout('sunday', '2027-01-03', 40))
    expect(weekKey('2027-01-03')).toBe('2026-53')
    expect(weekKey('2027-01-04')).toBe('2027-1')
    expect(flexWeek(state, todayISO()).done).toBe(0)
    insertWorkout(state.workouts, workout('monday', '2027-01-04', 50))
    expect(flexWeek(state, todayISO()).done).toBe(1)
    expect(streakWeeks(state)).toBe(2)
  })
  it('allows an older missing success to interrupt a run of failures without rewriting later sets', () => {
    const list = [workout('miss1', '2026-10-20', 60, 3), workout('miss2', '2026-10-24', 60, 3), workout('miss3', '2026-10-28', 60, 3)]
    expect(nextPrescription({ workouts: list }, cfg).kind).toBe('deload')
    insertWorkout(list, workout('success', '2026-10-22', 60))
    expect(nextPrescription({ workouts: list }, cfg)).toMatchObject({ kind: 'hold', weight: 60 })
  })
})

describe('historical activity energy', () => {
  const w = workout('one', '2026-10-20', 40)
  it('uses the last known weight on that day, not a later weigh-in or array position', () => {
    const state = { workouts: [w], bodyweight: [{ d: '2026-10-19', w: 80, u: 'kg' }, { d: '2026-10-29', w: 100, u: 'kg' }, { d: '2026-10-01', w: 70, u: 'kg' }] }
    expect(dayActivity(state, w.d)).toMatchObject({ total: 200, weightKg: 80, rows: [{ minutes: 60, kcal: 200 }] })
  })
  it('does not invent historic calories when the only weight was recorded later', () => {
    expect(dayActivity({ workouts: [w], bodyweight: [{ d: '2026-10-29', w: 100, u: 'kg' }] }, w.d)).toMatchObject({ total: null, rows: [{ minutes: 60, kcal: null }] })
  })
  it('prefers a workout weigh-in and converts pounds', () => {
    expect(dayActivity({ workouts: [{ ...w, bw: 176.4, bwu: 'lb' }], bodyweight: [] }, w.d).total).toBe(200)
  })
  it('counts mixed cardio plus strength once and ignores incomplete sets and other days', () => {
    const mixed = { ...w, entries: [...w.entries, { id: 'act-walk', sets: [{ min: 20, done: true }, { min: 80, done: false }] }] }
    const state = { workouts: [mixed, workout('other', '2026-10-21', 50)], bodyweight: [{ d: w.d, w: 80, u: 'kg' }] }
    expect(dayActivity(state, w.d)).toMatchObject({ total: 200, rows: [{ minutes: 60, kcal: 200 }] })
  })
  it('shows the recorded duration even when the conservative strength energy estimate is capped', () => {
    const long = { ...w, end: w.start + 360 * 60000 }
    expect(dayActivity({ workouts: [long], bodyweight: [{ d: w.d, w: 80, u: 'kg' }] }, w.d))
      .toMatchObject({ total: 600, rows: [{ minutes: 360, kcal: 600, strengthEstimateMinutes: 180 }] })
  })
  it('does not present a partial calorie sum as a complete total when one session lacks weight', () => {
    const state = { bodyweight: [], workouts: [{ ...w, bw: 80, bwu: 'kg' }, { ...w, id: 'unknown' }] }
    expect(dayActivity(state, w.d)).toMatchObject({ total: null, rows: [{ kcal: 200 }, { kcal: null }] })
  })
})

describe('meal date accounting', () => {
  it('moves intake between dates without duplicating or changing grams, including month/year edges', () => {
    const foods = { food: { per100: { kcal: 200, carb: 20, prot: 10, fat: 5 } } }
    const meal = { id: 'synthetic-meal', ...newMeal({ kind: 'dinner', d: '2026-12-31', t: '23:55', items: [{ fid: 'food', g: 150 }] }) }
    const state = { meals: [meal] }
    expect(dayTotals(state, '2026-12-31', foods).kcal).toBe(300)
    Object.assign(meal, { d: '2027-01-01', t: '00:05' })
    expect(dayTotals(state, '2026-12-31', foods).kcal).toBe(0)
    expect(dayTotals(state, '2027-01-01', foods)).toMatchObject({ kcal: 300, carb: 30, prot: 15 })
    expect(mealsOn(state, '2027-01-01')).toHaveLength(1)
    expect(state.meals).toHaveLength(1)
  })
})

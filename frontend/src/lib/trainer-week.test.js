import { describe, expect, it } from 'vitest'
import { weekSummary, weeklyAim } from './trainer-week.js'
import { isoOf } from './format.js'

const DAY = 86400000
// Wednesday 2026-10-28, noon. The week began Monday the 26th; last week began the 19th.
const WED = new Date(2026, 9, 28, 12, 0, 0).getTime()
const MON = new Date(2026, 9, 26, 12, 0, 0).getTime()
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const wk = (ms, sets, prs) => ({ d: isoOf(new Date(ms)), start: ms, routineId: 'r1', entries: [{ id: '0025', sets }], ...(prs ? { prs } : {}) })
const four = () => [set(60, 8), set(60, 8), set(60, 8), set(60, 8)]
const FOOD = { id: 'own1', n: 'f', per100: { kcal: 100, carb: 10, sugar: 0, prot: 10, fat: 1, sat: 0, fib: 0, salt: 0 } }
const meal = (ms, g) => ({ d: isoOf(new Date(ms)), t: '12:00', kind: 'lunch', items: [{ fid: 'own1', g }] })
const weigh = (ms, kg) => ({ d: isoOf(new Date(ms)), t: ms, w: kg, u: 'kg' })

const S0 = (over = {}) => ({
  unit: 'kg', routines: [{ id: 'r1', name: 'U', ex: [] }], week: { 1: 'r1', 3: 'r1', 5: 'r1' }, myFoods: [FOOD],
  coachProfile: { goal: 'muscle', age: 35 }, bodyweight: [], meals: [],
  workouts: [wk(WED - 9 * DAY, four()), wk(WED - 7 * DAY, four()), wk(MON, four(), ['0025'])],
  ...over
})

describe('weekSummary', () => {
  it('is null before the first workout', () => {
    expect(weekSummary(S0({ workouts: [] }), WED)).toBeNull()
  })

  it('counts this week so far against the planned days on a Wednesday', () => {
    const w = weekSummary(S0(), WED)
    expect(w).toMatchObject({ which: 'current', start: '2026-10-26', end: '2026-11-01', sessions: 1, aim: 3, sets: 4 })
    expect(w.prevSets).toBe(8)                 // two sessions of four sets the week before
    expect(w.prs).toEqual(['0025'])
  })

  it('shows last week on Monday and Tuesday, once last week had training', () => {
    const tue = new Date(2026, 9, 27, 12).getTime()
    const w = weekSummary(S0(), tue)
    expect(w).toMatchObject({ which: 'previous', start: '2026-10-19', end: '2026-10-25', sessions: 2, sets: 8 })
  })

  it('stays on the current week on Monday if last week was empty', () => {
    const S = S0({ workouts: [wk(MON, four())] })
    expect(weekSummary(S, MON).which).toBe('current')
  })

  it('does not count warm-ups or unfinished sets', () => {
    const S = S0({ workouts: [wk(MON, [set(20, 10, { warm: true }), set(60, 8), { w: 60, r: 8, done: false }])] })
    expect(weekSummary(S, WED).sets).toBe(1)
  })

  it('the aim is the flexible-week number when that is on', () => {
    expect(weeklyAim(S0())).toBe(3)
    expect(weeklyAim(S0({ flex: { on: true, perWeek: 2 } }))).toBe(2)
    expect(weekSummary(S0({ flex: { on: true, perWeek: 2 } }), WED).aim).toBe(2)
  })

  it('ignores a planned day that points at a deleted routine', () => {
    expect(weeklyAim(S0({ week: { 1: 'gone', 3: 'r1' } }))).toBe(1)
  })
})

describe('food and weight in the summary', () => {
  it('reports protein over the whole days so far this week, from three days up', () => {
    const meals = [MON, MON + DAY, MON + 2 * DAY].map(ms => meal(ms, 1000))      // Mon, Tue, Wed: 100 g, 1000 kcal
    const S = S0({ meals, bodyweight: [weigh(WED - DAY, 80)] })
    expect(weekSummary(S, WED).protein).toEqual({ days: 3, avgG: 100, gPerKg: 1.25 })
  })

  it('says nothing about protein from fewer days', () => {
    const S = S0({ meals: [MON, MON + DAY].map(ms => meal(ms, 1000)), bodyweight: [weigh(WED - DAY, 80)] })
    expect(weekSummary(S, WED).protein).toBeNull()
  })

  it('reports the change in weight against the last weigh-in before the week', () => {
    const S = S0({ bodyweight: [weigh(MON - 3 * DAY, 80), weigh(WED - DAY, 79.4)] })
    expect(weekSummary(S, WED).weightDelta).toBe(-0.6)
  })

  it('falls back to first versus last inside the week when nothing came before', () => {
    const S = S0({ bodyweight: [weigh(MON, 80), weigh(WED, 80.5)] })
    expect(weekSummary(S, WED).weightDelta).toBe(0.5)
  })

  it('has no change from a single weigh-in', () => {
    expect(weekSummary(S0({ bodyweight: [weigh(WED, 80)] }), WED).weightDelta).toBeNull()
  })

  it('leaves both out for anyone food advice is not given to', () => {
    const meals = [MON, MON + DAY, MON + 2 * DAY].map(ms => meal(ms, 1000))
    const S = S0({ meals, bodyweight: [weigh(MON - DAY, 80), weigh(WED, 79)], nutritionGoals: { safety: { eatingDisorder: true } } })
    const w = weekSummary(S, WED)
    expect(w.protein).toBeNull()
    expect(w.weightDelta).toBeNull()
    expect(w.sessions).toBe(1)               // training is still reported
  })

  it('leaves both out for a minor', () => {
    const S = S0({ bodyweight: [weigh(MON - DAY, 60), weigh(WED, 59)], coachProfile: { goal: 'muscle', age: 16 } })
    expect(weekSummary(S, WED).weightDelta).toBeNull()
  })
})

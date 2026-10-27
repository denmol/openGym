import { describe, expect, it } from 'vitest'
import { analyze } from './trainer.js'
import { proteinIntake, foodAdviceBlocked, bodyKg, MIN_FOOD_DAYS, MIN_DAY_KCAL } from './trainer-food.js'
import { isoOf } from './format.js'

const DAY = 86400000
const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime()
const BENCH = '0025', ROW = '0027'
const set = (w, r) => ({ w, r, done: true })
function workout(daysAgo, entries) {
  const start = NOW - daysAgo * DAY
  return { id: 'w' + daysAgo + entries.length, d: isoOf(new Date(start)), start, end: start + 3600000, entries }
}
// Eight weeks of two sessions, enough for the trainer to be ready.
const training = () => {
  const ws = []
  for (let wk = 7; wk >= 0; wk--) for (const d of [1, 4]) ws.push(workout(wk * 7 + d, [
    { id: BENCH, sets: [set(60, 8), set(60, 8), set(60, 8), set(60, 8)] }, { id: ROW, sets: [set(50, 8), set(50, 8), set(50, 8), set(50, 8)] }]))
  return ws
}

// One food, per 100 g: 100 kcal and 10 g protein, so grams are easy to reason about.
const FOOD = { id: 'own1', n: 'test food', per100: { kcal: 100, carb: 10, sugar: 0, prot: 10, fat: 1, sat: 0, fib: 0, salt: 0 } }
const day = (daysAgo, grams) => ({ d: isoOf(new Date(NOW - daysAgo * DAY)), t: '12:00', kind: 'lunch', items: [{ fid: 'own1', g: grams }] })
// n whole days at `grams` of the food: protein = grams / 10, kcal = grams.
const meals = (n, grams) => Array.from({ length: n }, (_, i) => day(i, grams))
const weigh = (daysAgo, kg) => ({ d: isoOf(new Date(NOW - daysAgo * DAY)), t: NOW - daysAgo * DAY, w: kg, u: 'kg' })

const base = (over = {}) => ({
  unit: 'kg', routines: [], week: {}, sleep: [], myFoods: [FOOD], workouts: training(),
  bodyweight: [weigh(0, 80)],
  coachProfile: { goal: 'muscle', age: 35, equipment: ['barbell'] },
  ...over
})
const codes = a => a.findings.map(f => f.code)
const find = (a, c) => a.findings.find(f => f.code === c)

describe('proteinIntake', () => {
  it('averages protein over the whole days logged and divides by body weight', () => {
    const pi = proteinIntake(base({ meals: meals(7, 1000) }), NOW)   // 1000 g = 1000 kcal, 100 g protein
    expect(pi).toMatchObject({ days: 7, kg: 80 })
    expect(pi.avgG).toBeCloseTo(100)
    expect(pi.gPerKg).toBeCloseTo(1.25)
  })

  it('does not count a day that looks like a partial log', () => {
    const S = base({ meals: [...meals(4, 1000), ...[4, 5, 6].map(i => day(i, 200))] })   // 200 kcal days
    expect(proteinIntake(S, NOW)).toBeNull()                      // only 4 whole days
    expect(MIN_DAY_KCAL).toBe(800)
  })

  it('says nothing from fewer days than it takes', () => {
    expect(proteinIntake(base({ meals: meals(MIN_FOOD_DAYS - 1, 1000) }), NOW)).toBeNull()
    expect(proteinIntake(base({ meals: meals(MIN_FOOD_DAYS, 1000) }), NOW)).not.toBeNull()
  })

  it('needs a recent body weight', () => {
    expect(proteinIntake(base({ meals: meals(7, 1000), bodyweight: [] }), NOW)).toBeNull()
    expect(bodyKg(base({ bodyweight: [weigh(90, 80)] }), NOW)).toBeNull()
  })

  it('ignores days outside the window', () => {
    expect(proteinIntake(base({ meals: meals(7, 1000).map((m, i) => ({ ...m, d: isoOf(new Date(NOW - (30 + i) * DAY)) })) }), NOW)).toBeNull()
  })
})

describe('protein_low', () => {
  it('fires when logged protein is under the level where gains levelled off', () => {
    const a = analyze(base({ meals: meals(7, 1000) }), NOW)            // 1.25 g/kg
    const f = find(a, 'protein_low')
    expect(f).toMatchObject({ kind: 'watch', basis: 'evidence', evidence: ['protein'] })
    expect(f.facts).toMatchObject({ gPerKg: 1.25, avgG: 100, days: 7, target: 1.6, goal: 'muscle' })
  })

  it('stays quiet at or above it', () => {
    expect(codes(analyze(base({ meals: meals(7, 1400) }), NOW))).not.toContain('protein_low')   // 1.75 g/kg
  })

  it('is a rule of thumb, with a second source, for a fat-loss goal', () => {
    const S = base({ meals: meals(7, 1000), coachProfile: { goal: 'fatloss', age: 35, equipment: ['barbell'] } })
    const f = find(analyze(S, NOW), 'protein_low')
    expect(f).toMatchObject({ basis: 'heuristic', evidence: ['protein', 'proteinCut'] })
  })

  it('is not raised for a health goal', () => {
    const S = base({ meals: meals(7, 1000), coachProfile: { goal: 'health', age: 35, equipment: ['barbell'] } })
    expect(codes(analyze(S, NOW))).not.toContain('protein_low')
  })

  it('is not raised without a goal-relevant log: too few days', () => {
    expect(codes(analyze(base({ meals: meals(3, 1000) }), NOW))).not.toContain('protein_low')
  })
})

describe('when food advice must not be given', () => {
  const low = over => analyze(base({ meals: meals(7, 1000), ...over }), NOW)

  it('a minor, or an age that was never given', () => {
    expect(codes(low({ coachProfile: { goal: 'muscle', age: 16, equipment: ['barbell'] } }))).not.toContain('protein_low')
    expect(codes(low({ coachProfile: { goal: 'muscle', age: null, equipment: ['barbell'] } }))).not.toContain('protein_low')
  })

  it('any nutrition-safety flag, whatever it is', () => {
    for (const key of ['kidneyOrProteinRestriction', 'eatingDisorder', 'pregnancyOrBreastfeeding', 'malnutritionRisk']) {
      expect(foodAdviceBlocked(base({ nutritionGoals: { safety: { [key]: true } } })), key).toBe(true)
      expect(codes(low({ nutritionGoals: { safety: { [key]: true } } })), key).not.toContain('protein_low')
    }
  })

  it('a flag answered "no" does not block', () => {
    expect(foodAdviceBlocked(base({ nutritionGoals: { safety: { eatingDisorder: false } } }))).toBe(false)
  })

  it('a medical condition on the profile keeps it quiet', () => {
    expect(codes(low({ nutritionGoals: { condition: true, safety: {} } }))).not.toContain('protein_low')
  })
})

describe('weight_down_muscle', () => {
  // Six weigh-ins over five weeks, falling about 0.6 % a week from 80 kg.
  const falling = [35, 28, 21, 14, 7, 0].map((d, i) => weigh(d, 80 - i * 0.5))
  const rising = [35, 28, 21, 14, 7, 0].map((d, i) => weigh(d, 78 + i * 0.3))

  it('fires when the goal is muscle and weight is falling', () => {
    const f = find(analyze(base({ bodyweight: falling }), NOW), 'weight_down_muscle')
    expect(f).toMatchObject({ kind: 'watch', basis: 'practice', evidence: ['offseason'] })
    expect(f.facts).toMatchObject({ weighIns: 6, aimLowPct: 0.25, aimHighPct: 0.5 })
    expect(f.facts.pct).toBeGreaterThan(0.25)
  })

  it('is quiet when weight is rising or steady', () => {
    expect(codes(analyze(base({ bodyweight: rising }), NOW))).not.toContain('weight_down_muscle')
  })

  it('belongs to the muscle goal only: a fat-loss goal wants it to fall', () => {
    const S = base({ bodyweight: falling, coachProfile: { goal: 'fatloss', age: 35, equipment: ['barbell'] } })
    expect(codes(analyze(S, NOW))).not.toContain('weight_down_muscle')
  })

  it('is held back by the same flags as protein', () => {
    expect(codes(analyze(base({ bodyweight: falling, nutritionGoals: { safety: { eatingDisorder: true } } }), NOW))).not.toContain('weight_down_muscle')
  })

  it('needs enough weigh-ins over enough time', () => {
    expect(codes(analyze(base({ bodyweight: falling.slice(-2) }), NOW))).not.toContain('weight_down_muscle')
  })
})

import { describe, expect, it } from 'vitest'
import {
  mealPlanTargets, candidateMeals, dayLoss, generateMealPlan, resolveDay, summarize, shoppingList,
  logPlannedMeal, reshuffleDay, SCALES, PLAN_DAYS, CLOSE_PCT
} from './mealplan.js'
import { NUTRITION_SAFETY_KEYS } from './nutrition-goals.js'
import { foodMap } from './foods.js'
import { totalsOf, scaleItems } from './nutrition.js'

const TODAY = '2026-10-25'
const START = '2026-10-26'

const food = (id, n, k, c, p, f, fib, sat, salt) => ({ id, n, own: true, per100: { kcal: k, carb: c, prot: p, fat: f, fib, sat, salt, sugar: 0 } })
const FOODS = [
  food('oats', 'Havregryn', 370, 60, 13, 7, 10, 1.2, 0),
  food('milk', 'Mjölk', 46, 4.8, 3.4, 1.5, 0, 1, 0.1),
  food('egg', 'Ägg', 143, 0.7, 12.6, 9.5, 0, 3.1, 0.35),
  food('bread', 'Bröd', 250, 45, 9, 3, 6, 0.6, 1.1),
  food('yog', 'Yoghurt', 60, 4, 10, 0.2, 0, 0.1, 0.1),
  food('nuts', 'Nötter', 600, 15, 20, 52, 8, 5, 0),
  food('chicken', 'Kyckling', 165, 0, 31, 3.6, 0, 1, 0.2),
  food('rice', 'Ris', 130, 28, 2.7, 0.3, 0.4, 0.1, 0),
  food('salmon', 'Lax', 208, 0, 20, 13, 0, 3, 0.1),
  food('potato', 'Potatis', 77, 17, 2, 0.1, 2.2, 0, 0),
  food('broc', 'Broccoli', 34, 7, 2.8, 0.4, 2.6, 0.1, 0),
  food('pasta', 'Pasta', 150, 30, 5, 1, 2, 0.2, 0),
  food('beef', 'Nötfärs', 220, 0, 20, 15, 0, 6, 0.2)
]
const meal = (id, n, kind, ...items) => ({ id, n, kind, items: items.map(([fid, g]) => ({ fid, g })) })
const MEALS = [
  meal('b1', 'Havregrynsgröt', 'breakfast', ['oats', 60], ['milk', 250]),
  meal('b2', 'Ägg och bröd', 'breakfast', ['egg', 120], ['bread', 80]),
  meal('b3', 'Yoghurt och nötter', 'breakfast', ['yog', 250], ['nuts', 20]),
  meal('l1', 'Kyckling och ris', 'lunch', ['chicken', 150], ['rice', 250], ['broc', 100]),
  meal('l2', 'Pasta med färs', 'lunch', ['pasta', 250], ['beef', 120], ['broc', 80]),
  meal('d1', 'Lax och potatis', 'dinner', ['salmon', 150], ['potato', 300], ['broc', 100]),
  meal('d2', 'Kyckling och potatis', 'dinner', ['chicken', 150], ['potato', 300], ['broc', 100]),
  meal('s1', 'Nötter', 'snack', ['nuts', 30]),
  meal('s2', 'Yoghurt', 'snack', ['yog', 200])
]
const SAFE = Object.fromEntries(NUTRITION_SAFETY_KEYS.map(k => [k, false]))
const goals = (over = {}) => ({
  goal: 'maintain', condition: false, medication: false, incretinUse: 'none', weightPhase: null,
  safety: SAFE, safetyReviewedAt: '2026-10-01', targetReviewRequired: false,
  targets: { kcal: 2200, prot: 100, carb: 250, fat: 70, fib: 30, sat: 22, salt: 5.75 }, ...over
})
const state = (over = {}) => ({
  coachProfile: { age: 40, sex: 'male', heightCm: 180 },
  bodyweight: [{ d: '2026-10-20', w: 80, u: 'kg' }],
  myFoods: FOODS, myMeals: MEALS, meals: [], nutritionGoals: goals(), health: null,
  ...over
})
const gen = (S, o = {}) => generateMealPlan(S, { start: START, today: TODAY, ...o })

describe('who gets a schedule', () => {
  it('uses the person’s own targets when the safety review is current', () => {
    const g = mealPlanTargets(state(), TODAY)
    expect(g.ok).toBe(true)
    expect(g.targets).toMatchObject({ kcal: 2200, prot: 100, carb: 250 })
  })

  it('makes none without a goal or without targets', () => {
    expect(mealPlanTargets(state({ nutritionGoals: null }), TODAY).ok).toBe(false)
  })

  it.each([
    ['a medical condition', { condition: true }],
    ['medication', { medication: true }],
    ['a weight-loss drug', { incretinUse: 'weight' }],
    ['an active weight-loss phase', { weightPhase: 'active_loss' }],
    ['a flagged safety answer', { safety: { ...SAFE, eatingDisorder: true } }],
    ['an unanswered safety answer', { safety: { ...SAFE, severeGI: null } }],
    ['an expired review', { safetyReviewedAt: '2026-01-01' }],
    ['a review waiting for confirmation', { targetReviewRequired: true }]
  ])('makes none for %s', (_, over) => {
    const g = mealPlanTargets(state({ nutritionGoals: goals(over) }), TODAY)
    expect(g).toMatchObject({ ok: false, reason: 'review', fix: 'clinician' })
    expect(generateMealPlan(state({ nutritionGoals: goals(over) }), { start: START, today: TODAY }).ok).toBe(false)
  })

  it('makes none in diabetes mode', () => {
    expect(mealPlanTargets(state({ health: { on: true } }), TODAY).reason).toBe('review')
  })

  it('makes none for a minor or an unknown age', () => {
    expect(mealPlanTargets(state({ coachProfile: { age: 16, sex: 'male', heightCm: 175 } }), TODAY).ok).toBe(false)
    expect(mealPlanTargets(state({ coachProfile: {} }), TODAY).ok).toBe(false)
  })
})

describe('which saved meals can be used', () => {
  it('leaves out a meal with a food that has no value for energy, protein, carbohydrate or fat', () => {
    const S = state({
      myFoods: [...FOODS, { id: 'mystery', n: 'Okänt', own: true, per100: { kcal: 100, prot: 5 } }],
      myMeals: [...MEALS, meal('x1', 'Halvkänd', 'lunch', ['mystery', 100]), meal('x2', 'Okänd mat', 'lunch', ['nope', 100]), meal('x3', 'Tom', 'lunch')]
    })
    const c = candidateMeals(S)
    expect(c.excluded.map(e => e.id).sort()).toEqual(['x1', 'x2', 'x3'])
    expect(c.usable).toHaveLength(MEALS.length)
  })

  it('lets lunch and dinner share a pool', () => {
    const c = candidateMeals(state())
    expect(c.pool.lunch.map(m => m.id).sort()).toEqual(['d1', 'd2', 'l1', 'l2'])
    expect(c.pool.dinner).toEqual(c.pool.lunch)
    expect(c.pool.breakfast).toHaveLength(3)
    expect(c.pool.snack).toHaveLength(2)
  })
})

describe('what it needs', () => {
  it('says so when there are no saved meals, or none for the main meals', () => {
    expect(gen(state({ myMeals: [] }))).toMatchObject({ ok: false, reason: 'no_meals', fix: 'meals' })
    expect(gen(state({ myMeals: MEALS.filter(m => m.kind === 'breakfast') }))).toMatchObject({ ok: false, reason: 'no_main_meals' })
  })
})

describe('the week', () => {
  const r = gen(state())

  it('covers seven consecutive days with every slot filled', () => {
    expect(r.ok).toBe(true)
    expect(r.plan.days).toHaveLength(PLAN_DAYS)
    expect(r.plan.days.map(d => d.d)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    r.plan.days.forEach(d => expect(d.slots.map(s => s.kind)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']))
  })

  it('only uses portions from the allowed list, and meals that exist', () => {
    const ids = new Set(MEALS.map(m => m.id))
    r.plan.days.forEach(d => d.slots.forEach(s => { expect(SCALES).toContain(s.scale); expect(ids.has(s.id)).toBe(true) }))
  })

  it('lands most days near the energy target, using numbers it can show', () => {
    expect(r.summary.closeDays).toBeGreaterThanOrEqual(6)
    expect(r.summary.avgKcalDeviation).toBeLessThan(CLOSE_PCT)
    // the summary is recomputable from the stored plan and the current meals
    expect(summarize(state(), r.plan, r.targets)).toEqual(r.summary)
    r.plan.days.forEach(d => {
      const day = resolveDay(state(), d)
      expect(day.complete).toBe(true)
      expect(Math.abs(day.totals.kcal - 2200) / 2200).toBeLessThan(0.15)
    })
  })

  it('keeps protein at or above the floor on most days', () => {
    expect(r.summary.proteinDays).toBeGreaterThanOrEqual(5)
  })

  it('does not serve the same meal in the same slot two days running when there is a choice', () => {
    for (let i = 1; i < r.plan.days.length; i++) {
      for (const k of ['breakfast', 'lunch', 'dinner']) {
        const a = r.plan.days[i - 1].slots.find(s => s.kind === k).id
        const b = r.plan.days[i].slots.find(s => s.kind === k).id
        expect(b, `${k} on day ${i}`).not.toBe(a)
      }
    }
    expect(r.summary.distinctMeals).toBeGreaterThanOrEqual(6)
  })

  it('does not serve the same breakfast within three days, and uses all of them', () => {
    const b = r.plan.days.map(d => d.slots.find(s => s.kind === 'breakfast').id)
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j <= i + 2 && j < b.length; j++) expect(b[j], `day ${i} vs ${j}`).not.toBe(b[i])
    expect(new Set(b).size).toBe(3)
  })

  it('does not repeat a whole day in the week', () => {
    const keys = r.plan.days.map(d => d.slots.map(s => s.id).join(','))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('does not put the same meal twice in one day', () => {
    r.plan.days.forEach(d => { const ids = d.slots.map(s => s.id); expect(new Set(ids).size).toBe(ids.length) })
  })

  it('is the same week for the same seed and a different week for another', () => {
    expect(gen(state())).toEqual(r)
    expect(gen(state(), { seed: 7 }).plan.days).not.toEqual(r.plan.days)
    expect(gen(state(), { seed: 7 }).summary.closeDays).toBeGreaterThanOrEqual(5)
  })
})

describe('caveats', () => {
  it('flags a thin selection and missing slots rather than hiding them', () => {
    const r = gen(state({ myMeals: MEALS.filter(m => ['l1', 'd1'].includes(m.id)) }))
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual(expect.arrayContaining(['no_breakfast', 'no_snack', 'few_meals']))
    expect(r.plan.days[0].slots.map(s => s.kind)).toEqual(['lunch', 'dinner'])
  })

  it('reports what it left out', () => {
    const r = gen(state({ myMeals: [...MEALS, meal('x', 'Okänd', 'lunch', ['nope', 100])] }))
    expect(r.excluded.map(e => e.id)).toEqual(['x'])
    expect(r.warnings).toContain('excluded')
  })

  it('says when the fit is poor instead of claiming one', () => {
    const tiny = [meal('b1', 'Te', 'breakfast', ['milk', 50]), meal('l1', 'Sallad', 'lunch', ['broc', 100])]
    const r = gen(state({ myMeals: tiny }))
    expect(r.ok).toBe(true)
    expect(r.warnings).toContain('poor_fit')
    expect(r.summary.closeDays).toBe(0)
  })
})

describe('dayLoss', () => {
  const T = { kcal: 2000, prot: 100, carb: 250, fat: 70, fib: 30, sat: 20, salt: 5 }
  const on = { kcal: 2000, prot: 100, carb: 250, fat: 70, fib: 30, sat: 20, salt: 5 }
  it('is zero on target', () => expect(dayLoss(on, T)).toBeCloseTo(0, 9))
  it('treats energy as a target in both directions', () => {
    expect(dayLoss({ ...on, kcal: 1800 }, T)).toBeCloseTo(dayLoss({ ...on, kcal: 2200 }, T), 9)
    expect(dayLoss({ ...on, kcal: 1800 }, T)).toBeGreaterThan(0)
  })
  it('only penalises protein and fibre for falling short', () => {
    expect(dayLoss({ ...on, prot: 140, fib: 45 }, T)).toBeCloseTo(0, 9)
    expect(dayLoss({ ...on, prot: 60 }, T)).toBeGreaterThan(0)
    expect(dayLoss({ ...on, fib: 10 }, T)).toBeGreaterThan(0)
  })
  it('only penalises saturated fat and salt for going over', () => {
    expect(dayLoss({ ...on, sat: 5, salt: 1 }, T)).toBeCloseTo(0, 9)
    expect(dayLoss({ ...on, sat: 30 }, T)).toBeGreaterThan(0)
    expect(dayLoss({ ...on, salt: 9 }, T)).toBeGreaterThan(0)
  })
  it('skips a nutrient that has no target', () => {
    expect(dayLoss({ ...on, carb: 999, fat: 999 }, { ...T, carb: null, fat: null })).toBeCloseTo(0, 9)
  })
})

describe('using the plan', () => {
  const r = gen(state())
  const draft = () => ({ ...state(), mealPlan: JSON.parse(JSON.stringify(r.plan)) })

  it('logs the grams actually planned, on the planned day, once', () => {
    const s = draft()
    expect(logPlannedMeal(s, 1, 0, new Date(2026, 9, 25, 9, 5))).toBe(true)
    const slot = s.mealPlan.days[1].slots[0]
    const m = MEALS.find(x => x.id === slot.id)
    expect(s.meals).toHaveLength(1)
    expect(s.meals[0]).toMatchObject({ d: '2026-10-27', kind: 'breakfast', t: '08:00' })
    expect(s.meals[0].items).toEqual(scaleItems(m.items, slot.scale).map(i => ({ ...i })))
    expect(slot.logged).toBe(true)
    expect(logPlannedMeal(s, 1, 0)).toBe(false)               // a double tap
    expect(s.meals).toHaveLength(1)
  })

  it('uses the clock for a meal planned for today', () => {
    const s = draft()
    s.mealPlan.days[0].d = '2026-10-25'
    logPlannedMeal(s, 0, 1, new Date(2026, 9, 25, 12, 40))
    expect(s.meals[0].t).toBe('12:40')
  })

  it('does not log a meal that has been deleted since', () => {
    const s = draft()
    const id = s.mealPlan.days[0].slots[0].id
    s.myMeals = s.myMeals.filter(m => m.id !== id)
    expect(logPlannedMeal(s, 0, 0)).toBe(false)
    expect(s.meals).toHaveLength(0)
    expect(resolveDay(s, s.mealPlan.days[0]).slots[0]).toMatchObject({ missing: true })
    expect(resolveDay(s, s.mealPlan.days[0]).complete).toBe(false)
  })

  it('follows an edit to a saved meal, because the plan stores references', () => {
    const before = resolveDay(state(), r.plan.days[0]).totals.kcal
    const id = r.plan.days[0].slots[0].id
    const S2 = state({ myMeals: MEALS.map(m => (m.id === id ? { ...m, items: [...m.items, { fid: 'nuts', g: 100 }] } : m)) })
    expect(resolveDay(S2, r.plan.days[0]).totals.kcal).toBeGreaterThan(before + 100)
  })

  it('re-plans one day and leaves the others alone', () => {
    const next = reshuffleDay(state(), r.plan, 3, 99)
    expect(next.ok).toBe(true)
    expect(next.plan.days[3].d).toBe(r.plan.days[3].d)
    next.plan.days.forEach((d, i) => { if (i !== 3) expect(d).toEqual(r.plan.days[i]) })
  })

  it('sums the shopping list across the week, in grams', () => {
    const list = shoppingList(state(), r.plan)
    const foods = foodMap(state())
    const want = {}
    r.plan.days.forEach(d => d.slots.forEach(s => scaleItems(MEALS.find(m => m.id === s.id).items, s.scale).forEach(i => { want[i.fid] = (want[i.fid] || 0) + i.g })))
    expect(Object.fromEntries(list.map(x => [x.fid, x.g]))).toEqual(want)
    list.forEach(x => expect(x.name).toBe(foods[x.fid].n))
    // and the grams it lists carry the week's energy, to within rounding
    const kcal = totalsOf(list.map(x => ({ fid: x.fid, g: x.g })), foods).kcal
    const weekKcal = r.plan.days.reduce((a, d) => a + resolveDay(state(), d).totals.kcal, 0)
    expect(Math.abs(kcal - weekKcal)).toBeLessThan(5)
  })
})

describe('Swedish', () => {
  it('has a translation for every string on the meal plan screens', async () => {
    const fs = await import('node:fs')
    const sv = (await import('../locales/sv.js')).default
    const src = fs.readFileSync(new URL('../mealplan-sheets.jsx', import.meta.url), 'utf8')
    const lit = '((?:[^\'\\\\]|\\\\.)*)'
    const found = [
      ...[...src.matchAll(new RegExp("\\bt\\(\\s*'" + lit + "'", 'g'))].map(m => m[1]),
      ...[...src.matchAll(new RegExp("^\\s+[a-z_]+: \\['" + lit + "', '(?:clinician|goals)'\\]", 'gm'))].map(m => m[1]),
      ...[...src.matchAll(new RegExp("^\\s+(?:no_[a-z]+|few_meals|excluded|poor_fit): '" + lit + "'", 'gm'))].map(m => m[1])
    ].map(s => s.replace(/\\'/g, "'"))
    expect(found.length).toBeGreaterThan(45)
    const missing = [...new Set(found)].filter(s => !(s in sv))
    expect(missing).toEqual([])
  })
})

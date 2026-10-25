import { describe, expect, it } from 'vitest'
import { analyze, applyTrainerAction, revertTrainerAction, isWorkingSet, muscleVolume, MIN_WORKOUTS } from './trainer.js'
import { isoOf } from './format.js'

const DAY = 86400000
const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime()

// ids from the exercise library
const BENCH = '0025', ROW = '0027', SQUAT = '0043', EXT = '0585', CURL = '0031', CALF = '0605'

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const entry = (id, sets) => ({ id, sets })
function workout(daysAgo, entries) {
  const start = NOW - daysAgo * DAY
  return { id: 'w' + daysAgo + entries.length, d: isoOf(new Date(start)), start, end: start + 3600000, entries }
}
const state = (over = {}) => ({
  unit: 'kg', workouts: [], routines: [], week: {}, bodyweight: [], sleep: [],
  coachProfile: { goal: 'muscle', age: 30, equipment: ['barbell'] }, ...over
})
const codes = a => a.findings.map(f => f.code)
const find = (a, code, pick) => a.findings.find(f => f.code === code && (!pick || pick(f)))

// Upper-body only: two sessions a week for four weeks, 4 sets of each lift.
function upperOnly(extra = {}) {
  const ws = []
  for (let wk = 0; wk < 4; wk++) {
    for (const d of [1, 4]) {
      ws.push(workout(wk * 7 + d, [
        entry(BENCH, [set(60, 8), set(60, 8), set(60, 8), set(60, 8)]),
        entry(ROW, [set(50, 8), set(50, 8), set(50, 8), set(50, 8)])
      ]))
    }
  }
  return state({ workouts: ws, ...extra })
}

describe('isWorkingSet', () => {
  it('counts finished sets with reps or a hold, and nothing else', () => {
    expect(isWorkingSet(set(60, 8))).toBe(true)
    expect(isWorkingSet({ sec: 45, w: 0, done: true })).toBe(true)
    expect(isWorkingSet({ w: 60, r: 8, done: false })).toBe(false)
    expect(isWorkingSet(set(20, 10, { warm: true }))).toBe(false)
    expect(isWorkingSet({ min: 20, done: true })).toBe(false)
  })
})

describe('muscleVolume', () => {
  it('leaves warm-up sets out of the count', () => {
    const w = workout(1, [entry(BENCH, [set(20, 10, { warm: true }), set(60, 8), set(60, 8)])])
    expect(muscleVolume([w]).sets.chest).toBe(2)
  })
  it('counts a supporting muscle at a fraction of a set', () => {
    const w = workout(1, [entry(BENCH, [set(60, 8), set(60, 8), set(60, 8), set(60, 8)])])
    const v = muscleVolume([w])
    expect(v.sets.chest).toBe(4)
    expect(v.sets.triceps).toBeGreaterThan(0)
    expect(v.sets.triceps).toBeLessThan(v.sets.chest)
  })
})

describe('analyze: too little data', () => {
  it('says so instead of judging', () => {
    const a = analyze(state({ workouts: [workout(1, [entry(BENCH, [set(60, 8)])]), workout(3, [entry(BENCH, [set(60, 8)])])] }), NOW)
    expect(a.ready).toBe(false)
    expect(codes(a)).toEqual(['data_thin'])
    expect(a.findings[0].facts).toMatchObject({ workouts: 2, needed: MIN_WORKOUTS })
  })
  it('reads an empty log without throwing', () => {
    expect(analyze(state(), NOW).ready).toBe(false)
  })
})

describe('analyze: volume', () => {
  it('flags a muscle that was never trained, and low volume for the muscle goal', () => {
    const a = analyze(upperOnly(), NOW)
    expect(a.ready).toBe(true)
    const none = find(a, 'volume_none', f => f.facts.muscle === 'Quads')
    expect(none).toBeTruthy()
    expect(none.kind).toBe('act')
    const chest = find(a, 'volume_low', f => f.facts.muscle === 'Chest')
    // 32 sets over the 25 days since the first session (3.6 weeks), not over a flat four
    expect(chest.facts).toMatchObject({ sets: 9, floor: 10, ceiling: 20 })
    expect(chest.basis).toBe('evidence')
    expect(chest.evidence).toContain('volume')
  })

  it('does not flag a muscle that is inside the range', () => {
    const s = upperOnly()
    s.workouts.forEach(w => w.entries[0].sets.push(set(60, 8)))   // 5 sets x 8 sessions over 3.6 wk = 11/wk
    const a = analyze(s, NOW)
    expect(find(a, 'volume_low', f => f.facts.muscle === 'Chest')).toBeUndefined()
  })

  it('uses a lower, labelled-as-heuristic floor for non-muscle goals', () => {
    const a = analyze(upperOnly({ coachProfile: { goal: 'health', age: 40 } }), NOW)
    expect(find(a, 'volume_low', f => f.facts.muscle === 'Chest')).toBeUndefined()   // 9 >= 5
    const quads = find(a, 'volume_none', f => f.facts.muscle === 'Quads')
    expect(quads.basis).toBe('heuristic')
    expect(quads.facts.floor).toBe(5)
  })

  it('divides by the days of history a newcomer actually has', () => {
    const ws = [0, 2, 4, 6].map(d => workout(d + 1, [entry(BENCH, [set(60, 8), set(60, 8), set(60, 8), set(60, 8), set(60, 8)])]))
    const a = analyze(state({ workouts: ws }), NOW)
    expect(a.weeks).toBeLessThan(1.5)
    expect(a.muscles.find(m => m.slug === 'chest').weekly).toBeGreaterThan(10)   // 20 sets over ~1.1 weeks
  })

  it('flags volume above the ceiling', () => {
    const s = upperOnly()
    s.workouts.forEach(w => { for (let i = 0; i < 6; i++) w.entries[0].sets.push(set(60, 8)) })   // 10 x 2 = 20... plus
    s.workouts.forEach(w => { for (let i = 0; i < 4; i++) w.entries[0].sets.push(set(60, 8)) })   // 14 x 2 = 28/wk
    expect(find(analyze(s, NOW), 'volume_high', f => f.facts.muscle === 'Chest')).toBeTruthy()
  })
})

describe('analyze: frequency', () => {
  const once = () => {
    const ws = []
    for (let wk = 0; wk < 4; wk++) ws.push(
      workout(wk * 7 + 2, [entry(BENCH, Array.from({ length: 10 }, () => set(60, 8)))]),
      workout(wk * 7 + 3, [entry(ROW, Array.from({ length: 10 }, () => set(50, 8)))]))
    return ws
  }
  it('notes muscles with enough sets but trained once a week (muscle goal only)', () => {
    const f = find(analyze(state({ workouts: once() }), NOW), 'frequency_low')
    expect(f).toBeTruthy()
    expect(f.evidence).toEqual(['frequency'])
    expect(f.facts.muscles).toContain('Chest')
    expect(f.facts.muscles).toContain('Upper back')
    expect(f.facts).toMatchObject({ target: 2 })
    expect(find(analyze(state({ workouts: once(), coachProfile: { goal: 'health' } }), NOW), 'frequency_low')).toBeUndefined()
  })
  it('says it once for all the muscles, not once per muscle', () => {
    expect(analyze(state({ workouts: once() }), NOW).findings.filter(f => f.code === 'frequency_low')).toHaveLength(1)
  })
})

describe('analyze: abs', () => {
  it('is judged by the same range but labelled as the app’s own, cites nothing and is never urgent', () => {
    const f = find(analyze(upperOnly(), NOW), 'volume_none', x => x.facts.muscle === 'Abs')
    expect(f).toBeTruthy()
    expect(f.kind).toBe('watch')
    expect(f.basis).toBe('heuristic')
    expect(f.evidence).toEqual([])
    // a limb muscle with the same gap is urgent and cites the study
    expect(find(analyze(upperOnly(), NOW), 'volume_none', x => x.facts.muscle === 'Quads').kind).toBe('act')
  })
})

describe('analyze: order', () => {
  it('puts the muscle furthest below its floor first within a kind', () => {
    const vols = analyze(upperOnly(), NOW).findings.filter(f => f.code.startsWith('volume_') && f.kind === 'act')
    const gaps = vols.map(f => f.facts.sets / f.facts.floor)
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b))
  })
})

describe('analyze: the plan change', () => {
  const plan = () => upperOnly({
    routines: [{ id: 'r1', name: 'Upper', ex: [{ id: BENCH, sets: 4, reps: 8 }, { id: ROW, sets: 4, reps: 8 }] }],
    week: { 1: 'r1', 4: 'r1' }
  })

  it('proposes adding sets to the exercise that already trains the muscle', () => {
    const f = find(analyze(plan(), NOW), 'volume_low', x => x.facts.muscle === 'Chest')
    expect(f.action).toMatchObject({ type: 'add_sets', routineId: 'r1', exId: BENCH, from: 4, to: 5 })
  })

  it('applies it once, and refuses when the plan has changed underneath it', () => {
    const s = plan()
    const act = find(analyze(s, NOW), 'volume_low', x => x.facts.muscle === 'Chest').action
    expect(applyTrainerAction(s, act)).toBe(true)
    expect(s.routines[0].ex[0].sets).toBe(5)
    expect(applyTrainerAction(s, act)).toBe(false)         // from=4 no longer matches
    expect(s.routines[0].ex[0].sets).toBe(5)
  })

  it('reverts only what it wrote', () => {
    const s = plan()
    const act = find(analyze(s, NOW), 'volume_low', x => x.facts.muscle === 'Chest').action
    applyTrainerAction(s, act)
    expect(revertTrainerAction(s, act)).toBe(true)
    expect(s.routines[0].ex[0].sets).toBe(4)
    applyTrainerAction(s, act)
    s.routines[0].ex[0].sets = 7                            // edited by hand since
    expect(revertTrainerAction(s, act)).toBe(false)
    expect(s.routines[0].ex[0].sets).toBe(7)
  })

  it('never offers more than six sets on one exercise', () => {
    const s = plan()
    s.routines[0].ex[0].sets = 6
    expect(find(analyze(s, NOW), 'volume_low', x => x.facts.muscle === 'Chest').action).toBeUndefined()
    expect(applyTrainerAction(s, { type: 'add_sets', routineId: 'r1', exId: BENCH, from: 6, to: 7 })).toBe(false)
  })

  it('offers nothing when no routine trains the muscle', () => {
    const f = find(analyze(plan(), NOW), 'volume_none', x => x.facts.muscle === 'Quads')
    expect(f.action).toBeUndefined()
  })
})

// A lift that moves by `perWeek` kg every week, one session a week for eight weeks.
function trending(id, start, perWeek, reps = 5) {
  return Array.from({ length: 8 }, (_, i) => workout((7 - i) * 7 + 1, [entry(id, [set(start + perWeek * i, reps), set(start + perWeek * i, reps)])]))
}

describe('analyze: strength trends', () => {
  const base = [].concat(...[0, 1, 2, 3, 4, 5, 6, 7].map(i => workout(i * 7 + 3, [entry(SQUAT, [set(80, 8)]), entry(EXT, [set(40, 12)])])))

  it('reports a rising lift', () => {
    const a = analyze(state({ workouts: [...trending(BENCH, 60, 2.5), ...base] }), NOW)
    const f = find(a, 'progressing', x => x.facts.exercise.includes('bench'))
    expect(f).toBeTruthy()
    expect(f.facts.pct).toBeGreaterThan(2)
    expect(f.kind).toBe('good')
  })

  it('flags a flat lift and points at the muscle volume it sits on', () => {
    const a = analyze(state({ workouts: [...trending(BENCH, 60, 0), ...base] }), NOW)
    const f = find(a, 'stalled', x => x.facts.exercise.includes('bench'))
    expect(f).toBeTruthy()
    expect(f.facts).toMatchObject({ muscle: 'Chest', floor: 10 })
    expect(f.evidence).toEqual(['deload'])
  })

  it('does not call a lift stalled on two data points', () => {
    const ws = [workout(20, [entry(BENCH, [set(60, 5)])]), workout(3, [entry(BENCH, [set(60, 5)])]), ...base]
    expect(find(analyze(state({ workouts: ws }), NOW), 'stalled', x => x.facts.exercise.includes('bench'))).toBeUndefined()
  })

  it('treats several falling lifts plus a rise in effort as fatigue, and a single one as just a drop', () => {
    const fall = id => trending(id, 80, -3)
    const ws = [...fall(BENCH), ...fall(ROW)]
    // effort: easy before, hard in the last two weeks
    ws.forEach(w => {
      const recent = (NOW - w.start) / DAY <= 14
      w.entries[0].sets.forEach(s => { s.rir = recent ? 0 : 2 })
    })
    const a = analyze(state({ workouts: [...ws, ...base.slice(0, 6)] }), NOW)
    const f = find(a, 'fatigue')
    expect(f).toBeTruthy()
    expect(f.kind).toBe('act')
    expect(f.facts).toMatchObject({ lifts: 2, deloadDays: 7, deloadSetsPct: 50, deloadRir: 3 })
    expect(f.evidence).toEqual(['deload', 'rir'])

    const one = analyze(state({ workouts: [...fall(BENCH), ...base] }), NOW)
    expect(find(one, 'fatigue')).toBeUndefined()
    expect(find(one, 'falling')).toBeTruthy()
  })

  it('does not call fatigue without a second sign', () => {
    const ws = [...trending(BENCH, 80, -3), ...trending(ROW, 80, -3)]
    expect(find(analyze(state({ workouts: ws }), NOW), 'fatigue')).toBeUndefined()
  })

  it('uses short sleep as the second sign', () => {
    const ws = [...trending(BENCH, 80, -3), ...trending(ROW, 80, -3)]
    const sleep = Array.from({ length: 10 }, (_, i) => ({ d: isoOf(new Date(NOW - i * DAY)), min: 5.5 * 60 }))
    const f = find(analyze(state({ workouts: ws, sleep }), NOW), 'fatigue')
    expect(f.facts.sleepHours).toBe(5.5)
  })
})

describe('analyze: blocks, adherence and effort', () => {
  const weekly = n => Array.from({ length: n }, (_, i) => [i * 7 + 1, i * 7 + 4].map(d =>
    workout(d, [entry(BENCH, [set(60, 8), set(60, 8), set(60, 8)]), entry(SQUAT, [set(80, 8), set(80, 8), set(80, 8)])]))).flat()

  it('notes six steady weeks with no lighter week', () => {
    const f = find(analyze(state({ workouts: weekly(8) }), NOW), 'block_long')
    expect(f).toBeTruthy()
    expect(f.facts.weeks).toBeGreaterThanOrEqual(6)
    expect(f.facts.typical).toBe(5.6)
  })
  it('stays quiet when a week was missed', () => {
    const ws = weekly(8).filter(w => { const wk = Math.floor((NOW - w.start) / (7 * DAY)); return wk !== 2 })
    expect(find(analyze(state({ workouts: ws }), NOW), 'block_long')).toBeUndefined()
  })

  it('compares what was planned with what was done', () => {
    const s = state({
      workouts: weekly(4).filter((_, i) => i % 2 === 0),
      routines: [{ id: 'r1', name: 'A', ex: [{ id: BENCH, sets: 3, reps: 8 }] }],
      week: { 1: 'r1', 2: 'r1', 4: 'r1', 5: 'r1' }
    })
    const f = find(analyze(s, NOW), 'adherence')
    expect(f.facts.planned).toBe(4)
    expect(f.facts.done).toBeLessThan(4 * 0.7)
  })

  it('asks for effort ratings when there are none, and flags sets far from failure', () => {
    expect(find(analyze(state({ workouts: weekly(4) }), NOW), 'rate_effort')).toBeTruthy()
    const easy = weekly(4)
    easy.forEach(w => w.entries.forEach(e => e.sets.forEach(s => { s.rir = 5 })))
    const f = find(analyze(state({ workouts: easy }), NOW), 'effort_far')
    expect(f.evidence).toEqual(['rir', 'rirAccuracy'])
    expect(f.facts.rir).toBe(5)
  })
})

describe('analyze: body weight', () => {
  const weigh = (perWeekKg, n = 6) => Array.from({ length: n }, (_, i) => {
    const t = NOW - (n - 1 - i) * 7 * DAY
    return { d: isoOf(new Date(t)), t, u: 'kg', w: 90 + perWeekKg * i }
  })
  const lifts = upperOnly().workouts
  const mk = (bodyweight, extra = {}) => state({ workouts: lifts, bodyweight, coachProfile: { goal: 'fatloss', age: 35 }, ...extra })

  it('warns when weight falls faster than the cited threshold', () => {
    const f = find(analyze(mk(weigh(-1.2)), NOW), 'weight_fast')           // 1.2 kg of 90 = 1.3 %/wk
    expect(f).toBeTruthy()
    expect(f.evidence).toEqual(['weightLoss'])
    expect(f.facts.pct).toBeGreaterThan(1)
  })
  it('calls a steady loss on track', () => {
    expect(find(analyze(mk(weigh(-0.5)), NOW), 'weight_on_track')).toBeTruthy()
  })
  it('notes a flat trend', () => {
    expect(find(analyze(mk(weigh(0)), NOW), 'weight_flat')).toBeTruthy()
  })
  it('says nothing about weight for under-18s, unknown age, or other goals', () => {
    const none = a => ['weight_fast', 'weight_on_track', 'weight_flat'].some(c => find(a, c))
    expect(none(analyze(mk(weigh(-1.2), { coachProfile: { goal: 'fatloss', age: 16 } }), NOW))).toBe(false)
    expect(none(analyze(mk(weigh(-1.2), { coachProfile: { goal: 'fatloss' } }), NOW))).toBe(false)
    expect(none(analyze(mk(weigh(-1.2), { coachProfile: { goal: 'muscle', age: 30 } }), NOW))).toBe(false)
  })
  it('needs three weigh-ins across two weeks', () => {
    expect(find(analyze(mk(weigh(-1.2, 2)), NOW), 'weight_fast')).toBeUndefined()
  })
  it('converts pounds before it measures anything', () => {
    const lb = weigh(-0.5).map(e => ({ ...e, u: 'lb', w: e.w / 0.45359237 }))
    expect(find(analyze(mk(lb), NOW), 'weight_on_track')).toBeTruthy()
  })
})

describe('findings', () => {
  it('put the things to act on first', () => {
    const a = analyze(upperOnly(), NOW)
    const order = a.findings.map(f => f.kind)
    expect(order).toEqual([...order].sort((x, y) => ({ act: 0, watch: 1, info: 2, good: 3 }[x] - { act: 0, watch: 1, info: 2, good: 3 }[y])))
  })
  it('only cite evidence that exists', async () => {
    const { EVIDENCE } = await import('./trainer-evidence.js')
    const a = analyze(upperOnly(), NOW)
    a.findings.forEach(f => f.evidence.forEach(id => expect(EVIDENCE[id]).toBeTruthy()))
  })
})

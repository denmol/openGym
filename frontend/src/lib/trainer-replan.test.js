import { describe, expect, it } from 'vitest'
import { analyze, applyTrainerAction, revertTrainerAction } from './trainer.js'
import { planAgeWeeks, replanDue, replanProposals, alternativeFor, markReplanned, REPLAN_AFTER_WEEKS } from './trainer-replan.js'
import { isoOf } from './format.js'

const DAY = 86400000
const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime()
const BENCH = '0025', ROW = '0027'

const set = (w, r) => ({ w, r, done: true })
const entry = (id, sets) => ({ id, sets })
function workout(daysAgo, entries) {
  const start = NOW - daysAgo * DAY
  return { id: 'w' + daysAgo + entries.length, d: isoOf(new Date(start)), start, end: start + 3600000, entries }
}
const state = (over = {}) => ({
  unit: 'kg', workouts: [], routines: [], week: {}, bodyweight: [], sleep: [],
  coachProfile: { goal: 'muscle', age: 30, equipment: ['barbell', 'dumbbell', 'cable'] }, ...over
})
const routines = () => [{ id: 'r1', name: 'Upper', ex: [
  { id: BENCH, sets: 3, reps: 8, weight: 60, mode: 'reps', prog: 'double', repsMin: 6, repsMax: 8 },
  { id: ROW, sets: 3, reps: 8, weight: 50, mode: 'reps' }
] }]

// Bench stuck at the same load for eight weeks, row climbing.
function stuckBench() {
  const ws = []
  for (let wk = 0; wk < 8; wk++) {
    for (const d of [1, 4]) {
      ws.push(workout(wk * 7 + d, [
        entry(BENCH, [set(60, 8), set(60, 8), set(60, 8)]),
        entry(ROW, [set(40 + (7 - wk) * 2, 8), set(40 + (7 - wk) * 2, 8), set(40 + (7 - wk) * 2, 8)])
      ]))
    }
  }
  ws.sort((a, b) => a.start - b.start)           // the log is chronological
  return state({ workouts: ws, routines: routines(), week: { 1: 'r1', 4: 'r1' } })
}

describe('plan age and when a review is due', () => {
  it('counts from the first workout when nothing else marks the plan', () => {
    const S = stuckBench()
    expect(planAgeWeeks(S, NOW)).toBeGreaterThan(7)
  })

  it('counts from the last review, program change or trainer change, whichever is latest', () => {
    const S = { ...stuckBench(), replanAt: isoOf(new Date(NOW - 10 * DAY)), coachUndo: { at: isoOf(new Date(NOW - 40 * DAY)) } }
    expect(planAgeWeeks(S, NOW)).toBeCloseTo(10 / 7, 0)
    const S2 = { ...S, trainerUndo: { at: isoOf(new Date(NOW - 2 * DAY)) } }
    expect(planAgeWeeks(S2, NOW)).toBeLessThan(1)
  })

  it('is due after the period, and not before it', () => {
    const S = stuckBench(), a = analyze(S, NOW)
    expect(replanDue(S, a, NOW)).toBe(true)
    expect(replanDue({ ...S, replanAt: isoOf(new Date(NOW - 2 * DAY)) }, a, NOW)).toBe(false)
    expect(REPLAN_AFTER_WEEKS).toBe(4)
  })

  it('is never due without enough training to judge from', () => {
    const S = state({ workouts: [workout(40, [entry(BENCH, [set(60, 8)])])], routines: routines() })
    expect(replanDue(S, analyze(S, NOW), NOW)).toBe(false)
  })

  it('markReplanned pushes the next review a full period away', () => {
    const S = stuckBench(); markReplanned(S, NOW)
    expect(planAgeWeeks(S, NOW)).toBeLessThan(0.1)
  })
})

describe('proposals', () => {
  it('proposes swapping a lift that has been flat for weeks, and only that one', () => {
    const S = stuckBench()
    const swaps = replanProposals(S, analyze(S, NOW), NOW).filter(p => p.type === 'swap')
    expect(swaps).toHaveLength(1)
    expect(swaps[0]).toMatchObject({ fromId: BENCH, routineId: 'r1', reason: 'stalled' })
    expect(swaps[0].toId).not.toBe(BENCH)
  })

  it('the replacement keeps the shape of the work and starts the load fresh', () => {
    const S = stuckBench()
    const sw = replanProposals(S, analyze(S, NOW), NOW).find(p => p.type === 'swap')
    expect(sw.next.id).toBe(sw.toId)
    expect(sw.next).toMatchObject({ sets: 3, reps: 8, prog: 'double', repsMin: 6, repsMax: 8, weight: 0 })
    expect(sw.prev.weight).toBe(60)
  })

  it('picks a lift that shares the movement, not just the muscle', () => {
    const alt = alternativeFor(stuckBench(), BENCH)
    expect(alt.n).toMatch(/bench|press/)
    expect(alt.bp).toBe('chest')
  })

  it('never proposes a lift that is already in the program, or one needing equipment not owned', () => {
    const S = { ...stuckBench(), coachProfile: { goal: 'muscle', age: 30, equipment: ['barbell'] } }
    const alt = alternativeFor(S, BENCH)
    expect(alt).toBeTruthy()
    expect(alt.eq).toBe('barbell')
    expect(alt.id).not.toBe(ROW)
  })

  it('proposes nothing for a lift that is still progressing', () => {
    const S = stuckBench()
    S.workouts = S.workouts.map(w => ({ ...w, entries: w.entries.map(e => e.id === BENCH ? entry(BENCH, e.sets.map(s => set(60 + (50 - (NOW - w.start) / DAY) / 7, 8))) : e) }))
    expect(replanProposals(S, analyze(S, NOW), NOW).filter(p => p.type === 'swap')).toHaveLength(0)
  })

  it('does not swap an exercise that is not in a planned routine', () => {
    const S = { ...stuckBench(), week: {} }
    expect(replanProposals(S, analyze(S, NOW), NOW).filter(p => p.type === 'swap')).toHaveLength(0)
  })

  it('a stalled lift is only offered once even if it appears in two routines', () => {
    const S = stuckBench()
    S.routines = [...S.routines, { id: 'r2', name: 'Upper B', ex: [{ id: BENCH, sets: 3, reps: 8, weight: 60, mode: 'reps' }] }]
    S.week = { 1: 'r1', 4: 'r2' }
    expect(replanProposals(S, analyze(S, NOW), NOW).filter(p => p.type === 'swap' && p.fromId === BENCH).length).toBeLessThanOrEqual(1)
  })
})

describe('applying and undoing a swap', () => {
  const swapOf = S => replanProposals(S, analyze(S, NOW), NOW).find(p => p.type === 'swap')

  it('replaces the exercise in place and undo puts the old configuration back exactly', () => {
    const S = stuckBench(), a = swapOf(S)
    const draft = JSON.parse(JSON.stringify(S))
    expect(applyTrainerAction(draft, a)).toBe(true)
    expect(draft.routines[0].ex[0].id).toBe(a.toId)
    expect(draft.routines[0].ex[1].id).toBe(ROW)
    expect(revertTrainerAction(draft, a)).toBe(true)
    expect(draft.routines[0].ex[0]).toEqual(S.routines[0].ex[0])
  })

  it('refuses when the exercise was edited after the proposal', () => {
    const S = stuckBench(), a = swapOf(S)
    const draft = JSON.parse(JSON.stringify(S))
    draft.routines[0].ex[0].sets = 5
    expect(applyTrainerAction(draft, a)).toBe(false)
    expect(draft.routines[0].ex[0].id).toBe(BENCH)
  })

  it('refuses when the replacement is already in that routine', () => {
    const S = stuckBench(), a = swapOf(S)
    const draft = JSON.parse(JSON.stringify(S))
    draft.routines[0].ex.push({ id: a.toId, sets: 3, reps: 8, weight: 0 })
    expect(applyTrainerAction(draft, a)).toBe(false)
  })

  it('does not mutate the proposal itself', () => {
    const S = stuckBench(), a = swapOf(S), copy = JSON.stringify(a)
    applyTrainerAction(JSON.parse(JSON.stringify(S)), a)
    expect(JSON.stringify(a)).toBe(copy)
  })

  it('undo leaves an exercise alone if it is no longer the replacement', () => {
    const S = stuckBench(), a = swapOf(S)
    const draft = JSON.parse(JSON.stringify(S))
    expect(revertTrainerAction(draft, a)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import {
  scoreAgainst, scoreBodyweightTest, e1rmOf, startWeight, calibrate, calibrationFindings, seedWeights, toKg
} from './calibration.js'

const man = { sex: 'male', age: 35, bodyweightKg: 80, unit: 'kg' }

describe('scoring', () => {
  it('is linear between thresholds and capped at 3', () => {
    const t = [10, 25, 40]
    expect([0, 5, 10, 17.5, 25, 32.5, 40, 99].map(v => scoreAgainst(v, t))).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3])
    expect(scoreAgainst(-1, t)).toBeNull()
    expect(scoreAgainst('x', t)).toBeNull()
  })
  it('uses sex-specific push-up bars, half credit from the knees, lower bars over 50', () => {
    expect(scoreBodyweightTest('pushups', 25, { sex: 'male' })).toBe(2)
    expect(scoreBodyweightTest('pushups', 15, { sex: 'female' })).toBe(2)
    expect(scoreBodyweightTest('pushups', 20, { sex: 'male', variant: 'knee' })).toBe(1)
    expect(scoreBodyweightTest('pushups', 7, { sex: 'male', age: 55 })).toBe(1)
  })
  it('caps what is counted, so a typo cannot make someone advanced', () => {
    expect(scoreBodyweightTest('plank', 9999, { sex: 'male' })).toBe(3)
    expect(scoreBodyweightTest('nope', 5)).toBeNull()
  })
})

describe('lifts', () => {
  it('turns eight reps with two in reserve into an estimated max', () => {
    expect(e1rmOf(60)).toBe(80)
  })
  it('starts a little under the tested weight, on a step a gym has', () => {
    expect(startWeight(60, { unit: 'kg', equipment: 'barbell' })).toBe(55)
    expect(startWeight(20, { unit: 'kg', equipment: 'dumbbell' })).toBe(18)
    expect(startWeight(135, { unit: 'lb' })).toBe(120)
    expect(startWeight(0)).toBeNull()
    expect(startWeight(1, { equipment: 'barbell' })).toBe(2.5)
  })
  it('converts pounds before rating', () => {
    expect(toKg(220.46, 'lb')).toBeCloseTo(100, 1)
  })
})

describe('calibrate', () => {
  it('needs both history answers', () => {
    expect(calibrate({ months: 2 }, man)).toBeNull()
  })
  it('a newcomer with weak tests is new, with low confidence from history alone', () => {
    const r = calibrate({ months: 0, recent: 0 }, man)
    expect(r).toMatchObject({ level: 'new', confidence: 'low', strong: null })
  })
  it('years of regular training and solid tests are experienced', () => {
    const r = calibrate({ months: 3, recent: 3, pushups: { reps: 35 }, squats: 60, plank: 120,
      lifts: { squat: { w: 110, equipment: 'barbell' }, bench: { w: 85, equipment: 'barbell' }, row: { w: 75, equipment: 'barbell' } } }, man)
    expect(r.level).toBe('experienced')
    expect(r.confidence).toBe('high')
  })
  it('a year of on-and-off training with middling tests is some', () => {
    const r = calibrate({ months: 2, recent: 2, pushups: { reps: 15 }, squats: 30, plank: 45 }, man)
    expect(r.level).toBe('some')
    expect(r.confidence).toBe('medium')
  })
  it('under six months of training never reads as experienced, and no training at all reads as new', () => {
    const strong = { pushups: { reps: 50 }, squats: 80, plank: 180 }
    expect(calibrate({ months: 1, recent: 3, ...strong }, man).level).toBe('some')
    expect(calibrate({ months: 0, recent: 3, ...strong }, man).level).toBe('new')
  })
  it('rates only barbell lifts but still gives starting weights for the rest', () => {
    const r = calibrate({ months: 2, recent: 2, lifts: { squat: { w: 30, equipment: 'dumbbell' }, bench: { w: 60, equipment: 'barbell' } } }, man)
    expect(r.lifts.squat.score).toBeNull()
    expect(r.lifts.squat.start).toBe(28)
    expect(r.lifts.bench.score).toBeGreaterThan(0)
  })
  it('without a body weight the lifts are not rated', () => {
    const r = calibrate({ months: 2, recent: 2, lifts: { bench: { w: 60, equipment: 'barbell' } } }, { ...man, bodyweightKg: null })
    expect(r.lifts.bench.score).toBeNull()
    expect(r.lifts.bench.start).toBe(55)
  })
  it('names a strong and a weak area only when they really differ', () => {
    const r = calibrate({ months: 2, recent: 2, pushups: { reps: 40 }, squats: 12, plank: 50 }, man)
    expect(r.strong).toBe('push')
    expect(r.weak).toBe('legs')
    expect(calibrate({ months: 2, recent: 2, pushups: { reps: 25 }, squats: 40, plank: 60 }, man).strong).toBeNull()
  })
})

describe('what the trainer gets', () => {
  const cal = calibrate({ months: 2, recent: 2, pushups: { reps: 40 }, squats: 12, plank: 50, lifts: { bench: { w: 60, equipment: 'barbell' } } }, man)
  it('becomes findings with only plain facts', () => {
    const f = calibrationFindings(cal)
    expect(f.map(x => x.code)).toEqual(['calibration_start', 'calibration_strong', 'calibration_weak'])
    expect(f[0]).toMatchObject({ kind: 'act', basis: 'heuristic', facts: { level: cal.level, benchStart: 55, retest: 8, unit: 'kg' } })
    expect(f.every(x => Object.values(x.facts).every(v => typeof v === 'number' || typeof v === 'string'))).toBe(true)
  })
  it('says nothing for a missing or foreign-version result', () => {
    expect(calibrationFindings(null)).toEqual([])
    expect(calibrationFindings({ ...cal, v: 99 })).toEqual([])
  })
  it('seeds a working weight only where there is none', () => {
    expect(seedWeights(cal, {}, '2026-11-01')).toEqual({ '0025': { w: 55, d: '2026-11-01' } })
    expect(seedWeights(cal, { '0025': { w: 70, d: '2026-10-01' } }, '2026-11-01')).toEqual({})
  })
})

import { calibrationSummary } from './calibration.js'
import { analyze } from './trainer.js'
import { cleanCoachProfile } from './coach-profile.js'
import { describe as describeFinding, CODES } from './trainer-text.js'

describe('in the app', () => {
  const cal = calibrate({ months: 2, recent: 2, pushups: { reps: 40 }, squats: 12, plank: 50, lifts: { bench: { w: 60, equipment: 'barbell' } } }, man)
  it('the trainer has something to say before there is a log', () => {
    const r = analyze({ workouts: [], coachProfile: { goal: 'muscle', calibration: cal } }, Date.now())
    expect(r.ready).toBe(false)
    expect(r.findings.map(f => f.code)).toEqual(['data_thin', 'calibration_start', 'calibration_strong', 'calibration_weak'])
  })
  it('without a test it is the same as before', () => {
    expect(analyze({ workouts: [], coachProfile: { goal: 'muscle' } }).findings.map(f => f.code)).toEqual(['data_thin'])
  })
  it('every calibration code has local text, with the numbers in it', () => {
    for (const c of ['calibration_start', 'calibration_strong', 'calibration_weak']) expect(CODES).toContain(c)
    const [start, strong] = calibrationFindings(cal)
    const d = describeFinding(start)
    expect(d.title).toContain('A year or two in')
    expect(d.body).toContain('55 kg')
    expect(describeFinding(strong).title).toContain('Pushing')
  })
  it('the stored result survives cleaning only when it is a real one', () => {
    expect(cleanCoachProfile({ calibration: cal }).calibration.level).toBe(cal.level)
    expect(cleanCoachProfile({ calibration: { v: 1, level: 'wizard' } }).calibration).toBeNull()
    expect(cleanCoachProfile({ calibration: 'x' }).calibration).toBeNull()
  })
  it('reads out in the plan prompt', () => {
    expect(calibrationSummary(cal)).toMatch(/^self-tested, some: 40 push-ups; 12 bodyweight squats in 60 s; 50 s plank; bench press 60 kg for 8 reps/)
    expect(calibrationSummary(null)).toBeNull()
  })
})

import { trainerContext } from './trainer-ai.js'
import { cleanTrainerContext } from '../../../api/trainer.js'
describe('through to the written check-in', () => {
  it('the server keeps the level-test findings and their facts', () => {
    const cal = calibrate({ months: 2, recent: 2, pushups: { reps: 40 }, squats: 12, plank: 50, lifts: { bench: { w: 60, equipment: 'barbell' } } }, man)
    const S = { workouts: [], coachProfile: { goal: 'muscle', age: 35, calibration: cal } }
    const clean = cleanTrainerContext(trainerContext(S, analyze(S)))
    expect(clean.level).toBeNull()
    const start = clean.findings.find(f => f.code === 'calibration_start')
    expect(start.facts).toMatchObject({ level: 'some', benchStart: 55, retest: 8, unit: 'kg' })
    expect(clean.findings.map(f => f.code)).toEqual(['data_thin', 'calibration_start', 'calibration_strong', 'calibration_weak'])
  })
})

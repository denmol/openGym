import { describe, it, expect } from 'vitest'
import { validateCoachPlan, limitedMuscles, problemText, WEEKLY_SETS } from './coach-validate.js'
import { DEF_COACH } from './coach-profile.js'
import { EQ_PRESETS } from './coach-catalog.js'

// Catalogue ids used below, so the intent of each fixture stays readable:
//   0025 barbell bench press (chest, barbell)   0043 barbell full squat (upper legs, barbell)
//   2330 pull-up (back, body weight)            0001 3/4 sit-up (waist, body weight)
const profile = { ...DEF_COACH, days: 2, minutes: 60, equipment: EQ_PRESETS.gym.eq }

const plan = (over = {}) => ({
  opengym_plan: 1,
  week: { 1: 'r1', 4: 'r2' },
  routines: [
    { id: 'r1', name: 'Upper', ex: [{ id: '0025', sets: 4, reps: 8, prog: 'linear', inc: 2.5 }] },
    { id: 'r2', name: 'Lower', ex: [{ id: '0043', sets: 4, reps: 6, prog: 'linear', inc: 5 }] }
  ],
  ...over
})

const texts = list => list.map(problemText)

describe('a plan that is fine', () => {
  it('passes', () => {
    const r = validateCoachPlan(plan(), profile)
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe('errors that block', () => {
  it('catches an exercise id that does not exist', () => {
    const bad = plan()
    bad.routines[0].ex[0].id = '9999'
    const r = validateCoachPlan(bad, profile)
    expect(r.ok).toBe(false)
    expect(texts(r.errors)[0]).toContain('does not exist')
  })

  it('catches equipment the person does not have', () => {
    const r = validateCoachPlan(plan(), { ...profile, equipment: EQ_PRESETS.bodyweight.eq })
    expect(r.ok).toBe(false)
    expect(texts(r.errors).join(' ')).toContain('not in the available equipment')
  })

  it('rejects any weight — the first session is what records them', () => {
    const bad = plan()
    bad.routines[0].ex[0].weight = 60
    const r = validateCoachPlan(bad, profile)
    expect(texts(r.errors).join(' ')).toContain('Leave weights out')
  })

  it('allows an explicit zero weight, which means the same as leaving it out', () => {
    const ok = plan()
    ok.routines[0].ex[0].weight = 0
    expect(validateCoachPlan(ok, profile).ok).toBe(true)
  })

  it('catches a day pointing at a routine that was never written', () => {
    const r = validateCoachPlan(plan({ week: { 1: 'r1', 4: 'ghost' } }), profile)
    expect(texts(r.errors).join(' ')).toContain('not one of the training days')
  })

  it('catches the wrong number of training days', () => {
    const r = validateCoachPlan(plan({ week: { 1: 'r1' } }), profile)
    expect(texts(r.errors).join(' ')).toContain('1 training days, but 2 were asked for')
  })

  it('catches a progression rule the exercise mode does not allow', () => {
    const bad = plan()
    bad.routines[0].ex[0].prog = 'time'
    expect(validateCoachPlan(bad, profile).ok).toBe(false)
  })

  it('catches double progression without a rep range', () => {
    const bad = plan()
    bad.routines[0].ex[0].prog = 'double'
    expect(texts(validateCoachPlan(bad, profile).errors).join(' ')).toContain('without a rep range')
  })

  it('catches a missing set count', () => {
    const bad = plan()
    delete bad.routines[0].ex[0].sets
    expect(texts(validateCoachPlan(bad, profile).errors).join(' ')).toContain('no set count')
  })

  it('catches an empty training day', () => {
    const bad = plan()
    bad.routines[0].ex = []
    expect(texts(validateCoachPlan(bad, profile).errors).join(' ')).toContain('has no exercises')
  })

  it('survives complete garbage without throwing', () => {
    for (const junk of [{}, { routines: null }, { routines: [] }, { routines: [{}] }, { routines: [{ ex: [{}] }] }]) {
      expect(() => validateCoachPlan(junk, profile)).not.toThrow()
    }
    expect(validateCoachPlan({}, profile).ok).toBe(false)
  })
})

describe('warnings that do not block', () => {
  it('flags a session that runs well over the time budget without failing it', () => {
    const long = plan()
    long.routines[0].ex = Array.from({ length: 10 }, () => ({ id: '0025', sets: 5, reps: 10, prog: 'linear' }))
    const r = validateCoachPlan(long, { ...profile, minutes: 45 })
    expect(r.ok).toBe(true)
    expect(texts(r.warnings).join(' ')).toMatch(/minutes, against the 45/)
  })

  it('flags too much weekly volume on one muscle', () => {
    const lots = plan()
    lots.routines[0].ex = Array.from({ length: 8 }, () => ({ id: '0025', sets: 5, reps: 8, prog: 'linear' }))
    const r = validateCoachPlan(lots, profile)
    expect(r.ok).toBe(true)
    expect(texts(r.warnings).join(' ')).toMatch(new RegExp(`more than the ${WEEKLY_SETS.max}`))
  })

  it('counts a routine trained twice a week twice over', () => {
    const heavy = { id: 'r1', name: 'Chest', ex: [{ id: '0025', sets: 12, reps: 8, prog: 'linear' }] }
    const over = new RegExp(`more than the ${WEEKLY_SETS.max}`)
    // 12 sets once a week is inside the range; the same day twice is 24 and is not.
    const once = validateCoachPlan({ week: { 1: 'r1' }, routines: [heavy] }, { ...profile, days: 1 })
    const twice = validateCoachPlan({ week: { 1: 'r1', 4: 'r1' }, routines: [heavy] }, profile)
    expect(texts(once.warnings).join(' ')).not.toMatch(over)
    expect(texts(twice.warnings).join(' ')).toMatch(over)
  })

  it('holds only the muscles a plan aims at to the volume floor', () => {
    // One chest day: the triceps and shoulders it also loads must not each raise a warning.
    const r = validateCoachPlan({
      week: { 1: 'r1' },
      routines: [{ id: 'r1', name: 'Chest', ex: [{ id: '0025', sets: 3, reps: 8, prog: 'linear' }] }]
    }, { ...profile, days: 1 })
    const floors = texts(r.warnings).filter(w => w.includes('only about'))
    expect(floors).toHaveLength(1)
    // Named the way the muscle map names it, so the UI can translate it and the repair
    // prompt reads as a sentence rather than a slug.
    expect(floors[0]).toContain('Chest')
  })

  it('flags an exercise loading a joint the user called out', () => {
    const r = validateCoachPlan(plan(), { ...profile, limits: 'ont i axeln ibland' })
    expect(r.ok).toBe(true)
    expect(texts(r.warnings).join(' ')).toContain('you said is a problem')
  })

  it('says nothing about limitations when none were given', () => {
    const r = validateCoachPlan(plan(), profile)
    expect(texts(r.warnings).join(' ')).not.toContain('you said is a problem')
  })
})

describe('limitedMuscles', () => {
  it('reads both languages', () => {
    expect(limitedMuscles('bad knee')).toContain('quadriceps')
    expect(limitedMuscles('dåligt knä')).toContain('quadriceps')
    expect(limitedMuscles('ont i ländryggen')).toContain('lower-back')
  })

  it('is empty for an empty field', () => {
    expect(limitedMuscles('')).toEqual([])
    expect(limitedMuscles(null)).toEqual([])
  })
})

describe('problemText', () => {
  it('fills the placeholders for the repair prompt', () => {
    expect(problemText({ key: '{0} needs {1}.', args: ['Bench', 'a barbell'] })).toBe('Bench needs a barbell.')
  })
})

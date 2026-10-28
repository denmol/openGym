import { describe, it, expect } from 'vitest'
import {
  buildBackup, parseBackup, stateFromBackup, summarize, saveSafetyCopy, readSafetyCopy, clearSafetyCopy,
  SAFETY_KEY, SAFETY_DAYS, MAX_BYTES
} from './backup.js'

const DEF = { unit: 'kg', workouts: [], routines: [], meals: [], bodyweight: [], glucose: [], week: {}, flex: null, active: null, coachUndo: null, trainerUndo: null }
const S = {
  unit: 'lb', workouts: [{ id: 1 }, { id: 2 }], routines: [{ id: 'r' }], meals: [{ id: 'm' }], bodyweight: [{ d: 'x', w: 80 }], glucose: [],
  week: { 1: 'r' }, flex: { perWeek: 3 }, active: { id: 'live' }, coachUndo: { a: 1 }, trainerUndo: { b: 2 }, _ts: 99
}
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) } }

describe('buildBackup', () => {
  it('drops what only belongs to this device and counts what is inside', () => {
    const b = buildBackup(S, new Date('2026-10-28T10:00:00Z'))
    expect(b.pass_backup).toBe(1)
    expect(b.exported).toBe('2026-10-28T10:00:00.000Z')
    expect(b.state.active).toBeUndefined()
    expect(b.state.coachUndo).toBeUndefined()
    expect(b.state._ts).toBeUndefined()
    expect(b.summary).toEqual({ workouts: 2, routines: 1, meals: 1, weighIns: 1, glucose: 0 })
  })
  it('does not touch the state it was given', () => {
    buildBackup(S)
    expect(S.active).toEqual({ id: 'live' })
  })
})

describe('parseBackup', () => {
  it('round-trips a backup', () => {
    const p = parseBackup(JSON.stringify(buildBackup(S)), DEF)
    expect(p.ok).toBe(true)
    expect(p.legacy).toBe(false)
    expect(p.state.workouts).toEqual(S.workouts)
    expect(p.state.unit).toBe('lb')
    expect(p.state.active).toBeUndefined()
  })
  it('still reads the bare state that earlier versions exported', () => {
    const p = parseBackup(JSON.stringify(S), DEF)
    expect(p.ok).toBe(true)
    expect(p.legacy).toBe(true)
    expect(p.state.routines).toEqual(S.routines)
    expect(p.state.active).toBeUndefined()
  })
  it('refuses things that are not a backup', () => {
    for (const t of ['', '   ', '[]', '"x"', '{"hello":1}', '{"workouts":[]}']) expect(parseBackup(t, DEF).error).toBe('not_backup')
  })
  it('refuses broken JSON and oversized files', () => {
    expect(parseBackup('{"workouts":', DEF).error).toBe('bad_json')
    expect(parseBackup('x'.repeat(MAX_BYTES + 1), DEF).error).toBe('too_big')
  })
  it('refuses a file from a newer format', () => {
    expect(parseBackup(JSON.stringify({ pass_backup: 2, state: S }), DEF).error).toBe('newer')
    expect(parseBackup(JSON.stringify({ pass_backup: 'x', state: S }), DEF).error).toBe('newer')
  })
  it('names the section when a list is not a list or an object is not an object', () => {
    const bad = parseBackup(JSON.stringify({ ...S, meals: 'oops' }), DEF)
    expect(bad).toMatchObject({ ok: false, error: 'bad_shape', detail: 'meals' })
    const bad2 = parseBackup(JSON.stringify({ ...S, week: [1] }), DEF)
    expect(bad2).toMatchObject({ ok: false, error: 'bad_shape', detail: 'week' })
  })
  it('drops keys the app does not know instead of letting them through', () => {
    const p = parseBackup(JSON.stringify({ ...S, evil: { x: 1 }, __proto__x: 1 }), DEF)
    expect(p.state.evil).toBeUndefined()
  })
})

describe('stateFromBackup', () => {
  it('fills what an older file lacks with the defaults', () => {
    const p = parseBackup(JSON.stringify({ workouts: [], routines: [] }), DEF)
    const s = stateFromBackup(p, DEF)
    expect(s.unit).toBe('kg')
    expect(s.week).toEqual({})
    expect(s.week).not.toBe(DEF.week)             // a copy, so editing it cannot change the defaults
  })
})

describe('the copy kept before an import', () => {
  it('can be read back and cleared', () => {
    const st = mem(), now = new Date('2026-10-28T10:00:00Z')
    expect(saveSafetyCopy(S, st, now)).toBe(true)
    const c = readSafetyCopy(st, new Date('2026-10-29T10:00:00Z'))
    expect(c.summary.workouts).toBe(2)
    expect(c.state.active).toBeUndefined()
    clearSafetyCopy(st)
    expect(readSafetyCopy(st)).toBeNull()
  })
  it('expires after a week and is removed', () => {
    const st = mem()
    saveSafetyCopy(S, st, new Date('2026-10-01T00:00:00Z'))
    expect(readSafetyCopy(st, new Date(Date.parse('2026-10-01T00:00:00Z') + (SAFETY_DAYS + 1) * 86400000))).toBeNull()
    expect(st.getItem(SAFETY_KEY)).toBeNull()
  })
  it('says so when the storage refuses it', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} }
    expect(saveSafetyCopy(S, full)).toBe(false)
  })
  it('ignores damaged contents', () => {
    const st = mem(); st.setItem(SAFETY_KEY, '{nope')
    expect(readSafetyCopy(st)).toBeNull()
  })
})

describe('summarize', () => {
  it('copes with a missing state', () => {
    expect(summarize(null)).toEqual({ workouts: 0, routines: 0, meals: 0, weighIns: 0, glucose: 0 })
  })
})

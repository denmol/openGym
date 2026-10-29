import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Only browser storage/events are substituted; workout actions, store and consumers are real.
vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} })
vi.stubGlobal('window', { addEventListener() {}, matchMedia: () => ({ matches: false }) })
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
const { useStore, DEF } = await import('./store/useStore.js')
const { useUI } = await import('./store/useUI.js')
const { beginWorkout, finishWorkout } = await import('./sheets.jsx')
const { buildBackup, parseBackup } = await import('./lib/backup.js')
const cfg = { id: '0001', sets: 1, reps: 5, weight: 20, inc: 2.5 }
const w = (d, weight) => ({ id: d, d, start: +new Date(d + 'T08:00:00'), end: +new Date(d + 'T09:00:00'),
  entries: [{ id: cfg.id, target: cfg, sets: [{ w: weight, r: 5, done: true }] }] })
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T18:00:00'))
  useStore.setState({ user: null, S: { ...structuredClone(DEF), sound: false,
    routines: [{ id: 'a', name: 'Synthetic', ex: [cfg] }],
    workouts: [w('2026-10-19', 40), w('2026-10-28', 100)],
    exWeights: { [cfg.id]: { w: 100, d: '2026-10-28' } } } })
  useUI.getState().closeAll()
})
afterEach(() => { useUI.getState().closeAll(); vi.useRealTimers() })

it('prefills an older session from preceding history rather than future progress', () => {
  beginWorkout('a', null, { past: { day: '2026-10-20', minutes: 60 } })
  expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(42.5)
})
it('does not overwrite an active session if a stale backfill sheet is submitted', () => {
  useStore.getState().update(s => { s.active = { id: 'keep-me', entries: [] } })
  beginWorkout('a', null, { past: { day: '2026-10-20', minutes: 60 } })
  expect(useStore.getState().S.active.id).toBe('keep-me')
})
it.each(['2026-02-30', '2026-13-01', '2026-10-30', 'invalid'])('rejects invalid or future day %s at the action boundary', day => {
  beginWorkout('a', null, { past: { day, minutes: 60 } })
  expect(useStore.getState().S.active).toBeNull()
})
it.each([0, -5, NaN, Infinity])('rejects invalid duration %s without creating history', minutes => {
  beginWorkout('a', null, { past: { day: '2026-10-20', minutes } })
  expect(useStore.getState().S.active).toBeNull()
})
it('uses the entered start time so same-day session order can be recorded honestly', () => {
  beginWorkout('a', null, { past: { day: '2026-10-20', time: '18:30', minutes: 60 } })
  expect(useStore.getState().S.active.start).toBe(+new Date('2026-10-20T18:30:00'))
})
it.each([1, 90, 360])('saves exactly %s minutes, even when finished much later', minutes => {
  beginWorkout('a', null, { past: { day: '2026-10-20', minutes } })
  useStore.getState().update(s => { s.active.entries[0].sets = [{ w: 120, r: 5, done: true }] })
  vi.advanceTimersByTime(120000)
  finishWorkout()
  const state = useStore.getState().S
  const saved = state.workouts.find(x => x.d === '2026-10-20')
  expect(saved.end - saved.start).toBe(minutes * 60000)
  expect(state.workouts.map(x => x.d)).toEqual(['2026-10-19', '2026-10-20', '2026-10-28'])
  expect(state.exWeights[cfg.id]).toEqual({ w: 100, d: '2026-10-28' })
  expect(state.active).toBeNull()
  const restored = parseBackup(JSON.stringify(buildBackup(state)), DEF)
  expect(restored.ok).toBe(true)
  expect(restored.state.workouts).toEqual(state.workouts)
  finishWorkout()
  expect(useStore.getState().S.workouts).toHaveLength(3)
})

it('leaves live training on current progression and elapsed clock time', () => {
  beginWorkout('a', 80)
  expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(102.5)
  expect(useStore.getState().S.active.backdated).toBeUndefined()
  useStore.getState().update(s => { s.active.entries[0].sets[0].done = true })
  vi.advanceTimersByTime(90000)
  finishWorkout()
  const saved = useStore.getState().S.workouts.at(-1)
  expect(saved.end - saved.start).toBe(90000)
  expect(saved).toMatchObject({ d: '2026-10-29', bw: 80, bwu: 'kg' })
})

it('does not save a resumed backfill whose duration was lost or corrupted', () => {
  beginWorkout('a', null, { past: { day: '2026-10-20', minutes: 60 } })
  useStore.getState().update(s => {
    s.active.backdated.minutes = null
    s.active.entries[0].sets[0].done = true
  })
  finishWorkout()
  expect(useStore.getState().S.workouts).toHaveLength(2)
  expect(useStore.getState().S.active).not.toBeNull()
})

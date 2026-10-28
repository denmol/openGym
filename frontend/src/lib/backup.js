// Backup files: what the "Export backup" button writes, and what "Import" accepts.
//
// The file is the whole state minus what only makes sense on the device it came from (a workout
// in progress, undo stacks), wrapped with a format marker and a count of what is inside so the
// confirmation can say what is about to be replaced. Reading is strict about shape — a list must
// be a list — and forgiving about age: files written before this existed (the bare state, no
// marker) are still accepted. Before an import replaces anything, the current state is kept for a
// week so a wrong file can be undone.
//
// Pure apart from the storage object passed in, so the tests can use a plain Map.

export const BACKUP_FORMAT = 1
export const MAX_BYTES = 25 * 1024 * 1024
export const SAFETY_KEY = 'gym_pre_import'
export const SAFETY_DAYS = 7
const TRANSIENT = ['active', 'coachUndo', 'trainerUndo', '_ts']

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const clone = o => JSON.parse(JSON.stringify(o))

/** What is in a state, as counts the confirmation can show. */
export function summarize(state) {
  const n = k => (Array.isArray(state?.[k]) ? state[k].length : 0)
  return { workouts: n('workouts'), routines: n('routines'), meals: n('meals'), weighIns: n('bodyweight'), glucose: n('glucose') }
}

export function buildBackup(S, now = new Date()) {
  const state = clone(S)
  for (const k of TRANSIENT) delete state[k]
  return { pass_backup: BACKUP_FORMAT, app: 'Pass', exported: now.toISOString(), summary: summarize(state), state }
}

/**
 * { ok: true, state, summary, legacy } or { ok: false, error, detail? }.
 * `defaults` is the app's default state: its shape is what a file is checked against, and keys it
 * does not know are dropped rather than let through.
 */
export function parseBackup(text, defaults) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'not_backup' }
  if (text.length > MAX_BYTES) return { ok: false, error: 'too_big' }
  let data
  try { data = JSON.parse(text) } catch { return { ok: false, error: 'bad_json' } }
  if (!isObj(data)) return { ok: false, error: 'not_backup' }

  let raw, legacy = false
  if (data.pass_backup !== undefined) {
    if (!Number.isInteger(data.pass_backup) || data.pass_backup > BACKUP_FORMAT || data.pass_backup < 1) return { ok: false, error: 'newer' }
    if (!isObj(data.state)) return { ok: false, error: 'not_backup' }
    raw = data.state
  } else if (Array.isArray(data.workouts) && Array.isArray(data.routines)) {
    raw = data; legacy = true                          // an export from before the format marker
  } else return { ok: false, error: 'not_backup' }

  const state = {}
  for (const key of Object.keys(defaults)) {
    if (TRANSIENT.includes(key) || !(key in raw)) continue
    const want = defaults[key], got = raw[key]
    if (Array.isArray(want) && !Array.isArray(got)) return { ok: false, error: 'bad_shape', detail: key }
    if (isObj(want) && !isObj(got)) return { ok: false, error: 'bad_shape', detail: key }
    state[key] = got
  }
  if (!Array.isArray(state.workouts) || !Array.isArray(state.routines)) return { ok: false, error: 'not_backup' }
  return { ok: true, state, summary: summarize(state), legacy }
}

/** The state to adopt: the defaults, overlaid with what the file holds. */
export const stateFromBackup = (parsed, defaults) => Object.assign(clone(defaults), parsed.state)

/* ---- the copy kept before an import replaces anything ---- */

/** false if the storage refused it (full, or private browsing): the caller should say there is no undo. */
export function saveSafetyCopy(S, storage, now = new Date()) {
  try {
    storage.setItem(SAFETY_KEY, JSON.stringify({ at: now.toISOString(), state: buildBackup(S, now).state }))
    return true
  } catch { return false }
}

export function readSafetyCopy(storage, now = new Date()) {
  try {
    const raw = storage.getItem(SAFETY_KEY)
    if (!raw) return null
    const { at, state } = JSON.parse(raw)
    const age = now - new Date(at)
    if (!isObj(state) || !(age >= 0) || age > SAFETY_DAYS * 86400000) { storage.removeItem(SAFETY_KEY); return null }
    return { at, state, summary: summarize(state) }
  } catch { return null }
}

export const clearSafetyCopy = storage => { try { storage.removeItem(SAFETY_KEY) } catch { /* nothing to do */ } }

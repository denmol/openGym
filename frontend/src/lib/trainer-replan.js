// Re-planning: a review of the program every few weeks, from what was actually done.
//
// The AI program is written once, from a questionnaire. A month later the log knows things the
// questionnaire could not: which lifts stopped moving, which muscles ended up short of sets.
// This collects those into a short list of proposed changes — never applied by itself, each
// one undoable — and says when it is time to look.
//
// No model is involved. A proposal is made only from the same measurements the trainer's
// findings use, and only ever changes one thing at a time (add sets to an exercise, or swap
// one stalled exercise for a close relative), so what changed and why can be read off the list.

import { EXDB, EXIDX, isCardio } from './exercises.js'
import { musclesOf } from './muscles.js'
import { defaultConfig, modeOf } from './history.js'
import { coachProfileOf } from './coach-profile.js'
import { exerciseTrends, primaryMuscle, STALL_PCT } from './trainer.js'
import { sessionsFor } from './progression.js'

const DAY = 86400000
export const REPLAN_AFTER_WEEKS = 4
// A swap is a bigger step than a note, so it waits for a longer stall than the trainer's own
// "stalled" finding (3 weeks): at least this many sessions over at least this many weeks.
export const SWAP_MIN_SESSIONS = 5
export const SWAP_MIN_WEEKS = 6

const iso = ms => new Date(ms).toISOString().slice(0, 10)

/** Weeks since the program was last set up, reviewed or changed by the trainer. */
export function planAgeWeeks(S, now = Date.now()) {
  const marks = [S.replanAt, S.coachUndo && S.coachUndo.at, S.trainerUndo && S.trainerUndo.at].filter(Boolean)
  let base = marks.length ? Math.max(...marks.map(d => new Date(d + 'T12:00:00').getTime())) : null
  if (base == null) {
    const first = (S.workouts || []).map(w => w.start || new Date(w.d + 'T12:00:00').getTime()).sort((a, b) => a - b)[0]
    base = first != null ? first : null
  }
  return base == null ? 0 : Math.max(0, (now - base) / (7 * DAY))
}

/** Time to look: four weeks since the last review, and enough training to judge from. */
export const replanDue = (S, analysis, now = Date.now()) =>
  !!(analysis && analysis.ready) && planAgeWeeks(S, now) >= REPLAN_AFTER_WEEKS

// Every exercise id that is in some routine, so a swap never brings in one already used.
const usedIds = S => new Set((S.routines || []).flatMap(r => (r.ex || []).map(c => c.id)))
const plannedRoutineIds = S => new Set(Object.values(S.week || {}))

// Implements and positions carry the name but not the movement; stripped before comparing.
const NOISE = new Set(['barbell', 'dumbbell', 'cable', 'lever', 'smith', 'machine', 'ez', 'bar', 'kettlebell', 'band', 'weighted', 'assisted', 'v', 'version', 'the', 'on', 'with', 'of'])
const words = n => new Set(String(n || '').toLowerCase().split(/[^a-z]+/).filter(w => w && !NOISE.has(w)))
const jaccard = (a, b) => {
  let both = 0
  a.forEach(w => { if (b.has(w)) both++ })
  return a.size + b.size - both ? both / (a.size + b.size - both) : 0
}
// Equipment that makes an exercise awkward to swap in unprompted.
const AWKWARD = new Set(['stability ball', 'medicine ball', 'rope', 'sled machine', 'roller', 'wheel roller', 'bosu ball'])

/**
 * The closest replacement for an exercise, or null: same main muscle and target, equipment the
 * person has, and a name that shares the movement (a bench press for a bench press, not the
 * first thing in the catalogue that happens to hit the same muscle).
 */
export function alternativeFor(S, exId) {
  const ex = EXIDX[exId]
  if (!ex || isCardio(ex)) return null
  const main = primaryMuscle(ex)
  if (!main) return null
  const have = coachProfileOf(S).equipment
  const allowed = have && have.length ? new Set(have) : new Set([ex.eq])
  const used = usedIds(S)
  const mine = words(ex.n)
  const scored = EXDB
    .filter(c =>
      c.id !== exId && !used.has(c.id) && !isCardio(c) && allowed.has(c.eq) &&
      (!AWKWARD.has(c.eq) || c.eq === ex.eq) &&
      primaryMuscle(c) === main && (musclesOf(c)[main] || 0) >= 0.9 &&
      defaultConfig(c.id).mode === 'reps')
    .map(c => ({ c, score: jaccard(mine, words(c.n)) * 10 + (c.tg === ex.tg ? 3 : 0) + (c.eq === ex.eq ? 0 : 1) }))
  // Closest first; ties by id so the pick never varies between runs.
  scored.sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : 1))
  return scored.length && scored[0].score >= 3 ? scored[0].c : null
}

function swapFor(S, trend, now) {
  const routine = (S.routines || []).find(r => plannedRoutineIds(S).has(r.id) && (r.ex || []).some(c => c.id === trend.id))
  if (!routine) return null
  const cfg = routine.ex.find(c => c.id === trend.id)
  if (modeOf(cfg) !== 'reps') return null
  const alt = alternativeFor(S, trend.id)
  if (!alt) return null
  const base = defaultConfig(alt.id)
  // Keep the shape of the work (sets, rep range, the progression rule); the load starts fresh,
  // because a weight earned on one lift says nothing safe about another.
  const next = { id: alt.id, ...base, sets: cfg.sets, reps: cfg.reps }
  if (cfg.repsMin != null) next.repsMin = cfg.repsMin
  if (cfg.repsMax != null) next.repsMax = cfg.repsMax
  if (cfg.prog) next.prog = cfg.prog
  return {
    type: 'swap', reason: 'stalled', routineId: routine.id, routine: routine.name,
    fromId: trend.id, from: trend.name, toId: alt.id, to: alt.n,
    exId: trend.id, exercise: trend.name,                       // the undo list keys on exId + to
    weeks: trend.weeks, sessions: trend.sessions,
    prev: JSON.parse(JSON.stringify(cfg)), next
  }
}

/**
 * The proposed changes. `analysis` is the trainer's own analysis: its volume findings already
 * carry safe "add sets" actions, which are reused rather than recomputed.
 */
export function replanProposals(S, analysis, now = Date.now()) {
  const out = []
  const seen = new Set()
  const take = a => {
    const key = a.type + '|' + a.routineId + '|' + (a.exId || a.fromId)
    if (seen.has(key)) return
    seen.add(key); out.push(a)
  }
  ;((analysis && analysis.findings) || []).forEach(f => {
    if (f.action && f.action.type === 'add_sets') take({ ...f.action, reason: f.code })
  })
  exerciseTrends(S, now)
    .filter(x => Math.abs(x.pct) < STALL_PCT && x.sessions >= SWAP_MIN_SESSIONS && x.weeks >= SWAP_MIN_WEEKS)
    // Only lifts that were really attempted lately; a stalled series of one set is not a signal.
    .filter(x => sessionsFor(S, x.id).length >= SWAP_MIN_SESSIONS)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 2)
    .forEach(x => { const sw = swapFor(S, x, now); if (sw) take(sw) })
  return out
}

/** Marks the program as just looked at, so the next review is due a full period from now. */
export const markReplanned = (s, now = Date.now()) => { s.replanAt = iso(now) }

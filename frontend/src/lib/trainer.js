// The trainer's analysis: what this person's own log says, judged against a few written rules.
//
// Nothing in here is a model. Every number the trainer ever speaks — sets per muscle, a
// strength trend, a rate of weight loss — is computed here, from the log, by arithmetic that
// can be read and tested. The language model (lib/trainer-ai.js) is only allowed to put words
// around what this file found, and its words are checked against it before anyone sees them.
//
// A finding is { code, kind, basis, evidence, facts, action? }:
//   code      which rule fired; the text for it lives in trainer-text.js
//   kind      'act' (worth doing something about) | 'watch' | 'good' | 'info'
//   basis     'evidence' | 'practice' | 'heuristic' — see trainer-evidence.js
//   evidence  ids into EVIDENCE
//   facts     the numbers and names the rule rests on; flat, so they can be shown and sent
//   action    optional change to the plan the user can apply (only ever adds or removes sets)
//
// What it will not do: say anything about a muscle, lift or trend it has too little data on.
// Under MIN_WORKOUTS finished sessions in the window it returns a single "not enough yet"
// finding instead of guessing, because a confident verdict off two sessions is the failure
// this whole feature exists to avoid.

import { MUSCLES, MUSCLE_NAME, musclesOf } from './muscles.js'
import { EXIDX, isCardio } from './exercises.js'
import { e1rmSeries } from './onerm.js'
import { rirOf, MIN_RATED } from './effort.js'
import { weightIn, modeOf } from './history.js'
import { mondayOf, isoOf } from './format.js'
import { coachProfileOf } from './coach-profile.js'
import { flexOf } from './flex.js'

const DAY = 86400000
export const WINDOW_DAYS = 28
export const PROGRESS_DAYS = 56
export const MIN_WORKOUTS = 4

// The muscles worth a verdict. Forearms, shins, serratus and the like get their work as a
// by-product of everything else; flagging them "low" would be noise.
export const MAJOR = ['chest', 'upper-back', 'deltoids', 'biceps', 'triceps', 'quadriceps', 'hamstring', 'gluteal', 'calves', 'abs']

// Weekly effective sets per muscle. The floor for building muscle is where the meta-analysis
// sees the benefit (10+ sets a week); the ceiling and every range for the other goals are the
// app's own, which is why they carry the 'heuristic' label in the findings.
export const RANGES = {
  muscle: { floor: 10, ceiling: 20, floorBasis: 'evidence' },
  other: { floor: 5, ceiling: 16, floorBasis: 'heuristic' }
}
export const rangeFor = goal => (goal === 'muscle' ? RANGES.muscle : RANGES.other)

// Muscles the volume range is applied to without the cited study having measured them.
export const EXTRAPOLATED = ['abs']

export const MAX_SETS_PER_EXERCISE = 6
const FAST_LOSS_PCT = 1.0          // % of body weight a week; Garthe compared 0.7 with 1.4
const SLOW_LOSS_PCT = 0.25
export const STALL_PCT = 0.5              // |trend| under this, %/week, is "flat"
const FALL_PCT = -1.0
const DELOAD_AFTER_WEEKS = 6       // the survey's average block was 5.6 ± 2.3 weeks

const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100
const startOf = w => w.start || new Date(w.d + 'T12:00:00').getTime()

/** A set that counts as work: finished, not flagged as a warm-up, reps or a hold on it. */
export const isWorkingSet = s => !!(s && s.done && !s.warm && ((s.r || 0) > 0 || (s.sec || 0) > 0))

function linearTrend(points) {
  // points: [{ x: days, y }]. Returns slope per week as a % of the mean, or null.
  const n = points.length
  if (n < 2) return null
  const mx = points.reduce((a, p) => a + p.x, 0) / n
  const my = points.reduce((a, p) => a + p.y, 0) / n
  let num = 0, den = 0
  points.forEach(p => { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2 })
  if (!den || !my) return null
  return { slope: num / den, pctPerWeek: (num / den) * 7 / my * 100, mean: my }
}

/** Effective sets per muscle for a list of workouts, plus the days each muscle was hit. */
export function muscleVolume(workouts) {
  const sets = {}, days = {}
  workouts.forEach(w => {
    const hitToday = {}
    ;(w.entries || []).forEach(e => {
      if (isCardio(e.id)) return
      const n = (e.sets || []).filter(isWorkingSet).length
      if (!n) return
      const m = musclesOf(EXIDX[e.id])
      for (const slug in m) {
        sets[slug] = (sets[slug] || 0) + m[slug] * n
        hitToday[slug] = (hitToday[slug] || 0) + m[slug] * n
      }
    })
    // "Trained that day" needs real work, not a lateral raise's 0.4 of a shoulder set.
    for (const slug in hitToday) if (hitToday[slug] >= 1.5) days[slug] = (days[slug] || 0) + 1
  })
  return { sets, days }
}

/** Weekly sets a routine plan would give a muscle, counting each assigned weekday. */
function plannedWeekly(S, slug) {
  let total = 0
  Object.values(S.week || {}).forEach(rid => {
    const r = (S.routines || []).find(x => x.id === rid)
    if (!r) return
    ;(r.ex || []).forEach(c => {
      const m = musclesOf(EXIDX[c.id])
      if (m[slug]) total += m[slug] * (c.sets || 1)
    })
  })
  return total
}

/** The plan change that would close a muscle's gap, or null when there is no safe one. */
function setsAction(S, slug, current, floor) {
  const occurrences = rid => Object.values(S.week || {}).filter(x => x === rid).length
  let best = null
  ;(S.routines || []).forEach(r => {
    const occ = occurrences(r.id)
    if (!occ) return
    ;(r.ex || []).forEach(c => {
      const ex = EXIDX[c.id]
      if (!ex || isCardio(ex) || modeOf(c) === 'time') return
      const weight = musclesOf(ex)[slug] || 0
      if (weight < 0.9 || (c.sets || 1) >= MAX_SETS_PER_EXERCISE) return
      const cand = { routineId: r.id, routine: r.name, exId: c.id, exercise: ex.n, from: c.sets || 1, occ }
      if (!best || cand.from < best.from) best = cand
    })
  })
  if (!best) return null
  const need = Math.max(1, Math.ceil(floor - current))
  const delta = Math.min(2, Math.max(1, Math.ceil(need / best.occ)), MAX_SETS_PER_EXERCISE - best.from)
  return { type: 'add_sets', muscle: slug, routineId: best.routineId, routine: best.routine, exId: best.exId, exercise: best.exercise, from: best.from, to: best.from + delta }
}

/**
 * Apply an action to a draft of the state. Returns false — and changes nothing — when the
 * plan has moved on since the action was computed, so a stale suggestion can never write over
 * an edit made on another device.
 */
export function applyTrainerAction(s, a) {
  if (!a) return false
  if (a.type === 'swap') {
    const r = (s.routines || []).find(x => x.id === a.routineId)
    const i = r ? (r.ex || []).findIndex(x => x.id === a.fromId) : -1
    // Only if the slot still holds the exercise that was judged, and the replacement is not
    // already somewhere in this routine (the same lift twice in a session is never the aim).
    if (i < 0 || (r.ex || []).some(x => x.id === a.toId) || !a.next || !a.prev) return false
    // The slot must still be exactly what was judged; an edit made since means the proposal is stale.
    if (JSON.stringify(r.ex[i]) !== JSON.stringify(a.prev)) return false
    r.ex[i] = JSON.parse(JSON.stringify(a.next))
    return true
  }
  if (a.type !== 'add_sets') return false
  const r = (s.routines || []).find(x => x.id === a.routineId)
  const c = r && (r.ex || []).find(x => x.id === a.exId)
  if (!c || (c.sets || 1) !== a.from || a.to > MAX_SETS_PER_EXERCISE || a.to <= a.from) return false
  c.sets = a.to
  return true
}

/**
 * Undo one applied action. Only touches the value the trainer wrote: if the exercise has been
 * edited since, it is left alone rather than rolled back over the edit.
 */
export function revertTrainerAction(s, a) {
  if (!a) return false
  if (a.type === 'swap') {
    const r = (s.routines || []).find(x => x.id === a.routineId)
    const i = r ? (r.ex || []).findIndex(x => x.id === a.toId) : -1
    if (i < 0 || !a.prev) return false
    r.ex[i] = JSON.parse(JSON.stringify(a.prev))
    return true
  }
  if (a.type !== 'add_sets') return false
  const r = (s.routines || []).find(x => x.id === a.routineId)
  const c = r && (r.ex || []).find(x => x.id === a.exId)
  if (!c || (c.sets || 1) !== a.to) return false
  c.sets = a.from
  return true
}

export function exerciseTrends(S, now) {
  const since = now - PROGRESS_DAYS * DAY
  const out = []
  const ids = new Set()
  ;(S.workouts || []).forEach(w => { if (startOf(w) > since) (w.entries || []).forEach(e => ids.add(e.id)) })
  ids.forEach(id => {
    if (isCardio(id)) return
    const pts = e1rmSeries(S, id).filter(p => (p.t || 0) > since)
    if (pts.length < 3) return
    const t0 = pts[0].t
    const spanDays = (pts[pts.length - 1].t - t0) / DAY
    if (spanDays < 14) return
    const trend = linearTrend(pts.map(p => ({ x: (p.t - t0) / DAY, y: p.y })))
    if (!trend) return
    const ex = EXIDX[id]
    out.push({
      id, name: ex ? ex.n : id, sessions: pts.length, weeks: r1(spanDays / 7),
      e1rm: pts[pts.length - 1].y, pct: r2(trend.pctPerWeek),
      muscle: primaryMuscle(ex)
    })
  })
  return out
}

export function primaryMuscle(ex) {
  const m = musclesOf(ex)
  let best = null
  for (const slug in m) if (!best || m[slug] > m[best]) best = slug
  return best
}

function weeklyTotals(workouts, now) {
  // Monday-based weeks, newest last, the current week included.
  const weeks = new Map()
  workouts.forEach(w => {
    const key = isoOf(new Date(mondayOf(isoOf(new Date(startOf(w))))))
    const cur = weeks.get(key) || { sessions: 0, sets: 0 }
    cur.sessions++
    ;(w.entries || []).forEach(e => { if (!isCardio(e.id)) cur.sets += (e.sets || []).filter(isWorkingSet).length })
    weeks.set(key, cur)
  })
  const out = []
  const thisMon = mondayOf(isoOf(new Date(now)))
  for (let i = 0; i < 12; i++) {
    const key = isoOf(new Date(thisMon - i * 7 * DAY))
    out.unshift(weeks.get(key) || { sessions: 0, sets: 0 })
  }
  return out
}

const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * Read the log and return what is worth saying.
 * @returns {{ ready, goal, range, workouts, weeks, muscles, findings }}
 */
export function analyze(S, now = Date.now()) {
  const profile = coachProfileOf(S)
  const goal = profile.goal || null
  const range = rangeFor(goal)
  const all = S.workouts || []
  const inWin = all.filter(w => startOf(w) > now - WINDOW_DAYS * DAY)
  const first = inWin.length ? Math.min(...inWin.map(startOf)) : now
  // A newcomer's four weeks may only be ten days old; dividing by four would call a
  // good start a shortfall.
  const weeks = Math.min(WINDOW_DAYS / 7, Math.max(1, (now - first) / (7 * DAY)))
  const base = { goal, range, workouts: inWin.length, weeks: r1(weeks), muscles: [], findings: [] }

  if (inWin.length < MIN_WORKOUTS) {
    return {
      ...base, ready: false,
      findings: [{ code: 'data_thin', kind: 'info', basis: 'heuristic', evidence: [], facts: { workouts: inWin.length, needed: MIN_WORKOUTS, days: WINDOW_DAYS } }]
    }
  }

  const findings = []
  const push = f => findings.push({ evidence: [], ...f })
  const vol = muscleVolume(inWin)

  /* ---- volume and frequency per muscle ---- */
  const muscles = MUSCLES.map(slug => {
    const weekly = (vol.sets[slug] || 0) / weeks
    const perWeek = (vol.days[slug] || 0) / weeks
    return { slug, name: MUSCLE_NAME[slug], weekly: r1(weekly), perWeek: r1(perWeek) }
  })
  base.muscles = muscles

  const sleepAvg = (() => {
    const rows = (S.sleep || []).filter(r => r && r.min > 0 && new Date(r.d + 'T12:00:00').getTime() > now - 14 * DAY)
    return rows.length >= 7 ? avg(rows.map(r => r.min)) : null
  })()

  const lowFrequency = []
  MAJOR.forEach(slug => {
    const m = muscles.find(x => x.slug === slug)
    const facts = { muscle: m.name, sets: m.weekly, floor: range.floor, ceiling: range.ceiling, goal: goal || 'general', weeks: base.weeks }
    // The meta-analysis is on limb muscles. Applying its range to the abs is the app's
    // extrapolation, so it is labelled that way, cites nothing, and is never urgent.
    const extrapolated = EXTRAPOLATED.includes(slug)
    if (m.weekly < range.floor) {
      const severe = m.weekly < range.floor * 0.5
      const action = setsAction(S, slug, m.weekly, range.floor)
      const planned = r1(plannedWeekly(S, slug))
      push({
        code: m.weekly === 0 ? 'volume_none' : 'volume_low',
        kind: !extrapolated && severe && (goal === 'muscle' || m.weekly === 0) ? 'act' : 'watch',
        basis: extrapolated ? 'heuristic' : range.floorBasis,
        evidence: extrapolated ? [] : ['volume'], facts: { ...facts, planned }, action: action || undefined
      })
    } else if (m.weekly > range.ceiling) {
      push({ code: 'volume_high', kind: 'watch', basis: 'heuristic', evidence: ['volume'], facts })
    }
    // Plenty of sets but all in one day: the twice-a-week finding. Only for the muscle goal,
    // where the study measured it, and only once the volume is real.
    if (goal === 'muscle' && !extrapolated && m.weekly >= range.floor * 0.7 && m.perWeek < 1.5) lowFrequency.push(m)
  })
  // One card for the lot: a program that trains every muscle once a week (most
  // push/pull/legs splits) would otherwise fire the same advice five times over.
  if (lowFrequency.length) {
    push({
      code: 'frequency_low', kind: 'watch', basis: 'evidence', evidence: ['frequency'],
      facts: {
        muscles: lowFrequency.slice(0, 5).map(m => m.name).join(', '), count: lowFrequency.length,
        perWeek: r1(lowFrequency.reduce((a, m) => a + m.perWeek, 0) / lowFrequency.length), target: 2
      }
    })
  }

  /* ---- strength trends ---- */
  const trends = exerciseTrends(S, now)
  const falling = trends.filter(x => x.pct <= FALL_PCT)
  const flat = trends.filter(x => Math.abs(x.pct) < STALL_PCT && x.sessions >= 4 && x.weeks >= 3)
  const rising = trends.filter(x => x.pct >= STALL_PCT).sort((a, b) => b.pct - a.pct)

  rising.slice(0, 2).forEach(x => push({
    code: 'progressing', kind: 'good', basis: 'heuristic', facts: { exercise: x.name, pct: x.pct, e1rm: x.e1rm, weeks: x.weeks, sessions: x.sessions, unit: S.unit || 'kg' }
  }))

  /* ---- recovery: several lifts falling at once, with a second sign ---- */
  const rated = (from, to) => {
    const xs = []
    all.forEach(w => {
      const t = startOf(w)
      if (t <= from || t > to) return
      ;(w.entries || []).forEach(e => (e.sets || []).forEach(s => { if (isWorkingSet(s)) { const v = rirOf(s); if (v != null) xs.push(v) } }))
    })
    return xs
  }
  const recent = rated(now - 14 * DAY, now), before = rated(now - 42 * DAY, now - 14 * DAY)
  const rirDrop = recent.length >= MIN_RATED && before.length >= MIN_RATED ? avg(before) - avg(recent) : null
  const lowSleep = sleepAvg != null && sleepAvg < 6.5 * 60
  const fatigued = falling.length >= 2 && ((rirDrop != null && rirDrop >= 0.5) || lowSleep)
  if (fatigued) {
    const sets = inWin.reduce((a, w) => a + (w.entries || []).reduce((b, e) => b + (isCardio(e.id) ? 0 : (e.sets || []).filter(isWorkingSet).length), 0), 0)
    push({
      code: 'fatigue', kind: 'act', basis: 'practice', evidence: ['deload', 'rir'],
      facts: {
        lifts: falling.length, names: falling.slice(0, 3).map(x => x.name).join(', '),
        worstPct: Math.min(...falling.map(x => x.pct)),
        rirDrop: rirDrop != null && rirDrop >= 0.5 ? r1(rirDrop) : 0,
        sleepHours: lowSleep ? r1(sleepAvg / 60) : 0,
        // What a week lighter looks like for this person, in their own numbers.
        deloadDays: 7, deloadSetsPct: 50, deloadSetsPerWeek: Math.max(1, Math.round(sets / weeks / 2)), deloadRir: 3
      }
    })
  } else {
    // A stall is only worth a note when recovery isn't the story, and it points at the
    // muscle's volume — the thing the log can check.
    flat.sort((a, b) => b.sessions - a.sessions).slice(0, 2).forEach(x => {
      const mv = x.muscle ? muscles.find(m => m.slug === x.muscle) : null
      push({
        code: 'stalled', kind: 'watch', basis: 'practice', evidence: ['deload'],
        facts: { exercise: x.name, weeks: x.weeks, sessions: x.sessions, e1rm: x.e1rm, pct: x.pct, unit: S.unit || 'kg', muscle: mv ? mv.name : '', sets: mv ? mv.weekly : 0, floor: range.floor },
        action: mv && mv.weekly < range.floor ? setsAction(S, x.muscle, mv.weekly, range.floor) || undefined : undefined
      })
    })
    if (falling.length === 1) {
      const x = falling[0]
      push({ code: 'falling', kind: 'watch', basis: 'practice', evidence: ['deload'], facts: { exercise: x.name, pct: x.pct, weeks: x.weeks, sessions: x.sessions } })
    }
  }

  /* ---- a long block with no lighter week ---- */
  const totals = weeklyTotals(all, now)
  const done = totals.filter(w => w.sessions >= 2)
  if (done.length >= 3) {
    const med = [...done.map(w => w.sets)].sort((a, b) => a - b)[Math.floor(done.length / 2)]
    let run = 0
    for (let i = totals.length - 1; i >= 0; i--) {
      const w = totals[i]
      // The week in progress is allowed to be light without ending the run.
      if (w.sessions >= 2 && w.sets >= 0.6 * med) run++
      else if (i === totals.length - 1) continue
      else break
    }
    if (run >= DELOAD_AFTER_WEEKS && !fatigued) {
      push({ code: 'block_long', kind: 'info', basis: 'practice', evidence: ['deload'], facts: { weeks: run, typical: 5.6 } })
    }
  }

  /* ---- showing up ---- */
  // A flexible week has no weekdays to miss: the aim is the number of sessions chosen.
  const flex = flexOf(S)
  const planned = flex.on ? flex.perWeek : Object.values(S.week || {}).filter(rid => (S.routines || []).some(r => r.id === rid)).length
  const doneWk = inWin.length / weeks
  if (planned >= 1 && weeks >= 2 && doneWk < planned * 0.7) {
    push({ code: 'adherence', kind: 'watch', basis: 'heuristic', facts: { planned, done: r1(doneWk), weeks: base.weeks } })
  }

  /* ---- effort ---- */
  const winRated = rated(now - WINDOW_DAYS * DAY, now)
  if (winRated.length >= MIN_RATED && avg(winRated) >= 4) {
    push({ code: 'effort_far', kind: 'watch', basis: 'practice', evidence: ['rir', 'rirAccuracy'], facts: { rir: r1(avg(winRated)), sets: winRated.length } })
  } else if (winRated.length < MIN_RATED && (goal === 'muscle' || goal === 'strength')) {
    push({ code: 'rate_effort', kind: 'info', basis: 'practice', evidence: ['rir'], facts: { sets: winRated.length, needed: MIN_RATED } })
  }

  /* ---- body weight, when the goal is to lose it ---- */
  if (goal === 'fatloss') {
    if (profile.age != null && profile.age >= 18) {
      const bw = (S.bodyweight || [])
        .map(e => ({ t: e.t || new Date(e.d + 'T12:00:00').getTime(), kg: weightIn(e, 'kg') }))
        .filter(p => p.kg && p.t > now - 42 * DAY).sort((a, b) => a.t - b.t)
      if (bw.length >= 3 && (bw[bw.length - 1].t - bw[0].t) / DAY >= 14) {
        const t0 = bw[0].t
        const tr = linearTrend(bw.map(p => ({ x: (p.t - t0) / DAY, y: p.kg })))
        if (tr) {
          const loss = -tr.pctPerWeek
          // trialSlow / trialFast are the two rates the cited trial compared; they ride along so the
          // text (and anything that checks it) can state them without a number of its own.
          const facts = { pct: r2(Math.abs(tr.pctPerWeek)), kgPerWeek: r2(Math.abs(tr.slope * 7)), weighIns: bw.length, fast: FAST_LOSS_PCT, slow: SLOW_LOSS_PCT, trialSlow: 0.7, trialFast: 1.4 }
          if (loss >= FAST_LOSS_PCT) push({ code: 'weight_fast', kind: 'act', basis: 'heuristic', evidence: ['weightLoss'], facts })
          else if (loss >= SLOW_LOSS_PCT) push({ code: 'weight_on_track', kind: 'good', basis: 'heuristic', evidence: ['weightLoss'], facts })
          else push({ code: 'weight_flat', kind: 'info', basis: 'heuristic', facts })
        }
      }
    }
  }

  /* ---- general health goal: the guideline's one ask ---- */
  if (goal === 'health' && inWin.length / weeks >= 2) {
    push({ code: 'guideline_met', kind: 'good', basis: 'heuristic', evidence: ['who'], facts: { perWeek: r1(inWin.length / weeks) } })
  }

  const order = { act: 0, watch: 1, info: 2, good: 3 }
  // Within a kind, the furthest below its floor comes first.
  const gap = f => (f.code.startsWith('volume_') ? f.facts.sets / f.facts.floor : 1)
  findings.sort((a, b) => order[a.kind] - order[b.kind] || gap(a) - gap(b))
  return { ...base, ready: true, muscles, findings }
}

// The AI trainer: findings from your own log, the studies behind them, and — when the server
// has a key — a written check-in that is held to those findings.
//
// Order on the sheet is the order of trust. First what the log says (computed, fixed rules),
// then what could be done about it, then the optional model voice, which is labelled as a
// rewording of the first part and carries nothing the first part doesn't.

import { useEffect, useMemo, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { todayISO, fmtNum, fmtDate } from './lib/format.js'
import { Button, TextField } from './components/ui.jsx'
import Icon from './components/Icon.jsx'
import { analyze, applyTrainerAction, revertTrainerAction, MAJOR, WINDOW_DAYS } from './lib/trainer.js'
import { describe, headlineOf, BASIS_LABEL, BASIS_NOTE } from './lib/trainer-text.js'
import { EVIDENCE, doiUrl, pubmedUrl } from './lib/trainer-evidence.js'
import { trainerContext, trainerStatus, askTrainer, MAX_QUESTION, MAX_HISTORY } from './lib/trainer-ai.js'
import { weekSummary } from './lib/trainer-week.js'
import { coachProfileOf, isCoachReady } from './lib/coach-profile.js'
import { coachWizardSheet } from './coach-sheets.jsx'
import { startFlow } from './sheets.jsx'
import { EXIDX } from './lib/exercises.js'
import { exLine } from './lib/history.js'
import { MUSCLE_NAME } from './lib/muscles.js'
import { flexOf, flexWeek } from './lib/flex.js'
import { CLINICIAN } from './lib/clinician.js'
import { nextSession, deloadAdvised, DELOAD_RIR } from './lib/trainer-next.js'
import { replanDue, replanProposals, markReplanned, planAgeWeeks } from './lib/trainer-replan.js'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()

const KIND = {
  act: { icon: 'flag', color: 'var(--orange-t)' },
  watch: { icon: 'info', color: 'var(--yellow-t)' },
  good: { icon: 'checkCircle', color: 'var(--green-t)' },
  info: { icon: 'lightbulb', color: 'var(--blue-t)' }
}

/* ------------------------------- sources ------------------------------- */

function Source({ id }) {
  const e = EVIDENCE[id]
  if (!e) return null
  return <div className="small" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 12px', lineHeight: 1.42 }}>
    <div className="tt" style={{ fontSize: 13 }}>{e.cite}</div>
    <div className="dim" style={{ marginBottom: 6 }}>{e.title}. <i>{e.journal}</i></div>
    <div>{t(e.claim)}</div>
    <div className="dim" style={{ marginTop: 4 }}>{t('Limits:')} {t(e.limit)}</div>
    <div className="row" style={{ gap: 12, marginTop: 6 }}>
      <a href={doiUrl(e)} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--blue-t)' }}>DOI</a>
      <a href={pubmedUrl(e)} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--blue-t)' }}>PubMed</a>
    </div>
  </div>
}

function BasisTag({ basis }) {
  return <span className="tag nocap" title={t(BASIS_NOTE[basis])}>{t(BASIS_LABEL[basis])}</span>
}

/* ------------------------------- one finding ------------------------------- */

function Finding({ f, onApply }) {
  const [open, setOpen] = useState(false)
  const k = KIND[f.kind]
  const { title, body } = describe(f)
  const a = f.action
  return <div className="card" style={{ borderLeft: '3px solid ' + k.color, marginBottom: 10 }}>
    <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
      <Icon name={k.icon} style={{ color: k.color, fontSize: 18, marginTop: 2, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="tt" style={{ fontSize: 16, lineHeight: 1.25 }}>{title}</div>
        <div className="muted small" style={{ marginTop: 5, lineHeight: 1.45 }}>{body}</div>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <BasisTag basis={f.basis} />
          {f.evidence.length > 0 && <button className="small" style={{ background: 'none', border: 0, padding: 0, color: 'var(--blue-t)' }} onClick={() => setOpen(!open)}>
            {open ? t('Hide sources') : t(f.evidence.length === 1 ? 'Source' : 'Sources')}
          </button>}
        </div>
        {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {f.evidence.map(id => <Source key={id} id={id} />)}
          <div className="dim small">{t(BASIS_NOTE[f.basis])}</div>
        </div>}
        {a && <div style={{ marginTop: 10 }}>
          <Button size="sm" variant="primary" icon="plus" onClick={onApply}>
            {t('{0}: {1} → {2} sets', a.exercise, a.from, a.to)}
          </Button>
          <div className="dim small" style={{ marginTop: 5 }}>{t('In {0}. Changes your plan; you can undo it.', a.routine)}</div>
        </div>}
      </div>
    </div>
  </div>
}

/* ------------------------------- balance ------------------------------- */

function Balance({ analysis }) {
  const { range } = analysis
  const rows = analysis.muscles.filter(m => MAJOR.includes(m.slug))
  const top = Math.max(range.ceiling * 1.25, ...rows.map(m => m.weekly))
  return <div className="card">
    <h2>{t('Weekly sets per muscle')}</h2>
    {rows.map(m => {
      const color = m.weekly < range.floor ? 'var(--orange)' : m.weekly > range.ceiling ? 'var(--yellow)' : 'var(--green)'
      return <div key={m.slug} className="row" style={{ gap: 10, marginBottom: 7 }}>
        <div className="small" style={{ width: 86, flex: 'none' }}>{t(m.name)}</div>
        <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--surface-2)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: (range.floor / top * 100) + '%', width: ((range.ceiling - range.floor) / top * 100) + '%', top: 0, bottom: 0, background: 'var(--label-4)' }} />
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.min(100, m.weekly / top * 100) + '%', background: color, borderRadius: 5 }} />
        </div>
        <div className="small" style={{ width: 34, textAlign: 'right', flex: 'none' }}>{fmtNum(m.weekly)}</div>
      </div>
    })}
    <div className="dim small" style={{ marginTop: 8, lineHeight: 1.4 }}>
      {t('The grey band is the range of {0}–{1} sets for your goal. A supporting muscle counts 0.4 of a set, warm-ups are left out.', range.floor, range.ceiling)}
    </div>
  </div>
}

/* ------------------------------- the model voice ------------------------------- */

function Disclosure({ context }) {
  const [open, setOpen] = useState(false)
  return <div style={{ marginTop: 8 }}>
    <button className="small" style={{ background: 'none', border: 0, padding: 0, color: 'var(--blue-t)' }} onClick={() => setOpen(!open)}>
      {open ? t('Hide what is sent') : t('What gets sent')}
    </button>
    {open && <>
      <pre className="small" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 10, margin: '6px 0 0', maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {JSON.stringify(context, null, 1)}
      </pre>
      <div className="dim small" style={{ marginTop: 4 }}>{t('Findings only. Your workouts, weights, notes and profile text are not included.')}</div>
    </>}
  </div>
}

function Voice({ S, analysis }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useState('')
  const [res, setRes] = useState(null)          // only ever the "no model for this profile" notice
  const [thread, setThread] = useState([])      // answered turns: { question, answer }
  const [err, setErr] = useState(null)
  useEffect(() => { trainerStatus().then(setStatus) }, [])

  const context = useMemo(() => trainerContext(S, analysis, question, thread), [S, analysis, question, thread])

  if (!status) return null
  if (!status.enabled) {
    return <div className="dim small" style={{ lineHeight: 1.45, margin: '4px 2px 14px' }}>
      {t('Everything above works without an AI model. To get it written as a short check-in you can ask questions of, the server needs an API key (see the self-hosting guide).')}
    </div>
  }

  const ask = async q => {
    setBusy(true); setErr(null); setRes(null)
    try {
      const out = await askTrainer(trainerContext(S, analysis, q, thread))
      if (out.answer) { setThread(th => [...th, { question: q, answer: out.answer }]); setQuestion('') }
      else setRes(out)
    } catch (e) {
      setErr(e.status === 429 ? t('Daily limit reached. The findings above are still current.')
        : e.fallback ? t('The model’s answer didn’t match your numbers, so it was thrown away. The findings above are what stands.')
          : e.message)
    }
    setBusy(false)
  }

  return <div className="card">
    <h2>{t('Written check-in')}</h2>
    <div className="muted small" style={{ lineHeight: 1.45, marginBottom: 10 }}>
      {t('An AI model rewords the findings above. It can’t add numbers or studies: anything that doesn’t match is rejected.')}
    </div>
    <Button variant="primary" icon="sparkles" disabled={busy} onClick={() => ask('')}>
      {busy ? t('Writing…') : t('Write my check-in')}
    </Button>
    <div className="row" style={{ gap: 8, marginTop: 10 }}>
      <TextField style={{ flex: 1, minWidth: 0 }} value={question} maxLength={MAX_QUESTION}
        placeholder={thread.length ? t('Ask a follow-up…') : t('Or ask about your training…')} onChange={e => setQuestion(e.target.value)} />
      <Button size="sm" disabled={busy || !question.trim()} onClick={() => ask(question)}>{t('Ask')}</Button>
    </div>
    <Disclosure context={context} />
    {err && <div className="small" style={{ color: 'var(--red-t)', marginTop: 10, lineHeight: 1.4 }}>{err}</div>}
    {res && res.local && <div className="small" style={{ marginTop: 10, lineHeight: 1.45 }}>
      {t('AI isn’t used for this profile (age, health mode, or a medical note). The findings above are the whole answer.')}
    </div>}
    {thread.map((turn, i) => <Turn key={i} turn={turn} />)}
    {thread.length > 0 && <div style={{ marginTop: 4 }}>
      <Button size="sm" icon="reset" onClick={() => { setThread([]); setRes(null); setErr(null) }}>{t('New conversation')}</Button>
      {thread.length > MAX_HISTORY && <span className="dim small" style={{ marginLeft: 10 }}>{t('Only the last {0} turns are remembered.', MAX_HISTORY)}</span>}
    </div>}
  </div>
}

/** One turn of the conversation: the question (if there was one) and what came back. */
function Turn({ turn }) {
  const a = turn.answer
  return <div style={{ marginTop: 12 }}>
    {turn.question && <div className="small dim" style={{ lineHeight: 1.4, marginBottom: 6 }}>{t('You asked')}: {turn.question}</div>}
    {a.status === 'outside_scope' && <div className="small" style={{ lineHeight: 1.45 }}>
      {CLINICIAN
        ? t('Your log can’t answer that: it holds training, body weight and food, not a clinical assessment.')
        : t('Your log can’t answer that. For pain, injury, illness, diet or supplements, ask a clinician or a registered dietitian.')}
    </div>}
    {a.status === 'ok' && <>
      <div className="tt" style={{ fontSize: 16, marginBottom: 6 }}>{a.headline}</div>
      {a.paragraphs.map((p, i) => <div key={i} style={{ marginBottom: 10 }}>
        <div className="small" style={{ lineHeight: 1.5 }}>{p.text}</div>
        {p.cites.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {[...new Set(p.cites)].map(id => <Source key={id} id={id} />)}
        </div>}
      </div>)}
    </>}
  </div>
}

/* ------------------------------- the week ------------------------------- */

const signed = (n, unit) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtNum(Math.abs(n)) + (unit ? ' ' + unit : '')

/** The week so far (or last week, early in the week), worked out from the log when Home opens. */
export function WeekCard({ onOpen }) {
  const S = useStore(s => s.S)
  const w = useMemo(() => weekSummary(S), [S.workouts, S.meals, S.bodyweight, S.flex, S.week, S.routines, S.myFoods, S.nutritionGoals, S.coachProfile, S.unit])
  if (!w || (w.sessions === 0 && w.prevSets === 0)) return null
  const names = w.prs.map(id => (EXIDX[id] || {}).n || id)
  const rows = []
  rows.push({
    icon: w.aim && w.sessions >= w.aim ? 'checkCircle' : 'flag',
    text: w.aim ? t('{0} of {1} sessions', w.sessions, w.aim) : t('{0} sessions', w.sessions),
    good: !!(w.aim && w.sessions >= w.aim)
  })
  if (w.sets > 0) rows.push({
    icon: 'chartLine',
    text: w.prevSets > 0 ? t('{0} working sets ({1} the week before)', w.sets, signed(w.sets - w.prevSets)) : t('{0} working sets', w.sets)
  })
  if (names.length) rows.push({ icon: 'trophy', text: t(names.length === 1 ? 'New personal best: {0}' : 'New personal bests: {0}', names.slice(0, 3).join(', ')), good: true })
  if (w.protein) rows.push({ icon: 'lightbulb', text: t('Protein about {0} g a day ({1} g per kg), over {2} logged days', w.protein.avgG, fmtNum(w.protein.gPerKg), w.protein.days) })
  if (w.weightDelta != null) {
    const unit = S.unit === 'lb' ? 'lb' : 'kg'
    const shown = Math.round((unit === 'lb' ? w.weightDelta / 0.45359237 : w.weightDelta) * 10) / 10     // a change can be negative: weightIn refuses those
    rows.push({ icon: 'info', text: t('Body weight {0}', signed(shown, unit)) })
  }

  return <button className="card" style={{ width: '100%', textAlign: 'left' }} onClick={onOpen}>
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{w.which === 'previous' ? t('Last week') : t('Your week')}</h2>
      <span className="dim small">{fmtDate(w.start, true)} – {fmtDate(w.end, true)}</span>
    </div>
    {rows.map((r, i) => <div key={i} className="row small" style={{ gap: 8, padding: '3px 0', alignItems: 'flex-start', color: r.good ? 'var(--green-t)' : undefined }}>
      <Icon name={r.icon} style={{ fontSize: 15, marginTop: 1, flex: 'none' }} />
      <span style={{ lineHeight: 1.4 }}>{r.text}</span>
    </div>)}
  </button>
}

/* ------------------------------- next session ------------------------------- */

const KIND_TAG = {
  up: ['Heavier', 'var(--green-t)'], hold: ['Same again', 'var(--label-2)'], deload: ['Back off', 'var(--orange-t)'],
  lighter: ['Lighter', 'var(--blue-t)'], first: ['Baseline', 'var(--label-2)']
}

function NextSession({ S, analysis }) {
  const advised = deloadAdvised(analysis)
  const [light, setLight] = useState(advised)
  const today = todayISO()
  const session = useMemo(() => nextSession(S, today, { deload: light }),
    [S.workouts, S.routines, S.week, S.dayPlan, S.flex, S.unit, S.active, light, today])
  if (!session || S.active) return null
  const flex = flexOf(S).on ? flexWeek(S, today) : null
  const { routine, items, unit } = session
  const when = flex ? t('Next in your rotation') : session.today ? t('Today') : fmtDate(session.iso, true)

  return <div className="card" style={{ marginBottom: 10 }}>
    <div className="row between" style={{ gap: 10, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0 }}>{t('Next session')}</h2>
        <div className="muted small" style={{ marginTop: 3 }}>{routine.name} · {when}</div>
      </div>
      {flex && <span className="tag nocap">{t('{0} of {1} this week', flex.done, flex.perWeek)}</span>}
    </div>

    <div className="row" style={{ gap: 8, margin: '12px 0 4px' }}>
      <Button size="sm" variant={light ? undefined : 'primary'} onClick={() => setLight(false)}>{t('Normal session')}</Button>
      <Button size="sm" variant={light ? 'primary' : undefined} onClick={() => setLight(true)}>{t('Lighter session')}</Button>
    </div>
    {advised && <div className="small" style={{ lineHeight: 1.45, color: 'var(--orange-t)', marginBottom: 6 }}>
      {t('Your log suggests taking it lighter this time — see the findings below.')}
    </div>}
    {light && <div className="dim small" style={{ lineHeight: 1.45, marginBottom: 6 }}>
      {t('Half the sets at the weight you already handle, stopping with about {0} reps left.', DELOAD_RIR)}
    </div>}

    {items.map(it => {
      const tag = KIND_TAG[it.kind]
      const line = exLine({ id: it.id, sets: it.sets, reps: it.reps, weight: it.weight, sec: it.sec, mode: it.mode }, unit)
      return <div key={it.id} style={{ padding: '9px 0', borderTop: '1px solid var(--sep)' }}>
        <div className="row between" style={{ gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="tt" style={{ fontSize: 15 }}>{EXIDX[it.id] ? EXIDX[it.id].n : it.id}</div>
            <div className="small" style={{ marginTop: 2 }}>{line}</div>
          </div>
          {tag && <span className="tag nocap" style={{ color: tag[1], flex: 'none' }}>{t(tag[0])}</span>}
        </div>
        {it.why && !light && <div className="dim small" style={{ marginTop: 4, lineHeight: 1.4 }}>{t(...it.why)}</div>}
      </div>
    })}

    <div style={{ marginTop: 10 }}>
      <Button variant="primary" icon="play" onClick={() => startFlow(routine.id, { light })}>{t('Start this session')}</Button>
    </div>
    <div className="dim small" style={{ marginTop: 8, lineHeight: 1.4 }}>
      {t('The numbers come from the progression rule set for each exercise; the workout pre-fills the same ones.')}
    </div>
  </div>
}

/* ------------------------------- program review ------------------------------- */

function Proposal({ a, onApply }) {
  const swap = a.type === 'swap'
  return <div style={{ padding: '10px 0', borderTop: '1px solid var(--sep)' }}>
    <div className="tt" style={{ fontSize: 15 }}>
      {swap ? t('{0} → {1}', a.from, a.to) : t('{0}: {1} → {2} sets', a.exercise, a.from, a.to)}
    </div>
    <div className="muted small" style={{ marginTop: 3, lineHeight: 1.4 }}>
      {swap
        ? t('No progress on {0} for {1} weeks ({2} sessions). A similar exercise can get it moving again. In {3}; the weight starts fresh.', a.from, fmtNum(a.weeks), a.sessions, a.routine)
        : t('{0} gets too few sets a week. In {1}.', t(MUSCLE_NAME[a.muscle] || a.muscle || ''), a.routine)}
    </div>
    <div style={{ marginTop: 8 }}><Button size="sm" variant="primary" icon="plus" onClick={onApply}>{t('Apply')}</Button></div>
  </div>
}

function Review({ S, analysis, onApply }) {
  const [open, setOpen] = useState(false)
  const due = replanDue(S, analysis)
  const proposals = useMemo(() => analysis.ready ? replanProposals(S, analysis) : [], [analysis, S.routines, S.week])
  if (!analysis.ready) return null
  const weeks = Math.floor(planAgeWeeks(S))
  const show = open || due
  const reviewed = () => { update(s => markReplanned(s)); ui().toast(t('Marked as reviewed')) }

  if (!show) return <div style={{ marginBottom: 10 }}>
    <Button size="sm" icon="clipboard" onClick={() => setOpen(true)}>{t('Review my program')}</Button>
  </div>

  return <div className="card" style={{ marginBottom: 10, borderLeft: due ? '3px solid var(--blue-t)' : undefined }}>
    <h2 style={{ margin: 0 }}>{t('Program review')}</h2>
    <div className="muted small" style={{ marginTop: 4, lineHeight: 1.45 }}>
      {due
        ? t('It has been about {0} weeks since your program was set up or reviewed. This is what your log suggests changing. Nothing changes until you apply it, and each change can be undone.', weeks)
        : t('What your log suggests changing. Nothing changes until you apply it, and each change can be undone.')}
    </div>
    {proposals.length === 0
      ? <div className="small" style={{ marginTop: 10, lineHeight: 1.45 }}>{t('Nothing to change: your program matches what you actually do.')}</div>
      : <div style={{ marginTop: 6 }}>{proposals.map((a, i) => <Proposal key={a.type + a.routineId + (a.exId || '') + i} a={a} onApply={() => onApply(a)} />)}</div>}
    <div style={{ marginTop: 10 }}>
      <Button size="sm" icon="checkCircle" onClick={reviewed}>{t('Mark as reviewed')}</Button>
    </div>
  </div>
}

/* ------------------------------- the sheet ------------------------------- */

function Trainer({ close }) {
  const S = useStore(s => s.S)
  const analysis = useMemo(() => analyze(S), [S.workouts, S.routines, S.week, S.bodyweight, S.sleep, S.coachProfile, S.unit, S.flex])
  const profile = coachProfileOf(S)
  const [shown, setShown] = useState(5)
  const fresh = S.trainerUndo && S.trainerUndo.at && (Date.now() - new Date(S.trainerUndo.at + 'T00:00:00').getTime()) / 86400000 <= 14
  const undo = fresh && S.trainerUndo.actions && S.trainerUndo.actions.length ? S.trainerUndo : null

  const apply = a => {
    let ok = false
    update(s => {
      ok = applyTrainerAction(s, a)
      if (ok) s.trainerUndo = { at: todayISO(), actions: [...((s.trainerUndo && s.trainerUndo.actions) || []), a] }
    })
    ui().toast(ok ? t('Plan updated') : t('Your plan changed since; open the trainer again'))
  }
  const revert = a => {
    update(s => {
      revertTrainerAction(s, a)
      const left = ((s.trainerUndo && s.trainerUndo.actions) || []).filter(u => !(u.routineId === a.routineId && u.exId === a.exId && u.to === a.to))
      s.trainerUndo = left.length ? { at: todayISO(), actions: left } : null
    })
    ui().toast(t('Plan restored'))
  }
  // Applying changes the plan, which re-runs the analysis and drops the finding that carried
  // the button, so the undo lives in its own list.
  const applied = undo ? undo.actions : []

  const list = analysis.findings
  return <>
    <h3>{t('Your trainer')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.45 }}>
      {analysis.ready
        ? t('From your last {0} days of training. Every number comes from your log by fixed rules, not from a model, and each rule says how firm its basis is.', WINDOW_DAYS)
        : t('Log a few workouts and your trainer will start. It won’t judge before there is something to judge.')}
    </div>

    {!isCoachReady(profile) || !profile.goal
      ? <div className="card" style={{ marginBottom: 12 }}>
        <div className="small" style={{ lineHeight: 1.45, marginBottom: 8 }}>{t('Tell it your goal and what equipment you have, and the ranges it judges against fit you.')}</div>
        <Button size="sm" icon="person" onClick={() => { close(); coachWizardSheet() }}>{t('Set up my training profile')}</Button>
      </div>
      : null}

    <NextSession S={S} analysis={analysis} />
    <Review S={S} analysis={analysis} onApply={apply} />

    {applied.length > 0 && <div className="card" style={{ marginBottom: 10 }}>
      <h2>{t('Changes the trainer made')}</h2>
      {applied.map((a, i) => <div key={i} className="row between" style={{ gap: 10, marginBottom: 6 }}>
        <div className="small">{a.type === 'swap' ? t('{0} → {1}', a.from, a.to) : <>{a.exercise}: {a.from} → {a.to} {t('sets')}</>}</div>
        <Button size="sm" icon="reset" onClick={() => revert(a)}>{t('Undo')}</Button>
      </div>)}
    </div>}

    {list.slice(0, shown).map((f, i) =>
      <Finding key={f.code + (f.facts.muscle || f.facts.exercise || '') + i} f={f} onApply={() => apply(f.action)} />)}
    {list.length > shown && <Button onClick={() => setShown(list.length)}>{t('Show {0} more', list.length - shown)}</Button>}
    {analysis.ready && !list.some(f => f.kind === 'act' || f.kind === 'watch') && <div className="card">
      <div className="tt">{headlineOf(analysis)}</div>
    </div>}

    {analysis.ready && <div style={{ marginTop: 10 }}><Balance analysis={analysis} /></div>}
    <div style={{ marginTop: 10 }}><Voice S={S} analysis={analysis} /></div>

    <div className="dim small" style={{ lineHeight: 1.45, margin: '4px 2px 6px' }}>
      {CLINICIAN
        ? t('General training information from your own log. The clinical judgement stays with you.')
        : t('General training information, not medical advice. If something hurts or you are unwell, see a clinician.')}
    </div>
  </>
}

export const trainerSheet = () => ui().openSheet(close => <Trainer close={close} />)

/** One line for the Home card. */
export function useTrainerHeadline() {
  const S = useStore(s => s.S)
  return useMemo(() => {
    if (!S.workouts || !S.workouts.length) return null
    const a = analyze(S)
    return {
      text: headlineOf(a), review: replanDue(S, a),
      kind: (a.findings.find(f => f.kind === 'act') || a.findings.find(f => f.kind === 'watch') || { kind: a.ready ? 'good' : 'info' }).kind
    }
  }, [S.workouts, S.routines, S.week, S.bodyweight, S.sleep, S.coachProfile, S.unit, S.flex, S.replanAt, S.trainerUndo, S.coachUndo])
}

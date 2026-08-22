// The AI coach, v1: a four-step profile wizard and a copy/paste bridge to a chat.
//
// There is no API key and no server call. The app writes a prompt, the user carries it to
// ChatGPT themselves, and pastes the answer back — which means the prompt is visible, and
// nothing about them leaves this device unless they paste it. That is the whole privacy
// story for this version, and it is why the prompt is shown rather than hidden behind a
// spinner.
//
// The reply lands in the same import sheet a plan from a friend does, so approving an
// AI-written week and approving a shared one are the same gesture, with the same preview.

import { useEffect, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t, getLang } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { todayISO } from './lib/format.js'
import { Button, Segmented, Stepper, Switch } from './components/ui.jsx'
import Icon from './components/Icon.jsx'
import { lastBW } from './lib/history.js'
import {
  coachProfileOf, cleanCoachProfile, isCoachReady, medicalFlag,
  LEVELS, GOALS, LEVEL_NAME, GOAL_NAME, DAYS_RANGE, MINUTES_RANGE
} from './lib/coach-profile.js'
import { EQ_PRESETS, ALL_EQUIPMENT, eqOfPreset } from './lib/coach-catalog.js'
import { buildPrompt, buildRepairPrompt } from './lib/coach-prompt.js'
import { parseCoachReply } from './lib/coach-parse.js'
import { validateCoachPlan, problemText } from './lib/coach-validate.js'
import { coachStatus, generatePlan } from './lib/coach-api.js'
import { parsePlan, mergePlan } from './lib/plan-share.js'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/* ============================ the wizard ============================ */

const STEPS = 4

function StepDots({ step }) {
  return <div className="row" style={{ gap: 6, justifyContent: 'center', marginBottom: 14 }}>
    {Array.from({ length: STEPS }, (_, i) =>
      <span key={i} style={{
        width: i === step ? 18 : 6, height: 6, borderRadius: 3,
        background: i === step ? 'var(--acc)' : 'var(--sep)', transition: 'width .2s'
      }} />)}
  </div>
}

function Field({ label, children }) {
  return <div style={{ marginBottom: 14 }}>
    <div className="small dim" style={{ marginBottom: 6 }}>{label}</div>
    {children}
  </div>
}

function CoachWizard({ close }) {
  const st = useStore(s => s.S)
  const [p, setP] = useState(() => coachProfileOf(st))
  const [step, setStep] = useState(0)
  const [custom, setCustom] = useState(false)
  const set = (k, v) => setP(o => ({ ...o, [k]: v }))

  // Saved on every step, so an abandoned wizard is not wasted typing.
  const persist = next => {
    const clean = cleanCoachProfile(next)
    update(s => { s.coachProfile = { ...clean, updated: todayISO() } })
    return clean
  }

  const presetKey = Object.keys(EQ_PRESETS).find(k => {
    const a = [...eqOfPreset(k)].sort().join('|')
    return a === [...(p.equipment || [])].sort().join('|')
  })

  const next = () => {
    persist(p)
    if (step < STEPS - 1) { setStep(step + 1); return }
    const clean = persist(p)
    close()
    coachBridgeSheet(clean)
  }

  const canAdvance = step !== 2 || isCoachReady(p)

  return <>
    <h3>{t('Let AI build my program')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('A few questions, then you paste them into ChatGPT and paste the plan back. Nothing is sent from here on its own.')}
    </div>
    <StepDots step={step} />

    {step === 0 && <>
      <Field label={t('Age')}>
        <Stepper value={p.age ?? 30} step={1} decimal={false} onChange={v => set('age', v)} />
      </Field>
      <Field label={t('Sex')}>
        <Segmented value={p.sex || 'male'} onChange={v => set('sex', v)}
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} />
      </Field>
      <Field label={t('Height (cm)')}>
        <Stepper value={p.heightCm ?? 175} step={1} decimal={false} onChange={v => set('heightCm', v)} />
      </Field>
    </>}

    {step === 1 && <>
      <Field label={t('Main goal')}>
        <div className="chips">
          {GOALS.map(g => <button key={g} className={'chip nocap' + (p.goal === g ? ' on' : '')}
            onClick={() => set('goal', g)}>{t(GOAL_NAME[g])}</button>)}
        </div>
      </Field>
      <Field label={t('Experience')}>
        <div className="chips">
          {LEVELS.map(l => <button key={l} className={'chip nocap' + (p.level === l ? ' on' : '')}
            onClick={() => set('level', l)}>{t(LEVEL_NAME[l])}</button>)}
        </div>
      </Field>
    </>}

    {step === 2 && <>
      <Field label={t('Sessions per week')}>
        <Stepper value={p.days} step={1} decimal={false}
          onChange={v => set('days', Math.min(DAYS_RANGE[1], Math.max(DAYS_RANGE[0], v)))} />
      </Field>
      <Field label={t('Minutes per session')}>
        <Stepper value={p.minutes} step={5} decimal={false}
          onChange={v => set('minutes', Math.min(MINUTES_RANGE[1], Math.max(MINUTES_RANGE[0], v)))} />
      </Field>
      <Field label={t('Equipment')}>
        <div className="chips">
          {Object.entries(EQ_PRESETS).map(([k, preset]) =>
            <button key={k} className={'chip nocap' + (presetKey === k ? ' on' : '')}
              onClick={() => { setCustom(false); set('equipment', eqOfPreset(k)) }}>{t(preset.name)}</button>)}
          <button className={'chip nocap' + (custom || (!presetKey && p.equipment.length) ? ' on' : '')}
            onClick={() => setCustom(c => !c)}>{t('Pick my own')}</button>
        </div>
        {(custom || (!presetKey && p.equipment.length > 0)) && <div className="chips" style={{ marginTop: 10 }}>
          {ALL_EQUIPMENT.map(e => <button key={e} className={'chip' + (p.equipment.includes(e) ? ' on' : '')}
            onClick={() => set('equipment', p.equipment.includes(e)
              ? p.equipment.filter(x => x !== e)
              : [...p.equipment, e])}>{t(e)}</button>)}
        </div>}
        {!isCoachReady(p) && <div className="small dim" style={{ marginTop: 8 }}>
          {t('Pick your equipment — it decides which exercises the plan may use.')}
        </div>}
      </Field>
    </>}

    {step === 3 && <>
      <Field label={t('Injuries or limitations')}>
        <textarea className="input" rows={3} maxLength={500}
          placeholder={t('Anything that hurts, or that you have been told to avoid')}
          value={p.limits} onChange={e => set('limits', e.target.value)} />
      </Field>
      <Field label={t('Exercises you would rather avoid')}>
        <textarea className="input" rows={2} maxLength={500}
          placeholder={t('Optional — movements you dislike or cannot do')}
          value={p.dislikes} onChange={e => set('dislikes', e.target.value)} />
      </Field>
      <div className="small dim" style={{ lineHeight: 1.4, marginBottom: 4 }}>
        {t('This is a training assistant, not medical advice. For an injury or a diagnosis, ask someone qualified first.')}
      </div>
    </>}

    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={next} disabled={!canAdvance}>
      {step < STEPS - 1 ? t('Next') : t('Build my prompt')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim"
      onClick={() => (step === 0 ? close() : setStep(step - 1))}>
      {step === 0 ? t('Cancel') : t('Prev')}
    </Button>
  </>
}

export const coachWizardSheet = () => ui().openSheet(close => <CoachWizard close={close} />)

/* ============================ the copy/paste bridge ============================ */

const copy = async text => {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('Prompt copied — paste it into ChatGPT'))
  } catch (e) {
    // Clipboard is blocked in some embedded browsers; the textarea below is the fallback.
    toast(t('Could not copy — select the text and copy it yourself'))
  }
}

// What the sheet says while the model is working. These calls take tens of seconds with
// reasoning on, and a button that just sits there dimmed reads as broken.
const STEP_TEXT = {
  asking: 'Writing your program…',
  checking: 'Checking it over…',
  fixing: 'Fixing what did not add up…'
}

function CoachBridge({ profile, close }) {
  const st = useStore(s => s.S)
  const [reply, setReply] = useState('')
  const [problems, setProblems] = useState(null)   // { errors, warnings, data } once checked
  const [direct, setDirect] = useState(null)       // server status, null while unknown
  const [busy, setBusy] = useState(null)           // current step while generating
  const flagged = medicalFlag(profile.limits)

  const bw = lastBW(st)
  const prompt = buildPrompt(profile, { lang: getLang(), unit: st.unit, bodyweight: bw ? bw.w : null })

  // Does this instance hold a key? Guests and keyless instances just get the paste flow.
  useEffect(() => {
    let live = true
    coachStatus().then(s => { if (live) setDirect(s) })
    return () => { live = false }
  }, [])

  const runDirect = async () => {
    setProblems(null)
    try {
      const res = await generatePlan(profile, {
        lang: getLang(), unit: st.unit, bodyweight: bw ? bw.w : null, onStep: setBusy
      })
      // Keep the remaining-today count honest: a stale number is worse than none.
      if (res.left != null) setDirect(d => ({ ...d, left: res.left }))
      if (res.errors.length || res.warnings.length) { setProblems({ ...res, data: res.data }); return }
      hand(res.data)
    } catch (e) {
      toast(t(e.message))
    } finally { setBusy(null) }
  }

  const check = () => {
    let data
    try { data = parseCoachReply(reply) } catch (e) { toast(t(e.message)); return }
    const res = validateCoachPlan(data, profile)
    if (res.ok && !res.warnings.length) { hand(data); return }
    setProblems({ ...res, data })
  }

  // Straight into the same preview a shared plan gets.
  const hand = data => {
    let bundle
    try { bundle = parsePlan(data) } catch (e) { toast(t('Import failed: {0}', e.message)); return }
    close()
    coachApplySheet(bundle)
  }

  if (flagged) return <>
    <h3>{t('Better to ask a person for this one')}</h3>
    <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.5 }}>
      {t('What you wrote under limitations is something a physiotherapist or doctor should program around, not an app. Build the plan with them — openGym will happily track it.')}
    </div>
    <Button variant="primary" onClick={() => { close(); coachWizardSheet() }}>{t('Edit my answers')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>

  // With a key on the server this is one button; the paste route stays underneath, because
  // it costs nothing to keep and it is the only route when the quota runs out.
  if (direct && direct.enabled) return <>
    <h3>{t('Build my program')}</h3>
    <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.45 }}>
      {t('Your answers go to the model your server is configured with, and the plan comes back checked. Nothing else about you is sent.')}
    </div>
    <Button variant="primary" icon="sparkles" onClick={runDirect} disabled={!!busy}>
      {busy ? t(STEP_TEXT[busy]) : t('Create my program')}
    </Button>
    {busy && <div className="dim small" style={{ margin: '8px 2px 0', lineHeight: 1.4 }}>
      {t('This takes up to a minute. Leave the screen open.')}
    </div>}
    {direct.left != null && !busy && <div className="dim small" style={{ margin: '8px 2px 0' }}>
      {t('{0} of {1} left today', direct.left, direct.limit)}
    </div>}

    {problems && <ProblemList res={problems} onUse={() => hand(problems.data)} onRetry={runDirect} />}

    <h4 className="sec">{t('Or do it yourself')}</h4>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.4 }}>
      {t('Copy the prompt into any chat and paste the answer back. Works when the daily limit is reached.')}
    </div>
    <Button icon="clipboard" onClick={() => copy(prompt)}>{t('Copy prompt')}</Button>
    <div style={{ height: 10 }} />
    <textarea className="input" rows={3} value={reply} onChange={e => setReply(e.target.value)}
      placeholder={t('The whole reply is fine — code fences and all')} />
    <div style={{ height: 10 }} />
    <Button onClick={check} disabled={!reply.trim()}>{t('Read the plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>

  return <>
    <h3>{t('Copy this into ChatGPT')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Everything that will be sent is below — read it if you like. Nothing leaves this device until you paste it somewhere.')}
    </div>
    <textarea className="input" rows={7} readOnly value={prompt}
      onFocus={e => e.target.select()} style={{ fontSize: 12, lineHeight: 1.45 }} />
    <div style={{ height: 10 }} />
    <Button variant="primary" icon="clipboard" onClick={() => copy(prompt)}>{t('Copy prompt')}</Button>

    <h4 className="sec">{t('Paste the answer here')}</h4>
    <textarea className="input" rows={5} value={reply} onChange={e => setReply(e.target.value)}
      placeholder={t('The whole reply is fine — code fences and all')} />
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={check} disabled={!reply.trim()}>{t('Read the plan')}</Button>

    {problems && <ProblemList res={problems} onUse={() => hand(problems.data)} />}

    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/**
 * What the validator found. Errors block and offer a repair prompt to paste back into the
 * same chat — the fix loop still works without an API, it just goes through the user.
 * Warnings are shown and the plan can be used anyway.
 */
function ProblemList({ res, onUse, onRetry }) {
  const { errors, warnings } = res
  const all = [...errors, ...warnings].map(problemText)
  // Muscle and equipment names arrive as their English source strings, which are also
  // their i18n keys — so translate the arguments too. Anything that is not a key comes
  // back unchanged, which is what should happen to a routine name the model wrote.
  const say = p => t(p.key, ...p.args.map(a => (typeof a === 'string' ? t(a) : a)))
  return <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--sep)' }}>
    <h4 className="sec" style={{ marginTop: 0 }}>
      {errors.length ? t('This plan needs a fix') : t('Worth a look')}
    </h4>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
      {errors.map((p, i) => <div key={'e' + i} className="small row" style={{ gap: 7, alignItems: 'flex-start', color: 'var(--red)' }}>
        <Icon name="xmark" style={{ fontSize: 13, marginTop: 2, flex: 'none' }} />
        <span style={{ lineHeight: 1.4 }}>{say(p)}</span>
      </div>)}
      {warnings.map((p, i) => <div key={'w' + i} className="small row" style={{ gap: 7, alignItems: 'flex-start', color: 'var(--yellow)' }}>
        <Icon name="info" style={{ fontSize: 13, marginTop: 2, flex: 'none' }} />
        <span style={{ lineHeight: 1.4 }}>{say(p)}</span>
      </div>)}
    </div>
    {/* The paste flow needs the user to carry the fix across; the direct one has already
        tried twice on its own, so offering a clipboard round there would just confuse. */}
    {onRetry ? (
      <Button variant="primary" icon="reset" onClick={onRetry}>{t('Try again')}</Button>
    ) : <>
      <Button variant={errors.length ? 'primary' : 'tinted'} icon="clipboard" onClick={() => copy(buildRepairPrompt(all))}>
        {t('Copy a fix request')}
      </Button>
      <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>
        {t('Paste it into the same chat, then paste the new answer above.')}
      </div>
    </>}
    {!errors.length && <>
      <div style={{ height: 10 }} />
      <Button onClick={onUse}>{t('Use it anyway')}</Button>
    </>}
  </div>
}

export const coachBridgeSheet = profile => ui().openSheet(close => <CoachBridge profile={profile} close={close} />)

/* ============================ apply, with an undo ============================ */

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6]

function CoachApply({ bundle, close }) {
  const [schedule, setSchedule] = useState(true)
  const apply = () => {
    update(s => {
      // Snapshot first: an AI-written week you cannot back out of is a scary thing to try.
      s.coachUndo = { at: todayISO(), routines: JSON.parse(JSON.stringify(s.routines)), week: { ...s.week } }
      mergePlan(s, bundle, { schedule })
    })
    close()
    toast(t('Your plan is ready'))
    nav('/plan')
  }
  return <>
    <h3>{t('Your new plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t(bundle.routineCount === 1 ? '{0} routine' : '{0} routines', bundle.routineCount)}
      {' · ' + t('{0} exercises', bundle.exerciseCount)}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('No weights yet — the first session of each exercise is where you find them, and the app remembers from there.')}
    </div>
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div>
        <div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div>
        <div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div>
      </div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    <Button variant="primary" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const coachApplySheet = bundle => ui().openSheet(close => <CoachApply bundle={bundle} close={close} />)

/** Whether an AI plan is still reversible, and how to reverse it. */
export const coachUndoAvailable = st => {
  const u = st && st.coachUndo
  if (!u || !u.at) return false
  const days = (Date.now() - new Date(u.at + 'T00:00:00').getTime()) / 86400000
  return days <= 7
}

export function undoCoachPlan() {
  const u = S().coachUndo
  if (!u) return
  update(s => {
    s.routines = u.routines
    s.week = u.week
    WEEK_DAYS.forEach(d => { if (!u.week[d]) delete s.week[d] })
    s.coachUndo = null
  })
  toast(t('Plan restored'))
  nav('/plan')
}

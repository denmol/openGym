// The level test, as a sheet: a few questions, three bodyweight checks and three optional
// loaded lifts, then what it means. Everything can be skipped; a result needs only the two
// questions about training history. See lib/calibration.js for how the answers are read.

import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { todayISO } from './lib/format.js'
import { lastBW } from './lib/history.js'
import { weightKgOf } from './lib/nutrition-goals.js'
import { Button, Segmented, Stepper } from './components/ui.jsx'
import { coachProfileOf, cleanCoachProfile, medicalFlag, LEVEL_NAME } from './lib/coach-profile.js'
import {
  BODYWEIGHT_TESTS, LIFTS, AREA_NAME, MONTHS_CHOICES, RECENT_CHOICES, RETEST_WEEKS, TEST_REPS, TEST_RIR,
  calibrate, seedWeights
} from './lib/calibration.js'

const useUi = () => useUI.getState()
const toast = m => useUi().toast(m)
const update = (...a) => useStore.getState().update(...a)

const EQUIPMENT = ['barbell', 'dumbbell', 'machine']
const EQUIPMENT_NAME = { barbell: 'Barbell', dumbbell: 'Dumbbell (each hand)', machine: 'Machine' }
const BW_HELP = {
  pushups: 'Hands under your shoulders, body in a straight line, chest to about a fist from the floor. Count clean reps until your form breaks down or you reach 60. From your knees is fine: it counts half.',
  squats: 'Feet shoulder-width apart, thighs at least parallel to the floor, standing tall each rep. Count clean reps in 60 seconds at a steady pace. Stop if it hurts.',
  plank: 'Forearms on the floor, body in a straight line from head to heels. Hold until your hips sag or you reach 3 minutes.'
}
const LIFT_HELP = 'Warm up with a few lighter sets first. Then pick the weight you could lift 8 clean times with about 2 reps left in the tank, do one set of 8 and stop. Never go to failure. Skip any lift you are unsure about.'
const STEPS = ['intro', 'history', 'bodyweight', 'lifts', 'result']

/** Open the level test. `onApply(result)` replaces saving the profile, for callers that hold their own copy of it. */
export const calibrationSheet = (opts = {}) => useUi().openSheet(close => <LevelTest close={close} {...opts} />)

function Choices({ options, value, onChange }) {
  return <div className="chips">
    {options.map(o => <button key={o.v} className={'chip nocap' + (value === o.v ? ' on' : '')} onClick={() => onChange(o.v)}>{t(o.label)}</button>)}
  </div>
}

function Block({ title, help, skipped, onSkip, children }) {
  return <div className="card" style={{ marginBottom: 10, opacity: skipped ? 0.55 : 1 }}>
    <div className="row between" style={{ gap: 8 }}>
      <div className="tt">{title}</div>
      <Button size="sm" variant="ghost" onClick={onSkip}>{skipped ? t('Add my result') : t('Skip')}</Button>
    </div>
    <div className="small dim" style={{ lineHeight: 1.45, margin: '6px 0 10px' }}>{help}</div>
    {!skipped && children}
  </div>
}

function LevelTest({ close, onApply }) {
  const S = useStore(s => s.S)
  const profile = coachProfileOf(S)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const bwKg = weightKgOf(lastBW(S))
  const limited = !!(medicalFlag(profile.limits) || medicalFlag(profile.dislikes))
  const minor = profile.age != null && profile.age < 18
  const physical = !limited && !minor
  const [step, setStep] = useState(0)
  const [months, setMonths] = useState(null)
  const [recent, setRecent] = useState(null)
  const [bw, setBw] = useState({ pushups: { reps: 10, variant: 'full', off: true }, squats: { reps: 25, off: true }, plank: { reps: 40, off: true } })
  const [lifts, setLifts] = useState(() => Object.fromEntries(Object.keys(LIFTS).map(id => [id, { w: unit === 'lb' ? 95 : 40, equipment: profile.equipment.includes('barbell') || !profile.equipment.length ? 'barbell' : profile.equipment.includes('dumbbell') ? 'dumbbell' : 'machine', off: true }])))
  const setB = (id, patch) => setBw(o => ({ ...o, [id]: { ...o[id], ...patch } }))
  const setL = (id, patch) => setLifts(o => ({ ...o, [id]: { ...o[id], ...patch } }))

  const answers = () => ({
    months, recent,
    ...Object.fromEntries(Object.entries(bw).filter(([, x]) => !x.off).map(([id, x]) => [id, { reps: x.reps, variant: x.variant }])),
    lifts: Object.fromEntries(Object.entries(lifts).filter(([, x]) => !x.off).map(([id, x]) => [id, { w: x.w, equipment: x.equipment }]))
  })
  const result = step === 4 ? calibrate(answers(), { sex: profile.sex, age: profile.age, bodyweightKg: bwKg, unit }) : null
  const stepName = STEPS[step]
  const go = n => setStep(n)
  const nextFromHistory = () => { if (months == null || recent == null) { toast(t('Answer both questions to continue')); return } go(physical ? 2 : 4) }

  const apply = () => {
    const cal = { ...result, date: todayISO() }
    update(s => {
      const seeds = seedWeights(cal, s.exWeights || {}, todayISO())
      s.exWeights = { ...(s.exWeights || {}), ...seeds }
      if (!onApply) s.coachProfile = { ...cleanCoachProfile({ ...coachProfileOf(s), level: cal.level, calibration: cal }), updated: todayISO() }
    })
    if (onApply) onApply(cal)
    close()
    toast(t('Level test saved'))
  }

  return <>
    <h3>{t('Level test')}</h3>

    {stepName === 'intro' && <>
      <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
        {t('About five minutes. It gives your trainer a starting point, so the first advice fits you before there is a log to read. You can skip anything.')}
      </div>
      <div className="card small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
        {limited
          ? t('You have noted a limitation, so only the questions are asked. Ask a clinician before testing yourself.')
          : minor
            ? t('The physical tests are for adults. You can answer the questions.')
            : t('Stop at once if anything hurts or you feel dizzy or unwell. Nothing here asks you to go to your limit. If you have a health condition or an injury, answer only the questions or ask a clinician first.')}
      </div>
      <Button variant="primary" onClick={() => go(1)}>{t('Start')}</Button>
    </>}

    {stepName === 'history' && <>
      <div className="small dim" style={{ marginBottom: 6 }}>{t('How long have you trained with weights on a regular basis?')}</div>
      <Choices options={MONTHS_CHOICES} value={months} onChange={setMonths} />
      <div className="small dim" style={{ margin: '14px 0 6px' }}>{t('Over the last three months, how often did you train?')}</div>
      <Choices options={RECENT_CHOICES} value={recent} onChange={setRecent} />
      <div style={{ height: 14 }} />
      <Button variant="primary" onClick={nextFromHistory}>{physical ? t('Next') : t('See my result')}</Button>
    </>}

    {stepName === 'bodyweight' && <>
      <div className="muted small" style={{ lineHeight: 1.45, marginBottom: 10 }}>{t('Do the ones you want. Each takes about a minute; rest between them.')}</div>
      {Object.entries(BODYWEIGHT_TESTS).map(([id, def]) => <Block key={id} title={t(def.name)} help={t(BW_HELP[id])}
        skipped={bw[id].off} onSkip={() => setB(id, { off: !bw[id].off })}>
        {id === 'pushups' && <Segmented value={bw.pushups.variant} onChange={v => setB('pushups', { variant: v })}
          options={[{ value: 'full', label: t('Full') }, { value: 'knee', label: t('From knees') }]} />}
        <div style={{ height: id === 'pushups' ? 10 : 0 }} />
        <Stepper value={bw[id].reps} step={id === 'plank' ? 5 : 1} decimal={false}
          onChange={v => setB(id, { reps: Math.max(0, Math.min(def.max, v)) })} />
      </Block>)}
      <Button variant="primary" onClick={() => go(3)}>{t('Next')}</Button>
    </>}

    {stepName === 'lifts' && <>
      <div className="muted small" style={{ lineHeight: 1.45, marginBottom: 10 }}>{t(LIFT_HELP)}</div>
      {Object.entries(LIFTS).map(([id, def]) => <Block key={id} title={t(def.name)}
        help={t('One set of {0}, about {1} left in the tank.', TEST_REPS, TEST_RIR)} skipped={lifts[id].off} onSkip={() => setL(id, { off: !lifts[id].off })}>
        <Segmented value={lifts[id].equipment} onChange={v => setL(id, { equipment: v })}
          options={EQUIPMENT.map(e => ({ value: e, label: t(EQUIPMENT_NAME[e]) }))} />
        <div style={{ height: 10 }} />
        <Stepper value={lifts[id].w} step={unit === 'lb' ? 5 : 2.5} unit={unit} onChange={v => setL(id, { w: Math.max(0, v) })} />
      </Block>)}
      {!bwKg && <div className="small dim" style={{ marginBottom: 10 }}>{t('Log your body weight to also get a rating for the barbell lifts. You still get starting weights.')}</div>}
      <Button variant="primary" onClick={() => go(4)}>{t('See my result')}</Button>
    </>}

    {stepName === 'result' && result && <>
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="small dim">{t('Your level')}</div>
        <div className="big" style={{ margin: '2px 0 6px' }}>{t(LEVEL_NAME[result.level])}</div>
        <div className="small" style={{ lineHeight: 1.5 }}>
          {t(result.confidence === 'high' ? 'Based on your history and several tests.' : result.confidence === 'medium' ? 'Based on your history and some tests.' : 'Based mostly on your answers about training history. Add a test or two for a firmer result.')}
        </div>
        {result.strong && <div className="small" style={{ marginTop: 6 }}>{t('Strongest area: {0}', t(AREA_NAME[result.strong]))}</div>}
        {result.weak && <div className="small">{t('Room to build: {0}', t(AREA_NAME[result.weak]))}</div>}
      </div>
      {Object.entries(result.lifts).filter(([, x]) => x.start != null).length > 0 && <div className="card" style={{ marginBottom: 10 }}>
        <div className="tt" style={{ marginBottom: 4 }}>{t('Suggested first weights')}</div>
        {Object.entries(result.lifts).filter(([, x]) => x.start != null).map(([id, x]) =>
          <div key={id} className="row between small"><span>{t(LIFTS[id].name)}</span><b>{x.start} {unit}</b></div>)}
        <div className="small dim" style={{ marginTop: 6 }}>{t('A little under what you tested, so the first sessions leave room. They are used where you have no working weight yet.')}</div>
      </div>}
      <div className="small dim" style={{ lineHeight: 1.45, marginBottom: 12 }}>
        {t('A rule of thumb from your own answers, not a measure of your limits. Take the test again in about {0} weeks.', RETEST_WEEKS)}
      </div>
      <Button variant="primary" onClick={apply}>{t('Use this result')}</Button>
      <div style={{ height: 8 }} />
      <Button onClick={() => go(1)}>{t('Change my answers')}</Button>
    </>}

    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

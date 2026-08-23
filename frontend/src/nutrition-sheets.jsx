// Personal nutrition goals.
//
// Numbers here have two sources only: measurements already in the profile and values the
// person types. A resting-energy estimate is shown as an estimate and never copied into a
// daily intake target. Illness and medication tighten that boundary rather than changing a
// formula behind the person's back.

import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { fmtNum, todayISO } from './lib/format.js'
import { lastBW } from './lib/history.js'
import { coachProfileOf, cleanCoachProfile } from './lib/coach-profile.js'
import { diabetesOn } from './lib/diabetes.js'
import { NUTRIENT_NAME, NUTRIENT_UNIT } from './lib/foods.js'
import {
  NNR_REFERENCE, NUTRIENT_TARGETS, bmrEstimate,
  cleanNutritionProfile, needsClinicianTargets, weightKgOf
} from './lib/nutrition-goals.js'
import { askNutrition, nutritionAssistContext } from './lib/nutrition-assist.js'
import { Button, NumberField, Switch } from './components/ui.jsx'
import Icon from './components/Icon.jsx'

const GOAL_NAME = {
  maintain: 'Maintain weight', lose: 'Lose weight', muscle: 'Build muscle', health: 'General health'
}
const GOAL_NOTE = {
  maintain: 'Weight and logged intake over time are more useful than a one-off formula.',
  lose: 'No automatic calorie deficit is created. Set a target yourself or with your care team.',
  muscle: 'No automatic calorie surplus or protein target is created. Set values you can verify and change.',
  health: 'Use the Nordic reference ranges as context, then set only the targets that help you.'
}
const ASSIST_ERROR = {
  'no api key configured': 'Nutrition explanation is not configured on this server.',
  'daily limit reached': 'The daily limit for AI explanations has been reached.',
  'model did not return json': 'The model did not return a usable explanation.',
  'health context changed': 'Your health settings changed. Close and open the explanation again.',
  'model returned an invalid explanation': 'model returned an invalid explanation',
  'the model took too long': 'the model took too long'
}

const update = (...args) => useStore.getState().update(...args)
const toast = message => useUI.getState().toast(message)

function GoalsSheet({ close }) {
  const S = useStore(s => s.S)
  const stored = cleanNutritionProfile(S.nutritionGoals)
  const person = coachProfileOf(S)
  const [goal, setGoal] = useState(stored.goal)
  const [age, setAge] = useState(person.age)
  const [heightCm, setHeight] = useState(person.heightCm)
  const [sex, setSex] = useState(person.sex)
  const [condition, setCondition] = useState(stored.condition)
  const [medication, setMedication] = useState(stored.medication)
  const [targets, setTargets] = useState(stored.targets)

  const bw = lastBW(S)
  const weightKg = weightKgOf(bw)
  const basal = bmrEstimate({ sex, age, heightCm, weightKg })
  const profile = cleanNutritionProfile({ goal, targets, condition, medication })
  const clinician = needsClinicianTargets(profile, { diabetes: diabetesOn(S) }) || (Number(age) > 0 && Number(age) < 18)

  const setTarget = (key, value) => setTargets(old => ({ ...old, [key]: value }))
  const save = () => {
    if (!goal) { toast(t('Choose a nutrition goal.')); return }
    update(state => {
      state.coachProfile = cleanCoachProfile({
        ...coachProfileOf(state), age, heightCm, sex, updated: todayISO()
      })
      state.nutritionGoals = { ...profile, updated: todayISO() }
    })
    close()
    toast(t('Nutrition goals saved'))
  }

  return <>
    <h3>{t('Nutrition goals')}</h3>

    <h4 className="sec">{t('What do you want to work toward?')}</h4>
    <div className="ngoal-grid">
      {Object.entries(GOAL_NAME).map(([id, label]) => <button key={id}
        className={'ngoal' + (goal === id ? ' on' : '')}
        aria-pressed={goal === id} onClick={() => setGoal(id)}>
        {t(label)}
      </button>)}
    </div>
    {goal && <div className="dim small" style={{ marginTop: 9, lineHeight: 1.45 }}>{t(GOAL_NOTE[goal])}</div>}

    <h4 className="sec">{t('Individual information')}</h4>
    <div className="nprofile-grid">
      <label><span>{t('Age')}</span><NumberField className="input" value={age} nullable decimal={false}
        aria-label={t('Age')} onChange={setAge} /></label>
      <label><span>{t('Height')}</span><span className="nwith-unit"><NumberField className="input" value={heightCm} nullable decimal={false}
        aria-label={t('Height in cm')} onChange={setHeight} /><i>cm</i></span></label>
    </div>
    <div className="nsex" role="group" aria-label={t('Sex used by the BMR formula')}>
      {['female', 'male'].map(value => <button key={value} className={sex === value ? 'on' : ''}
        aria-pressed={sex === value} onClick={() => setSex(value)}>{t(value === 'female' ? 'Female' : 'Male')}</button>)}
    </div>

    <div className="nbmr">
      <span className="nbmr-icon"><Icon name="flame" /></span>
      <div className="grow">
        <div className="small dim">{t('Estimated BMR')}</div>
        <div className="nbmr-value">{basal == null ? '—' : t('≈ {0} kcal/day', fmtNum(basal))}</div>
        <div className="dim small">{basal == null
          ? t(bw && !bw.u
            ? 'Log a new weight so its unit is known before BMR is estimated.'
            : 'Add adult age, sex, height and a logged weight to show the estimate.')
          : t('BMR is an estimate of energy at rest, not a daily calorie target.')}</div>
        {bw?.u && <div className="dim small" style={{ marginTop: 4 }}>
          {t('Latest weight: {0} {1} on {2}', fmtNum(bw.w), bw.u, bw.d)}
        </div>}
      </div>
    </div>

    <h4 className="sec">{t('Health boundary')}</h4>
    <div className="sect-b">
      <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Illness affects my diet')}</span></span>
        <Switch checked={condition} aria-label={t('Illness affects my diet')} onChange={setCondition} /></div>
      <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Medication affects my diet')}</span></span>
        <Switch checked={medication} aria-label={t('Medication affects my diet')} onChange={setMedication} /></div>
    </div>
    {clinician && <div className="nmedical" role="note">
      <Icon name="shield" />
      <div><strong>{t('Targets need review')}</strong><br />
        <span>{t('Dagsnav will not calculate nutrition targets for anyone under 18 or from diabetes, illness or medication. Enter values agreed with your care team.')}</span></div>
    </div>}

    <h4 className="sec">{t('Daily targets')}</h4>
    <div className="dim small" style={{ marginBottom: 6 }}>{t('Leave blank to track without a target.')}</div>
    <div className="ntargets">
      {NUTRIENT_TARGETS.map(key => <label key={key}>
        <span>{t(NUTRIENT_NAME[key])}</span>
        <span className="nwith-unit"><NumberField className="input" value={targets[key]} nullable
          aria-label={t('Daily target for {0}', t(NUTRIENT_NAME[key]))}
          onChange={value => setTarget(key, value)} /><i>{NUTRIENT_UNIT[key]}</i></span>
      </label>)}
    </div>

    <details className="nreference">
      <summary>{t('Reference for healthy adults')}</summary>
      <div className="dim small">
        {t('Carbohydrate {0} E%, protein {1} E%, fat {2} E%, fibre at least {3}. These are population ranges, not personal treatment targets.',
          `${NNR_REFERENCE.ranges.carb.min}–${NNR_REFERENCE.ranges.carb.max}`,
          `${NNR_REFERENCE.ranges.prot.min}–${NNR_REFERENCE.ranges.prot.max}`,
          `${NNR_REFERENCE.ranges.fat.min}–${NNR_REFERENCE.ranges.fat.max}`,
          `${NNR_REFERENCE.ranges.fib.min} ${NNR_REFERENCE.ranges.fib.unit}`)}
        {' '}<a href="https://pub.norden.org/nord2023-003/recommendations.html" target="_blank" rel="noopener">NNR 2023</a>
      </div>
    </details>

    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save nutrition goals')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const nutritionGoalsSheet = () =>
  useUI.getState().openSheet(close => <GoalsSheet close={close} />)

function AssistSheet({ date, totals, close }) {
  const S = useStore(s => s.S)
  const context = nutritionAssistContext(S, totals, date)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [local, setLocal] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    setBusy(true); setError('')
    try {
      const result = await askNutrition(context)
      setAnswer(result.answer); setLocal(result.local === true)
    }
    catch (e) { setError(t(ASSIST_ERROR[e.message] || 'Could not get an explanation')) }
    setBusy(false)
  }

  if (answer) return <>
    <h3>{t(local ? 'Care-team notes' : 'AI explanation')}</h3>
    {answer.status === 'clinician_review' && <div className="nmedical" role="note">
      <Icon name="shield" /><div><strong>{t('For review with your care team')}</strong><br />
        <span>{t(local ? 'No AI was used and no nutrition target was created or changed.' : 'The AI has not created or changed any nutrition target.')}</span></div>
    </div>}
    <p style={{ lineHeight: 1.5 }}>{answer.summary}</p>
    {answer.observations.length > 0 && <>
      <h4 className="sec">{t('What the log shows')}</h4>
      <ul className="steps-list">{answer.observations.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </>}
    {answer.questions.length > 0 && <>
      <h4 className="sec">{t('Questions you can take with you')}</h4>
      <ul className="steps-list">{answer.questions.map((text, i) => <li key={i}>{text}</li>)}</ul>
    </>}
    <div className="dim small" style={{ margin: '14px 0', lineHeight: 1.45 }}>
      {t('Nothing from this explanation is saved as a target.')}
      {local && <> {t('No health data was sent to AI.')}</>}
    </div>
    <Button variant="primary" onClick={close}>{t('Close')}</Button>
  </>

  const known = Object.entries(context.day)
  const targets = Object.entries(context.targets)
  const flags = [
    context.medical.diabetes && t('Diabetes mode is on'),
    context.medical.condition && t('Illness affects my diet'),
    context.medical.medication && t('Medication affects my diet'),
    context.medical.under18 && t('Under 18')
  ].filter(Boolean)

  return <>
    <h3>{t(context.clinicianReview ? 'Create care-team notes' : 'Explain this day with AI')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {context.clinicianReview
        ? t('A health flag is active. Nothing below will be sent to AI; Dagsnav creates fixed care-team notes on this server.')
        : t('The model receives only interface language and verified fact codes for your selected goal, data completeness and filled target fields. It receives no numbers, demographics or health data.')}
    </div>

    <h4 className="sec">{t('Information reviewed on your server')}</h4>
    <div className="nai-preview">
      <div><span>{t('Language')}</span><strong>{context.language}</strong></div>
      <div><span>{t('Date')}</span><strong>{context.date || '—'}</strong></div>
      <div><span>{t('Nutrition goal')}</span><strong>{t(GOAL_NAME[context.goal] || context.goal)}</strong></div>
      <div><span>{t('Individual information')}</span><strong>
        {[context.person.age && `${t('Age')} ${context.person.age}`, context.person.sex && t(context.person.sex === 'female' ? 'Female' : 'Male'),
          context.person.heightCm && context.person.heightCm + ' cm', context.person.weightKg && context.person.weightKg + ' kg']
          .filter(Boolean).join(' · ') || '—'}
      </strong></div>
      {context.person.bmrKcal != null && <div><span>{t('Estimated BMR')}</span><strong>{t('≈ {0} kcal/day', fmtNum(context.person.bmrKcal))}</strong></div>}
      <div><span>{t('Known values for the day')}</span><strong>{known.length
        ? known.map(([key, value]) => `${t(NUTRIENT_NAME[key])} ${fmtNum(value)} ${NUTRIENT_UNIT[key]}`).join(' · ')
        : '—'}</strong></div>
      {context.incomplete.length > 0 && <div className="warn"><span>{t('Incomplete')}</span><strong>
        {context.incomplete.map(key => t(NUTRIENT_NAME[key])).join(', ')}</strong></div>}
      <div><span>{t('Targets you entered')}</span><strong>{targets.length
        ? targets.map(([key, value]) => `${t(NUTRIENT_NAME[key])} ${fmtNum(value)} ${NUTRIENT_UNIT[key]}`).join(' · ')
        : t('None')}</strong></div>
      <div className={flags.length ? 'warn' : ''}><span>{t('Health flags')}</span><strong>{flags.length ? flags.join(' · ') : t('None')}</strong></div>
    </div>

    <div className="dim small" style={{ margin: '12px 0', lineHeight: 1.5 }}>
      {t(context.clinicianReview
        ? 'The fixed note cannot save targets, calculate insulin or give advice for low glucose.'
        : 'AI can only choose verified highlights. It cannot write text, save targets, calculate insulin or give advice for low glucose.')}
    </div>
    {error && <div className="nmedical" role="alert"><Icon name="info" /><div>{error}</div></div>}
    <Button variant="primary" icon={context.clinicianReview ? 'shield' : 'sparkles'} disabled={busy} onClick={send}>
      {busy ? t('Writing an explanation…') : t(context.clinicianReview ? 'Create care-team notes without AI' : 'I approve — choose highlights')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={close}>{t('Cancel')}</Button>
  </>
}

export const nutritionAssistSheet = (date, totals) =>
  useUI.getState().openSheet(close => <AssistSheet date={date} totals={totals} close={close} />)

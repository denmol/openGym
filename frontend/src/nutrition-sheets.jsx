// Personal nutrition goals.
//
// Numbers here come from measurements already in the profile, explicit choices and sourced
// equations. Every calculated value is marked as approximate and stays separate from the
// editable target fields.

import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { dateLocale, t } from './lib/i18n.js'
import { fmtNum, todayISO } from './lib/format.js'
import { lastBW } from './lib/history.js'
import { coachProfileOf, cleanCoachProfile } from './lib/coach-profile.js'
import { diabetesOn } from './lib/diabetes.js'
import { NUTRIENT_NAME, NUTRIENT_UNIT } from './lib/foods.js'
import {
  NUTRIENT_TARGETS, NUTRITION_SAFETY_KEYS, cleanNutritionProfile,
  dailyNutritionReferences, finalizeNutritionProfile, formatNutritionPlanningValue,
  formatNutritionReference, needsClinicianTargets, nnrRestingEnergyEstimate, nutritionPlanningValues,
  nutritionReferenceState, nutritionSafetyToday, safetyReviewCurrent, weightKgOf
} from './lib/nutrition-goals.js'
import { askNutrition, nutritionAssistContext } from './lib/nutrition-assist.js'
import { Button, NumberField, Switch } from './components/ui.jsx'
import Icon from './components/Icon.jsx'

const GOAL_NAME = {
  maintain: 'Maintain weight', lose: 'Lose weight', muscle: 'Build muscle', health: 'General health'
}
const INCRETIN_NAME = {
  none: 'No incretin treatment', weight: 'Weight treatment', diabetes: 'Diabetes treatment only',
  both: 'Weight and diabetes treatment', other: 'Other or unclear use'
}
const PHASE_NAME = { active_loss: 'Active weight loss', maintenance: 'Weight-stable phase' }
const FIBER_NAME = { range: 'Population interval', female: "Women's NNR reference", male: "Men's NNR reference" }
const ACTIVITY_NAME = {
  range: 'Not sure — show PAL 1.4–1.8',
  low: 'Mostly sedentary · PAL 1.4',
  moderate: 'Sedentary work and active leisure · PAL 1.6',
  active: 'Active lifestyle · PAL 1.8'
}
const SAFETY_QUESTION = {
  kidneyOrProteinRestriction: 'Kidney disease, dialysis, transplant or prescribed protein restriction?',
  fluidOrSodiumRestriction: 'Heart failure or prescribed fluid or sodium restriction?',
  pregnancyOrBreastfeeding: 'Pregnant, planning pregnancy or breastfeeding?',
  eatingDisorder: 'Current or previous eating disorder, self-induced vomiting or severe restriction?',
  severeGI: 'Severe or persistent stomach symptoms, dehydration or inability to eat and drink enough?',
  malnutritionRisk: 'Unintentional rapid weight loss, much lower intake, new weakness or diagnosed malnutrition or muscle loss?',
  otherClinicalNutrition: 'Liver disease, previous obesity surgery or another prescribed nutrition plan?',
  hypoglycemiaRiskMedication: 'Insulin or another medicine that your care team says can cause hypoglycaemia?'
}
const KIND_NAME = { range: 'Range', min: 'Minimum', max: 'Maximum', example: 'Source example', warning: 'Warning threshold' }
const REFERENCE_NAME = { ...NUTRIENT_NAME, fluid: 'Fluid' }
const STATUS_TEXT = {
  age_required: 'Enter an adult age to show nutrition references.',
  pregnancy_required: 'Answer the pregnancy and breastfeeding question before adult references are shown.',
  professional_review: 'These general adult references are hidden because professional adaptation is needed.',
  phase_required: 'Choose active weight loss or weight-stable phase before GLP-1 references are shown.',
  safety_incomplete: 'Answer and confirm every safety question before GLP-1 references are shown.',
  safety_expired: 'Confirm the safety answers again; the previous review is older than 90 days.',
  blocked: 'The GLP-1 reference layer is hidden because a professional review is needed.',
  not_applicable: 'GLP-1 obesity-treatment references require Weight treatment or Weight and diabetes treatment.'
}
const GOAL_NOTE = {
  maintain: 'The estimate shows maintenance energy; you decide whether to enter it as your own target.',
  lose: 'A sourced weight-loss planning interval is shown when the inputs support it; you decide your own target.',
  muscle: 'A sourced muscle-gain planning interval is shown as an example; you decide your own target.',
  health: 'The estimate shows maintenance energy together with Nordic nutrient ranges in grams.'
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

function ChoiceGrid({ label, names, value, onChange }) {
  return <div className="ngoal-grid" role="group" aria-label={t(label)}>
    {Object.entries(names).map(([id, text]) => <button key={id}
      className={'ngoal' + (value === id ? ' on' : '')}
      aria-pressed={value === id} onClick={() => onChange(id)}>{t(text)}</button>)}
  </div>
}

function ReferenceCard({ reference, paused }) {
  const targetKey = NUTRIENT_TARGETS.includes(reference.targetField) ? reference.targetField : null
  return <article className="nref-card">
    <div className="nref-head">
      <strong>{t(REFERENCE_NAME[reference.nutrient])}</strong>
      <span className="nref-kind">{t(KIND_NAME[reference.kind])}</span>
    </div>
    <div className="nref-value">{formatNutritionReference(reference, dateLocale(), t(reference.unit))}</div>
    <div className="nref-meta">{t(reference.source)} · {reference.year} · {t(reference.audience)}</div>
    <p>{t(reference.limitation)}</p>
    <div className="nref-actions">
      <a href={reference.sourceUrl} target="_blank" rel="noopener">{t('Open source')}</a>
      {targetKey && !paused.includes(targetKey) && <button onClick={() =>
        document.getElementById(`nutrition-target-${targetKey}`)?.focus()}>{t('Set my own target')}</button>}
    </div>
  </article>
}

function GoalsSheet({ close }) {
  const S = useStore(s => s.S)
  const stored = cleanNutritionProfile(S.nutritionGoals)
  const person = coachProfileOf(S)
  const [draft, setDraft] = useState(stored)
  const [safetyConfirmedAt, setSafetyConfirmedAt] = useState(null)
  const [targetsReviewed, setTargetsReviewed] = useState(false)
  const [age, setAge] = useState(person.age)
  const [heightCm, setHeight] = useState(person.heightCm)
  const [sex, setSex] = useState(person.sex)

  const bw = lastBW(S)
  const weightKg = weightKgOf(bw)
  const basal = nnrRestingEnergyEstimate({ sex, age, heightCm, weightKg })
  const profile = cleanNutritionProfile(draft)
  const safetyToday = nutritionSafetyToday()
  const planning = nutritionPlanningValues(profile, { sex, age, heightCm, weightKg, today: safetyToday })
  const today = todayISO()
  const referenceState = nutritionReferenceState(profile, { age, today: safetyToday })
  const safetyComplete = NUTRITION_SAFETY_KEYS.every(key => typeof profile.safety[key] === 'boolean')
  const planningSafetyReady = safetyComplete && safetyReviewCurrent(profile.safetyReviewedAt, safetyToday)
  const visiblePlanning = planning
  const clinician = needsClinicianTargets(profile, { diabetes: diabetesOn(S) }) ||
    ((typeof age === 'number' || (typeof age === 'string' && age.trim())) && Number(age) > 0 && Number(age) < 18)

  const change = patch => setDraft(old => ({ ...old, ...patch }))
  const changeMedical = updater => {
    setDraft(old => ({ ...updater(old), safetyReviewedAt: null }))
    setSafetyConfirmedAt(null)
  }
  const setTarget = (key, value) => setDraft(old => ({
    ...old, targets: { ...old.targets, [key]: value }
  }))
  const setSafety = (key, value) => changeMedical(old => ({
    ...old, safety: { ...old.safety, [key]: value }
  }))
  const confirmSafety = () => {
    if (!safetyComplete) return toast(t('Answer every safety question first.'))
    setDraft(old => ({ ...old, safetyReviewedAt: safetyToday }))
    setSafetyConfirmedAt(safetyToday)
  }
  const save = () => {
    if (!profile.goal) { toast(t('Choose a nutrition goal.')); return }
    const saved = finalizeNutritionProfile(stored, profile, { safetyConfirmedAt, targetsReviewed })
    update(state => {
      state.coachProfile = cleanCoachProfile({
        ...coachProfileOf(state), age, heightCm, sex, updated: today
      })
      state.nutritionGoals = { ...saved, updated: today }
    })
    close()
    toast(t('Nutrition goals saved'))
  }

  return <>
    <h3>{t('Nutrition goals')}</h3>

    <h4 className="sec">{t('What do you want to work toward?')}</h4>
    <div className="ngoal-grid">
      {Object.entries(GOAL_NAME).map(([id, label]) => <button key={id}
        className={'ngoal' + (profile.goal === id ? ' on' : '')}
        aria-pressed={profile.goal === id} onClick={() => change({ goal: id })}>
        {t(label)}
      </button>)}
    </div>
    {profile.goal && <div className="dim small" style={{ marginTop: 9, lineHeight: 1.45 }}>{t(GOAL_NOTE[profile.goal])}</div>}

    <h4 className="sec">{t('Individual information')}</h4>
    <div className="nprofile-grid">
      <label><span>{t('Age')}</span><NumberField className="input" value={age} nullable decimal={false}
        aria-label={t('Age')} onChange={setAge} /></label>
      <label><span>{t('Height')}</span><span className="nwith-unit"><NumberField className="input" value={heightCm} nullable decimal={false}
        aria-label={t('Height in cm')} onChange={setHeight} /><i>cm</i></span></label>
    </div>
    <div className="nsex" role="group" aria-label={t('Sex used by the resting-energy equation')}>
      {['female', 'male'].map(value => <button key={value} className={sex === value ? 'on' : ''}
        aria-pressed={sex === value} onClick={() => setSex(value)}>{t(value === 'female' ? 'Female' : 'Male')}</button>)}
    </div>

    <div className="nbmr">
      <span className="nbmr-icon"><Icon name="flame" /></span>
      <div className="grow">
        <div className="small dim">{t('Estimated resting energy · NNR 2023 Henry')}</div>
        <div className="nbmr-value">{basal == null ? '—' : t('≈ {0} kcal/day', fmtNum(basal))}</div>
        <div className="dim small">{basal == null
          ? t(bw && !bw.u
            ? 'Log a new weight so its unit is known before BMR is estimated.'
            : 'Add adult age, sex, height and a logged weight to show the estimate.')
          : t('Resting energy is an equation-based estimate, not a daily calorie target.')}</div>
        {bw?.u && <div className="dim small" style={{ marginTop: 4 }}>
          {t('Latest weight: {0} {1} on {2}', fmtNum(bw.w), bw.u, bw.d)}
        </div>}
      </div>
    </div>

    <h4 className="sec">{t('Activity used for the energy estimate')}</h4>
    <ChoiceGrid label="Activity used for the energy estimate" names={ACTIVITY_NAME}
      value={profile.activityLevel} onChange={activityLevel => change({ activityLevel })} />
    <div className="nreference-note">
      {t('PAL is not inferred from workouts. Choose a level, or keep the full PAL 1.4–1.8 range when unsure.')}{' '}
      <a href="https://pub.norden.org/nord2023-003/appendix.html" target="_blank" rel="noopener">
        {t('Source: Nordic Nutrition Recommendations 2023')}
      </a>
    </div>

    {profile.goal && !planningSafetyReady && <div className="nmedical" role="note">
      <Icon name="shield" /><div>{t('Answer and confirm every safety question below before calculated kcal and gram ranges are shown.')}</div>
    </div>}

    {visiblePlanning && <div className="nbmr">
      <span className="nbmr-icon"><Icon name="target" /></span>
      <div className="grow">
        <div className="small dim">{t('Estimated maintenance energy')}</div>
        <div className="nbmr-value">{formatNutritionPlanningValue(
          visiblePlanning.maintenanceKcal, dateLocale(), t('kcal/day'))}</div>
        {visiblePlanning.goalKcal && <>
          <div className="small dim" style={{ marginTop: 8 }}>{t(visiblePlanning.goalBasis === 'loss_deficit'
            ? 'Sourced weight-loss planning interval'
            : visiblePlanning.goalBasis === 'muscle_surplus'
              ? 'Sourced muscle-gain planning interval'
              : 'Calculated daily energy')}</div>
          <div className="nbmr-value">{formatNutritionPlanningValue(
            visiblePlanning.goalKcal, dateLocale(), t('kcal/day'))}</div>
        </>}
        {visiblePlanning.goalBasis === 'loss_deficit' && <div className="dim small">
          {t('The 500–750 kcal deficit comes from clinician-led multicomponent programmes for adults with overweight or obesity and is shown only as a planning example.')}
        </div>}
        {visiblePlanning.goalBasis === 'muscle_surplus' && <div className="dim small">
          {t('The 5–20% surplus is a research-based example for resistance-trained adults; larger surpluses mainly increased skinfolds.')}
        </div>}
        <div className="dim small" style={{ marginTop: 6 }}>
          <a href="https://pub.norden.org/nord2023-003/appendix.html" target="_blank" rel="noopener">NNR 2023 · Henry + PAL</a>
          {visiblePlanning.goalBasis === 'loss_deficit' && <>
            {' · '}<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC13399222/" target="_blank" rel="noopener">AHA/ACC 2026</a>
          </>}
          {visiblePlanning.goalBasis === 'muscle_surplus' && <>
            {' · '}<a href="https://pubmed.ncbi.nlm.nih.gov/37914977/" target="_blank" rel="noopener">Helms et al. 2023</a>
          </>}
        </div>
        <div className="dim small">{t('These are equation-based estimates, not measured expenditure, and nothing is copied into your own targets.')}</div>
      </div>
    </div>}
    {visiblePlanning?.goalStatus === 'low_energy_review' && <div className="nmedical" role="note">
      <Icon name="info" /><div>{t('No weight-loss interval is shown because the calculation would go below 1,200 kcal/day. Use an individually reviewed energy target instead.')}</div>
    </div>}
    {visiblePlanning?.goalStatus === 'loss_not_applied_bmi_below_25' && <div className="nreference-note">
      {t('No automatic calorie deficit is applied below BMI 25; estimated maintenance energy is shown instead.')}
    </div>}

    <h4 className="sec">{t('Health boundary')}</h4>
    <div className="sect-b">
      <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Illness affects my diet')}</span></span>
        <Switch checked={profile.condition} aria-label={t('Illness affects my diet')}
          onChange={condition => changeMedical(old => ({ ...old, condition }))} /></div>
      <div className="lrow"><span className="lrow-m"><span className="lrow-t">{t('Medication affects my diet')}</span></span>
        <Switch checked={profile.medication} aria-label={t('Medication affects my diet')}
          onChange={medication => changeMedical(old => ({ ...old, medication }))} /></div>
    </div>
    <h4 className="sec">{t('Incretin treatment')}</h4>
    <ChoiceGrid label="Incretin treatment" names={INCRETIN_NAME} value={profile.incretinUse}
      onChange={incretinUse => changeMedical(old => ({
        ...old, incretinUse, weightPhase: incretinUse === 'none' ? null : old.weightPhase
      }))} />
    {['weight', 'both'].includes(profile.incretinUse) && <>
      <h4 className="sec">{t('Weight-treatment phase')}</h4>
      <ChoiceGrid label="Weight-treatment phase" names={PHASE_NAME} value={profile.weightPhase}
        onChange={weightPhase => changeMedical(old => ({ ...old, weightPhase }))} />
    </>}
    <h4 className="sec">{t('Fibre reference')}</h4>
    <ChoiceGrid label="Fibre reference" names={FIBER_NAME} value={profile.fiberReference}
      onChange={fiberReference => change({ fiberReference })} />

    <h4 className="sec">{t('Safety questions')}</h4>
    <div className="sect-b">
      {['pregnancyOrBreastfeeding'].map(key => <div className="nsafety-row" key={key}>
        <span>{t(SAFETY_QUESTION[key])}</span>
        <span className="nsafety-buttons" role="group" aria-label={t(SAFETY_QUESTION[key])}>
          <button aria-pressed={profile.safety[key] === true} className={profile.safety[key] === true ? 'on' : ''}
            onClick={() => setSafety(key, true)}>{t('Yes')}</button>
          <button aria-pressed={profile.safety[key] === false} className={profile.safety[key] === false ? 'on' : ''}
            onClick={() => setSafety(key, false)}>{t('No / not applicable')}</button>
        </span>
      </div>)}
    </div>
    <details className="nreference"
      open={!planningSafetyReady || (profile.incretinUse != null && profile.incretinUse !== 'none') || profile.condition || profile.medication}>
      <summary>{t('Safety questions')}</summary>
      <div>
        {NUTRITION_SAFETY_KEYS.filter(key => key !== 'pregnancyOrBreastfeeding').map(key => <div className="nsafety-row" key={key}>
          <span>{t(SAFETY_QUESTION[key])}</span>
          <span className="nsafety-buttons" role="group" aria-label={t(SAFETY_QUESTION[key])}>
            <button aria-pressed={profile.safety[key] === true} className={profile.safety[key] === true ? 'on' : ''}
              onClick={() => setSafety(key, true)}>{t('Yes')}</button>
            <button aria-pressed={profile.safety[key] === false} className={profile.safety[key] === false ? 'on' : ''}
              onClick={() => setSafety(key, false)}>{t('No / not applicable')}</button>
          </span>
        </div>)}
      </div>
    </details>
    {safetyComplete && !safetyReviewCurrent(profile.safetyReviewedAt, safetyToday) &&
      <Button variant="tinted" icon="shield" onClick={confirmSafety}>{t('Confirm safety answers')}</Button>}
    {clinician && <div className="nmedical" role="note">
      <Icon name="shield" />
      <div><strong>{t('Own targets need review')}</strong><br />
        <span>{t('The fields are your own targets. Scientific references appear automatically when applicable, but are not copied into targets. For diabetes, illness or medication, review own targets with your care team.')}</span></div>
    </div>}
    <div className="nreference-note" role="note">
      {t('References are general source values, not personal treatment targets or medical advice. Your care plan and advice from your care team take priority.')}
    </div>

    <h4 className="sec">{t('Recommendations and own targets')}</h4>
    <div className="nreference-note">
      {t('Calculated values are marked with ≈ and shown in kcal or grams before each editable field. Nothing is copied into your own target.')}{' '}
      <a href="https://pub.norden.org/nord2023-003/recommendations.html" target="_blank" rel="noopener">
        {t('Source: Nordic Nutrition Recommendations 2023')}
      </a>
      <br />{t('Carbohydrate grams exclude fibre, matching EU food labels. The conversion reserves fibre energy using the NNR minimum of 3 g/MJ.')}
      <br />{t('Protein grams use at least the NNR RI of 0.83 g/kg; for adults over 70, the NNR range 1.2–1.5 g/kg is used.')}
    </div>
    {visiblePlanning?.macroStatus === 'low_energy_review' && <div className="nmedical" role="note">
      <Icon name="info" /><div>{t('Your energy target below 1,200 kcal/day is not used to calculate gram ranges; the sourced planning estimate is used instead when available.')}</div>
    </div>}
    <div className="ntargets">
      {NUTRIENT_TARGETS.map(key => {
        const paused = referenceState.pausedTargets.includes(key)
        const references = dailyNutritionReferences(referenceState, key)
        const calculated = !paused && visiblePlanning && (key === 'kcal'
          ? visiblePlanning.goalKcal || visiblePlanning.maintenanceKcal
          : visiblePlanning.grams?.[key])
        return <label key={key} className={paused ? 'paused' : ''}>
          <span className="ntarget-copy">
            <span className="ntarget-name">{t(NUTRIENT_NAME[key])}</span>
            {calculated && <small className="ntarget-reference ntarget-calculated">
              <span className="ntarget-reference-value">{t(key === 'kcal'
                ? visiblePlanning.goalKcal && visiblePlanning.goalBasis === 'loss_deficit'
                  ? 'Weight-loss planning interval: {0}'
                  : visiblePlanning.goalKcal && visiblePlanning.goalBasis === 'muscle_surplus'
                    ? 'Muscle-gain planning interval: {0}'
                    : 'Estimated maintenance energy: {0}'
                : visiblePlanning.macroBasisKcal.source === 'own_target'
                  ? 'Converted from your own energy target: {0}'
                  : visiblePlanning.macroBasisKcal.source === 'estimated_maintenance'
                    ? 'Calculated from estimated maintenance energy: {0}'
                  : 'Calculated range: {0}',
              formatNutritionPlanningValue(calculated, dateLocale(), t(key === 'kcal' ? 'kcal/day' : 'g/day')))}</span>
            </small>}
            {references.map(reference => <small className="ntarget-reference" key={reference.id}>
              <span className="ntarget-reference-value">{t(reference.layer === 'adult'
                ? 'General adult reference: {0}'
                : reference.kind === 'example' ? 'Source example: {0}' : 'Weight-treatment reference: {0}',
              formatNutritionReference(reference, dateLocale(), t(reference.unit)))}</span>
              <span> · {t(reference.source)}</span>
            </small>)}
            {!paused && !calculated && !planningSafetyReady && key === 'kcal' && <small className="ntarget-reference">
              {t('Confirm the safety answers to show the calculated interval.')}
            </small>}
            {!paused && !calculated && planningSafetyReady && references.length === 0 && key === 'kcal' && <small className="ntarget-reference">
              {t('Add a goal, adult age, sex, height and a logged weight to calculate an energy interval.')}
            </small>}
            {!paused && references.length === 0 && key === 'sugar' && <small className="ntarget-reference">
              {t('No comparable source target — Dagsnav logs total sugar while the source concerns added and free sugar.')}
            </small>}
            {paused && <small className="ntarget-paused">{t('Paused — needs review')}</small>}
          </span>
          <span className="nwith-unit">
            <NumberField id={`nutrition-target-${key}`} className="input" value={profile.targets[key]} nullable
              placeholder={t('Own target')}
              aria-label={t('Daily target for {0}', t(NUTRIENT_NAME[key]))}
              onChange={value => setTarget(key, value)} />
            <i>{NUTRIENT_UNIT[key]}</i>
          </span>
        </label>
      })}
    </div>
    {stored.targetReviewRequired && !targetsReviewed &&
      <Button variant="tinted" onClick={() => setTargetsReviewed(true)}>{t('I have reviewed my own targets')}</Button>}

    <h4 className="sec">{t('Scientific references')}</h4>
    {referenceState.adultStatus !== 'available' && <div className="nmedical" role="note">
      <Icon name="shield" /><div>{t(STATUS_TEXT[referenceState.adultStatus])}</div>
    </div>}
    {profile.incretinUse && profile.incretinUse !== 'none' && referenceState.glpStatus !== 'available' &&
      <div className="nmedical" role="note"><Icon name="shield" /><div>{t(STATUS_TEXT[referenceState.glpStatus])}</div></div>}
    {referenceState.notices.map(notice => <div key={notice.code} className="nmedical"
      role={notice.severity === 'alert' ? 'alert' : 'note'}>
      <Icon name={notice.severity === 'alert' ? 'info' : 'shield'} /><div>{t(notice.message)}</div>
    </div>)}
    <div className="nref-list">
      {referenceState.references.map(reference => <ReferenceCard key={reference.id}
        reference={reference} paused={referenceState.pausedTargets} />)}
    </div>

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
      await useStore.getState().pushState()
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
    context.medical.under18 && t('Under 18'),
    context.medical.nutritionSafety && t('Nutrition safety review required')
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

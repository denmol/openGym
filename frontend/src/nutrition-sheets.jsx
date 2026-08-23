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
import { lastBW, weightIn } from './lib/history.js'
import { coachProfileOf, cleanCoachProfile } from './lib/coach-profile.js'
import { diabetesOn } from './lib/diabetes.js'
import { NUTRIENT_NAME, NUTRIENT_UNIT } from './lib/foods.js'
import {
  CORE_SAFETY_KEYS, EXTENDED_SAFETY_KEYS, NUTRIENT_TARGETS, NUTRITION_SAFETY_KEYS,
  cleanNutritionProfile, coreSafetyAnswered, dailyNutritionReferences, finalizeNutritionProfile,
  formatNutritionReference, needsClinicianTargets, nnrRestingEnergyEstimate,
  nutritionReferenceState, nutritionSafetyToday, safetyReviewCurrent, weightKgOf
} from './lib/nutrition-goals.js'
import {
  PLAN_NUTRIENTS, formatPlanAmount, limitPrefix, nutritionDayPlan, planAsTargets
} from './lib/nutrition-plan.js'
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
  range: 'Not sure — use the middle, PAL 1.6',
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
const BLOCKED_HINT = {
  goal_missing: 'Choose a goal above.',
  age_missing: 'Add your age above.',
  age_not_adult: 'Daily values for under-18s belong with a care team, so Dagsnav does not estimate them.',
  sex_missing: 'Choose the sex the equation should use.',
  height_missing: 'Add your height above.',
  weight_missing: 'Add your weight above.',
  weight_unit_unknown: 'Your last weight was logged without a unit. Enter it again above.',
  safety_unanswered: 'Answer the two health questions below.',
  safety_expired: 'Confirm your health answers again — the last review is over 90 days old.',
  clinical_review: 'Your health answers need professional adaptation, so no values are calculated.',
  estimate_unavailable: 'Add age, sex, height and a weight above.'
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

/**
 * The calculated figure as a hint inside the empty field.
 *
 * A bare number in a text box reads as something already entered, so every suggestion
 * carries a sign: ≈ for a figure to land near, ≥ and ≤ for a floor and a ceiling. It is a
 * placeholder rather than a value, so typing replaces it and nothing is saved unless the
 * person saves it — the same rule the rest of this sheet follows.
 */
const suggestion = (key, value) =>
  (limitPrefix(key) || '≈ ') + formatPlanAmount(value, key, dateLocale())

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
  const [adopted, setAdopted] = useState([])
  const [age, setAge] = useState(person.age)
  const [heightCm, setHeight] = useState(person.heightCm)
  const [sex, setSex] = useState(person.sex)

  // Weight is edited here rather than only on the workout screen. It is one of five fields
  // the estimate needs, and being sent to another view to supply it — then back — was the
  // one gap in this sheet that could not be closed from inside it.
  const bw = lastBW(S)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const [weight, setWeight] = useState(weightIn(bw, unit))
  const weightKg = weight == null ? null : weightIn({ w: weight, u: unit }, 'kg')
  const weightChanged = weight != null && weight !== weightIn(bw, unit)

  const basal = nnrRestingEnergyEstimate({ sex, age, heightCm, weightKg })
  const profile = cleanNutritionProfile(draft)
  const safetyToday = nutritionSafetyToday()
  const today = todayISO()
  const plan = nutritionDayPlan(profile, {
    sex, age, heightCm, weightKg, weightLogged: !!bw, today: safetyToday
  })
  const referenceState = nutritionReferenceState(profile, { age, today: safetyToday })
  const safetyComplete = NUTRITION_SAFETY_KEYS.every(key => typeof profile.safety[key] === 'boolean')
  const coreComplete = coreSafetyAnswered(profile)
  const clinician = needsClinicianTargets(profile, { diabetes: diabetesOn(S) }) ||
    ((typeof age === 'number' || (typeof age === 'string' && age.trim())) && Number(age) > 0 && Number(age) < 18)
  // Adopting a whole target set is for the general adult case. Where a care team owns the
  // numbers, the fields stay a place to type theirs in — not somewhere an estimate lands.
  const canAdopt = !plan.blocked && !clinician

  const change = patch => setDraft(old => ({ ...old, ...patch }))
  const changeMedical = updater => {
    setDraft(old => ({ ...updater(old), safetyReviewedAt: null }))
    setSafetyConfirmedAt(null)
  }
  const setTarget = (key, value) => {
    setAdopted(old => old.filter(adoptedKey => adoptedKey !== key))
    setDraft(old => ({ ...old, targets: { ...old.targets, [key]: value } }))
  }
  const setSafety = (key, value) => changeMedical(old => ({
    ...old, safety: { ...old.safety, [key]: value }
  }))
  const confirmSafety = () => {
    if (!coreComplete) return toast(t('Answer both health questions first.'))
    setDraft(old => ({ ...old, safetyReviewedAt: safetyToday }))
    setSafetyConfirmedAt(safetyToday)
  }
  // The estimate becomes the targets in one step, and each field remembers that it did.
  // Editing one afterwards makes that field the person's own again, which is the only way
  // "use this plan" and "these are my numbers" can both stay true.
  const adoptPlan = () => {
    const targets = planAsTargets(plan)
    if (!targets) return
    setDraft(old => ({
      ...old,
      targets: { ...old.targets, ...Object.fromEntries(Object.entries(targets).filter(([, v]) => v != null)) }
    }))
    setAdopted(Object.keys(targets).filter(key => targets[key] != null))
    toast(t('Daily values copied into your own targets'))
  }
  const save = () => {
    if (!profile.goal) { toast(t('Choose a nutrition goal.')); return }
    const saved = finalizeNutritionProfile(stored, profile, { safetyConfirmedAt, targetsReviewed })
    update(state => {
      state.coachProfile = cleanCoachProfile({
        ...coachProfileOf(state), age, heightCm, sex, updated: today
      })
      state.nutritionGoals = { ...saved, updated: today }
      if (weightChanged) {
        const existing = state.bodyweight.find(entry => entry.d === today)
        if (existing) Object.assign(existing, { w: weight, u: unit, t: Date.now() })
        else state.bodyweight.push({ d: today, w: weight, u: unit, t: Date.now() })
        state.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
      }
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
    <div className="nprofile-grid" style={{ marginTop: 10 }}>
      <label><span>{t('Weight')}</span><span className="nwith-unit"><NumberField className="input" value={weight} nullable
        aria-label={t('Body weight')} onChange={setWeight} /><i>{unit}</i></span></label>
    </div>
    <div className="nsex" role="group" aria-label={t('Sex used by the resting-energy equation')}>
      {['female', 'male'].map(value => <button key={value} className={sex === value ? 'on' : ''}
        aria-pressed={sex === value} onClick={() => setSex(value)}>{t(value === 'female' ? 'Female' : 'Male')}</button>)}
    </div>
    {weightChanged && <div className="dnote">{t('Saving also logs this weight for today.')}</div>}
    {!weightChanged && bw?.d && <div className="dnote">{t('Latest weight: {0} {1} on {2}', fmtNum(bw.w), bw.u || '?', bw.d)}</div>}

    <div className="nbmr">
      <span className="nbmr-icon"><Icon name="flame" /></span>
      <div className="grow">
        <div className="small dim">{t('Estimated resting energy · NNR 2023 Henry')}</div>
        <div className="nbmr-value">{basal == null ? '—' : t('≈ {0} kcal/day', fmtNum(basal))}</div>
        <div className="dim small">{basal == null
          ? t('Add adult age, sex, height and a weight to show the estimate.')
          : t('Resting energy is an equation-based estimate, not a daily calorie target.')}</div>
      </div>
    </div>

    <h4 className="sec">{t('Activity used for the energy estimate')}</h4>
    <ChoiceGrid label="Activity used for the energy estimate" names={ACTIVITY_NAME}
      value={profile.activityLevel} onChange={activityLevel => change({ activityLevel })} />
    <div className="nreference-note">
      {t('PAL is not inferred from workouts. Choose a level, or keep the middle of the NNR range when unsure.')}{' '}
      <a href="https://pub.norden.org/nord2023-003/appendix.html" target="_blank" rel="noopener">
        {t('Source: Nordic Nutrition Recommendations 2023')}
      </a>
    </div>

    <h4 className="sec">{t('Health questions')}</h4>
    <div className="sect-b">
      {CORE_SAFETY_KEYS.map(key => <div className="nsafety-row" key={key}>
        <span>{t(SAFETY_QUESTION[key])}</span>
        <span className="nsafety-buttons" role="group" aria-label={t(SAFETY_QUESTION[key])}>
          <button aria-pressed={profile.safety[key] === true} className={profile.safety[key] === true ? 'on' : ''}
            onClick={() => setSafety(key, true)}>{t('Yes')}</button>
          <button aria-pressed={profile.safety[key] === false} className={profile.safety[key] === false ? 'on' : ''}
            onClick={() => setSafety(key, false)}>{t('No / not applicable')}</button>
        </span>
      </div>)}
    </div>
    <div className="nreference-note">
      {t('These two decide whether a general adult estimate applies at all. The rest are further down and refine the references rather than gate them.')}
    </div>
    {coreComplete && !safetyReviewCurrent(profile.safetyReviewedAt, safetyToday) && <>
      <div style={{ height: 10 }} />
      <Button variant="tinted" icon="shield" onClick={confirmSafety}>{t('Confirm health answers')}</Button>
    </>}

    <h4 className="sec">{t('Your daily values')}</h4>
    {plan.blocked
      ? <div className="dblocked" role="note">
        <Icon name={plan.blocked.fix === 'clinician' ? 'shield' : 'target'} />
        <div>{t(BLOCKED_HINT[plan.blocked.reason] || '')}</div>
      </div>
      : <>
        <div className="nplan">
          {PLAN_NUTRIENTS.filter(key => plan.values[key] != null).map(key => <div key={key} className="nplan-row">
            <span>{t(NUTRIENT_NAME[key])}</span>
            <strong>{limitPrefix(key)}{formatPlanAmount(plan.values[key], key, dateLocale())} {NUTRIENT_UNIT[key]}</strong>
          </div>)}
        </div>
        <div className="nreference-note">
          {t(plan.goalBasis === 'loss_deficit'
            ? 'Energy is your estimated maintenance less the sourced 500–750 kcal deficit, shown at its midpoint.'
            : plan.goalBasis === 'muscle_surplus'
              ? 'Energy is your estimated maintenance plus the sourced 5–20% surplus, shown at its midpoint.'
              : plan.goalBasis === 'loss_not_applied_bmi_below_25'
                ? 'No automatic deficit is applied below BMI 25, so this is your estimated maintenance energy.'
                : 'This is your estimated maintenance energy.')}
          {' '}{t('Carbohydrate is the energy left after protein, fat and fibre, which is why these are single numbers rather than population intervals.')}
        </div>
        {plan.energy.floorApplied && <div className="nmedical" role="note">
          <Icon name="info" /><div>{t('The calculation landed below 1,200 kcal/day and was raised to that floor. Use an individually reviewed energy target instead of going lower.')}</div>
        </div>}
        {plan.energy.belowMicronutrientWatch && <div className="nmedical" role="note">
          <Icon name="info" /><div>{t('This plan is below 1,500 kcal/day, where the source identifies a high risk of inadequate micronutrient intake.')}</div>
        </div>}
        {canAdopt && <>
          <div style={{ height: 10 }} />
          <Button variant="primary" icon="target" onClick={adoptPlan}>{t('Use these as my targets')}</Button>
          <div className="dnote">{t('They become your own editable targets. Change any field afterwards and that field stops following the plan.')}</div>
        </>}
        {!canAdopt && clinician && <div className="nmedical" role="note">
          <Icon name="shield" /><div>{t('Because a health flag is set, these values are shown for discussion with your care team rather than copied into your targets.')}</div>
        </div>}
      </>}

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

    <details className="nreference"
      open={(profile.incretinUse != null && profile.incretinUse !== 'none') || profile.condition || profile.medication}>
      <summary>{t('More health questions ({0} of {1} answered)',
        EXTENDED_SAFETY_KEYS.filter(key => typeof profile.safety[key] === 'boolean').length, EXTENDED_SAFETY_KEYS.length)}</summary>
      <div>
        <div className="nreference-note" style={{ marginTop: 0, padding: 0 }}>
          {t('These narrow which references apply and are required for the GLP-1 layer. Your daily values do not wait for them.')}
        </div>
        {EXTENDED_SAFETY_KEYS.map(key => <div className="nsafety-row" key={key}>
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
      <Button variant="tinted" icon="shield" onClick={confirmSafety}>{t('Confirm health answers')}</Button>}
    {clinician && <div className="nmedical" role="note">
      <Icon name="shield" />
      <div><strong>{t('Own targets need review')}</strong><br />
        <span>{t('The fields are your own targets. Scientific references appear automatically when applicable, but are not copied into targets. For diabetes, illness or medication, review own targets with your care team.')}</span></div>
    </div>}
    <div className="nreference-note" role="note">
      {t('References are general source values, not personal treatment targets or medical advice. Your care plan and advice from your care team take priority.')}
    </div>

    <h4 className="sec">{t('Own targets')}</h4>
    <div className="nreference-note">
      {t('These fields are yours. A value copied from the plan is marked as such until you edit it.')}{' '}
      <a href="https://pub.norden.org/nord2023-003/recommendations.html" target="_blank" rel="noopener">
        {t('Source: Nordic Nutrition Recommendations 2023')}
      </a>
      <br />{t('Carbohydrate grams exclude fibre, matching EU food labels. The conversion reserves fibre energy using the NNR minimum of 3 g/MJ.')}
    </div>
    <div className="ntargets">
      {NUTRIENT_TARGETS.map(key => {
        const paused = referenceState.pausedTargets.includes(key)
        const references = dailyNutritionReferences(referenceState, key)
        const planned = !paused && !plan.blocked ? plan.values[key] : null
        return <label key={key} className={paused ? 'paused' : ''}>
          <span className="ntarget-copy">
            <span className="ntarget-name">{t(NUTRIENT_NAME[key])}</span>
            {planned != null && <small className="ntarget-reference ntarget-calculated">
              <span className="ntarget-reference-value">{t(adopted.includes(key)
                ? 'From the calculated plan: {0}'
                : 'Calculated plan: {0}',
              `${limitPrefix(key)}${formatPlanAmount(planned, key, dateLocale())} ${NUTRIENT_UNIT[key]}`)}</span>
            </small>}
            {references.map(reference => <small className="ntarget-reference" key={reference.id}>
              <span className="ntarget-reference-value">{t(reference.layer === 'adult'
                ? 'General adult reference: {0}'
                : reference.kind === 'example' ? 'Source example: {0}' : 'Weight-treatment reference: {0}',
              formatNutritionReference(reference, dateLocale(), t(reference.unit)))}</span>
              <span> · {t(reference.source)}</span>
            </small>)}
            {!paused && references.length === 0 && key === 'sugar' && <small className="ntarget-reference">
              {t('No comparable source target — Dagsnav logs total sugar while the source concerns added and free sugar.')}
            </small>}
            {paused && <small className="ntarget-paused">{t('Paused — needs review')}</small>}
          </span>
          <span className="nwith-unit">
            <NumberField id={`nutrition-target-${key}`} className="input" value={profile.targets[key]} nullable
              placeholder={planned == null ? t('Own target') : suggestion(key, planned)}
              aria-label={planned == null
                ? t('Daily target for {0}', t(NUTRIENT_NAME[key]))
                : t('Daily target for {0}. Suggested: {1} {2}', t(NUTRIENT_NAME[key]),
                  suggestion(key, planned), NUTRIENT_UNIT[key])}
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

/* ======================= where one number came from ======================= */

// Sourcing used to sit under every field, which meant the reader had to walk past three
// citations to reach the figure they came for. It is all still here, one tap away, with
// the arithmetic spelled out rather than summarised — a number you cannot reconstruct is
// a number you have to take on faith, and this screen has no business asking for that.

const PLAN_RULE = {
  kcal: 'Resting energy from the NNR 2023 Henry equation, multiplied by your activity level.',
  carb: 'The energy left over once protein, fat and fibre are covered. This is why the figure is one number rather than the 45–60 E% population interval.',
  prot: 'Grams per kilo of reference weight, from the NNR protein recommendation for your age and goal.',
  fat: '30% of the day’s energy — the middle of the NNR 25–40 E% interval.',
  fib: '3 g per MJ of energy, the NNR minimum.',
  sat: 'Under 10% of the day’s energy, the NNR maximum.',
  salt: 'The NNR maximum, equivalent to 2.3 g of sodium.'
}
const LIMIT_NOTE = {
  min: 'This is a floor to reach, not a ceiling. Going over it is not a problem.',
  max: 'This is a ceiling to stay under, not an amount to reach.',
  target: 'This is a figure to land near across the day.'
}

function GoalInfoSheet({ row, profile, plan, referenceState, close }) {
  const key = row.key
  const unit = NUTRIENT_UNIT[key]
  const references = (referenceState?.references || []).filter(reference => reference.nutrient === key)
  const energy = plan?.energy

  return <>
    <h3>{t(NUTRIENT_NAME[key])}</h3>
    <div className="nbmr">
      <span className="nbmr-icon"><Icon name="target" /></span>
      <div className="grow">
        <div className="small dim">{t(row.source === 'own' ? 'Your own target' : 'Calculated plan')}</div>
        <div className="nbmr-value">{row.goal == null ? '—' : `${limitPrefix(key)}${formatPlanAmount(row.goal, key, dateLocale())} ${unit}`}</div>
        <div className="dim small">{t(LIMIT_NOTE[row.limit] || LIMIT_NOTE.target)}</div>
      </div>
    </div>

    <h4 className="sec">{t('Where this number comes from')}</h4>
    {row.source === 'own'
      ? <p className="muted small" style={{ lineHeight: 1.5 }}>
        {t('You entered this target yourself. Nothing calculated replaces it.')}
      </p>
      : <>
        <p className="muted small" style={{ lineHeight: 1.5 }}>{t(PLAN_RULE[key] || '')}</p>
        {key === 'kcal' && energy && <div className="nai-preview">
          <div><span>{t('Estimated resting energy')}</span><strong>{t('≈ {0} kcal/day', fmtNum(energy.basal))}</strong></div>
          <div><span>{t('Activity level (PAL)')}</span><strong>{fmtNum(energy.pal)}{energy.palAssumed ? ` · ${t('assumed')}` : ''}</strong></div>
          <div><span>{t('Estimated maintenance energy')}</span><strong>{t('≈ {0} kcal/day', fmtNum(energy.maintenance))}</strong></div>
          {plan.goalBasis === 'loss_deficit' && <div><span>{t('Weight-loss deficit')}</span><strong>−{fmtNum(plan.basis.goal.deficitKcal)} kcal</strong></div>}
          {plan.goalBasis === 'muscle_surplus' && <div><span>{t('Muscle-gain surplus')}</span><strong>+{fmtNum(plan.basis.goal.surplus * 100)}%</strong></div>}
          <div><span>{t('Daily plan')}</span><strong>{t('≈ {0} kcal/day', fmtNum(energy.plan))}</strong></div>
        </div>}
        {key === 'prot' && plan?.protein && <div className="nai-preview">
          <div><span>{t('Reference weight')}</span><strong>{fmtNum(plan.protein.referenceWeightKg)} kg</strong></div>
          <div><span>{t('Protein per kilo')}</span><strong>{fmtNum(plan.protein.perKg)} g/kg</strong></div>
        </div>}
        {key === 'prot' && plan?.protein?.adjusted && <div className="dnote">
          {t('Above BMI 25 only 40% of the weight over that point is counted, so grams per kilo are not multiplied by weight that is largely fat mass.')}
        </div>}
        {key === 'kcal' && energy?.floorApplied && <div className="nmedical" role="note">
          <Icon name="info" /><div>{t('The calculation landed below 1,200 kcal/day and was raised to that floor. Use an individually reviewed energy target instead of going lower.')}</div>
        </div>}
        {key === 'kcal' && energy?.belowMicronutrientWatch && <div className="nmedical" role="note">
          <Icon name="info" /><div>{t('This plan is below 1,500 kcal/day, where the source identifies a high risk of inadequate micronutrient intake.')}</div>
        </div>}
        <div className="dnote">{t('This is an equation-based estimate, not measured expenditure, and not a treatment target.')}</div>
      </>}

    {references.length > 0 && <>
      <h4 className="sec">{t('Population references')}</h4>
      <div className="nref-list">
        {references.map(reference => <ReferenceCard key={reference.id}
          reference={reference} paused={referenceState.pausedTargets} />)}
      </div>
    </>}

    <div className="nreference-note" role="note">
      {t('References are general source values, not personal treatment targets or medical advice. Your care plan and advice from your care team take priority.')}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="tinted" icon="target" onClick={() => { close(); nutritionGoalsSheet() }}>
      {t('Open nutrition goals')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

export const nutritionGoalInfoSheet = (row, profile, plan, referenceState) =>
  useUI.getState().openSheet(close => <GoalInfoSheet row={row} profile={profile}
    plan={plan} referenceState={referenceState} close={close} />)

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

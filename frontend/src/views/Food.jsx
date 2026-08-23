// The day's food, and — where diabetes mode is on — the day's readings and doses beside it.
//
// Carbohydrate is the headline everywhere on this screen. Glucose sits next to it rather
// than on a screen of its own, because the question worth answering is what happened after
// a meal, and two screens is where that question goes to die.

import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import { todayISO, isoOf, fmtNum } from '../lib/format.js'
import { foodMap, hasFoodDb, FOODS_SOURCE } from '../lib/foods.js'
import { mealsOn, dayTotals, mealTotals, nutrientTotal, MEAL_NAME } from '../lib/nutrition.js'
import { coachProfileOf } from '../lib/coach-profile.js'
import { lastBW } from '../lib/history.js'
import {
  cleanNutritionProfile, nutritionAiGate, nutritionReferenceState,
  nutritionSafetyToday, weightKgOf
} from '../lib/nutrition-goals.js'
import {
  HEADLINE_NUTRIENTS, PROGRESS_NUTRIENTS, nutritionDayPlan, nutritionDayRows
} from '../lib/nutrition-plan.js'
import { diabetesOn, healthOf, glucoseOn, dosesOn, doseTotals, timeInRange, TAG_NAME, DOSE_NAME } from '../lib/diabetes.js'
import { mealSheet, quickLogSheet, mealDetailSheet, ownFoodSheet, deleteMyMeal, Macros } from '../food-sheets.jsx'
import { nutritionAssistSheet, nutritionGoalInfoSheet, nutritionGoalsSheet } from '../nutrition-sheets.jsx'
import { glucoseSheet, doseSheet, entrySheet, Reading } from '../glucose-sheets.jsx'
import { Button } from '../components/ui.jsx'
import DayGoals, { GoalRow } from '../components/DayGoals.jsx'
import Icon from '../components/Icon.jsx'

const shift = (iso, days) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return isoOf(d)
}

const foodValue = (food, key) => {
  const value = food?.per100?.[key]
  return value == null || String(value).trim() === '' ? '—' : fmtNum(value)
}

// One missing field at a time, named, with the button that fixes it. The screen used to
// show two paragraphs listing everything the estimate could possibly need, because a bare
// null was all it had to go on — which meant nobody could tell whether the thing standing
// in the way was their age or a weight logged before units were stored.
const BLOCKED_TEXT = {
  goal_missing: 'Choose a nutrition goal to get daily values to follow.',
  age_missing: 'Add your age in Nutrition goals to calculate daily values.',
  age_not_adult: 'Daily values for under-18s belong with a care team, so Dagsnav does not estimate them.',
  sex_missing: 'Choose the sex the resting-energy equation should use.',
  height_missing: 'Add your height in Nutrition goals to calculate daily values.',
  weight_missing: 'Log a body weight to calculate daily values.',
  weight_unit_unknown: 'Your last weight was logged without a unit. Enter it again in Nutrition goals.',
  safety_unanswered: 'Answer the two health questions in Nutrition goals to show daily values.',
  safety_expired: 'Confirm your health answers again — the last review is over 90 days old.',
  clinical_review: 'Daily values are paused because your health answers need professional adaptation.',
  estimate_unavailable: 'Add age, sex, height and a logged weight to calculate daily values.'
}

function BlockedNote({ blocked }) {
  const text = BLOCKED_TEXT[blocked.reason]
  if (!text) return null
  return <div className="dblocked" role="note">
    <Icon name={blocked.fix === 'clinician' ? 'shield' : 'target'} />
    <div>
      {t(text)}
      {blocked.fix !== 'clinician' && <div style={{ marginTop: 8 }}>
        <Button size="sm" variant="tinted" onClick={nutritionGoalsSheet}>{t('Open nutrition goals')}</Button>
      </div>}
    </div>
  </div>
}

function NutrientDetails({ rows, onInfo }) {
  const incomplete = rows.some(row => row.complete === false)
  return <details className="nutrient-details">
    <summary>
      <span>{t('All nutrients')}</span>
      {incomplete && <span className="nutrient-incomplete">{t('Incomplete')}</span>}
    </summary>
    <div className="dgoals" style={{ padding: '4px 0 12px' }}>
      {rows.map(row => <GoalRow key={row.key} row={row} compact onInfo={onInfo} />)}
    </div>
  </details>
}

export default function Food() {
  const S = useStore(s => s.S)
  const [day, setDay] = useState(todayISO())
  const foods = foodMap(S)
  const meals = mealsOn(S, day)
  const totals = dayTotals(S, day, foods)
  const dia = diabetesOn(S)
  const goals = cleanNutritionProfile(S.nutritionGoals)
  const person = coachProfileOf(S)
  const safetyToday = nutritionSafetyToday()
  const bw = lastBW(S)
  const plan = nutritionDayPlan(goals, {
    sex: person.sex, age: person.age, heightCm: person.heightCm,
    weightKg: weightKgOf(bw), weightLogged: !!bw, today: safetyToday
  })
  const referenceState = nutritionReferenceState(goals, { age: person.age, today: safetyToday })
  // Carbohydrate leads for anyone counting it; energy leads for everyone else. Same rows,
  // and the one being counted is the one at the top.
  const headline = dia
    ? ['carb', ...HEADLINE_NUTRIENTS.filter(key => key !== 'carb')]
    : HEADLINE_NUTRIENTS
  const rows = nutritionDayRows(goals, plan, totals, headline)
  const restRows = nutritionDayRows(goals, plan, totals,
    PROGRESS_NUTRIENTS.filter(key => !headline.includes(key)))
  const tracked = rows.some(row => row.goal != null)
  const openInfo = row => nutritionGoalInfoSheet(row, goals, plan, referenceState)
  const localNotes = nutritionAiGate(goals, {
    age: person.age, today: safetyToday, diabetes: dia
  })
  const isToday = day === todayISO()

  const h = healthOf(S)
  const readings = dia ? glucoseOn(S, day) : []
  const doses = dia ? dosesOn(S, day) : []
  const dTot = doseTotals(doses)
  const tir = timeInRange(readings, h.target)

  return <>
    <div className="hdr"><div>
      <h1>{t('Food')}</h1>
      <div className="sub">{new Date(day + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div><button className="iconbtn" onClick={nutritionGoalsSheet} aria-label={t('Nutrition goals')}
      style={goals.goal ? { color: 'var(--acc)' } : undefined}><Icon name="target" /></button></div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="btn ghost icon" onClick={() => setDay(shift(day, -1))} aria-label={t('Prev')}>
          <Icon name="chevronLeft" />
        </button>
        <span className="dim small">{isToday ? t('Today') : day}</span>
        <button className="btn ghost icon" disabled={isToday}
          onClick={() => setDay(shift(day, 1))} aria-label={t('Next')}>
          <Icon name="chevronRight" />
        </button>
      </div>
      {tracked ? <DayGoals rows={rows} onInfo={openInfo} /> : <Macros totals={totals} big />}
      {plan.blocked && <BlockedNote blocked={plan.blocked} />}
      {plan.reviewRequired && <div className="nmedical" role="note">
        <Icon name="shield" /><div>
          {t('Your own targets stay paused until you confirm that you have reviewed them.')}
          <div style={{ marginTop: 8 }}><Button size="sm" variant="tinted" onClick={nutritionGoalsSheet}>
            {t('Open nutrition goals')}
          </Button></div>
        </div>
      </div>}
      {!plan.blocked && plan.energy.belowMicronutrientWatch && <div className="dnote">
        {t('This plan is below 1,500 kcal/day, where the source identifies a high risk of inadequate micronutrient intake.')}
      </div>}
      {referenceState.notices.filter(notice => notice.code !== 'targets:review').map(notice =>
        <div key={notice.code} className="nmedical" role={notice.severity === 'alert' ? 'alert' : 'note'}>
          <Icon name={notice.severity === 'alert' ? 'info' : 'shield'} />
          <div>{t(notice.message)}</div>
        </div>)}
      {restRows.length > 0 && <NutrientDetails rows={restRows} onInfo={openInfo} />}
      {meals.length > 0 && goals.goal && <div style={{ marginTop: 10 }}>
        <Button size="sm" variant="tinted" icon={localNotes ? 'shield' : 'sparkles'} onClick={() => nutritionAssistSheet(day, totals)}>
          {t(localNotes ? 'Care-team notes' : 'Explain with AI')}
        </Button>
      </div>}
      {dia && (readings.length > 0 || dTot.total > 0) && <div className="row" style={{ gap: 14, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--sep)' }}>
        {readings.length > 0 && <span className="dim small">
          {t(readings.length === 1 ? '{0} reading' : '{0} readings', readings.length)} · {t('{0}% in range', fmtNum(tir.withinPct))}
        </span>}
        {dTot.total > 0 && <span className="dim small">{t('{0} units of insulin', fmtNum(dTot.total))}</span>}
      </div>}
      {!meals.length && !readings.length && !doses.length &&
        <div className="dim small" style={{ marginTop: 10 }}>{t('Nothing logged yet')}</div>}
    </div>

    {isToday && <div className="card">
      <Button variant="primary" icon="star" onClick={quickLogSheet}>{t('My meals')}</Button>
      <div style={{ height: 8 }} />
      <Button icon="plus" onClick={() => mealSheet()}>{t('Log a meal')}</Button>
      {dia && <>
        <div style={{ height: 8 }} />
        <Button icon="dot" onClick={() => glucoseSheet()}>{t('Log a reading')}</Button>
        <div style={{ height: 8 }} />
        <Button icon="plus" onClick={() => doseSheet()}>{t('Log a dose')}</Button>
      </>}
    </div>}

    {meals.length > 0 && <div className="card">
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{t('Meals')}</h2>
      {meals.map(m => {
        const tot = mealTotals(m, foods)
        return <button key={m.id} className="lrow tap" onClick={() => mealDetailSheet(m)}>
          <span className="lrow-m">
            <span className="lrow-t">{t(MEAL_NAME[m.kind] || 'Meal')} <span className="dim">· {m.t}</span></span>
            <span className="lrow-s">
              {(m.items || []).map(i => (foods[i.fid] || {}).n).filter(Boolean).join(', ') || t('Unknown food')}
            </span>
          </span>
          <span style={{ textAlign: 'right', flex: 'none' }}>
            <span style={{ fontWeight: 600 }}>{nutrientTotal(tot, 'carb') == null ? '—' : fmtNum(tot.carb)}</span>
            <span className="dim small"> g</span>
          </span>
        </button>
      })}
    </div>}

    {dia && readings.length > 0 && <div className="card">
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{t('Readings')}</h2>
      {readings.map(g => <button key={g.id} className="lrow tap" onClick={() => entrySheet(g, 'glucose')}>
        <span className="lrow-m">
          <span className="lrow-t">{g.t}</span>
          {g.tag && <span className="lrow-s">{t(TAG_NAME[g.tag])}</span>}
        </span>
        <Reading v={g.v} unit={h.gUnit} target={h.target} />
      </button>)}
      <div className="dim small" style={{ marginTop: 8 }}>
        {t('{0} in range, {1} below, {2} above', tir.within, tir.below, tir.above)}
      </div>
    </div>}

    {dia && doses.length > 0 && <div className="card">
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{t('Insulin')}</h2>
      {doses.map(x => <button key={x.id} className="lrow tap" onClick={() => entrySheet(x, 'dose')}>
        <span className="lrow-m">
          <span className="lrow-t">{x.t}</span>
          <span className="lrow-s">{t(DOSE_NAME[x.kind] || 'Meal dose')}</span>
        </span>
        <span style={{ fontWeight: 600 }}>{fmtNum(x.u)}<span className="dim small"> {t('units')}</span></span>
      </button>)}
      <div className="dim small" style={{ marginTop: 8 }}>
        {t('{0} units in total', fmtNum(dTot.total))}
      </div>
    </div>}

    {(S.myMeals || []).length > 0 && <div className="card">
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{t('Saved meals')}</h2>
      {(S.myMeals || []).map(m => <div key={m.id} className="row between" style={{ padding: '9px 0', borderTop: '1px solid var(--sep)' }}>
        <span className="grow" style={{ minWidth: 0 }}>{m.n}</span>
        <button className="btn ghost icon" onClick={() => deleteMyMeal(m)} aria-label={t('Remove')}>
          <Icon name="trash" />
        </button>
      </div>)}
    </div>}

    <div className="card">
      <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>{t('My foods')}</h2>
      {(S.myFoods || []).map(f => <button key={f.id} className="lrow tap" onClick={() => ownFoodSheet(f)}>
        <span className="lrow-m">
          <span className="lrow-t">{f.n}</span>
          <span className="lrow-s">{foodValue(f, 'carb')} g {t('Carbs')} · {foodValue(f, 'kcal')} kcal {t('per 100 g')}</span>
        </span>
        <Icon name="chevronRight" className="lrow-k" />
      </button>)}
      <div style={{ height: 10 }} />
      <Button icon="plus" onClick={() => ownFoodSheet()}>{t('Create my own food')}</Button>
      {/* Said once, where it matters, rather than as a banner on every screen. */}
      <div className="dim small" style={{ marginTop: 12, lineHeight: 1.45 }}>
        {hasFoodDb()
          ? t('Food data: {0}, {1}.', FOODS_SOURCE?.name || '—', FOODS_SOURCE?.licence || '—')
          : t('The bundled food database is not built on this instance — run scripts/build-foods.mjs to add it. Your own foods work either way.')}
      </div>
    </div>
  </>
}

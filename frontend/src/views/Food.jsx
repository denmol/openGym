// The day's food, and — where diabetes mode is on — the day's readings and doses beside it.
//
// Carbohydrate is the headline everywhere on this screen. Glucose sits next to it rather
// than on a screen of its own, because the question worth answering is what happened after
// a meal, and two screens is where that question goes to die.

import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import { todayISO, isoOf, fmtNum } from '../lib/format.js'
import { foodMap, hasFoodDb, FOODS_SOURCE, NUTRIENTS, NUTRIENT_NAME, NUTRIENT_UNIT } from '../lib/foods.js'
import { mealsOn, dayTotals, mealTotals, nutrientTotal, MEAL_NAME } from '../lib/nutrition.js'
import { coachProfileOf } from '../lib/coach-profile.js'
import {
  cleanNutritionProfile, dailyNutritionReferences, formatNutritionReference, nutritionAiGate,
  nutritionReferenceState, nutritionSafetyToday
} from '../lib/nutrition-goals.js'
import { diabetesOn, healthOf, glucoseOn, dosesOn, doseTotals, timeInRange, TAG_NAME, DOSE_NAME } from '../lib/diabetes.js'
import { mealSheet, quickLogSheet, mealDetailSheet, ownFoodSheet, deleteMyMeal, Macros } from '../food-sheets.jsx'
import { nutritionAssistSheet, nutritionGoalsSheet } from '../nutrition-sheets.jsx'
import { glucoseSheet, doseSheet, entrySheet, Reading } from '../glucose-sheets.jsx'
import { Button } from '../components/ui.jsx'
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

function NutrientDetails({ totals, goals, referenceState }) {
  const incomplete = NUTRIENTS.some(key => nutrientTotal(totals, key) == null)
  return <details className="nutrient-details">
    <summary>
      <span>{t('All nutrients')}</span>
      {incomplete && <span className="nutrient-incomplete">{t('Incomplete')}</span>}
    </summary>
    <dl>
      {NUTRIENTS.map(key => {
        const value = nutrientTotal(totals, key)
        const target = goals.targets[key]
        const paused = referenceState.pausedTargets.includes(key)
        const references = dailyNutritionReferences(referenceState, key)
        return <div key={key} className={value == null ? 'incomplete' : ''}>
          <dt>{t(NUTRIENT_NAME[key])}</dt>
          <dd>
            {value == null ? <><span>—</span><small>{t('Some logged foods are missing this value.')}</small></>
              : <span>{fmtNum(value)} {NUTRIENT_UNIT[key]}</span>}
            {target != null && <small className={paused ? 'paused-target' : ''}>
              {paused
                ? t('Own target: Paused — needs review')
                : t('Own target: {0} {1}', fmtNum(target), NUTRIENT_UNIT[key])}
            </small>}
            {references.map(reference => <small key={reference.id}>
              {t(reference.kind === 'example' ? 'Source example: {0}' : 'Reference: {0}',
                formatNutritionReference(reference, dateLocale(), t(reference.unit)))}
              {' · '}<a href={reference.sourceUrl} target="_blank" rel="noopener">{t(reference.source)}</a>
            </small>)}
          </dd>
        </div>
      })}
    </dl>
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
  const referenceState = nutritionReferenceState(goals, { age: person.age, today: safetyToday })
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
      <Macros totals={totals} big />
      {referenceState.notices.map(notice => <div key={notice.code} className="nmedical"
        role={notice.severity === 'alert' ? 'alert' : 'note'}>
        <Icon name={notice.severity === 'alert' ? 'info' : 'shield'} />
        <div>{t(notice.message)}</div>
      </div>)}
      {meals.length > 0 && <NutrientDetails totals={totals} goals={goals} referenceState={referenceState} />}
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

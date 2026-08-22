// The day's food. Carbohydrate is the headline everywhere on this screen.

import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import { todayISO, isoOf, fmtNum } from '../lib/format.js'
import { foodMap, hasFoodDb, FOODS_SOURCE } from '../lib/foods.js'
import { mealsOn, dayTotals, mealTotals, MEAL_NAME } from '../lib/nutrition.js'
import { mealSheet, quickLogSheet, mealDetailSheet, ownFoodSheet, deleteMyMeal, Macros } from '../food-sheets.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const shift = (iso, days) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return isoOf(d)
}

export default function Food() {
  const S = useStore(s => s.S)
  const [day, setDay] = useState(todayISO())
  const foods = foodMap(S)
  const meals = mealsOn(S, day)
  const totals = dayTotals(S, day, foods)
  const isToday = day === todayISO()

  return <>
    <div className="hdr"><div>
      <h1>{t('Food')}</h1>
      <div className="sub">{new Date(day + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div></div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="btn ghost" style={{ padding: 6 }} onClick={() => setDay(shift(day, -1))} aria-label={t('Prev')}>
          <Icon name="chevronLeft" />
        </button>
        <span className="dim small">{isToday ? t('Today') : day}</span>
        <button className="btn ghost" style={{ padding: 6 }} disabled={isToday}
          onClick={() => setDay(shift(day, 1))} aria-label={t('Next')}>
          <Icon name="chevronRight" />
        </button>
      </div>
      <Macros totals={totals} big />
      {!meals.length && <div className="dim small" style={{ marginTop: 10 }}>{t('Nothing logged yet')}</div>}
    </div>

    {isToday && <div className="card">
      <Button variant="primary" icon="star" onClick={quickLogSheet}>{t('My meals')}</Button>
      <div style={{ height: 8 }} />
      <Button icon="plus" onClick={() => mealSheet()}>{t('Log a meal')}</Button>
    </div>}

    {meals.length > 0 && <div className="card">
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{t('Today')}</h2>
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
            <span style={{ fontWeight: 600 }}>{fmtNum(tot.carb)}</span>
            <span className="dim small"> g</span>
          </span>
        </button>
      })}
    </div>}

    {(S.myMeals || []).length > 0 && <div className="card">
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>{t('Saved meals')}</h2>
      {(S.myMeals || []).map(m => <div key={m.id} className="row between" style={{ padding: '9px 0', borderTop: '1px solid var(--sep)' }}>
        <span className="grow" style={{ minWidth: 0 }}>{m.n}</span>
        <button className="btn ghost" style={{ padding: 6, flex: 'none' }} onClick={() => deleteMyMeal(m)} aria-label={t('Remove')}>
          <Icon name="trash" />
        </button>
      </div>)}
    </div>}

    <div className="card">
      <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>{t('My foods')}</h2>
      {(S.myFoods || []).map(f => <button key={f.id} className="lrow tap" onClick={() => ownFoodSheet(f)}>
        <span className="lrow-m">
          <span className="lrow-t">{f.n}</span>
          <span className="lrow-s">{fmtNum(f.per100.carb ?? 0)} g {t('Carbs')} · {fmtNum(f.per100.kcal ?? 0)} kcal {t('per 100 g')}</span>
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

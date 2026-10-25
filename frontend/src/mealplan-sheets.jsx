// The meal plan: a week built from the meals you have saved, each day close to your targets.
//
// Everything on this screen is arithmetic over the person's own foods (lib/mealplan.js); there
// is no model and so no key to configure. When a schedule can't responsibly be made — a safety
// review that isn't current or shows a flag, diabetes mode, a minor — the sheet says so and
// points at a person, instead of showing a weaker version of the same thing.

import { useMemo } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t, dateLocale } from './lib/i18n.js'
import { todayISO, fmtNum } from './lib/format.js'
import { Button } from './components/ui.jsx'
import Icon from './components/Icon.jsx'
import { MEAL_NAME } from './lib/nutrition.js'
import { foodMap } from './lib/foods.js'
import {
  mealPlanTargets, candidateMeals, generateMealPlan, resolveDay, summarize, shoppingList,
  logPlannedMeal, reshuffleDay, planCaveats, CLOSE_PCT
} from './lib/mealplan.js'
import { nutritionGoalsSheet } from './nutrition-sheets.jsx'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()

const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })

// Why there is no plan, in words, and what the person can do about it.
const BLOCKED = {
  review: ['Meal plans are only made when your nutrition safety review is current and shows nothing flagged: no medical condition, medication, diabetes mode or weight-loss drug, and an adult age. If any of that applies, a schedule is a job for a dietitian or your care team.', 'clinician'],
  paused: ['A target is paused for safety, so no schedule is made. Your care team can set the numbers.', 'clinician'],
  goal_missing: ['Set your nutrition goal first. The plan is built to hit your daily targets.', 'goals'],
  age_missing: ['Add your age in your training profile, then set your nutrition goals.', 'goals'],
  age_not_adult: ['Meal plans are for adults. For a young person, talk to a clinician or dietitian.', 'clinician'],
  sex_missing: ['Add your sex in your training profile so your daily targets can be worked out.', 'goals'],
  height_missing: ['Add your height in your training profile so your daily targets can be worked out.', 'goals'],
  weight_missing: ['Log your body weight so your daily targets can be worked out.', 'goals'],
  weight_unit_unknown: ['Log your body weight again so its unit is known.', 'goals'],
  safety_unanswered: ['Answer the nutrition safety questions first.', 'goals'],
  safety_expired: ['Your nutrition safety review has expired. Confirm it again.', 'goals'],
  clinical_review: ['Your targets are paused for review, so no schedule is made. Your care team can set the numbers.', 'clinician'],
  no_energy: ['Set a daily energy target in your nutrition goals first.', 'goals']
}

const CAVEAT = {
  no_breakfast: 'You have no saved breakfast, so the plan has no breakfast.',
  no_snack: 'You have no saved snack, so the plan has none.',
  few_meals: 'With so few saved meals, things will repeat. A handful more makes a better week.',
  excluded: 'Some saved meals were left out because a food in them is missing energy, protein, carbohydrate or fat values.',
  poor_fit: 'Your saved meals can’t get close to your targets on most days. Saving a few lighter or heavier ones helps.'
}

function Notice({ children, action }) {
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="small" style={{ lineHeight: 1.5 }}>{children}</div>
    {action && <div style={{ marginTop: 10 }}>{action}</div>}
  </div>
}

function ShoppingList({ close }) {
  const S = useStore(s => s.S)
  const list = useMemo(() => (S.mealPlan ? shoppingList(S, S.mealPlan) : []), [S.mealPlan, S.myMeals, S.myFoods])
  return <>
    <h3>{t('Shopping list')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>{t('Everything the week needs, in grams, as the plan has it. Foods are listed as you saved them.')}</div>
    {list.map(x => <div key={x.fid} className="row between" style={{ padding: '8px 0', borderTop: '1px solid var(--sep)' }}>
      <span>{x.name}</span><span className="muted">{fmtNum(x.g)} g</span>
    </div>)}
    {!list.length && <div className="muted small">{t('Nothing planned yet.')}</div>}
    <div style={{ height: 14 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>
}

function DayCard({ S, day, i, targets, foods }) {
  const r = resolveDay(S, day, foods)
  const past = day.d < todayISO()
  const anyLogged = day.slots.some(s => s.logged)
  const dev = Math.abs(r.totals.kcal - targets.kcal) / targets.kcal * 100
  const log = si => {
    let ok = false
    update(s => { ok = logPlannedMeal(s, i, si) })
    ui().toast(ok ? t('Logged') : t('That meal is gone from your saved meals'))
  }
  const shuffle = () => {
    const next = reshuffleDay(S, S.mealPlan, i, Math.floor(Math.random() * 1e6))
    if (next.ok) update(s => { s.mealPlan = next.plan })
  }
  return <div className="card" style={{ marginBottom: 10, opacity: past && !anyLogged ? 0.6 : 1 }}>
    <div className="row between" style={{ marginBottom: 6 }}>
      <div className="tt" style={{ fontSize: 16 }}>{dayLabel(day.d)}{day.d === todayISO() && <span className="tag acc nocap" style={{ marginLeft: 8 }}>{t('Today')}</span>}</div>
      <button className="iconbtn" aria-label={t('Shuffle this day')} disabled={anyLogged} style={anyLogged ? { opacity: 0.35 } : undefined} onClick={shuffle}><Icon name="shuffle" /></button>
    </div>
    {r.slots.map((s, si) => <div key={si} className="row between" style={{ gap: 10, padding: '7px 0', borderTop: '1px solid var(--sep)' }}>
      <div style={{ minWidth: 0 }}>
        <div className="dim small">{t(MEAL_NAME[s.kind])}</div>
        <div style={{ lineHeight: 1.25 }}>{s.missing ? <span className="dim">{t('A meal that has been deleted')}</span> : s.name}
          {!s.missing && s.scale !== 1 && <span className="dim"> ×{fmtNum(s.scale)}</span>}</div>
        {!s.missing && <div className="dim small">{fmtNum(Math.round(s.t.kcal))} kcal · {fmtNum(Math.round(s.t.prot))} g {t('Protein')}</div>}
      </div>
      {s.missing ? null : s.logged
        ? <Icon name="checkCircle" style={{ color: 'var(--green-t)', fontSize: 22, flex: 'none' }} />
        : <button className="iconbtn" aria-label={t('Log this meal')} onClick={() => log(si)}><Icon name="plus" /></button>}
    </div>)}
    <div className="small dim" style={{ marginTop: 6, lineHeight: 1.4 }}>
      {t('{0} kcal against a target of {1}', fmtNum(Math.round(r.totals.kcal)), fmtNum(Math.round(targets.kcal)))}
      {' · '}{t('{0} g protein', fmtNum(Math.round(r.totals.prot)))}
      {r.complete && dev > CLOSE_PCT && <span style={{ color: 'var(--yellow-t)' }}> · {t('off by {0}%', Math.round(dev))}</span>}
    </div>
  </div>
}

function MealPlan({ close }) {
  const S = useStore(s => s.S)
  const foods = foodMap(S)
  const gate = mealPlanTargets(S)
  const cands = useMemo(() => candidateMeals(S, foodMap(S)), [S.myMeals, S.myFoods])
  const plan = S.mealPlan
  const ended = plan && plan.days.length && plan.days[plan.days.length - 1].d < todayISO()
  const summary = gate.ok && plan ? summarize(S, plan, gate.targets, foods) : null
  const caveats = gate.ok && plan ? planCaveats(S, summary, foods) : []

  const make = () => {
    const r = generateMealPlan(S, { seed: plan ? (plan.seed || 0) + 1 : 0 })
    if (!r.ok) { ui().toast(t('No plan could be made')); return }
    update(s => { s.mealPlan = r.plan })
  }
  const remove = () => update(s => { s.mealPlan = null })

  const [blockText, blockFix] = !gate.ok ? (BLOCKED[gate.reason] || BLOCKED.goal_missing) : []
  const notEnough = gate.ok && (!cands.pool.lunch.length)

  return <>
    <h3>{t('Meal plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.45 }}>
      {t('A week built from the meals you have saved, in portion sizes that bring each day close to your targets. It uses your own foods and numbers; no AI is involved.')}
    </div>

    {!gate.ok && <Notice action={blockFix === 'goals'
      ? <Button size="sm" icon="target" onClick={() => { close(); nutritionGoalsSheet() }}>{t('Open nutrition goals')}</Button> : null}>
      {t(blockText)}
    </Notice>}

    {notEnough && <Notice action={<Button size="sm" onClick={close}>{t('OK')}</Button>}>
      {cands.usable.length
        ? t('You have saved meals, but none for lunch or dinner. Save a few main meals you eat often.')
        : t('Save a few meals you eat often first: log a meal, then tap “Save as a meal I eat often”. Five or more makes a good week.')}
      {cands.excluded.length > 0 && ' ' + t('{0} saved meals can’t be used because a food in them is missing values.', cands.excluded.length)}
    </Notice>}

    {gate.ok && !notEnough && !plan && <div className="card" style={{ marginBottom: 12 }}>
      <div className="small" style={{ lineHeight: 1.5, marginBottom: 10 }}>
        {t('{0} of your saved meals can be used.', cands.usable.length)}
        {cands.excluded.length > 0 && ' ' + t('{0} are left out because a food in them is missing values.', cands.excluded.length)}
      </div>
      <Button variant="primary" icon="forkKnife" onClick={make}>{t('Make my week')}</Button>
    </div>}

    {gate.ok && plan && summary && <>
      {ended && <Notice action={<Button size="sm" variant="primary" onClick={make}>{t('Make a new week')}</Button>}>{t('This plan has ended.')}</Notice>}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="small" style={{ lineHeight: 1.5 }}>
          {t('{0} of {1} days land within {2}% of your energy target.', summary.closeDays, summary.days, CLOSE_PCT)}
          {' '}{t('{0} different meals.', summary.distinctMeals)}
          {summary.proteinDays != null && ' ' + t('Protein reaches your target on {0} days.', summary.proteinDays)}
        </div>
        {caveats.map(c => <div key={c} className="small" style={{ color: 'var(--yellow-t)', marginTop: 6, lineHeight: 1.4 }}>{t(CAVEAT[c])}</div>)}
      </div>
      {plan.days.map((d, i) => <DayCard key={d.d} S={S} day={d} i={i} targets={gate.targets} foods={foods} />)}
      <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <Button size="sm" icon="reset" onClick={make}>{t('Make a new week')}</Button>
        <Button size="sm" icon="list" onClick={() => ui().openSheet(c => <ShoppingList close={c} />)}>{t('Shopping list')}</Button>
        <Button size="sm" icon="trash" onClick={remove}>{t('Remove plan')}</Button>
      </div>
    </>}

    <div className="dim small" style={{ lineHeight: 1.45, margin: '14px 2px 6px' }}>
      {t('General nutrition information, not medical advice. For a medical condition, medication or pregnancy, ask a dietitian or your care team.')}
    </div>
  </>
}

export const mealPlanSheet = () => ui().openSheet(close => <MealPlan close={close} />)

/** The Food screen's card: today's planned meals, one tap each, or the way in. */
export function MealPlanCard() {
  const S = useStore(s => s.S)
  const plan = S.mealPlan
  const idx = plan ? plan.days.findIndex(d => d.d === todayISO()) : -1
  const today = idx >= 0 ? resolveDay(S, plan.days[idx], foodMap(S)) : null
  const log = si => {
    let ok = false
    update(s => { ok = logPlannedMeal(s, idx, si) })
    ui().toast(ok ? t('Logged') : t('That meal is gone from your saved meals'))
  }
  return <div className="card">
    <div className="row between" style={{ marginBottom: today ? 6 : 0 }}>
      <h2 style={{ margin: 0, fontSize: 17 }}>{today ? t('Planned for today') : t('Meal plan')}</h2>
      <Button size="sm" icon="forkKnife" onClick={mealPlanSheet}>{plan ? t('Open') : t('Plan my week')}</Button>
    </div>
    {today && today.slots.map((s, si) => <div key={si} className="row between" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--sep)' }}>
      <span style={{ minWidth: 0 }}>
        <span className="dim small" style={{ display: 'block' }}>{t(MEAL_NAME[s.kind])}</span>
        {s.missing ? <span className="dim">{t('A meal that has been deleted')}</span> : <>{s.name}{s.scale !== 1 && <span className="dim"> ×{fmtNum(s.scale)}</span>}</>}
      </span>
      {s.missing ? null : s.logged
        ? <Icon name="checkCircle" style={{ color: 'var(--green-t)', fontSize: 22, flex: 'none' }} />
        : <button className="iconbtn" aria-label={t('Log this meal')} onClick={() => log(si)}><Icon name="plus" /></button>}
    </div>)}
    {!plan && <div className="dim small" style={{ marginTop: 6, lineHeight: 1.4 }}>{t('Build a week from your saved meals, close to your daily targets.')}</div>}
  </div>
}

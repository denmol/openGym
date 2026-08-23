// Logging what was eaten.
//
// The whole design answers one question: how does someone who counts carbohydrate every day
// still be logging in March? The answer is not a better search box — it is that the meal
// they eat four mornings a week is one tap, not eleven. Search exists for the other days.

import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { uid, fmtNum } from './lib/format.js'
import { Button, Segmented, Stepper } from './components/ui.jsx'
import Icon from './components/Icon.jsx'
import { searchFoods, foodMap, foodOf, hasFoodDb, cleanPer100, NUTRIENTS, NUTRIENT_NAME, NUTRIENT_UNIT } from './lib/foods.js'
import { scanSheet } from './barcode-sheets.jsx'
import { totalsOf, nutrientTotal, newMeal, scaleItems, MEAL_KINDS, MEAL_NAME, kindForNow } from './lib/nutrition.js'
import {
  unitsFor, unitById, gramsOf, lastAmounts, defaultAmount, amountLabel,
  newPortion, densityFor, UNIT_LABEL
} from './lib/portions.js'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const totalText = (totals, key) => {
  const value = nutrientTotal(totals, key)
  return value == null ? '—' : fmtNum(value)
}
const foodText = (food, key) => {
  const value = food?.per100?.[key]
  return value == null || String(value).trim() === '' ? '—' : fmtNum(value)
}

/** Carbohydrate first and large, everything else after — the order this app reads in. */
export function Macros({ totals, big }) {
  return <div className="row" style={{ gap: big ? 14 : 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
    <div>
      <span style={{ fontSize: big ? 26 : 17, fontWeight: 700 }}>{totalText(totals, 'carb')}</span>
      <span className="dim" style={{ fontSize: big ? 14 : 12, marginLeft: 3 }}>g {t('Carbs')}</span>
    </div>
    <span className="dim small">{totalText(totals, 'kcal')} kcal</span>
    <span className="dim small">{t('Protein')} {totalText(totals, 'prot')} g</span>
    <span className="dim small">{t('Fat')} {totalText(totals, 'fat')} g</span>
  </div>
}

/* ============================ how much of it ============================ */

// A unit's name as shown. The catalogue is Swedish and so are the measures in it, so the
// abbreviations pass through t() rather than being printed raw.
const unitName = u => (u ? t(UNIT_LABEL[u.n] || u.n) : 'g')

/**
 * "≈ 58 g" for an estimate, "58 g" for something weighed. The ≈ is doing real work, so it
 * has to mean the same thing everywhere: a suggested portion and a volume measure are both
 * approximations — one from an average, one from an assumed density — and only a portion
 * someone put on a scale is not.
 */
export const isEstimate = u => !!u && !u.base && (u.suggested || u.volume)
const grams = (u, g) => (isEstimate(u) ? '≈ ' : '') + g + ' g'
const unitWeight = u => (u.base ? null : grams(u, u.g))

function WeighForm({ food, name, close, onSaved }) {
  const [n, setN] = useState(name || '')
  const [g, setG] = useState('')
  const save = () => {
    const p = newPortion({ fid: food.id, n, g: String(g).replace(',', '.') })
    if (!p) { toast(t('Give it a name and a weight in grams.')); return }
    // Re-weighing replaces the old one rather than sitting beside it: two portions called
    // "st" for the same food is a choice nobody should be asked to make.
    update(s => {
      s.portions = [...(s.portions || []).filter(x => !(x.fid === p.fid && x.n === p.n)), p]
    })
    close()
    toast(t('1 {0} is {1} g from now on', t(UNIT_LABEL[p.n] || p.n), p.g))
    if (onSaved) onSaved(p)
  }
  return <>
    <h3>{t('Weigh it once')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Put one on the scale and type what it says. From then on Dagsnav counts yours, not an average — and you never weigh it again.')}
    </div>
    <div className="dim small" style={{ marginBottom: 10 }}>{food.n}</div>
    <div className="row" style={{ gap: 10 }}>
      <input className="input" style={{ flex: 1 }} placeholder={t('st')} value={n} onChange={e => setN(e.target.value)} />
      <input className="input" inputMode="decimal" style={{ width: 110, textAlign: 'right' }}
        placeholder="g" value={g} onChange={e => setG(e.target.value)} />
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const weighSheet = (food, name, onSaved) =>
  ui().openSheet(close => <WeighForm food={food} name={name} close={close} onSaved={onSaved} />)

function UnitPicker({ food, current, close, onPick }) {
  const S = useStore(s => s.S)
  const units = unitsFor(S, food)
  const dens = densityFor(food)
  return <>
    <h3>{t('Amount in')}</h3>
    <div className="dim small" style={{ marginBottom: 10 }}>{food.n}</div>
    {units.map(u => <button key={u.id} className="lrow tap" onClick={() => { close(); onPick(u) }}>
      <span className="lrow-m">
        <span className="lrow-t">{u.base ? t('Grams') : '1 ' + unitName(u)}</span>
        {!u.base && <span className="lrow-s">
          {unitWeight(u)}
          {u.suggested && ' · ' + (u.vary ? t('a rough average — worth weighing') : t('an average, tap Weigh to use yours'))}
          {u.volume && dens.water && ' · ' + t('counted as water')}
          {u.volume && dens.vary && ' · ' + t('varies with how you pack it')}
        </span>}
      </span>
      {u.id === current && <Icon name="check" className="lrow-k" />}
    </button>)}
    <div style={{ height: 12 }} />
    <Button icon="scale" onClick={() => { close(); weighSheet(food, '', onPick) }}>{t('Weigh a portion')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

const unitSheet = (food, current, onPick) =>
  ui().openSheet(close => <UnitPicker food={food} current={current} close={close} onPick={onPick} />)

/* ============================ add / edit a meal ============================ */

function MealForm({ existing, preset, close }) {
  const st = useStore(s => s.S)
  const foods = foodMap(st)
  const [kind, setKind] = useState(existing?.kind || preset?.kind || kindForNow())
  const [items, setItems] = useState(existing?.items ? [...existing.items] : (preset?.items ? [...preset.items] : []))
  const [q, setQ] = useState('')

  const totals = totalsOf(items, foods)
  const hits = q.trim() ? searchFoods(st, q, 25) : []
  const last = lastAmounts(st)

  // A food opens at the amount it was logged at last time, which after a week is the amount
  // it is always logged at. Failing that, one of whatever it is counted in.
  const add = f => {
    const d = defaultAmount(st, f, last)
    setItems(x => [...x, { fid: f.id, u: d.unit.id, q: d.q, g: gramsOf(d.unit, d.q) }])
    setQ('')
  }
  const drop = i => setItems(x => x.filter((_, n) => n !== i))

  // Grams are recomputed from unit × count on every change and stored alongside, so the
  // nutrition arithmetic never has to know that portions exist and a portion reweighed
  // next month cannot rewrite what was eaten today.
  const setAmount = (i, unit, qty) => setItems(x => x.map((it, n) => {
    if (n !== i) return it
    const qq = Math.max(unit.base ? 1 : 0.25, Number(qty) || 0)
    const g = gramsOf(unit, qq)
    return unit.base ? { fid: it.fid, u: 'g', q: g, g } : { fid: it.fid, u: unit.id, q: qq, g }
  }))

  const save = () => {
    const clean = items.filter(i => i.fid && Number(i.g) > 0)
    if (!clean.length) { toast(t('Add something to the meal first')); return }
    if (existing) {
      update(s => {
        const m = (s.meals || []).find(x => x.id === existing.id)
        if (m) { m.items = clean; m.kind = kind }
      })
    } else {
      update(s => { (s.meals = s.meals || []).push({ id: uid(), ...newMeal({ kind, items: clean }) }) })
    }
    close()
    toast(existing ? t('Meal updated') : t('Meal logged'))
  }

  const saveTemplate = () => {
    const clean = items.filter(i => i.fid && Number(i.g) > 0)
    if (!clean.length) { toast(t('Add something to the meal first')); return }
    ui().openSheet(c => <NameTemplate items={clean} kind={kind} close={c} />)
  }

  return <>
    <h3>{existing ? t('Edit meal') : t('Log a meal')}</h3>
    <Segmented className="seg-inline" value={kind} onChange={setKind}
      options={MEAL_KINDS.map(k => ({ value: k, label: t(MEAL_NAME[k]) }))} />

    {items.length > 0 && <div style={{ margin: '14px 0' }}>
      {items.map((it, i) => {
        const f = foods[it.fid]
        const one = totalsOf([it], foods)
        const unit = unitById(st, f, it.u || 'g')
        const isG = unit.base
        return <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--sep)' }}>
          <div className="row between" style={{ gap: 10 }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="tt" style={{ fontSize: 15 }}>{f ? f.n : t('Unknown food')}</div>
              <div className="small dim">
                {totalText(one, 'carb')} g {t('Carbs')} · {totalText(one, 'kcal')} kcal
                {/* The grams are always on screen, so a portion weight that is wrong is
                    something you can see rather than something you find out later. */}
                {!isG && ' · ' + grams(unit, it.g)}
              </div>
            </div>
            <button className="btn ghost icon" onClick={() => drop(i)} aria-label={t('Remove')}>
              <Icon name="xmark" />
            </button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, alignItems: 'center' }}>
            <Stepper className="grow" value={it.q} step={isG ? 10 : 1} decimal={!isG}
              onChange={v => setAmount(i, unit, v)} />
            <button className="btn inline"
              onClick={() => unitSheet(f, unit.id, u => setAmount(i, u, u.base ? it.g : 1))}>
              {unitName(unit)}<Icon name="chevronDown" />
            </button>
            {unit.suggested && <button className="btn inline ghost"
              onClick={() => weighSheet(f, unit.n, p => setAmount(i, { ...p, id: p.id }, it.q))}>
              {t('Weigh')}
            </button>}
          </div>
        </div>
      })}
      <div style={{ paddingTop: 12 }}><Macros totals={totals} big /></div>
    </div>}

    <h4 className="sec">{t('Add food')}</h4>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search food…')} value={q} onChange={e => setQ(e.target.value)} /></div>

    {q.trim() && <div style={{ margin: '10px 0' }}>
      {hits.map(f => {
        const d = defaultAmount(st, f, last)
        return <button key={f.id} className="lrow tap" onClick={() => add(f)}>
          <span className="lrow-m">
            <span className="lrow-t">{f.n}</span>
            <span className="lrow-s">
              {!d.unit.base && <>{fmtNum(d.q)} {unitName(d.unit)} · </>}
              {foodText(f, 'carb')} g {t('Carbs')} · {foodText(f, 'kcal')} kcal {t('per 100 g')}
            </span>
          </span>
        </button>
      })}
      {!hits.length && <div className="dim small" style={{ padding: '10px 2px' }}>
        {hasFoodDb() ? t('No match') : t('The food database is not built yet — add it as your own food below.')}
      </div>}
    </div>}

    <div style={{ height: 6 }} />
    <Button icon="barcode" onClick={() => scanSheet(add)}>{t('Scan a barcode')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="plus" onClick={() => ui().openSheet(c => <OwnFoodForm close={c} onDone={add} prefill={q} />)}>
      {t('Create my own food')}
    </Button>

    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save} disabled={!items.length}>{existing ? t('Save') : t('Log it')}</Button>
    {!existing && <>
      <div style={{ height: 8 }} />
      <Button icon="star" onClick={saveTemplate} disabled={!items.length}>{t('Save as a meal I eat often')}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const mealSheet = (existing, preset) =>
  ui().openSheet(close => <MealForm existing={existing} preset={preset} close={close} />)

/* ============================ saved meals ============================ */

function NameTemplate({ items, kind, close }) {
  const [n, setN] = useState('')
  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    update(s => { (s.myMeals = s.myMeals || []).push({ id: uid(), n: name, kind, items }) })
    close()
    toast(t('“{0}” saved — one tap next time', name))
  }
  return <>
    <h3>{t('Save this meal')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('Give it a name and it becomes one tap on the day card.')}
    </div>
    <input className="input" placeholder={t('“My breakfast”')} value={n} onChange={e => setN(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

// Portions are not always the saved one, and re-entering every gram to eat half a breakfast
// is exactly the friction this feature exists to remove.
const SCALES = [0.5, 1, 1.5, 2]

function QuickLog({ close }) {
  const st = useStore(s => s.S)
  const foods = foodMap(st)
  const [scale, setScale] = useState(1)
  const mine = st.myMeals || []

  const log = m => {
    update(s => {
      (s.meals = s.meals || []).push({ id: uid(), ...newMeal({ kind: m.kind, items: scaleItems(m.items, scale) }) })
    })
    close()
    toast(t('{0} logged', m.n))
  }

  if (!mine.length) return <>
    <h3>{t('No saved meals yet')}</h3>
    <div className="muted small" style={{ marginBottom: 16, lineHeight: 1.45 }}>
      {t('Log a meal, then tap “Save as a meal I eat often”. After that it is one tap — which is the difference between logging in January and logging in March.')}
    </div>
    <Button variant="primary" onClick={() => { close(); mealSheet() }}>{t('Log a meal')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>

  return <>
    <h3>{t('My meals')}</h3>
    <Segmented className="seg-inline" value={scale} onChange={setScale}
      options={SCALES.map(s => ({ value: s, label: s === 1 ? t('Whole') : '×' + fmtNum(s) }))} />
    <div style={{ height: 12 }} />
    {mine.map(m => {
      const tot = totalsOf(scaleItems(m.items, scale), foods)
      return <button key={m.id} className="lrow tap" onClick={() => log(m)}>
        <span className="lrow-m">
          <span className="lrow-t">{m.n}</span>
          <span className="lrow-s">{totalText(tot, 'carb')} g {t('Carbs')} · {totalText(tot, 'kcal')} kcal</span>
        </span>
        <Icon name="plus" className="lrow-k" />
      </button>
    })}
    <div style={{ height: 14 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const quickLogSheet = () => ui().openSheet(close => <QuickLog close={close} />)

export function deleteMyMeal(m) {
  update(s => { s.myMeals = (s.myMeals || []).filter(x => x.id !== m.id) })
  toast(t('Removed'))
}

/* ============================ own foods ============================ */

// Values are per 100 g because that is what a Swedish packet prints, so there is no unit
// conversion between reading the label and typing it in.
function OwnFoodForm({ existing, prefill, onDone, close }) {
  const [n, setN] = useState(existing?.n || prefill || '')
  const [v, setV] = useState(() => {
    const o = {}
    for (const k of NUTRIENTS) o[k] = existing?.per100?.[k] ?? ''
    return o
  })
  const set = (k, val) => setV(o => ({ ...o, [k]: val }))

  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    const per100 = cleanPer100(v)
    if (!per100) { toast(t('Nutrient values must be zero or more.')); return }
    if (per100.kcal == null && per100.carb == null) { toast(t('Fill in at least calories or carbs')); return }
    const id = existing?.id || 'u' + uid()
    if (existing) update(s => {
      const f = (s.myFoods || []).find(x => x.id === id)
      if (f) { f.n = name; f.per100 = per100 }
    })
    else update(s => { (s.myFoods = s.myFoods || []).push({ id, n: name, own: true, per100 }) })
    close()
    toast(t('Saved'))
    if (onDone) onDone({ id, n: name, own: true, per100 })
  }

  return <>
    <h3>{existing ? t('Edit food') : t('Create my own food')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Per 100 g, straight off the packet. Calories or carbs is enough — the rest is optional.')}
    </div>
    <input className="input" placeholder={t('Name')} value={n} onChange={e => setN(e.target.value)} />
    <div style={{ height: 10 }} />
    {NUTRIENTS.map(k => <div key={k} className="row between" style={{ gap: 12, padding: '7px 0' }}>
      <span className="small" style={{ flex: 1 }}>{t(NUTRIENT_NAME[k])}</span>
      <input className="input" inputMode="decimal" style={{ width: 110, textAlign: 'right' }}
        placeholder={NUTRIENT_UNIT[k]} value={v[k]} onChange={e => set(k, e.target.value)} />
    </div>)}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const ownFoodSheet = (existing, onDone) =>
  ui().openSheet(close => <OwnFoodForm existing={existing} onDone={onDone} close={close} />)

/* ============================ one logged meal ============================ */

export function mealDetailSheet(meal) {
  ui().openSheet(close => <MealDetail meal={meal} close={close} />)
}

function MealDetail({ meal, close }) {
  const st = useStore(s => s.S)
  const foods = foodMap(st)
  const tot = totalsOf(meal.items, foods)
  const del = () => {
    update(s => { s.meals = (s.meals || []).filter(m => m.id !== meal.id) })
    close()
    toast(t('Meal removed'))
  }
  return <>
    <h3>{t(MEAL_NAME[meal.kind] || 'Meal')} · {meal.t}</h3>
    <div style={{ margin: '8px 0 14px' }}><Macros totals={tot} big /></div>
    {(meal.items || []).map((it, i) => {
      const f = foodOf(st, it.fid)
      const one = totalsOf([it], foods)
      const u = unitById(st, f, it.u || 'g')
      return <div key={i} className="row between" style={{ padding: '8px 0', borderTop: '1px solid var(--sep)' }}>
        <span className="grow">{f ? f.n : t('Unknown food')}
          <span className="dim small"> · {amountLabel(it, unitName(u))}</span></span>
        <span className="small dim">{totalText(one, 'carb')} g</span>
      </div>
    })}
    <div style={{ height: 16 }} />
    <Button icon="pencil" onClick={() => { close(); mealSheet(meal) }}>{t('Edit')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="danger" icon="trash" onClick={del}>{t('Remove')}</Button>
  </>
}

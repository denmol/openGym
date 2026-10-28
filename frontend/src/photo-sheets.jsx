// Log a meal from a photo. A model reads the picture and proposes rows; nothing is saved until
// the person has looked at every one. A dish that matches the food catalogue uses the
// catalogue's values; a dish that does not keeps the model's estimate and says so.
import { useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t, getLang } from './lib/i18n.js'
import { uid, fmtNum } from './lib/format.js'
import { Button, NumberField } from './components/ui.jsx'
import { foodMap, cleanPer100, NUTRIENTS, NUTRIENT_NAME, NUTRIENT_UNIT } from './lib/foods.js'
import { totalsOf, nutrientTotal } from './lib/nutrition.js'
import { downscale, askPhoto, matchCatalogue, foodFromEstimate } from './lib/meal-photo.js'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

const SOURCE = { catalogue: 'From the food database', own: 'Your own food', ai: 'AI estimate' }

function errorText(e) {
  if (e.status === 429) return t('Today’s AI calls are used up.')
  if (e.status === 501) return t('AI is not set up on this server.')
  if (e.status === 413) return t('The photo is too large.')
  return e.message || t('Could not read the photo.')
}

/** onFoods([{ food, g }]) is called with the foods to put in the meal, after they are saved. */
export const photoMealSheet = onFoods =>
  ui().openSheet(close => <PhotoSheet close={close} onFoods={onFoods} />)

function PhotoSheet({ close, onFoods }) {
  const S = useStore(s => s.S)
  const fileRef = useRef(null)
  const [stage, setStage] = useState('intro')          // intro | busy | blocked | review
  const [error, setError] = useState(null)
  const [rows, setRows] = useState([])
  const [unclear, setUnclear] = useState(false)

  const pick = async file => {
    if (!file) return
    setError(null); setStage('busy')
    try {
      const image = await downscale(file)
      const res = await askPhoto(image, getLang())
      if (res.local) { setStage('blocked'); return }
      const matched = matchCatalogue(S, res.items || [])
      setRows(matched.map(r => ({ ...r, key: uid(), per100: r.food ? null : Object.fromEntries(NUTRIENTS.map(k => [k, r.per100?.[k] ?? ''])) })))
      setUnclear(!!res.unclear)
      setStage('review')
    } catch (e) {
      setError(errorText(e)); setStage('intro')
    }
  }

  const setRow = (key, patch) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  const setValue = (key, k, v) => setRows(rs => rs.map(r => r.key === key ? { ...r, per100: { ...r.per100, [k]: v } } : r))

  // What the meal would add up to right now, using the same arithmetic as everything else.
  const catalogue = foodMap(S)
  const temp = {}
  const items = rows.map(r => {
    if (r.food) return { fid: r.food.id, g: r.grams }
    temp[r.key] = { id: r.key, per100: cleanPer100(r.per100 || {}) || {} }
    return { fid: r.key, g: r.grams }
  })
  const totals = totalsOf(items, { ...catalogue, ...temp })
  const text = k => { const v = nutrientTotal(totals, k); return v == null ? '—' : fmtNum(v) }

  const save = () => {
    const chosen = []
    const toSave = []
    for (const r of rows) {
      if (!(Number(r.grams) > 0)) continue
      if (r.food) { chosen.push({ food: r.food, g: Number(r.grams) }); continue }
      const food = foodFromEstimate({ name: r.name, asked: r.asked, per100: r.per100 }, 'ai' + uid())
      if (!food) { toast(t('Fill in calories or carbs for “{0}”', r.name || r.asked)); return }
      toSave.push(food); chosen.push({ food, g: Number(r.grams) })
    }
    if (!chosen.length) { toast(t('Add something to the meal first')); return }
    if (toSave.length) update(s => { s.myFoods = [...(s.myFoods || []), ...toSave] })
    onFoods(chosen)
    close()
  }

  if (stage === 'busy') return <>
    <h3>{t('Photo of the meal')}</h3>
    <div className="muted" style={{ padding: '24px 0' }}>{t('Reading the photo…')}</div>
  </>

  if (stage === 'blocked') return <>
    <h3>{t('Photo of the meal')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('Photo estimates are not offered while a health flag or a safety review is open. Use search or a barcode instead.')}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>

  if (stage === 'review') return <>
    <h3>{t('Check what it found')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 10 }}>
      {t('Estimate from a photo. Weigh it and check when it matters — not a basis for dosing insulin.')}
    </div>
    {(unclear || !rows.length) && <div className="small" style={{ marginBottom: 10, color: 'var(--orange-t)' }}>
      {rows.length ? t('Not sure what this is — check every row carefully.') : t('Nothing recognised — try a clearer photo.')}
    </div>}

    {rows.map(r => <div key={r.key} className="card" style={{ marginBottom: 10 }}>
      <div className="row between" style={{ gap: 8 }}>
        {r.food
          ? <div className="grow" style={{ fontWeight: 600 }}>{r.name}</div>
          : <input className="input grow" value={r.name} onChange={e => setRow(r.key, { name: e.target.value })} />}
        <button className="iconbtn" aria-label={t('Remove')} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>×</button>
      </div>
      <div className="row between" style={{ gap: 10, marginTop: 8 }}>
        <span className="dim small">{t(SOURCE[r.source])}</span>
        <span className="row" style={{ gap: 6, alignItems: 'center' }}>
          <NumberField decimal={false} value={r.grams} onChange={g => setRow(r.key, { grams: g })}
            className="input" style={{ width: 84, textAlign: 'right' }} aria-label={t('Grams')} />
          <span className="dim small">g</span>
        </span>
      </div>
      {!r.food && <details style={{ marginTop: 8 }}>
        <summary className="dim small">{t('Values per 100 g')}</summary>
        {NUTRIENTS.map(k => <div key={k} className="row between" style={{ gap: 12, padding: '5px 0' }}>
          <span className="small grow">{t(NUTRIENT_NAME[k])}</span>
          <input className="input" inputMode="decimal" style={{ width: 96, textAlign: 'right', flex: 'none' }}
            placeholder={NUTRIENT_UNIT[k]} value={r.per100[k]} onChange={e => setValue(r.key, k, e.target.value)} />
        </div>)}
      </details>}
    </div>)}

    {rows.length > 0 && <div className="row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap', margin: '4px 2px 12px' }}>
      <span><b style={{ fontSize: 22 }}>{text('carb')}</b><span className="dim small"> g {t('Carbs')}</span></span>
      <span className="dim small">{text('kcal')} kcal</span>
      <span className="dim small">{t('Protein')} {text('prot')} g</span>
      <span className="dim small">{t('Fat')} {text('fat')} g</span>
    </div>}

    <Button variant="primary" onClick={save} disabled={!rows.length}>{t('Add to the meal')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>

  return <>
    <h3>{t('Photo of the meal')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('Take a photo of the plate. An AI reads it and suggests what is on it and how much — you check every row before it is saved.')}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, margin: '10px 0 14px' }}>
      {t('The photo is sent once to the AI provider and is not stored by Pass.')}
    </div>
    {error && <div className="small" style={{ color: 'var(--red-t, var(--orange-t))', marginBottom: 10 }}>{error}</div>}
    <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
      onChange={e => { const f = e.target.files[0]; e.target.value = ''; pick(f) }} />
    <Button variant="primary" icon="camera" onClick={() => fileRef.current && fileRef.current.click()}>{t('Take or choose a photo')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

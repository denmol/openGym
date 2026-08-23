// Logging a glucose reading and an insulin dose.
//
// Both forms are one number and one tap. That is the whole design brief: these get entered
// six or eight times a day, often one-handed, often while doing something else, and a form
// that takes four taps is a form that stops being used by February.
//
// Nothing on these sheets suggests a dose, a target, or what to do about a reading. See the
// header of lib/diabetes.js for why that line is where it is.

import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { fmtNum } from './lib/format.js'
import { Button, Segmented, Switch } from './components/ui.jsx'
import Icon from './components/Icon.jsx'
import {
  healthOf, newGlucose, newDose, showGlucose, storeGlucose, plausibleGlucose,
  GLUCOSE_TAGS, TAG_NAME, DOSE_KINDS, DOSE_NAME, UNIT_NAME, bandOf,
  DIABETES_TYPES, TYPE_NAME, MEDS, MED_NAME, GLUCOSE_UNITS, DEFAULT_TARGET
} from './lib/diabetes.js'
import { parseGlucoseCSV, hasEntries, mergeGlucose, dropImported } from './lib/carelink.js'

// English source strings are the i18n keys, so a plural needs a key of its own — there is
// no plural machinery to lean on. Counting the two nouns separately keeps that to two pairs
// instead of one sentence written four times.
const nReadings = n => t(n === 1 ? '{0} reading' : '{0} readings', n)
const nDoses = n => t(n === 1 ? '{0} dose' : '{0} doses', n)

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/** A reading with its band as a colour. Colour is orientation, never instruction. */
export function Reading({ v, unit, target, big }) {
  const band = bandOf(v, target)
  const tint = band === 'below' ? 'var(--red)' : band === 'above' ? 'var(--orange)' : 'var(--acc)'
  return <span style={{ color: tint, fontWeight: 700, fontSize: big ? 26 : 17 }}>
    {fmtNum(showGlucose(v, unit))}
    <span className="dim" style={{ fontSize: big ? 14 : 12, fontWeight: 500 }}>
      {' ' + (UNIT_NAME[unit] || UNIT_NAME.mmol)}
    </span>
  </span>
}

/* ======================= a glucose reading ======================= */

// The numbers a meter actually shows, as one tap each. Typing 5.5 on a phone keypad is
// three taps and a decimal point; this is one, and the field is still there for the rest.
const QUICK_MMOL = [4, 5, 6, 7, 8, 10, 12, 15]
const QUICK_MGDL = [70, 90, 110, 130, 145, 180, 215, 270]

function GlucoseForm({ existing, close }) {
  const S = useStore(s => s.S)
  const h = healthOf(S)
  const [v, setV] = useState(existing ? String(showGlucose(existing.v, h.gUnit)) : '')
  const [tag, setTag] = useState(existing?.tag || '')
  const [time, setTime] = useState(existing?.t || '')

  const typed = storeGlucose(String(v).replace(',', '.'), h.gUnit)
  const ok = String(v).trim() !== '' && plausibleGlucose(typed)

  const save = () => {
    const g = newGlucose({ v: String(v).replace(',', '.'), unit: h.gUnit, tag: tag || undefined, t: time || undefined, d: existing?.d })
    if (!g) { toast(t('That is not a reading a meter could show — check the number.')); return }
    if (existing) update(s => {
      const x = (s.glucose || []).find(e => e.id === existing.id)
      if (x) { x.v = g.v; x.t = g.t; if (tag) x.tag = tag; else delete x.tag }
    })
    else update(s => { (s.glucose = s.glucose || []).push(g) })
    close()
    toast(existing ? t('Reading updated') : t('Reading logged'))
  }

  const quick = h.gUnit === 'mgdl' ? QUICK_MGDL : QUICK_MMOL

  return <>
    <h3>{existing ? t('Edit reading') : t('Log a reading')}</h3>

    <div className="row" style={{ gap: 10, alignItems: 'center', margin: '4px 0 12px' }}>
      <input className="input" inputMode="decimal" autoFocus={!existing}
        style={{ fontSize: 30, fontWeight: 700, textAlign: 'center', flex: 1 }}
        placeholder={h.gUnit === 'mgdl' ? '110' : '5,5'}
        value={v} onChange={e => setV(e.target.value)} />
      <span className="dim">{UNIT_NAME[h.gUnit]}</span>
    </div>

    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
      {quick.map(n => <button key={n} className="btn" style={{ padding: '7px 12px' }}
        onClick={() => setV(String(n))}>{fmtNum(n)}</button>)}
    </div>

    <h4 className="sec">{t('When was it taken?')}</h4>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
      {GLUCOSE_TAGS.map(k => <button key={k}
        className={'btn' + (tag === k ? ' primary' : '')} style={{ padding: '7px 12px' }}
        onClick={() => setTag(tag === k ? '' : k)}>{t(TAG_NAME[k])}</button>)}
    </div>
    <div className="dim small" style={{ marginBottom: 12 }}>{t('Optional — it is what makes a pattern readable later.')}</div>

    <div className="row between" style={{ gap: 10, padding: '6px 0 14px' }}>
      <span className="small">{t('Time')}</span>
      <input className="input" type="time" style={{ width: 130 }}
        value={time} onChange={e => setTime(e.target.value)} />
    </div>

    <Button variant="primary" onClick={save} disabled={!ok}>{existing ? t('Save') : t('Log it')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const glucoseSheet = existing => ui().openSheet(close => <GlucoseForm existing={existing} close={close} />)

/* ========================== an insulin dose ========================== */

function DoseForm({ existing, close }) {
  const [u, setU] = useState(existing ? String(existing.u) : '')
  const [kind, setKind] = useState(existing?.kind || 'meal')
  const [time, setTime] = useState(existing?.t || '')

  const save = () => {
    const d = newDose({ u: String(u).replace(',', '.'), kind, t: time || undefined, d: existing?.d })
    if (!d) { toast(t('Enter how many units were given.')); return }
    if (existing) update(s => {
      const x = (s.doses || []).find(e => e.id === existing.id)
      if (x) { x.u = d.u; x.kind = d.kind; x.t = d.t }
    })
    else update(s => { (s.doses = s.doses || []).push(d) })
    close()
    toast(existing ? t('Dose updated') : t('Dose logged'))
  }

  return <>
    <h3>{existing ? t('Edit dose') : t('Log a dose')}</h3>
    {/* Said once, on the form where someone might expect the app to do the sum for them. */}
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Write down the dose that was given. Dagsnav does not work out doses — that stays between you and your care team.')}
    </div>

    <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 12 }}>
      <input className="input" inputMode="decimal" autoFocus={!existing}
        style={{ fontSize: 30, fontWeight: 700, textAlign: 'center', flex: 1 }}
        placeholder="6" value={u} onChange={e => setU(e.target.value)} />
      <span className="dim">{t('units')}</span>
    </div>

    <Segmented className="seg-inline" value={kind} onChange={setKind}
      options={DOSE_KINDS.map(k => ({ value: k, label: t(DOSE_NAME[k]) }))} />

    <div className="row between" style={{ gap: 10, padding: '14px 0' }}>
      <span className="small">{t('Time')}</span>
      <input className="input" type="time" style={{ width: 130 }}
        value={time} onChange={e => setTime(e.target.value)} />
    </div>

    <Button variant="primary" onClick={save} disabled={!String(u).trim()}>{existing ? t('Save') : t('Log it')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const doseSheet = existing => ui().openSheet(close => <DoseForm existing={existing} close={close} />)

/* ========================= one entry, tapped ========================= */

function EntryDetail({ entry, kind, close }) {
  const S = useStore(s => s.S)
  const h = healthOf(S)
  const isG = kind === 'glucose'
  const del = () => {
    update(s => {
      if (isG) s.glucose = (s.glucose || []).filter(x => x.id !== entry.id)
      else s.doses = (s.doses || []).filter(x => x.id !== entry.id)
    })
    close()
    toast(t('Removed'))
  }
  return <>
    <h3>{isG ? t('Reading') : t('Dose')} · {entry.t}</h3>
    <div style={{ margin: '6px 0 14px' }}>
      {isG
        ? <Reading v={entry.v} unit={h.gUnit} target={h.target} big />
        : <span style={{ fontWeight: 700, fontSize: 26 }}>{fmtNum(entry.u)}
          <span className="dim" style={{ fontSize: 14, fontWeight: 500 }}>{' ' + t('units')}</span></span>}
    </div>
    <div className="dim small" style={{ marginBottom: 4 }}>
      {isG ? (entry.tag ? t(TAG_NAME[entry.tag]) : t('No tag')) : t(DOSE_NAME[entry.kind] || 'Meal dose')}
      {entry.src === 'import' && ' · ' + t('imported')}
    </div>
    <div style={{ height: 12 }} />
    <Button icon="pencil" onClick={() => { close(); isG ? glucoseSheet(entry) : doseSheet(entry) }}>{t('Edit')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="danger" icon="trash" onClick={del}>{t('Remove')}</Button>
  </>
}

export const entrySheet = (entry, kind) => ui().openSheet(close => <EntryDetail entry={entry} kind={kind} close={close} />)

/* ====================== importing from a device ====================== */

function ImportForm({ text, close }) {
  const [unit, setUnit] = useState(null)          // null = whatever the file said
  const parsed = parseGlucoseCSV(text, unit ? { unit } : {})

  if (parsed.error) return <>
    <h3>{t('Could not read that file')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {parsed.error === 'empty'
        ? t('The file is empty.')
        : t('No column in it looks like a date and a glucose value. Export again as CSV, or send me the first few lines and I will add the format.')}
    </div>
    <Button variant="ghost" className="dim" onClick={close}>{t('Close')}</Button>
  </>

  const doIt = () => {
    let r
    update(s => { r = mergeGlucose(s, parsed) })
    close()
    toast(t('Added {0} and {1}', nReadings(r.readings), nDoses(r.doses)))
  }

  const g = parsed.readings.length
  const d = parsed.doses.length

  return <>
    <h3>{t('Import from your device')}</h3>

    <div className="card" style={{ margin: '4px 0 14px' }}>
      <div className="row between"><span className="small">{t('Readings')}</span><b>{g}</b></div>
      <div className="row between"><span className="small">{t('Doses')}</span><b>{d}</b></div>
      <div className="row between"><span className="small">{t('Period')}</span>
        <b className="small">{parsed.from} – {parsed.to}</b></div>
      <div className="row between"><span className="small">{t('Unit in the file')}</span>
        <b>{UNIT_NAME[parsed.unit]}</b></div>
    </div>

    {/* An inferred unit is the one thing here that could be wrong by a factor of eighteen. */}
    {parsed.unitSource !== 'header' && <div className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <Icon name="info" />
        <div className="small" style={{ lineHeight: 1.45 }}>
          {t('The file does not say which unit it uses. Going by the size of the numbers, this looks like {0}. Check a reading below against your device before importing.', UNIT_NAME[parsed.unit])}
        </div>
      </div>
      <div style={{ height: 10 }} />
      <Segmented className="seg-inline" value={unit || parsed.unit} onChange={setUnit}
        options={[{ value: 'mmol', label: UNIT_NAME.mmol }, { value: 'mgdl', label: UNIT_NAME.mgdl }]} />
    </div>}

    {parsed.sample.length > 0 && <>
      <h4 className="sec">{t('The first readings, as they will be stored')}</h4>
      <div style={{ marginBottom: 12 }}>
        {parsed.sample.map((r, i) => <div key={i} className="row between" style={{ padding: '7px 0', borderTop: '1px solid var(--sep)' }}>
          <span className="small dim">{r.d} {r.t}</span>
          <span className="small"><b>{fmtNum(r.v)}</b> mmol/L
            {parsed.unit === 'mgdl' && <span className="dim"> · {fmtNum(showGlucose(r.v, 'mgdl'))} mg/dL</span>}</span>
        </div>)}
      </div>
    </>}

    {/* Everything the parser decided not to take, said plainly rather than left as a gap. */}
    <div className="dim small" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {parsed.basalSkipped > 0 && <div>{t('{0} basal rows skipped — a pump reports basal as a rate, not as an amount given, so counting them as doses would invent a total.', parsed.basalSkipped)}</div>}
      {parsed.carbSkipped > 0 && <div>{t('{0} carb entries skipped — the food log is where carbohydrate lives.', parsed.carbSkipped)}</div>}
      {parsed.noTime > 0 && <div>{t('{0} rows had no time of day and were skipped.', parsed.noTime)}</div>}
      {parsed.outOfRange > 0 && <div>{t('{0} rows held a value no meter could show and were skipped.', parsed.outOfRange)}</div>}
    </div>

    <Button variant="primary" onClick={doIt} disabled={!hasEntries(parsed)}>
      {t('Import {0} and {1}', nReadings(g), nDoses(d))}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const importGlucoseSheet = text => ui().openSheet(close => <ImportForm text={text} close={close} />)

/** Take back everything that came out of a file, leaving hand-typed entries alone. */
export function undoImport() {
  let r
  update(s => { r = dropImported(s) })
  toast(t('Removed {0} and {1}', nReadings(r.readings), nDoses(r.doses)))
}

export const hasImported = S =>
  ((S && S.glucose) || []).some(x => x.src === 'import') || ((S && S.doses) || []).some(x => x.src === 'import')

/* ===================== who this is set up for ===================== */

// Both ends of the target range, in the profile's unit. Stored in mmol/L like every other
// reading, so switching unit re-labels the report rather than rewriting the range.
function TargetRow({ label, value, unit, onChange }) {
  return <div className="row between" style={{ gap: 10, padding: '7px 0' }}>
    <span className="small">{label}</span>
    <input className="input" inputMode="decimal" style={{ width: 110, textAlign: 'right' }}
      value={value} onChange={e => onChange(e.target.value)} />
  </div>
}

function HealthForm({ close }) {
  const S = useStore(s => s.S)
  const cur = healthOf(S)
  const [on, setOn] = useState(cur.on)
  const [type, setType] = useState(cur.type)
  const [meds, setMeds] = useState(cur.meds)
  const [gUnit, setGUnit] = useState(cur.gUnit)
  const [lo, setLo] = useState(String(showGlucose(cur.target.lo, cur.gUnit)))
  const [hi, setHi] = useState(String(showGlucose(cur.target.hi, cur.gUnit)))

  // Switching unit converts what is already in the two boxes, so a range set in mmol/L does
  // not silently become the same digits in mg/dL.
  const switchUnit = u => {
    if (u === gUnit) return
    const loM = storeGlucose(String(lo).replace(',', '.'), gUnit)
    const hiM = storeGlucose(String(hi).replace(',', '.'), gUnit)
    setGUnit(u)
    if (Number.isFinite(loM)) setLo(String(showGlucose(loM, u)))
    if (Number.isFinite(hiM)) setHi(String(showGlucose(hiM, u)))
  }

  const toggleMed = m => setMeds(x => (x.includes(m) ? x.filter(y => y !== m) : [...x, m]))

  const save = () => {
    let loM = storeGlucose(String(lo).replace(',', '.'), gUnit)
    let hiM = storeGlucose(String(hi).replace(',', '.'), gUnit)
    if (!plausibleGlucose(loM) || !plausibleGlucose(hiM) || loM >= hiM) {
      toast(t('The target range needs a low and a high, with the low the smaller of the two.'))
      return
    }
    update(s => {
      s.health = { on, type, meds, gUnit, target: { lo: loM, hi: hiM }, updated: Date.now() }
    })
    close()
    toast(on ? t('Diabetes mode is on') : t('Diabetes mode is off'))
  }

  return <>
    <h3>{t('Diabetes')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Turns on a glucose log, an insulin log and a report you can take to an appointment. Dagsnav never calculates a dose — it records what you tell it and adds it up.')}
    </div>

    <div className="row between" style={{ padding: '4px 0 14px' }}>
      <span>{t('Diabetes mode')}</span>
      <Switch checked={on} onChange={setOn} />
    </div>

    {on && <>
      <h4 className="sec">{t('Type')}</h4>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {DIABETES_TYPES.map(k => <button key={k}
          className={'btn' + (type === k ? ' primary' : '')} style={{ padding: '7px 12px' }}
          onClick={() => setType(type === k ? null : k)}>{t(TYPE_NAME[k])}</button>)}
      </div>

      <h4 className="sec">{t('Treatment')}</h4>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        {MEDS.map(m => <button key={m}
          className={'btn' + (meds.includes(m) ? ' primary' : '')} style={{ padding: '7px 12px' }}
          onClick={() => toggleMed(m)}>{t(MED_NAME[m])}</button>)}
      </div>
      <div className="dim small" style={{ marginBottom: 14 }}>{t('Pick as many as apply — a pump user still carries a pen.')}</div>

      <h4 className="sec">{t('Unit')}</h4>
      <Segmented className="seg-inline" value={gUnit} onChange={switchUnit}
        options={GLUCOSE_UNITS.map(u => ({ value: u, label: UNIT_NAME[u] }))} />

      <h4 className="sec" style={{ marginTop: 16 }}>{t('Target range')}</h4>
      <TargetRow label={t('Low')} value={lo} unit={gUnit} onChange={setLo} />
      <TargetRow label={t('High')} value={hi} unit={gUnit} onChange={setHi} />
      <div className="dim small" style={{ margin: '6px 0 14px', lineHeight: 1.45 }}>
        {t('Starts at {0}–{1} mmol/L, the range diabetes reports are usually written against. The range that applies to you comes from your care team — change it here.', fmtNum(DEFAULT_TARGET.lo), fmtNum(DEFAULT_TARGET.hi))}
      </div>
    </>}

    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const healthSheet = () => ui().openSheet(close => <HealthForm close={close} />)

/** A one-line description of the profile, for the Settings row. */
export function healthSummary(S) {
  const h = healthOf(S)
  if (!h.on) return null
  const bits = []
  if (h.type) bits.push(t(TYPE_NAME[h.type]))
  bits.push(...h.meds.map(m => t(MED_NAME[m])))
  bits.push(UNIT_NAME[h.gUnit])
  return bits.join(' · ')
}

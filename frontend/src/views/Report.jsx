// A page to take to an appointment.
//
// Printed rather than generated as a PDF file: the browser's own "Save as PDF" produces a
// better document than anything a bundled library would, on every platform, with no
// megabyte of dependency and no font that renders differently on the nurse's screen. The
// print stylesheet in index.css strips the app's chrome so what comes out is a document.
//
// The footnotes at the bottom are not boilerplate. Anyone reading this needs to know that
// the range figure counts readings rather than time, that pump basal is not in the insulin
// total, and where the carbohydrate came from. A report that hides its own limits is worse
// than no report, because it will be believed.

import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, dateLocale } from '../lib/i18n.js'
import { todayISO, fmtNum } from '../lib/format.js'
import { foodMap } from '../lib/foods.js'
import { dayTotals } from '../lib/nutrition.js'
import {
  healthOf, glucoseBetween, dosesBetween, glucoseOn, dosesOn,
  glucoseStats, doseTotals, showGlucose, daysBack,
  TYPE_NAME, MED_NAME, UNIT_NAME
} from '../lib/diabetes.js'
import { Button, Segmented } from '../components/ui.jsx'

const PERIODS = [14, 30, 90]

export default function Report() {
  const S = useStore(s => s.S)
  const h = healthOf(S)
  const [days, setDays] = useState(30)
  const foods = foodMap(S)

  const dates = daysBack(days)
  const from = dates[0], to = dates[dates.length - 1]
  const readings = glucoseBetween(S, from, to)
  const doses = dosesBetween(S, from, to)
  const stats = glucoseStats(readings, h.target)
  const insulin = doseTotals(doses)

  const g = v => fmtNum(showGlucose(v, h.gUnit))
  const unit = UNIT_NAME[h.gUnit]

  // Only days with something on them: a table of thirty rows where nine hold data is
  // harder to read than a table of nine, and the empty rows say nothing a date range does
  // not already say.
  const rows = dates.map(d => {
    const rs = glucoseOn(S, d)
    const ds = dosesOn(S, d)
    const carbs = dayTotals(S, d, foods).carb
    return { d, st: glucoseStats(rs, h.target), ins: doseTotals(ds), carbs }
  }).filter(r => r.st.n > 0 || r.ins.total > 0 || r.carbs > 0)

  const when = iso => new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })

  return <div className="report">
    <div className="hdr noprint"><div>
      <h1>{t('Report')}</h1>
      <div className="sub">{t('For an appointment — printed, or saved as a PDF.')}</div>
    </div></div>

    <div className="card noprint">
      <Segmented className="seg-inline" value={days} onChange={setDays}
        options={PERIODS.map(n => ({ value: n, label: t('{0} days', n) }))} />
      <div style={{ height: 12 }} />
      <Button variant="primary" icon="download" onClick={() => window.print()}>{t('Print or save as PDF')}</Button>
    </div>

    {/* Everything below prints. */}
    <div className="rsheet">
      <h2 className="rt">openGym · {t('Glucose and insulin')}</h2>
      <p className="rsub">
        {when(from)} – {when(to)} · {t('printed {0}', when(todayISO()))}
        {h.type ? ' · ' + t(TYPE_NAME[h.type]) : ''}
        {h.meds.length ? ' · ' + h.meds.map(m => t(MED_NAME[m])).join(', ') : ''}
      </p>

      {stats.n === 0 && insulin.n === 0
        ? <p className="rnone">{t('Nothing was logged in this period.')}</p>
        : <>
          <table className="rtab">
            <tbody>
              <tr><th>{t('Readings')}</th><td>{stats.n}</td></tr>
              {stats.n > 0 && <>
                <tr><th>{t('Average')}</th><td>{g(stats.mean)} {unit}</td></tr>
                <tr><th>{t('Lowest / highest')}</th><td>{g(stats.min)} / {g(stats.max)} {unit}</td></tr>
                <tr><th>{t('Spread (SD)')}</th><td>{g(stats.sd)} {unit}</td></tr>
                <tr><th>{t('Target range')}</th><td>{g(h.target.lo)}–{g(h.target.hi)} {unit}</td></tr>
                <tr><th>{t('In range')}</th><td>{fmtNum(stats.withinPct)} % ({stats.within})</td></tr>
                <tr><th>{t('Below range')}</th><td>{fmtNum(stats.belowPct)} % ({stats.below})</td></tr>
                <tr><th>{t('Above range')}</th><td>{fmtNum(stats.abovePct)} % ({stats.above})</td></tr>
              </>}
              {insulin.n > 0 && <>
                <tr><th>{t('Insulin logged')}</th><td>{fmtNum(insulin.total)} {t('units')}</td></tr>
                <tr><th>{t('Of which meal doses')}</th><td>{fmtNum(insulin.meal)} {t('units')}</td></tr>
                <tr><th>{t('Of which corrections')}</th><td>{fmtNum(insulin.correction)} {t('units')}</td></tr>
                <tr><th>{t('Of which basal')}</th><td>{fmtNum(insulin.basal)} {t('units')}</td></tr>
              </>}
            </tbody>
          </table>

          {rows.length > 0 && <>
            <h3 className="rh">{t('Day by day')}</h3>
            <table className="rtab rgrid">
              <thead><tr>
                <th>{t('Date')}</th>
                <th>{t('n')}</th>
                <th>{t('Average')}</th>
                <th>{t('Lowest')}</th>
                <th>{t('Highest')}</th>
                <th>{t('Insulin')}</th>
                <th>{t('Carbs')}</th>
              </tr></thead>
              <tbody>
                {rows.map(r => <tr key={r.d}>
                  <td>{when(r.d)}</td>
                  <td>{r.st.n || '—'}</td>
                  <td>{r.st.n ? g(r.st.mean) : '—'}</td>
                  <td>{r.st.n ? g(r.st.min) : '—'}</td>
                  <td>{r.st.n ? g(r.st.max) : '—'}</td>
                  <td>{r.ins.total ? fmtNum(r.ins.total) : '—'}</td>
                  <td>{r.carbs ? fmtNum(r.carbs) : '—'}</td>
                </tr>)}
              </tbody>
            </table>
            <p className="rsub">{t('Glucose in {0}, insulin in units, carbohydrate in grams.', unit)}</p>
          </>}
        </>}

      <h3 className="rh">{t('How to read this')}</h3>
      <ul className="rnotes">
        <li>{t('“In range” is the share of readings inside the target range, not a share of time. Spot readings are not evenly spaced, so this rises and falls with when someone happened to test.')}</li>
        <li>{t('Insulin is what was logged in this app. Basal delivered by a pump is not included — a pump reports basal as a rate rather than an amount, and adding rates up would invent a figure.')}</li>
        <li>{t('Carbohydrate comes from the food log in this app and covers only meals that were logged.')}</li>
        <li>{t('There is no estimated HbA1c here. It is defined over a continuous sensor trace, and calculating one from spot readings would look like a lab result without being one.')}</li>
        <li>{t('openGym is a logbook. It does not calculate doses and nothing in it is medical advice.')}</li>
      </ul>
    </div>
  </div>
}

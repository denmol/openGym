// What is left of the day, per nutrient.
//
// The rest of the nutrition code is careful about where a number comes from, and rightly
// so. This is the one place that has to be careful about something else: whether the
// number can be acted on before the next meal. So the arithmetic a person would otherwise
// do in their head — eaten, goal, what remains — is done here, and the sourcing moves to
// an info button rather than sitting between the reader and the figure.
//
// Two things are never smoothed over. A total built from foods missing that nutrient is
// shown as "≥", because the amount left would otherwise be a number the app invented; and
// a maximum is worded as a ceiling rather than as something to reach, because "5.75 g of
// salt left" and "at least 29 g of fibre" are opposite instructions in the same layout.

import { dateLocale, t } from '../lib/i18n.js'
import { NUTRIENT_NAME, NUTRIENT_UNIT } from '../lib/foods.js'
import { formatPlanAmount } from '../lib/nutrition-plan.js'
import Icon from './Icon.jsx'

const SOURCE_NAME = { own: 'Your own target', plan: 'Calculated plan' }

const amount = (value, key) => formatPlanAmount(value, key, dateLocale())

/** What remains, worded for the kind of limit the goal is. */
function remainingText(row) {
  const { left, limit, over } = row
  const unit = NUTRIENT_UNIT[row.key]
  if (left == null) return null
  if (limit === 'max') return over
    ? t('{0} {1} over the maximum', amount(-left, row.key), unit)
    : t('{0} {1} left of the maximum', amount(left, row.key), unit)
  if (limit === 'min') return left <= 0
    ? t('Goal reached')
    : t('{0} {1} to go', amount(left, row.key), unit)
  return over
    ? t('{0} {1} over', amount(-left, row.key), unit)
    : t('{0} {1} left', amount(left, row.key), unit)
}

export function GoalRow({ row, compact, onInfo }) {
  const unit = NUTRIENT_UNIT[row.key]
  const name = t(NUTRIENT_NAME[row.key])
  // A maximum that has been passed is the only case where the bar itself carries a
  // warning; a protein minimum reached at 120% is the plan working, not a problem.
  const alarm = row.over && row.limit !== 'min'
  const remaining = remainingText(row)

  if (row.paused) return <div className={'dgoal' + (compact ? ' compact' : '')}>
    <div className="dgoal-top">
      <span className="dgoal-name">{name}</span>
      <span className="dgoal-nums">{row.used == null ? '—' : <>{amount(row.used, row.key)} <span className="dim">{unit}</span></>}</span>
    </div>
    <div className="dgoal-foot"><span className="dgoal-paused">{t('Paused — needs review')}</span></div>
  </div>

  return <div className={'dgoal' + (compact ? ' compact' : '') + (alarm ? ' over' : '')}>
    <div className="dgoal-top">
      <span className="dgoal-name">{name}</span>
      <span className="dgoal-nums">
        {row.used == null
          ? <span className="dim">—</span>
          : <strong>{row.complete ? '' : '≥ '}{amount(row.used, row.key)}</strong>}
        {row.goal != null && <span className="dim"> / {amount(row.goal, row.key)} {unit}</span>}
        {row.goal == null && row.used != null && <span className="dim"> {unit}</span>}
      </span>
    </div>
    {row.goal != null && <div className="dgoal-bar" role="presentation">
      <i style={{ width: Math.max(0, Math.min(100, row.pct ?? 0)) + '%' }} />
    </div>}
    <div className="dgoal-foot">
      <span className="dgoal-left">
        {remaining || (row.goal == null ? t('No goal set') : null)}
        {!row.complete && <span className="dgoal-partial"> · {t('Some logged foods are missing this value.')}</span>}
      </span>
      {row.source && <button className="dgoal-src" onClick={() => onInfo?.(row)}
        aria-label={t('About this goal')}>
        {t(SOURCE_NAME[row.source])}<Icon name="info" />
      </button>}
    </div>
  </div>
}

/** The day's headline nutrients, each with what is left of it. */
export default function DayGoals({ rows, onInfo }) {
  return <div className="dgoals">
    {rows.map(row => <GoalRow key={row.key} row={row} onInfo={onInfo} />)}
  </div>
}

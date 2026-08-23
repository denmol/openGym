// A cardio set is a duration and a distance. Speed and pace are arithmetic over those two.
//
// WHY DISTANCE IS THE FIELD, AND SPEED IS NOT
//
// Speed in km/h is what a treadmill displays. It is not what anybody remembers about a run:
// the thing a person writes down afterwards is "8 km in 46 minutes", and the number they
// judge themselves on is the pace that falls out of it — 5:45 per kilometre. Both speed and
// pace are exact arithmetic over duration and distance, so recording the two measured values
// and deriving the rest keeps one figure authoritative, instead of two that can disagree
// after an edit.
//
// Sets logged before this carry `speed` and no distance. They are read unchanged: the
// distance is derived back out of speed × duration and marked as derived, because it was
// never measured and must not start looking as though it was. That flag travels with the
// reading rather than being rounded away — the same rule the food log follows for a total
// built from items missing a nutrient.
//
// Distance is in kilometres throughout, as km/h already was. The unit in the profile is for
// body weight and barbells; there is no mile anywhere in this app, and adding one is a
// change to make deliberately rather than by scattering conversions through the readers.

import { dateLocale } from './i18n.js'

/** The fields a cardio set can carry. `speed` is still read, and no longer written. */
export const CARDIO_FIELDS = ['min', 'km', 'hr']

const num = value => typeof value === 'number'
  ? value
  : typeof value === 'string' && value.trim() ? Number(value) : NaN
const positive = value => {
  const n = num(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
const round = (value, places) => {
  const f = 10 ** places
  return Math.round(value * f) / f
}
// A distance reads with the reader's decimal mark. Two lines describing the same run must
// not disagree about whether it was 8.2 km or 8,2 km.
const local = (value, places) => Number(value).toLocaleString(dateLocale(), { maximumFractionDigits: places })

/** A distance in kilometres, at the precision a watch reports and in the reader's format. */
export const formatKm = km => local(km, 2)

/**
 * One cardio set, with everything that follows from what was recorded.
 *
 * `kmDerived` says the distance came out of an old speed-only set rather than a measurement.
 * `pace` is minutes per kilometre as a number; formatPace turns it into the m:ss a runner
 * reads.
 */
export function cardioSet(set) {
  const min = positive(set?.min)
  const hr = positive(set?.hr)
  const stored = positive(set?.speed)
  let km = positive(set?.km)
  let kmDerived = false
  if (km == null && stored != null && min != null) {
    km = round(stored * min / 60, 2)
    kmDerived = true
  }
  const speed = min != null && km != null ? round(km / (min / 60), 1) : stored
  const pace = min != null && km != null ? min / km : null
  return { min, km, hr, speed, pace, kmDerived }
}

/** "5:45" — minutes and seconds per kilometre. Null when there is nothing to divide. */
export function formatPace(pace) {
  if (!Number.isFinite(pace) || pace <= 0) return null
  const seconds = Math.round(pace * 60)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * A cardio set as one line: what was done, then what follows from it.
 *
 * A derived distance is prefixed with ≈, which means the same thing here as everywhere else
 * in the app — this number was calculated, not recorded.
 */
export function formatCardioSet(set, { pace = true, derived = true } = {}) {
  const c = cardioSet(set)
  if (c.min == null && c.km == null && c.speed == null) return '0 min'
  const parts = []
  if (c.min != null) parts.push(`${local(c.min, 0)} min`)
  // A plan asks for a duration, not a distance. Deriving one from a default speed would put
  // a kilometre figure in front of someone who never chose it, so callers describing what is
  // planned pass derived:false and get the duration alone.
  if (c.km != null && (derived || !c.kmDerived)) parts.push(`${c.kmDerived ? '≈' : ''}${formatKm(c.km)} km`)
  const p = pace ? formatPace(c.pace) : null
  if (p) parts.push(`${p}/km`)
  else if (parts.length === 0 && c.speed != null) parts.push(`${local(c.speed, 1)} km/h`)
  if (c.hr != null) parts.push(`${Math.round(c.hr)} bpm`)
  return parts.join(' · ')
}

/**
 * Completed cardio sets, summed.
 *
 * The average heart rate is weighted by duration, because a five-minute warm-up and a
 * forty-minute run averaged flat would describe neither. Sets without a heart rate are left
 * out of that average rather than counted as zero, and `hrMinutes` says how much of the time
 * it actually covers — an average without its denominator would speak for minutes that were
 * never measured.
 */
export function sumCardio(sets) {
  let minutes = 0, km = 0, count = 0, hrWeighted = 0, hrMinutes = 0, derived = false
  for (const set of sets || []) {
    if (!set || set.done === false) continue
    const c = cardioSet(set)
    if (c.min == null && c.km == null) continue
    count++
    if (c.min != null) minutes += c.min
    if (c.km != null) { km += c.km; if (c.kmDerived) derived = true }
    if (c.hr != null && c.min != null) { hrWeighted += c.hr * c.min; hrMinutes += c.min }
  }
  return {
    sets: count,
    minutes: round(minutes, 0),
    km: round(km, 2),
    pace: minutes > 0 && km > 0 ? minutes / km : null,
    hr: hrMinutes > 0 ? Math.round(hrWeighted / hrMinutes) : null,
    hrMinutes: round(hrMinutes, 0),
    anyDistanceDerived: derived
  }
}

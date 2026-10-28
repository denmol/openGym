// Energy spent on an activity, as an estimate.
//
// kcal = (MET − 1) × kg × hours. The 1 MET that is taken off is rest: the day's energy plan
// already contains basal energy, so only what the activity adds on top of it is counted.
// MET values are from the Compendium of Physical Activities, picked by speed where the
// activity has one. The result is rounded to tens and is never more than a rough figure.

const WALK = [[4, 3.0], [5, 3.5], [5.6, 4.3], [6.4, 5.0]]
const RUN = [[8, 8.3], [9.7, 9.8], [11.3, 11]]
const BIKE = [[16, 6.8], [19, 8.0], [22, 10.0]]

// The MET of the first row whose speed is not above the given one; below the slowest row the
// slowest row applies, so a very slow walk is not rated as rest.
function byOrdered(table, kmh) {
  let met = table[0][1]
  for (const [speed, value] of table) if (kmh >= speed) met = value
  return met
}

const positive = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }

/** MET for an activity kind and, when known, its average speed in km/h. */
export function metFor(kind, kmh) {
  switch (kind) {
    case 'walk': return kmh ? byOrdered(WALK, kmh) : 3.5
    case 'hike': return 6
    case 'run': return kmh ? byOrdered(RUN, kmh) : 9.8
    case 'bike': return kmh ? (kmh < 16 ? 5.8 : byOrdered(BIKE, kmh)) : 6.8
    case 'swim': return 6
    case 'strength': return 3.5
    case 'cardio': return kmh ? (kmh < 7 ? byOrdered(WALK, kmh) : byOrdered(RUN, kmh)) : 5
    default: return 4
  }
}

/** Kilocalories above rest, rounded to ten; null without time or weight. */
export function activityKcal({ kind, minutes, km, kg }) {
  const min = positive(minutes), weight = positive(kg)
  if (min == null || weight == null) return null
  const distance = positive(km)
  const kmh = distance != null ? distance / (min / 60) : null
  const met = metFor(kind, kmh)
  return Math.round(Math.max(0, met - 1) * weight * (min / 60) / 10) * 10
}

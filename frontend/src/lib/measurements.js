export const MEASUREMENT_FIELDS = ['waist', 'chest', 'arms', 'thighs']

export function saveMeasurement(list, entry) {
  const clean = { d: entry.d, t: entry.t || Date.now(), u: entry.u || 'cm' }
  for (const field of MEASUREMENT_FIELDS) {
    const value = Number(entry[field])
    if (value > 0) clean[field] = Math.round(value * 10) / 10
  }
  if (!MEASUREMENT_FIELDS.some(field => clean[field] > 0)) return list
  const next = (list || []).filter(item => item.d !== clean.d)
  next.push(clean)
  return next.sort((a, b) => a.d.localeCompare(b.d))
}

export function measurementSeries(list, field, range = 0, now = Date.now()) {
  return (list || []).filter(item => item[field] > 0 && (!range || (item.t || new Date(item.d).getTime()) > now - range * 86400000))
    .map(item => ({ t: item.t || new Date(item.d).getTime(), y: item[field], d: item.d }))
}

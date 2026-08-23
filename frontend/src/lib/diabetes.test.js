import { describe, it, expect } from 'vitest'
import {
  healthOf, diabetesOn, DEFAULT_TARGET, MEDS,
  toMmol, toMgdl, showGlucose, storeGlucose, plausibleGlucose,
  newGlucose, newDose, glucoseOn, dosesOn, glucoseBetween, dosesBetween,
  timeInRange, glucoseStats, doseTotals, bandOf, daysBack
} from './diabetes.js'

describe('the health profile', () => {
  it('is off until someone turns it on', () => {
    expect(diabetesOn({})).toBe(false)
    expect(diabetesOn(null)).toBe(false)
    expect(healthOf({}).target).toEqual(DEFAULT_TARGET)
  })

  it('fills in what an older build never wrote', () => {
    const h = healthOf({ health: { on: true, type: 'type1' } })
    expect(h).toMatchObject({ on: true, type: 'type1', gUnit: 'mmol', meds: [] })
    expect(h.target).toEqual(DEFAULT_TARGET)
  })

  it('keeps a partial target range usable', () => {
    // A profile that moved only the top of the range must not lose the bottom of it.
    expect(healthOf({ health: { target: { hi: 8.5 } } }).target).toEqual({ lo: 3.9, hi: 8.5 })
  })

  it('drops a treatment it does not recognise instead of showing a blank row', () => {
    expect(healthOf({ health: { meds: ['pump', 'telepathy'] } }).meds).toEqual(['pump'])
    expect(healthOf({ health: { meds: 'pump' } }).meds).toEqual([])
    MEDS.forEach(m => expect(healthOf({ health: { meds: [m] } }).meds).toEqual([m]))
  })
})

describe('units', () => {
  it('round-trips a reading through mg/dL', () => {
    expect(toMgdl(5.5)).toBe(99)
    expect(toMmol(99)).toBe(5.5)
    expect(toMgdl(10)).toBe(180)
    expect(toMmol(180)).toBe(10)
  })

  it('shows a stored value in whichever unit the profile reads', () => {
    expect(showGlucose(5.5, 'mmol')).toBe(5.5)
    expect(showGlucose(5.5, 'mgdl')).toBe(99)
  })

  it('stores what was typed as mmol/L either way', () => {
    expect(storeGlucose(5.5, 'mmol')).toBe(5.5)
    expect(storeGlucose(99, 'mgdl')).toBe(5.5)
  })

  it('rejects what no meter could have produced', () => {
    expect(plausibleGlucose(5.5)).toBe(true)
    expect(plausibleGlucose(1.0)).toBe(true)
    expect(plausibleGlucose(35)).toBe(true)
    expect(plausibleGlucose(0.9)).toBe(false)
    expect(plausibleGlucose(35.1)).toBe(false)
    expect(plausibleGlucose('x')).toBe(false)
    expect(plausibleGlucose(null)).toBe(false)
  })
})

describe('newGlucose', () => {
  it('stores mmol/L whatever was typed', () => {
    expect(newGlucose({ v: 99, unit: 'mgdl' }).v).toBe(5.5)
    expect(newGlucose({ v: 5.5, unit: 'mmol' }).v).toBe(5.5)
  })

  it('refuses a typo rather than storing it', () => {
    // 55 is what you get typing a mmol/L reading without the decimal point.
    expect(newGlucose({ v: 55, unit: 'mmol' })).toBeNull()
    expect(newGlucose({ v: 0, unit: 'mmol' })).toBeNull()
    expect(newGlucose({ v: '', unit: 'mmol' })).toBeNull()
    expect(newGlucose({})).toBeNull()
  })

  it('stamps today and the clock unless told otherwise', () => {
    const g = newGlucose({ v: 6 })
    expect(g.d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(g.t).toMatch(/^\d{2}:\d{2}$/)
    expect(newGlucose({ v: 6, d: '2026-01-02', t: '07:30' })).toMatchObject({ d: '2026-01-02', t: '07:30' })
  })

  it('keeps a tag only when it is one the app knows', () => {
    expect(newGlucose({ v: 6, tag: 'fasting' }).tag).toBe('fasting')
    expect(newGlucose({ v: 6, tag: 'brunch' }).tag).toBeUndefined()
    expect(newGlucose({ v: 6 }).tag).toBeUndefined()
  })
})

describe('newDose', () => {
  it('keeps two decimals, which covers a pump and a pen both', () => {
    expect(newDose({ u: 6.5 }).u).toBe(6.5)
    expect(newDose({ u: 0.025 }).u).toBe(0.03)
  })

  it('refuses nothing, negatives and a whole cartridge', () => {
    expect(newDose({ u: 0 })).toBeNull()
    expect(newDose({ u: -2 })).toBeNull()
    expect(newDose({ u: 300 })).toBeNull()
    expect(newDose({ u: 'x' })).toBeNull()
    expect(newDose({})).toBeNull()
  })

  it('defaults to a meal dose for an unknown kind', () => {
    expect(newDose({ u: 4, kind: 'basal' }).kind).toBe('basal')
    expect(newDose({ u: 4, kind: 'guesswork' }).kind).toBe('meal')
  })
})

describe('reading a day back', () => {
  const S = {
    glucose: [
      { id: 'a', d: '2026-08-22', t: '12:10', v: 9.9 },
      { id: 'b', d: '2026-08-22', t: '07:05', v: 5.5, tag: 'fasting' },
      { id: 'c', d: '2026-08-21', t: '08:00', v: 6.1 }
    ],
    doses: [
      { id: 'd1', d: '2026-08-22', t: '12:15', u: 6, kind: 'meal' },
      { id: 'd2', d: '2026-08-22', t: '07:10', u: 14, kind: 'basal' }
    ]
  }

  it('returns one date in the order things happened', () => {
    expect(glucoseOn(S, '2026-08-22').map(g => g.t)).toEqual(['07:05', '12:10'])
    expect(dosesOn(S, '2026-08-22').map(d => d.t)).toEqual(['07:10', '12:15'])
  })

  it('spans a period oldest first, across the date boundary', () => {
    expect(glucoseBetween(S, '2026-08-21', '2026-08-22').map(g => g.id)).toEqual(['c', 'b', 'a'])
    expect(dosesBetween(S, '2026-08-01', '2026-08-31')).toHaveLength(2)
    expect(glucoseBetween(S, '2026-08-22', '2026-08-22')).toHaveLength(2)
  })

  it('copes with a profile that has never logged anything', () => {
    expect(glucoseOn({}, '2026-08-22')).toEqual([])
    expect(dosesOn(null, '2026-08-22')).toEqual([])
    expect(glucoseBetween({}, '2026-01-01', '2026-12-31')).toEqual([])
  })
})

describe('timeInRange', () => {
  const rs = [{ v: 3.2 }, { v: 5.5 }, { v: 7.0 }, { v: 12.4 }, { v: 9.9 }]

  it('splits the readings three ways', () => {
    const r = timeInRange(rs)
    expect(r).toMatchObject({ n: 5, below: 1, within: 3, above: 1 })
    expect(r.belowPct).toBe(20)
    expect(r.withinPct).toBe(60)
    expect(r.abovePct).toBe(20)
  })

  it('counts the boundaries as in range, both ends', () => {
    expect(timeInRange([{ v: 3.9 }, { v: 10.0 }]).within).toBe(2)
    expect(timeInRange([{ v: 3.8 }]).below).toBe(1)
    expect(timeInRange([{ v: 10.1 }]).above).toBe(1)
  })

  it('follows a target range the care team set, not the default', () => {
    expect(timeInRange(rs, { lo: 4.0, hi: 8.0 })).toMatchObject({ below: 1, within: 2, above: 2 })
  })

  it('reports nothing rather than 0% on no readings', () => {
    expect(timeInRange([])).toMatchObject({ n: 0, withinPct: 0 })
    expect(timeInRange(null).n).toBe(0)
  })
})

describe('glucoseStats', () => {
  const rs = [{ v: 3.2 }, { v: 5.5 }, { v: 7.0 }, { v: 12.4 }, { v: 9.9 }]

  it('averages and spreads the readings', () => {
    const s = glucoseStats(rs)
    expect(s.n).toBe(5)
    expect(s.mean).toBe(7.6)          // 38.0 / 5
    expect(s.min).toBe(3.2)
    expect(s.max).toBe(12.4)
    expect(s.sd).toBe(3.2)            // population SD of the five
  })

  it('carries the range split along, so a report needs one call', () => {
    expect(glucoseStats(rs).withinPct).toBe(60)
  })

  it('says null rather than 0 when there is nothing to average', () => {
    expect(glucoseStats([])).toMatchObject({ n: 0, mean: null, sd: null })
  })

  it('ignores an entry with no number in it', () => {
    expect(glucoseStats([{ v: 6 }, { v: null }, {}]).n).toBe(1)
  })
})

describe('doseTotals', () => {
  it('splits insulin by what it was for', () => {
    const d = doseTotals([
      { u: 6, kind: 'meal' }, { u: 2.5, kind: 'correction' },
      { u: 14, kind: 'basal' }, { u: 4, kind: 'meal' }
    ])
    expect(d).toMatchObject({ meal: 10, correction: 2.5, basal: 14, total: 26.5, n: 4 })
  })

  it('treats an unlabelled dose as a meal dose, like the entry form does', () => {
    expect(doseTotals([{ u: 3 }]).meal).toBe(3)
  })

  it('is safe on nothing at all', () => {
    expect(doseTotals([])).toMatchObject({ total: 0, n: 0 })
    expect(doseTotals(null).total).toBe(0)
  })

  it('does not let a junk entry poison the total', () => {
    expect(doseTotals([{ u: 5 }, { u: 'x' }, { u: 0 }]).total).toBe(5)
  })
})

describe('bandOf', () => {
  it('places a reading against the target', () => {
    expect(bandOf(3.8)).toBe('below')
    expect(bandOf(3.9)).toBe('in')
    expect(bandOf(10.0)).toBe('in')
    expect(bandOf(10.1)).toBe('above')
    expect(bandOf(null)).toBe('none')
  })
})

describe('daysBack', () => {
  it('ends on the day asked for and counts backwards', () => {
    expect(daysBack(3, '2026-08-23')).toEqual(['2026-08-21', '2026-08-22', '2026-08-23'])
  })

  it('crosses a month boundary', () => {
    expect(daysBack(2, '2026-03-01')).toEqual(['2026-02-28', '2026-03-01'])
  })

  it('crosses a leap day', () => {
    expect(daysBack(2, '2024-03-01')).toEqual(['2024-02-29', '2024-03-01'])
  })
})

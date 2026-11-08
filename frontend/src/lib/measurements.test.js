import { describe, expect, it } from 'vitest'
import { measurementSeries, saveMeasurement } from './measurements.js'

describe('measurements', () => {
  it('replaces the entry for the same day', () => {
    const next = saveMeasurement([{ d: '2026-01-01', waist: 90 }], { d: '2026-01-01', waist: 89.4 })
    expect(next).toHaveLength(1)
    expect(next[0].waist).toBe(89.4)
  })

  it('builds chart points only for the requested field', () => {
    expect(measurementSeries([{ d: '2026-01-01', waist: 90 }, { d: '2026-01-02', chest: 100 }], 'waist')).toHaveLength(1)
  })
})

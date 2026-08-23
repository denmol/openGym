import { describe, expect, it } from 'vitest'
import { parseBodyweight } from './import-csv.js'

describe('Apple Health body-weight units', () => {
  it('converts each record from its own unit instead of applying the last unit to every row', () => {
    const parsed = parseBodyweight(`
      <HealthData>
        <Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="80" startDate="2026-08-22T08:00:00Z" />
        <Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" value="220" startDate="2026-08-23T08:00:00Z" />
      </HealthData>
    `, { unit: 'kg' })

    expect(parsed.mixedUnits).toBe(true)
    expect(parsed.converted).toBe(true)
    expect(parsed.bodyweight.map(({ d, w, u }) => ({ d, w, u }))).toEqual([
      { d: '2026-08-22', w: 80, u: 'kg' },
      { d: '2026-08-23', w: 99.8, u: 'kg' }
    ])
  })
})

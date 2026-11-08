import { describe, expect, it } from 'vitest'
import { plateLoad, plateSummary } from './plates.js'

describe('plateLoad', () => {
  it('loads a 100 kg bar evenly', () => {
    expect(plateLoad(100, 'kg')).toEqual({ bar: 20, plates: [{ weight: 25, count: 1 }, { weight: 15, count: 1 }], remainder: 0 })
  })

  it('uses a 45 lb bar by default', () => {
    expect(plateSummary(135, 'lb')).toContain('45 lb / side')
  })

  it('reports an unloadable remainder', () => {
    expect(plateLoad(20.5, 'kg').remainder).toBe(0.25)
  })
})

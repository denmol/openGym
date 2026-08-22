import { describe, it, expect } from 'vitest'
import { EQ_PRESETS, ALL_EQUIPMENT, eqOfPreset, shortlist, shortlistLines, SHORTLIST_MAX } from './coach-catalog.js'
import { EXIDX } from './exercises.js'

describe('equipment presets', () => {
  it('only names equipment the catalogue actually has', () => {
    for (const [key, preset] of Object.entries(EQ_PRESETS)) {
      const unknown = preset.eq.filter(e => !ALL_EQUIPMENT.includes(e))
      expect(unknown, `preset "${key}" names equipment no exercise uses`).toEqual([])
    }
  })

  it('expands a known key and stays empty for an unknown one', () => {
    expect(eqOfPreset('bodyweight')).toContain('body weight')
    expect(eqOfPreset('nope')).toEqual([])
  })

  it('hands back a copy, so a caller cannot edit the preset', () => {
    const a = eqOfPreset('home')
    a.push('barbell')
    expect(eqOfPreset('home')).not.toContain('barbell')
  })
})

describe('shortlist', () => {
  it('never offers an exercise the user has no equipment for', () => {
    for (const preset of Object.values(EQ_PRESETS)) {
      const have = new Set(preset.eq)
      const bad = shortlist(preset.eq).filter(e => !have.has(e.eq))
      expect(bad.map(e => e.n)).toEqual([])
    }
  })

  it('gives every preset enough to build a week from, and stays inside the cap', () => {
    for (const [key, preset] of Object.entries(EQ_PRESETS)) {
      const list = shortlist(preset.eq)
      expect(list.length, `preset "${key}" is too thin to program from`).toBeGreaterThan(30)
      expect(list.length).toBeLessThanOrEqual(SHORTLIST_MAX)
    }
  })

  it('covers the major body parts even on the most limited preset', () => {
    const parts = new Set(shortlist(EQ_PRESETS.bodyweight.eq).map(e => e.bp))
    for (const need of ['upper legs', 'back', 'chest', 'waist']) expect(parts).toContain(need)
  })

  it('leaves cardio out — v1 does not program conditioning', () => {
    expect(shortlist(EQ_PRESETS.gym.eq).some(e => e.bp === 'cardio')).toBe(false)
  })

  it('honours exclusions', () => {
    const first = shortlist(EQ_PRESETS.gym.eq)[0]
    expect(shortlist(EQ_PRESETS.gym.eq, { exclude: [first.id] }).some(e => e.id === first.id)).toBe(false)
  })

  it('returns nothing when no equipment is selected', () => {
    expect(shortlist([])).toEqual([])
  })
})

describe('shortlistLines', () => {
  it('writes one resolvable id per line with five fields', () => {
    const lines = shortlistLines(shortlist(EQ_PRESETS.home.eq)).split('\n')
    expect(lines.length).toBeGreaterThan(30)
    for (const line of lines) {
      const parts = line.split('|')
      expect(parts).toHaveLength(5)
      expect(EXIDX[parts[0]], `id ${parts[0]} is not in the catalogue`).toBeTruthy()
    }
  })

  it('stays small enough to paste', () => {
    expect(shortlistLines(shortlist(EQ_PRESETS.gym.eq)).length).toBeLessThan(12000)
  })
})

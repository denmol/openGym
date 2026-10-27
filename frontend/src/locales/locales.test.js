import { describe, it, expect } from 'vitest'

const packs = import.meta.glob('./*.js', { eager: true })
const ph = s => (s.match(/\{\d+\}/g) || []).sort().join()

describe('locale packs', () => {
  const langs = Object.entries(packs).filter(([f]) => !f.endsWith('.test.js')).map(([f, m]) => [f.slice(2, -3), m.default])
  const union = new Set(langs.flatMap(([, d]) => Object.keys(d)))

  it('every language carries every key', () => {
    for (const [l, d] of langs) {
      const missing = [...union].filter(k => !(k in d))
      expect({ l, missing: missing.slice(0, 5), n: missing.length }).toEqual({ l, missing: [], n: 0 })
    }
  })
  it('keeps the {n} placeholders of the English source', () => {
    for (const [l, d] of langs) {
      const bad = Object.entries(d).filter(([k, v]) => ph(k) !== ph(v)).map(([k]) => k)
      expect({ l, bad: bad.slice(0, 3) }).toEqual({ l, bad: [] })
    }
  })
})

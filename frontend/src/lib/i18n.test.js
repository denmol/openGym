import { describe, it, expect } from 'vitest'
import { detectLang, LANGS } from './i18n.js'

describe('detectLang', () => {
  it('picks the first preferred language the app has a pack for', () => {
    expect(detectLang(['sv-SE', 'en-US'])).toBe('sv')
    expect(detectLang(['nb-NO', 'de-AT', 'sv'])).toBe('de')
    expect(detectLang(['ZH-cn'])).toBe('zh')
  })
  it('falls back to English', () => {
    expect(detectLang(['fi-FI', 'ja'])).toBe('en')
    expect(detectLang([])).toBe('en')
    expect(detectLang(undefined)).toBe('en')
  })
  it('only ever returns a language the app lists', () => {
    for (const p of ['sv', 'de', 'xx']) expect(LANGS[detectLang([p])]).toBeTruthy()
  })
})

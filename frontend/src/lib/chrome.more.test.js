import { describe, it, expect } from 'vitest'
import { MORE_ITEMS, moreActive, moreItemsFor } from './chrome.js'

describe('tab bar menu', () => {
  it('holds everything that is not one of the four main places', () => {
    expect(MORE_ITEMS.map(([k]) => k)).toEqual(['stats', 'history', 'library', 'settings', 'admin'])
  })
  it('lights up on screens that live under it, and on none of the main ones', () => {
    for (const k of ['stats', 'history', 'library', 'settings', 'admin', 'report']) expect(moreActive(k)).toBe(true)
    for (const k of ['home', 'plan', 'food', 'workout']) expect(moreActive(k)).toBe(false)
  })
  it('shows the admin entry to admins only', () => {
    expect(moreItemsFor(false).map(([k]) => k)).not.toContain('admin')
    expect(moreItemsFor(true).map(([k]) => k)).toContain('admin')
  })
})

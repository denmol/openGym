import { describe, expect, it } from 'vitest'
import { tabBarFolded, sheetIsTall, FOLD_AFTER, TOP_ZONE, SLACK } from './chrome.js'

describe('tabBarFolded', () => {
  it('stays open at the top, whatever the movement', () => {
    expect(tabBarFolded(true, 0, 300)).toBe(false)
    expect(tabBarFolded(false, TOP_ZONE - 1, 0)).toBe(false)
  })
  it('folds on a real scroll down once past the threshold', () => {
    expect(tabBarFolded(false, FOLD_AFTER + 40, FOLD_AFTER + 10)).toBe(true)
  })
  it('does not fold before the threshold', () => {
    expect(tabBarFolded(false, FOLD_AFTER - 1, FOLD_AFTER - 30)).toBe(false)
  })
  it('opens again on the first real scroll up', () => {
    expect(tabBarFolded(true, 500, 520)).toBe(false)
  })
  it('ignores a jitter smaller than the slack, in either direction', () => {
    expect(tabBarFolded(true, 500, 500 + SLACK)).toBe(true)         // up by exactly the slack: still folded
    expect(tabBarFolded(false, 500 + SLACK, 500)).toBe(false)       // down by exactly the slack: still open
  })
  it('keeps its state while the page is still', () => {
    expect(tabBarFolded(true, 400, 400)).toBe(true)
    expect(tabBarFolded(false, 400, 400)).toBe(false)
  })
})

describe('sheetIsTall', () => {
  it('is tall when content fills most of the screen', () => {
    expect(sheetIsTall(700, 844)).toBe(true)
    expect(sheetIsTall(693, 844)).toBe(true)
    expect(sheetIsTall(692, 844)).toBe(false)   // 82% of 844 is 692.08
  })
  it('is a floating panel when there is room around it', () => {
    expect(sheetIsTall(400, 844)).toBe(false)
  })
  it('does not call anything tall when the viewport is unknown', () => {
    expect(sheetIsTall(500, 0)).toBe(false)
  })
})

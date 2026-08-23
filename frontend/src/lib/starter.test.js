import { afterAll, describe, expect, it } from 'vitest'
import { setLang } from './i18n.js'
import { starterRoutines } from './starter.js'

afterAll(() => setLang('en'))

describe('starterRoutines', () => {
  it('stores the Swedish program names, not the English source keys', async () => {
    await setLang('sv')
    expect(starterRoutines().map(r => r.name)).toEqual(['Push', 'Pull', 'Ben'])
  })
})

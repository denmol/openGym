import { it, expect } from 'vitest'
import { usernameOk, MIN_PASSWORD } from './password-rules.js'

it('the form applies the same username rule as the server', () => {
  for (const ok of ['anna', 'Anna.K-1', ' bo_3 ']) expect(usernameOk(ok)).toBe(true)
  for (const bad of ['ab', 'a b c', '-abc', 'x'.repeat(31), 'åke', '']) expect(usernameOk(bad)).toBe(false)
  expect(MIN_PASSWORD).toBe(10)
})

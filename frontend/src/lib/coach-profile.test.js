import { describe, expect, it } from 'vitest'
import { cleanCoachProfile } from './coach-profile.js'

describe('cleanCoachProfile numeric fields', () => {
  it('keeps missing age and height missing instead of turning Number(null) into minimum values', () => {
    const profile = cleanCoachProfile({ age: null, heightCm: '', days: null, minutes: undefined })
    expect(profile.age).toBeNull()
    expect(profile.heightCm).toBeNull()
    expect(profile.days).toBe(3)
    expect(profile.minutes).toBe(60)
  })
})

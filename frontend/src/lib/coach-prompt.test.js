import { describe, it, expect } from 'vitest'
import { buildPrompt, buildRepairPrompt, profileLines } from './coach-prompt.js'
import { DEF_COACH } from './coach-profile.js'
import { EQ_PRESETS } from './coach-catalog.js'
import { EXIDX } from './exercises.js'

const profile = {
  ...DEF_COACH,
  age: 34, sex: 'male', heightCm: 181, level: 'some', goal: 'muscle',
  days: 4, minutes: 60, equipment: EQ_PRESETS.gym.eq
}

describe('profileLines', () => {
  it('leaves out everything the user did not answer', () => {
    const txt = profileLines({ ...DEF_COACH, equipment: ['body weight'] })
    expect(txt).not.toMatch(/Age|Height|Experience|Main goal|Injuries/)
    expect(txt).toContain('Equipment available: body weight')
  })

  it('includes body weight only when one is known', () => {
    expect(profileLines(profile, 'kg', 78.4)).toContain('Body weight: 78.4 kg')
    expect(profileLines(profile, 'kg', null)).not.toContain('Body weight')
  })

  it('writes the goal and level as prose, not as internal keys', () => {
    const txt = profileLines(profile)
    expect(txt).toContain('Build muscle')
    expect(txt).toContain('A year or two in')
    expect(txt).not.toContain('fatloss')
  })
})

describe('buildPrompt', () => {
  const prompt = buildPrompt(profile, { lang: 'sv', unit: 'kg', bodyweight: 78.4 })

  it('forbids weights — a new account has nothing to base them on', () => {
    expect(prompt).toMatch(/Do NOT include a "weight" field/)
  })

  it('asks for the day names in the app language', () => {
    expect(prompt).toContain('in Svenska')
  })

  it('states the requested days and session length', () => {
    expect(prompt).toContain('4 training days per week')
    expect(prompt).toContain('about 60 minutes')
  })

  it('says "day" in the singular for a one-day week', () => {
    expect(buildPrompt({ ...profile, days: 1 })).toContain('1 training day per week')
  })

  it('carries only resolvable exercise ids', () => {
    const body = prompt.slice(prompt.indexOf('EXERCISES YOU MAY USE'))
    const ids = body.split('\n').slice(2).filter(Boolean).map(l => l.split('|')[0])
    expect(ids.length).toBeGreaterThan(30)
    for (const id of ids) expect(EXIDX[id], `unknown id ${id}`).toBeTruthy()
  })

  it('offers no exercise the person lacks equipment for', () => {
    const bw = buildPrompt({ ...profile, equipment: EQ_PRESETS.bodyweight.eq })
    const body = bw.slice(bw.indexOf('EXERCISES YOU MAY USE'))
    const eq = body.split('\n').slice(2).filter(Boolean).map(l => l.split('|')[3])
    for (const e of eq) expect(EQ_PRESETS.bodyweight.eq).toContain(e)
  })

  it('stays a reasonable size to paste', () => {
    expect(prompt.length).toBeLessThan(14000)
  })

  it('falls back to English for an unknown language code', () => {
    expect(buildPrompt(profile, { lang: 'xx' })).toContain('in English')
  })
})

describe('buildRepairPrompt', () => {
  it('lists the problems and asks for JSON only', () => {
    const txt = buildRepairPrompt(['Unknown exercise id "9999".', 'Thursday has no routine.'])
    expect(txt).toContain('1. Unknown exercise id "9999".')
    expect(txt).toContain('2. Thursday has no routine.')
    expect(txt).toMatch(/corrected JSON object only/)
  })

  it('does not repeat the catalogue — the chat still has it', () => {
    expect(buildRepairPrompt(['x']).length).toBeLessThan(400)
  })
})

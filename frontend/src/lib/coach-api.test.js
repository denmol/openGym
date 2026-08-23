import { describe, it, expect, vi, afterEach } from 'vitest'
import { generatePlan, coachStatus, MAX_REPAIRS } from './coach-api.js'
import { DEF_COACH } from './coach-profile.js'
import { EQ_PRESETS } from './coach-catalog.js'

const profile = { ...DEF_COACH, days: 1, minutes: 60, equipment: EQ_PRESETS.gym.eq }

// 0043 is the barbell squat; a one-day week with it validates cleanly.
const goodPlan = () => ({
  opengym_plan: 1,
  name: 'Helkropp',
  week: { 1: 'r1' },
  routines: [{ id: 'r1', name: 'A', emoji: 'barbell', ex: [{ id: '0043', sets: 3, reps: 8, prog: 'linear', inc: 2.5 }] }]
})
const badPlan = () => {
  const p = goodPlan()
  p.routines[0].ex[0].id = '9999'          // an id that does not exist
  return p
}

/** Queue of responses; each fetch call takes the next one. */
function mockApi(queue) {
  const calls = []
  global.fetch = vi.fn(async (path, opts) => {
    calls.push({ path, body: opts && opts.body ? JSON.parse(opts.body) : null })
    const next = queue.shift()
    return { ok: true, json: async () => next }
  })
  return calls
}

afterEach(() => { vi.restoreAllMocks(); delete global.fetch })

describe('coachStatus', () => {
  it('reports what the server says', async () => {
    mockApi([{ enabled: true, model: 'gpt-5.6-luna', left: 19, limit: 20 }])
    expect(await coachStatus()).toMatchObject({ enabled: true, model: 'gpt-5.6-luna', left: 19 })
  })

  it('treats a signed-out caller as "not available", not as a failure', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: 'not signed in' }) }))
    const s = await coachStatus()
    expect(s.enabled).toBe(false)
    expect(s.error).toBeNull()
  })

  it('keeps a real error message for anything else', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }))
    expect((await coachStatus()).error).toBe('boom')
  })
})

describe('generatePlan', () => {
  it('returns the plan when the first answer already validates', async () => {
    const calls = mockApi([{ plan: goodPlan(), raw: '{}', left: 19 }])
    const r = await generatePlan(profile)
    expect(r.errors).toEqual([])
    expect(r.data.routines).toHaveLength(1)
    expect(r.left).toBe(19)
    expect(calls).toHaveLength(1)
  })

  it('sends the prompt, and no repair, on the first call', async () => {
    const calls = mockApi([{ plan: goodPlan(), raw: '{}' }])
    await generatePlan(profile, { lang: 'sv' })
    expect(calls[0].body.prompt).toContain('EXERCISES YOU MAY USE')
    expect(calls[0].body.repair).toBeUndefined()
  })

  it('repairs a rejected plan without asking the user', async () => {
    const calls = mockApi([
      { plan: badPlan(), raw: 'FÖRSTA SVARET' },
      { plan: goodPlan(), raw: '{}' }
    ])
    const r = await generatePlan(profile)
    expect(r.errors).toEqual([])
    expect(calls).toHaveLength(2)
    // The second call carries the first answer and the specific complaint.
    expect(calls[1].body.previous).toBe('FÖRSTA SVARET')
    expect(calls[1].body.repair).toContain('does not exist')
    expect(calls[1].body.prompt).toBe(calls[0].body.prompt)
  })

  it('gives up after the repair limit and hands the errors back', async () => {
    const calls = mockApi(Array.from({ length: 6 }, () => ({ plan: badPlan(), raw: 'x' })))
    const r = await generatePlan(profile)
    expect(calls).toHaveLength(1 + MAX_REPAIRS)
    expect(r.errors.length).toBeGreaterThan(0)
  })

  it('does not spend a repair round on warnings alone', async () => {
    // Three sets of squats once a week is valid but under the volume floor.
    const calls = mockApi([{ plan: goodPlan(), raw: '{}' }])
    const r = await generatePlan(profile)
    expect(calls).toHaveLength(1)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.errors).toEqual([])
  })

  it('reports progress so the UI can say what is happening', async () => {
    mockApi([{ plan: badPlan(), raw: 'x' }, { plan: goodPlan(), raw: '{}' }])
    const steps = []
    await generatePlan(profile, { onStep: s => steps.push(s) })
    expect(steps[0]).toBe('asking')
    expect(steps).toContain('fixing')
    expect(steps[steps.length - 1]).toBe('checking')
  })

  it('lets a server error through to the caller', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: 'daily limit reached' }) }))
    await expect(generatePlan(profile)).rejects.toThrow(/daily limit/)
  })
})

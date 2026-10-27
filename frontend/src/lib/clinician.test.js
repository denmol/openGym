import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

const FLAGGED = { condition: true, medication: true, incretinUse: 'weight', weightPhase: 'active_loss', safety: { eatingDisorder: true } }

describe('clinician build', () => {
  it('keeps every gate closed by default', async () => {
    const g = await import('./nutrition-goals.js')
    expect(g.nutritionAiGate(FLAGGED, { age: 40, today: '2026-10-27' })).toBe(true)
    expect(g.needsClinicianTargets(FLAGGED)).toBe(true)
  })

  it('opens them when VITE_CLINICIAN_MODE=1', async () => {
    vi.stubEnv('VITE_CLINICIAN_MODE', '1')
    vi.resetModules()
    const g = await import('./nutrition-goals.js')
    expect(g.nutritionAiGate(FLAGGED, { age: 40, today: '2026-10-27' })).toBe(false)
    expect(g.needsClinicianTargets(FLAGGED, { diabetes: true })).toBe(false)
  })

  it('stops flagging the trainer request as medical', async () => {
    vi.stubEnv('VITE_CLINICIAN_MODE', '1')
    vi.resetModules()
    const { trainerContext } = await import('./trainer-ai.js')
    const S = { coachProfile: { age: 40, limits: 'knee pain' }, health: { on: true }, workouts: [], bodyweight: [] }
    expect(trainerContext(S, { findings: [] }).medical).toBe(false)
  })
})

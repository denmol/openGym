import { it, expect, vi, afterEach } from 'vitest'
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
const S = {
  coachProfile: { age: 45, sex: 'f', heightCm: 168 }, bodyweight: [{ d: '2026-10-20', kg: 70 }],
  health: { on: true }, savedMeals: [], meals: [],
  nutritionGoals: { goal: 'maintain', condition: true, medication: true, incretinUse: 'none', targets: { kcal: 2000, prot: 100 } }
}
it('a flagged profile is blocked normally and gets a plan result in clinician mode', async () => {
  let m = await import('./mealplan.js')
  const normal = m.mealPlanTargets(S, '2026-10-27')
  expect(normal.ok).toBe(false)
  vi.stubEnv('VITE_CLINICIAN_MODE', '1'); vi.resetModules()
  m = await import('./mealplan.js')
  const open = m.mealPlanTargets(S, '2026-10-27')
  expect(open).toMatchObject({ ok: true })
})

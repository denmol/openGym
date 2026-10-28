import { it, expect, vi, afterEach } from 'vitest'
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

it('does nothing unless the build asks for it', async () => {
  const { SPEED_INSIGHTS, startSpeedInsights } = await import('./speed-insights.js')
  expect(SPEED_INSIGHTS).toBe(false)
  expect(() => startSpeedInsights()).not.toThrow()
})
it('is switched on by VITE_SPEED_INSIGHTS=1', async () => {
  vi.stubEnv('VITE_SPEED_INSIGHTS', '1'); vi.resetModules()
  expect((await import('./speed-insights.js')).SPEED_INSIGHTS).toBe(true)
})

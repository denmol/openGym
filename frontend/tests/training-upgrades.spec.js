import { test, expect } from '@playwright/test'

test('guest can open training upgrade surfaces', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /guest|continue/i }).click().catch(() => {})
  await page.goto('/plan')
  await expect(page.getByText(/starter|startplan/i).first()).toBeVisible()
  await page.goto('/stats')
  await expect(page.getByText(/body weight|kroppsvikt/i).first()).toBeVisible()
})

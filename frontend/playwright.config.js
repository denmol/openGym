import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:8080', ...devices['iPhone 13'] },
  webServer: { command: 'npm run dev -- --host 0.0.0.0 --port 8080', url: 'http://127.0.0.1:8080', reuseExistingServer: true }
})

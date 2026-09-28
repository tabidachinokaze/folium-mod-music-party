import { defineConfig } from '@playwright/test'

// playwright.config.ts
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  use: {
    channel: 'chromium',
    baseURL: 'http://127.0.0.1:4176',
    viewport: { width: 1100, height: 1020 },
    trace: 'retain-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'node tests/server.mjs',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: false,
  },
})

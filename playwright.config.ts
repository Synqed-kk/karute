import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'

// Load the E2E env into process.env so globalSetup (seed scripts) and the
// webServer (next dev) both see the test Supabase project + local synqed.
const e2eEnv = loadEnv({ path: '.env.e2e' }).parsed ?? {}

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    locale: 'en-US',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'authed',
      testIgnore: /auth-lifecycle\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/dev-user.json' },
    },
    {
      name: 'unauth',
      testMatch: /auth-lifecycle\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'next dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ...process.env, ...e2eEnv } as Record<string, string>,
  },
})

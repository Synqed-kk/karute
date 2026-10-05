// Bottom-bar hit-test (S106 FB7): its OWN config, separate from the repo's
// e2e config (which boots next dev + seeds). Runs in CI:
//   npx --no -- playwright test -c e2e/layout/playwright.config.ts
// Files here end in .layout.ts so the e2e config's default testMatch never
// picks them up.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: /\.layout\.ts$/,
  globalSetup: './build-harness.ts',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results/layout',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})

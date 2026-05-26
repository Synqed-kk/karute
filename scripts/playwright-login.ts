// Walks the /en/login form once and saves the resulting browser session
// (cookies + localStorage) to .auth/dev-user.json. Future Playwright runs
// load that state via the storageState option and skip login.
//
// Requires the dev server to be running on http://localhost:3000.
// Run scripts/seed-test-user.ts first if the test account doesn't exist.
//
// Usage: npx tsx scripts/playwright-login.ts

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const EMAIL = 'dev@karute.test'
const PASSWORD = 'TestPass123!'
const STATE_DIR = '.auth'
const STATE_FILE = join(STATE_DIR, 'dev-user.json')

async function main() {
  await mkdir(STATE_DIR, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(`${BASE_URL}/en/login`)
  await page.getByRole('textbox', { name: 'Email' }).fill(EMAIL)
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/en\/(dashboard|appointments|customers|karute)/, { timeout: 10_000 })

  await context.storageState({ path: STATE_FILE })
  console.log(`Saved storage state to ${STATE_FILE}`)

  await browser.close()
}

main().catch((err) => { console.error(err); process.exit(1) })

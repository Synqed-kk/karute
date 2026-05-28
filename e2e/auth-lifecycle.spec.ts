import { test, expect } from './fixtures'

// Runs in the `unauth` project (no stored session). Covers the redirect gate
// and the login→logout lifecycle using the seeded dev account. (Signup →
// bootstrap-business is exercised separately by scripts/seed-test-user.ts,
// which the global-setup runs; the Next server action can't be imported into
// the Playwright runtime directly.)
// Use a DIFFERENT seeded account than the authed specs (dev@karute.test).
// Supabase signOut is global-scope, so logging this account out must not
// invalidate the shared dev session the authed project relies on.
const EMAIL = 'liam@karute.test'
const PASSWORD = 'TestPass123!'

test('unauthenticated dashboard redirects to login', async ({ page }) => {
  await page.goto('/en/dashboard')
  await expect(page).toHaveURL(/\/en\/login/)
})

test('login then logout', async ({ page }) => {
  await page.goto('/en/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(EMAIL)
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/en\/(dashboard|appointments|customers|karute)/, { timeout: 15_000 })

  // Open the sidebar profile chip (last button in the nav complementary) and log out.
  await page.getByRole('complementary', { name: 'Main navigation' }).getByRole('button').last().click()
  await page.getByRole('button', { name: /log\s?out|logout/i }).click()
  await expect(page).toHaveURL(/\/en\/login/, { timeout: 15_000 })
})

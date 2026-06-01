import { test, expect } from './fixtures'

// Exercises the customer write path end-to-end: form → server action →
// synqed-core → the customer appears in the list. A timestamped given-name
// avoids the form's duplicate-name guard; the idempotent seed-reset
// (seed-booking-data) clears it on the next suite run, so no API teardown.
const FAMILY = 'E2EFam'
const GIVEN = `Case${Date.now()}`
const FULL = `${FAMILY} ${GIVEN}`

test('create a customer via the form and see it in the list', async ({ page }) => {
  await page.goto('/en/customers')
  await page.getByRole('button', { name: '+ New Customer' }).click()
  await expect(page.getByText('Add New Customer')).toBeVisible()
  await page.getByPlaceholder('Tanaka').fill(FAMILY)
  await page.getByPlaceholder('Misaki').fill(GIVEN)
  await page.getByRole('button', { name: 'Create Customer' }).click()
  // Back on the list, the new customer shows (desktop + mobile variants → first()).
  await expect(page.getByText(FULL).first()).toBeVisible({ timeout: 15_000 })
})

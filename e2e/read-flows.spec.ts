import { test, expect } from './fixtures'

test.describe('read/nav flows render with real seeded data', () => {
  test('dashboard renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/dashboard')
    await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible()
    void consoleErrors // asserted in fixture teardown
  })

  test('customers list shows a seeded customer', async ({ page }) => {
    await page.goto('/en/customers')
    // The list renders both desktop-row and mobile-card variants in the DOM
    // (one hidden per breakpoint), so scope to the first match.
    await expect(page.getByText('高橋 由美').first()).toBeVisible()
  })

  test('customer profile opens from the list', async ({ page }) => {
    await page.goto('/en/customers')
    await page.getByText('高橋 由美').first().click()
    await expect(page).toHaveURL(/\/en\/customers\/[^/]+$/)
  })

  test('karute list renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/karute')
    await expect(page.getByRole('heading', { name: /karute/i })).toBeVisible()
    void consoleErrors
  })

  test('appointments view renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/appointments')
    await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible()
    void consoleErrors
  })

  test('settings renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/settings')
    await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible()
    void consoleErrors
  })

  test('coaching renders', async ({ page, consoleErrors }) => {
    await page.goto('/en/coaching')
    await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeVisible()
    void consoleErrors
  })
})

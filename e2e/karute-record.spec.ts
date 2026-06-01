import { test, expect } from './fixtures'

// Core write flow via the manual "Create new karute" dialog (the non-audio
// path — the recorder/AI path needs a mic, out of scope for headless). Creates
// a karute record for a seeded customer and verifies the dialog completes.
test('create a karute record via the manual dialog', async ({ page }) => {
  await page.goto('/en/karute')
  // Open the new-karute dialog (CTA label may be "New Karute" / "+ New Karute").
  await page.getByRole('button', { name: /new karute/i }).first().click()
  await expect(page.getByText('Create new karute')).toBeVisible()

  // Pick a seeded customer via the search-by-name combobox (focus opens the
  // listbox; results are role=option).
  const search = page.getByPlaceholder('Search by name')
  await search.click()
  await search.fill('高橋')
  await page.getByRole('option', { name: /高橋/ }).first().click()

  // Create. The dialog closes and we're back on the karute surface.
  await page.getByRole('button', { name: 'Create karute' }).click()
  await expect(page.getByText('Create new karute')).toBeHidden({ timeout: 15_000 })
  // Create succeeds → navigates to the new karute's detail page under the
  // current locale (/en/karute/<id>).
  await expect(page).toHaveURL(/\/en\/karute\/[0-9a-f-]+$/, { timeout: 15_000 })
})

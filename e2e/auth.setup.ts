import { test as setup, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const EMAIL = 'dev@karute.test'
const PASSWORD = 'TestPass123!'
const STATE = '.auth/dev-user.json'

setup('authenticate dev user', async ({ page }) => {
  mkdirSync('.auth', { recursive: true })
  await page.goto('/en/login')
  await page.getByRole('textbox', { name: 'Email' }).fill(EMAIL)
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/en\/(dashboard|appointments|customers|karute)/, { timeout: 15_000 })
  await expect(page).toHaveURL(/\/en\//)
  await page.context().storageState({ path: STATE })
})

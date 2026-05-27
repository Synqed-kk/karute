import { test as base, expect } from '@playwright/test'

// Extends the base test so any console error or uncaught page error fails the
// test. This is the guard that catches Server-Component render errors like the
// ones /customers and /karute threw without real synqed data.
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))
    await use(errors)
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([])
  },
})

export { expect }

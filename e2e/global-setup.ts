import { execFileSync } from 'node:child_process'
import type { FullConfig } from '@playwright/test'

// Seeds the known dev account + a business (seed-test-user) and real synqed-core
// customers/appointments (seed-booking-data). Both scripts are idempotent. The
// E2E env is already in process.env (loaded in playwright.config.ts), so the
// child processes inherit the test Supabase + local synqed config.
export default async function globalSetup(_config: FullConfig) {
  const run = (script: string) => {
    console.log(`[global-setup] running ${script}…`)
    execFileSync('npx', ['tsx', script], { stdio: 'inherit', env: process.env })
  }
  run('scripts/seed-test-user.ts')
  run('scripts/seed-booking-data.ts')
  console.log('[global-setup] seed complete')
}

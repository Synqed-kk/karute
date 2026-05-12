// Seed a known test user for local dev login. Uses the Supabase admin API
// (so it bypasses email confirmation + signup-form email validation) and
// runs the same bootstrap action the signup form runs.
//
// Usage:
//   npx ts-node scripts/seed-test-user.ts
//   npx ts-node scripts/seed-test-user.ts -- some@email.com 'somePass!'
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const DEFAULT_EMAIL = 'dev@karute.test'
const DEFAULT_PASSWORD = 'TestPass123!'
const DEFAULT_SALON = 'Dev Salon'

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }

  const [, , emailArg, passwordArg, salonArg] = process.argv
  const email = emailArg || DEFAULT_EMAIL
  const password = passwordArg || DEFAULT_PASSWORD
  const salon = salonArg || DEFAULT_SALON

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  console.log(`Looking up existing user: ${email}`)
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (listErr) throw listErr
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())

  let userId: string
  if (existing) {
    console.log(`User exists (${existing.id}) — resetting password`)
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    })
    if (error) throw error
    userId = existing.id
  } else {
    console.log(`Creating user: ${email}`)
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) throw error
    userId = data.user!.id
    console.log(`Created user: ${userId}`)

    // Run the same bootstrap path the signup form uses, so the user has
    // a profile + staff record and can actually use the app.
    const { bootstrapBusinessForNewUser } = await import('../src/actions/bootstrap')
    const result = await bootstrapBusinessForNewUser(salon, userId)
    if (!result.ok) {
      console.error('Bootstrap failed:', result)
      process.exit(1)
    }
    console.log(`Bootstrapped business: ${result.businessId}`)
  }

  console.log('\n─────────────────────────────────────────────')
  console.log(`Login at http://localhost:3000/en/login`)
  console.log(`  email:    ${email}`)
  console.log(`  password: ${password}`)
  console.log('─────────────────────────────────────────────')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

// Seed a known test user for local + preview environments. Idempotent.
// Usage: npx tsx --env-file=.env scripts/seed-test-user.ts

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const EMAIL = 'dev@karute.test'
const PASSWORD = 'TestPass123!'
const SALON = 'Dev Salon'

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listErr) throw listErr
  const existing = list.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase())

  let userId: string
  if (existing) {
    console.log(`User exists (${existing.id}) — resetting password`)
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    userId = existing.id
  } else {
    console.log(`Creating user: ${EMAIL}`)
    const { data, error } = await supabase.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    userId = data.user!.id
    const { bootstrapBusinessForNewUser } = await import('../src/actions/bootstrap')
    const result = await bootstrapBusinessForNewUser(SALON, userId)
    if (!result.ok) {
      console.error('Bootstrap failed:', result)
      process.exit(1)
    }
    console.log(`Bootstrapped business: ${result.businessId}`)
  }

  console.log('\nLogin at http://localhost:3000/en/login')
  console.log(`  email:    ${EMAIL}`)
  console.log(`  password: ${PASSWORD}`)
}

main().catch((err) => { console.error(err); process.exit(1) })

// Seed known test users for local + preview environments. Idempotent.
// Usage: npx tsx --env-file=.env scripts/seed-test-user.ts
//
// All four accounts share the same password to keep the dev loop simple.
// Each one gets its own business via bootstrapBusinessForNewUser, so they
// don't cross-pollinate staff/customer state when used in parallel.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'TestPass123!'

interface SeedAccount {
  email: string
  salon: string
}

const ACCOUNTS: SeedAccount[] = [
  { email: 'dev@karute.test', salon: 'Dev Salon' },
  { email: 'anthony@karute.test', salon: "Anthony's Salon" },
  { email: 'liam@karute.test', salon: "Liam's Salon" },
  { email: 'jon@karute.test', salon: "Jon's Salon" },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedAccount(supabase: any, account: SeedAccount): Promise<void> {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (listErr) throw listErr
  const existing = list.users.find(
    (u: { email?: string | null }) =>
      u.email?.toLowerCase() === account.email.toLowerCase(),
  )

  let userId: string
  if (existing) {
    console.log(`[${account.email}] exists (${existing.id}) — resetting password`)
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    userId = existing.id
  } else {
    console.log(`[${account.email}] creating`)
    const { data, error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    userId = data.user!.id
  }

  // Bootstrap runs every time so a wiped synqed-core picks up the OWNER row.
  // It's idempotent against re-runs on the same userId.
  const { bootstrapBusinessForNewUser } = await import('../src/actions/bootstrap')
  const result = await bootstrapBusinessForNewUser(account.salon, userId)
  if (!result.ok) {
    console.error(`[${account.email}] bootstrap failed:`, result)
    process.exit(1)
  }
  console.log(`[${account.email}] business ${result.businessId}`)
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
    process.exit(1)
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  for (const account of ACCOUNTS) {
    await seedAccount(supabase, account)
  }

  console.log('\nAll test accounts ready at http://localhost:3000/en/login')
  console.log(`  password (shared): ${PASSWORD}`)
  for (const a of ACCOUNTS) console.log(`  • ${a.email}`)
}

main().catch((err) => { console.error(err); process.exit(1) })

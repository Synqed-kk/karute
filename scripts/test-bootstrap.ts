// Direct test of the bootstrap action against an orphan auth user.
// Avoids Supabase signup rate limits during pilot-readiness verification.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  console.log('Listing recent users…')
  const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 20 })
  if (error) throw error

  const targets = users.filter((u) => u.email?.startsWith('pilot-test-2026'))
  console.log(`Found ${targets.length} pilot-test users`)
  for (const u of targets) console.log('  ', u.id, u.email, 'created:', u.created_at)

  if (targets.length === 0) {
    console.log('No targets — sign up first.')
    return
  }

  // Take the most recent
  const target = targets[0]
  console.log('\nTesting against:', target.id, target.email)

  // Check profile state before
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id, customer_id, full_name, email')
    .eq('id', target.id)
    .maybeSingle()
  console.log('Profile before:', existingProfile)

  // Import & run bootstrap
  const { bootstrapBusinessForNewUser } = await import('../src/actions/bootstrap')
  const result = await bootstrapBusinessForNewUser('Pilot Spa Test', target.id)
  console.log('\nBootstrap result:', result)

  if (!result.ok) return

  // Verify profile + staff
  const { data: profileAfter } = await supabase
    .from('profiles')
    .select('id, customer_id, full_name, email')
    .eq('id', target.id)
    .single()
  console.log('Profile after:', profileAfter)

  const synqedRes = await fetch('http://localhost:3100/v1/staff', {
    headers: {
      'x-api-key': process.env.SYNQED_CORE_API_KEY!,
      'x-business-id': result.businessId,
    },
  })
  const staffJson = await synqedRes.json()
  console.log('synqed-core staff for new business:', staffJson)
}

main().catch((err) => { console.error(err); process.exit(1) })

// Simulates a fresh signup end-to-end using the admin API to bypass
// Supabase's email-rate-limit. Verifies bootstrap creates a usable business.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SYNQED_URL = process.env.SYNQED_CORE_URL!
const SYNQED_KEY = process.env.SYNQED_CORE_API_KEY!

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  const stamp = Date.now()
  const email = `pilot-fresh-${stamp}@gmail.com`
  const salonName = '新規サロン (Fresh Salon)'

  console.log(`Creating user via admin: ${email}`)
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'TestPass123!',
    email_confirm: true,
  })
  if (error) throw error
  const user = data.user!
  console.log('user.id:', user.id)

  // Run the same code path the signup form runs
  const { bootstrapBusinessForNewUser } = await import('../src/actions/bootstrap')
  const result = await bootstrapBusinessForNewUser(salonName, user.id)
  console.log('\nBootstrap result:', result)
  if (!result.ok) { console.error('FAIL'); process.exit(1) }

  // Verify profile shape
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, customer_id, full_name, email')
    .eq('id', user.id)
    .single()
  console.log('\nProfile:', profile)
  if (profile?.full_name !== salonName) {
    console.error('FAIL: full_name mismatch')
    process.exit(1)
  }
  if (profile?.customer_id !== result.businessId) {
    console.error('FAIL: businessId mismatch between profile and bootstrap result')
    process.exit(1)
  }

  // Verify exactly one staff row exists, pinned to this user, role OWNER
  const synqedRes = await fetch(`${SYNQED_URL}/v1/staff`, {
    headers: { 'x-api-key': SYNQED_KEY, 'x-business-id': result.businessId },
  })
  const staffJson = await synqedRes.json()
  console.log('\nsynqed-core staff:', JSON.stringify(staffJson, null, 2))
  const owner = staffJson.staff?.find(
    (s: { user_id?: string | null; role?: string }) =>
      s.user_id === user.id && s.role === 'OWNER',
  )
  if (!owner) { console.error('FAIL: no OWNER staff for this user'); process.exit(1) }
  if (staffJson.total !== 1) {
    console.error(`WARN: expected 1 staff row, got ${staffJson.total}`)
  }

  // Verify idempotency — second call should be a no-op (no extra staff row)
  console.log('\nRe-running bootstrap (idempotency check)…')
  const result2 = await bootstrapBusinessForNewUser(salonName, user.id)
  console.log('Second result:', result2)
  const synqedRes2 = await fetch(`${SYNQED_URL}/v1/staff`, {
    headers: { 'x-api-key': SYNQED_KEY, 'x-business-id': result.businessId },
  })
  const staffJson2 = await synqedRes2.json()
  if (staffJson2.total !== staffJson.total) {
    console.error(`FAIL: idempotency broken — staff count went ${staffJson.total} → ${staffJson2.total}`)
    process.exit(1)
  }

  console.log('\n✅ All checks passed')
}

main().catch((err) => { console.error(err); process.exit(1) })

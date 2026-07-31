// Detect (and optionally fix) "ghost" accounts: confirmed auth users that
// slipped through signup provisioning — no profile.customer_id, or no OWNER
// staff row in synqed-core tied to their user id.
//
// Usage:
//   npx tsx --env-file=.env scripts/sweep-ghost-accounts.ts            # report only
//   npx tsx --env-file=.env scripts/sweep-ghost-accounts.ts --fix     # re-run bootstrap for each ghost
//   ... --fix --email=user@example.com                                # fix one account only
//
// Idempotent: bootstrap only creates what's missing; safe to re-run.

import { createClient } from '@supabase/supabase-js'
import { SynqedClient } from '@synqed-kk/client'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const CORE_URL = process.env.SYNQED_CORE_URL!
const CORE_KEY = process.env.SYNQED_CORE_API_KEY!

type Ghost = {
  id: string
  email: string
  missing: string[]
  salonName: string
}

async function findGhosts(): Promise<Ghost[]> {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const ghosts: Ghost[] = []

  for (let page = 1; ; page++) {
    const {
      data: { users },
      error,
    } = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    if (users.length === 0) break

    for (const user of users) {
      // Unconfirmed users aren't ghosts — they bootstrap when they confirm.
      if (!user.email_confirmed_at) continue

      const missing: string[] = []

      const { data: profile } = await supabase
        .from('profiles')
        .select('customer_id')
        .eq('id', user.id)
        .maybeSingle()

      if (!profile?.customer_id) {
        missing.push('profile.customer_id')
      } else {
        const synqed = new SynqedClient({
          baseUrl: CORE_URL,
          apiKey: CORE_KEY,
          businessId: profile.customer_id as string,
        })
        const { staff } = await synqed.staff.list({ page_size: 200 })
        const hasOwner = staff.some(
          (s) =>
            (s as { user_id?: string | null }).user_id === user.id &&
            s.role === 'OWNER',
        )
        if (!hasOwner) missing.push('synqed-core OWNER staff')
      }

      if (missing.length > 0) {
        const salonName =
          (user.user_metadata?.salon_name as string | undefined) ??
          (user.email ?? '').split('@')[0] ??
          'Salon'
        ghosts.push({ id: user.id, email: user.email ?? '(no email)', missing, salonName })
      }
    }

    if (users.length < 100) break
  }

  return ghosts
}

async function main() {
  const fix = process.argv.includes('--fix')
  const emailArg = process.argv.find((a) => a.startsWith('--email='))?.slice(8)

  let ghosts = await findGhosts()
  if (emailArg) ghosts = ghosts.filter((g) => g.email === emailArg)
  if (ghosts.length === 0) {
    console.log('No ghost accounts found.')
    return
  }

  console.log(`Found ${ghosts.length} ghost account(s):`)
  for (const g of ghosts) {
    console.log(`  ${g.id}  ${g.email}  missing: ${g.missing.join(', ')}`)
  }

  if (!fix) {
    console.log('\nRun with --fix to provision them.')
    return
  }

  const { bootstrapBusinessForNewUser } = await import('../src/actions/bootstrap')
  for (const g of ghosts) {
    const result = await bootstrapBusinessForNewUser(g.salonName, g.id)
    console.log(
      result.ok
        ? `  fixed ${g.email} → business ${result.businessId}`
        : `  FAILED ${g.email}: ${result.error}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

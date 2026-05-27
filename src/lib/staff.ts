import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifySupabaseJwt, LocalJwtError } from '@/lib/auth/local-jwt'

export interface StaffMember {
  id: string
  full_name: string | null
  display_role?: string | null
  position?: string | null
  email?: string | null
  phone?: string | null
  avatar_url?: string | null
  has_pin: boolean
  created_at: string
}

export interface StaffMemberBasic {
  id: string
  full_name: string | null
}

// Inside unstable_cache there's no request context (no cookies → no RLS),
// so we use the service-role client and filter by businessId explicitly.
// The cache key includes businessId so tenants never see each other's data.
const staffListByBusiness = unstable_cache(
  async (businessId: string): Promise<StaffMember[]> => {
    const service = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (service as any)
      .from('profiles')
      .select('id, full_name, created_at, display_role, position, email, phone, avatar_url, pin_hash, customer_id')
      .eq('customer_id', businessId)
      .not('full_name', 'is', null)
      .not('full_name', 'ilike', '_system_%')
      .order('full_name', { ascending: true })

    if (error) {
      console.error('[getStaffList] Supabase error:', error.message)
      return []
    }

    return (data ?? []).map(
      ({
        pin_hash,
        customer_id: _customer_id,
        ...rest
      }: { pin_hash?: string | null; customer_id?: string; [key: string]: unknown }) => ({
        ...rest,
        has_pin: !!pin_hash,
      }),
    ) as StaffMember[]
  },
  // Staff onboarding is a once-in-a-while admin event, not a per-session
  // thing — every karute mutation that changes a staff row (create/update/
  // delete/avatar upload in src/actions/staff.ts) already calls
  // updateTag('staff-list'), so the cache invalidates the moment something
  // actually changes. The TTL is just a backstop in case a non-karute
  // mutation slips in elsewhere (e.g. directly in Supabase). A day is
  // generous and matches the rate of real staff churn.
  ['staff-list-v1'],
  { revalidate: 86400, tags: ['staff-list'] },
)

/**
 * Returns all staff profiles ordered alphabetically by full_name.
 * Returns an empty array on error (safe to render empty list).
 *
 * Two layers of caching:
 *   - React `cache()` dedupes within a single request — the (app)/ layout
 *     plus the individual page (plus any nested server component) all share
 *     one Promise, no repeated cache lookups.
 *   - `unstable_cache` (on staffListByBusiness) reuses the DB read across
 *     requests for 24h. Mutation actions in src/actions/staff.ts call
 *     updateTag('staff-list') to invalidate.
 *
 * The two layers compose: per-request dedup avoids redundant lookups inside
 * one render; cross-request cache avoids redundant DB hits across renders.
 */
export const getStaffList = cache(async (): Promise<StaffMember[]> => {
  try {
    const businessId = await getBusinessId()
    return await staffListByBusiness(businessId)
  } catch {
    return []
  }
})

/**
 * Returns a single staff profile by ID, or null if not found.
 */
export async function getStaffById(id: string): Promise<StaffMemberBasic | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

/**
 * Resolves the staff identity for the currently authenticated user.
 *
 * Looks up the staff row in this tenant whose `id` matches `auth.uid()` — every
 * user gets exactly one staff identity per business, seeded at signup. Returns
 * null if the user has no staff row (e.g. they were removed but their auth
 * session is still alive).
 *
 * Save flows must read staff_id from here — never accept it from client input,
 * never trust a cookie. Replaces the old cookie-backed active-staff pattern,
 * which let stale ids survive auth wipes and caused FK violations.
 */
export const getCurrentUserStaffId = cache(async (): Promise<string | null> => {
  const userId = await resolveUserId().catch(() => null)
  if (!userId) return null
  const list = await getStaffList()
  return list.some((s) => s.id === userId) ? userId : null
})

/**
 * Returns the current authenticated user's business id.
 * Used to scope inserts so RLS allows them. Reads the legacy
 * `profiles.customer_id` column — the legacy schema still names
 * the business column `customer_id` until the legacy-strip lands.
 */
async function resolveUserId(): Promise<string> {
  const supabase = await createClient()
  const jwtSecret = process.env.SUPABASE_JWT_SECRET

  // Fast path: verify the JWT locally if the secret is configured. Skips a
  // ~150ms round-trip to Supabase Auth on every page. Falls back to getUser()
  // when the secret is missing or the token doesn't validate (e.g. just
  // rotated keys) so we never lock users out on a misconfiguration.
  if (jwtSecret) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      try {
        const claims = verifySupabaseJwt(session.access_token, jwtSecret)
        return claims.sub
      } catch (err) {
        if (!(err instanceof LocalJwtError)) throw err
        // fall through to remote verification
      }
    }
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return user.id
}

// Memoized for the lifetime of a single request via React cache(). Called from
// many places per page (every Supabase scope check, every synqed client init)
// so deduping the auth + profile lookup is worth the wrapper.
export const getBusinessId = cache(async (): Promise<string> => {
  const userId = await resolveUserId()
  const service = createServiceClient()
  const { data } = await service
    .from('profiles')
    .select('customer_id')
    .eq('id', userId)
    .single()

  if (!data?.customer_id) throw new Error('Business profile not found')
  return data.customer_id
})

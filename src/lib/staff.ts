import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifySupabaseJwt, LocalJwtError } from '@/lib/auth/local-jwt'
import { AppApiError } from '@/lib/app-api/errors'

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
// Exported for the facade (Bearer path), which resolves businessId from the
// verified token. Plain lib module (NOT 'use server') — exporting this adds
// no client-invocable action endpoint.
export const staffListByBusiness = unstable_cache(
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

    const profileStaff = (data ?? []).map(
      ({
        pin_hash,
        customer_id: _customer_id,
        ...rest
      }: { pin_hash?: string | null; customer_id?: string; [key: string]: unknown }) => ({
        ...rest,
        has_pin: !!pin_hash,
      }),
    ) as StaffMember[]

    // Owner-created teammates land in synqed-core with user_id=null and have
    // NO Supabase profile row until they sign up (a profile is auto-created on
    // signup via the on_auth_user_created trigger; the link is then resolved
    // in src/lib/synqed/staff-map.ts). Reading profiles alone made those
    // freshly-added staff invisible in the roster — the "add staff → it
    // vanishes" bug. Append any synqed-core staff not already represented by a
    // profile row, matched on the same user_id / email link the staff-map
    // resolver uses. synqed-core stays the authoritative write target; profiles
    // remain the canonical id + enrichment source for signed-up staff.
    const synqedOnly = await synqedStaffWithoutProfile(businessId, profileStaff)
    return [...profileStaff, ...synqedOnly]
  },
  // Staff onboarding is a once-in-a-while admin event, not a per-session
  // thing — every karute mutation that changes a staff row (create/update/
  // delete/avatar upload in src/actions/staff.ts) already calls
  // updateTag('staff-list'), so the cache invalidates the moment something
  // actually changes. The TTL is just a backstop in case a non-karute
  // mutation slips in elsewhere (e.g. directly in Supabase). A day is
  // generous and matches the rate of real staff churn.
  // v2: union now includes profile-less synqed-core staff (see above).
  ['staff-list-v2'],
  { revalidate: 86400, tags: ['staff-list'] },
)

/**
 * Returns synqed-core staff that have NO matching Supabase profile row yet —
 * i.e. owner-created teammates who haven't signed up. Matched out by the same
 * two-tier link the staff-map resolver uses: synqed `user_id` → profile id
 * (canonical), then email (case-insensitive) fallback.
 *
 * Degrades to [] when synqed-core env is absent or the fetch fails, so the
 * roster falls back to profiles-only rather than erroring. Mapped to the same
 * StaffMember shape as the profile rows; `id` is the synqed staff id (these
 * staff have no profile id until signup) and `has_pin` is false (PIN lives in
 * the Supabase profile, which doesn't exist for them yet).
 */
async function synqedStaffWithoutProfile(
  businessId: string,
  profileStaff: StaffMember[],
): Promise<StaffMember[]> {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) return []

  const profileIds = new Set(profileStaff.map((s) => s.id))
  const profileEmails = new Set(
    profileStaff
      .map((s) => s.email?.toLowerCase())
      .filter((e): e is string => !!e),
  )

  try {
    // Lazy import so this module's graph doesn't eagerly pull in the
    // synqed-core ESM client — keeps it out of any caller (and test) that
    // never reaches the enrichment path (e.g. when synqed env is unset).
    const { SynqedClient } = await import('@synqed-kk/client')
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    const { staff } = await client.staff.list({ page_size: 200 })
    return staff
      .filter((s) => s.is_active)
      .filter((s) => {
        const linkedUserId = (s as { user_id?: string | null }).user_id ?? null
        if (linkedUserId && profileIds.has(linkedUserId)) return false
        if (s.email && profileEmails.has(s.email.toLowerCase())) return false
        return true
      })
      .map((s) => ({
        id: s.id,
        full_name: s.name,
        display_role: s.role ? s.role.toLowerCase() : null,
        position: null,
        email: s.email,
        phone: null,
        avatar_url: s.avatar_url,
        has_pin: false,
        created_at: s.created_at,
      })) as StaffMember[]
  } catch (err) {
    console.error('[getStaffList] synqed-core roster fetch failed:', err)
    return []
  }
}

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
 * Returns a single staff profile by ID within the caller's business, or null.
 *
 * Service-role + explicit `customer_id` scope (matching staffListByBusiness):
 *   - never crosses tenants — a profile id from another business returns null
 *     (the old version had NO tenant filter and, under the pre-hardening
 *     `using(true)` RLS, could read any profile in the database);
 *   - works in any context, including the cache path where there's no request
 *     cookie for the RLS-bound cookie client.
 * Pairs with the profiles RLS tightening in migration 20260603000000.
 */
export async function getStaffById(id: string): Promise<StaffMemberBasic | null> {
  try {
    const businessId = await getBusinessId()
    const service = createServiceClient()
    const { data, error } = await service
      .from('profiles')
      .select('id, full_name')
      .eq('id', id)
      .eq('customer_id', businessId)
      .maybeSingle()

    if (error) return null
    return data
  } catch {
    return null
  }
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
export async function resolveUserId(): Promise<string> {
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
  return businessIdForUser(await resolveUserId())
})

/**
 * Resolve a user's business id from an EXPLICIT auth-user id — the identity seam
 * shared by the cookie path (getBusinessId) and the facade Bearer path. This
 * INDEXED per-request lookup on the primary key (profiles.id) is also the
 * authoritative membership gate: a user with no profile row in any business has
 * no active membership and is rejected fail-closed (NOT the 24h roster cache,
 * which is unfit for a security gate). Throws when there is no membership.
 */
export async function businessIdForUser(userId: string): Promise<string> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('profiles')
    .select('customer_id')
    .eq('id', userId)
    .single()

  // Distinguish a genuinely-absent membership from a failed lookup. `.single()`
  // returns PGRST116 when the row does not exist — that IS "no active
  // membership" (fail-closed 403). ANY OTHER error is a transient lookup /
  // connection failure and must NOT masquerade as an absent membership: a mobile
  // client reads membership_inactive as "you were removed", so surface it as a
  // retryable upstream failure (502) instead of a false eviction.
  if (error) {
    if (error.code === 'PGRST116') {
      throw new AppApiError('membership_inactive', 'No active business membership for this user')
    }
    throw new AppApiError('upstream_unavailable', 'Business membership lookup failed')
  }
  if (!data?.customer_id) {
    throw new AppApiError('membership_inactive', 'No active business membership for this user')
  }
  return data.customer_id
}

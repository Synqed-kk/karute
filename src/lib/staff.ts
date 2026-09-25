import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifySupabaseJwt, LocalJwtError } from '@/lib/auth/local-jwt'
import { AppApiError, describeUnknownThrow } from '@/lib/app-api/errors'
import { listAllCoreStaff } from '@/lib/synqed/staff-pager'

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
  /** True for a roster card with NO login attached (synqed-only row — its id
   *  is a core staff id, not an auth uid). Permissions/PIN don't exist for it
   *  yet; surfaces render the honest unlinked state instead of fetching. */
  unlinked?: boolean
  /** 経営メンバー — a VISIBILITY flag, never a rights one: the assignment
   *  pickers hide them from their default list (search still reveals them)
   *  and the day view drops their lane on days they have no booking. Optional
   *  because reads fail OPEN (`?? false` at every consumer): a stale cache
   *  entry or a pre-migration row means visible, never hidden. */
  isManagement?: boolean
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
  staffListCore,
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
 * The UNCACHED twin of {@link staffListByBusiness} for the BFF facade (packet
 * 05 fix round 1): same read + mapping; facade requests pay one DB read each.
 *
 * Both THROW on a profiles or core roster failure (Round 2, 2026-09-24,
 * D-S16-4). The web one used to resolve `[]` / profiles-only INSIDE
 * unstable_cache, so a blip was cached for 24 h and every staff id went null.
 * A rejection is never cached: Next's unstable_cache writes only after the
 * callback resolves. An outage is never an empty roster.
 */
export async function staffListByBusinessOrThrow(
  businessId: string,
): Promise<StaffMember[]> {
  return staffListCore(businessId)
}

/** Shared roster assembly — throws on a failure of EITHER internal read. */
async function staffListCore(businessId: string): Promise<StaffMember[]> {
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service as any)
    .from('profiles')
    .select('id, full_name, created_at, display_role, position, email, phone, avatar_url, pin_hash, customer_id, is_management')
    .eq('customer_id', businessId)
    .not('full_name', 'is', null)
    .not('full_name', 'ilike', '_system_%')
    .order('full_name', { ascending: true })

  // Round 3 leg 5 G2/G3 (2026-09-25, D-S24-1/2): a failed roster read is an
  // upstream outage — typed like its sibling membership read (businessIdForUser)
  // so a caller can tell it from a denial, with a FIXED message: errorBody sends
  // it to the phone. The database detail stays in the server log and on cause.
  if (error) {
    // Bounded + masked (G4): the PostgREST error may be a plain object, so the
    // sanitizer gets an Error carrying its message.
    console.error('[getStaffList] staff profiles read failed:', describeUnknownThrow(new Error(error.message)))
    throw new AppApiError('upstream_unavailable', 'staff profiles read failed', undefined, error)
  }

  const profileStaff = (data ?? []).map(
    ({
      pin_hash,
      customer_id: _customer_id,
      is_management,
      ...rest
    }: {
      pin_hash?: string | null
      customer_id?: string
      is_management?: boolean | null
      [key: string]: unknown
    }) => ({
      ...rest,
      has_pin: !!pin_hash,
      // Fail OPEN: null (pre-migration row) → false → visible.
      isManagement: !!is_management,
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
}

/**
 * Returns synqed-core staff that have NO matching Supabase profile row yet —
 * i.e. owner-created teammates who haven't signed up. Matched out by the same
 * two-tier link the staff-map resolver uses: synqed `user_id` → profile id
 * (canonical), then email (case-insensitive) fallback.
 *
 * [] when synqed-core env is absent (not a failure); a FAILED fetch throws —
 * profiles-only would silently drop every not-yet-signed-up teammate. Same
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
    // ⚖ R1-7 (E33, the 201st): paged to exhaustion. One page of 200 silently
    // truncated the roster — tolerable while it only fed a list, not once its
    // SIZE became a capacity divisor.
    const staff = await listAllCoreStaff(client.staff)
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
        unlinked: true,
        // No profiles row to carry the flag yet — visible, like every other
        // roster member, until they sign up and someone flips it.
        isManagement: false,
      })) as StaffMember[]
  } catch (err) {
    // Round 3 leg 6 F2 (2026-09-25, D-S26-1): a failed synqed-core roster fetch is
    // an upstream outage like the profiles read above — typed so the gate catches
    // (D-S25-1) can tell it from a denial, with a FIXED message to the wire; the
    // core detail stays on `cause` and in this one bounded log (lesson 85).
    console.error('[getStaffList] synqed-core roster fetch failed:', describeUnknownThrow(err))
    throw new AppApiError('upstream_unavailable', 'synqed-core roster fetch failed', undefined, err)
  }
}

/**
 * Returns all staff profiles ordered alphabetically by full_name.
 * THROWS on any failure — business id, profiles or core roster (Round 2). An
 * unauthenticated page caller never gets here: the (app) layout's session
 * check redirects to /login first.
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
export const getStaffList = cache(async (): Promise<StaffMember[]> =>
  staffListByBusiness(await getBusinessId()),
)

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
 * user gets exactly one staff identity per business, seeded at signup.
 *
 * `null` = no session, or a live session the roster does not contain. An
 * OUTAGE rejects — shown as an outage, never as "removed" (Round 2; S10
 * follow-up (c)). A `_system_removed_` profile never reaches the roster read:
 * getBusinessId refuses it (membership_inactive), which also rejects.
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
 *
 * Wrapped in React cache() (Fable fix-round finding, 2026-07-27): called
 * twice per request wherever both getBusinessId() and resolveWebAuditContext()
 * run (e.g. every booking mutation) — without memoization a transient failure
 * on the SECOND call silently wrote actor_id:null for a fully-known actor.
 * Same wrapper as getCurrentUserStaffId/getBusinessId in this file.
 */
export const getCurrentAccessToken = cache(async (): Promise<string> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Not authenticated')
  return data.session.access_token
})

export const resolveUserId = cache(async (): Promise<string> => {
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
})

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
 * authoritative membership gate (NOT the 24h roster cache, which is unfit for a
 * security gate). Two ways to be a non-member, both rejected fail-closed with
 * the same membership_inactive: (1) no profile row in any business; (2) a
 * REMOVED row — deleteStaffCore keeps the row but prefixes its name with
 * `_system_removed_`, so a removed person's still-valid token is refused here,
 * before any route reads capabilities. Only that exact prefix (case-sensitive,
 * at the start) — other `_system_` rows are not this seam's concern.
 */
export async function businessIdForUser(userId: string): Promise<string> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('profiles')
    .select('customer_id, full_name')
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
  if (typeof data.full_name === 'string' && data.full_name.startsWith('_system_removed_')) {
    throw new AppApiError('membership_inactive', 'No active business membership for this user')
  }
  return data.customer_id
}

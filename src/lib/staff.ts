import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
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

const staffListByBusiness = unstable_cache(
  async (businessId: string): Promise<StaffMember[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) {
      console.error('[getStaffList] Missing SYNQED_CORE_URL/API_KEY')
      return []
    }
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    try {
      const { staff } = await client.staff.list({ page_size: 200 })
      return staff
        .filter((s) => s.is_active)
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
        }))
    } catch (err) {
      // Degrade gracefully if synqed-core is unreachable (e.g. local dev with
      // the service down) — never reject from inside unstable_cache.
      console.error('[getStaffList] synqed-core fetch failed:', err)
      return []
    }
  },
  ['staff-list-v2'],
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
 *   - `unstable_cache` (on staffListByBusiness) reuses the synqed-core HTTP
 *     call across requests for 24h. Mutation actions in src/actions/staff.ts
 *     call updateTag('staff-list') to invalidate.
 *
 * The two layers compose: per-request dedup avoids redundant lookups inside
 * one render; cross-request cache avoids redundant synqed-core HTTP calls
 * across renders.
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
  const list = await getStaffList()
  const found = list.find((s) => s.id === id)
  return found ? { id: found.id, full_name: found.full_name } : null
}

// TEMPORARY (removed in Phase 4): there is no per-user "active staff" once
// staff are decoupled from auth. Consumers default to the first roster member.
export const getCurrentUserStaffId = cache(async (): Promise<string | null> => {
  const list = await getStaffList()
  return list[0]?.id ?? null
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

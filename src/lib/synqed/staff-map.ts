import { unstable_cache, updateTag } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId } from '@/lib/staff'
import { createServiceClient } from '@/lib/supabase/service'

// profiles.id → synqed staff.id. synqed-core's appointments.staff_id FKs to
// staff.id, but karute hands around profiles.id everywhere else (because
// staff are surfaced from the Supabase profiles table). Inserts/updates that
// touch appointments need this translation or the FK on synqed-core blows up.
//
// Two-tier lookup: synqed staff.user_id (the canonical link, set during
// signup bootstrap) is checked first. Owners can also create teammates from
// Settings → those records land in synqed with user_id=null, so we fall back
// to matching by email when user_id is missing. On an email-only match we
// self-heal by patching the synqed record's user_id so future lookups are
// O(map). Long TTL by design — staff onboarding is rare; staff mutations
// invalidate via the existing 'staff-list' tag.

interface StaffEntry {
  id: string
  user_id: string | null
  email: string | null
}

const synqedStaffListByBusiness = unstable_cache(
  async (businessId: string): Promise<StaffEntry[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) {
      throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
    }
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    const result = await client.staff.list({ page_size: 200 })
    return result.staff.map((s) => ({
      id: s.id,
      user_id: (s as { user_id?: string | null }).user_id ?? null,
      email: (s as { email?: string | null }).email ?? null,
    }))
  },
  // Mirrors the staff-list cache TTL in src/lib/staff.ts — staff churn is
  // a once-in-a-while admin event, and every staff mutation already bumps
  // the 'staff-list' tag, so the day-long TTL is just a backstop.
  ['synqed-staff-list-v2'],
  { revalidate: 86400, tags: ['staff-list'] },
)

/**
 * Translate a Supabase profile id to its synqed-core staff id.
 * Throws if no link can be established — refusing to fall back to the raw
 * profile id (which would just hand a bad value to the FK and blow up
 * synqed-core's insert with a cryptic message).
 */
export async function resolveSynqedStaffId(staffProfileId: string): Promise<string> {
  const businessId = await getBusinessId()
  const staff = await synqedStaffListByBusiness(businessId)

  // Primary: synqed staff.user_id directly set to this profile id.
  const direct = staff.find((s) => s.user_id === staffProfileId)
  if (direct) return direct.id

  // Fallback: match by email (handles teammates created via Settings, where
  // createStaff doesn't populate user_id).
  const service = createServiceClient()
  const { data: profile } = await service
    .from('profiles')
    .select('email')
    .eq('id', staffProfileId)
    .maybeSingle()
  const profileEmail = (profile as { email?: string | null } | null)?.email?.toLowerCase()
  if (profileEmail) {
    const byEmail = staff.find(
      (s) => s.email && s.email.toLowerCase() === profileEmail,
    )
    if (byEmail) {
      // Self-heal: patch the synqed staff record so future lookups hit the
      // user_id path. Best-effort — booking still proceeds if the patch fails.
      const baseUrl = process.env.SYNQED_CORE_URL
      const apiKey = process.env.SYNQED_CORE_API_KEY
      if (baseUrl && apiKey) {
        try {
          const client = new SynqedClient({ baseUrl, apiKey, businessId })
          await client.staff.update(byEmail.id, { user_id: staffProfileId })
          updateTag('staff-list')
        } catch (err) {
          console.warn('[staff-map] self-heal user_id patch failed', err)
        }
      }
      return byEmail.id
    }
  }

  throw new Error(
    `Could not link Supabase profile ${staffProfileId} to a synqed-core staff record. ` +
      `The profile may exist in Supabase but have no matching staff entry in synqed-core ` +
      `(checked user_id and email).`,
  )
}

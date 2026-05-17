import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId } from '@/lib/staff'

// profiles.id → synqed staff.id. synqed-core's appointments.staff_id FKs to
// staff.id, but karute hands around profiles.id everywhere else (because
// staff are surfaced from the Supabase profiles table). Inserts/updates that
// touch appointments need this translation or the FK on synqed-core blows up.
//
// Long TTL by design: staff onboarding is a once-in-a-while admin event, not
// a per-session thing, so refreshing every minute would just waste round
// trips. Staff-mutation actions should call updateTag('synqed-staff-map') to
// invalidate; deploys also bust this cache since the key version moves with
// each Vercel build.
const synqedStaffMapByBusiness = unstable_cache(
  async (businessId: string): Promise<Record<string, string>> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) {
      throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
    }
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    const result = await client.staff.list({ page_size: 200 })
    const map: Record<string, string> = {}
    for (const s of result.staff) {
      if (s.user_id) map[s.user_id] = s.id
    }
    return map
  },
  // Reuses the existing 'staff-list' tag — actions in src/actions/staff.ts
  // already bump it on create/update/delete, so both this cache and the
  // Supabase-side staff list cache invalidate in lockstep.
  ['synqed-staff-map-v1'],
  { revalidate: 3600, tags: ['staff-list'] },
)

/**
 * Translate a Supabase profile id to its synqed-core staff id. Returns the
 * input unchanged if no mapping is found — defensive fallback in case the
 * caller already has a synqed staff id.
 */
export async function resolveSynqedStaffId(staffProfileId: string): Promise<string> {
  const businessId = await getBusinessId()
  const map = await synqedStaffMapByBusiness(businessId)
  return map[staffProfileId] ?? staffProfileId
}

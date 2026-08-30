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

export interface StaffEntry {
  id: string
  user_id: string | null
  email: string | null
  /** The CARD's own name. The honest fallback when the card links to no
   *  profile (a departed staffer, or a teammate created from Settings before
   *  the self-heal patch ran) — see synqedStaffCardsForBusiness below. */
  name: string | null
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
      name: (s as { name?: string | null }).name ?? null,
    }))
  },
  // Mirrors the staff-list cache TTL in src/lib/staff.ts — staff churn is
  // a once-in-a-while admin event, and every staff mutation already bumps
  // the 'staff-list' tag, so the day-long TTL is just a backstop.
  // v3: `name` joined the entry shape (names-fix 2026-08-31). The key bump is
  // what stops a v2 entry — same tenant, no `name` — from serving a whole TTL
  // window of nameless cards to the 破棄の記録 read below.
  ['synqed-staff-list-v3'],
  { revalidate: 86400, tags: ['staff-list'] },
)

/**
 * Pure lookup: translate a Supabase profile id to its synqed-core staff id,
 * or null when no synqed record matches. NEVER creates anything — safe for
 * flows where creating would be wrong (e.g. deleteStaff, where create-on-miss
 * would mint a record just to delete it). The email-only match still
 * self-heals user_id on the existing record (a best-effort patch, not a
 * create), so future lookups hit the O(map) user_id path.
 */
export async function lookupSynqedStaffId(
  staffProfileId: string,
): Promise<string | null> {
  return lookupSynqedStaffIdForBusiness(staffProfileId, await getBusinessId())
}

/** Bearer-safe twin: the caller supplies businessId from its verified token
 *  identity — this path must never touch the cookie session (getBusinessId).
 *  Same lookup + self-heal behavior as the cookie helper above. */
export async function lookupSynqedStaffIdForBusiness(
  staffProfileId: string,
  businessId: string,
): Promise<string | null> {
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
  const profileEmail = (
    profile as { email?: string | null } | null
  )?.email?.toLowerCase()
  if (profileEmail) {
    const byEmail = staff.find(
      (s) => s.email && s.email.toLowerCase() === profileEmail,
    )
    if (byEmail) {
      // Self-heal: patch the synqed staff record so future lookups hit the
      // user_id path. Best-effort — the caller still proceeds if it fails.
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

  return null
}

/** Reverse translation: synqed-core staff (card) id → Supabase profile id
 *  (staff.user_id). Read-only — no self-heal, no create, no extra fetch
 *  (reuses the cached roster). Returns null when the id isn't a known card
 *  id, the card has no linked profile (user_id null), OR the lookup itself
 *  failed (roster fetch threw) — callers keep their original id via
 *  `?? original` either way. Best-effort by contract: this runs ahead of the
 *  owner/viewAll checks at every call site, so a translation failure must
 *  never take down a read path that worked before this lookup existed. */
export async function lookupProfileIdForSynqedStaffIdForBusiness(
  synqedStaffId: string,
  businessId: string,
): Promise<string | null> {
  try {
    const staff = await synqedStaffListByBusiness(businessId)
    return staff.find((s) => s.id === synqedStaffId)?.user_id ?? null
  } catch (err) {
    console.warn('[staff-map] forward lookup failed — keeping original staff id', err)
    return null
  }
}

/** The whole roster in the CARD id space, read-only: `id` (the synqed-core
 *  staff/card id), `user_id` (the linked Supabase profile, or null) and the
 *  card's own `name`. No self-heal, no create, no extra fetch — just the
 *  cached list.
 *
 *  WHY IT EXISTS. Core normalises `recording_discards.discarded_by` to the
 *  CARD id on write (recording-discard.service.ts: it accepts either identity
 *  form and stores staff.id), while karute's own rosters are keyed by
 *  profile/login uuid. A name join built on profiles alone therefore matched
 *  nothing and every ledger row read 担当者不明. Callers key their map by BOTH
 *  id spaces off these rows.
 *
 *  Degrades to [] (warn) exactly like the forward lookup above: every caller
 *  is a READ path that worked before this existed, and a roster we could not
 *  fetch must cost a name, never the read. */
export async function synqedStaffCardsForBusiness(businessId: string): Promise<StaffEntry[]> {
  try {
    return await synqedStaffListByBusiness(businessId)
  } catch (err) {
    console.warn('[staff-map] card roster read failed — names degrade to unknown', err)
    return []
  }
}

/** Cookie path twin — resolves businessId via getBusinessId(). Guards that
 *  await too (a broken session can throw) so this twin never throws either. */
export async function lookupProfileIdForSynqedStaffId(
  synqedStaffId: string,
): Promise<string | null> {
  try {
    return await lookupProfileIdForSynqedStaffIdForBusiness(synqedStaffId, await getBusinessId())
  } catch (err) {
    console.warn('[staff-map] forward lookup failed — keeping original staff id', err)
    return null
  }
}

/**
 * Translate a Supabase profile id to its synqed-core staff id, creating the
 * synqed record on demand when none exists (booking flow: appointments FK to
 * staff.id, so a record MUST exist before the insert). Throws only if the
 * profile itself doesn't exist — refusing to fall back to the raw profile id
 * (which would just hand a bad value to the FK and blow up synqed-core's
 * insert with a cryptic message). Flows that must not create (delete) use
 * lookupSynqedStaffId above instead.
 */
export async function resolveSynqedStaffId(staffProfileId: string): Promise<string> {
  return resolveSynqedStaffIdForBusiness(staffProfileId, await getBusinessId())
}

/** Bearer-safe twin of resolveSynqedStaffId — businessId from the verified
 *  token, never the cookie session. Same create-on-miss contract. */
export async function resolveSynqedStaffIdForBusiness(
  staffProfileId: string,
  businessId: string,
): Promise<string> {
  const found = await lookupSynqedStaffIdForBusiness(staffProfileId, businessId)
  if (found) return found

  // No synqed staff record yet. Staff seeded directly into Supabase profiles
  // (bypassing createStaff, which normally writes both stores) land here, as do
  // owner-imported teammates. Rather than hard-fail the booking, create the
  // synqed record on demand — linked by user_id so future lookups hit the
  // O(map) user_id path. Only refuse if the profile itself doesn't exist.
  // (Re-fetches the profile for name+email — only reached on the rare
  // create path, and the roster list above is already unstable_cache'd.)
  const service = createServiceClient()
  const { data: profile } = await service
    .from('profiles')
    .select('full_name, email')
    .eq('id', staffProfileId)
    .maybeSingle()
  const typedProfile = profile as
    | { full_name?: string | null; email?: string | null }
    | null
  if (!typedProfile) {
    throw new Error(
      `Could not link Supabase profile ${staffProfileId} to a synqed-core ` +
        `staff record: no such profile.`,
    )
  }
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) {
    throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
  }
  const client = new SynqedClient({ baseUrl, apiKey, businessId })
  const createdStaff = await client.staff.create({
    name: typedProfile.full_name || typedProfile.email || 'Staff',
    email: typedProfile.email ?? null,
    user_id: staffProfileId,
  })
  updateTag('staff-list')
  return createdStaff.id
}

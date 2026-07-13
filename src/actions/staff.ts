'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { SynqedError } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { lookupSynqedStaffId } from '@/lib/synqed/staff-map'
import { getTranslations } from 'next-intl/server'
import { getBusinessId } from '@/lib/staff'
import { createServiceClient } from '@/lib/supabase/service'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'

/** House result shape for the staff mutations: undefined = success, else a
 *  user-safe (already-translated) message. Returning the failure — instead of
 *  throwing — is deliberate: a thrown error from a Server Action has its
 *  message STRIPPED in production (replaced by the generic "...Server
 *  Components render...digest" text), so a permission denial reached the staff
 *  as that cryptic string in a toast. The capability layer still throws for
 *  callers that expect it; these user-facing actions translate the denial into
 *  a clean message. */
type StaffActionResult = { error: string } | void

// Look up an existing Supabase profile by email. Returns its id (which equals
// auth.users.id) when found, else null. Lets createStaff seed synqed
// staff.user_id at insert time when the teammate already has an auth account
// — otherwise the link is filled in later by the resolver's self-heal path
// in src/lib/synqed/staff-map.ts.
async function findProfileIdByEmail(email: string): Promise<string | null> {
  const service = createServiceClient()
  const { data } = await service
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

export async function createStaff(data: StaffProfileInput): Promise<StaffActionResult> {
  const t = await getTranslations('common')
  if (!(await can('staff.invite'))) return { error: t('noPermission') }
  const parsed = staffProfileSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((e) => e.message).join(', ') }
  }

  // Plan gate (P4): same staffAddAllowed as createInvite — one gate, two
  // doors (join-link + direct add). Inert until billing arms.
  const { staffAddAllowed } = await import('@/lib/subscription/feature-gate')
  if (!(await staffAddAllowed()).allowed) {
    return { error: t('staffLimitReached') }
  }

  try {
    const email = parsed.data.email || null
    const userId = email ? await findProfileIdByEmail(email) : null

    const synqed = await getSynqedClient()
    await synqed.staff.create({
      name: parsed.data.name,
      email,
      user_id: userId,
    })

    revalidatePath('/settings')
    updateTag('staff-list')
  } catch (err) {
    // Never let a thrown message reach the client raw (prod strips it). Log for
    // observability; return the generic translated fallback.
    console.error('[createStaff]', err)
    return { error: t('somethingWentWrong') }
  }
}

export async function updateStaff(id: string, data: StaffProfileInput): Promise<StaffActionResult> {
  const t = await getTranslations('common')
  // editing a staff record = managing staff (Greptile #159). Returned, not
  // thrown, so a frontdesk who reaches this (stale UI) sees a clean message.
  if (!(await can('staff.manage'))) return { error: t('noPermission') }
  const parsed = staffProfileSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((e) => e.message).join(', ') }
  }

  try {
    const service = createServiceClient()
    const businessId = await getBusinessId()

    // The roster surfaces profile-backed staff (the owner + signed-up teammates)
    // from Supabase `profiles`, keyed by profiles.id — NOT the synqed staff id.
    // So an edit on one of those must update the profile row, which is where the
    // list reads the name from. Only owner-created teammates who haven't signed
    // up yet live solely in synqed-core (keyed by synqed staff.id); those still
    // route through the synqed client. Passing a profiles.id to
    // synqed.staff.update was the "SynqedError: Staff not found" 500 on save.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (service as any)
      .from('profiles')
      .select('id')
      .eq('id', id)
      .eq('customer_id', businessId)
      .maybeSingle()

    if (profile) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (service as any)
        .from('profiles')
        .update({
          full_name: parsed.data.name,
          position: parsed.data.position || null,
        })
        .eq('id', id)
        .eq('customer_id', businessId)
      if (error) {
        console.error('[updateStaff] profile update:', error)
        return { error: t('somethingWentWrong') }
      }
      // email intentionally NOT updated here — a profile's email is its auth
      // login, so changing it needs the re-confirmation flow the dialog hints at
      // ("Changing the email requires re-confirmation"), which isn't wired yet.
      // Name + position are the safe, in-scope edits.
    } else {
      // synqed-only staff (owner-created, not yet signed up) — `id` is already a
      // synqed staff id, so the synqed client is the correct write target.
      const synqed = await getSynqedClient()
      await synqed.staff.update(id, {
        name: parsed.data.name,
        email: parsed.data.email || null,
      })
    }

    revalidatePath('/settings')
    updateTag('staff-list')
  } catch (err) {
    console.error('[updateStaff]', err)
    return { error: t('somethingWentWrong') }
  }
}

/**
 * Deletes a staff member. Server enforces guards (last member, attributed
 * records) and returns 400 with a human message when either triggers.
 *
 * The roster surfaces profile-backed staff keyed by profiles.id, but
 * synqed.staff.delete's keyspace is the synqed staff.id — so a profiles.id
 * handed straight through 404s ("Staff not found") and, before this, rethrew
 * into a Server Components crash on /settings. Mirror updateStaff: translate a
 * profiles.id to its synqed staff.id first via the staff-map's pure lookup
 * (NOT resolveSynqedStaffId — its create-on-miss leg is for the booking flow
 * and would mint a record just to delete it); synqed-only ids pass through
 * as-is. No match, or a 404 from the delete, means the synqed record is
 * already gone — treat as success rather than crash.
 *
 * NOTE (Anthony): this deletes the synqed-core staff record only. For
 * profile-backed staff the Supabase `profiles` row remains, so the roster
 * (which reads profiles first) still lists them. profiles.id === auth.users.id,
 * so removing that row is an auth-project / transactional operation owned by the
 * backend — updateStaff already treats profile rows as auth-owned (it won't even
 * change the email). Deactivating/removing the profile is out of scope here.
 */
export async function deleteStaff(id: string): Promise<StaffActionResult> {
  const t = await getTranslations('common')
  if (!(await can('staff.manage'))) return { error: t('noPermission') } // owner + manager

  try {
    // Resolve the roster id (profiles.id) to the synqed staff id, exactly as
    // updateStaff does. Only ids with no profile row in this business are already
    // synqed staff ids and pass through unchanged.
    const service = createServiceClient()
    const businessId = await getBusinessId()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: profile } = await (service as any)
      .from('profiles')
      .select('id')
      .eq('id', id)
      .eq('customer_id', businessId)
      .maybeSingle()

    // Pure lookup — null means the profile has no synqed record, i.e. nothing
    // to delete on the synqed side: skip the delete and just refresh the roster,
    // the same treatment as the 404 below.
    const synqedStaffId = profile ? await lookupSynqedStaffId(id) : id

    if (synqedStaffId) {
      const synqed = await getSynqedClient()
      try {
        await synqed.staff.delete(synqedStaffId)
      } catch (err) {
        if (err instanceof SynqedError && err.status === 400) {
          // last-member / attributed-records guard — a real, user-facing message
          // core already localized; surface it as-is.
          return { error: err.message }
        }
        // A 404 means the synqed record is already gone — not an error to the
        // user; fall through to the same revalidation as a successful delete.
        // Anything else is unexpected → generic fallback (never the raw message).
        if (!(err instanceof SynqedError && err.status === 404)) {
          throw err
        }
      }
    }

    revalidatePath('/settings')
    revalidatePath('/', 'layout')
    updateTag('staff-list')
  } catch (err) {
    console.error('[deleteStaff]', err)
    return { error: t('somethingWentWrong') }
  }
}

export async function uploadStaffAvatar(
  staffId: string,
  formData: FormData,
): Promise<{ url: string } | { error: string }> {
  try {
    await requireCapability('staff.manage') // changing a staff avatar = managing staff (Greptile #159)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided' }

  try {
    const synqed = await getSynqedClient()
    const { avatar_url } = await synqed.staff.uploadAvatar(staffId, file)
    revalidatePath('/settings')
    revalidatePath('/', 'layout')
    updateTag('staff-list')
    return { url: avatar_url }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

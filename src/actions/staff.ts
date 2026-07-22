'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { SynqedError, type SynqedClient } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { lookupSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { getTranslations } from 'next-intl/server'
import { getBusinessId } from '@/lib/staff'
import { createServiceClient } from '@/lib/supabase/service'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { resolveWebActorId, resolveWebAuditContext } from '@/lib/audit-web'
import { audit } from '@/lib/audit'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'

// Explicit-client seam (design-parity packet 12 §S4a — the P-B pattern, same
// as createStoreCore/orgSettingsWithClient): every core below takes this
// instead of resolving getSynqedClient() from the cookie session, so the
// facade (Bearer path, business resolved from the verified token) and the
// web actions run the IDENTICAL write logic. Web keeps its own cookie
// resolution; the core takes an explicit (synqed, businessId, actor).
type StaffClient = Pick<SynqedClient, 'staff'>

/** Identity + provenance a Bearer/cookie caller feeds a staff write core: the
 *  resolved actor (audit actor id) and which path is calling (the audit
 *  event's `source`). */
type StaffWriteDeps = {
  actorId: string | null
  source: 'web' | 'facade'
}

/** House result shape for the staff mutations: undefined = success, else a
 *  user-safe (already-translated) message. Returning the failure — instead of
 *  throwing — is deliberate: a thrown error from a Server Action has its
 *  message STRIPPED in production (replaced by the generic "...Server
 *  Components render...digest" text), so a permission denial reached the staff
 *  as that cryptic string in a toast. The capability layer still throws for
 *  callers that expect it; these user-facing actions translate the denial into
 *  a clean message. */
type StaffActionResult = { error: string } | void

// Look up an existing Supabase profile by email WITHIN this business. Returns
// its id (which equals auth.users.id) when found, else null. Lets createStaff
// seed synqed staff.user_id at insert time when the teammate already has an
// auth account in this tenant — otherwise the link is filled in later by the
// resolver's self-heal path in src/lib/synqed/staff-map.ts. Tenant-scoped
// like every other profiles query in this file: the service client bypasses
// RLS, and an email match alone would link a FOREIGN tenant's auth identity
// into this roster. Unknown scope (null businessId) → no link; the staff row
// is still created and self-heals later.
async function findProfileIdByEmail(
  email: string,
  businessId: string | null,
): Promise<string | null> {
  if (!businessId) return null
  const service = createServiceClient()
  const { data } = await service
    .from('profiles')
    .select('id')
    .eq('email', email)
    .eq('customer_id', businessId)
    .maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

/** Client-threaded core of createStaff (facade Bearer path, design-parity
 *  packet 12 §S4a — same WithClient split as createStoreCore). Carries the
 *  email→profile link lookup + the synqed write + the audit row, so web and
 *  facade can never diverge. businessId scopes the email→profile link (see
 *  findProfileIdByEmail) and stamps the audit row; the synqed write itself is
 *  already tenant-scoped by the client. A resolution failure upstream
 *  degrades to null — the write proceeds unlinked rather than blocking (see
 *  resolveWebAuditContext). */
export async function createStaffCore(
  synqed: StaffClient,
  businessId: string | null,
  deps: StaffWriteDeps,
  data: StaffProfileInput,
): Promise<{ id: string } | { error: string }> {
  try {
    const email = data.email || null
    const userId = email ? await findProfileIdByEmail(email, businessId) : null

    const created = await synqed.staff.create({
      name: data.name,
      email,
      user_id: userId,
    })

    audit({
      category: 'staff',
      action: 'staff.add',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: created.id,
      source: deps.source,
    })

    return { id: created.id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
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

  let synqed: StaffClient
  try {
    synqed = await getSynqedClient()
  } catch (err) {
    console.error('[createStaff]', err)
    return { error: t('somethingWentWrong') }
  }

  const { actorId, businessId } = await resolveWebAuditContext()
  const result = await createStaffCore(synqed, businessId, { actorId, source: 'web' }, parsed.data)
  if ('error' in result) {
    // Never let a thrown message reach the client raw (prod strips it). Log for
    // observability; return the generic translated fallback.
    console.error('[createStaff]', result.error)
    return { error: t('somethingWentWrong') }
  }

  revalidatePath('/settings')
  updateTag('staff-list')
}

/** Client-threaded core of updateStaff (facade Bearer path, design-parity
 *  packet 12 §S4a). Unlike createStaffCore, businessId here is REQUIRED — it
 *  scopes the profiles lookup/update (tenant boundary), not just the audit
 *  row — so an unresolvable businessId must fail the whole write, exactly as
 *  the pre-split web action already did (getBusinessId() unguarded). */
export async function updateStaffCore(
  synqed: StaffClient,
  businessId: string,
  deps: StaffWriteDeps,
  id: string,
  data: StaffProfileInput,
): Promise<{ ok: true } | { error: string }> {
  const service = createServiceClient()

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
        full_name: data.name,
        position: data.position || null,
      })
      .eq('id', id)
      .eq('customer_id', businessId)
    if (error) return { error: error.message }
    // email intentionally NOT updated here — a profile's email is its auth
    // login, so changing it needs the re-confirmation flow the dialog hints at
    // ("Changing the email requires re-confirmation"), which isn't wired yet.
    // Name + position are the safe, in-scope edits.
  } else {
    // synqed-only staff (owner-created, not yet signed up) — `id` is already a
    // synqed staff id, so the synqed client is the correct write target.
    await synqed.staff.update(id, {
      name: data.name,
      email: data.email || null,
    })
  }

  audit({
    category: 'staff',
    action: 'staff.update',
    actorId: deps.actorId,
    actorType: 'staff',
    businessId,
    targetType: 'staff',
    targetId: id,
    source: deps.source,
  })

  return { ok: true }
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
    const businessId = await getBusinessId()
    const synqed = await getSynqedClient()
    const actorId = await resolveWebActorId()
    const result = await updateStaffCore(synqed, businessId, { actorId, source: 'web' }, id, parsed.data)
    if ('error' in result) {
      console.error('[updateStaff]', result.error)
      return { error: t('somethingWentWrong') }
    }

    revalidatePath('/settings')
    updateTag('staff-list')
  } catch (err) {
    console.error('[updateStaff]', err)
    return { error: t('somethingWentWrong') }
  }
}

/** Client-threaded core of deleteStaff (facade Bearer path, design-parity
 *  packet 12 §S4a). businessId is REQUIRED (scopes the profiles lookup, same
 *  as updateStaffCore). The 400-guard message (last-member / attributed-
 *  records) is returned VERBATIM — core already localized it; every other
 *  synqed failure re-throws so the caller's own translated fallback applies. */
export async function deleteStaffCore(
  synqed: StaffClient,
  businessId: string,
  deps: StaffWriteDeps,
  id: string,
): Promise<{ ok: true } | { error: string }> {
  // Resolve the roster id (profiles.id) to the synqed staff id, exactly as
  // updateStaff does. Only ids with no profile row in this business are already
  // synqed staff ids and pass through unchanged.
  const service = createServiceClient()
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
  // Business-explicit lookup (the Bearer-safe twin) — the cookie-bound
  // lookupSynqedStaffId would re-resolve the tenant via getBusinessId() and
  // throw on every facade call. Web passes the same cookie-resolved
  // businessId, so the resolved mapping is identical on both paths.
  const synqedStaffId = profile ? await lookupSynqedStaffIdForBusiness(id, businessId) : id

  if (synqedStaffId) {
    try {
      await synqed.staff.delete(synqedStaffId)
    } catch (err) {
      if (err instanceof SynqedError && err.status === 400) {
        // last-member / attributed-records guard — a real, user-facing message
        // core already localized; surface it as-is.
        return { error: err.message }
      }
      // A 404 means the synqed record is already gone — not an error to the
      // user; fall through to the same audit/success path as a real delete.
      // Anything else is unexpected → re-throw (caller's translated fallback).
      if (!(err instanceof SynqedError && err.status === 404)) {
        throw err
      }
    }
  }

  // Emitted on the success exit (including the already-gone-in-core path —
  // the roster removal the operator asked for still completed); the 400
  // guard above returns before reaching here, so a refused delete never logs.
  audit({
    category: 'staff',
    action: 'staff.remove',
    severity: 'notice',
    actorId: deps.actorId,
    actorType: 'staff',
    businessId,
    targetType: 'staff',
    targetId: id,
    detail: { synqed_staff_id: synqedStaffId ?? null },
    source: deps.source,
  })

  return { ok: true }
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
    const businessId = await getBusinessId()
    const synqed = await getSynqedClient()
    const actorId = await resolveWebActorId()
    const result = await deleteStaffCore(synqed, businessId, { actorId, source: 'web' }, id)
    if ('error' in result) return { error: result.error }

    revalidatePath('/settings')
    revalidatePath('/', 'layout')
    updateTag('staff-list')
  } catch (err) {
    console.error('[deleteStaff]', err)
    return { error: t('somethingWentWrong') }
  }
}

/** Client-threaded core of uploadStaffAvatar (facade Bearer path, design-
 *  parity packet 12 §S4a). businessId is AUDIT-ONLY (same reasoning as
 *  createStaffCore) — the synqed client already carries tenant scope. */
export async function uploadStaffAvatarCore(
  synqed: StaffClient,
  businessId: string | null,
  deps: StaffWriteDeps,
  staffId: string,
  file: File,
): Promise<{ url: string } | { error: string }> {
  try {
    const { avatar_url } = await synqed.staff.uploadAvatar(staffId, file)
    audit({
      category: 'staff',
      action: 'staff.avatar_update',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: staffId,
      source: deps.source,
    })
    return { url: avatar_url }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
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

  let synqed: StaffClient
  try {
    synqed = await getSynqedClient()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }

  const { actorId, businessId } = await resolveWebAuditContext()
  const result = await uploadStaffAvatarCore(synqed, businessId, { actorId, source: 'web' }, staffId, file)
  if ('url' in result) {
    revalidatePath('/settings')
    revalidatePath('/', 'layout')
    updateTag('staff-list')
  }
  return result
}

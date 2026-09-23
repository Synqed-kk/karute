'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { SynqedError, type SynqedClient } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { lookupSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { getTranslations } from 'next-intl/server'
import { getBusinessId } from '@/lib/staff'
import { createServiceClient } from '@/lib/supabase/service'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { resolveStoreScope, staffWriteInScope } from '@/lib/auth/store-scope'
import { STAFF_STORE_REQUIRED } from '@/lib/auth/store-gate'
import { STAFF_CARD_LEFT_BEHIND } from '@/lib/staff/new-card'
import { createAndPlaceStaffCard } from '@/lib/staff/new-card'
import { resolveWebActorId, resolveWebAuditContext } from '@/lib/audit-web'
import { audit } from '@/lib/audit'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'

// Explicit-client seam (design-parity packet 12 §S4a — the P-B pattern, same
// as createStoreCore/orgSettingsWithClient): every core below takes this
// instead of resolving getSynqedClient() from the cookie session, so the
// facade (Bearer path, business resolved from the verified token) and the
// web actions run the IDENTICAL write logic. Web keeps its own cookie
// resolution; the core takes an explicit (synqed, businessId, actor).
type StaffClient = Pick<SynqedClient, 'staff'> &
  // ⚖ Liam 2026-09-16: creation now PLACES the new card, in the same action.
  Partial<Pick<SynqedClient, 'staffStores' | 'stores'>>

/** Identity + provenance a Bearer/cookie caller feeds a staff write core: the
 *  resolved actor (audit actor id) and which path is calling (the audit
 *  event's `source`). */
type StaffWriteDeps = {
  actorId: string | null
  source: 'web' | 'facade'
  /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta on
   *  the facade twin. */
  requestId?: string
}

export type StaffCreateDeps = StaffWriteDeps & {
  /** REQUIRED on purpose: `null` = EXPLICITLY unclamped; omitted is not unclamped (see lib/staff/new-card.ts). */
  creatorAllowedStoreIds: readonly string[] | null
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

/** What the 追加 door answers with (⚖ I2). A create can SUCCEED and still have
 *  something to say: the card was made, but the store list was unreadable, so
 *  nobody knows whether it needs a 担当店舗 yet. Its own field — never an error,
 *  never a silent success. */
export type CreateStaffResult = { error: string } | { storeUnknown: true } | void

/** Actor store-scope clamp for the staff WRITE actions (web transport) — the
 *  twin of ensureStaffWriteInScope (src/lib/app-api/store-clamp.ts), built on
 *  the same idiom as menus.ts's storeScopeError: a local async helper that
 *  returns the house `{ error }` message (never a throw), translated ONLY on
 *  refusal so the allowed path pays nothing.
 *
 *  #709 hides an OTHER-STORE roster row from a clamped `staff.manage` holder,
 *  and this is the server door behind that: the UI hides, the server refuses
 *  regardless of what the UI offered. It does NOT follow that every refusal
 *  here is invisible — a FLOATING target (empty assignment) shows in every
 *  branch's roster by design, and the #715 floating-cell ruling still refuses
 *  writes to it, so that refusal reaches a row the actor can see. Both shipped
 *  presets that manage staff (owner, manager) carry stores.viewAll, so the
 *  clamp can only ever bite a CUSTOM grant.
 *
 *  The rule itself (free passes, fail-closed cases) lives in staffWriteInScope
 *  — see its doc comment. */
async function storeScopeError(targetId: string): Promise<string | null> {
  const inScope = await staffWriteInScope({
    targetStaffId: targetId,
    actorId: await resolveWebActorId(),
  })
  if (inScope) return null
  const t = await getTranslations('settings')
  return t('staffStoreScopeDenied')
}

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
  deps: StaffCreateDeps,
  data: StaffProfileInput,
): Promise<{ id: string; storeUnknown?: true } | { error: string }> {
  try {
    const email = data.email || null
    const userId = email ? await findProfileIdByEmail(email, businessId) : null

    // ⚖ Liam 2026-09-16 — STORE AT CREATION, in its one home
    // (lib/staff/new-card.ts), shared with the fresh-invite door so both mint
    // a card the same way: the multi-store store requirement, the
    // creator-subset placement, and the delete-the-card-if-placement-fails
    // rollback. The audit row stays HERE, at the door that knows what it made.
    const created = await createAndPlaceStaffCard(synqed, businessId, deps, {
      name: data.name,
      email,
      userId,
      storeIds: data.storeIds ?? [],
    })
    // An object LITERAL, not `return created`: the emission walker reads
    // returns lexically, and a discriminated-union VARIABLE is the documented
    // ceiling it cannot see through (audit-policy.ts's own note on
    // updateCustomer). Spelling the error arm out keeps staff.add provably
    // dominating every success return.
    if ('error' in created) return { error: created.error }

    // ⚖ I2 — ONE row either way. When the store list could not be read, the
    // card really was added but nobody knows whether it still needs a store,
    // so the door's own staff.add says that instead of a second row.
    audit({
      category: 'staff',
      action: 'staff.add',
      severity: created.storeUnknown ? 'notice' : 'info',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: created.id,
      detail: created.storeUnknown ? { reason: 'store_count_unknown_unplaced' } : undefined,
      requestId: deps.requestId,
      source: deps.source,
    })

    if (created.storeUnknown) return { id: created.id, storeUnknown: true }
    return { id: created.id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function createStaff(data: StaffProfileInput): Promise<CreateStaffResult> {
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
  // ⚖ Liam 2026-09-16: the creator may place the new hire WITHIN their own
  // stores. `allowedStoreIds: null` = unclamped (viewAll, or a floating creator
  // in a one-store salon).
  // ⚖ Liam 2026-09-16 (fold round 2, F7): `degraded ? [] : allowedStoreIds`.
  // `allowedStoreIds` is null when the staff_stores lookup FAILED, and null
  // means UNCLAMPED here — so during a core blip a 銀座-only creator would
  // silently become able to place a new hire in 代官山. `[]` refuses every
  // store instead. This is the file's own sibling convention (staffWriteInScope
  // returns false on degraded) and what the facade twin already does by
  // throwing. A WRITE fails closed on an unknown; only the read plane doesn't.
  // ⚖ FOLD ROUND 3 (fresh-eyes F6) — and a THROW is the same unknown. Every
  // other risky call in this action is guarded; this one was not, so a core
  // blip turned a hire into an unhandled Server Action error (message stripped
  // in production — the exact contract staff-action-error-contract pins). The
  // file's own sibling viewerScopeForActs catches and returns [] for this.
  const scope = await resolveStoreScope().catch(() => null)
  const allowedStoreIds = scope === null || scope.degraded ? [] : scope.allowedStoreIds
  const result = await createStaffCore(
    synqed,
    businessId,
    {
      actorId,
      source: 'web',
      requestId: crypto.randomUUID(),
      creatorAllowedStoreIds: allowedStoreIds,
    },
    parsed.data,
  )
  if ('error' in result) {
    // The two store-at-creation refusals are MACHINE CODES the dialog maps to
    // its own copy — they are the user's answer, not an internal failure, and
    // must not be swallowed into the generic fallback below.
    if (
      result.error === STAFF_STORE_REQUIRED ||
      result.error === 'STORE_SCOPE_DENIED' ||
      // ⚖ Fold round 3 (F8): a card left behind by a failed rollback is the
      // user's answer too — only a person can clear it.
      result.error === STAFF_CARD_LEFT_BEHIND
    ) {
      return { error: result.error }
    }
    // Never let a thrown message reach the client raw (prod strips it). Log for
    // observability; return the generic translated fallback.
    console.error('[createStaff]', result.error)
    return { error: t('somethingWentWrong') }
  }

  revalidatePath('/settings')
  updateTag('staff-list')
  // ⚖ I2 — the only thing this door has ever returned on success.
  if ('storeUnknown' in result) return { storeUnknown: true }
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
        // 経営メンバー — visibility only, no rights. Written HERE (not through
        // setStaffPermissionsCore) because this is the one seam the 保存 button
        // runs for EVERY edit-mode row: the account owner's row rejects a
        // permissions write outright, and it's the owner who most needs the
        // flag. Omitted key = untouched, so a client that never sends it can't
        // clear someone's flag.
        ...(data.isManagement === undefined ? {} : { is_management: data.isManagement }),
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
    requestId: deps.requestId,
    source: deps.source,
  })

  return { ok: true }
}

export async function updateStaff(id: string, data: StaffProfileInput): Promise<StaffActionResult> {
  const t = await getTranslations('common')
  // editing a staff record = managing staff (Greptile #159). Returned, not
  // thrown, so a frontdesk who reaches this (stale UI) sees a clean message.
  if (!(await can('staff.manage'))) return { error: t('noPermission') }
  // Actor store scope BEFORE any core call — a refused edit touches nothing.
  const denied = await storeScopeError(id)
  if (denied) return { error: denied }
  const parsed = staffProfileSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((e) => e.message).join(', ') }
  }

  try {
    const businessId = await getBusinessId()
    const synqed = await getSynqedClient()
    const actorId = await resolveWebActorId()
    const result = await updateStaffCore(
      synqed,
      businessId,
      { actorId, source: 'web', requestId: crypto.randomUUID() },
      id,
      parsed.data,
    )
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
    .select('id, full_name')
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

  // A removed person must stop being recognised NOW, not when their token
  // dies. Core's record is gone, but the profiles row (customer_id = this
  // business) still admitted them at every identity read — and core's
  // `{ store_ids: [] }` for an id it no longer knows read as FLOATING, i.e.
  // unclamped. Two independent, reversible moves, on the success exit only
  // (after the 400 guard, so a refused delete neutralises nothing), in this
  // order: (1) roster-invisible name, (2) banned account. A crash between
  // them leaves a roster-invisible profile with a live account — every facade
  // door already refuses a caller the roster cannot place, and the web
  // getCurrentUserStaffId answers null — so (1) alone fails closed.
  let profileNeutralised = false
  let accountBanned = false
  // Self-removal (the actor removes their own row) gets the SAME two moves:
  // skipping them would leave a live account whose core row is gone, i.e. an
  // unclamped business-wide reach — worse than the lock-out. The lock-out is
  // deliberate and reversible by an admin (strip the prefix + unban); a
  // proper server-side refusal with its own copy is a later round. The audit
  // row still records it as a self-removal.
  // deps.actorId is the auth user id (= profiles.id) on both doors.
  const selfRemoval = id === deps.actorId
  if (profile) {
    // (1) Roster-invisible by the existing `_system_` convention (staffListCore
    // excludes `full_name ILIKE '_system_%'`), KEEPING the name after the
    // prefix so the move is reversible: strip the prefix = restore. No row
    // deleted, no column added (customer_id is NOT NULL — it cannot be
    // cleared). Idempotent: a null name or one already `_system_…` is left as
    // is (already off the roster). Scoped by id AND business. Inline, not a
    // helper, so the write stays inside this audited core's span.
    const currentName: string | null = profile.full_name ?? null
    if (currentName == null || currentName.startsWith('_system_')) {
      profileNeutralised = true
    } else {
      try {
        const r = await service
          .from('profiles')
          .update({ full_name: '_system_removed_' + currentName })
          .eq('id', id)
          .eq('customer_id', businessId)
        if (r?.error) throw r.error
        profileNeutralised = true
      } catch (err) {
        console.error('[deleteStaffCore] could not neutralise the removed profile:', err)
      }
    }
    // (2) Banned: no new token can be minted.
    try {
      const r = await service.auth.admin.updateUserById(id, { ban_duration: '876000h' })
      if (r?.error) throw r.error
      accountBanned = true
    } catch (err) {
      // Best-effort (same as acceptInvite's stranded-account ban): the name
      // move already fails every placement door closed; the audit row says so.
      console.error('[deleteStaffCore] could not ban the removed account:', err)
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
    detail: {
      synqed_staff_id: synqedStaffId ?? null,
      self_removal: selfRemoval,
      profile_neutralised: profileNeutralised,
      account_banned: accountBanned,
    },
    requestId: deps.requestId,
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
 * profile-backed staff the Supabase `profiles` row is KEPT (profiles.id ===
 * auth.users.id; removing it is backend-owned) but neutralised reversibly in
 * deleteStaffCore: its name gains the `_system_removed_` prefix (off the
 * roster) and the auth account is banned. Restore = strip the prefix + unban.
 */
export async function deleteStaff(id: string): Promise<StaffActionResult> {
  const t = await getTranslations('common')
  if (!(await can('staff.manage'))) return { error: t('noPermission') } // owner + manager
  // Actor store scope BEFORE any core call — a refused delete touches nothing.
  const denied = await storeScopeError(id)
  if (denied) return { error: denied }

  try {
    const businessId = await getBusinessId()
    const synqed = await getSynqedClient()
    const actorId = await resolveWebActorId()
    const result = await deleteStaffCore(
      synqed,
      businessId,
      { actorId, source: 'web', requestId: crypto.randomUUID() },
      id,
    )
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
      requestId: deps.requestId,
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
  // Actor store scope BEFORE any core call — a refused upload touches nothing.
  const denied = await storeScopeError(staffId)
  if (denied) return { error: denied }
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided' }

  let synqed: StaffClient
  try {
    synqed = await getSynqedClient()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }

  const { actorId, businessId } = await resolveWebAuditContext()
  const result = await uploadStaffAvatarCore(
    synqed,
    businessId,
    { actorId, source: 'web', requestId: crypto.randomUUID() },
    staffId,
    file,
  )
  if ('url' in result) {
    revalidatePath('/settings')
    revalidatePath('/', 'layout')
    updateTag('staff-list')
  }
  return result
}

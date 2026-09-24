import 'server-only'

// The four client-threaded staff cores, moved out of src/actions/staff.ts
// (PKT-SEC-CORES-D5, 2026-09-23). Every runtime export of a 'use server' module
// is registered as a browser-callable server action with no authentication of
// its own — and passing a client object as the first argument is no barrier,
// because the reply decoder revives nested references. These four are INTERNAL
// helpers that change the ROSTER (add a staff card, edit it, delete it, change
// its photo): they take an already-scoped client + business id + actor and
// trust the caller to have gated the request. They live here, in a server-only
// module with NO directive, so the only way in is a server-side import — the
// web actions in src/actions/staff.ts and the facade routes under
// src/app/api/app/v1/staff/ (staff POST, staff/[id] PATCH/DELETE,
// staff/[id]/avatar POST).
//
// The client/deps types and the email→profile lookup the four need came with
// them; the capability checks, the store-scope clamp (storeScopeError) and the
// Next cache calls are web-wrapper concerns and stayed behind. The bodies moved
// byte-identical, so where a doc comment below names createStaff / updateStaff
// or "the web action", that action lives in src/actions/staff.ts.

import { SynqedError, type SynqedClient } from '@synqed-kk/client'
import { lookupSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { createServiceClient } from '@/lib/supabase/service'
import { createAndPlaceStaffCard } from '@/lib/staff/new-card'
import { audit } from '@/lib/audit'
import { AppApiError } from '@/lib/app-api/errors'
import type { StaffProfileInput } from '@/lib/validations/staff'

// Explicit-client seam (design-parity packet 12 §S4a — the P-B pattern, same
// as createStoreCore/orgSettingsWithClient): every core below takes this
// instead of resolving getSynqedClient() from the cookie session, so the
// facade (Bearer path, business resolved from the verified token) and the
// web actions run the IDENTICAL write logic. Web keeps its own cookie
// resolution; the core takes an explicit (synqed, businessId, actor).
export type StaffClient = Pick<SynqedClient, 'staff'> &
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
  const { data: profile, error: profileErr } = await (service as any)
    .from('profiles')
    .select('id, display_role')
    .eq('id', id)
    .eq('customer_id', businessId)
    .maybeSingle()
  // Fail CLOSED on a failed lookup, exactly as deleteStaffCore does: a null
  // `profile` from an error would read as "no profile row" and skip the owner
  // guard below.
  if (profileErr) {
    throw new AppApiError('upstream_unavailable', 'staff profile lookup failed')
  }

  // The OWNER row is edited by the owner only — refused here, before ANY write,
  // on both doors (web `noPermission`, facade 403). Without it any staff.manage
  // holder could rename the owner to `_system_removed_…`, which the identity
  // seam then refuses: the owner locked out of their own business. A null
  // actor never equals an id, so it is refused too.
  if (profile?.display_role === 'owner' && deps.actorId !== id) {
    throw new AppApiError('forbidden', 'only the owner can edit the owner row')
  }

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
  const { data: profile, error: profileErr } = await (service as any)
    .from('profiles')
    .select('id, full_name, display_role')
    .eq('id', id)
    .eq('customer_id', businessId)
    .maybeSingle()
  // Fail CLOSED on a failed lookup — before the owner guard and every write.
  // A null `profile` from an error would otherwise read as "no profile row":
  // the owner guard and both neutralising moves skipped, the RAW id sent to
  // core (404 → swallowed) and `{ ok: true }` + an audit row returned while
  // the person stays fully active. Each door already answers a throw (facade
  // 502 via the route's AppApiError pass-through, web the translated fallback).
  if (profileErr) {
    throw new AppApiError('upstream_unavailable', 'staff profile lookup failed')
  }

  // The OWNER row cannot be removed — refused here, before ANY write (core
  // delete, rename, ban, audit: a refused removal logs nothing, same as the
  // 400 guard). Until now only the web UI hid the owner's delete button, and
  // core's last-member guard fires only for the SOLE staff row, so with 2+
  // staff a staff-manager could remove the owner through either door — and
  // the rename + ban below would then lock the whole business out. The
  // message is dev-facing: each door already maps a throw to its own answer
  // (facade 403 forbidden, web `noPermission`).
  if (profile?.display_role === 'owner') {
    throw new AppApiError('forbidden', 'the owner row cannot be removed')
  }

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
    // cleared). Idempotent ONLY for the exact `_system_removed_` prefix — the
    // one the identity seam (businessIdForUser) refuses. Every other name gets
    // the marker, including another `_system_…` value (off the roster but NOT
    // refused at the seam) and a null name (same: the marker is what closes
    // the seam). Restore caveat: for a null name, stripping the prefix yields
    // '' rather than null. Scoped by id AND business. Inline, not a helper, so
    // the write stays inside this audited core's span.
    const currentName: string | null = profile.full_name ?? null
    if (currentName != null && currentName.startsWith('_system_removed_')) {
      profileNeutralised = true
    } else {
      try {
        const r = await service
          .from('profiles')
          .update({ full_name: '_system_removed_' + (currentName ?? '') })
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

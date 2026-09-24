'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { getSynqedClient } from '@/lib/synqed/client'
import { getTranslations } from 'next-intl/server'
import { getBusinessId } from '@/lib/staff'
import { can, requireCapability } from '@/lib/auth/require-permission'
import { resolveStoreScope, staffWriteInScope } from '@/lib/auth/store-scope'
import { STAFF_STORE_REQUIRED } from '@/lib/auth/store-gate'
import { STAFF_CARD_LEFT_BEHIND } from '@/lib/staff/new-card'
import { resolveWebActorId, resolveWebAuditContext } from '@/lib/audit-web'
import { AppApiError } from '@/lib/app-api/errors'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'
// The four cores live in a server-only module (PKT-SEC-CORES-D5, 2026-09-23):
// every runtime export of this 'use server' file is a browser-callable
// endpoint, so only the web actions below stay here.
import {
  createStaffCore,
  deleteStaffCore,
  updateStaffCore,
  uploadStaffAvatarCore,
  type StaffClient,
} from '@/lib/staff/staff.core'

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
  // throwing. Both planes fail closed on an unknown now: the read plane joined
  // in Round 2, 2026-09-24, D-S16-4 (discussed, default).
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
    // A refusal (the owner guard) is not a system error — answer it as one.
    if (err instanceof AppApiError && err.code === 'forbidden') return { error: t('noPermission') }
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
    // A refusal (the owner guard) is not a system error — answer it as one.
    if (err instanceof AppApiError && err.code === 'forbidden') return { error: t('noPermission') }
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

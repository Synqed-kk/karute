'use server'

import { updateTag } from 'next/cache'
import type { SynqedClient } from '@synqed-kk/client'
import { getTranslations } from 'next-intl/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { audit } from '@/lib/audit'
import { resolveWebActorId, resolveWebAuditContext } from '@/lib/audit-web'
import { can } from '@/lib/auth/require-permission'
import { staffWriteInScope } from '@/lib/auth/store-scope'
import { getCurrentUserStaffId } from '@/lib/staff'
import {
  checkPinThrottle,
  recordPinFailure,
  recordPinSuccess,
} from '@/lib/auth/pin-throttle'

// Explicit-client seam (design-parity packet 12 §S4b — the P-B pattern, same
// as the S4a cores): the set/remove cores below take this instead of
// resolving getSynqedClient() from the cookie session, so the facade
// (Bearer path) and the web actions run the IDENTICAL write logic.
type StaffPinClient = Pick<SynqedClient, 'staff'>

/** Identity + provenance a Bearer/cookie caller feeds a PIN write core. */
type StaffPinWriteDeps = {
  actorId: string | null
  source: 'web' | 'facade'
  /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta on
   *  the facade twin. */
  requestId?: string
}

/** App-side gate for a PIN write aimed at SOMEONE ELSE (web transport; the
 *  Bearer twin lives in the pin route). Setting your OWN PIN is unchanged —
 *  no capability, no clamp — because a practitioner owns their own switch
 *  credential and always has.
 *
 *  Everything else is a staff-management act, so it needs `staff.manage` AND
 *  the actor store clamp (the #715 twin — see storeScopeError in
 *  src/actions/staff.ts): a clamped custom grant must not re-key another
 *  branch's staff. synqed-core's own self-or-OWNER/ADMIN rule stays behind
 *  this as defense-in-depth.
 *
 *  A null `actingStaffId` (an auth session the roster can't place) is left
 *  alone deliberately: the cores below already refuse it outright, before the
 *  SDK — restating it here would only change a settled refusal's shape.
 *
 *  Returns the user-safe message to return as `{ error }`, or null to proceed. */
async function nonSelfPinDenial(
  targetStaffId: string,
  actingStaffId: string | null,
): Promise<string | null> {
  if (!actingStaffId || targetStaffId === actingStaffId) return null
  if (!(await can('staff.manage'))) return (await getTranslations('common'))('noPermission')
  const inScope = await staffWriteInScope({
    targetStaffId,
    actorId: await resolveWebActorId(),
  })
  return inScope ? null : (await getTranslations('settings'))('staffStoreScopeDenied')
}

/**
 * Client-threaded core of setStaffPin (facade Bearer path, design-parity
 * packet 12 §S4b). `actingStaffId` gates the change by the acting
 * (signed-in) staff — you may set your own PIN, or an OWNER/ADMIN may set
 * anyone's; synqed-core enforces that rule from this id, so a null id
 * (unresolvable identity) fails closed here rather than reaching the SDK.
 * businessId is AUDIT-ONLY (same reasoning as createStaffCore) — the synqed
 * client already carries tenant scope.
 */
export async function setStaffPinCore(
  synqed: StaffPinClient,
  businessId: string | null,
  deps: StaffPinWriteDeps,
  staffId: string,
  pin: string,
  actingStaffId: string | null,
): Promise<{ error?: string }> {
  if (!/^\d{4}$/.test(pin)) {
    return { error: 'PIN must be exactly 4 digits' }
  }
  if (!actingStaffId) {
    return { error: 'Not authorized to set a PIN' }
  }

  try {
    await synqed.staff.setPin(staffId, pin, actingStaffId)
    // Credential change (never the PIN itself — ids only).
    audit({
      category: 'staff',
      action: 'staff.pin_set',
      severity: 'notice',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: staffId,
      requestId: deps.requestId,
      source: deps.source,
    })
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Set or update a staff member's 4-digit PIN. Hashing happens server-side.
 *
 * The gate splits by target. SELF is unchanged and unguarded — a practitioner
 * owns their own switch credential. A PIN aimed at SOMEONE ELSE is a
 * staff-management act: `staff.manage` PLUS the actor store clamp, both
 * applied app-side by nonSelfPinDenial before the core call. Core's own
 * self-or-OWNER/ADMIN rule (keyed off the acting staff id) stays behind that
 * as defense-in-depth, never as the only door.
 */
export async function setStaffPin(staffId: string, pin: string): Promise<{ error?: string }> {
  const actingStaffId = await getCurrentUserStaffId()
  // Non-self PIN writes: capability + store scope, BEFORE the core call.
  const denied = await nonSelfPinDenial(staffId, actingStaffId)
  if (denied) return { error: denied }

  let synqed: StaffPinClient
  try {
    synqed = await getSynqedClient()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }

  const { actorId, businessId } = await resolveWebAuditContext()
  const result = await setStaffPinCore(
    synqed,
    businessId,
    { actorId, source: 'web', requestId: crypto.randomUUID() },
    staffId,
    pin,
    actingStaffId,
  )
  if (!result.error) updateTag('staff-list')
  return result
}

/**
 * Client-threaded core of removeStaffPin (facade Bearer path, design-parity
 * packet 12 §S4b). Same actingStaffId gate + businessId posture as
 * setStaffPinCore above.
 */
export async function removeStaffPinCore(
  synqed: StaffPinClient,
  businessId: string | null,
  deps: StaffPinWriteDeps,
  staffId: string,
  actingStaffId: string | null,
): Promise<{ error?: string }> {
  if (!actingStaffId) {
    return { error: 'Not authorized to remove a PIN' }
  }

  try {
    await synqed.staff.removePin(staffId, actingStaffId)
    audit({
      category: 'staff',
      action: 'staff.pin_removed',
      severity: 'notice',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: staffId,
      requestId: deps.requestId,
      source: deps.source,
    })
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Remove a staff member's PIN (allows switching without PIN).
 */
export async function removeStaffPin(staffId: string): Promise<{ error?: string }> {
  const actingStaffId = await getCurrentUserStaffId()
  // Same non-self gate as setStaffPin — removing a PIN is the same authority.
  const denied = await nonSelfPinDenial(staffId, actingStaffId)
  if (denied) return { error: denied }

  let synqed: StaffPinClient
  try {
    synqed = await getSynqedClient()
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }

  const { actorId, businessId } = await resolveWebAuditContext()
  const result = await removeStaffPinCore(
    synqed,
    businessId,
    { actorId, source: 'web', requestId: crypto.randomUUID() },
    staffId,
    actingStaffId,
  )
  if (!result.error) updateTag('staff-list')
  return result
}

/**
 * Verify a staff member's PIN. Returns { valid, noPin? }.
 * If no PIN is set, returns { valid: true, noPin: true }.
 */
export async function verifyStaffPin(staffId: string, pin: string): Promise<{ valid: boolean; noPin?: boolean; error?: string }> {
  // Throttle per (actor, target). Actor = the signed-in staff switching profiles.
  // verifyStaffPin is only reachable AFTER login (profile switch on a shared,
  // signed-in device), so an unauthenticated caller is never legitimate — refuse
  // the way setPin/removePin already do. The previous 'anon' fallback was a
  // SHARED throttle bucket: one unauthenticated caller could exhaust another's
  // attempt budget for the same staffId. The throttle now only ever keys a real
  // actor id, so buckets can't collide.
  const actor = await getCurrentUserStaffId()
  if (!actor) {
    return { valid: false, error: 'Not authorized to verify a PIN' }
  }

  const decision = checkPinThrottle(actor, staffId)
  if (!decision.allowed) {
    // Same generic shape as a wrong PIN → does not reveal lockout vs. bad PIN
    // vs. unknown staff (enumeration-resistant).
    return { valid: false, error: 'Too many attempts. Try again shortly.' }
  }

  try {
    const synqed = await getSynqedClient()
    const result = await synqed.staff.verifyPin(staffId, pin)
    if (result.valid) {
      recordPinSuccess(actor, staffId)
    } else {
      recordPinFailure(actor, staffId)
    }
    return { valid: result.valid, ...(result.no_pin ? { noPin: true } : {}) }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Check if a staff member has a PIN set.
 */
export async function hasStaffPin(staffId: string): Promise<boolean> {
  try {
    const synqed = await getSynqedClient()
    const result = await synqed.staff.hasPin(staffId)
    return result.has_pin
  } catch {
    return false
  }
}

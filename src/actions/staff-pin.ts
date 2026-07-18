'use server'

import { updateTag } from 'next/cache'
import { getSynqedClient } from '@/lib/synqed/client'
import { auditWeb } from '@/lib/audit-web'
import { getCurrentUserStaffId } from '@/lib/staff'
import {
  checkPinThrottle,
  recordPinFailure,
  recordPinSuccess,
} from '@/lib/auth/pin-throttle'

/**
 * Set or update a staff member's 4-digit PIN. Hashing happens server-side.
 * Core gates the change by the acting (signed-in) staff: you may set your own
 * PIN, or an OWNER/ADMIN may set anyone's.
 */
export async function setStaffPin(staffId: string, pin: string): Promise<{ error?: string }> {
  if (!/^\d{4}$/.test(pin)) {
    return { error: 'PIN must be exactly 4 digits' }
  }

  const actingStaffId = await getCurrentUserStaffId()
  if (!actingStaffId) {
    return { error: 'Not authorized to set a PIN' }
  }

  try {
    const synqed = await getSynqedClient()
    await synqed.staff.setPin(staffId, pin, actingStaffId)
    // Credential change (never the PIN itself — ids only).
    await auditWeb({
      category: 'staff',
      action: 'staff.pin_set',
      severity: 'notice',
      targetType: 'staff',
      targetId: staffId,
    })
    updateTag('staff-list')
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
  if (!actingStaffId) {
    return { error: 'Not authorized to remove a PIN' }
  }

  try {
    const synqed = await getSynqedClient()
    await synqed.staff.removePin(staffId, actingStaffId)
    await auditWeb({
      category: 'staff',
      action: 'staff.pin_removed',
      severity: 'notice',
      targetType: 'staff',
      targetId: staffId,
    })
    updateTag('staff-list')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
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

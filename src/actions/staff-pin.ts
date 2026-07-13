'use server'

import { updateTag } from 'next/cache'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCurrentUserStaffId } from '@/lib/staff'

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
  try {
    const synqed = await getSynqedClient()
    const result = await synqed.staff.verifyPin(staffId, pin)
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

'use server'

import { cookies } from 'next/headers'
import { verifyStaffPin } from '@/actions/staff-pin'
import { ACTIVE_STAFF_COOKIE } from '@/lib/active-staff'

const ONE_MONTH = 60 * 60 * 24 * 30

/**
 * Set the active staff for this device after verifying their PIN. The cookie is
 * written ONLY on a valid PIN. Roster membership is re-validated on every read
 * (getActiveStaffId), so this only needs to gate on the PIN here.
 */
export async function setActiveStaff(
  staffId: string,
  pin: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await verifyStaffPin(staffId, pin)
  if (!result.valid) {
    return { ok: false, error: result.error ?? 'Incorrect PIN' }
  }
  const store = await cookies()
  store.set(ACTIVE_STAFF_COOKIE, staffId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ONE_MONTH,
  })
  return { ok: true }
}

/** Clear the active staff (switch out / logout). */
export async function clearActiveStaff(): Promise<void> {
  const store = await cookies()
  store.delete(ACTIVE_STAFF_COOKIE)
}

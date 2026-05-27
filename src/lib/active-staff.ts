import { cache } from 'react'
import { cookies } from 'next/headers'
import { getStaffList } from './staff'

export const ACTIVE_STAFF_COOKIE = 'active_staff_id'

/**
 * The PIN-selected "active staff" for this device, or null. Reads the
 * active_staff_id cookie and validates it against the org roster; a stale or
 * foreign id resolves to null. Safe because it is roster-validated on every
 * read and only ever written after a PIN check.
 *
 * This is a read-only path: it runs during server-component render (layout +
 * pages), where Next.js forbids mutating cookies (that throws outside a Server
 * Action / Route Handler). So a stale/foreign id simply resolves to null — the
 * lingering cookie is harmless and gets overwritten by the next
 * setActiveStaff/clearActiveStaff.
 */
export const getActiveStaffId = cache(async (): Promise<string | null> => {
  const store = await cookies()
  const id = store.get(ACTIVE_STAFF_COOKIE)?.value
  if (!id) return null
  const roster = await getStaffList()
  return roster.some((s) => s.id === id) ? id : null
})

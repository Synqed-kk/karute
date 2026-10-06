// 担当未定 picker (PR-B): who the sheet may offer for a staff-less booking —
// the ACTIVE staff who work at the BOOKING's store (a staff_stores row for it,
// or no rows at all), never the view's store and never every branch. The
// store half is the caller's existing store-scoped helper, called with the
// booking's own store. The write gate (refuseIneligibleStaff) stays the
// authority; this only keeps the picker from offering someone it will refuse.
// Fail closed: an unreadable roster or assignment offers nobody, and the sheet
// falls back to its read-only lines.

import { listAllCoreStaff } from '@/lib/synqed/staff-pager'
import type { SynqedClient } from '@synqed-kk/client'

export async function assignableStaffIdsByBooking(
  rows: ReadonlyArray<{ id: string; staff_profile_id: string | null; store_id?: string | null }>,
  staff: ReadonlyArray<{ id: string; email?: string | null }>,
  synqed: Pick<SynqedClient, 'staff'>,
  storeStaffIds: (storeId: string) => Promise<Set<string> | null>,
): Promise<Record<string, string[]>> {
  const unassigned = rows.filter((r) => r.staff_profile_id == null)
  if (unassigned.length === 0) return {}

  // A member whose core staff row is inactive cannot take a booking (matched by
  // core id and by linked profile id). A profile with no core row yet is not
  // excluded: the assignment creates an active one.
  let core: Awaited<ReturnType<typeof listAllCoreStaff<{ id: string; is_active?: boolean }>>>
  try {
    core = await listAllCoreStaff(synqed.staff)
  } catch {
    return {}
  }
  const inactive = new Set<string>()
  for (const m of core) {
    if (m.is_active !== false) continue
    inactive.add(m.id)
    const profileId = (m as { user_id?: string | null }).user_id
    if (profileId) inactive.add(profileId)
  }
  const active = staff.filter((s) => !inactive.has(s.id))

  const byStore = new Map<string, string[]>()
  const out: Record<string, string[]> = {}
  for (const r of unassigned) {
    const storeId = r.store_id ?? null
    // No store on the booking: nothing to judge the store against (the write
    // gate skips the store half for it too).
    if (!storeId) {
      out[r.id] = active.map((s) => s.id)
      continue
    }
    if (!byStore.has(storeId)) {
      const ids = await storeStaffIds(storeId).catch(() => null)
      byStore.set(storeId, ids ? active.filter((s) => ids.has(s.id)).map((s) => s.id) : [])
    }
    out[r.id] = byStore.get(storeId)!
  }
  return out
}

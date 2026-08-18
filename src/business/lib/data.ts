// THE data door for Business screens (the one-file swap point when core
// actor-enforcement lands). Every read takes the store lens as its REQUIRED
// first argument, so a screen cannot silently query business-wide: 'store-id'
// = that store; { viewAll: true } = every store, and only for an actor who may.

import type { Appointment, Customer, Menu } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId, staffListByBusinessOrThrow, type StaffMember } from '@/lib/staff'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { listAllCustomers } from '@/lib/customers/list-all'
import { paginateDedupe } from '@/lib/customers/paginate'

export type StoreLens = string | { viewAll: true }

const lensStoreId = (lens: StoreLens): string | undefined =>
  typeof lens === 'string' ? lens : undefined

/** `{ viewAll: true }` is a CALLER CLAIM. Honor it only when the session actor
 *  actually holds the cross-store capability; otherwise throw (a screen asking
 *  for every store without the right to see it is a bug, not an empty list). */
async function assertLens(lens: StoreLens): Promise<void> {
  if (typeof lens === 'string') return
  if (!(await getMyCapabilities()).has('stores.viewAll')) {
    throw new Error('business data: viewAll lens requires the stores.viewAll capability')
  }
}

/** Second line of defense behind core's own filter, run on the COMPLETE paged
 *  set. `nullVisible` is the storeless-row rule, which differs by surface: a
 *  null-store MENU is a 全店舗 item shown everywhere (isolation law); a
 *  null-store BOOKING stays hidden from a clamped lens (appointments.ts:206-210). */
function inLens<T extends { store_id?: string | null }>(rows: T[], lens: StoreLens, nullVisible: boolean): T[] {
  const id = lensStoreId(lens)
  if (!id) return rows
  return rows.filter((r) => (r.store_id == null ? nullVisible : r.store_id === id))
}

/** ponytail: customers carry no store_id (core derives store membership from
 *  events), so the lens can only be passed down — nothing to re-check here.
 *  listAllCustomers pages to completion; enforceStore is the RBAC posture. */
export async function listCustomers(lens: StoreLens): Promise<Customer[]> {
  await assertLens(lens)
  const synqed = await getSynqedClient()
  const { customers } = await listAllCustomers(synqed, {
    store_id: lensStoreId(lens),
    enforceStore: true,
  })
  return customers
}

export async function listAppointments(
  lens: StoreLens,
  range: { from?: string; to?: string } = {},
): Promise<Appointment[]> {
  await assertLens(lens)
  const synqed = await getSynqedClient()
  // Paged to completion: core clamps page_size, so one page silently drops rows.
  const all = await paginateDedupe((page) =>
    synqed.appointments
      .list({ ...range, store_id: lensStoreId(lens), page, page_size: 500 })
      .then((r) => ({ items: r.appointments, total: r.total })),
  )
  return inLens(all, lens, false)
}

export async function listMenus(lens: StoreLens): Promise<Menu[]> {
  await assertLens(lens)
  const synqed = await getSynqedClient()
  const { menus } = await synqed.menus.list({ store_id: lensStoreId(lens) })
  return inLens(menus, lens, true)
}

/** App-owned roster (profiles + not-yet-signed-up synqed staff), clamped to the
 *  lens. Fails LOUD, never open — the throwing roster read plus an UNCAUGHT
 *  assignment read, so this surface can't quietly show the wrong people. A
 *  staff whose assignment can't be resolved at all (no matching card) is
 *  EXCLUDED under a clamped lens, unlike the phone picker which keeps unknowns
 *  (it filters a convenience list, not a data lens). No assignment rows =
 *  floating (every store, the staff_stores convention), still visible.
 *  ponytail: three uncached core reads — pilot roster is tiny; wrap in
 *  unstable_cache (tag 'staff-list') if a screen calls it per render. */
export async function listStaff(lens: StoreLens): Promise<StaffMember[]> {
  await assertLens(lens)
  const businessId = await getBusinessId()
  const storeId = lensStoreId(lens)
  const roster = await staffListByBusinessOrThrow(businessId)
  if (!storeId) return roster

  const synqed = await getSynqedClient()
  const [{ staff }, { assignments }] = await Promise.all([
    synqed.staff.list({ page_size: 200 }),
    synqed.staffStores.list(),
  ])
  // Roster ids are profile ids for signed-up staff and synqed card ids for the
  // rest — link by id, then user_id, then email (staff-map.ts's two-tier match).
  const cards = new Set(staff.map((s) => s.id))
  const byUser = new Map(staff.filter((s) => s.user_id).map((s) => [s.user_id!, s.id]))
  const byEmail = new Map(staff.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s.id]))
  return roster.filter((m) => {
    const card = cards.has(m.id)
      ? m.id
      : (byUser.get(m.id) ?? (m.email ? byEmail.get(m.email.toLowerCase()) : undefined))
    if (!card) return false
    const stores = assignments[card]
    return !stores || stores.length === 0 || stores.includes(storeId)
  })
}

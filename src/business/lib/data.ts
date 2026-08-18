// THE data door for Business screens — PLAY PHASE.
//
// ⚖ Liam 2026-08-19: SYNQED Business runs on FAKE data until he orders the
// real connection, and the door must be structurally INCAPABLE of touching
// core or customer data — not merely "unwired". So this file imports no
// client of any kind: every read comes from ./fixtures, an in-territory
// module of obviously-invented sample rows. The real client implementation
// was removed on that ruling and lives in git history at fe2d3a62;
// reconnection is a future Liam-word PR that swaps THIS ONE FILE back.
//
// What survives the swap unchanged, because screens are written against it:
// every read takes the store lens as its REQUIRED first argument ('store-id'
// = that store; { viewAll: true } = every store, and only for an actor who
// may), the clamp semantics, and the fail-loud posture (nothing here
// swallows an error into an empty list).

import { getMyCapabilities } from '@/lib/auth/require-permission'
import {
  appointments,
  customers,
  menus,
  staff,
  staffAssignments,
  staffCards,
  type FixtureAppointment,
  type FixtureCustomer,
  type FixtureMenu,
  type FixtureStaff,
} from './fixtures'

export type StoreLens = string | { viewAll: true }

const lensStoreId = (lens: StoreLens): string | undefined =>
  typeof lens === 'string' ? lens : undefined

/** `{ viewAll: true }` is a CALLER CLAIM. Honor it only when the session actor
 *  actually holds the cross-store capability; otherwise throw (a screen asking
 *  for every store without the right to see it is a bug, not an empty list).
 *  This is the one live read in the file, and it reads CONFIG (capabilities),
 *  never customer data — same family as the admission lock. */
async function assertLens(lens: StoreLens): Promise<void> {
  if (typeof lens === 'string') return
  if (!(await getMyCapabilities()).has('stores.viewAll')) {
    throw new Error('business data: viewAll lens requires the stores.viewAll capability')
  }
}

/** The store clamp. `nullVisible` is the storeless-row rule, which differs by
 *  surface: a null-store MENU is a 全店舗 item shown everywhere (isolation
 *  law); a null-store BOOKING stays hidden from a clamped lens
 *  (src/actions/appointments.ts:206-210). */
function inLens<T extends { store_id?: string | null }>(rows: T[], lens: StoreLens, nullVisible: boolean): T[] {
  const id = lensStoreId(lens)
  if (!id) return rows
  return rows.filter((r) => (r.store_id == null ? nullVisible : r.store_id === id))
}

/** Customers are business-wide — they carry no store_id, so the lens gates
 *  access but has nothing to filter on. */
export async function listCustomers(lens: StoreLens): Promise<FixtureCustomer[]> {
  await assertLens(lens)
  return customers
}

export async function listAppointments(
  lens: StoreLens,
  range: { from?: string; to?: string } = {},
): Promise<FixtureAppointment[]> {
  await assertLens(lens)
  const inRange = appointments.filter(
    (a) => (!range.from || a.starts_at >= range.from) && (!range.to || a.starts_at <= range.to),
  )
  return inLens(inRange, lens, false)
}

export async function listMenus(lens: StoreLens): Promise<FixtureMenu[]> {
  await assertLens(lens)
  return inLens(menus, lens, true)
}

/** Roster clamped to the lens. A staff whose assignment can't be resolved at
 *  all (no matching card) is EXCLUDED under a clamped lens, unlike the phone
 *  picker which keeps unknowns (it filters a convenience list, not a data
 *  lens). No assignment rows = floating (every store, the staff_stores
 *  convention), still visible. Same filtering the real door ran; only the
 *  source of the three inputs changed. */
export async function listStaff(lens: StoreLens): Promise<FixtureStaff[]> {
  await assertLens(lens)
  const storeId = lensStoreId(lens)
  if (!storeId) return staff

  // Roster ids are profile ids for signed-up staff and card ids for the rest —
  // link by id, then user_id, then email (staff-map.ts's two-tier match).
  const cards = new Set(staffCards.map((s) => s.id))
  const byUser = new Map(staffCards.filter((s) => s.user_id).map((s) => [s.user_id!, s.id]))
  const byEmail = new Map(staffCards.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s.id]))
  return staff.filter((m) => {
    const card = cards.has(m.id)
      ? m.id
      : (byUser.get(m.id) ?? (m.email ? byEmail.get(m.email.toLowerCase()) : undefined))
    if (!card) return false
    const stores = staffAssignments[card]
    return !stores || stores.length === 0 || stores.includes(storeId)
  })
}

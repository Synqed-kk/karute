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
// = that store; { viewAll: true } = every store), the clamp semantics, and the
// fail-loud posture (nothing here swallows an error into an empty list).
//
// This module imports NOTHING outside territory — the seal is structural.

import {
  appointments,
  customers,
  stores,
  menus,
  staff,
  staffAssignments,
  staffCards,
  type FixtureAppointment,
  type FixtureCustomer,
  type FixtureMenu,
  type FixtureStaff,
  type FixtureStore,
} from './fixtures'

export type StoreLens = string | { viewAll: true }

const lensStoreId = (lens: StoreLens): string | undefined =>
  typeof lens === 'string' ? lens : undefined

/** The lens stays REQUIRED and is validated at runtime too: a screen that
 *  forgets it (or a JS caller passing junk) must fail loudly, never fall
 *  through to a business-wide read.
 *  PLAY-PHASE: `{ viewAll: true }` is accepted on the caller's word. The
 *  capability check that made it a PRIVILEGE (stores.viewAll) resolved through
 *  a chain that reaches synqed-core, so it retired with the seal and returns
 *  in the reconnect PR alongside the real data. Fake rows, no privilege left
 *  to protect. */
function assertLens(lens: StoreLens): void {
  if (typeof lens === 'string' && lens.length > 0) return
  if (typeof lens === 'object' && lens !== null && lens.viewAll === true) return
  throw new Error('business data: a store lens is required')
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

/** The stores a lens can BE — the one read with no lens argument, because it
 *  enumerates the lens itself rather than reading through it.
 *  ⚠ RECONNECT: this must return only the stores the actor may see (store
 *  isolation law: hide, never show-and-refuse). Fixtures have no actor, so v1
 *  returns both. */
export async function listStoreOptions(): Promise<FixtureStore[]> {
  return stores
}

/** Customers are business-wide — they carry no store_id, so the lens gates
 *  access but has nothing to filter on. */
export async function listCustomers(lens: StoreLens): Promise<FixtureCustomer[]> {
  assertLens(lens)
  return customers
}

export async function listAppointments(
  lens: StoreLens,
  range: { from?: string; to?: string } = {},
): Promise<FixtureAppointment[]> {
  assertLens(lens)
  const inRange = appointments.filter(
    (a) => (!range.from || a.starts_at >= range.from) && (!range.to || a.starts_at <= range.to),
  )
  return inLens(inRange, lens, false)
}

export async function listMenus(lens: StoreLens): Promise<FixtureMenu[]> {
  assertLens(lens)
  return inLens(menus, lens, true)
}

/** Roster clamped to the lens. A staff whose assignment can't be resolved at
 *  all (no matching card) is EXCLUDED under a clamped lens, unlike the phone
 *  picker which keeps unknowns (it filters a convenience list, not a data
 *  lens). No assignment rows = floating (every store, the staff_stores
 *  convention), still visible. Same filtering the real door ran; only the
 *  source of the three inputs changed. */
export async function listStaff(lens: StoreLens): Promise<FixtureStaff[]> {
  assertLens(lens)
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

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
// This module imports NOTHING outside territory except React's cache() — the
// render runtime, already on the isolation allowlist — so the data seal stays
// structural.

import { cache } from 'react'
import {
  appointments,
  business,
  customers,
  operator,
  reserveSync,
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

/** THE clock read for one server render — every fixture date in a render is
 *  derived from this single instant.
 *  `appointments()` re-derives the whole calendar from the clock on every call
 *  (fixtures.ts:280, deliberately), so two reads in one render that straddle
 *  JST midnight returned two different fixture days: the same booking could
 *  carry one date in 予約 and another in 来店履歴, and a screen's own `new
 *  Date()` could land on a third (Greptile P1 on #724). React cache() pins one
 *  value per request — the same tool src/lib/perf/render-stamp.ts uses — so
 *  screens read their "now" from HERE rather than the clock.
 *  ponytail: the anchor is cached, not the row array — appointments() stays a
 *  per-call function and a dozen rows twice a render costs nothing. */
export const renderNow = cache((): Date => new Date())

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

/** The store a screen opens on — THE one home for the default lens.
 *  ⚖ Liam 2026-08-20: すべての店舗 left the sidebar switcher, so a request with
 *  no ?store= (or an unknown one — the lens is a view preference, never an
 *  error) opens on the operator's own store: the first option listStoreOptions
 *  returns, which at reconnect is the first store the actor may see. Returns
 *  null only when the actor has no store at all, which is what keeps the
 *  {viewAll:true} branch in the screens honest rather than dead. */
export function defaultStoreId(store: string | undefined, options: FixtureStore[]): string | null {
  return options.find((o) => o.id === store)?.id ?? options[0]?.id ?? null
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
  const inRange = appointments(renderNow()).filter(
    (a) => (!range.from || a.starts_at >= range.from) && (!range.to || a.starts_at <= range.to),
  )
  return inLens(inRange, lens, false)
}

/** 来店履歴 (contract D13). Real core has no read for `customer_visits` at all
 *  — the SDK exposes only the write (SDK-1) — so the app would have to rebuild
 *  visits from completed bookings, which is exactly what this does. Kept a
 *  separate read rather than a screen-side filter so the reconnect PR has one
 *  signature to swap when `listVisits` ships.
 *  ⚠ RECONNECT: a real visit carries `sales_amount`; this stands in with the
 *  booking's agreed price, which is not the same number once discounts exist. */
export async function listVisits(
  lens: StoreLens,
  opts: { customerId?: string } = {},
): Promise<FixtureAppointment[]> {
  assertLens(lens)
  const done = appointments(renderNow()).filter(
    (a) => a.status === 'done' && (!opts.customerId || a.customer_id === opts.customerId),
  )
  return inLens(done, lens, false).sort((a, b) => b.starts_at.localeCompare(a.starts_at))
}

/** The tenant + operator + sync state the shell names. No lens: it describes
 *  the viewer, not a store's rows.
 *  ⚠ RECONNECT: `storeCount` must become the count of stores the ACTOR may see
 *  (isolation law), not the tenant's total. */
export async function readShellIdentity(): Promise<{
  business: typeof business
  operator: typeof operator
  /** ISO instant of the last Reserve sync. Resolved HERE rather than in the
   *  shell so the clock is read in a data function, not during render — and off
   *  the render anchor, so the door reads the clock in exactly one place. */
  reserveSyncedAt: string
}> {
  return {
    business,
    operator,
    reserveSyncedAt: new Date(renderNow().getTime() - reserveSync.minutes_ago * 60_000).toISOString(),
  }
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

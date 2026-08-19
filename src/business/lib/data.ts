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

import { jstSlotEnd } from './clock'
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
import {
  absence,
  blocks,
  boardNow,
  closedWeekday,
  decisions,
  operatingHours,
  opsConfig,
  pricingRule,
  recoverySteps,
  register,
  resources,
  sellSlots,
  shifts,
  staffListPrice,
  staffQualifications,
  type FixtureResource,
} from './fixtures-today'

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
  const inRange = appointments().filter(
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
  const done = appointments().filter(
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
   *  shell so the clock is read in a data function, not during render. */
  reserveSyncedAt: string
}> {
  return {
    business,
    operator,
    // ONE WORLD CLOCK. The play-phase world runs on the board's anchor, not the
    // wall clock: `boardNow` pins 今日の運営 at 13:24 JST (fixtures-today.ts),
    // so a sync stamp derived from Date.now() would put a second, contradicting
    // time in the topbar above that same now-line — the shell saying 09:07 over
    // a board whose afternoon is already settled. Both stamps are the same
    // scene now: the sync happened `minutes_ago` before the board's moment.
    // `jstSlotEnd(0, 0, boardNow, …)` = today at 00:00 JST + boardNow minutes,
    // shifted back — the day still comes from the real date (⚖ L-6, only the
    // intra-day time is pinned).
    reserveSyncedAt: jstSlotEnd(0, 0, boardNow, -reserveSync.minutes_ago),
  }
}

export async function listMenus(lens: StoreLens): Promise<FixtureMenu[]> {
  assertLens(lens)
  return inLens(menus, lens, true)
}

/** The 今日の運営 nav badge (Today A6), per store AND business-wide.
 *  No lens argument for the same reason `listStoreOptions` has none: the shell
 *  renders above the lens (a Next layout never sees searchParams), so it is
 *  handed one number per store and picks the one the lens is standing on. That
 *  is what keeps the badge, the 未解決 cell and the cards on the board the SAME
 *  count under every lens — a business-wide badge over a clamped board would
 *  disagree with the screen under it, and leak another store's workload.
 *  ⚠ RECONNECT: ask T-15 — core has no exception queue. */
export async function readUnresolvedCounts(): Promise<{ byStore: Record<string, number>; all: number }> {
  const open = decisions.filter((d) => d.state === 'open')
  const byStore: Record<string, number> = {}
  for (const s of stores) byStore[s.id] = open.filter((d) => d.store_id === s.id).length
  return { byStore, all: open.length }
}

/** ベッド・設備 (Today F19–F21). Store-scoped like any other store-owned row:
 *  a resource with no store would be a 全店舗 bed, which is not a thing.
 *  ⚠ RECONNECT: ask T-04 — core has no resource plane at all today. */
export async function listResources(lens: StoreLens): Promise<FixtureResource[]> {
  assertLens(lens)
  return inLens(resources, lens, false)
}

/** The three board planes core does not expose (asks T-01…T-08, T-15), read as
 *  ONE call because they are one scene: a board rendered from a shift plane and
 *  a decision plane fetched a moment apart could show a decision about a shift
 *  that is no longer there. Rows that carry a store are clamped; rows keyed to a
 *  staff member (shifts, qualifications) are not — the roster read is what
 *  decides which staff the lens can see, and clamping twice would drop the
 *  floating card that legitimately works in every store.
 *  ⚠ RECONNECT: every field below is fixture-only. See the PR's honesty table. */
export async function readDayPlanes(lens: StoreLens) {
  assertLens(lens)
  return {
    operatingHours,
    /** JST minutes from midnight — the moment the board is showing. */
    boardNow,
    shifts,
    staffQualifications,
    staffListPrice,
    closedWeekday,
    opsConfig,
    absence: inLens([absence], lens, false)[0] ?? null,
    blocks: inLens(blocks, lens, false),
    sellSlots: inLens(sellSlots, lens, false),
    decisions: inLens(decisions, lens, false),
    register,
    pricingRule,
    recoverySteps: [...recoverySteps],
  }
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
  const assigned = staffStoreMap()
  return staff.filter((m) => {
    const stores = assigned[m.id]
    if (stores === undefined) return false // no card at all
    return stores === null || stores.includes(storeId)
  })
}

/** Which stores each roster member may work in. `null` = floating (every
 *  store, the staff_stores convention); a MISSING key means the member has no
 *  card and cannot be resolved to a store at all.
 *
 *  Exposed because the board needs it too: under viewAll a 販売可能枠 must not
 *  pair a person with a bed in a store they do not work in — that would be the
 *  board advertising a window the business cannot honour (⚖ 8/9). */
export async function readStaffStores(lens: StoreLens): Promise<Record<string, string[] | null>> {
  assertLens(lens)
  return staffStoreMap()
}

/** Roster ids are profile ids for signed-up staff and card ids for the rest —
 *  link by id, then user_id, then email (staff-map.ts's two-tier match). */
function staffStoreMap(): Record<string, string[] | null> {
  const cards = new Set(staffCards.map((s) => s.id))
  const byUser = new Map(staffCards.filter((s) => s.user_id).map((s) => [s.user_id!, s.id]))
  const byEmail = new Map(staffCards.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s.id]))
  const out: Record<string, string[] | null> = {}
  for (const m of staff) {
    const card = cards.has(m.id)
      ? m.id
      : (byUser.get(m.id) ?? (m.email ? byEmail.get(m.email.toLowerCase()) : undefined))
    if (!card) continue
    const stores = staffAssignments[card]
    out[m.id] = !stores || stores.length === 0 ? null : stores
  }
  return out
}

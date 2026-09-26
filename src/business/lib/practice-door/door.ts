// THE practice door — the ON side of data.ts's switch (DESIGN-PRACTICE-DOOR.md §3–§7).
// Same names, parameter lists and return shapes as data.ts's readers; data.ts is
// this file's only importer (pinned), so the lens type is restated locally.
//
// LIVE rows come from core through the actor's bound READS (./actor → ./core-reach);
// SAMPLE planes (everything core does not hold) stay fixture-shaped and reach the
// live ids through the facade (./sample-facade), by exact twin, never by position.
// Every lensed reader first checks the lens against the actor's visible stores
// (§3). A core error propagates — never an empty list (§7). Nothing here writes,
// except the ONE guarded writer (A2, Liam 9/24): `writeReserveCardColor`, one key, one PUT.
// The second guarded writer, 予約の色分け's `writeBookingColors` (PKT-S38, Liam 9/25), lives in
// ./door-booking-colors.ts (R-S39-1: one allowlist entry per file::call); it reads through
// `orgSettingsOf` and `canManageSettings`, exported here for it and nothing else.

import { assertLensVisible, pageAll, practiceActor, visibleIds, type PracticeActor } from './actor'
import { fixtureIdOf, samplePolicyFor } from './registry'
import { borrows, rekeyKeys, rekeyRows, sampleFor, sampleKeys, sampleRows, singletonsOf, type RosterSeats } from './sample-facade'
import {
  appointments,
  customers,
  menus,
  reserveSync,
  stores,
  type FixtureAppointment,
  type FixtureCustomer,
  type FixtureMenu,
  type FixtureStaff,
  type FixtureStore,
} from '../fixtures'
import {
  absence,
  boardNow,
  decisions,
  pricingRule,
  recoverySteps,
  sellSlots,
  shifts,
  staffListPrice,
  staffQualifications,
  type FixtureAbsence,
  type FixtureBlock,
  type FixtureDecision,
  type FixtureResource,
  type FixtureSellSlot,
  type FixtureShift,
} from '../fixtures-today'
import { analyticsPolicy, dowWeight, menuMix, salesLedger, salesTargets, sourceMix, staffMix } from '../fixtures-analytics'
import { rulebook } from '../fixtures-settings'
import { auditTrail, reservations } from '../fixtures-reservations'
import { jstDayKey, jstMinuteOfDay, jstSlot, jstSlotEnd, renderNow } from '../clock'
import { normalizeCardColor } from '../reserve-card/card-color'
import { PALETTE } from '../reserve-card/palette'
import { practiceTenant } from './switch'

type StoreLens = string | { viewAll: true }
type DayRange = { from: number; to: number }
type CoreAppointment = Awaited<ReturnType<PracticeActor['reads']['appointmentsList']>>['appointments'][number]
type CoreQuery = { from?: string; to?: string; status?: CoreAppointment['status'] }

/** The operator's role LABEL is the Business family's own vocabulary — the word
 *  every room's `accessFor` grants by — so it is the inverse of the rulebook's
 *  `roleKeyOf` (オーナー→owner, 店舗管理者→manager, スタッフ→practitioner). Every
 *  other key (senior, frontdesk, custom, area_manager, trainee, accountant) → ''
 *  — a label no room grants anything to; never the fixture operator's role. */
const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(rulebook.roleKeyOf).map(([label, key]) => [key, label]),
)

/** A BLOCK row with no title. The phone app prints no label of its own for
 *  one (grep 9/23, PKT-PR2 fold 2), so this is an honest empty chip; the
 *  word is PR-3's copy work. */
const BLOCK_DEFAULT_LABEL = ''

/** The person mark: the first token of a name split on an ASCII or full-width
 *  space, the whole name when there is none. Core has no mark field; the
 *  fixture pre-splits, and this is the ONE place the door does the same. */
const firstToken = (name: string): string => name.split(/[ \u3000]/)[0]

const lensStore = (lens: StoreLens): string | undefined => (typeof lens === 'string' ? lens : undefined)

/** Local `inLens` semantics for SAMPLE rows: a string lens keeps its own
 *  store's rows (a null-store row is hidden); viewAll keeps everything. */
function clamp<T extends { store_id?: string | null }>(rows: T[], lens: StoreLens): T[] {
  const id = lensStore(lens)
  return id ? rows.filter((r) => r.store_id === id) : rows
}

/** ISO instant of 00:00 JST on `dayKey` (whole JST days since the epoch). */
function dayStartIso(dayKey: number): string {
  return jstSlot(dayKey - jstDayKey(renderNow()), 0, 0, renderNow())
}

const dayKeys = (range: DayRange): number[] =>
  Array.from({ length: Math.max(0, range.to - range.from + 1) }, (_, i) => range.from + i)

// ── LIVE ───────────────────────────────────────────────────────────────────

/** One paged appointments read, clamped to what the actor may see. A string
 *  lens is core's own `store_id` filter (which excludes null-store rows) —
 *  asserted, not re-filtered; viewAll keeps null-store rows and drops any row
 *  of a store outside VISIBLE (belt-and-braces: core lists the tenant). */
async function coreAppointments(actor: PracticeActor, lens: StoreLens, q: CoreQuery): Promise<CoreAppointment[]> {
  const store_id = lensStore(lens)
  const rows = await pageAll('appointments', 500, async (page) => {
    const r = await actor.reads.appointmentsList({ ...q, store_id, page, page_size: 500 })
    return { rows: r.appointments, page_size: r.page_size }
  })
  if (store_id) {
    const stray = rows.find((r) => r.store_id !== store_id)
    if (stray) throw new Error(`practice door: core returned appointment ${stray.id} outside store ${store_id}`)
    return rows
  }
  const visible = visibleIds(actor)
  return rows.filter((r) => r.store_id === null || visible.includes(r.store_id))
}

/** Core row → FixtureAppointment (§5). LIVE fields from core; the fixture-only
 *  fields from the twin fixture row when one exists, else honest defaults. */
function toAppointment(row: CoreAppointment, fixtureRows: FixtureAppointment[], now: Date): FixtureAppointment {
  const twinId = fixtureIdOf('appointments', row.id)
  const twin = twinId === null ? undefined : fixtureRows.find((a) => a.id === twinId)
  // A BOOKING always names its customer; a null here is a contract violation, not a row.
  if (row.customer_id === null) throw new Error(`practice door: booking ${row.id} has no customer`)
  const [status, board_state]: [FixtureAppointment['status'], FixtureAppointment['board_state']] =
    row.status === 'COMPLETED'
      ? ['done', twin?.board_state ?? 'confirmed']
      : row.status === 'CANCELLED'
        ? ['cancelled', null]
        : row.status === 'NO_SHOW'
          ? ['booked', 'noshow']
          : ['booked', twin?.board_state ?? 'confirmed'] // SCHEDULED | IN_PROGRESS
  return {
    id: row.id,
    store_id: row.store_id,
    ...(twin?.kind_id !== undefined ? { kind_id: twin.kind_id } : {}),
    customer_id: row.customer_id,
    staff_id: row.staff_id,
    menu_id: row.menu_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    // Yen only: any other currency (or none) is unknown 「—」, never a converted number.
    booked_price: row.booked_price_currency === 'JPY' ? row.booked_price_amount : null,
    status,
    display_no: twin?.display_no ?? '',
    board_state,
    settlement: twin?.settlement ?? null,
    resource_id: row.resource_id,
    ...(twin?.requires_private_room !== undefined ? { requires_private_room: twin.requires_private_room } : {}),
    // Unseeded rows carry core's enum as-is; its JP label is PR-3's copy work.
    source: twin?.source ?? row.source,
    reassigned_from: twin?.reassigned_from ?? null,
    taken_days_ago: Math.max(0, jstDayKey(now) - jstDayKey(new Date(row.created_at))),
    updated_minute: row.updated_at === row.created_at ? null : jstMinuteOfDay(row.updated_at),
  }
}

async function bookings(actor: PracticeActor, lens: StoreLens, q: CoreQuery): Promise<FixtureAppointment[]> {
  const now = renderNow()
  const fixtureRows = appointments(now)
  return (await coreAppointments(actor, lens, q))
    .filter((r) => r.kind === 'BOOKING')
    .map((r) => toAppointment(r, fixtureRows, now))
}

/** A core BLOCK → board block piece(s), keyed by JST day. A block crossing JST
 *  midnight is SPLIT at every boundary — first day to 24:00, each middle day
 *  whole, last day from 00:00 — never dropped. */
function blockPieces(row: CoreAppointment): Array<[number, FixtureBlock]> {
  const piece = (start: number, end: number): FixtureBlock => ({
    id: row.id,
    // FixtureBlock.store_id is non-null; a null-store BLOCK only reaches here under viewAll.
    store_id: row.store_id ?? '',
    kind: row.title ?? BLOCK_DEFAULT_LABEL,
    staff_id: row.staff_id,
    resource_id: row.resource_id,
    start,
    end,
    // opsConfig has no micro dial: `micro` is a per-row fixture literal, and a live block is never micro.
    micro: false,
    note: row.notes ?? '',
  })
  // Loud, never a silent vanish: a block that ends before it starts is a contract violation.
  if (Date.parse(row.ends_at) < Date.parse(row.starts_at)) throw new Error(`practice door: block ${row.id} ends before it starts`)
  const a = jstDayKey(row.starts_at)
  const b = jstDayKey(row.ends_at)
  const start = jstMinuteOfDay(row.starts_at)
  const end = jstMinuteOfDay(row.ends_at)
  if (b === a) return [[a, piece(start, end)]]
  const last = end === 0 ? b - 1 : b // ends exactly at 00:00 → the day before runs to 24:00
  return Array.from({ length: last - a + 1 }, (_, i): [number, FixtureBlock] => {
    const k = a + i
    return [k, piece(k === a ? start : 0, k === last && k === b ? end : 1440)]
  })
}

/** The one read behind blocks-by-day: every row of [from, to] (JST days,
 *  inclusive) for the lens — the BLOCKs grouped by day.
 *  The query starts a day EARLY so an overnight block begun on from−1 still
 *  reaches `from` (its from−1 piece is dropped by the key filter). */
async function dayRows(actor: PracticeActor, lens: StoreLens, range: DayRange) {
  const rows = await coreAppointments(actor, lens, { from: dayStartIso(range.from - 1), to: dayStartIso(range.to + 1) })
  const pieces = rows
    .filter((r) => r.kind === 'BLOCK')
    .flatMap(blockPieces)
    .filter(([k]) => k >= range.from && k <= range.to)
  const keys = [...new Set(pieces.map(([k]) => k))]
  return {
    blocksByDay: new Map(keys.map((k) => [k, pieces.filter(([p]) => p === k).map(([, b]) => b)])),
    rows, // ⚖ R10 — the same read's rows, for the day's room occupancy
  }
}

export async function listStoreOptions(): Promise<FixtureStore[]> {
  const actor = await practiceActor()
  return actor.visible.map((s) => {
    const policy = samplePolicyFor(s.id)
    if (policy.kind === 'twin') {
      const twin = stores.find((f) => f.id === policy.fixtureStoreId)
      if (!twin) throw new Error(`practice door: registry twin ${policy.fixtureStoreId} has no fixture store`)
      // ⚖ PR-3 V4-2 — the store's own 業種 wins when the registry names one; the plane is the twin's.
      return { id: s.id, name: s.name, business_type: policy.business_type ?? twin.business_type, default_kind_id: twin.default_kind_id }
    }
    return { id: s.id, name: s.name, business_type: '', default_kind_id: '' }
  })
}

async function activeStaff(actor: PracticeActor) {
  const rows = await pageAll('staff list', 200, async (page) => {
    const r = await actor.reads.staffList({ page, page_size: 200 })
    return { rows: r.staff, page_size: r.page_size }
  })
  return rows.filter((s) => s.is_active !== false)
}

/** absent/empty assignments = floating: the person works in every store. */
const worksAt = (stores: string[] | undefined, id: string): boolean => !stores || stores.length === 0 || stores.includes(id)

/** ⚖ PR-4a §v7 V7-3 — each store of the lens (viewAll: every store in view) with its
 *  active people in a STABLE order: the rows `listStaff(store)` yields, sorted by id —
 *  and (⚖ R8') its active rooms, the rows `listResources(store)` reads, sorted by id.
 *  Internal to the facade's `rekeyRows` (the borrower's seats), from ONE pair of staff
 *  reads per call — never a call per store. `listStaff`'s own order stays core's. */
async function rosterOrderOf(actor: PracticeActor, lens: StoreLens): Promise<RosterSeats[]> {
  const rows = await activeStaff(actor)
  const { assignments } = await actor.reads.staffStoresList()
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return Promise.all((typeof lens === 'string' ? [lens] : visibleIds(actor)).map(async (store) => ({
    store,
    // ⚖ R9 — each seat's live name, for the borrowed free text
    roster: rows.filter((row) => worksAt(assignments[row.id], store)).map((row) => ({ id: row.id, name: row.name })).sort(byId),
    // ⚖ R8' — the store's own active rooms: the read listResources makes, once per store
    rooms: (await actor.reads.resourcesList({ store_id: store, active: true })).resources.map((r) => ({ id: r.id, name: r.name })).sort(byId),
  })))
}

export async function listStaff(lens: StoreLens): Promise<FixtureStaff[]> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const rows = await activeStaff(actor)
  const { assignments } = await actor.reads.staffStoresList()
  const id = lensStore(lens)
  return rows
    .filter((row) => !id || worksAt(assignments[row.id], id))
    .map((row) => ({ id: row.id, full_name: row.name, email: row.email }))
}

export async function readStaffStores(lens: StoreLens): Promise<Record<string, string[] | null>> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const rows = await activeStaff(actor)
  const { assignments } = await actor.reads.staffStoresList()
  // Assignments are cut to the stores THIS actor may see, so no hidden store id
  // ever leaves the door (they reach client-bound lanes). null = floating (no
  // assignment rows at all); a card assigned ONLY to hidden stores gets NO key —
  // absent = unresolved, which the roster clamp excludes; never null, which
  // would mean "works everywhere". viewAll intersects too, so an inactive
  // store's id never leaves either.
  const visible = visibleIds(actor)
  const out: Record<string, string[] | null> = {}
  for (const row of rows) {
    const assigned = assignments[row.id] ?? []
    if (assigned.length === 0) {
      out[row.id] = null
      continue
    }
    const seen = assigned.filter((id) => visible.includes(id))
    if (seen.length > 0) out[row.id] = seen
  }
  return out
}

export async function listMenus(lens: StoreLens): Promise<FixtureMenu[]> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const id = lensStore(lens)
  const all = (await actor.reads.menusList({ active: true })).menus
  // Core's store_id filter excludes the null-store 全店舗 rows, which data.ts shows everywhere.
  const rows = id
    ? [...(await actor.reads.menusList({ store_id: id, active: true })).menus, ...all.filter((m) => m.store_id === null)]
    : all.filter((m) => m.store_id === null || visibleIds(actor).includes(m.store_id))
  const unique = rows.filter((m, i) => rows.findIndex((n) => n.id === m.id) === i)
  return unique.map((m) => {
    if (m.currency !== 'JPY') throw new Error(`practice door: non-JPY menu ${m.id}`) // the practice data is yen
    const twinId = fixtureIdOf('menus', m.id)
    const twin = twinId === null ? undefined : menus.find((f) => f.id === twinId)
    return {
      id: m.id,
      store_id: m.store_id,
      requires_kind_id: twin ? twin.requires_kind_id : null,
      name: m.name,
      price: m.price_list_amount,
      duration_minutes: m.duration_minutes,
    }
  })
}

export async function listCustomers(lens: StoreLens): Promise<FixtureCustomer[]> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  // ⚖ 8/17 ①②: a clamped lens lists core's store membership; viewAll lists all.
  const store_id = lensStore(lens)
  const rows = await pageAll('customers', 500, async (page) => {
    const r = await actor.reads.customersList({ ...(store_id ? { store_id } : {}), page, page_size: 500 })
    return { rows: r.customers, page_size: r.page_size }
  })
  return rows.map((row) => {
    const twinId = fixtureIdOf('customers', row.id)
    const twin = twinId === null ? undefined : customers.find((c) => c.id === twinId)
    return {
      id: row.id,
      member_number: row.member_number ?? '',
      name: row.name,
      furigana: row.furigana,
      mark: firstToken(row.name),
      phone: row.phone,
      email: row.email,
      source: twin?.source ?? '',
      identity_check: twin?.identity_check ?? null,
      ticket_balance: twin?.ticket_balance ?? null,
      wallet_balance: twin?.wallet_balance ?? null,
      merge_status: twin?.merge_status ?? 'none',
      duplicate_of: twin?.duplicate_of ?? null,
      consent: twin?.consent ?? null,
      line_linked: twin?.line_linked ?? false,
      party: twin?.party ?? [],
      thin: twin?.thin ?? false,
      external_owner: twin?.external_owner ?? false,
      note: twin?.note ?? null,
      vip: twin?.vip ?? false,
    }
  })
}

export async function listAppointments(
  lens: StoreLens,
  range: { from?: string; to?: string } = {},
): Promise<FixtureAppointment[]> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  // data.ts's range is inclusive on both ends; core's `to` is exclusive → +1 ms.
  const to = range.to ? new Date(Date.parse(range.to) + 1).toISOString() : undefined
  return bookings(actor, lens, { from: range.from, to })
}

export async function listVisits(
  lens: StoreLens,
  opts: { customerId?: string } = {},
): Promise<FixtureAppointment[]> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const newestFirst = (a: FixtureAppointment, b: FixtureAppointment) => b.starts_at.localeCompare(a.starts_at)
  if (!opts.customerId) return (await bookings(actor, lens, { status: 'COMPLETED' })).sort(newestFirst)
  // Core's real per-customer read (customers.listVisits): the visit's own
  // sales_amount, no appointment/menu/staff ids.
  const { visits } = await actor.reads.customerVisits(opts.customerId)
  return clamp(
    visits.map((v): FixtureAppointment => ({
      id: v.id,
      store_id: v.store_id,
      customer_id: v.customer_id,
      staff_id: null,
      menu_id: null,
      starts_at: v.used_at,
      ends_at: v.used_at,
      booked_price: v.sales_amount,
      status: 'done',
      display_no: '',
      board_state: 'confirmed',
      settlement: null,
      resource_id: null,
      source: '',
      reassigned_from: null,
      taken_days_ago: 0,
      updated_minute: null,
    })),
    lens,
  ).sort(newestFirst)
}

/** ⚖ A1b · P2-2 — ONE org-settings read per admitted actor, shared by every reader that needs the
 *  document (the shell's business name, the Reserve card colour — 設定 asked three times per render).
 *  The once-promise lives on the actor's own bound reads: one binding per actor, and practiceActor() is
 *  React-cache()d per request, so readers in one render share the answer and a new request never sees
 *  an old one. A symbol slot rather than a WeakMap: this folder's fence bans the `.set(` token outright
 *  (foundation.test.ts, the mutator list), and a cache is no reason to weaken a core-write fence. */
const ORG_ONCE = Symbol('org-settings, once per actor')
export function orgSettingsOf(actor: PracticeActor) {
  const reads: PracticeActor['reads'] & { [ORG_ONCE]?: ReturnType<PracticeActor['reads']['orgSettingsGet']> } = actor.reads
  return (reads[ORG_ONCE] ??= reads.orgSettingsGet())
}

export async function readShellIdentity(): Promise<{
  business: { name: string; storeCount: number }
  operator: { name: string; mark: string; role: string; staff_id: string }
  reserveSyncedAt: string
}> {
  const actor = await practiceActor()
  const now = renderNow()
  const org = await orgSettingsOf(actor)
  return {
    // FOLD F-1: the count of stores THIS actor may see, never the tenant total.
    business: { name: org?.name ?? '', storeCount: actor.visible.length },
    operator: {
      name: actor.card.name,
      mark: firstToken(actor.card.name),
      role: Object.prototype.hasOwnProperty.call(ROLE_LABEL, actor.sheet.role) ? ROLE_LABEL[actor.sheet.role] : '',
      staff_id: actor.card.id,
    },
    // SAMPLE: exactly data.ts's scene stamp.
    reserveSyncedAt: jstSlotEnd(0, 0, boardNow, -reserveSync.minutes_ago, now),
  }
}

/** LIVE: org settings' `reserve_card_color` through the door's existing read;
 *  null / absent / malformed → null (contract §2, §6 — Reserve reads it the same way). */
export async function readReserveCardColor(): Promise<string | null> {
  const actor = await practiceActor()
  const org = await orgSettingsOf(actor)
  return normalizeCardColor(org?.settings?.reserve_card_color)
}

/** LIVE: 予約の色分け's org-settings keys through the same read, RAW — every own key that IS `booking_colors`
 *  (the legacy per-store map, read-only) or STARTS WITH `booking_colors:` (one key per store, ⚖ PKT-S41 R-S41-1),
 *  values untouched; no other key leaves the door. null when the settings are absent. The key names' one home is
 *  booking-colors.ts (door.ts does not import it; the writer suite pins this filter to its keys), and
 *  `bookingColorsFor` there is the one place that resolves them. */
export async function readBookingColors(): Promise<Record<string, unknown> | null> {
  const actor = await practiceActor()
  const settings: unknown = (await orgSettingsOf(actor))?.settings
  if (settings === null || settings === undefined || typeof settings !== 'object') return null
  return Object.fromEntries(Object.entries(settings).filter(([key]) => key === 'booking_colors' || key.startsWith('booking_colors:')))
}

/** ⚖ A2 · G5 — ONE truth for 「may this operator save the card colour」: core's own answer sheet. */
export const canManageSettings = (a: PracticeActor) => a.sheet.capabilities.includes('settings.manage')

/** LIVE: may the admitted operator save the card colour? The page asks so the screen never offers a
 *  保存する the writer would refuse. Never throws to the page: another business → false; any other
 *  failure → false, logged. OFF → false (no writer). */
export async function readCanManageCardColor(): Promise<boolean> {
  if (practiceTenant() === null) return false
  const reach = await import('./core-reach') // lazy, like the writer
  try {
    return canManageSettings(await practiceActor())
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return false
    console.error('[business card colour] core did not answer:', e instanceof Error ? e.message : String(e))
    return false
  }
}

export type WriteCardColorResult =
  | { ok: true; color: string | null }
  | { ok: false; reason: 'forbidden' | 'tenant' | 'invalid' | 'core' }

/** ⚖ A2 (Liam 9/24, CONTRACT-CARD-LOOK §5) — THE ONE BUSINESS WRITER: the Reserve card colour.
 *  OFF has no writer. Only the 12 palette hex values or null, checked before any core call.
 *  `settings.manage` on core's own answer sheet. Read-before-write through the shared org read: an
 *  equal value sends nothing. Core merges a one-key PUT (org-settings.service.ts:50), so exactly one
 *  key is sent and nothing is read-merged-written. A core failure is reported, never swallowed or retried. */
export async function writeReserveCardColor(next: string | null): Promise<WriteCardColorResult> {
  if (practiceTenant() === null) return { ok: false, reason: 'tenant' }
  if (next !== null && !PALETTE.some((c) => c.hex === next)) return { ok: false, reason: 'invalid' }
  const reach = await import('./core-reach') // lazy, like actor.ts: the OFF path never loads the SDK
  let actor: PracticeActor
  try {
    actor = await practiceActor()
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return { ok: false, reason: 'tenant' }
    // The route promises 503 honesty: a failed staff / sheet / store read is core's failure, never a 500.
    console.error('[business card colour] core did not answer:', e instanceof Error ? e.message : String(e))
    return { ok: false, reason: 'core' }
  }
  if (!canManageSettings(actor)) return { ok: false, reason: 'forbidden' }
  try {
    const before = (await orgSettingsOf(actor))?.settings?.reserve_card_color ?? null
    // G6 — a clear compares the RAW value: a legacy 'navy' normalises to null but is still stored.
    const same = next === null ? before === null : normalizeCardColor(before) === next
    if (same) return { ok: true, color: next }
    const writer = reach.orgSettingsWriterFor({ businessId: actor.businessId })
    const saved = await writer.orgSettings.upsert({ settings: { reserve_card_color: next } })
    const color = normalizeCardColor(saved?.settings?.reserve_card_color)
    // R-A2-4 — the audit line (a core audit row is R5, later).
    console.info('[business card colour]', JSON.stringify({ business_id: actor.businessId, actor: actor.card.id, old: before, new: color, at: renderNow().toISOString() }))
    return { ok: true, color }
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return { ok: false, reason: 'tenant' }
    console.error('[business card colour] core did not save:', e instanceof Error ? e.message : String(e))
    return { ok: false, reason: 'core' }
  }
}

/** ⚖ A1b · K11 — LIVE: the store's own address, from the door's own core store record (null = none). */
export async function readStoreAddress(lens: string): Promise<string | null> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  return actor.visible.find((s) => s.id === lens)?.address ?? null
}

export async function listResources(lens: StoreLens): Promise<FixtureResource[]> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const ids = typeof lens === 'string' ? [lens] : visibleIds(actor)
  const rows = (await Promise.all(ids.map((store_id) => actor.reads.resourcesList({ store_id, active: true })))).flatMap((r) => r.resources)
  return rows.map((r) => {
    const policy = samplePolicyFor(r.store_id)
    const twin = policy.kind === 'twin' ? stores.find((f) => f.id === policy.fixtureStoreId) : undefined
    return {
      id: r.id,
      store_id: r.store_id,
      kind_id: twin ? twin.default_kind_id : '',
      name: r.name,
      note: r.note ?? '',
      cleanup_minutes: r.cleanup_minutes,
      room_class: r.room_class,
    }
  })
}

export async function listBlocksByDay(lens: StoreLens, range: DayRange): Promise<Map<number, FixtureBlock[]>> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  return (await dayRows(actor, lens, range)).blocksByDay
}

// ── SAMPLE (through the facade) ────────────────────────────────────────────

/** ⚖ PR-4a R10 — a live room's busy spans on `dayKey` (JST minutes), from rows the door already read:
 *  every BOOKING or BLOCK on a room that is not CANCELLED / NO_SHOW (core's tombstones), from its
 *  start to its end extended — never shortened — by core's own `occupied_until` cleanup snapshot. */
type Busy = Array<{ room: string; start: number; end: number }>
function roomsBusy(rows: CoreAppointment[], dayKey: number): Busy {
  return rows.flatMap((r): Busy => {
    if (r.resource_id === null || r.status === 'CANCELLED' || r.status === 'NO_SHOW') return []
    const until = r.occupied_until !== null && Date.parse(r.occupied_until) > Date.parse(r.ends_at) ? r.occupied_until : r.ends_at
    const [a, b] = [jstDayKey(r.starts_at), jstDayKey(until)]
    if (dayKey < a || dayKey > b) return []
    const span = { room: r.resource_id, start: a < dayKey ? 0 : jstMinuteOfDay(r.starts_at), end: b > dayKey ? 1440 : jstMinuteOfDay(until) }
    return span.end > span.start ? [span] : []
  })
}
/** The day's busy rooms for the borrowers in view that have a slot to check — read only then (no slot, no read). */
async function busyFor(actor: PracticeActor, seats: RosterSeats[], dayKey: number): Promise<Busy> {
  const check = seats.filter((s) => borrows(s.store) && rekeyRows(sellSlots, [s], 'identity').length > 0)
  const days = await Promise.all(check.map((s) => dayRows(actor, s.store, { from: dayKey, to: dayKey })))
  return days.flatMap((d) => roomsBusy(d.rows, dayKey))
}
/** ⚖ PR-4a R10 — the slots a store is SERVED: a borrower's slot only on a room its OWN live day shows free for
 *  the slot's window (bookings and blocks on that room, core's cleanup snapshot included; the room's own
 *  cleanup_minutes dial is not applied). An exact twin is served its own slots, as before. */
function servedSlots(seats: RosterSeats[], busy: Busy): FixtureSellSlot[] {
  return rekeyRows(sellSlots, seats, 'identity', (_, x) => !busy.some((o) => o.room === x.resource_id && o.start < x.end && x.start < o.end))
}

/** ⚖ PR-4a R4 — the decisions a store is SERVED. A borrower's rows point at no other store's
 *  records (the facade nulls them), so a card built on its booking cannot be composed there
 *  and is not served; a slot decision is served with its slot. Rendered on Dev Salon (fix
 *  round): 担当変更 · レジ · 担当不在 and a Reserve販売 about a booking drop; the Reserve販売
 *  about a served slot stays. An exact twin is served all of its own, as before. */
function servedDecisions(rows: FixtureDecision[], seats: RosterSeats[], busy: Busy): FixtureDecision[] {
  const slots = new Set(servedSlots(seats, busy).map((s) => s.id))
  return rekeyRows(rows, seats, 'attribute', (raw, d) => raw.appointment_id === null && d.sell_slot_id !== null && slots.has(d.sell_slot_id))
}

export async function readUnresolvedCounts(): Promise<{ byStore: Record<string, number>; all: number }> {
  const actor = await practiceActor()
  const open = decisions.filter((d) => d.state === 'open')
  const byStore: Record<string, number> = {}
  // ⚖ PR-4a — per store, its OWN re-key of the open family: a borrower counts the rows it is served
  // (R10: today's busy rooms, read only for a borrower with a slot to check).
  const all = await rosterOrderOf(actor, { viewAll: true })
  const busy = await busyFor(actor, all, jstDayKey(renderNow()))
  for (const seats of all) byStore[seats.store] = servedDecisions(open, [seats], busy).length
  // A store the actor cannot see never counts.
  return { byStore, all: Object.values(byStore).reduce((a, b) => a + b, 0) }
}

export async function listShiftsByDay(lens: StoreLens, range: DayRange): Promise<Map<number, FixtureShift[]>> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const rows = rekeyRows(shifts, await rosterOrderOf(actor, lens), 'identity')
  return new Map(dayKeys(range).map((k) => [k, rows]))
}

export async function listAbsenceByDay(lens: StoreLens, range: DayRange): Promise<Map<number, FixtureAbsence | null>> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const todayKey = jstDayKey(renderNow())
  const inRange = todayKey >= range.from && todayKey <= range.to
  const row = rekeyRows(inRange ? [absence] : [], await rosterOrderOf(actor, lens), 'identity')[0] ?? null
  return new Map(inRange ? [[todayKey, row]] : [])
}

export async function readDayPlanes(lens: StoreLens, dayKey: number) {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const today = dayKey === jstDayKey(renderNow())
  const [day, seats] = await Promise.all([dayRows(actor, lens, { from: dayKey, to: dayKey }), rosterOrderOf(actor, lens)])
  const busy = roomsBusy(day.rows, dayKey) // ⚖ R10 — the rows this read already holds
  const s = singletonsOf(typeof lens === 'string' ? samplePolicyFor(lens) : null) // ⚖ §v9 V9-1/V9-2
  return {
    operatingHours: s.operatingHours,
    /** JST minutes from midnight — the moment the board is showing. */
    boardNow,
    // ⚖ PR-4a §v7 V7-3 — the board's rows through the ONE re-key: an exact twin's as before,
    // a borrower's on its own store and roster; viewAll = every store in view's own rows.
    shifts: rekeyRows(shifts, seats, 'identity'),
    staffQualifications: rekeyKeys(staffQualifications, seats),
    staffListPrice: rekeyKeys(staffListPrice, seats),
    closedWeekday: s.closedWeekday,
    opsConfig: s.opsConfig,
    absence: rekeyRows(today ? [absence] : [], seats, 'identity')[0] ?? null,
    blocks: day.blocksByDay.get(dayKey) ?? [],
    sellSlots: servedSlots(seats, busy),
    decisions: servedDecisions(today ? decisions : [], seats, busy),
    // SAMPLE contract: no register in core yet — neutral, never fixture money.
    // Named field by field, never a spread of the fixture plane, so a fixture
    // refund can never be subtracted from a live 純売上 (LIVE-PROOF M-A) and a
    // fixture terminal_held can never print 「端末保持 1件 / ¥6,600」 or a 閉店阻害
    // row against a live twin booking (FE-1).
    register: {
      cash_difference: 0,
      refunds: 0,
      terminal_held: [],
    },
    pricingRule,
    recoverySteps: [...recoverySteps],
  }
}

export async function readReservationPlanes(lens: StoreLens) {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const seats = await rosterOrderOf(actor, lens) // ⚖ PR-4a R5 — the same rows the board is served
  const busy = await busyFor(actor, seats, jstDayKey(renderNow())) // ⚖ R10 — today's rooms, as the board
  const s = singletonsOf(typeof lens === 'string' ? samplePolicyFor(lens) : null) // ⚖ §v9 V9-1/V9-2
  return {
    reservations: sampleFor(reservations, null),
    auditTrail: sampleKeys('appointments', auditTrail), // keyed by appointment id → live twins
    /** JST minutes from midnight — the pinned moment every countdown is measured
     *  against, the same one the board's now-line uses. */
    boardNow,
    operatingHours: s.operatingHours,
    shifts: rekeyRows(shifts, seats, 'identity'),
    staffQualifications: rekeyKeys(staffQualifications, seats),
    absence: rekeyRows([absence], seats, 'identity')[0] ?? null,
    sellSlots: servedSlots(seats, busy),
    // SAMPLE contract: no register in core yet — neutral, never fixture money,
    // terminal_held included (as readDayPlanes).
    register: { cash_difference: 0, refunds: 0, terminal_held: [] },
  }
}

export async function readAnalyticsPlanes(lens: StoreLens) {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const targetOf = (storeId: string): number => {
    const policy = samplePolicyFor(storeId)
    return policy.kind === 'twin' ? (salesTargets[policy.fixtureStoreId] ?? 0) : 0
  }
  const storeId = lensStore(lens)
  const s = singletonsOf(typeof lens === 'string' ? samplePolicyFor(lens) : null) // ⚖ §v9 V9-1/V9-2
  return {
    ledger: clamp(sampleRows(salesLedger, null), lens),
    staffMix: clamp(sampleRows(staffMix, null), lens),
    menuMix: clamp(sampleRows(menuMix, null), lens),
    sourceMix: clamp(sampleRows(sourceMix, null), lens),
    /** 月間売上目標. Business-wide is the sum of the stores being viewed. */
    target: storeId ? targetOf(storeId) : visibleIds(actor).reduce((a, id) => a + targetOf(id), 0),
    policy: analyticsPolicy,
    dowWeight,
    closedWeekday: s.closedWeekday,
    staffQualifications: sampleKeys('staff', staffQualifications),
    ticketUnitPrice: pricingRule.base,
  }
}

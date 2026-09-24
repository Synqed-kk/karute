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

import { assertLensVisible, pageAll, practiceActor, visibleIds, type PracticeActor } from './actor'
import { fixtureIdOf, samplePolicyFor } from './registry'
import { sampleFor, sampleKeys, sampleRows } from './sample-facade'
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
  closedWeekday,
  decisions,
  operatingHours,
  opsConfig,
  pricingRule,
  recoverySteps,
  sellSlots,
  shifts,
  staffListPrice,
  staffQualifications,
  type FixtureAbsence,
  type FixtureBlock,
  type FixtureResource,
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
  }
}

export async function listStoreOptions(): Promise<FixtureStore[]> {
  const actor = await practiceActor()
  return actor.visible.map((s) => {
    const policy = samplePolicyFor(s.id)
    if (policy.kind === 'twin') {
      const twin = stores.find((f) => f.id === policy.fixtureStoreId)
      if (!twin) throw new Error(`practice door: registry twin ${policy.fixtureStoreId} has no fixture store`)
      return { id: s.id, name: s.name, business_type: twin.business_type, default_kind_id: twin.default_kind_id }
    }
    if (policy.kind === 'named') return { id: s.id, name: s.name, business_type: policy.business_type, default_kind_id: '' }
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

export async function listStaff(lens: StoreLens): Promise<FixtureStaff[]> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const rows = await activeStaff(actor)
  const { assignments } = await actor.reads.staffStoresList()
  const id = lensStore(lens)
  return rows
    .filter((row) => {
      if (!id) return true
      const stores = assignments[row.id]
      return !stores || stores.length === 0 || stores.includes(id) // absent/empty = floating
    })
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
function orgSettingsOf(actor: PracticeActor) {
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

/** ⚖ A2 · G5 — ONE truth for 「may this operator save the card colour」: core's own answer sheet. */
const canManageSettings = (a: PracticeActor) => a.sheet.capabilities.includes('settings.manage')

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
    if (normalizeCardColor(before) === next) return { ok: true, color: next }
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

export async function readUnresolvedCounts(): Promise<{ byStore: Record<string, number>; all: number }> {
  const actor = await practiceActor()
  const open = sampleRows(decisions.filter((d) => d.state === 'open'), null)
  const byStore: Record<string, number> = {}
  for (const s of actor.visible) byStore[s.id] = open.filter((d) => d.store_id === s.id).length
  // A store the actor cannot see never counts.
  return { byStore, all: Object.values(byStore).reduce((a, b) => a + b, 0) }
}

export async function listShiftsByDay(lens: StoreLens, range: DayRange): Promise<Map<number, FixtureShift[]>> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const rows = sampleFor(shifts, null)
  return new Map(dayKeys(range).map((k) => [k, rows]))
}

export async function listAbsenceByDay(lens: StoreLens, range: DayRange): Promise<Map<number, FixtureAbsence | null>> {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const todayKey = jstDayKey(renderNow())
  const inRange = todayKey >= range.from && todayKey <= range.to
  return new Map(inRange ? [[todayKey, clamp(sampleRows([absence], null), lens)[0] ?? null]] : [])
}

export async function readDayPlanes(lens: StoreLens, dayKey: number) {
  const actor = await practiceActor()
  assertLensVisible(actor, lens)
  const today = dayKey === jstDayKey(renderNow())
  const day = await dayRows(actor, lens, { from: dayKey, to: dayKey })
  return {
    operatingHours,
    /** JST minutes from midnight — the moment the board is showing. */
    boardNow,
    shifts: sampleFor(shifts, null),
    staffQualifications: sampleKeys('staff', staffQualifications),
    staffListPrice: sampleKeys('staff', staffListPrice),
    closedWeekday,
    opsConfig,
    absence: clamp(sampleRows(today ? [absence] : [], null), lens)[0] ?? null,
    blocks: day.blocksByDay.get(dayKey) ?? [],
    sellSlots: clamp(sampleRows(sellSlots, null), lens),
    decisions: clamp(sampleRows(today ? decisions : [], null), lens),
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
  return {
    reservations: sampleFor(reservations, null),
    auditTrail: sampleKeys('appointments', auditTrail), // keyed by appointment id → live twins
    /** JST minutes from midnight — the pinned moment every countdown is measured
     *  against, the same one the board's now-line uses. */
    boardNow,
    operatingHours,
    shifts: sampleFor(shifts, null),
    staffQualifications: sampleKeys('staff', staffQualifications),
    absence: clamp(sampleRows([absence], null), lens)[0] ?? null,
    sellSlots: clamp(sampleRows(sellSlots, null), lens),
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
  return {
    ledger: clamp(sampleRows(salesLedger, null), lens),
    staffMix: clamp(sampleRows(staffMix, null), lens),
    menuMix: clamp(sampleRows(menuMix, null), lens),
    sourceMix: clamp(sampleRows(sourceMix, null), lens),
    /** 月間売上目標. Business-wide is the sum of the stores being viewed. */
    target: storeId ? targetOf(storeId) : visibleIds(actor).reduce((a, id) => a + targetOf(id), 0),
    policy: analyticsPolicy,
    dowWeight,
    closedWeekday,
    staffQualifications: sampleKeys('staff', staffQualifications),
    ticketUnitPrice: pricingRule.base,
  }
}

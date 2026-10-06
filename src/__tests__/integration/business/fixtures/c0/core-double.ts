/**
 * An in-memory core implementing build order #1's C0 contract (§ 4 (a)–(i),
 * rulings OR-1…OR-3) — the test double for the C0 reader and the same-answers
 * tool. A fresh double per test (step-scoped). It never reaches a network.
 *
 * Appointment JSON = every field core's toPublic returns today
 * (core src/services/appointment.service.ts:157-185 @7d2f629) + the four C0 fields.
 * Tests only: the `x-double-actor-staff-id` header (DOUBLE_ACTOR_HEADER) stands in for
 * core's actorAuthMiddleware actor on the shift writes — it is not a core header.
 */
import type { CoreHttp, CoreMethod } from '@/lib/core-contract/c0'

type Json = unknown
type Query = Record<string, string | string[] | undefined>
export type Answer = { status: number; json: Json }

export type Appt = {
  [k: string]: unknown
  id: string
  business_id: string
  customer_id: string | null
  staff_id: string | null
  store_id: string | null
  starts_at: string
  ends_at: string
  occupied_until: string | null
  status: string
  source: string
  cancelled_at: string | null
  status_source: string | null
  status_set_by: string | null
  status_reason: string | null
  status_set_at: string | null
  updated_at: string
  hold_from: string | null
  hold_until: string | null
  holds_managed: boolean
  revision: number
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

export type Customer = { [k: string]: unknown; id: string; email: string | null; deleted_at: string | null; deleted_by: string | null; updated_at: string }
export type Shift = { [k: string]: unknown; id: string; staff_id: string; store_id: string; date: string; voided_at: string | null; voided_by: string | null; updated_at: string }

export const DOUBLE_SWITCH_KEYS = ['holds', 'allocator', 'status_rules', 'cleanup', 'money_settle', 'availability']
/** The double's stand-in for core's actorAuthMiddleware actor (NOT a core header). */
export const DOUBLE_ACTOR_HEADER = 'x-double-actor-staff-id'

// THE REVISION RULE (order § 4 (d)): COUNTED = every column except these.
const NOT_COUNTED = new Set(['revision', 'updated_at', 'hold_from', 'hold_until', 'status_set_at'])
// Public appointment fields — toPublic (appointment.service.ts:157-185 @7d2f629) + the four (order § 4 (h)).
const PUBLIC_APPT = [
  'id', 'requires_private_room', 'business_id', 'customer_id', 'staff_id', 'kind', 'store_id', 'starts_at', 'ends_at',
  'duration_minutes', 'title', 'notes', 'menu_id', 'resource_id', 'occupied_until', 'booked_price_amount',
  'booked_price_currency', 'status', 'source', 'external_refs', 'cancelled_at', 'status_source', 'status_set_by',
  'status_reason', 'status_set_at', 'rebooked_from_appointment_id', 'created_at', 'updated_at',
  'hold_from', 'hold_until', 'holds_managed', 'revision',
]
const PUBLIC_SHIFT = ['id', 'business_id', 'store_id', 'staff_id', 'date', 'start', 'end', 'breaks', 'blocks', 'created_by', 'updated_by', 'created_at', 'updated_at']

const canon = (v: unknown): string => JSON.stringify(v === undefined ? null : v)
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Answer => ({ status, json: { error, ...extra } })
const one = (q: Query, k: string): string | undefined => { const v = q[k]; return Array.isArray(v) ? v[0] : v }
const many = (q: Query, k: string): string[] => { const v = q[k]; return v === undefined ? [] : Array.isArray(v) ? v : [v] }
const isInstant = (s: string | undefined) => s !== undefined && /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s))
const intIn = (s: string | undefined, min: number, max: number) => s !== undefined && /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max

export class CoreDouble {
  readonly businessId: string
  readonly storeIds: Set<string>
  private clock: number
  private seq = 0
  private cursorSeq = 0
  readonly appts = new Map<string, Appt>()
  readonly events = new Map<string, Array<{ status: string; at: string }>>()
  readonly customers = new Map<string, Customer>()
  readonly shifts = new Map<string, Shift>()
  private readonly cursors = new Map<string, string>() // issued cursor → last id
  private readonly idem = new Map<string, { fingerprint: string; id: string }>()
  switchKeys = [...DOUBLE_SWITCH_KEYS]
  /** Test mode (R-5): every overlap page answers the same next_cursor — a core that never ends. */
  repeatCursor = false
  /** Test mode (R-6): customers with the same name come back in the reverse insertion order. */
  customerTiesReversed = false
  readonly requests: Array<{ method: string; path: string; query: Query }> = []

  constructor(opts: { businessId?: string; storeIds?: string[]; start?: string } = {}) {
    this.businessId = opts.businessId ?? 'b0000000-0000-4000-8000-000000000000'
    this.storeIds = new Set(opts.storeIds ?? ['50000000-0000-4000-8000-000000000001'])
    this.clock = Date.parse(opts.start ?? '2026-10-01T00:00:00.000Z')
  }

  now(): string { this.clock += 1000; return new Date(this.clock).toISOString() }
  nextId(prefix = '00000000'): string { this.seq += 1; return `${prefix}-0000-4000-8000-${String(this.seq).padStart(12, '0')}` }

  // ── the envelope trigger + revision rule (order § 4 (g), § 4 (d)) ──
  private envelope(row: Appt): void {
    if (row.holds_managed) return
    const s = Date.parse(row.starts_at)
    const until = Math.max(Date.parse(row.ends_at), row.occupied_until ? Date.parse(row.occupied_until) : -Infinity, s)
    row.hold_from = new Date(s).toISOString()
    row.hold_until = new Date(until).toISOString()
  }

  /** An UPDATE of one row by any writer (route or raw SQL): trigger + revision rule. */
  applyPatch(id: string, patch: Partial<Appt>): Appt {
    const old = this.appts.get(id)
    if (!old) throw new Error(`no row ${id}`)
    const next: Appt = { ...old, ...patch }
    this.envelope(next)
    next.updated_at = this.now()
    const keys = new Set([...Object.keys(old), ...Object.keys(next)])
    const changed = [...keys].some((k) => !NOT_COUNTED.has(k) && canon(old[k]) !== canon(next[k]))
    next.revision = changed ? old.revision + 1 : patch.revision === old.revision + 1 ? old.revision + 1 : old.revision
    this.appts.set(id, next)
    return next
  }

  /** Seeds a row as it would exist. `preApply: true` = a row from before the SQL apply (hold_* NULL). */
  seedAppointment(p: Partial<Appt> & { starts_at: string; ends_at: string }, opts: { preApply?: boolean } = {}): Appt {
    const at = this.now()
    const row: Appt = {
      id: p.id ?? this.nextId('a0000000'), requires_private_room: false, business_id: this.businessId,
      customer_id: null, staff_id: null, kind: 'BOOKING', store_id: [...this.storeIds][0], duration_minutes: null,
      title: null, notes: null, menu_id: null, resource_id: null, occupied_until: null, booked_price_amount: null,
      booked_price_currency: null, status: 'SCHEDULED', source: 'KARUTE', external_refs: null, cancelled_at: null,
      status_source: null, status_set_by: null, status_reason: null, status_set_at: null,
      rebooked_from_appointment_id: null, created_at: at, updated_at: at,
      hold_from: null, hold_until: null, holds_managed: false, revision: 0,
      voided_at: null, voided_by: null, void_reason: null, ...p,
    }
    if (!opts.preApply) this.envelope(row)
    this.appts.set(row.id, row)
    this.events.set(row.id, [{ status: row.status, at }])
    return row
  }

  seedCustomer(p: Partial<Customer> = {}): Customer {
    const at = this.now()
    const row: Customer = { id: p.id ?? this.nextId('c0000000'), business_id: this.businessId, name: 'テスト', email: null, deleted_at: null, deleted_by: null, created_at: at, updated_at: at, ...p }
    this.customers.set(row.id, row)
    return row
  }

  seedShift(p: Partial<Shift> & { staff_id: string; date: string }): Shift {
    const at = this.now()
    const row: Shift = { id: p.id ?? this.nextId('d0000000'), business_id: this.businessId, store_id: [...this.storeIds][0], start: 600, end: 1200, breaks: [], blocks: [], created_by: null, updated_by: null, created_at: at, updated_at: at, voided_at: null, voided_by: null, ...p }
    this.shifts.set(row.id, row)
    return row
  }

  /** false = an old core (before the deploy): the appointment JSON lacks the four C0 fields. */
  c0Fields = true
  pubAppt(r: Appt): Record<string, unknown> {
    const keys = this.c0Fields ? PUBLIC_APPT : PUBLIC_APPT.filter((k) => !['hold_from', 'hold_until', 'holds_managed', 'revision'].includes(k))
    return Object.fromEntries(keys.map((k) => [k, r[k] ?? null]))
  }
  private pubShift(r: Shift): Record<string, unknown> { return Object.fromEntries(PUBLIC_SHIFT.map((k) => [k, r[k] ?? null])) }
  private pubCustomer(r: Customer): Record<string, unknown> { return Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'deleted_by')) }
  private live(): Appt[] { return [...this.appts.values()].filter((r) => r.voided_at === null) }
  private liveAppt(id: string): Appt | undefined { const r = this.appts.get(id); return r && r.voided_at === null ? r : undefined }

  // ── the router ──
  handle(method: string, path: string, query: Query = {}, body: unknown = undefined, headers: Record<string, string> = {}): Answer {
    this.requests.push({ method, path, query })
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    const seg = path.replace(/^\/v1/, '').split('/').filter(Boolean)
    const [a, id, sub, key] = seg
    if (a === 'appointments') {
      if (method === 'GET' && !id) return this.listAppointments(query)
      if (method === 'POST' && !id) return this.createAppointment(body, h['idempotency-key'])
      if (method === 'GET' && id && sub === 'status-history') { const r = this.liveAppt(id); return r ? { status: 200, json: { events: this.events.get(id) } } : err(404, 'Appointment not found') }
      if (method === 'GET' && id) { const r = this.liveAppt(id); return r ? { status: 200, json: this.pubAppt(r) } : err(404, 'Appointment not found') }
      if (method === 'PUT' && id) return this.putAppointment(id, (body ?? {}) as Record<string, unknown>)
      if (method === 'DELETE' && id) {
        if (!this.liveAppt(id)) return err(404, 'Appointment not found')
        // OR-2: voided_by / void_reason stay NULL in C0.
        this.applyPatch(id, { voided_at: new Date(this.clock + 1000).toISOString() })
        return { status: 200, json: { success: true } }
      }
    }
    if (a === 'customers') return this.customersRoute(method, id, query, body)
    if (a === 'staff-shifts') return this.shiftsRoute(method, id, query, body, h[DOUBLE_ACTOR_HEADER])
    if (a === 'switches' && method === 'GET' && !id) return { status: 200, json: this.switchRead() }
    if (a === 'stores' && id && sub === 'switches') {
      if (!this.storeIds.has(id)) return err(404, 'Store not found')
      if (method === 'GET' && !key) return { status: 200, json: this.switchRead() }
      // switch_capabilities is EMPTY in C0: every key is refused.
      if (method === 'PUT' && key) return { status: 409, json: { error: 'SWITCH_NOT_BUILT', code: 'SWITCH_NOT_BUILT', key } }
    }
    return err(404, 'Not found')
  }

  private switchRead() {
    return { generation: 0, switches: Object.fromEntries(this.switchKeys.map((k) => [k, 'OFF'])) }
  }

  private listAppointments(q: Query): Answer {
    const overlaps = q.overlaps_from !== undefined || q.overlaps_to !== undefined
    const storeId = one(q, 'store_id')
    const statusNot = many(q, 'status_not')
    const pageSizeRaw = one(q, 'page_size')
    if (pageSizeRaw !== undefined && !intIn(pageSizeRaw, 1, 500)) return err(400, 'page_size must be 1..500')
    const pageSize = pageSizeRaw ? Number(pageSizeRaw) : 200
    let rows = this.live().filter((r) => r.business_id === this.businessId && (!storeId || r.store_id === storeId) && !statusNot.includes(r.status))
    if (!overlaps) {
      if (q.cursor !== undefined) return err(400, 'cursor is only valid with overlaps_from/overlaps_to')
      const from = one(q, 'from'); const to = one(q, 'to')
      if ((from && !isInstant(from)) || (to && !isInstant(to))) return err(400, 'Invalid datetime')
      const pageRaw = one(q, 'page')
      if (pageRaw !== undefined && !intIn(pageRaw, 1, Number.MAX_SAFE_INTEGER)) return err(400, 'page must be ≥ 1')
      const page = pageRaw ? Number(pageRaw) : 1
      rows = rows
        .filter((r) => (!from || Date.parse(r.starts_at) >= Date.parse(from)) && (!to || Date.parse(r.starts_at) < Date.parse(to)))
        .sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at) || (x.id < y.id ? -1 : 1))
      return { status: 200, json: { appointments: rows.slice((page - 1) * pageSize, page * pageSize).map((r) => this.pubAppt(r)), total: rows.length, page, page_size: pageSize } }
    }
    if (q.from !== undefined || q.to !== undefined) return err(400, 'from/to cannot be combined with overlaps_from/overlaps_to')
    if (q.page !== undefined) return err(400, 'page cannot be combined with overlaps_from/overlaps_to')
    const of = one(q, 'overlaps_from'); const ot = one(q, 'overlaps_to')
    if (!isInstant(of) || !isInstant(ot)) return err(400, 'overlaps_from and overlaps_to must both be instants')
    const ofMs = Date.parse(of as string); const otMs = Date.parse(ot as string)
    if (ofMs > otMs) return err(400, 'overlaps_from must not be after overlaps_to')
    let after: string | null = null
    const cursor = one(q, 'cursor')
    if (cursor !== undefined) {
      const last = this.cursors.get(cursor)
      if (last === undefined) return err(400, 'unreadable cursor')
      after = last
    }
    // [hold_from, hold_until) && [overlaps_from, overlaps_to): an empty range on either side never matches.
    const matching = rows
      .filter((r) => r.hold_from !== null && r.hold_until !== null)
      .filter((r) => { const hf = Date.parse(r.hold_from as string); const hu = Date.parse(r.hold_until as string); return hf < hu && ofMs < otMs && hf < otMs && ofMs < hu })
      .sort((x, y) => (x.id < y.id ? -1 : 1))
    const rest = after === null ? matching : matching.filter((r) => r.id > (after as string))
    const pageRows = rest.slice(0, pageSize)
    let next: string | null = null
    if (rest.length > pageSize) {
      this.cursorSeq += 1
      next = Buffer.from(`double:${this.cursorSeq}`).toString('base64url')
      this.cursors.set(next, pageRows[pageRows.length - 1].id)
    }
    if (this.repeatCursor) {
      next = Buffer.from('double:repeat').toString('base64url')
      this.cursors.set(next, '')
    }
    return { status: 200, json: { appointments: pageRows.map((r) => this.pubAppt(r)), total: matching.length, page: 1, page_size: pageSize, next_cursor: next } }
  }

  private createAppointment(body: unknown, key: string | undefined): Answer {
    const b = (body ?? {}) as Record<string, unknown>
    if (typeof b.starts_at !== 'string' || typeof b.ends_at !== 'string') return err(400, 'starts_at and ends_at are required')
    const fingerprint = canon(Object.fromEntries(Object.keys(b).sort().map((k) => [k, b[k]])))
    if (key) {
      const prior = this.idem.get(key)
      if (prior) {
        if (prior.fingerprint !== fingerprint) return { status: 409, json: { error: 'This Idempotency-Key was used with a different request body.', code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' } }
        const row = this.liveAppt(prior.id)
        if (!row) return { status: 409, json: { error: 'The appointment created under this Idempotency-Key no longer exists.', code: 'IDEMPOTENT_REPLAY_GONE' } }
        return { status: 200, json: this.pubAppt(row) }
      }
    }
    const row = this.seedAppointment(b as Partial<Appt> & { starts_at: string; ends_at: string })
    if (key) this.idem.set(key, { fingerprint, id: row.id })
    return { status: 201, json: this.pubAppt(row) }
  }

  /** PUT /v1/appointments/:id — the restate semantics of appointment.service.ts:534-548 @7d2f629. */
  private putAppointment(id: string, b: Record<string, unknown>): Answer {
    const row = this.liveAppt(id)
    if (!row) return err(404, 'Appointment not found')
    const patch: Partial<Appt> = {}
    for (const k of ['starts_at', 'ends_at', 'duration_minutes', 'title', 'notes', 'occupied_until', 'resource_id']) if (b[k] !== undefined) patch[k] = b[k]
    if (typeof b.status === 'string') {
      patch.status = b.status
      patch.status_source = 'STAFF'
      patch.status_set_by = (b.acting_staff_id as string | undefined) ?? null
      patch.status_reason = (b.status_reason as string | undefined) ?? null
      patch.status_set_at = this.now()
      const terminal = b.status === 'CANCELLED' || b.status === 'NO_SHOW'
      if (terminal && !row.cancelled_at) patch.cancelled_at = this.now()
      else if (!terminal && row.cancelled_at) patch.cancelled_at = null
      if (b.status !== row.status) this.events.get(id)?.push({ status: b.status, at: this.now() })
    }
    return { status: 200, json: this.pubAppt(this.applyPatch(id, patch)) }
  }

  private customersRoute(method: string, id: string | undefined, q: Query, body: unknown): Answer {
    if (method === 'GET' && !id) {
      const includeDeleted = one(q, 'include_deleted') === 'true'
      const page = Number(one(q, 'page') ?? 1); const pageSize = Number(one(q, 'page_size') ?? 20)
      if (!(pageSize >= 1 && pageSize <= 500)) return err(400, 'page_size must be 1..500')
      // As core: ordered by name alone, no id tiebreak (customer.service.ts:85 sortBy default 'name', :98 orderBy @7d2f629) —
      // equal names come back in no fixed order, so the double can flip them.
      const base = [...this.customers.values()].filter((c) => includeDeleted || c.deleted_at === null)
      if (this.customerTiesReversed) base.reverse()
      const rows = base.sort((x, y) => String(x.name ?? '').localeCompare(String(y.name ?? '')))
      return { status: 200, json: { customers: rows.slice((page - 1) * pageSize, page * pageSize).map((c) => this.pubCustomer(c)), total: rows.length, page, page_size: pageSize } }
    }
    if (method === 'GET' && id) { const c = this.customers.get(id); return c ? { status: 200, json: this.pubCustomer(c) } : err(404, 'Customer not found') }
    if (method === 'POST' && !id) {
      const b = (body ?? {}) as Record<string, unknown>
      // OR-1: an email collision returns the EXISTING record with 201, deleted or not (no 409 on a customer create in C0).
      const hit = typeof b.email === 'string' ? [...this.customers.values()].find((c) => c.email === b.email) : undefined
      if (hit) return { status: 201, json: this.pubCustomer(hit) }
      return { status: 201, json: this.pubCustomer(this.seedCustomer(b as Partial<Customer>)) }
    }
    if (method === 'DELETE' && id) {
      const c = this.customers.get(id)
      // As core today: a DELETE of a missing (or already deleted) customer throws 'Customer not found'
      // (customer.service.ts:426 @7d2f629); the DELETE route maps only CUSTOMER_MERGED (routes/customers.ts:123-135),
      // so app.onError answers 500 {error: message} (index.ts:97-100).
      if (!c || c.deleted_at !== null) return { status: 500, json: { error: 'Customer not found' } }
      const at = this.now()
      // Soft: deleted_at set, deleted_by NULL in C0 (OR-2); no booking touched; her keys stay reserved.
      this.customers.set(id, { ...c, deleted_at: at, deleted_by: null, updated_at: at })
      return { status: 200, json: { success: true } }
    }
    return err(404, 'Not found')
  }

  private shiftsRoute(method: string, id: string | undefined, q: Query, body: unknown, actor: string | undefined): Answer {
    const live = [...this.shifts.values()].filter((s) => s.voided_at === null)
    if (method === 'GET' && !id) {
      const page = Number(one(q, 'page') ?? 1); const pageSize = Number(one(q, 'page_size') ?? 100)
      if (!(pageSize >= 1 && pageSize <= 200)) return err(400, 'page_size must be 1..200')
      const [store, staff, date, from, to] = ['store_id', 'staff_id', 'date', 'from', 'to'].map((k) => one(q, k))
      const rows = live
        .filter((s) => (!store || s.store_id === store) && (!staff || s.staff_id === staff) && (!date || s.date === date) && (!from || s.date >= from) && (!to || s.date < to))
        .sort((x, y) => x.date.localeCompare(y.date) || x.staff_id.localeCompare(y.staff_id) || x.id.localeCompare(y.id))
      return { status: 200, json: { shifts: rows.slice((page - 1) * pageSize, page * pageSize).map((s) => this.pubShift(s)), total: rows.length, page, page_size: pageSize } }
    }
    const row = id ? this.shifts.get(id) : undefined
    const liveRow = row && row.voided_at === null ? row : undefined
    if (method === 'GET' && id) return liveRow ? { status: 200, json: this.pubShift(liveRow) } : err(404, 'Shift not found')
    if (!actor) return err(401, 'actor required')
    if (method === 'POST' && !id) {
      const b = (body ?? {}) as Partial<Shift> & { staff_id: string; date: string }
      if (live.some((s) => s.staff_id === b.staff_id && s.store_id === (b.store_id ?? [...this.storeIds][0]) && s.date === b.date)) {
        return err(409, 'A shift already exists for this staff, store, and date')
      }
      return { status: 201, json: this.pubShift(this.seedShift({ ...b, created_by: actor, updated_by: actor })) }
    }
    if (method === 'PUT' && id) {
      if (!liveRow) return err(404, 'Shift not found')
      const next = { ...liveRow, ...(body as object), updated_by: actor, updated_at: this.now() }
      this.shifts.set(liveRow.id, next)
      return { status: 200, json: this.pubShift(next) }
    }
    if (method === 'DELETE' && id) {
      if (!liveRow) return err(404, 'Shift not found')
      // The void is a Prisma update: @updatedAt stamps updated_at (schema.prisma:860 @7d2f629).
      const at = this.now()
      this.shifts.set(liveRow.id, { ...liveRow, voided_at: at, voided_by: actor, updated_at: at })
      return { status: 200, json: { success: true } }
    }
    return err(404, 'Not found')
  }

  asCoreHttp(): CoreHttp {
    return {
      request: async (method: CoreMethod, path: string, opts = {}) => {
        const query: Query = {}
        for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) query[k] = String(v)
        return this.handle(method, path, query, opts.body, opts.headers ?? {})
      },
    }
  }

  /** A fetch-like function for the same-answers collect (reads the path + query from the URL). */
  asFetch(): (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }> {
    return async (url, init = {}) => {
      const u = new URL(url)
      const query: Query = {}
      for (const k of new Set(u.searchParams.keys())) { const all = u.searchParams.getAll(k); query[k] = all.length > 1 ? all : all[0] }
      const ans = this.handle(init.method ?? 'GET', u.pathname, query, init.body ? JSON.parse(init.body) : undefined, init.headers ?? {})
      const text = JSON.stringify(ans.json)
      return { status: ans.status, ok: ans.status >= 200 && ans.status < 300, json: async () => JSON.parse(text) }
    }
  }
}

/**
 * C0 contract reader — tests-only until C2/B1 (CORE-59, today-impact C0).
 *
 * A thin TYPED client over an injected HTTP port for the parts of core's C0
 * contract our half reads: the four additive appointment fields, the overlap
 * read and the switch registry (build order #1, § 4 (h) and § 4 (i); rulings
 * OR-3). It never reads env, never builds a URL base, never reads a key —
 * business scoping and auth are the port's concern. No door imports this file
 * (eslint.config.mjs forbids it outside src/__tests__ and this folder).
 */

export type CoreMethod = 'GET' | 'PUT' | 'POST' | 'DELETE'

export interface CoreHttp {
  request(
    method: CoreMethod,
    path: string,
    opts?: {
      query?: Record<string, string | number | undefined>
      body?: unknown
      headers?: Record<string, string>
    },
  ): Promise<{ status: number; json: unknown }>
}

export type C0ErrorCode = 'FIELD_MISSING' | 'FIELD_TYPE' | 'SHAPE' | 'BAD_REQUEST' | 'HTTP'

export class C0ContractError extends Error {
  readonly code: C0ErrorCode
  readonly field?: string
  readonly error?: string
  readonly status?: number
  constructor(info: { code: C0ErrorCode; field?: string; error?: string; status?: number; detail?: string }) {
    super(`C0 contract: ${info.code}${info.field ? ` (${info.field})` : ''}${info.error ? `: ${info.error}` : ''}${info.status ? ` [${info.status}]` : ''}${info.detail ? ` — ${info.detail}` : ''}`)
    this.name = 'C0ContractError'
    this.code = info.code
    if (info.field !== undefined) this.field = info.field
    if (info.error !== undefined) this.error = info.error
    if (info.status !== undefined) this.status = info.status
  }
}

// ── (b) the four additive fields ────────────────────────────────────────────

export type C0AppointmentFields = {
  hold_from: string | null
  hold_until: string | null
  holds_managed: boolean
  revision: number
}

const C0_FIELDS = ['hold_from', 'hold_until', 'holds_managed', 'revision'] as const

// ISO-8601 instant as core serialises it (Date#toISOString) or with an offset.
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/
// core's `revision` column is int4 (order § 4 (d)).
const INT4_MAX = 2147483647

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/** A real instant: Date.parse is finite AND every calendar field exists (no Feb 30, no hour 24). */
function isInstant(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = ISO_INSTANT.exec(v)
  if (!m || !Number.isFinite(Date.parse(v))) return false
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number)
  const s = Number(m[6] ?? '0')
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return false
  if (d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return false
  return m[7] === undefined || (Number(m[7]) <= 23 && Number(m[8]) <= 59)
}

function fieldOk(field: (typeof C0_FIELDS)[number], v: unknown): boolean {
  if (field === 'hold_from' || field === 'hold_until') return v === null || isInstant(v)
  if (field === 'holds_managed') return typeof v === 'boolean'
  return isNonNegInt(v) && v <= INT4_MAX
}

/**
 * Reads (never strips) the four C0 fields; throws FIELD_MISSING / FIELD_TYPE.
 * The envelope is both NULL or both instants, and never inverts (order § 4 (g), OR-5).
 */
export function readC0Fields(appointment: unknown): C0AppointmentFields {
  if (!isRecord(appointment)) throw new C0ContractError({ code: 'FIELD_TYPE', field: 'appointment', detail: 'not an object' })
  for (const f of C0_FIELDS) {
    if (!(f in appointment)) throw new C0ContractError({ code: 'FIELD_MISSING', field: f })
    if (!fieldOk(f, appointment[f])) throw new C0ContractError({ code: 'FIELD_TYPE', field: f })
  }
  const from = appointment.hold_from as string | null
  const until = appointment.hold_until as string | null
  if ((from === null) !== (until === null)) {
    throw new C0ContractError({ code: 'FIELD_TYPE', field: 'hold_until', detail: 'hold_from and hold_until must both be null or both be set' })
  }
  if (from !== null && until !== null && Date.parse(until) < Date.parse(from)) {
    throw new C0ContractError({ code: 'FIELD_TYPE', field: 'hold_until', detail: 'the envelope inverts' })
  }
  return {
    hold_from: from,
    hold_until: until,
    holds_managed: appointment.holds_managed as boolean,
    revision: appointment.revision as number,
  }
}

/** True only when all four fields are present and typed (an old-core row → false). */
export function hasC0Fields(appointment: unknown): boolean {
  try {
    readC0Fields(appointment)
    return true
  } catch (e) {
    if (e instanceof C0ContractError) return false
    throw e
  }
}

// ── (c) the overlap read ────────────────────────────────────────────────────

/** OPAQUE: the reader never parses or builds one; it only passes `next_cursor` back. */
export type C0Cursor = string & { readonly __brand: 'C0Cursor' }

/** Cannot express `from`, `to` or `page`: a forbidden combination is unsendable. */
export type OverlapParams = {
  overlaps_from: string
  overlaps_to: string
  store_id?: string
  status_not?: string
  page_size?: number
  cursor?: C0Cursor
}

export type OverlapPage = {
  appointments: unknown[]
  total: number
  page: 1
  page_size: number
  next_cursor: C0Cursor | null
}

const OVERLAP_KEYS = ['appointments', 'total', 'page', 'page_size', 'next_cursor'] as const

function failOn(status: number, json: unknown): never {
  if (status === 400) {
    const error = isRecord(json) && typeof json.error === 'string' ? json.error : ''
    throw new C0ContractError({ code: 'BAD_REQUEST', error })
  }
  throw new C0ContractError({ code: 'HTTP', status })
}

export async function listOverlaps(http: CoreHttp, params: OverlapParams): Promise<OverlapPage> {
  const query: Record<string, string | number | undefined> = {
    overlaps_from: params.overlaps_from,
    overlaps_to: params.overlaps_to,
    store_id: params.store_id,
    status_not: params.status_not,
    page_size: params.page_size,
    cursor: params.cursor,
  }
  const { status, json } = await http.request('GET', '/v1/appointments', { query })
  if (status !== 200) failOn(status, json)
  if (!isRecord(json)) throw new C0ContractError({ code: 'SHAPE', detail: 'body is not an object' })
  // Strict both ways: exactly these five keys (README "one rule for envelopes").
  const keys = Object.keys(json).sort()
  if (keys.length !== OVERLAP_KEYS.length || !OVERLAP_KEYS.every((k) => k in json)) {
    throw new C0ContractError({ code: 'SHAPE', detail: `keys ${keys.join(',')}` })
  }
  const rows = json.appointments
  if (!Array.isArray(rows)) throw new C0ContractError({ code: 'SHAPE', detail: 'appointments' })
  if (!isNonNegInt(json.total)) throw new C0ContractError({ code: 'SHAPE', detail: 'total' })
  if (json.total < rows.length) throw new C0ContractError({ code: 'SHAPE', detail: 'total is below the rows on the page' })
  if (json.page !== 1) throw new C0ContractError({ code: 'SHAPE', detail: 'page !== 1' })
  if (!isNonNegInt(json.page_size) || json.page_size < 1) throw new C0ContractError({ code: 'SHAPE', detail: 'page_size' })
  const next = json.next_cursor
  if (next !== null && typeof next !== 'string') throw new C0ContractError({ code: 'SHAPE', detail: 'next_cursor' })
  if (next === '') throw new C0ContractError({ code: 'SHAPE', detail: 'next_cursor empty' })
  if (next !== null && rows.length === 0) throw new C0ContractError({ code: 'SHAPE', detail: 'a cursor with an empty page' })
  const ids = new Set<string>()
  for (const row of rows) {
    readC0Fields(row)
    const id = (row as Record<string, unknown>).id
    if (typeof id !== 'string') throw new C0ContractError({ code: 'SHAPE', detail: 'a row without a string id' })
    if (ids.has(id)) throw new C0ContractError({ code: 'SHAPE', detail: `id ${id} repeated on the page` })
    ids.add(id)
  }
  return {
    appointments: rows,
    total: json.total,
    page: 1,
    page_size: json.page_size,
    next_cursor: next as C0Cursor | null,
  }
}

/** A walk that has not ended after this many pages is a contract break, never an endless loop. */
export const WALK_PAGE_CAP = 1000

/**
 * Every page until `next_cursor === null` — the same params plus the cursor each time.
 * SHAPE on a repeated cursor, an id seen on an earlier page, or more than WALK_PAGE_CAP pages.
 */
export async function* walkOverlaps(http: CoreHttp, params: Omit<OverlapParams, 'cursor'>): AsyncGenerator<OverlapPage> {
  const seenCursors = new Set<string>()
  const seenIds = new Set<string>()
  let cursor: C0Cursor | undefined
  for (let n = 1; ; n++) {
    if (n > WALK_PAGE_CAP) throw new C0ContractError({ code: 'SHAPE', detail: `more than ${WALK_PAGE_CAP} pages` })
    const page = await listOverlaps(http, cursor !== undefined ? { ...params, cursor } : params)
    if (page.next_cursor !== null) {
      if (seenCursors.has(page.next_cursor)) throw new C0ContractError({ code: 'SHAPE', detail: 'next_cursor repeated' })
      seenCursors.add(page.next_cursor)
    }
    for (const row of page.appointments) {
      const id = (row as { id: string }).id
      if (seenIds.has(id)) throw new C0ContractError({ code: 'SHAPE', detail: `id ${id} repeated across the walk` })
      seenIds.add(id)
    }
    yield page
    if (page.next_cursor === null) return
    cursor = page.next_cursor
  }
}

// ── (d) the switch registry (read only — no PUT is exposed) ─────────────────

export const SWITCH_KEYS = ['holds', 'allocator', 'status_rules', 'cleanup', 'money_settle', 'availability'] as const
export type SwitchKey = (typeof SWITCH_KEYS)[number]
export const SWITCH_STATES = ['OFF', 'SHADOW', 'ON', 'DRAINING', 'PAUSED'] as const
export type SwitchState = (typeof SWITCH_STATES)[number]
export type SwitchRead = { generation: number; switches: Record<SwitchKey, SwitchState> }

function parseSwitches(status: number, json: unknown): SwitchRead {
  if (status !== 200) failOn(status, json)
  if (!isRecord(json) || !isNonNegInt(json.generation) || !isRecord(json.switches)) {
    throw new C0ContractError({ code: 'SHAPE', detail: 'switch read body' })
  }
  // Strict both ways: exactly {generation, switches}, and exactly the six keys.
  if (Object.keys(json).sort().join(',') !== 'generation,switches') {
    throw new C0ContractError({ code: 'SHAPE', detail: `keys ${Object.keys(json).sort().join(',')}` })
  }
  const raw = json.switches
  const extra = Object.keys(raw).find((k) => !(SWITCH_KEYS as readonly string[]).includes(k))
  if (extra !== undefined) throw new C0ContractError({ code: 'SHAPE', field: extra })
  const out = {} as Record<SwitchKey, SwitchState>
  // Core serves every key; a missing key is a contract break, never a door-local default.
  for (const k of SWITCH_KEYS) {
    const v = raw[k]
    if (typeof v !== 'string' || !(SWITCH_STATES as readonly string[]).includes(v)) {
      throw new C0ContractError({ code: 'SHAPE', field: k })
    }
    out[k] = v as SwitchState
  }
  return { generation: json.generation, switches: out }
}

export async function readStoreSwitches(http: CoreHttp, storeId: string): Promise<SwitchRead> {
  const { status, json } = await http.request('GET', `/v1/stores/${encodeURIComponent(storeId)}/switches`)
  return parseSwitches(status, json)
}

export async function readStoreLessSwitches(http: CoreHttp): Promise<SwitchRead> {
  const { status, json } = await http.request('GET', '/v1/switches')
  return parseSwitches(status, json)
}

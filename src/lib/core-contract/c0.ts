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
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInstantOrNull = (v: unknown) => v === null || (typeof v === 'string' && ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v)))
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

function fieldOk(field: (typeof C0_FIELDS)[number], v: unknown): boolean {
  if (field === 'hold_from' || field === 'hold_until') return isInstantOrNull(v)
  if (field === 'holds_managed') return typeof v === 'boolean'
  return isNonNegInt(v)
}

/** Reads (never strips) the four C0 fields; throws FIELD_MISSING / FIELD_TYPE. */
export function readC0Fields(appointment: unknown): C0AppointmentFields {
  if (!isRecord(appointment)) throw new C0ContractError({ code: 'SHAPE', detail: 'appointment is not an object' })
  for (const f of C0_FIELDS) {
    if (!(f in appointment)) throw new C0ContractError({ code: 'FIELD_MISSING', field: f })
    if (!fieldOk(f, appointment[f])) throw new C0ContractError({ code: 'FIELD_TYPE', field: f })
  }
  return {
    hold_from: appointment.hold_from as string | null,
    hold_until: appointment.hold_until as string | null,
    holds_managed: appointment.holds_managed as boolean,
    revision: appointment.revision as number,
  }
}

/** True only when all four fields are present and typed (an old-core row → false). */
export function hasC0Fields(appointment: unknown): boolean {
  return isRecord(appointment) && C0_FIELDS.every((f) => f in appointment && fieldOk(f, appointment[f]))
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
  const keys = Object.keys(json).sort()
  if (keys.length !== OVERLAP_KEYS.length || !OVERLAP_KEYS.every((k) => k in json)) {
    throw new C0ContractError({ code: 'SHAPE', detail: `keys ${keys.join(',')}` })
  }
  if (!Array.isArray(json.appointments)) throw new C0ContractError({ code: 'SHAPE', detail: 'appointments' })
  if (!isNonNegInt(json.total)) throw new C0ContractError({ code: 'SHAPE', detail: 'total' })
  if (json.page !== 1) throw new C0ContractError({ code: 'SHAPE', detail: 'page !== 1' })
  if (!isNonNegInt(json.page_size)) throw new C0ContractError({ code: 'SHAPE', detail: 'page_size' })
  if (json.next_cursor !== null && typeof json.next_cursor !== 'string') {
    throw new C0ContractError({ code: 'SHAPE', detail: 'next_cursor' })
  }
  return {
    appointments: json.appointments,
    total: json.total,
    page: 1,
    page_size: json.page_size,
    next_cursor: json.next_cursor as C0Cursor | null,
  }
}

/** Every page until `next_cursor === null` — the same params plus the cursor each time. */
export async function* walkOverlaps(http: CoreHttp, params: Omit<OverlapParams, 'cursor'>): AsyncGenerator<OverlapPage> {
  let cursor: C0Cursor | undefined
  for (;;) {
    const page = await listOverlaps(http, cursor ? { ...params, cursor } : params)
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
  const raw = json.switches
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

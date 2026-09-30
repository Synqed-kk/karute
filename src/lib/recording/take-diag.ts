// PR-B commit 5 (build 32) — the take's own flight record (B5, B-S66-1, K-2).
// A LEAF with no imports: the phone never imports zod or the server schema
// (B5). What leaves the phone is ONLY the 12 TakeDiag keys the server already
// accepts (record-schemas.ts TakeDiagSchema), mirrored here with their bounds;
// prb-flight-record.test.ts pins both to the schema, so a drift fails a test,
// never the field. A diag that does not pass these bounds is OMITTED — never
// sent (A13: 「send a valid diag or none」).

/** The 12 keys of `TakeDiagSchema`, in its order (K-2). */
export const TAKE_DIAG_KEYS = [
  'arm',
  'seq_min',
  'seq_max',
  'seq_count',
  'seq0_present',
  'blob_bytes',
  'first_byte',
  'store_error_count',
  'pump_stop_code',
  'hidden_count',
  'freeze_count',
  'session_null_count',
] as const
export type TakeDiagKey = (typeof TAKE_DIAG_KEYS)[number]

/** The server's bounds, mirrored (record-schemas.ts DIAG_MAX_* / DIAG_CODE_*). */
export const PHONE_DIAG_MAX_SEQ = 999_999
export const PHONE_DIAG_MAX_SEQ_COUNT = 1_000_000
export const PHONE_DIAG_MAX_BLOB_BYTES = 2 * 1024 * 1024 * 1024
export const PHONE_DIAG_MAX_BYTE_VALUE = 255
export const PHONE_DIAG_MAX_EVENT_COUNT = 999_999
export const PHONE_DIAG_CODE_MAX_CHARS = 16
export const PHONE_DIAG_CODE_PATTERN = /^[a-z0-9_]+$/

/** The local ring's bounds (packet P:80): entries kept, newest last; an
 *  entry larger than its byte ceiling is not kept at all. */
export const DIAG_RING_MAX_ENTRIES = 64
export const DIAG_ENTRY_MAX_BYTES = 64

/** A ring entry: when, and a short code. Codes + numbers only. */
export type DiagRingEntry = { at: number; code: 'hidden' | 'freeze' | 'store_error' }

export type PhoneTakeDiag = {
  arm?: 'stored' | 'memory'
  seq_min?: number
  seq_max?: number
  seq_count?: number
  seq0_present?: boolean
  blob_bytes?: number
  first_byte?: number
  store_error_count?: number
  pump_stop_code?: string
  hidden_count?: number
  freeze_count?: number
  session_null_count?: number
}

export function pushDiagEntry(ring: readonly DiagRingEntry[] | undefined, entry: DiagRingEntry): DiagRingEntry[] {
  const next = [...(ring ?? [])]
  if (JSON.stringify(entry).length > DIAG_ENTRY_MAX_BYTES) return next
  next.push(entry)
  return next.length > DIAG_RING_MAX_ENTRIES ? next.slice(next.length - DIAG_RING_MAX_ENTRIES) : next
}

const INT_MAX: Partial<Record<TakeDiagKey, number>> = {
  seq_min: PHONE_DIAG_MAX_SEQ,
  seq_max: PHONE_DIAG_MAX_SEQ,
  seq_count: PHONE_DIAG_MAX_SEQ_COUNT,
  blob_bytes: PHONE_DIAG_MAX_BLOB_BYTES,
  first_byte: PHONE_DIAG_MAX_BYTE_VALUE,
  store_error_count: PHONE_DIAG_MAX_EVENT_COUNT,
  hidden_count: PHONE_DIAG_MAX_EVENT_COUNT,
  freeze_count: PHONE_DIAG_MAX_EVENT_COUNT,
  session_null_count: PHONE_DIAG_MAX_EVENT_COUNT,
}

/** The phone's own check before any send: ONLY the 12 keys are copied (every
 *  other field — bytesEmitted, endedBySystem, the ring — stays local by
 *  construction); one value out of bounds → undefined (omit the whole diag). */
export function validTakeDiag(d: Record<string, unknown>): PhoneTakeDiag | undefined {
  const out: Record<string, unknown> = {}
  for (const k of TAKE_DIAG_KEYS) {
    const v = d[k]
    if (v === undefined) continue
    const max = INT_MAX[k]
    const ok =
      max !== undefined
        ? Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max
        : k === 'arm'
          ? v === 'stored' || v === 'memory'
          : k === 'seq0_present'
            ? typeof v === 'boolean'
            : typeof v === 'string' &&
              v.length >= 1 &&
              v.length <= PHONE_DIAG_CODE_MAX_CHARS &&
              PHONE_DIAG_CODE_PATTERN.test(v)
    if (!ok) return undefined
    out[k] = v
  }
  return out as PhoneTakeDiag
}

/** The facts the secure leg holds → the diag it may send (then validated). */
export function buildTakeDiag(f: {
  arm: 'stored' | 'memory'
  blobBytes: number
  firstByte?: number
  lastSeq?: number
  ring?: readonly DiagRingEntry[]
}): PhoneTakeDiag | undefined {
  const count = (code: DiagRingEntry['code']) => f.ring?.filter((e) => e.code === code).length
  return validTakeDiag({
    arm: f.arm,
    blob_bytes: f.blobBytes,
    first_byte: f.firstByte,
    seq_max: f.arm === 'stored' && f.lastSeq !== undefined && f.lastSeq >= 0 ? f.lastSeq : undefined,
    hidden_count: count('hidden'),
    freeze_count: count('freeze'),
    store_error_count: count('store_error'),
  })
}

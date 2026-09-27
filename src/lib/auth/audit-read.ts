// The audit-log READ gate (PR B2 §4). Audit rows carry no store yet (⚖
// Liam 8/17 STORE ISOLATION LAW), so `audit.view` alone would let a
// branch-restricted holder read every store's rows — the gate is
// `audit.view` AND the all-stores marker until rows carry a store (a CORE
// ask, later). ONE helper so the read boundary (facade route + web
// listAuditLog) and the settings surfaces that decide whether to SHOW the
// 監査ログ section can never drift apart — a viewer who sees the tab must
// never then hit `forbidden` opening it.
import type { Capability } from './permissions'

export function canReadAuditLog(caps: Set<Capability>): boolean {
  return caps.has('audit.view') && caps.has('stores.viewAll')
}

/**
 * WHAT THE 監査ログ READ-OUT WITHHOLDS (S46 closure 1). A recording's storage
 * key is `app_<businessId>_<takeId>.<ext>` (key-grammar.ts composeTakeKey), and
 * the recording rows carry those ingredients — the take id, the file type, and
 * on a failed job the whole key — in `detail`. Handed to the client, they let
 * any 監査ログ reader rebuild a colleague's key byte for byte and walk it
 * through the four key-gated doors.
 *
 * READ-OUT ONLY, never at the write: the STORED rows keep every field, because
 * two server readers depend on them — the recordings inbox matches a capture
 * warning to its own row by `detail.take_id` (recordings/inbox-read.ts), and the
 * job worker recognises an already-empty take by `detail.audio_path`
 * (jobs/empty-transcript-memory.ts). Both read core directly, never through the
 * two doors that apply this (web listAuditLog, the phone audit-log route).
 *
 * No surface renders any of these keys (AuditLogSection reads other fields
 * only), so nothing a reader sees changes. Top-level only: detail is flat by the
 * ids-only law. Rows without any of them pass through as the same object.
 */
const READ_OUT_WITHHELD_DETAIL_KEYS = ['take_id', 'row_take_id', 'ext', 'audio_path'] as const

export function withholdKeyIngredients<E extends { detail: unknown }>(events: readonly E[]): E[] {
  return events.map((e) => {
    const d = e.detail
    if (!d || typeof d !== 'object' || Array.isArray(d)) return e
    if (!READ_OUT_WITHHELD_DETAIL_KEYS.some((k) => k in d)) return e
    const kept = { ...(d as Record<string, unknown>) }
    for (const k of READ_OUT_WITHHELD_DETAIL_KEYS) delete kept[k]
    return { ...e, detail: kept }
  })
}

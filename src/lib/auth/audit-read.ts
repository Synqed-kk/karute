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
 * WHAT THE 監査ログ READ-OUT WITHHOLDS (S46): a take's storage key is
 * `app_<businessId>_<takeId>.<ext>`, and recording rows carry its ingredients
 * (take id, file type, on a failed job the whole key) in `detail`.
 * READ-OUT ONLY: stored rows keep them — the recordings inbox matches capture
 * warnings by `detail.take_id` and the worker's empty-transcript memory reads
 * `detail.audio_path`, both straight from core. No surface renders these keys.
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

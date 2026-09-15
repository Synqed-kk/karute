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

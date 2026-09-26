// The ONE switch registry for the カルテ list — the karute copy of
// src/lib/recording/recording-switches.ts (itself the copy of
// src/lib/appointments/booking-switches.ts). Plain constants — no env, no
// settings read: a flip is a one-line PR through the normal gate. These are
// CLIENT-side switches (read by KaruteRecordListView), so a flip reaches the web
// with its deploy and the phone only with its next bake. Both states are pinned
// by tests. Every switch is honest when OFF: nothing it gates half-runs.
export const KARUTE_SWITCHES = {
  /** The 新規 chip on the カルテ tab's chip row (案C+, ⚖ Liam 9/26): a toggle
   *  that narrows the list to rows core marks as the customer's FIRST VISIT
   *  anywhere in the business (⚖ Liam 9/26 00:3x + 00:4x — 「New to the
   *  company」, never per store). It reads ONE field, the core-computed
   *  `company_first_visit` (→ KaruteListItem.companyFirstVisit): only `true` is
   *  新規; `false` and `null` (core did not compute it) never are. Its count
   *  tallies the rows its own tap would reveal (⚖ 8/25). The app derives
   *  nothing itself — the per-row as-of check lives in core.
   *
   *  OFF = the screen renders exactly as PR-1 (no chip; the field is mapped but
   *  unread).
   *
   *  Flip conditions — all must hold before this is turned ON:
   *  1. Core returns `company_first_visit` on every karute list row in
   *     production — checked with one read of the Dev Salon rows, the exit
   *     shown in the flip PR.
   *  2. The core ticket to Anthony (the per-row as-of first-visit flag) is
   *     marked Done.
   *  3. The facade twin `/api/app/v1/karute/window` carries the field too.
   *  4. Fold 4 — the 顧客 tab's 新規 pill renamed/redefined so the two 新規
   *     nest instead of naming disjoint sets — has its own ruling from Liam.
   *  5. Liam's word for the flip.
   *
   *  Flip history: (none) */
  shinkiChip: false,
} as const

// LIFTED + ADAPTED FROM SPIKE
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/mock/karute-list.ts
//
// Karute-list item shape — one entry per karute record (session),
// flattened with the customer + staff info already joined so the row
// component renders without further lookups.
//
// `aiStatus` is derived from the record's data (summary +
// transcript) rather than stored as its own column for now:
//   - has summary           → 'summarized'
//   - has transcript only   → 'pending'   (AI summary not generated)
//   - has neither           → 'draft'
//   - 'needsReview' is a future status — needs a per-record review
//     flag on the schema. ANTHONY: add `karute_records.review_needed
//     boolean` to surface this in real data. Until that lands, the
//     "レビュー要" filter chip is omitted from FILTER_KEYS in
//     KaruteRecordListView so it doesn't render as a perpetually-
//     empty pill (would have read "レビュー要 0" forever). The
//     union member + i18n key + chip style stay so adding the
//     column re-lights the filter automatically.
//
// `conversionStatus` is best-effort:
//   - record has ≥1 entry → 'active'
//   - record with no entries → 'provisional' (仮カルテ — placeholder
//     for a session that hasn't been entered up yet)
// In production, salons may want to flip this manually. ANTHONY:
// add `karute_records.conversion_status text` if you want explicit
// control vs derived.

export type KaruteAiStatus =
  | 'summarized'
  | 'pending'
  | 'needsReview'
  | 'draft'

export type KaruteConversionStatus = 'active' | 'provisional'

export interface KaruteListItem {
  id: string
  customerId: string
  customerName: string
  customerInitials: string
  customerKaruteNumber: string
  /** YYYY-MM-DD for date-grouping; rendered separately as a locale-
   *  aware string. */
  date: string
  weekday: string
  service: string
  /** Minutes. Falls back to 0 if unknown. */
  duration: number
  staffId: string | null
  /** Distinct staff color, resolved from the full roster on the page
   *  (karute/page.tsx via assignStaffColors). The row's avatar + stripe read
   *  this through getStaffColorByKey — never a per-id hash — so a stylist's
   *  color matches every other surface. Null → neutral fallback. */
  staffColorKey: import('@/lib/staff-colors').StaffColor['key'] | null
  staffName: string
  summary: string
  aiStatus: KaruteAiStatus
  conversionStatus: KaruteConversionStatus
  /** Retained ledger row. It is visible but never navigable/actionable. */
  isDiscarded?: boolean
  /** D10 (PR-C, self-lighting): true when the row's recording session carries
   *  a `shared_at`. Absent/false → no row chip, ever. WHO sees the chip is a
   *  SEPARATE question decided by the caller (KaruteListRow's
   *  viewerHoldsViewShared + currentStaffId props) — this flag only states
   *  the fact that a share exists. */
  isShared?: boolean
  /** Tap target. Real records link to `/karute/{recordId}`; placeholder
   *  rows for customers with no records link to
   *  `/karute/customer/{customerId}`. Caller (page) decides. */
  href: string
  /** When `true`, this row represents a customer with NO karute record
   *  yet (synthesized so brand-new customers still appear on the list,
   *  per Liam's "new customers should show up in カルテ" ask). View
   *  renders these in a separate section below the real records. */
  isPlaceholder?: boolean
}

export type KaruteListFilter =
  | 'all'
  | 'thisWeek'
  | 'aiPending'
  | 'needsReview'
  | 'draft'
  | 'discarded'
  // D10 (PR-C): self-lighting — only appended to the visible filter row when
  // sharedCount !== undefined AND the viewer holds recordings.viewShared (see
  // KaruteRecordListView's computed filterKeys). The union member stays here
  // unconditionally so counts/i18n type-check whether or not it is offered.
  | 'shared'

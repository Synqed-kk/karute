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
//     boolean` to surface this in real data.
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
  staffName: string
  summary: string
  aiStatus: KaruteAiStatus
  conversionStatus: KaruteConversionStatus
}

export type KaruteListFilter =
  | 'all'
  | 'thisWeek'
  | 'aiPending'
  | 'needsReview'
  | 'draft'

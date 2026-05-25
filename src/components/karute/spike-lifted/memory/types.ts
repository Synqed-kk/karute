// LIFTED FROM SPIKE — types
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/mock/customer-memory.ts
// Trimmed to what the simplified karute lift needs. Full spike type
// has a richer history of edits + provenance per item; this version
// keeps just the fields the rendered card cares about so Anthony has
// a clean target shape to wire to the real `customer_memory_items`
// table.

export type MemoryCategory =
  | 'personal'
  | 'body'
  | 'preference'
  | 'goal'
  | 'lifestyle'

export type MemorySource = 'ai' | 'staff' | 'intake'

export interface MemoryItem {
  id: string
  category: MemoryCategory
  /** Short label — surfaces in talking-points + as the row's title. */
  label: string
  /** Free-form body. ~1-3 sentences. */
  body: string
  source: MemorySource
  /** ISO date for "captured at" display. */
  capturedAt: string
  /** When true, the item floats into the Talking Points block. */
  suggestTalkingPoint?: boolean
  /** When true, the item gets a pin icon next to the source label. */
  pinned?: boolean
}

export interface CustomerIntake {
  /** ISO date of first visit. */
  firstVisitAt: string
  /** Short fragments shown on the intake summary row.
   *  ex: ['Instagram経由', '定期メンテナンス希望'] */
  highlights: string[]
}

export interface CustomerMemory {
  customerId: string
  items: MemoryItem[]
  intake: CustomerIntake | null
  lastUpdatedAt: string
  /** Items added/updated in the most recent session. Drives the
   *  "今日のセッションで3件更新" badge. */
  updatedThisVisit: number
}

/**
 * Empty memory shell — the default state until Anthony wires the
 * real `customer_memory_items` table. Brand-new customers should see
 * the empty state ("まだメモリーがありません" / equivalent in EN), NOT
 * placeholder data that looks like AI already extracted things.
 *
 * Previous version of this file shipped a hardcoded "SAMPLE_MEMORY"
 * with Japanese-only inline content (愛犬ラグ, 京都旅行, etc.). That
 * was wrong on three counts: (1) it pretended AI had analyzed sessions
 * that never happened, (2) it ship-baked Japanese into the codebase,
 * (3) it made the empty-state code path untestable since it was never
 * the default. Deleted.
 *
 * ANTHONY: the memory data shape is intentionally locale-agnostic.
 * `item.label` / `item.body` / `intake.highlights` are free-form
 * strings stored in whatever language the customer/staff wrote them
 * in. When you wire the real table, the component renders the
 * stored strings unchanged — JP, EN, ZH, anything works.
 */
export const EMPTY_MEMORY: CustomerMemory = {
  customerId: '',
  intake: null,
  lastUpdatedAt: new Date().toISOString(),
  updatedThisVisit: 0,
  items: [],
}

import type { EntryCategory } from '@/lib/karute/categories'

/**
 * A single entry in a karute record.
 * AI-extracted entries have sourceQuote and confidenceScore.
 * Manually added entries have isManual=true and no confidence score.
 */
export type Entry = {
  id: string
  category: EntryCategory
  /** The extracted or manually entered text content for this entry */
  content: string
  /** Verbatim excerpt from the transcript that supports this entry (AI entries only) */
  sourceQuote: string | null
  /** AI confidence score 0.0–1.0 (null for manual entries) */
  confidenceScore: number | null
  /** True if the entry was added manually by staff after AI extraction */
  isManual: boolean
  createdAt: string
  karuteRecordId: string
}

/**
 * A persisted karute record.
 * Links a customer and staff member to a session transcript + AI summary.
 */
export type KaruteRecord = {
  id: string
  createdAt: string
  summary: string
  transcript: string
  customerId: string
  staffId: string
  /** Session duration in seconds (optional — may not be captured in all recording modes) */
  duration: number | null
}

/**
 * Input shape for saveKaruteRecord Server Action.
 * Entries come from AI extraction (Phase 2) with category and content.
 *
 * Note: staffId is intentionally absent — the save action reads staff_id from
 * the active-staff cookie via getActiveStaffId(), never from client-supplied data.
 */
export type SaveKaruteInput = {
  customerId: string
  transcript: string
  summary: string
  entries: Array<{
    category: EntryCategory
    content: string
    sourceQuote?: string
    confidenceScore: number
  }>
  duration?: number
  appointmentId?: string
}

/**
 * Input shape for addManualEntry Server Action.
 * Manual entries only need category + content (no AI fields).
 */
export type AddEntryInput = {
  karuteRecordId: string
  category: EntryCategory
  content: string
}

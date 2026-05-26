// ─────────────────────────────────────────────────────────────
// Data-import — shared types
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: src/mock/import.ts
// Semantic English keys (customers / reservations / karute)
// instead of the spike's Japanese string IDs — labels are i18n'd
// per locale.

export type ImportScope = 'customers' | 'reservations' | 'karute'

export type ImportStatus =
  /** Edge function finished + rows committed. */
  | 'completed'
  /** Job in flight (chunks still uploading or being inserted). */
  | 'processing'
  /** Hard failure — mapper or validator rejected the file. */
  | 'failed'
  /** Pre-flight: file uploaded, schema mapping under owner review. */
  | 'validating'

export interface ImportRecord {
  id: string
  scope: ImportScope
  fileName: string
  /** Display string (e.g. "12.4 KB"). Spike pre-formats; prod
   *  can format from bytes at render. */
  fileSize: string
  /** Localized timestamp string. */
  importedAt: string
  /** Display name of staff who started the import. */
  importedBy: string
  status: ImportStatus
  /** Total rows the file contained. */
  recordCount: number
  /** Rows that successfully landed in the destination table. */
  successCount: number
  /** Rows the validator rejected. */
  errorCount: number
}

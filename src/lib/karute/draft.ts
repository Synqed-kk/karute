/**
 * sessionStorage helpers for the Phase 2 → Phase 4 karute save flow.
 *
 * The AI review screen (Phase 2) writes the draft; the save flow (Phase 4)
 * reads it, persists the record, then clears the draft.
 *
 * All functions are SSR-safe: they guard with `typeof window !== 'undefined'`
 * so they can be imported in Server Components without throwing.
 */

const DRAFT_KEY = 'karute_draft'
/** Discard drafts older than 1 hour to prevent stale data showing up */
const DRAFT_TTL_MS = 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KaruteDraftEntry = {
  category: string
  content: string
  sourceQuote?: string
  confidenceScore: number
}

export type KaruteDraft = {
  transcript: string
  summary: string
  entries: KaruteDraftEntry[]
  duration?: number
  appointmentId?: string
  /** Unix timestamp (ms) when the draft was saved */
  savedAt: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write draft data to sessionStorage.
 * Automatically stamps savedAt with the current timestamp.
 */
export function saveDraft(draft: Omit<KaruteDraft, 'savedAt'>): void {
  if (typeof window === 'undefined') return

  const payload: KaruteDraft = {
    ...draft,
    savedAt: Date.now(),
  }

  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
  } catch {
    // sessionStorage may be unavailable (private browsing quota, etc.)
    // Fail silently — the caller will see null on loadDraft
  }
}

/**
 * Read draft data from sessionStorage.
 * Returns null if:
 *   - sessionStorage is unavailable (SSR or disabled)
 *   - No draft exists
 *   - Draft is older than 1 hour (stale)
 *   - JSON parse fails (corrupt data)
 */
export function loadDraft(): KaruteDraft | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null

    const draft = JSON.parse(raw) as KaruteDraft

    // Discard stale drafts
    if (Date.now() - draft.savedAt > DRAFT_TTL_MS) {
      clearDraft()
      return null
    }

    return draft
  } catch {
    return null
  }
}

/**
 * Remove draft from sessionStorage.
 * Call this after the karute record has been successfully persisted.
 */
export function clearDraft(): void {
  if (typeof window === 'undefined') return

  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Fail silently
  }
}

/**
 * localStorage helpers for the Phase 2 → Phase 4 karute save flow.
 *
 * The AI review screen (Phase 2) writes the draft; the save flow (Phase 4)
 * reads it, persists the record, then clears the draft.
 *
 * WHY localStorage (packet-10 W3, verified on the iOS shell 2026-07-19): the
 * draft used to live in sessionStorage, which does NOT survive a WKWebView
 * process kill — the exact crash this recovery exists for. Probe evidence
 * (karute-phase2/reports/evidence/): after simctl terminate + relaunch,
 * sessionStorage came back EMPTY while localStorage survived. The payload is
 * string-sized (transcript + summary + entries), so localStorage is the right
 * store; the owner gate + 24 h TTL + logout wipe below carry the privacy
 * semantics that sessionStorage's auto-scoping used to approximate.
 *
 * PRIVACY (shared salon device): the draft holds a customer's transcript + AI
 * summary. A salon iPad is one long-lived WKWebView session shared by every
 * staff member who logs in, so an owner check lives at THIS layer — the single
 * choke point every caller (RecordPageView, SaveKaruteFlow) goes through — not
 * in each component, where one missed call site would reopen the leak. A draft
 * is stamped with the auth user who saved it and only ever returned to that
 * same user. clearDraft on logout (sidebar / profile sign-out) is the second
 * layer: the vault is wiped when a staff member leaves.
 *
 * All functions guard `typeof window !== 'undefined'` so they stay importable in
 * Server Components without throwing.
 */

import { createClient } from '@/lib/supabase/client'

const DRAFT_KEY = 'karute_draft'
/** Discard drafts older than 24 hours — long enough to survive a full day of sessions */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

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
  /** The booked customer, when the session was tied to an appointment — lets a
   *  recovered draft skip re-selecting the customer. Absent for walk-ins. */
  appointmentCustomerId?: string
  /** Server-minted recording_sessions id (synqed-core), carried through so a
   *  crash-recovered draft still saves with it — the whole point of this field
   *  is that RETRIED/RECOVERED saves dedupe too. Absent when the mint failed or
   *  hadn't resolved before the take reached review. */
  recordingSessionId?: string
  /** The persisted take (lib/karute/take-store) this draft came from, so the
   *  audio is deleted when the draft's save/discard settles the session —
   *  otherwise the take would be re-offered for an already-finished session
   *  until its TTL. Absent for pre-take drafts and when persistence failed. */
  takeId?: string
  /** Auth user id (Supabase auth.uid) of the staff member who saved this draft.
   *  Recovery is gated on it: only the same signed-in user is ever offered the
   *  draft, so a shared device can't surface staff A's customer transcript to
   *  staff B. Older drafts (pre-binding) have it absent → treated as un-owned →
   *  never restored. */
  savedByStaffId?: string
  /** Unix timestamp (ms) when the draft was saved */
  savedAt: number
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** The signed-in auth user id (== profiles.id), read locally from the session
 *  (no network). null when signed out or unavailable — a null-owner draft is
 *  never restorable, which fails closed for privacy. Exported for
 *  take-store.ts so both owner gates stamp the exact same identity. */
export async function currentUserId(): Promise<string | null> {
  try {
    const supabase = createClient()
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write draft data to localStorage. Stamps savedAt + the saving user's id.
 */
export async function saveDraft(
  draft: Omit<KaruteDraft, 'savedAt' | 'savedByStaffId'>,
): Promise<void> {
  if (typeof window === 'undefined') return

  const payload: KaruteDraft = {
    ...draft,
    savedByStaffId: (await currentUserId()) ?? undefined,
    savedAt: Date.now(),
  }

  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
  } catch {
    // localStorage may be unavailable (private browsing quota, etc.)
    // Fail silently — the caller will see null on loadDraft
  }
}

/**
 * Read draft data from localStorage. Returns null if:
 *   - localStorage is unavailable (SSR or disabled)
 *   - No draft exists
 *   - Draft is older than 24 hours (stale) — also cleared
 *   - JSON parse fails (corrupt data)
 *   - The draft was saved by a DIFFERENT user, or by none (privacy gate) —
 *     returned as null but NOT cleared, so its rightful owner can still recover
 *     it; it expires on its own via the TTL.
 */
export async function loadDraft(): Promise<KaruteDraft | null> {
  if (typeof window === 'undefined') return null

  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null

    const draft = JSON.parse(raw) as KaruteDraft

    // Discard stale drafts (any owner).
    if (Date.now() - draft.savedAt > DRAFT_TTL_MS) {
      clearDraft()
      return null
    }

    // Ownership gate: only the user who saved it may recover it. A mismatch (or
    // an un-owned legacy draft) is hidden, not deleted — deleting here would let
    // staff B destroy staff A's recoverable draft just by opening the page.
    const uid = await currentUserId()
    if (!draft.savedByStaffId || !uid || draft.savedByStaffId !== uid) {
      return null
    }

    return draft
  } catch {
    return null
  }
}

/**
 * Remove draft from localStorage. Call after a successful save, on explicit
 * discard, and on logout (wipe the vault when a staff member leaves the device).
 */
export function clearDraft(): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Fail silently
  }
}

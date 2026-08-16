// Discard reason vocabulary (recording-integrity spec §3.2) — the ONE source
// of truth for both halves of the discard path.
//
// Client-safe on purpose: ZERO imports, so the reason dialog (a client
// component that the thin Vite bundle builds) and the server schema can share
// one list. Its server sibling ./discard.ts cannot be that home — it imports
// @/lib/audit → next/server. Same split, same reason, as
// src/lib/karute/outcome-types.ts.
//
// The list is a CLOSED, VERSIONED vocabulary, not a copy list: it is the axis
// every discard statistic is cut by, so it may only change with a version bump
// and a stats note (§3.2).
//
//   STAFF_DISCARD_CATEGORIES — what the dialog offers, in display order.
//   `abandoned`             — SYSTEM-only (fix A8). No staff member ever picks
//                             it; it is written by take-TTL cleanup and the
//                             logout wipe (A3b), so it lives in the schema's
//                             DISCARD_CATEGORIES and nowhere else.
//   6 `customer_request` / 7 `other` — Phase B, deliberately absent: 6 needs
//                             the core-gated seal machinery, 7 needs a
//                             free-text home that does not exist yet (audit
//                             `detail` is ids/flags only, §10.1). Offering
//                             either before its machinery would promise what
//                             the product cannot do (§3.2 fix B7).

export const STAFF_DISCARD_CATEGORIES = [
  'mistap',
  'quality',
  'duplicate',
  'wrong_target',
  'not_session',
] as const

/** A reason a staff member can actually pick in the dialog. */
export type StaffDiscardCategory = (typeof STAFF_DISCARD_CATEGORIES)[number]

/** The full Phase-A vocabulary the discard receipt schema accepts — the staff
 *  categories plus the system-only `abandoned`. */
export const DISCARD_CATEGORIES = [...STAFF_DISCARD_CATEGORIES, 'abandoned'] as const

export type DiscardCategory = (typeof DISCARD_CATEGORIES)[number]

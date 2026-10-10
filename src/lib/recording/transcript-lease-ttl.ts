// ⚖ THE ONE LIFE OF THE "TRANSCRIBING NOW" LEASE (S53 A5, shared S54 B) — read
// by both sides. The server writes a lease that stops counting this long after
// it was taken (transcript-memo.ts, server-only); the client keeps re-asking a
// 409 "still transcribing" answer no longer than this plus one wait
// (ai-pipeline.ts — the web and the phone shell alike). One constant, never a
// second literal: a change here moves both. No imports, so either side loads it.

/** The function limit every paying door pins (`export const maxDuration = 300`,
 *  a literal Next.js reads statically; paying-doors-max-duration.test.ts holds
 *  each door to this value). */
export const TRANSCRIPT_PAYING_DOOR_MAX_DURATION_MS = 300_000

/** Longer than any holder can live: the 300 s function limit on every door. */
export const TRANSCRIPT_LEASE_TTL_MS = 330_000

/** ⚖ S116 round 4 (SF3) — THE TAKEOVER SKEW LIMIT: the TTL's margin over the
 *  door limit (330 − 300 = 30 s). A taker whose clock is ahead of a live
 *  holder's by more than this reads the holder's lease as expired and takes
 *  over — a time lease cannot stop that, whatever the reader bound says (the
 *  taker-side double pay at 31–61 s of skew is a named residual; the servers
 *  are NTP-synced). To tolerate more, raise the TTL (the client's 409 deadline
 *  moves with it). */
export const TRANSCRIPT_LEASE_TAKEOVER_SKEW_LIMIT_MS = TRANSCRIPT_LEASE_TTL_MS - TRANSCRIPT_PAYING_DOOR_MAX_DURATION_MS

/** ⚖ S58, restored S116 round 4 (SF3) — THE READER BOUND: how far past its own
 *  now + TTL a lease's expiry (or a claim's `at` past its own now) may lie and
 *  still be believed. DERIVED from the same set: two takeover limits (60 s).
 *  Wider than the takeover limit on purpose — a reader that disbelieves a live
 *  holder pays a second time in the holder's first seconds (the double-submit
 *  window the lease exists for), while a wide bound only lengthens a BOUNDED
 *  wait on a dead holder (at most TTL + this). Round 3's 29 s traded the first
 *  for the second and is reverted. */
export const TRANSCRIPT_LEASE_CLOCK_SKEW_MS = 2 * TRANSCRIPT_LEASE_TAKEOVER_SKEW_LIMIT_MS

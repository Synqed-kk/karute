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

/** ⚖ S115 round 3 (S3) — the clock-skew tolerance between servers, DERIVED:
 *  strictly under the TTL's margin over the door limit (330 − 300 = 30 s → 29 s).
 *  A clock ahead by more than that margin can take over a live holder whatever
 *  this says, so the tolerance never claims more than the margin delivers. To
 *  tolerate more skew, raise the TTL (the client's 409 deadline moves with it). */
export const TRANSCRIPT_LEASE_CLOCK_SKEW_MS = TRANSCRIPT_LEASE_TTL_MS - TRANSCRIPT_PAYING_DOOR_MAX_DURATION_MS - 1_000

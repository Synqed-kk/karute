// ⚖ THE ONE LIFE OF THE "TRANSCRIBING NOW" LEASE (S53 A5, shared S54 B) — read
// by both sides. The server writes a lease that stops counting this long after
// it was taken (transcript-memo.ts, server-only); the client keeps re-asking a
// 409 "still transcribing" answer no longer than this plus one wait
// (ai-pipeline.ts — the web and the phone shell alike). One constant, never a
// second literal: a change here moves both. No imports, so either side loads it.

/** Longer than any holder can live: the 300 s function limit on every door. */
export const TRANSCRIPT_LEASE_TTL_MS = 330_000

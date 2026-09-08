// The job worker's named failure reasons, in a THIN-SAFE home.
//
// `last_error` is a bare string on the core job row, and two very different
// programs read it: the worker writes it (process-recording.ts, which pulls
// server-only modules — the service client, the AI clients, the core SDK) and
// the phone's pipeline branches on it (global-pipeline.ts, which is baked into
// the thin bundle). Importing the constant from the worker would drag that
// whole server graph into the phone's build, so the word itself lives here,
// alone, with no other export and no imports at all.
//
// EMPTY_TRANSCRIPT and CONSENT_REQUIRED_ERROR predate this file and keep their
// own homes (the latter in lib/consent, which the phone already imports).

/** A staff member deliberately discarded this recording session, so no karute
 *  may be written from it — checked by the worker before consent and again
 *  right before the write (fix round 6, R1). TERMINAL in meaning: retrying
 *  cannot change a decision somebody already made and explained. */
export const DISCARDED_BY_STAFF = 'DISCARDED_BY_STAFF'

/** The business's transcription allowance is used up — core's rolling 24 h AI
 *  cost cap refused this job BEFORE a yen was spent (the spend wall, 2026-09-08).
 *  DETERMINISTIC TODAY, RETRYABLE TOMORROW: today's remaining attempts each cost
 *  one refused ledger read and no money, and core re-arms a FAILED job with
 *  attempts = 0 on the next enqueue — so 再試行 genuinely works once the window
 *  frees. ⚖ THE AUDIO STAYS, so nothing is lost while it waits. */
export const AI_SPEND_LIMIT = 'AI_SPEND_LIMIT'

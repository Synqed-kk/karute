// The job worker's named failure reasons, in a THIN-SAFE home.
//
// `last_error` is a bare string on the core job row, and two very different
// programs read it: the worker writes it (process-recording.ts, which pulls
// server-only modules — the service client, the AI clients, the core SDK) and
// the phone's pipeline branches on it (global-pipeline.ts, which is baked into
// the thin bundle). Importing the constant from the worker would drag that
// whole server graph into the phone's build, so the word itself lives here,
// with no imports at all.
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

/** The staff discard ledger read came back ambiguous (neither a clean
 *  'discarded' nor a clean 'not discarded' verdict) — the worker refuses to
 *  write a karute record rather than risk overwriting a decision it can't
 *  see (fix round 6, R1 fail-closed extension of DISCARDED_BY_STAFF above).
 *  RETRYABLE: a later attempt re-reads the ledger fresh. */
export const DISCARD_LEDGER_UNREADABLE = 'discard ledger row unreadable — refusing to write'

/** Core's spend ledger would not confirm the reserve write after three
 *  attempts, so the transcription never ran and no yen moved (the reserve,
 *  before any money moves) — auditTranscriptionRefused already filed the
 *  spend ledger's own refusal row (recording.transcribe_refused) for this
 *  exact throw. It is a refusal, not a failure: never a second row under
 *  recording.transcribe_failed for the same event. */
export const TRANSCRIPTION_LEDGER_UNAVAILABLE = 'transcription ledger unavailable'

/** Which of the worker's three paid-or-saving stages refused (the recording
 *  hole, PR-1, 2026-09-23): the job's `last_error` becomes
 *  `${code}: ${cause}` so 録音履歴 can name the step instead of a bare
 *  「保存されませんでした」, and the 監査ログ row carries the CODE only. `cause`
 *  is the thrown error's FIRST LINE only, capped at 200 chars (it bounds
 *  `last_error`) — an SDK/HTTP error string, never transcript text. The cause
 *  never enters an audit row: it lives only in `last_error` and the worker's
 *  console line. The sentinels above are never wrapped in this. */
export type StageFailureCode = 'transcription_failed' | 'ai_failed' | 'karute_save_failed'

export class StageFailure extends Error {
  readonly code: StageFailureCode
  readonly cause: string
  constructor(code: StageFailureCode, rawMessage: string) {
    const cause = rawMessage.split('\n', 1)[0].slice(0, 200)
    super(`${code}: ${cause}`)
    this.name = 'StageFailure'
    this.code = code
    this.cause = cause
  }
}

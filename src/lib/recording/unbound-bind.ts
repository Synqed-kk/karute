// How the row create for a SERVER-NAMED upload settles into the mint's answer
// (mint-take-url.ts, the `if (!input.takeId)` arm, switch ON). Pure: type
// imports only, so the whole table is testable with no mocks.
import type { StartRecordingSessionResult } from '@/lib/recording/session-mint'
import type { MintTakeUrlResult } from '@/lib/recording/mint-take-url'

type SignedUpload = { path: string; url: string; token: string; contentType: string }

/**
 * The rule: the sign has already succeeded, so every failure gives the caller
 * exactly today's answer (signed, bound to no row) and the audio still lands —
 * never worse than before. ONE answer withholds the link: `exists`. The key
 * already holds someone else's bytes, so the PUT would 409, and the ports read
 * a 409 as a landing (mint-take-url.ts:669-671) — the audio would be dropped
 * without a word. `upstream` is retryable, and the retry draws a new uuid.
 *
 *   { id }                → bound: the row's id rides back
 *   { error: 'exists' }   → { error: 'upstream' }, no url
 *   { error: 'bad_input'} → today's answer (composer/parser drift only)
 *   { error: 'upstream' } → today's answer (storage could not say)
 *   null                  → today's answer (unreachable with a take id)
 *   (a thrown create is caught in the mint, today's answer)
 */
export function settleUnboundBind(
  result: StartRecordingSessionResult,
  signed: SignedUpload,
): MintTakeUrlResult {
  if (result && 'id' in result) return { ...signed, recordingSessionId: result.id }
  if (result?.error === 'exists') return { error: 'upstream' }
  return { ...signed, recordingSessionId: null }
}

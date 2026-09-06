/**
 * Shared fixtures for the recording storage-key grammar
 * (src/lib/recording/key-grammar.ts).
 *
 * The EXHAUSTIVE 16-row table stays with the fence's own suite
 * (recording-upload-actions.test.ts), where it still proves the grammar end to
 * end through requireOwnPath. These are ONE row per grammar class, so each of
 * the three service-role call sites can prove it delegates to the shared helper
 * AND answers with its OWN error contract, without restating that whole table.
 *
 * Split down the middle on purpose: rows 1-4 fail on the PREFIX (a bare
 * `startsWith` refused these too — the no-regression half), rows 5-8 carry the
 * caller's OWN prefix and fail on the body or suffix (a bare `startsWith`
 * ACCEPTED every one — the half that proves the upgrade landed here). Row 9 is
 * the 2026-09-03 addition: a key that is genuinely this tenant's and genuinely
 * PARSES, and is still refused everywhere, because every one of these fences
 * means a whole TAKE and a segment is a fragment of one.
 */
export const TAKE_UUID_FIXTURE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'

/** The one shape mintRecordingUploadUrl (and the upload-url facade) composes. */
export const conformingKey = (businessId: string) =>
  `app_${businessId}_${TAKE_UUID_FIXTURE}.webm`

/** A valid SEGMENT of that same take — parses, but is not a take. */
export const segmentKey = (businessId: string, seq = '000000', ext = 'webm') =>
  `seg/app_${businessId}_${TAKE_UUID_FIXTURE}/${seq}.${ext}`

/** ⚖ THE NIGHTLY JOB'S RESCUE of that same take (Liam 2026-09-06, "b") — the
 *  take key one prefix further left. It parses, it is genuinely this tenant's,
 *  and every door where the path is a CLIENT'S CLAIM still refuses it: no
 *  client ever needs to name one, because the two SERVER-DERIVED doors that
 *  reach a rescue (the worker's payload re-check, the discard door's audio
 *  path) derive it themselves. */
export const rescueKey = (businessId: string, ext = 'webm') =>
  `rsc/app_${businessId}_${TAKE_UUID_FIXTURE}.${ext}`

export const refusedKeys = (businessId: string): [string, string][] => [
  ['another business’s object', `app_other-biz_${TAKE_UUID_FIXTURE}.webm`],
  ['a prefix-lookalike', `app_${businessId}0_${TAKE_UUID_FIXTURE}.webm`],
  ['a legacy untenanted rec_* key', `rec_${TAKE_UUID_FIXTURE}.webm`],
  ['a traversal attempt', `../app_${businessId}_${TAKE_UUID_FIXTURE}.webm`],
  ['a case-shifted extension', `app_${businessId}_${TAKE_UUID_FIXTURE}.WEBM`],
  ['a separator in the unique part', `app_${businessId}_/../x.webm`],
  ['no unique part at all', `app_${businessId}_.webm`],
  ['a query suffix', `app_${businessId}_${TAKE_UUID_FIXTURE}.webm?download=1`],
  ['this business’s own SEGMENT — parses, but is not a take', segmentKey(businessId)],
  // ⚖ 2026-09-06 ("b"): the assembler's own rescue of this tenant's take. It
  // parses, it belongs here, and every CLIENT-NAMED door still refuses it —
  // isOwnRecordingKey did not widen when the grammar did.
  ['this business’s own RESCUE — parses, and is still not a take', rescueKey(businessId)],
]

/**
 * Not a string, but string-SHAPED: every method the grammar calls answers
 * conformingly. A server action's argument is caller-supplied JSON, so the
 * `string` annotation proves nothing at runtime — the guard must refuse this
 * before it invokes a single one of these.
 */
export const IMPOSTOR_KEY = {
  startsWith: () => true,
  endsWith: () => true,
  slice: () => TAKE_UUID_FIXTURE,
} as unknown as string

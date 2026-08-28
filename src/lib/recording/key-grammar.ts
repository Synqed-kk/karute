// Storage-key grammar for the `recordings` bucket — the ONE place the app's
// entry points decide whether a caller-supplied key is this tenant's own take.
//
// One deliberate exception, not a second grammar: the job worker
// (src/lib/jobs/process-recording.ts, a frozen file) keeps its own
// `app_<businessId>_` prefix check as an in-file last line of defense right
// before its service-role read + delete. Both doors that can enqueue a job are
// fenced by THIS predicate, so no new job row can carry a key the grammar would
// refuse; the worker's check is defense in depth over rows already in the queue.
//
// Every consumer of such a key reaches the object through a SERVICE-ROLE client
// (no RLS), so this predicate is all that stands between a caller and another
// tenant's audio. It used to be a bare prefix check at each site, which let
// through anything that merely STARTED with the tenant prefix — a separator, a
// traversal body, a query suffix, a string-shaped non-string.
//
// A minted key is the ONLY legitimate source of one (mintRecordingUploadUrl in
// src/actions/recording-upload.ts and the upload-url facade twin compose it
// byte-identically), and it has exactly one shape, so the grammar is matched
// POSITIVELY and anything else is refused:
//
//     app_<businessId>_<lowercase uuid>.webm
//
// Flat — no directory segment — because /api/cleanup lists the bucket root
// non-recursively and would never see a nested orphan.

const TAKE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * True only when `key` is EXACTLY a recording key minted for `businessId`.
 *
 * `key` is typed `unknown` on purpose: every call site receives it from
 * caller-supplied JSON (a server-action argument or a request body), so a
 * `string` annotation would prove nothing at runtime — the typeof guard runs
 * first, before any method on `key` is invoked.
 */
export function isOwnRecordingKey(key: unknown, businessId: string): key is string {
  const prefix = `app_${businessId}_`
  const suffix = '.webm'
  return (
    typeof key === 'string' &&
    key.startsWith(prefix) &&
    key.endsWith(suffix) &&
    TAKE_UUID.test(key.slice(prefix.length, -suffix.length))
  )
}

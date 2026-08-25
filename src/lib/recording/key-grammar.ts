// Storage-key grammar for the `recordings` bucket — the ONE place that decides
// whether a caller-supplied key is this tenant's own take.
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
export function isOwnRecordingKey(key: unknown, businessId: string): boolean {
  const prefix = `app_${businessId}_`
  const suffix = '.webm'
  return (
    typeof key === 'string' &&
    key.startsWith(prefix) &&
    key.endsWith(suffix) &&
    TAKE_UUID.test(key.slice(prefix.length, -suffix.length))
  )
}

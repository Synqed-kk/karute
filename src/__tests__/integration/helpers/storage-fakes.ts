/**
 * The service-role STORAGE double's signing leg, shared by every suite that
 * reaches the recording mint (recording-upload-actions · app-api-recording-
 * finalize · app-api-recording-consent · actor-bearer-forwarding ·
 * mint-take-already-there).
 *
 * ONE RULE LIVES HERE, and it is the one no inline fake had: the mint signs
 * WITHOUT upsert (mint-take-url.ts#signUpload), and a non-upsert sign is a
 * CREATE — so storage REFUSES it for a key the bucket already holds (the
 * unique (bucket_id, name) behind storage's own `canUpload`). Every fake
 * signed unconditionally, which is exactly how the take mint shipped without
 * an already-there arm and passed its whole suite anyway (2026-09-05 root
 * cause #3 — the same class as root causes #1 and #2).
 *
 * THE REFUSAL'S SHAPE IS storage-js's, not the server's raw body
 * (@supabase/storage-js src/lib/common/fetch.ts#handleError builds
 * src/lib/common/errors.ts#StorageApiError): only `message`, the HTTP
 * `status` and the body's `statusCode` survive onto the error object the app
 * receives — the body's own `error: 'Duplicate'` field does NOT, so a fake
 * carrying one would answer a shape the real client cannot produce. HTTP 400
 * with statusCode '409' is the demotion storage answers a duplicate with, and
 * the same one storage-put.ts#putSaysAlreadyThere reads at the PUT.
 */
export const DUPLICATE_KEY_ERROR = {
  name: 'StorageApiError',
  message: 'The resource already exists',
  status: 400,
  statusCode: '409',
}

export type FakeSignedUpload = {
  data: { path: string; signedUrl: string; token: string } | null
  error: { name?: string; message: string; status?: number; statusCode?: string } | null
}

/**
 * `held` is the suite's OWN object store — the keys its `info` double answers
 * "an object is there" for. The signed URL stays the suite's, because several
 * of them assert on the exact string they hand back.
 */
export function fakeCreateSignedUploadUrl(
  held: ReadonlySet<string>,
  signedUrl: (path: string) => string,
): (path: string) => Promise<FakeSignedUpload> {
  return async (path: string) =>
    held.has(path)
      ? { data: null, error: { ...DUPLICATE_KEY_ERROR } }
      : { data: { path, signedUrl: signedUrl(path), token: 'tok-1' }, error: null }
}

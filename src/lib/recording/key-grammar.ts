// Storage-key grammar for the `recordings` bucket — the ONE place the app's
// entry points decide whether a caller-supplied key is this tenant's own take.
//
// The job worker (src/lib/jobs/process-recording.ts) keeps a deliberate
// defense-in-depth re-check in-file, right before its service-role read +
// delete — same intent, and since 2026-09-03 the same predicate rather than a
// bare `app_<businessId>_` prefix twin of it. Both doors that can enqueue a job
// are fenced by THIS predicate, so no new job row can carry a key the grammar
// would refuse; the worker's re-check covers rows already in the queue.
//
// Every consumer of such a key reaches the object through a SERVICE-ROLE client
// (no RLS), so this predicate is all that stands between a caller and another
// tenant's audio. It used to be a bare prefix check at each site, which let
// through anything that merely STARTED with the tenant prefix — a separator, a
// traversal body, a query suffix, a string-shaped non-string.
//
// A minted key is the ONLY legitimate source of one (mintRecordingUploadUrl in
// src/actions/recording-upload.ts and the upload-url facade twin compose it
// byte-identically), so the grammar is matched POSITIVELY and anything else is
// refused. Two shapes, ONE parser:
//
//     take     app_<businessId>_<lowercase uuid>.<ext>
//     segment  seg/app_<businessId>_<lowercase uuid>/<6-digit seq>.<ext>
//
// A take is flat — no directory segment — because /api/cleanup lists the bucket
// root non-recursively and would never see a nested orphan. Segments nest on
// purpose (a 90-minute take is ~1,000 objects) so the root listing stays as
// sparse as it is today; the six-digit zero pad makes lexical order numeric.
//
// The businessId is compared byte-exact through startsWith/slice, never
// interpolated into a RegExp — a tenant id is not a trusted pattern.

const TAKE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SEQ = /^[0-9]{6}$/
const TAKE_PREFIX = 'app_'
const SEGMENT_PREFIX = 'seg/'
const UUID_LENGTH = 36
/**
 * The CLOSED container map — the one place a recorder MIME becomes a key
 * extension. iOS negotiates audio/mp4 and Chrome audio/webm, and today both
 * land under a hardcoded `.webm`, which is the live mislabelling bug.
 */
const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
}
/** Closed set, DERIVED from the map above so a container the mint composes and
 *  the grammar refuses cannot exist. */
const EXTENSIONS: readonly string[] = Object.values(MIME_TO_EXT)

export type ParsedRecordingKey =
  | { kind: 'take'; takeId: string; ext: string }
  | { kind: 'segment'; takeId: string; seq: number; ext: string }

/** `<stem>.<ext>` split on the LAST dot, ext from the closed set or nothing. */
function splitExtension(name: string): { stem: string; ext: string } | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1)
  return EXTENSIONS.includes(ext) ? { stem: name.slice(0, dot), ext } : null
}

/**
 * The whole grammar: `key` parsed into its KIND, or null when it is not this
 * business's object at all.
 *
 * The kind is the point — a segment is a legitimate key of this tenant's, but
 * it is not a take, and every fence in the app means TAKE. Callers therefore
 * declare which they accept (see isOwnRecordingKey) rather than treating
 * "parses" as "may be read".
 *
 * `key` is typed `unknown` on purpose: every call site receives it from
 * caller-supplied JSON (a server-action argument or a request body), so a
 * `string` annotation would prove nothing at runtime — the typeof guard runs
 * first, before any method on `key` is invoked.
 */
export function parseRecordingKey(key: unknown, businessId: string): ParsedRecordingKey | null {
  if (typeof key !== 'string') return null
  const prefix = `${TAKE_PREFIX}${businessId}_`

  if (key.startsWith(SEGMENT_PREFIX)) {
    const rest = key.slice(SEGMENT_PREFIX.length)
    const slash = rest.indexOf('/')
    if (slash < 0) return null
    const folder = rest.slice(0, slash)
    const leaf = rest.slice(slash + 1)
    // Belt-and-braces, not the traversal defence: SEQ's `^[0-9]{6}$` below
    // already refuses any slash in the stem, so this can only ever reject a
    // leaf splitExtension would have refused anyway — kept explicit so the
    // one-folder-level shape reads directly off this line.
    if (leaf.includes('/') || !folder.startsWith(prefix)) return null
    const takeId = folder.slice(prefix.length)
    const parts = splitExtension(leaf)
    if (!TAKE_UUID.test(takeId) || !parts || !SEQ.test(parts.stem)) return null
    return { kind: 'segment', takeId, seq: Number(parts.stem), ext: parts.ext }
  }

  if (!key.startsWith(prefix)) return null
  const parts = splitExtension(key.slice(prefix.length))
  if (!parts || !TAKE_UUID.test(parts.stem)) return null
  return { kind: 'take', takeId: parts.stem, ext: parts.ext }
}

/**
 * True only when `key` is EXACTLY a finalized TAKE minted for `businessId`.
 *
 * Deliberately narrower than "parses": a segment belongs to this tenant too,
 * but every consumer of this predicate reaches the object with a SERVICE-ROLE
 * client to transcribe, sign or delete a WHOLE take, and none of them means a
 * fragment. Widening the grammar must not widen a single fence, so the kind is
 * declared here, once, instead of at seven call sites.
 *
 * The extension set widened with the grammar (webm/mp4/ogg/wav — iOS negotiates
 * mp4, not webm); the tenant prefix and the uuid body are unchanged.
 */
export function isOwnRecordingKey(key: unknown, businessId: string): key is string {
  return parseRecordingKey(key, businessId)?.kind === 'take'
}

/**
 * The recorder's negotiated container, normalized: `audio/webm;codecs=opus` is
 * audio/webm, so the codec parameters are stripped before the lookup. Null for
 * anything outside the closed map — a door REFUSES an unknown container rather
 * than guessing an extension for it.
 */
export function normalizeAudioMime(mimeType: unknown): string | null {
  if (typeof mimeType !== 'string') return null
  const base = mimeType.split(';')[0].trim().toLowerCase()
  return base in MIME_TO_EXT ? base : null
}

/** The key extension for a recorder MIME, from that same closed map. */
export function extFromMime(mimeType: unknown): string | null {
  const base = normalizeAudioMime(mimeType)
  return base === null ? null : MIME_TO_EXT[base]
}

/**
 * Compose the finalized-take key for a take the CLIENT named, and prove the
 * composition against the grammar before handing it out.
 *
 * WHY THE SELF-CHECK. `takeId` and `mimeType` are caller-supplied, and this
 * composition is the exact moment a crafted value could walk a service-role
 * storage key out of the tenant prefix. Parsing our OWN output means the only
 * key that ever leaves here is one `isOwnRecordingKey` would accept for this
 * same business — the property every downstream fence already relies on.
 * The two validations happen first, so reaching the throw means the grammar
 * and this composer have drifted apart: a bug here, never caller input, and a
 * 500 rather than a 400.
 *
 * `businessId` is the caller's OWN verified tenant — never a request field.
 */
export function composeTakeKey(
  businessId: string,
  takeId: unknown,
  mimeType: unknown,
): { key: string; ext: string; contentType: string } | null {
  if (typeof takeId !== 'string' || !TAKE_UUID.test(takeId)) return null
  const contentType = normalizeAudioMime(mimeType)
  if (contentType === null) return null
  const ext = MIME_TO_EXT[contentType]
  const key = `${TAKE_PREFIX}${businessId}_${takeId}.${ext}`
  if (parseRecordingKey(key, businessId)?.kind !== 'take') {
    throw new Error('composed recording key failed its own grammar')
  }
  return { key, ext, contentType }
}

/**
 * Tenant-BLIND shape check, for /api/cleanup alone: it lists the bucket root
 * with no tenant context, so it cannot name the business a key must belong to.
 *
 * It reads the businessId back OUT of the name and asks the one parser above,
 * rather than spelling the shape a second time where the two could drift.
 */
export function looksLikeRecordingKey(name: unknown): boolean {
  if (typeof name !== 'string') return false
  // app_<businessId>_<uuid>.<ext>: the uuid is fixed-width and the extension is
  // whatever follows the last dot, so the businessId is exactly what lies
  // between `app_` and the `_` that opens the uuid.
  // `+ 2` = the separator plus at least one businessId character.
  const uuidStart = name.lastIndexOf('.') - UUID_LENGTH
  if (uuidStart < TAKE_PREFIX.length + 2 || name[uuidStart - 1] !== '_') return false
  const businessId = name.slice(TAKE_PREFIX.length, uuidStart - 1)
  // A real businessId never contains a path separator — a name that only
  // parses because the derived id happens to reopen the tenant prefix (a
  // traversal body, a folder-shaped id) is not this shape, whatever
  // parseRecordingKey below would otherwise say.
  if (businessId.includes('/')) return false
  return parseRecordingKey(name, businessId) !== null
}

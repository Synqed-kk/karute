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
// refused. Four shapes, ONE parser:
//
//     take     app_<businessId>_<lowercase uuid>.<ext>
//     segment  seg/app_<businessId>_<lowercase uuid>/<6-digit seq>.<ext>
//     staged   stg/<businessId>_<recordingSessionId>_<lowercase uuid>.<ext>
//     rescue   rsc/app_<businessId>_<lowercase uuid>.<ext>
//
// ⚖ AND THE RESCUE IS THE TAKE KEY UNDER A PREFIX (⚖ Liam 2026-09-06, "b").
// The nightly assembler rebuilds a dead device's take out of its segments, and
// it used to write that rebuild under the take's OWN key — which meant a phone
// that was merely PAUSED for two days came back to find its key occupied by a
// shorter object, and its own finalize ended at a terminal `size_mismatch`
// with the full audio stuck on the device. The rescue therefore lands BESIDE
// the take, never on it: same body, one prefix further left, so the phone's own
// key stays free for whoever comes back and nothing the device does can
// mismatch. Readers prefer the phone's object and fall back to the rescue
// (resolveTakeAudio, src/lib/recording/take-audio.ts) — one precedence, one
// helper.
//
// ⚖ A STAGED COPY IS NAMED FOR ITS SESSION (PR4 fix round 7). The staged shape
// is the discard's word-collection copy — the only object in this bucket that
// is row-less server-side — and it carries the recording session it was staged
// for IN THE KEY. That is what lets the transcribe door check a caller's claim
// instead of trusting it: before this round any same-tenant key was accepted as
// the audio of a discarded session, so a records.write holder could name a
// COLLEAGUE'S finished take and have its words written onto an unrelated
// discard. The session id is the identity a row-less object otherwise lacks.
//
// ⚖ …AND THE UUID SLOT IS THE TAKE (slice five packet B). The grammar is
// unchanged — the slot was always "a uuid" and still parses as one — but the
// value in it is now the take's own id rather than a fresh server uuid, which
// makes the whole staged key composable from the core row alone. See
// composeStagedKey below for why that identity matters and what it costs.
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
const STAGED_PREFIX = 'stg/'
/** The nightly assembler's SIDE KEY — a take's rebuilt audio, one folder level
 *  in, so the take's own key is never occupied by it (⚖ Liam 2026-09-06, "b").
 *  Exported because the assembler's own docs and the resolver name the prefix. */
export const RESCUE_PREFIX = 'rsc/'
const UUID_LENGTH = 36
/**
 * The CLOSED container map — the one place a recorder MIME becomes a key
 * extension. iOS negotiates audio/mp4 and Chrome audio/webm, and today both
 * land under a hardcoded `.webm`, which is the live mislabelling bug.
 *
 * NULL PROTOTYPE, because the lookup key is a REQUEST BODY. On a plain object
 * literal `'constructor' in MIME_TO_EXT` is true and `MIME_TO_EXT.constructor`
 * is a FUNCTION — so mimeType "constructor" or "__proto__" (the two
 * Object.prototype members that survive normalizeAudioMime's toLowerCase)
 * walked straight past the closed-set check and composed a key whose extension
 * was that function's source text. Object.create(null) means there are no
 * inherited members to find at all, whichever way and whatever case the map is
 * read in — the casing must never be what saves this.
 *
 * EXPORTED, read-only, so the `audio/<ext>` round trip the two …FromExt
 * wrappers rest on is pinned against THE MAP ITSELF rather than against a
 * typed-out copy of today's members (fix round 8). A fifth container is added
 * here and exactly one pin fails, which is what the docblock below promises.
 */
export const MIME_TO_EXT: Readonly<Record<string, string>> = Object.assign(Object.create(null), {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
})
/** Closed set, DERIVED from the map above so a container the mint composes and
 *  the grammar refuses cannot exist. */
const EXTENSIONS: readonly string[] = Object.values(MIME_TO_EXT)

export type ParsedRecordingKey =
  | { kind: 'take'; takeId: string; ext: string }
  | { kind: 'segment'; takeId: string; seq: number; ext: string }
  | { kind: 'staged'; recordingSessionId: string; ext: string }
  | { kind: 'rescue'; takeId: string; ext: string }

/** `<stem>.<ext>` split on the LAST dot, ext from the closed set or nothing. */
function splitExtension(name: string): { stem: string; ext: string } | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1)
  return EXTENSIONS.includes(ext) ? { stem: name.slice(0, dot), ext } : null
}

/**
 * `app_<businessId>_<uuid>.<ext>` — the TAKE BODY, read once for the two kinds
 * that carry it: the take itself, and the assembler's rescue of one under
 * RESCUE_PREFIX. ONE code path, never a second regex: a rescue key differs from
 * a take key by its prefix and by NOTHING ELSE, so if this ever drifts the two
 * drift together or not at all.
 *
 * A slash in the body is refused for free — TAKE_UUID is anchored hex, so
 * `rsc/app_<biz>_<uuid>/anything.webm` reads a stem with a separator in it and
 * fails the test.
 */
function parseTakeBody(body: string, prefix: string): { takeId: string; ext: string } | null {
  if (!body.startsWith(prefix)) return null
  const parts = splitExtension(body.slice(prefix.length))
  if (!parts || !TAKE_UUID.test(parts.stem)) return null
  return { takeId: parts.stem, ext: parts.ext }
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

  if (key.startsWith(STAGED_PREFIX)) {
    // stg/<businessId>_<sessionId>_<uuid>.<ext> — no `app_` inside, because the
    // prefix already says which shape this is. The two uuid halves are
    // fixed-width, so the separator between them is at a known offset and
    // neither half can hide a slash: TAKE_UUID is anchored hex.
    const rest = key.slice(STAGED_PREFIX.length)
    const tenant = `${businessId}_`
    if (!rest.startsWith(tenant)) return null
    const parts = splitExtension(rest.slice(tenant.length))
    if (!parts || parts.stem[UUID_LENGTH] !== '_') return null
    const recordingSessionId = parts.stem.slice(0, UUID_LENGTH)
    if (!TAKE_UUID.test(recordingSessionId)) return null
    if (!TAKE_UUID.test(parts.stem.slice(UUID_LENGTH + 1))) return null
    return { kind: 'staged', recordingSessionId, ext: parts.ext }
  }

  if (key.startsWith(RESCUE_PREFIX)) {
    // The take body, EXACTLY as the take branch below reads it — same helper,
    // so the two kinds cannot disagree about what a take body is.
    const body = parseTakeBody(key.slice(RESCUE_PREFIX.length), prefix)
    return body === null ? null : { kind: 'rescue', ...body }
  }

  const body = parseTakeBody(key, prefix)
  return body === null ? null : { kind: 'take', ...body }
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
 *
 * ⚖ AND THE RESCUE KIND DID NOT WIDEN IT EITHER (⚖ Liam 2026-09-06, "b"). This
 * is the ROW-POINTER fence — serverHoldsTakeRow, the take mint, finalize, and
 * every door a CLIENT names a path at — and a row's pointer is always the
 * phone's own key, never the assembler's side copy. A `rsc/` key reaching one
 * of those is either a bug or a caller's invention, and both are refused here.
 * The predicate for a SERVER-DERIVED audio path is the separate isOwnAudioKey.
 */
export function isOwnRecordingKey(key: unknown, businessId: string): key is string {
  return parseRecordingKey(key, businessId)?.kind === 'take'
}

/**
 * True when `key` is a whole take's AUDIO for `businessId` — the take's own
 * object, OR the nightly job's rescue of it (⚖ ADDENDUM 9.1).
 *
 * TWO PREDICATES, AND WHICH ONE A DOOR MAY USE IS THE WHOLE POINT:
 *
 *   isOwnRecordingKey  the ROW-POINTER fence. 'take' alone. Every door where
 *                      the path is a CLIENT'S CLAIM — the take mint, finalize,
 *                      serverHoldsTakeRow, the enqueue doors, the transcribe
 *                      route, the read-url action — keeps this one. No client
 *                      ever needs to name a `rsc/` path, because the doors that
 *                      reach one derive it from the row themselves.
 *
 *   isOwnAudioKey      ONLY for a SERVER-DERIVED audio path: the transcription
 *                      worker's re-check of a payload the server wrote, and the
 *                      discard door's karute audio path. Without it a rescued
 *                      take could never be transcribed after somebody saved it,
 *                      and a karute made from a rescue could never be
 *                      discarded — the two doors that read AUDIO rather than a
 *                      pointer.
 *
 * It is exactly as narrow as it needs to be: same tenant prefix inside, same
 * closed container set, same anchored uuid. A segment, a staged copy and every
 * other tenant's object are refused by both.
 */
export function isOwnAudioKey(key: unknown, businessId: string): key is string {
  const kind = parseRecordingKey(key, businessId)?.kind
  return kind === 'take' || kind === 'rescue'
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
  // `Object.hasOwn`, never `in`: `in` walks the prototype chain, so a caller
  // naming an Object.prototype member would be told it is a container we
  // store. Belt AND braces with the null prototype above — the same pairing
  // src/business/lib/karute.ts uses on its own closed table.
  return Object.hasOwn(MIME_TO_EXT, base) ? base : null
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
 * Compose the RESCUE key — where the nightly assembler puts a take it rebuilt
 * out of the segments a dead device left behind (⚖ Liam 2026-09-06, "b").
 *
 * `rsc/` + exactly the take key, because the rescue IS that take's audio and
 * anything else would need a second registry to say which take it belonged to.
 * The prefix is the whole point: the take's own key stays FREE, so a phone that
 * was only paused comes back, uploads, and finalizes at the size it declared —
 * the `size_mismatch` strand this shape exists to remove.
 *
 * SAME SELF-CHECK CONTRACT as composeTakeKey: the composition is parsed with
 * the SAME parser every fence uses, so the only key that ever leaves here is
 * one the grammar reads back as this business's rescue. Reaching the throw
 * means the composer and the grammar have drifted apart — a bug here, never
 * caller input.
 *
 * NOTHING WIDENS AROUND IT: isOwnRecordingKey still means 'take' alone, so a
 * rescue key cannot pass a row-pointer fence, and the job never writes core, so
 * no row's pointer can ever carry one.
 */
export function composeRescueKey(
  businessId: string,
  takeId: unknown,
  mimeType: unknown,
): { key: string; ext: string; contentType: string } | null {
  const take = composeTakeKey(businessId, takeId, mimeType)
  if (take === null) return null
  const key = `${RESCUE_PREFIX}${take.key}`
  if (parseRecordingKey(key, businessId)?.kind !== 'rescue') {
    throw new Error('composed rescue key failed its own grammar')
  }
  return { key, ext: take.ext, contentType: take.contentType }
}

/**
 * THE ONE ext→key SPELLING (⚖ ADDENDUM 9.2 M2). The assembler reads a
 * container off a folder's own leaf names — an EXTENSION, not a MIME — and the
 * resolver every reader shares takes the same. `audio/<ext>` happens to be the
 * inverse of MIME_TO_EXT for every member of that closed map today, and that
 * coincidence is PINNED in the grammar's own suite; these two wrappers are the
 * only place it is relied on, so if the map ever gains a member whose MIME is
 * not `audio/<ext>` exactly one pin fails and exactly two functions change.
 *
 * Null for a container the map does not know — the same refusal composeTakeKey
 * makes, never a guessed key.
 */
export function composeTakeKeyFromExt(
  businessId: string,
  takeId: unknown,
  ext: string,
): { key: string; ext: string; contentType: string } | null {
  return composeTakeKey(businessId, takeId, `audio/${ext}`)
}

/** The rescue twin of composeTakeKeyFromExt — same coincidence, same pin. */
export function composeRescueKeyFromExt(
  businessId: string,
  takeId: unknown,
  ext: string,
): { key: string; ext: string; contentType: string } | null {
  return composeRescueKey(businessId, takeId, `audio/${ext}`)
}

/**
 * Compose ONE SEGMENT key under a take's own folder (slice five packet C, D6).
 *
 * A segment is a ~5 s slice of a take that is STILL BEING RECORDED — the bytes
 * that reach the server before the whole take can (design v1 §3 R1). It hangs
 * under a take the core row has ALREADY reserved, so this composition reserves
 * nothing, writes nothing and audits nothing; the fence that makes it safe is
 * the mint's (`row.audio_storage_path` must be this take's own key), not the
 * grammar's.
 *
 * SAME SELF-CHECK CONTRACT as composeTakeKey and composeStagedKey: the three
 * inputs are validated first, then the composed key is parsed with the SAME
 * parser every fence uses, and the values it reads back are compared field by
 * field. Reaching the throw therefore means this composer and the grammar have
 * drifted apart — a bug here, never caller input, and a 500 rather than a 400.
 *
 * LEXICAL ORDER IS NUMERIC ORDER. The seq is zero-padded to six digits, so a
 * plain storage listing of the folder comes back in capture order — which is
 * what the assembler (a later slice) will read it in. Six digits is ~83 hours
 * at one segment per 5 s, and the range is closed at 999999 so the pad can
 * never silently widen and re-order everything before it.
 *
 * ONE FOLDER PER TAKE, and that is the whole reason the segment shape nests
 * (design v1 §5): a 90-minute take is ~1,000 objects, and /api/cleanup lists
 * the bucket ROOT non-recursively — so a flat segment name would put a thousand
 * objects per take in front of a sweep that walks the root every time it runs.
 * Nested, the root stays exactly as sparse as it is today.
 *
 * `takeId`, `seq` and `mimeType` are typed `unknown` for the same reason the
 * parser's `key` is: they arrive from a request body, so a `string`/`number`
 * annotation proves nothing at runtime and every guard below runs before any
 * method or arithmetic touches them.
 *
 * `businessId` is the caller's OWN verified tenant — never a request field.
 */
export function composeSegmentKey(
  businessId: string,
  takeId: unknown,
  seq: unknown,
  mimeType: unknown,
): { key: string; ext: string; contentType: string; seq: number } | null {
  if (typeof takeId !== 'string' || !TAKE_UUID.test(takeId)) return null
  // `Number.isInteger` refuses NaN, Infinity and every fractional value in one
  // go — and a string-shaped number never reaches it, because typeof runs first
  // inside that predicate. The range is the pad's: SEQ is `^[0-9]{6}$`, so
  // anything at or past 1e6 would compose a seven-digit stem the parser refuses.
  if (!Number.isInteger(seq) || (seq as number) < 0 || (seq as number) > 999_999) return null
  const contentType = normalizeAudioMime(mimeType)
  if (contentType === null) return null
  const ext = MIME_TO_EXT[contentType]
  const seqNum = seq as number
  const key = `${SEGMENT_PREFIX}${TAKE_PREFIX}${businessId}_${takeId}/${String(seqNum).padStart(6, '0')}.${ext}`
  const parsed = parseRecordingKey(key, businessId)
  if (
    parsed?.kind !== 'segment' ||
    parsed.takeId !== takeId ||
    parsed.seq !== seqNum ||
    parsed.ext !== ext
  ) {
    throw new Error('composed segment key failed its own grammar')
  }
  return { key, ext, contentType, seq: seqNum }
}

/**
 * Compose the STAGED-copy key for the session a discard's words are owed to.
 *
 * The SESSION is what isStagedKeyFor checks later, and the reason this shape
 * exists at all. `businessId` is the caller's OWN verified tenant, and the
 * session id is validated before it is interpolated, exactly as composeTakeKey
 * validates its take id — same self-check on the way out, same "reaching the
 * throw is a bug here, never caller input" contract.
 *
 * ⚖ AND THE UUID SLOT IS THE TAKE (slice five packet B, D10). The slot used to
 * be a fresh server uuid per staging, which made the copy unique and NAMELESS:
 * nothing outside the device that PUT it could ever say which object was a
 * given take's staged copy, so the row-less object was unfindable from the core
 * row that owed it. With the take in the slot the whole key is composable FROM
 * THE ROW ALONE — session = the row's own id, take id + ext = the row's own
 * reserved pointer `app_<biz>_<take>.<ext>` — so `stg/<biz>_<session>_<take>.<ext>`
 * is a pointer core can find with one storage probe and no new registry.
 *
 * That is also why the slot must never carry anything a device could VARY: a
 * second staging of the same take composes the SAME key, storage refuses it
 * (409 = already there, ⚖ V2.1) and the first copy stands, immutable, exactly
 * as a finalized take's object does. A varying slot would mint a second copy
 * per attempt instead.
 *
 * `slot` is typed `unknown` for the same reason `key` is on the parser: it
 * arrives from a request body. Anything that is not a lowercase take uuid falls
 * back to the server's own — the no_uuid cohort (a browser with no
 * `crypto.randomUUID` on the DEVICE, which cannot name its take at all) is the
 * named ceiling here, and its copies stay unfindable exactly as every copy was
 * before this round.
 */
export function composeStagedKey(
  businessId: string,
  recordingSessionId: unknown,
  mimeType: unknown,
  slot?: unknown,
): { key: string; ext: string; contentType: string } | null {
  if (typeof recordingSessionId !== 'string' || !TAKE_UUID.test(recordingSessionId)) return null
  const contentType = normalizeAudioMime(mimeType)
  if (contentType === null) return null
  const ext = MIME_TO_EXT[contentType]
  const uuid = typeof slot === 'string' && TAKE_UUID.test(slot) ? slot : crypto.randomUUID()
  const key = `${STAGED_PREFIX}${businessId}_${recordingSessionId}_${uuid}.${ext}`
  if (parseRecordingKey(key, businessId)?.kind !== 'staged') {
    throw new Error('composed staged key failed its own grammar')
  }
  return { key, ext, contentType }
}

/**
 * True only when `key` is a STAGED copy minted for `businessId` AND for exactly
 * this recording session — the one claim the discard's transcribe door honours
 * in place of the row's own pointer (recording-discard-transcript.ts).
 *
 * Narrower than "parses" for the same reason isOwnRecordingKey is: a staged
 * copy of ANOTHER session is this tenant's object too, and accepting it would
 * be the very lever this shape exists to remove.
 */
export function isStagedKeyFor(
  key: unknown,
  businessId: string,
  recordingSessionId: string,
): key is string {
  const parsed = parseRecordingKey(key, businessId)
  return parsed?.kind === 'staged' && parsed.recordingSessionId === recordingSessionId
}

/**
 * The tenant and take a `seg/` FOLDER name carries — tenant-blind, for the
 * nightly assembler alone (src/lib/recording/assembler.ts), which walks the
 * `seg/` tree with no tenant context exactly as /api/cleanup walks the root.
 *
 * SAME POSTURE AS looksLikeRecordingKey below: read the businessId back OUT of
 * the name and ask THE ONE PARSER, rather than spelling the shape a second
 * time where the two could drift. A folder name is not a key, so it is turned
 * into the key its own seq-0 leaf WOULD carry and parsed as one — if that key
 * does not read as this take's segment for the derived business, the name was
 * never this shape.
 *
 * It widens NO fence: the assembler reaches an object only through
 * composeTakeKey/parseRecordingKey afterwards, exactly as every other consumer
 * does. What this answers is only "which tenant's take does this folder name
 * claim to be" — the question a bucket-wide walk cannot ask any other way.
 */
export function parseSegmentFolder(name: unknown): { businessId: string; takeId: string } | null {
  if (typeof name !== 'string' || !name.startsWith(TAKE_PREFIX)) return null
  // app_<businessId>_<uuid>: the uuid is fixed-width and CLOSES the name (a
  // folder carries no extension), so the businessId is exactly what lies
  // between `app_` and the `_` that opens the uuid.
  // `+ 2` = the separator plus at least one businessId character.
  const idStart = name.length - UUID_LENGTH
  if (idStart < TAKE_PREFIX.length + 2 || name[idStart - 1] !== '_') return null
  const businessId = name.slice(TAKE_PREFIX.length, idStart - 1)
  // A real businessId never contains a path separator — looksLikeRecordingKey's
  // rule, for the same reason: a name that only parses because the derived id
  // reopens the tenant prefix is not this shape, whatever the parser says.
  if (businessId.includes('/')) return null
  const takeId = name.slice(idStart)
  // READ IT BACK OUT. The extension is any member of the closed set — the leaf
  // this probes is synthetic and its container is not the question here; the
  // REAL leaves' ext is read off the real listing by the caller.
  const parsed = parseRecordingKey(
    `${SEGMENT_PREFIX}${name}/000000.${EXTENSIONS[0]}`,
    businessId,
  )
  return parsed?.kind === 'segment' && parsed.takeId === takeId ? { businessId, takeId } : null
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
  // A STAGED name (stg/<businessId>_<sessionId>_<uuid>.<ext>) is the same
  // reading one uuid further left — both prefixes are four characters, and both
  // ids are fixed-width, so the offset is the only difference.
  // `+ 2` = the separator plus at least one businessId character.
  const staged = name.startsWith(STAGED_PREFIX)
  const uuidStart = name.lastIndexOf('.') - UUID_LENGTH
  const idStart = staged ? uuidStart - UUID_LENGTH - 1 : uuidStart
  if (idStart < TAKE_PREFIX.length + 2 || name[idStart - 1] !== '_') return false
  const businessId = name.slice(TAKE_PREFIX.length, idStart - 1)
  // A real businessId never contains a path separator — a name that only
  // parses because the derived id happens to reopen the tenant prefix (a
  // traversal body, a folder-shaped id) is not this shape, whatever
  // parseRecordingKey below would otherwise say.
  if (businessId.includes('/')) return false
  return parseRecordingKey(name, businessId) !== null
}

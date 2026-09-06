// THE ASSEMBLER — the take whose device never came back (build 23 slice ③,
// design D1–D5).
//
// The segment pump (segment-uploader.ts) puts a take's ~5 s slices on the
// server WHILE it is being recorded, and the stop leg then secures the WHOLE
// take under its own immutable key. A phone that dies, is wiped, or walks out
// of the salon between those two moments leaves the slices and never the take:
// the folder `seg/app_<biz>_<take>/` holds the audio, the core row still says
// UPLOADING with no duration, and nothing on the server ever turns one into
// the other. That is what this does, once a night, for a device that has been
// silent for two days.
//
// ⚖ IT ONLY EVER ADDS, AND ONLY TO STORAGE. It reads the segments,
// concatenates the longest CONTIGUOUS prefix from seq 0, PUTs the result under
// the key the row already reserved with `upsert: false`, and files one audit
// row saying what it rebuilt. Nothing is deleted — not a segment after it is
// read, not an object it did not write (audio is never deleted;
// scripts/audit/check-audio-never-deleted.mjs is the machine behind that rule).
// A duplicate refusal on the PUT means the device came back and sealed its own
// take first: this skips, silently, and writes nothing at all.
//
// ⚖ AND IT NEVER WRITES TO CORE (amendment 2026-09-06). Core fences
// `PUT /v1/recordings/:id` behind a HUMAN actor (core D10,
// docs/backlog/LIAM_FULL_DUMP_BACKLOG.md:94; src/lib/synqed/client.ts:54-57),
// and a 03:07 cron has none — inventing one for a job is exactly what that
// fence exists to forbid. So the take's DURATION is written by the door that
// does have an actor: the save-from-server door a staffer taps, carrying their
// own bearer. This job rebuilds the audio and says so; the row learns its
// length when somebody saves the recording.
//
// WHY 48 HOURS AND NOT THE INBOX'S 3 (design D1). The device's own drain
// retries every minute the app is open (owed-drain, launch-drain), and a phone
// that comes back within two days secures the WHOLE take itself. Sealing
// earlier would put a PARTIAL object under the take's immutable key and turn
// the returning device's finalize into a terminal `size_mismatch` — a strand
// we inflicted. Two days of silence is where "gone" becomes the likelier truth.
//
// ⚖ NAMED CEILING — THE RETURNING DEVICE. Once a take is sealed here the key
// is spoken for, and a phone that comes back at ANY later time meets the
// object: its finalize compares byte lengths, they differ (it holds the last
// flush the segments never got), and it ends at a terminal `size_mismatch`
// (finalize-take.ts) — that take then reads 要対応 with 再試行 on the phone.
// The audio is not lost either way: the full copy stays on the device and the
// prefix is on the server. The same arithmetic reaches a take left PAUSED for
// days, which flushes nothing and never reaches the recorder's 2-hour
// auto-stop (that measures recorded time, not wall time), so the age gate
// reads it as gone. Both are the price of sealing with no declaration of how
// long a take was meant to be; a last-seq declared at stop is the upgrade.
//
// WHAT IT NEVER CLAIMS (design D2). Today's main carries NO declaration of how
// long a take was — FinalizeTakeSchema has no lastSeq, so the device never
// tells the server how many segments it meant to send. So every object this
// files is `partial: true` with `declared_last_seq: null`, and the duration it
// stamps is an ESTIMATE (prefix × the recorder's own flush window), declared as
// one in the audit row. It never refuses to produce what exists, and it never
// claims completeness it cannot have.
//
// NO 'use server' directive, deliberately — same rule as mint-take-url.ts and
// finalize-take.ts: `businessId` here is read off the BUCKET's own folder
// names, never from a caller, and as a client-invokable action every one of
// these would take a caller's word for whose take it is opening.

import type { Recording, SynqedClient } from '@synqed-kk/client'
import { audit } from '@/lib/audit'
import { paginateDedupe } from '@/lib/customers/paginate'
import { createServiceClient } from '@/lib/supabase/service'
import { composeTakeKey, parseRecordingKey, parseSegmentFolder } from '@/lib/recording/key-grammar'
import { objectExists } from '@/lib/recording/mint-take-url'
import { newSynqedClient } from '@/lib/synqed/client'

/** How long the newest segment must be untouched before a take counts as
 *  abandoned. The NEWEST segment is the last moment the device was heard from
 *  — the honest "the device is gone" signal, since no drain window exists
 *  server-side (design D1/W5). */
export const ASSEMBLE_AFTER_MS = 48 * 60 * 60 * 1000

/** The recorder flushes one segment per TAKE_FLUSH_MS (src/lib/global-recorder
 *  .ts) — pinned equal by recording-assembler.test.ts, because this number is
 *  the whole basis of the estimated duration and a drift would silently
 *  mis-time every rescued take.
 *  EXPORTED for the save-from-server door, which computes the SAME estimate
 *  when it writes the duration (it has the actor this job does not) — one
 *  number, never two spellings of it. Same reason `longestPrefix` is exported. */
export const SEGMENT_NOMINAL_MS = 5_000

/** How many takes one night may seal. A 90-minute take is ~1,000 objects
 *  (~32 MB); twenty of those fit the route's budget on hnd1 with room, and the
 *  field's worst night is a handful. A run that hits it reports
 *  `budgetExhausted`, and tomorrow's run starts a stride further round and
 *  reaches them when the walk comes round — NOT tomorrow, which begins
 *  ROTATION_STRIDE folders past the ones tonight stopped short of. */
export const MAX_TAKES_PER_RUN = 20

/** Stop STARTING a rebuild with less than this much of the budget left. The
 *  worst take the recorder can produce is 2 h at 48 kbps (~43 MB, ~1,440
 *  segments — global-recorder.ts's own ceiling), which is tens of seconds of
 *  downloading plus one large PUT. Admitting one at 269 s would have the
 *  function killed at the 300 s wall mid-PUT, and storage may still complete
 *  that PUT server-side — leaving an object no run will ever audit, because
 *  the next night meets it and skips.
 *  It ends the WALK, not just the rebuild: a run that can no longer start one
 *  has nothing left worth classifying tonight, and the folders it did not
 *  reach wait for the rotation to come round — not for tomorrow, which starts
 *  a stride further on. */
const TAKE_RESERVE_MS = 30_000

/** One day in ms — the rotation's period (see runAssembler). */
const DAY_MS = 86_400_000

/** How far the walk's starting point moves each night: ONE NIGHT'S REACH,
 *  estimated — not one folder, and PRIME on purpose.
 *
 *  The arithmetic. A folder whose take is already on the server costs the
 *  cheap pair: one `list` with limit 1 and one `objectExists`. Two same-region
 *  round trips at ~60 ms each is ~120 ms a folder, so 270 s reaches roughly
 *  2,250 of them; 1,999 is under that, so the stride under-claims rather than
 *  over-claims.
 *
 *  THE COVERAGE PROPERTY, which the prime does not change. In unbounded index
 *  space night d covers [d·S, d·S + K), and while every night in the window
 *  reaches K ≥ S those runs abut or overlap — so their union is ONE contiguous
 *  run, and any run of N consecutive integers hits every residue mod N. Every
 *  folder is therefore visited within `ceil((N − K) / S) + 1` nights, which is
 *  `ceil(N / S)` at K = S and better when a night reaches more. The modulus
 *  never enters that proof, which is why N not being a multiple of the stride
 *  is safe.
 *
 *  WHY PRIME. The start positions are the multiples of `gcd(stride, N)`, so a
 *  stride sharing a factor with the folder count only ever visits `N / gcd` of
 *  the indexes — and a stride that DIVIDES N (2,000 against 6,000 folders)
 *  never moves the start at all, which is the exact pathology the rotation
 *  exists to prevent. `seg/` only ever grows (nothing deletes a segment, by
 *  law), so N passes through every such value on its way up. A prime shares a
 *  factor with nothing but its own multiples, so the start walks EVERY index;
 *  the residual is N a multiple of 1,999.
 *
 *  AND WHAT A SLOW NIGHT REALLY COSTS. A night that reaches fewer than the
 *  stride still advances the start by the stride, so the folders it skipped are
 *  reached when the walk comes round — at most N nights, not on the
 *  ceil(N / S) schedule. Closing that exactly is the resume cursor named at the
 *  rotation itself.
 *
 *  WHY IT IS NOT 1. Stepping the start by one folder a night moves the covered
 *  WINDOW by one folder a night, so a folder just past tonight's reach waits
 *  N − reach nights, not N / reach. At 6,000 folders that is ~600 nights, and
 *  every comment promising "a few nights" would be wrong by two orders of
 *  magnitude. Striding by a night's reach makes the promise true. */
export const ROTATION_STRIDE = 1_999

/** Downloads in flight at once while rebuilding one take. Four, not the whole
 *  prefix: this runs at 03:07 against a bucket nobody is recording into, so it
 *  can be brisk — but a thousand simultaneous GETs is a self-inflicted rate
 *  limit, not speed. Shared-cursor pool, seq order (the segment pump's idiom). */
const DOWNLOAD_CONCURRENCY = 4

/** The bucket listing is paged (storage-js defaults to 100 per call), so the
 *  walk advances by what a page RETURNED — never by the limit asked for, so a
 *  server-side cap below PAGE_SIZE cannot end it early. MAX_PAGES is the
 *  runaway stop; both mirror /api/cleanup's walk exactly.
 *  ponytail: PAGE_SIZE × MAX_PAGES per listing is the ceiling; past it the run
 *  says walkComplete:false rather than lying, and the fix is a resume cursor. */
const PAGE_SIZE = 1000
const MAX_PAGES = 100

/** Core's recording list REJECTS a page_size above 200 (it does not clamp) —
 *  see inbox-read.ts's note; the validator is core's own
 *  z.coerce.number().int().min(1).max(200). */
const ROW_PAGE_SIZE = 200

/** How far either side of the OLDEST segment the row's own `created_at` may
 *  sit. A session is minted at start and its first segment lands seconds
 *  later; the 2-hour AUTO_STOP (global-recorder.ts) bounds any pause inside a
 *  take, so six hours each way is far past anything a real take can do while
 *  keeping the listing small. */
const ROW_WINDOW_MS = 6 * 60 * 60 * 1000

/** The tree the segment pump writes into — the ONE prefix this job walks. */
const SEGMENT_ROOT = 'seg'
const BUCKET = 'recordings'

/** Reasons a folder was passed over — one per folder, disjoint: every folder
 *  the walk does not rescue lands in exactly one of these. */
export interface AssemblerSkipped {
  /** The newest segment is younger than ASSEMBLE_AFTER_MS — the device may
   *  still come back and secure the whole take itself. */
  young: number
  /** The object is ALREADY at the row's key — this take has either been
   *  rescued on an earlier night or finalized by its own device. Either way
   *  the audio is on the server and there is nothing to rebuild. Disjoint
   *  from every other outcome, and the ordinary case for a healthy tenant
   *  whose finished takes still have their segments beside them. */
  objectExists: number
  /** No core row anywhere in the window reserved this exact key. Never invent
   *  one — a folder with no row is somebody else's problem to explain. */
  noRow: number
  /** A row exists and somebody already settled it (a duration is stamped), so
   *  there is nothing for this job to add. */
  settled: number
  /** seq 000000 is missing: the head of the take never landed, and a
   *  concatenation that does not start at the beginning is not the take. */
  noSeq0: number
  /** The folder's leaves disagree about the container. Never guessed at. */
  extMismatch: number
  /** The device beat us to its own key (a duplicate refusal on the PUT), or
   *  the object standing there is not this prefix's concatenation. Nothing
   *  written, nothing audited. */
  deviceReturned: number
  /** Storage or core would not answer. Retried on the next night's run. */
  error: number
}

export interface AssemblerSummary {
  /** Folders in `seg/` that parse as a take folder — the denominator. */
  candidates: number
  /** Objects newly written from segments — one audit row each. */
  assembled: number
  /** Rescues filed as `partial: true` — which, on today's main, is every one
   *  of them (design D2: no declaration of a take's length exists). */
  partial: number
  skipped: AssemblerSkipped
  /** False when the LISTING was cut short (a failed page or the page cap), so
   *  part of the bucket was never looked at. The scheduler reads only the HTTP
   *  status, so a blind run must not record as a green one. */
  walkComplete: boolean
  /** True when the run stopped on its own time/count bound with candidates
   *  left. Distinct from walkComplete on purpose: the walk SAW them, tonight
   *  simply ended, and tomorrow's run begins ROTATION_STRIDE folders further
   *  along the same list (circularly), so nights that each reach at least that
   *  many cover everything within ceil(N / ROTATION_STRIDE) nights. A 200,
   *  not a 500. */
  budgetExhausted: boolean
}

export interface AssemblerDeps {
  /** A BUSINESS-SCOPED core client per tenant, built once per run per business
   *  by the caller. The folder names are the only source of a tenant here, and
   *  every core read for a take goes through the client for ITS OWN business —
   *  never one client reused across folders.
   *  READ-ONLY BY TYPE: `list` is the only method this job may reach for. Core
   *  refuses a recording write from an actor-less caller anyway, but the type
   *  is what makes "the assembler never writes to core" checkable rather than
   *  merely true today. */
  coreFor(businessId: string): { recordings: Pick<SynqedClient['recordings'], 'list'> }
  /** The clock, injectable so age arithmetic is testable without waiting two
   *  days for it. */
  now(): number
}

/** One object under a take's folder, as the listing describes it. */
interface SegmentLeaf {
  /** The leaf name only (`000007.webm`) — the key is composed from the folder. */
  name: string
  seq: number
  ext: string
  /** `created_at` in ms, or NaN when storage gave none (treated as YOUNG). */
  createdAtMs: number
  /** `metadata.size`, or null when the listing carried none. */
  size: number | null
}

/** Everything resolved about one stranded take before a byte is moved. */
export interface StrandedTake {
  businessId: string
  takeId: string
  /** `app_<biz>_<take>` — the folder under `seg/`. */
  folder: string
  /** The row's own reserved pointer, composed through composeTakeKey. */
  key: string
  contentType: string
  ext: string
  /** How many leaves the folder holds, gaps and all. */
  segmentsPresent: number
  /** The contiguous prefix from seq 0, in seq order — the ONLY bytes used. */
  prefix: SegmentLeaf[]
  /** The first missing seq, or null when the folder is contiguous. */
  firstGapSeq: number | null
  /** The row that reserved this key: id only — nothing else is read from it
   *  after the walk classified it. */
  rowId: string
  /** The row's own store, for the audit row. The 監査ログ viewer FILTERS by
   *  store, so a row keyed on an empty one is invisible to every store-scoped
   *  search (playback-url.ts:259-263 is the precedent, and it was itself a fix
   *  round). Null on every row today — nothing stamps `store_id` on a
   *  recording yet — which is exactly why it is threaded now: the PR that
   *  starts stamping it touches the mint and the take doors, not this file. */
  storeId: string | null
}

/** `{ ok }` on a path that filed an audit row; `{ error }` on every path that
 *  wrote nothing. The shape is the family's own (finalize-take.ts) and it is
 *  load-bearing here: the audit-emission walker (CP7) reads a bare string
 *  return as an unaudited exit, which is exactly what a rescue that files no
 *  row must never look like by accident. */
export type AssembleResult = { ok: 'assembled' } | { error: 'deviceReturned' | 'error' }

/**
 * THE CONTIGUOUS PREFIX FROM ZERO, and the first hole after it.
 *
 * Pure, and exported for its own tests AND for the save-from-server door,
 * which recomputes the same estimate when it writes the duration. A seq that
 * landed after a gap is real on storage and stays there — it simply cannot be part of the take, because
 * what a concatenation promises is that everything up to its end is present
 * and in order. Same rule the pump's `landedUpTo` mark obeys.
 *
 * The six-digit pad makes lexical order numeric, so a plain listing already
 * arrives sorted — sorted again anyway, because a listing's order is the
 * server's promise, not ours.
 */
export function longestPrefix(seqs: number[]): { prefix: number[]; firstGap: number | null } {
  const sorted = [...new Set(seqs)].sort((a, b) => a - b)
  const prefix: number[] = []
  for (const seq of sorted) {
    if (seq !== prefix.length) break
    prefix.push(seq)
  }
  const firstGap = prefix.length === sorted.length ? null : prefix.length
  return { prefix, firstGap }
}

/** Storage's "this key is already taken". The signed-upload endpoint has
 *  answered HTTP 400 with the real code demoted into the body
 *  (`{"statusCode":"409","error":"Duplicate"}`) — read as a plain 400 it looks
 *  retryable, which is how storage-put.ts#putSaysAlreadyThere came to exist.
 *  Same three spellings here, on the service-role client's own error object. */
function isDuplicateRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  if (e.status === 409 || e.statusCode === '409' || e.statusCode === 409) return true
  return typeof e.message === 'string' && /already exists|duplicate/i.test(e.message)
}

/** The ONE warn line this job emits per failure. IDS, STATUS AND STAGE ONLY —
 *  never the key and never storage's own `message`, whose route errors embed
 *  the requested path (i.e. the business and take ids in cleartext, plus
 *  whatever else is in the URL). That is take-binding.ts#warnStorageUnknown's
 *  rule, and it holds for every writer in this family. */
function warnAssembler(
  stage: string,
  businessId: string,
  takeId: string,
  error?: unknown,
): void {
  const e = (error && typeof error === 'object' ? error : {}) as {
    status?: unknown
    statusCode?: unknown
  }
  console.warn(
    JSON.stringify({
      evt: 'assembler_error',
      stage,
      business_id: businessId,
      take_id: takeId,
      status: e.status ?? null,
      statusCode: e.statusCode ?? null,
    }),
  )
}

function bucket() {
  return createServiceClient().storage.from(BUCKET)
}

/** Page one prefix of the bucket, cleanup's walk verbatim: advance by what the
 *  page RETURNED, stop at MAX_PAGES, and say so when a page fails rather than
 *  reading `data: null` as "the tree ended here". */
async function listAll(
  prefix: string,
): Promise<{ entries: { name: string; id: string | null; created_at: string | null; metadata: { size?: number } | null }[]; complete: boolean }> {
  const entries: {
    name: string
    id: string | null
    created_at: string | null
    metadata: { size?: number } | null
  }[] = []
  const handle = bucket()
  let page = 0
  for (let offset = 0; page < MAX_PAGES; page++) {
    const { data, error } = await handle.list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) {
      console.warn(JSON.stringify({ evt: 'assembler_list_error', prefix_depth: prefix.split('/').length }))
      return { entries, complete: false }
    }
    if (!data || data.length === 0) return { entries, complete: true }
    for (const f of data) {
      entries.push({
        name: f.name,
        id: f.id ?? null,
        created_at: f.created_at ?? null,
        metadata: (f.metadata as { size?: number } | null) ?? null,
      })
    }
    offset += data.length
  }
  return { entries, complete: false }
}

/**
 * THE CHEAP QUESTION, asked first: what container is this take in?
 *
 * One `list` with `limit: 1`. The six-digit pad makes lexical order numeric,
 * so the first name a `name asc` listing returns is seq 000000 — and its
 * extension is the whole folder's, because a recorder negotiates one container
 * per take. That is all the key needs, and knowing the key is what lets the
 * walk answer "is this take already on the server" for ONE storage call
 * instead of a full folder listing.
 *
 * Null when the first entry is not this take's segment at all (a stray object
 * sorting before `000000.*` — a dotfile, say). The caller then reads the
 * folder whole, which filters junk properly; it costs the extra listing only
 * in a case that should not exist.
 */
async function peekExt(
  folder: string,
  businessId: string,
  takeId: string,
): Promise<string | null | 'error'> {
  const { data, error } = await bucket().list(`${SEGMENT_ROOT}/${folder}`, {
    limit: 1,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error) {
    console.warn(JSON.stringify({ evt: 'assembler_list_error', prefix_depth: 2 }))
    return 'error'
  }
  const first = data?.[0]
  if (!first || first.id == null) return null
  const parsed = parseRecordingKey(`${SEGMENT_ROOT}/${folder}/${first.name}`, businessId)
  return parsed?.kind === 'segment' && parsed.takeId === takeId ? parsed.ext : null
}

/** The object probe, and what its answer means for a folder. `'unknown'` is
 *  never read as "the key is free" — that is the one answer that must not be
 *  acted on. */
async function probeObject(key: string): Promise<'exists' | 'absent' | 'error'> {
  const answer = await objectExists(key)
  return answer === 'unknown' ? 'error' : answer ? 'exists' : 'absent'
}

/** The finalized key for a folder's take in a given container, or null when
 *  the container is one the closed map does not know. `audio/<ext>` is its own
 *  inverse for every member of that map today (webm · mp4 · ogg · wav), pinned
 *  by recording-assembler.test.ts; composeTakeKey is the fence either way —
 *  a container it cannot resolve composes nothing rather than a guessed key. */
function takeKeyFor(businessId: string, takeId: string, ext: string) {
  return composeTakeKey(businessId, takeId, `audio/${ext}`)
}

/**
 * The take's own leaves, read through THE ONE PARSER.
 *
 * A folder listing is a bag of names; what makes a name this take's segment is
 * parseRecordingKey saying so for this business and this take id — never a
 * prefix match, never a regex twin of the grammar. Anything else in the folder
 * is skipped in silence: junk in the bucket is /api/cleanup's business, and a
 * warn per stray name would flood the log with a healthy tenant's noise.
 */
function readLeaves(
  folder: string,
  businessId: string,
  takeId: string,
  entries: { name: string; id: string | null; created_at: string | null; metadata: { size?: number } | null }[],
): { leaves: SegmentLeaf[]; extMismatch: boolean } {
  const leaves: SegmentLeaf[] = []
  let ext: string | null = null
  let extMismatch = false
  for (const entry of entries) {
    if (entry.id == null) continue // a nested folder placeholder, not an object
    const parsed = parseRecordingKey(`${SEGMENT_ROOT}/${folder}/${entry.name}`, businessId)
    if (parsed?.kind !== 'segment' || parsed.takeId !== takeId) continue
    if (ext === null) ext = parsed.ext
    else if (ext !== parsed.ext) extMismatch = true
    leaves.push({
      name: entry.name,
      seq: parsed.seq,
      ext: parsed.ext,
      createdAtMs: Date.parse(entry.created_at ?? ''),
      size: typeof entry.metadata?.size === 'number' ? entry.metadata.size : null,
    })
  }
  return { leaves, extMismatch }
}

/** The row that reserved exactly this key, or null.
 *
 * Core exposes NO lookup by audio_storage_path (session-mint.ts says so in its
 * own header), so the only way to find a take's row is to list the window it
 * must have been created in and match the pointer client-side. UPLOADING is
 * part of the class itself (design D1): a PROCESSING/COMPLETED/FAILED row's
 * object was read by the worker, so a job-owned row is by construction not a
 * stranded take — which is also why a row that has left UPLOADING is invisible
 * to this query and lands under `noRow`. Named residual, not a silent one.
 */
async function findReservingRow(
  core: { recordings: Pick<SynqedClient['recordings'], 'list'> },
  key: string,
  oldestLeafMs: number,
): Promise<Recording | null> {
  const from = new Date(oldestLeafMs - ROW_WINDOW_MS).toISOString()
  const to = new Date(oldestLeafMs + ROW_WINDOW_MS).toISOString()
  const rows = await paginateDedupe(
    (page) =>
      core.recordings
        .list({ status: 'UPLOADING', from, to, page, page_size: ROW_PAGE_SIZE })
        .then((r) => ({ items: r.recordings, total: r.total })),
    50,
    'assembler rows',
  )
  return rows.find((r) => r.audio_storage_path === key) ?? null
}

/** The prefix's bytes, in seq order, or null when any leaf refused to come
 *  down. A shared cursor so the pool takes the EARLIEST seqs first and the
 *  concatenation is assembled by index, never by completion order. */
async function downloadPrefix(take: StrandedTake): Promise<Buffer | null> {
  const handle = bucket()
  const parts: (Buffer | null)[] = new Array(take.prefix.length).fill(null)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    for (;;) {
      if (failed || next >= take.prefix.length) return
      const index = next++
      const leaf = take.prefix[index]
      const { data, error } = await handle.download(`${SEGMENT_ROOT}/${take.folder}/${leaf.name}`)
      if (error || !data) {
        failed = true
        warnAssembler('download', take.businessId, take.takeId, error)
        return
      }
      parts[index] = Buffer.from(await data.arrayBuffer())
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, take.prefix.length) }, () => worker()),
  )
  if (failed || parts.some((p) => p === null)) return null
  return Buffer.concat(parts as Buffer[])
}

/**
 * ONE stranded take: rebuild its audio, and say so.
 *
 * Download the contiguous prefix, concatenate it, and PUT the result under the
 * key the row already reserved with `upsert: false` — so this PUT is a CREATE,
 * and a refusal is information rather than a problem. A duplicate refusal means
 * the device came back and sealed its own take first: skip, write nothing,
 * file nothing. Any other refusal is a moment in time; the next night asks
 * again, and the walk's own `objectExists` check keeps a rescued take from
 * being rescued twice.
 *
 * The audit row is filed the instant the object lands, because that IS the
 * event: the server rebuilt this take's audio out of the pieces a dead device
 * left behind. It says how many segments there were, how many of them are in
 * the object, where the first hole is, and that the length it reports is an
 * ESTIMATE — nothing on today's main declares how long a take was meant to be
 * (design D2), so completeness is never claimed.
 *
 * ⚖ NO CORE WRITE HERE (amendment 2026-09-06). The duration is not stamped by
 * this job: core fences `PUT /v1/recordings/:id` behind a human actor (core
 * D10, docs/backlog/LIAM_FULL_DUMP_BACKLOG.md:94) and a cron has none. The
 * save-from-server door writes it, with the staffer's own bearer, from the
 * same estimate — SEGMENT_NOMINAL_MS and longestPrefix are exported for it.
 * NAMED CEILING: a rescued take nobody saves keeps a null duration.
 */
export async function assembleStrandedTake(take: StrandedTake): Promise<AssembleResult> {
  const body = await downloadPrefix(take)
  if (body === null) return { error: 'error' }
  // upsert:false, so this PUT is a CREATE: the take's key is immutable and a
  // second writer is refused rather than allowed to overwrite the first.
  const { error } = await createServiceClient()
    .storage.from('recordings')
    .upload(take.key, body, { contentType: take.contentType, upsert: false })
  if (error) {
    if (isDuplicateRefusal(error)) return { error: 'deviceReturned' }
    warnAssembler('upload', take.businessId, take.takeId, error)
    return { error: 'error' }
  }

  // The estimate, declared as one by its own key name. Bytes-over-bitrate was
  // rejected: the recorder negotiates Opus VBR, so a byte count says nothing
  // exact about seconds — while the flush window is a constant this repo owns
  // and pins.
  const estimatedDurationSeconds = Math.floor((take.prefix.length * SEGMENT_NOMINAL_MS) / 1000)

  // ⚖ 8/17 doc law — IDS, NUMBERS AND FLAGS ONLY. No key, no path: the ids
  // below carry everything the key would have said, honestly.
  // no-request-scope: a Vercel cron tick has no inbound request id to thread —
  // the recording_session_id + take_id in detail are the correlation keys (the
  // auto-burn writer's precedent, auto-burn.ts).
  audit({
    category: 'recording',
    action: 'recording.capture_resumed',
    // A cron has no person behind it — the auto-burn writer is the precedent
    // for a system actor (auto-burn.ts).
    actorId: null,
    actorType: 'system',
    businessId: take.businessId,
    targetType: 'recording',
    targetId: take.rowId,
    // `?? undefined` because AuditEvent.storeId is `string | undefined`
    // (audit.ts) — the same spelling playback-url.ts's own emit uses.
    storeId: take.storeId ?? undefined,
    severity: 'notice',
    detail: {
      recording_session_id: take.rowId,
      take_id: take.takeId,
      ext: take.ext,
      segments_present: take.segmentsPresent,
      prefix_length: take.prefix.length,
      first_gap_seq: take.firstGapSeq,
      declared_last_seq: null,
      partial: true,
      bytes: body.byteLength,
      estimated_duration_seconds: estimatedDurationSeconds,
      trigger: 'cron',
    },
    source: 'system',
  })
  return { ok: 'assembled' }
}

/**
 * THE WALK — the bucket is the index, not the DB.
 *
 * `seg/` is tenant-blind and every folder NAMES its own tenant and take, which
 * is the only reason a job with no session can find these at all: core exposes
 * no lookup by storage path, so the folder name IS the join key. Same shape as
 * /api/cleanup's root walk, one level deeper.
 *
 * TWO PHASES on purpose. The root listing is cheap and bounded, so it runs
 * whole first and gives an honest denominator; the per-folder work then runs
 * under the clock. A night that runs out of time has still SEEN every
 * candidate, which is what makes `budgetExhausted` mean "there are more" and
 * never "we were blind".
 *
 * WHAT A FOLDER COSTS. Most folders in `seg/` belong to takes that finished
 * long ago — segments outlive every take that ever recorded, because nothing
 * deletes them — so the common path is deliberately the cheapest: ONE `list`
 * with `limit: 1` (the container) and ONE `objectExists` (is it already on the
 * server), then `continue`. No full listing, no core call. Only a folder whose
 * object is genuinely absent pays for the whole listing, the age arithmetic,
 * the core page and the rebuild.
 *
 * AND THE START ROTATES BY A NIGHT'S REACH. A run cut by the clock keeps no
 * cursor, so beginning at index 0 every night would re-walk the same leading
 * folders forever and never reach the tail — silently, since the route's 200
 * hides it. The start moves ROTATION_STRIDE folders a night and the walk is
 * circular, so nights that each reach at least that many cover everything
 * within ceil(N / ROTATION_STRIDE) nights; a slower night still advances the
 * start by the stride, so what it skipped is reached when the walk comes round
 * — at most N nights, because a PRIME stride puts the start on every index
 * rather than on the gcd lattice. The exact fix, named at the rotation itself,
 * is a resume cursor.
 */
export async function runAssembler(
  deps: AssemblerDeps,
  opts: { budgetMs: number; rotationStride?: number },
): Promise<AssemblerSummary> {
  const deadline = deps.now() + opts.budgetMs
  const summary: AssemblerSummary = {
    candidates: 0,
    assembled: 0,
    partial: 0,
    skipped: {
      young: 0,
      objectExists: 0,
      noRow: 0,
      settled: 0,
      noSeq0: 0,
      extMismatch: 0,
      deviceReturned: 0,
      error: 0,
    },
    walkComplete: true,
    budgetExhausted: false,
  }

  const root = await listAll(SEGMENT_ROOT)
  summary.walkComplete = root.complete
  const folders: { folder: string; businessId: string; takeId: string }[] = []
  for (const entry of root.entries) {
    // storage-js marks a folder placeholder with a null object id — the same
    // signal /api/cleanup skips the `seg` tree itself on. Anything that does
    // not parse as a take folder is junk, and junk is cleanup's business.
    if (entry.id != null) continue
    const parsed = parseSegmentFolder(entry.name)
    if (!parsed) continue
    folders.push({ folder: entry.name, ...parsed })
  }
  summary.candidates = folders.length

  // One client per business per run: the folders arrive interleaved and a
  // client built per folder would be a fresh one per take.
  const clients = new Map<string, { recordings: Pick<SynqedClient['recordings'], 'list'> }>()
  const coreFor = (businessId: string): { recordings: Pick<SynqedClient['recordings'], 'list'> } => {
    const existing = clients.get(businessId)
    if (existing) return existing
    const made = deps.coreFor(businessId)
    clients.set(businessId, made)
    return made
  }

  // ROTATE THE START BY A NIGHT'S REACH. Every folder in `seg/` costs at least
  // the cheap pair above, `seg/` only ever grows (nothing deletes a segment,
  // by law), and a run cut by the clock has no cursor to resume from — so a
  // walk that always began at index 0 would stop in the same place every night
  // and never reach the tail. Today's start is `dayNumber × ROTATION_STRIDE`,
  // and the walk is circular.
  //
  // THE PROPERTY, HONESTLY: while every night in the window reaches at least
  // ROTATION_STRIDE folders, every folder is visited within
  // ceil(N / ROTATION_STRIDE) nights. A slower night still advances the start
  // by the stride, so the folders it skipped are reached when the walk comes
  // round — at most N nights, because the stride is PRIME and the start
  // therefore lands on every index instead of on the gcd(stride, N) lattice.
  // ponytail: a stateless stride, because there is nowhere to keep a cursor;
  // the exact fix — every folder visited on a known night, gap or no gap — is
  // a resume cursor, and that is the upgrade path.
  const stride = opts.rotationStride ?? ROTATION_STRIDE
  const startIndex = folders.length === 0 ? 0 : (Math.floor(deps.now() / DAY_MS) * stride) % folders.length

  for (let i = 0; i < folders.length; i++) {
    const { folder, businessId, takeId } = folders[(startIndex + i) % folders.length]
    if (deps.now() >= deadline || summary.assembled >= MAX_TAKES_PER_RUN) {
      summary.budgetExhausted = true
      break
    }

    // THE CHEAP PAIR, FIRST. One `list` with limit 1 to learn the container,
    // one `objectExists` to ask whether the take is already on the server. A
    // finished take — which is most of them, since segments outlive every take
    // that ever recorded — costs exactly those two calls a night and never
    // reaches core at all.
    const peeked = await peekExt(folder, businessId, takeId)
    if (peeked === 'error') {
      summary.skipped.error++
      continue
    }
    let composed = peeked === null ? null : takeKeyFor(businessId, takeId, peeked)
    if (composed) {
      const probe = await probeObject(composed.key)
      if (probe === 'error') {
        summary.skipped.error++
        continue
      }
      if (probe === 'exists') {
        summary.skipped.objectExists++
        continue
      }
    }

    // The object is absent (or the peek could not name a container): read the
    // folder whole.
    const listing = await listAll(`${SEGMENT_ROOT}/${folder}`)
    if (!listing.complete) {
      // A HALF-LISTED folder must never be rebuilt from: the missing tail
      // would read as a gap, and the short object it produced would go under
      // the take's immutable key where nothing can replace it.
      summary.skipped.error++
      continue
    }
    const { leaves, extMismatch } = readLeaves(folder, businessId, takeId, listing.entries)
    if (extMismatch) {
      summary.skipped.extMismatch++
      continue
    }
    if (leaves.length === 0 || !leaves.some((l) => l.seq === 0)) {
      summary.skipped.noSeq0++
      continue
    }

    if (composed === null) {
      composed = takeKeyFor(businessId, takeId, leaves[0].ext)
      if (composed === null) {
        summary.skipped.extMismatch++
        continue
      }
      const probe = await probeObject(composed.key)
      if (probe === 'error') {
        summary.skipped.error++
        continue
      }
      if (probe === 'exists') {
        summary.skipped.objectExists++
        continue
      }
    }

    // AGE: the NEWEST leaf is the last time the device was heard from — an old
    // FIRST slice says nothing about a take the device was still recording ten
    // minutes ago. An unparseable timestamp reads as NaN, and every comparison
    // against NaN is false, so it is answered explicitly as YOUNG rather than
    // being allowed to read as "old enough"; one unreadable leaf therefore
    // holds the WHOLE folder young rather than sealing on a partial age, and a
    // folder stuck there is invisible by design (skipped-young is silent).
    const newest = Math.max(...leaves.map((l) => l.createdAtMs))
    if (!Number.isFinite(newest) || newest > deps.now() - ASSEMBLE_AFTER_MS) {
      summary.skipped.young++
      continue
    }

    const oldest = Math.min(...leaves.map((l) => l.createdAtMs))
    let row: Recording | null
    try {
      row = await findReservingRow(coreFor(businessId), composed.key, oldest)
    } catch (err) {
      // The error is KEPT: this is the one failure an operator most needs to
      // read, and a bare catch made its status unreadable.
      summary.skipped.error++
      warnAssembler('row_lookup', businessId, takeId, err)
      continue
    }
    if (!row) {
      // Never invent a row. One line, so a folder nobody can explain is
      // visible without a warn per healthy take.
      console.info(JSON.stringify({ evt: 'assembler_no_row', business_id: businessId, take_id: takeId }))
      summary.skipped.noRow++
      continue
    }
    if (row.duration_seconds !== null) {
      // Somebody has settled this row — a reasoned discard stamps a duration
      // too (discard.ts), and a settled row is not a stranded take.
      summary.skipped.settled++
      continue
    }

    // Never START what the wall will interrupt (see TAKE_RESERVE_MS).
    if (deps.now() + TAKE_RESERVE_MS >= deadline) {
      summary.budgetExhausted = true
      break
    }

    const { prefix, firstGap } = longestPrefix(leaves.map((l) => l.seq))
    const bySeq = new Map(leaves.map((l) => [l.seq, l]))
    const result = await assembleStrandedTake({
      businessId,
      takeId,
      folder,
      key: composed.key,
      contentType: composed.contentType,
      ext: composed.ext,
      segmentsPresent: leaves.length,
      prefix: prefix.map((seq) => bySeq.get(seq)!),
      firstGapSeq: firstGap,
      rowId: row.id,
      storeId: row.store_id ?? null,
    })
    if ('error' in result) {
      summary.skipped[result.error]++
      continue
    }
    summary.assembled++
    // Every rescue this job can file is partial: nothing declares a take's
    // length (design D2), so completeness is never claimed.
    summary.partial++
  }

  console.info(JSON.stringify({ evt: 'assembler_run', ...summary }))
  return summary
}

/** The real seam. Everything above takes its core client and its clock from
 *  here, so the tests never reach a network and this is the one place a live
 *  client is built. The client is handed out READ-NARROWED (`list` only) —
 *  this job never writes to core. Storage is reached through
 *  createServiceClient at the call sites (the family's own idiom:
 *  finalize-take.ts, mint-take-url.ts), which is what keeps the bucket write
 *  lexically inside the audited symbol where the coverage registry sees it. */
export function realAssemblerDeps(): AssemblerDeps {
  // FAIL BEFORE THE WALK, not during it. newSynqedClient throws when
  // SYNQED_CORE_URL / SYNQED_CORE_API_KEY are missing (client.ts) — and built
  // lazily inside the loop that throw lands in the per-folder catch, so a
  // deployment with no core env would answer 200 with `skipped.error` equal to
  // `candidates` in a body nobody reads. Constructing one client here makes
  // the same missing env a 500 the scheduler can actually see. The zero uuid
  // is the worker's own idiom for a client built before any tenant is known
  // (process-recording.ts).
  newSynqedClient('00000000-0000-0000-0000-000000000000')
  return {
    coreFor: (businessId: string) => newSynqedClient(businessId),
    now: () => Date.now(),
  }
}

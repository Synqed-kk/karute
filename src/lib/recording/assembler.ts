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
// ⚖ IT ONLY EVER ADDS. It reads the segments, concatenates the longest
// CONTIGUOUS prefix from seq 0, and PUTs the result under the key the row
// already reserved with `upsert: false`. Nothing is deleted — not a segment
// after it is read, not an object it did not write (audio is never deleted;
// scripts/audit/check-audio-never-deleted.mjs is the machine behind that rule).
// A duplicate refusal on the PUT means the device came back and sealed its own
// take first: this skips, silently, and writes nothing at all.
//
// WHY 48 HOURS AND NOT THE INBOX'S 3 (design D1). The device's own drain
// retries every minute the app is open (owed-drain, launch-drain), and a phone
// that comes back within two days secures the WHOLE take itself. Sealing
// earlier would put a PARTIAL object under the take's immutable key and turn
// the returning device's finalize into a terminal `size_mismatch` — a strand
// we inflicted. Two days of silence is where "gone" becomes the likelier truth.
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
 *  mis-time every rescued take. */
export const SEGMENT_NOMINAL_MS = 5_000

/** How many takes one night may seal. A 90-minute take is ~1,000 objects
 *  (~32 MB); twenty of those fit the route's budget on hnd1 with room, and the
 *  field's worst night is a handful. A run that hits it reports
 *  `budgetExhausted` and tomorrow continues. */
export const MAX_TAKES_PER_RUN = 20

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

/** Reasons a folder was passed over. Disjoint except `objectExists`, which is
 *  an ENTRY counter (see AssemblerSummary). */
export interface AssemblerSkipped {
  /** The newest segment is younger than ASSEMBLE_AFTER_MS — the device may
   *  still come back and secure the whole take itself. */
  young: number
  /** The object was ALREADY at the row's key, so nothing was rebuilt from
   *  segments and the run went straight to the stamp half. NOT disjoint from
   *  the outcomes below: it counts the entry, not the ending. */
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
  /** Objects newly written from segments. */
  assembled: number
  /** Takes whose object was already there and whose row this run stamped. */
  stamped: number
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
   *  simply ended — and tomorrow continues. A 200, not a 500. */
  budgetExhausted: boolean
}

export interface AssemblerDeps {
  /** A BUSINESS-SCOPED core client per tenant, built once per run per business
   *  by the caller. The folder names are the only source of a tenant here, and
   *  every core call for a take goes through the client for ITS OWN business —
   *  never one client reused across folders. */
  coreFor(businessId: string): Pick<SynqedClient, 'recordings'>
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
  /** The object was already standing at the key when the walk looked. */
  objectAlreadyThere: boolean
}

/** `{ ok }` on a path that filed an audit row; `{ error }` on every path that
 *  wrote nothing. The shape is the family's own (finalize-take.ts) and it is
 *  load-bearing here: the audit-emission walker (CP7) reads a bare string
 *  return as an unaudited exit, which is exactly what a rescue that files no
 *  row must never look like by accident. */
export type AssembleResult =
  | { ok: 'assembled' | 'stamped' }
  | { error: 'deviceReturned' | 'error' }

/**
 * THE CONTIGUOUS PREFIX FROM ZERO, and the first hole after it.
 *
 * Pure, and exported for its own tests. A seq that landed after a gap is real
 * on storage and stays there — it simply cannot be part of the take, because
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
  core: Pick<SynqedClient, 'recordings'>,
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
 * ONE stranded take, in the two idempotent halves design D3 splits it into.
 *
 * (1) ENSURE THE OBJECT — download the prefix, concatenate, PUT it under the
 *     row's own key with `upsert: false`. A duplicate refusal means the device
 *     came back and sealed its own take: skip, no audit row, no stamp.
 * (2) ENSURE THE STAMP — write the estimated duration, then file the ONE
 *     `recording.capture_resumed` row.
 *
 * Split because a run that dies between them must finish on the next tick. The
 * STAMP-ONLY entry (the object is already there) is fenced by a size equality:
 * the object must weigh exactly what this prefix weighs, which is what proves
 * it IS this concatenation. A different size is the device's own whole take
 * with its finalize in flight — left alone, because that finalize stamps the
 * REAL duration and files capture_finalized.
 *
 * ⚠ THE STAMP CANNOT LAND FROM A CRON ON TODAY'S CORE. `PUT /v1/recordings/:id`
 * has been actor-gated since 2026-09-04 (core #81, docs/actor-auth-contract.md
 * G1 — pinned in actor-bearer-forwarding.test.ts, whose RED PIN is a
 * token-less newSynqedClient making exactly this call), and a 03:07 job has no
 * human actor to forward. Half (1) still lands the object; half (2) throws,
 * counts as `error`, files NO audit row, and re-enters through the size-equal
 * STAMP-ONLY path on the next night — so nothing is lost or double-written,
 * and the day core admits a system actor the rescue completes itself. Reported
 * to Fable with the build; not worked around here, because inventing an actor
 * for a system write is a core decision, not this file's.
 */
export async function assembleStrandedTake(
  deps: AssemblerDeps,
  take: StrandedTake,
): Promise<AssembleResult> {
  let bytes: number
  if (take.objectAlreadyThere) {
    // The size the segments add up to — the only thing that can say whether
    // the object standing at the key is this prefix's concatenation.
    let sum = 0
    for (const leaf of take.prefix) {
      if (leaf.size === null) {
        warnAssembler('leaf_size_unknown', take.businessId, take.takeId)
        return { error: 'error' }
      }
      sum += leaf.size
    }
    const { data, error } = await bucket().info(take.key)
    if (error || !data || typeof data.size !== 'number') {
      warnAssembler('object_size', take.businessId, take.takeId, error)
      return { error: 'error' }
    }
    if (data.size !== sum) return { error: 'deviceReturned' }
    bytes = sum
  } else {
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
    bytes = body.byteLength
  }

  // The estimate, and it is declared as one in the row below. Bytes-over-
  // bitrate was rejected: the recorder negotiates Opus VBR, so a byte count
  // says nothing exact about seconds — while the flush window is a constant
  // this repo owns and pins.
  const durationSeconds = Math.floor((take.prefix.length * SEGMENT_NOMINAL_MS) / 1000)
  try {
    // Status is NOT written: the row is UPLOADING already, and every other
    // status belongs to the job pipeline (take-binding.ts#isJobOwnedStatus).
    await deps
      .coreFor(take.businessId)
      .recordings.update(take.rowId, { duration_seconds: durationSeconds })
  } catch (err) {
    // NO audit row on this path, deliberately: a capture_resumed row for a
    // duration that never landed would be a record of something that did not
    // happen. The object is on storage and the next run re-enters at the
    // stamp half.
    warnAssembler('stamp', take.businessId, take.takeId, err)
    return { error: 'error' }
  }

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
    severity: 'notice',
    detail: {
      recording_session_id: take.rowId,
      take_id: take.takeId,
      ext: take.ext,
      segments_present: take.segmentsPresent,
      prefix_length: take.prefix.length,
      first_gap_seq: take.firstGapSeq,
      // Nothing on today's main declares how long a take was meant to be, so
      // `partial` is true for every rescue and this is null for every one.
      declared_last_seq: null,
      partial: true,
      bytes,
      duration_seconds: durationSeconds,
      duration_estimated: true,
      trigger: 'cron',
    },
    source: 'system',
  })
  return { ok: take.objectAlreadyThere ? 'stamped' : 'assembled' }
}

/**
 * THE WALK — the bucket is the index, not the DB.
 *
 * `seg/` is tenant-blind and every folder NAMES its own tenant and take, which
 * is the only reason a job with no session can find these at all: core exposes
 * no lookup by storage path, so the folder name IS the join key. Same shape as
 * /api/cleanup's root walk, one level deeper.
 *
 * TWO PHASES on purpose. The listing is cheap and bounded, so it runs whole
 * first and gives an honest denominator; the per-take work (four listings,
 * a probe, a core page, a rebuild) then runs under the clock. A night that
 * runs out of time has still SEEN every candidate, which is what makes
 * `budgetExhausted` mean "tomorrow continues" rather than "we were blind".
 */
export async function runAssembler(
  deps: AssemblerDeps,
  opts: { budgetMs: number },
): Promise<AssemblerSummary> {
  const deadline = deps.now() + opts.budgetMs
  const summary: AssemblerSummary = {
    candidates: 0,
    assembled: 0,
    stamped: 0,
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
  const clients = new Map<string, Pick<SynqedClient, 'recordings'>>()
  const coreFor = (businessId: string): Pick<SynqedClient, 'recordings'> => {
    const existing = clients.get(businessId)
    if (existing) return existing
    const made = deps.coreFor(businessId)
    clients.set(businessId, made)
    return made
  }

  for (const { folder, businessId, takeId } of folders) {
    if (deps.now() >= deadline || summary.assembled + summary.stamped >= MAX_TAKES_PER_RUN) {
      summary.budgetExhausted = true
      break
    }

    const listing = await listAll(`${SEGMENT_ROOT}/${folder}`)
    if (!listing.complete) {
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

    // AGE: the NEWEST leaf is the last time the device was heard from. An
    // unparseable timestamp reads as NaN, and every comparison against NaN is
    // false — so it is answered explicitly as YOUNG, never as "old enough".
    const newest = Math.max(...leaves.map((l) => l.createdAtMs))
    if (!Number.isFinite(newest) || newest > deps.now() - ASSEMBLE_AFTER_MS) {
      summary.skipped.young++
      continue
    }

    // Composed, never string-built: composeTakeKey validates the take id and
    // the container against the closed map and re-parses its own output, so
    // the only key that reaches storage is one isOwnRecordingKey would accept
    // for this same business. `audio/<ext>` round-trips every member of that
    // map today; a container it does not know composes nothing and the folder
    // is passed over rather than reached for under a guessed key.
    const ext = leaves[0].ext
    const composed = composeTakeKey(businessId, takeId, `audio/${ext}`)
    if (composed === null) {
      summary.skipped.extMismatch++
      continue
    }

    const exists = await objectExists(composed.key)
    if (exists === 'unknown') {
      // Never assemble on a storage that will not say whether the key is free
      // — that is the one answer that must not be read as "it is".
      summary.skipped.error++
      continue
    }

    const oldest = Math.min(...leaves.map((l) => l.createdAtMs))
    let row: Recording | null
    try {
      row = await findReservingRow(coreFor(businessId), composed.key, oldest)
    } catch {
      summary.skipped.error++
      warnAssembler('row_lookup', businessId, takeId)
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
      summary.skipped.settled++
      continue
    }
    if (exists) summary.skipped.objectExists++

    const { prefix, firstGap } = longestPrefix(leaves.map((l) => l.seq))
    const bySeq = new Map(leaves.map((l) => [l.seq, l]))
    const result = await assembleStrandedTake(deps, {
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
      objectAlreadyThere: exists,
    })
    if ('error' in result) {
      summary.skipped[result.error]++
      continue
    }
    if (result.ok === 'assembled') summary.assembled++
    else summary.stamped++
    // Every rescue this job can file is partial: nothing declares a take's
    // length (design D2), so completeness is never claimed.
    summary.partial++
  }

  console.info(JSON.stringify({ evt: 'assembler_run', ...summary }))
  return summary
}

/** The real seam. Everything above takes its core client and its clock from
 *  here, so the tests never reach a network and this is the one place a live
 *  client is built. Storage is reached through createServiceClient at the call
 *  sites (the family's own idiom: finalize-take.ts, mint-take-url.ts), which
 *  is what keeps the bucket write lexically inside the audited symbol where
 *  the audit-coverage registry can see it. */
export function realAssemblerDeps(): AssemblerDeps {
  return {
    coreFor: (businessId: string) => newSynqedClient(businessId),
    now: () => Date.now(),
  }
}

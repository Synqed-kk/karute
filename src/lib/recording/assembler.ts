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
// the RESCUE key beside the take (`rsc/app_<biz>_<take>.<ext>`, key-grammar.ts)
// with `upsert: false`, and files one audit row saying what it rebuilt. Nothing
// is deleted — not a segment after it is read, not an object it did not write
// (audio is never deleted; scripts/audit/check-audio-never-deleted.mjs is the
// machine behind that rule). A duplicate refusal on the PUT is a concurrent run
// or a blipped probe, never the device — no device writes `rsc/` — and this
// skips, silently, writing nothing at all.
//
// ⚖ AND IT NEVER OCCUPIES THE DEVICE'S OWN KEY (⚖ Liam 2026-09-06, "b"). It
// used to seal the rebuild under the key the row reserved, and that is what
// made a PAUSED phone indistinguishable from a dead one COSTLY rather than
// merely ambiguous: the paused take's key was taken, and the phone's own
// finalize ended at a terminal `size_mismatch` with the full audio stuck on the
// device. Writing beside the take instead leaves that key free for whoever
// comes back, so a resuming phone uploads and finalizes at the size it declared
// and nothing is stuck. Both objects may then exist; every reader prefers the
// phone's (resolveTakeAudio, take-audio.ts). The cost is one extra partial
// object per rescued take, which is never deleted.
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
// that comes back within two days secures the WHOLE take itself — so rescuing
// earlier would spend a download and a PUT on a take that was about to arrive
// whole. Two days of silence is where "gone" becomes the likelier truth. Note
// what this number NO LONGER decides: since the rescue moved off the take's own
// key it can no longer break anything a returning device does, so 48 h chooses
// only WHEN a rescue happens, never what it costs.
//
// ⚖ THE PAUSED PHONE, AND WHY IT IS NO LONGER A CEILING (⚖ Liam 2026-09-06,
// "b", after Greptile #850 point 3). A staffer who paused a take two days ago
// on a phone that is fine, and a phone that died mid-take, look IDENTICAL from
// here: no new segment, the row still UPLOADING, no duration. The recorder's
// 2-hour auto-stop does not separate them either — it measures RECORDED
// milliseconds, not wall time (global-recorder.ts), so a take can sit paused
// indefinitely without it ever firing. There is no server-side signal that
// tells the two apart, and this job does not need one any more: it writes
// BESIDE the take, so the paused phone resumes to find its own key free,
// uploads its whole take, and finalizes at the size it declared. Both objects
// then exist, readers take the phone's, and the only cost is one extra partial
// object. What DOES remain, named: a karute somebody saved off the rescue keeps
// the partial transcript it was made from — no door in the repo re-transcribes
// (regenerate-karute.ts reads the record's own words), so the phone's fuller
// audio becomes playable without becoming written. A "transcribe again from the
// audio" door is the close, and it is a separate decision. (docs/recording-
// resilience.md's T1 section carries the same, for a non-engineer reader.)
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
import { auditDurable } from '@/lib/audit'
import { paginateDedupe } from '@/lib/customers/paginate'
import { createServiceClient } from '@/lib/supabase/service'
import {
  composeRescueKeyFromExt,
  composeTakeKeyFromExt,
  parseRecordingKey,
  parseSegmentFolder,
} from '@/lib/recording/key-grammar'
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
 *  `budgetExhausted`, and tomorrow's run begins at a different point on the
 *  ring — the day's golden-ratio position (goldenStartIndex), which is what
 *  makes the folders tonight could not reach a matter of a few nights rather
 *  than of luck. */
export const MAX_TAKES_PER_RUN = 20

/** Stop STARTING a rebuild with less than this much of the budget left. The
 *  worst take the recorder can produce is 2 h at 48 kbps (~43 MB, ~1,440
 *  segments — global-recorder.ts's own ceiling), which is tens of seconds of
 *  downloading plus one large PUT. Admitting one at 269 s would have the
 *  function killed at the 300 s wall mid-PUT, and storage may still complete
 *  that PUT server-side — leaving an object no run will ever audit, because
 *  the next night meets it and skips.
 *  It ends the WALK, not just the rebuild: a run that can no longer start one
 *  has nothing left worth classifying tonight. Tomorrow's run begins at the
 *  next night's golden-ratio point, so the folders tonight did not reach are
 *  reached within a few nights whatever the folder count (goldenStartIndex). */
const TAKE_RESERVE_MS = 30_000

/** One day in ms — the rotation's period (see runAssembler). */
const DAY_MS = 86_400_000

/** The fractional part of the golden ratio, φ − 1 = 1/φ. The one irrational
 *  whose multiples spread across a ring more evenly than any other's (the
 *  worst-approximable number: its continued fraction is all 1s). */
const PHI_FRAC = 0.6180339887498949

/**
 * WHERE TONIGHT'S WALK BEGINS — a golden-ratio point on the ring of folders.
 *
 * Nothing carries a cursor between runs, so a walk that always began at index
 * 0 would stop in the same place every night and never reach the tail —
 * silently, since the route still answers 200. The start therefore moves, and
 * `frac(day × φ) × N` is where it moves to: the day's position on the unit
 * circle, scaled onto the folder count.
 *
 * THE PROPERTY, HONESTLY STATED. A fixed STRIDE walks a lattice — its starts
 * are the multiples of gcd(stride, N), so some folder counts leave a band
 * nothing ever visits, and no choice of stride escapes that for every N (a
 * prime stride only pushes the bad case out to multiples of itself). A
 * golden-ratio Weyl sequence has no modulus in it at all: its points are
 * equidistributed on the ring for EVERY N, with no lattice and no residual.
 *
 * The three-gap theorem is what makes that a promise rather than a hope: after
 * m nights the largest untouched arc is at most about 1.9/m of the ring — the
 * three-gap constant for the golden Weyl sequence, 1 + 2/√5 ≈ 1.894, the
 * golden ratio's own bound, and the smallest any irrational achieves. So with
 * a night's reach of K folders, every folder is visited within roughly
 *
 *     ceil(1.894 · N / K) + 1   nights
 *
 * (the +1 pays for the arc that straddles tonight's own window). At 6,000
 * folders and a 2,000-folder night that is 7 nights, for any N — including the
 * counts a stride of 1,999 could not promise, such as N = 3,998, where that
 * stride only ever starts at two places on the whole ring.
 *
 * A NIGHT'S REACH, for scale: a folder whose take is already on the server
 * costs the cheap pair — one `list` with limit 1 and one `objectExists`. Two
 * same-region round trips at ~60 ms each is ~120 ms a folder, so the route's
 * 270 s reaches roughly 2,250 of them. K is not a number this file sets; it is
 * whatever the night managed, and the bound above is stated in terms of it.
 *
 * ponytail: stateless, because there is nowhere to keep a cursor. The exact
 * fix — every folder visited on a known night, gap or no gap — is a resume
 * cursor, and that is the upgrade path.
 */
export function goldenStartIndex(dayNumber: number, n: number): number {
  if (n <= 0) return 0
  return Math.floor(((dayNumber * PHI_FRAC) % 1) * n)
}

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
 *  sit — ASYMMETRIC, because the two directions bound different things
 *  (⚖ ADDENDUM 9.2 M3).
 *
 *  BEFORE: the row is minted the moment recording STARTS and the first segment
 *  lands one flush window later — UNLESS the staffer paused inside that first
 *  window, in which case the row can be arbitrarily older than its own first
 *  leaf. This used to read "the 2-hour AUTO_STOP bounds any pause", which is
 *  FALSE: AUTO_STOP measures RECORDED milliseconds, not wall time
 *  (global-recorder.ts), so it never fires on a pause at all. Twenty-four hours
 *  covers every pause anyone plausibly resumes from while keeping the listing
 *  bounded.
 *
 *  AFTER: nothing creates the row after its own segments, so six hours is pure
 *  clock-skew allowance.
 *
 *  NAMED CEILING: a take paused for more than 24 h BEFORE its first flush is
 *  not found by this query and lands under `skipped.noRow` — never a wrong row,
 *  only an unfound one, and the segments stay for a later fix. */
const ROW_WINDOW_BEFORE_MS = 24 * 60 * 60 * 1000
const ROW_WINDOW_AFTER_MS = 6 * 60 * 60 * 1000

/** The tree the segment pump writes into — the ONE prefix this job walks. */
const SEGMENT_ROOT = 'seg'
const BUCKET = 'recordings'

/** Reasons a folder was passed over — one per folder, disjoint: every folder
 *  the walk does not rescue lands in exactly one of these. */
export interface AssemblerSkipped {
  /** The newest segment is younger than ASSEMBLE_AFTER_MS — the device may
   *  still come back and secure the whole take itself. */
  young: number
  /** The DEVICE'S OWN object is at the take's key — the phone finalized this
   *  take itself, at stop or on a later drain. The whole recording is on the
   *  server and there is nothing to rebuild. The ordinary case for a healthy
   *  tenant, whose finished takes still have their segments beside them. */
  objectExists: number
  /** The RESCUE object is already there: this take was rebuilt on an earlier
   *  night and the phone has not returned since. Disjoint from `objectExists`
   *  on purpose — that one means the device came through, this one means it
   *  has not — and the rescue is written once and never rewritten.
   *
   *  A COUNTER IS ENOUGH (⚖ ADDENDUM 9.2 M5): the visibility a staffer needs
   *  is her own 録音履歴 row, which reads 復元可能 with 保存する once PR-C
   *  lands, and the receipt an operator needs is the `capture_resumed` audit
   *  row this job filed the night it rebuilt the take. Neither of those wants a
   *  nightly re-announcement of a take already rescued. */
  rescued: number
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
  /** The PUT was refused as a duplicate: something already holds the rescue
   *  key. Not the device — no device ever writes `rsc/` — so this is a
   *  concurrent run of this same job, or a probe that read 'absent' on a blip.
   *  Nothing written, nothing audited; the object that IS there was written by
   *  the same code from the same segments. */
  duplicate: number
  /** Storage or core would not answer. Retried on the next night's run. */
  error: number
}

export interface AssemblerSummary {
  /** Folders in `seg/` that parse as a take folder — the denominator. */
  candidates: number
  /** Objects newly written from segments — one audit row each. */
  assembled: number
  /** Rescues whose object LANDED but whose receipt did not: the durable
   *  capture_resumed row came back unwritten (`ok: false` — core refused, or
   *  the sink is not configured). The audio IS rescued and still counts under
   *  `assembled`; what is missing is the row that explains it, and the rescue
   *  key is now occupied, so every later night meets `skipped.rescued` and no
   *  run ever retries the receipt on its own. That is why any count above zero
   *  turns the run's HTTP status red (route.ts): a rescue with no receipt must
   *  never read as a green night. The console line — sink 1, emitted by the
   *  same call — still carries the event into the log drain, so the trail is
   *  degraded rather than gone. Named upgrade: a reconciler that walks sealed
   *  objects with no row and re-emits. */
  auditLost: number
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
   *  simply ended, and tomorrow's run begins at the next night's golden-ratio
   *  point on the same circular list, so with a night's reach K every folder
   *  is visited within about ceil(1.894 · N / K) + 1 nights, for every folder
   *  count (goldenStartIndex). A 200, not a 500. */
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
  /** The row's own reserved pointer — the DEVICE'S key, composed through the
   *  grammar. Nothing is ever written here: it is the value the walk matched
   *  `row.audio_storage_path` against, kept so the match fence and the upload
   *  target are visibly two different things. */
  key: string
  /** …and where the rebuild actually goes: `rsc/` + the key above (⚖ Liam
   *  2026-09-06, "b"). Beside the take, never on it, so a phone that was only
   *  paused comes back to a free key. */
  rescueKey: string
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

/** `{ ok }` on a path that WROTE the object; `{ error }` on every path that
 *  wrote nothing. The shape is the family's own (finalize-take.ts) and it is
 *  load-bearing here: the audit-emission walker (CP7) reads a bare string
 *  return as an unaudited exit, which is exactly what a rescue that files no
 *  row must never look like by accident.
 *
 *  `auditLost` rides on the OK side because the two facts are independent: the
 *  audio is on the server either way, and the receipt is a separate promise
 *  that either landed or did not. Folding a lost receipt into `{ error }`
 *  would report the rescue as not having happened, which is the opposite lie. */
export type AssembleResult = { ok: 'assembled'; auditLost: boolean } | { error: 'duplicate' | 'error' }

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

/**
 * WHERE THIS TAKE'S AUDIO ALREADY IS — the walk's ONE spelling, for its two
 * call sites (⚖ Liam 2026-09-06, "b").
 *
 * The two sites differ only in how they learned the container (the cheap peek,
 * or the folder's first real leaf), so folding the probes here keeps one order
 * rather than two copies of it — and the order is the whole rule: the phone's
 * own key FIRST, and the rescue asked about only when that one is proven
 * absent. A finished take therefore still costs exactly one probe a night; only
 * a phone-absent folder pays for the second.
 *
 * `'absent'` is BOTH proven missing — the one answer that means "rebuild this".
 * `'error'` is any probe that could not answer, and it is never read as free:
 * writing on an unanswerable probe is how a duplicate 409 gets manufactured.
 *
 * The composition cannot fail here: both wrappers validate the same take id
 * against the same closed container map, and the caller has already composed
 * the take key from this same ext before it calls. A null is therefore a
 * grammar/composer drift, and it answers 'error' rather than throwing into a
 * walk that has no catch around this line.
 */
async function probeTake(
  businessId: string,
  takeId: string,
  ext: string,
): Promise<'main' | 'rescue' | 'absent' | 'error'> {
  const main = composeTakeKeyFromExt(businessId, takeId, ext)
  const rescue = composeRescueKeyFromExt(businessId, takeId, ext)
  if (main === null || rescue === null) return 'error'
  const own = await probeObject(main.key)
  if (own !== 'absent') return own === 'exists' ? 'main' : 'error'
  const side = await probeObject(rescue.key)
  return side === 'exists' ? 'rescue' : side
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
  const from = new Date(oldestLeafMs - ROW_WINDOW_BEFORE_MS).toISOString()
  const to = new Date(oldestLeafMs + ROW_WINDOW_AFTER_MS).toISOString()
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
 * take's RESCUE key with `upsert: false` — beside the device's own key, never
 * on it (⚖ Liam 2026-09-06, "b"), so the phone that was merely paused finds its
 * key free when it resumes.
 *
 * `upsert: false` still makes this PUT a CREATE, and a refusal is still
 * information — but it says something different now. No device ever writes
 * `rsc/`, so a duplicate here is a concurrent run of this same job or a probe
 * that read 'absent' on a blip: `duplicate`, skip, write nothing, file nothing.
 * Whatever stands there was written by this same code from these same segments.
 * Any other refusal is a moment in time; the next night asks again, and the
 * walk's own rescue probe keeps a rescued take from being rescued twice.
 *
 * The audit row is filed the instant the object lands, because that IS the
 * event: the server rebuilt this take's audio out of the pieces a dead device
 * left behind. It says how many segments there were, how many of them are in
 * the object, where the first hole is, and that the length it reports is an
 * ESTIMATE — nothing on today's main declares how long a take was meant to be
 * (design D2), so completeness is never claimed. It is AWAITED and DURABLE
 * (auditDurable, the discard receipt's emitter), and a row that did not land
 * comes back as `auditLost: true` — the run's own red flag, see the field's
 * note on AssemblerSummary.
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
  // THE RESCUE KEY, not the row's pointer — the take's own key stays free for
  // the device. upsert:false, so this PUT is a CREATE: the rescue is written
  // once and a second writer is refused rather than allowed to overwrite it.
  const { error } = await createServiceClient()
    .storage.from('recordings')
    .upload(take.rescueKey, body, { contentType: take.contentType, upsert: false })
  if (error) {
    if (isDuplicateRefusal(error)) return { error: 'duplicate' }
    warnAssembler('upload', take.businessId, take.takeId, error)
    return { error: 'error' }
  }

  // The estimate, declared as one by its own key name. Bytes-over-bitrate was
  // rejected: the recorder negotiates Opus VBR, so a byte count says nothing
  // exact about seconds — while the flush window is a constant this repo owns
  // and pins.
  const estimatedDurationSeconds = Math.floor((take.prefix.length * SEGMENT_NOMINAL_MS) / 1000)

  // THE RECEIPT IS AWAITED AND DURABLE, and a lost one is counted (⚖ 2026-09-07,
  // Greptile #850 point 1). auditDurable is the discard receipt's own emitter
  // (discard.ts): same console line, then the core row AWAITED, and the outcome
  // handed back. Its CONTRACT, read at source: it never throws — a refused
  // forward, a missing sink env and any thrown error all come back as
  // `{ ok: false }` (forwardToCore swallows and counts). So `ok` is the whole
  // question, and there is nothing here to catch.
  //
  // Why this and not fire-and-forget audit(): the object is at the rescue key
  // the moment the PUT lands, so every later night meets the RESCUE PROBE and
  // skips (`skipped.rescued`). A dropped row is therefore permanent — nothing
  // retries it, and the take's rebuilt audio would exist with nobody able to
  // say what rebuilt it. The run reports the loss instead of hiding it.
  //
  // ⚖ 8/17 doc law — IDS, NUMBERS AND FLAGS ONLY. No key, no path: the ids
  // below carry everything the key would have said, honestly.
  // no-request-scope: a Vercel cron tick has no inbound request id to thread —
  // the recording_session_id + take_id in detail are the correlation keys (the
  // auto-burn writer's precedent, auto-burn.ts).
  const receipt = await auditDurable({
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
  // Ids only, as every warn in this family is: the take is findable, the log
  // drain already holds the console half of the receipt.
  if (!receipt.ok) warnAssembler('audit', take.businessId, take.takeId)
  return { ok: 'assembled', auditLost: !receipt.ok }
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
 * with `limit: 1` (the container) and ONE `objectExists` (did the device put
 * its own take on the server), then `continue`. No full listing, no core call.
 * A folder whose device object is ABSENT pays for one more probe — the rescue
 * key, which says whether an earlier night already rebuilt this take — and only
 * a folder that fails both pays for the whole listing, the age arithmetic, the
 * core page and the rebuild.
 *
 * AND THE START MOVES TO THE DAY'S GOLDEN-RATIO POINT. A run cut by the clock
 * keeps no cursor, so beginning at index 0 every night would re-walk the same
 * leading folders forever and never reach the tail — silently, since the
 * route's 200 hides it. The start is `frac(day × φ) × N` and the walk is
 * circular: those points are equidistributed on the ring for EVERY folder
 * count, with no lattice and no residual, so with a night's reach K every
 * folder is visited within about ceil(1.894 · N / K) + 1 nights. The full
 * argument, and the upgrade a resume cursor would buy, sit at goldenStartIndex.
 */
export async function runAssembler(
  deps: AssemblerDeps,
  opts: {
    budgetMs: number
    /** THE TEST SEAM for the walk's starting point: `(dayNumber, n) => index`.
     *  Defaults to goldenStartIndex, which is what production runs. Injected,
     *  a case can put the walk exactly where it needs it without inventing a
     *  clock that happens to land there. */
    startIndexFor?: (dayNumber: number, n: number) => number
  },
): Promise<AssemblerSummary> {
  const deadline = deps.now() + opts.budgetMs
  const summary: AssemblerSummary = {
    candidates: 0,
    assembled: 0,
    partial: 0,
    skipped: {
      young: 0,
      objectExists: 0,
      rescued: 0,
      noRow: 0,
      settled: 0,
      noSeq0: 0,
      extMismatch: 0,
      duplicate: 0,
      error: 0,
    },
    auditLost: 0,
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

  // WHERE TONIGHT BEGINS — the day's golden-ratio point on the ring (see
  // goldenStartIndex for the property and its bound). The walk is circular, so
  // the start is the only thing that has to move.
  //
  // The modulo is not belt-and-braces on the default (which is in range by
  // construction) but on the SEAM: `startIndexFor` is injectable, and a walk
  // that indexed off the end of the array on a handed-in number would skip
  // folders silently instead of failing.
  const startIndexFor = opts.startIndexFor ?? goldenStartIndex
  const startIndex =
    folders.length === 0
      ? 0
      : ((startIndexFor(Math.floor(deps.now() / DAY_MS), folders.length) % folders.length) +
          folders.length) %
        folders.length

  for (let i = 0; i < folders.length; i++) {
    const { folder, businessId, takeId } = folders[(startIndex + i) % folders.length]
    if (deps.now() >= deadline || summary.assembled >= MAX_TAKES_PER_RUN) {
      summary.budgetExhausted = true
      break
    }

    // THE CHEAP PAIR, FIRST. One `list` with limit 1 to learn the container,
    // one `objectExists` to ask whether the DEVICE'S own take is already on the
    // server. A finished take — which is most of them, since segments outlive
    // every take that ever recorded — costs exactly those two calls a night and
    // never reaches core at all.
    //
    // AND ONE MORE PROBE ONLY WHEN THE PHONE'S OBJECT IS ABSENT (⚖ Liam
    // 2026-09-06, "b"): the rescue key, which says whether an earlier night
    // already rebuilt this take. That third call is paid for only by a folder
    // whose device has not come through — never by a healthy tenant's finished
    // takes. See probeTake for the order and what each answer means.
    const peeked = await peekExt(folder, businessId, takeId)
    if (peeked === 'error') {
      summary.skipped.error++
      continue
    }
    let composed = peeked === null ? null : composeTakeKeyFromExt(businessId, takeId, peeked)
    if (composed) {
      const where = await probeTake(businessId, takeId, composed.ext)
      if (where === 'error') {
        summary.skipped.error++
        continue
      }
      if (where === 'main') {
        summary.skipped.objectExists++
        continue
      }
      if (where === 'rescue') {
        summary.skipped.rescued++
        continue
      }
    }

    // The object is absent (or the peek could not name a container): read the
    // folder whole.
    const listing = await listAll(`${SEGMENT_ROOT}/${folder}`)
    if (!listing.complete) {
      // A HALF-LISTED folder must never be rebuilt from: the missing tail
      // would read as a gap, and the short object it produced would go under
      // the RESCUE key, which is written once and never rewritten — so the next
      // night would meet it and skip, and nothing could ever replace it.
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
      composed = composeTakeKeyFromExt(businessId, takeId, leaves[0].ext)
      if (composed === null) {
        summary.skipped.extMismatch++
        continue
      }
      const where = await probeTake(businessId, takeId, composed.ext)
      if (where === 'error') {
        summary.skipped.error++
        continue
      }
      if (where === 'main') {
        summary.skipped.objectExists++
        continue
      }
      if (where === 'rescue') {
        summary.skipped.rescued++
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

    // The side key the rebuild goes to. Composed from the SAME container the
    // pointer match above used, so the two keys are the same take's by
    // construction; a null cannot happen (composed proves the container is in
    // the closed map) and reads as an ext the grammar refuses if it ever does.
    const rescue = composeRescueKeyFromExt(businessId, takeId, composed.ext)
    if (rescue === null) {
      summary.skipped.extMismatch++
      continue
    }

    const { prefix, firstGap } = longestPrefix(leaves.map((l) => l.seq))
    const bySeq = new Map(leaves.map((l) => [l.seq, l]))
    const result = await assembleStrandedTake({
      businessId,
      takeId,
      folder,
      key: composed.key,
      rescueKey: rescue.key,
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
    // The audio landed; its receipt may not have. Counted here rather than
    // demoted into `skipped`, because the rescue DID happen — see the field.
    if (result.auditLost) summary.auditLost++
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

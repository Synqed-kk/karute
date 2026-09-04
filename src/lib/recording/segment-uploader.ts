// THE SEGMENT PUMP — the audio reaches the server WHILE it is being recorded
// (slice five packet C, D7; design v2 items 2 + 6 + V2.1, design v1 §3 R1).
//
// Until this round a take existed in exactly two places: on the device, and —
// only after the staffer stopped — on the server. Everything between the first
// word and the stop was device-only, so a phone that died, was wiped, or walked
// out of the salon mid-session took the whole recording with it. The flush layer
// has been writing a segment to IndexedDB every ~5 s all along; nothing ever
// sent them. This does, and it is the whole of the change: after every flush
// that wrote, the segments the server does not have yet go up under the take's
// own folder.
//
// ⚖ R1, STATED HONESTLY. This does NOT make the recording live on the server.
// While the app is foregrounded the server is one flush (~5 s) plus upload
// latency behind the microphone. Backgrounded or with the phone locked, capture
// itself is suspended (T4 — pre-existing, not this round's), so there is nothing
// to pump and nothing new arrives until the app is in front again. The claim
// this earns is bounded and real: what the device HAD is no longer only on the
// device.
//
// ⚖ NOTHING HERE DELETES (item 6, and v1's "no segment dedup delete"). Not a
// segment after it lands, not a device copy, not anything. Segments and the
// finalized whole-take object both stay: the finalized object is what the
// pipeline reads, and the segments are what an assembler (a later slice) can
// rebuild a take that never stopped out of. Byte length is not proof of
// identity, so "the same bytes are up there twice" is never a reason to remove
// either copy.
//
// ⚖ AND `uploadedSeq` ADVANCES ONLY ON PROOF. Storage's own 2xx, or an object
// already at the key whose byte length is this device's own segment (the mint's
// `existingSize`). Never on a mint alone — that only hands out a URL; never on
// a PUT that was merely launched; and never on a bare 409, because a segment key
// is COMPOSABLE IN ADVANCE, so meeting an object there is not evidence anyone
// recorded it. That is the same rule packet B's fix round 2 gave the staged
// copy, and it matters more here: the assembler will one day build a take out
// of these objects, and a pre-filled one must never stand in for the device's
// bytes inside evidence.
//
// THE GUARANTEE THAT SUPERSEDES ALL OF IT is the whole-take secure at stop
// (secure-take.ts): a stopped take is PUT whole under its immutable finalized
// key and finalized against its row, whatever the segments did. So every
// failure in this file is a lost head start, never a lost recording — which is
// why nothing here touches `secureError`, and why a terminal answer marks
// `segmentError` alone.

import {
  listTakeSegmentsAfter,
  markSegmentError,
  markSegmentsUploaded,
  readTakeUploadMeta,
  TERMINAL_SECURE_ERRORS,
} from '@/lib/karute/take-store'
import type { RecordingPipelinePort } from '@/lib/ports/recording-port'
import { PUT_BYTES_PER_MS } from '@/lib/recording/storage-put'

/** How many seqs one mint asks for. Five minutes of capture at one segment per
 *  ~5 s — the catch-up a phone that lost the network for a while owes — and it
 *  is also what bounds the storage probes the door makes per call. Pinned to
 *  the schema's own cap (record-schemas.ts MAX_SEGMENT_BATCH); a larger list is
 *  a 400 at the door, so this number is a contract, not a preference. */
export const SEGMENT_BATCH = 60
/** How many PUTs are in flight at once. Three, not the whole batch: this runs
 *  DURING a recording, on salon wifi or a phone's uplink, and the capture that
 *  is still going is what must never be starved of bandwidth. Sequential would
 *  be safest and too slow to catch up; the whole batch at once is a stall. */
export const SEGMENT_CONCURRENCY = 3
/** The backoff after any refusal, doubling to a ceiling. It exists because the
 *  trigger is a FLUSH — one every ~5 s — so a take whose door is refusing would
 *  otherwise ask twelve times a minute for the length of a session. */
export const SEGMENT_BACKOFF_MIN_MS = 5_000
export const SEGMENT_BACKOFF_MAX_MS = 60_000
/** ⚖ A SEGMENT'S OWN DEADLINE FLOOR (rebase round 1, R2). `putDeadlineMs`'s
 *  60 s floor is written for a TAKE — "never under a minute", because the same
 *  number that mercy-kills a stalled 2 MB upload must not cut a 90-minute one
 *  off mid-flight. A segment is ~5 s of audio, tens of kilobytes, and the stop
 *  leg AWAITS this pump before it secures the whole take: on a dead link three
 *  in-flight PUTs of ~30 KB would hold the stop for the full 60 s before
 *  secureTake even started, and `awaitTakeSecured`'s 120 s belt then fires on
 *  the in-tab reader waiting behind it. Fifteen seconds is still far past any
 *  honest segment on the 10 KB/s rate below (150 KB — thirty times a real one),
 *  so this shortens no upload that was going to succeed; it only stops a socket
 *  that will never answer from spending the stop leg's minute.
 *
 *  The RATE is storage-put's and is imported, never re-stated: one rate, two
 *  floors. A refused segment is never lost either — it backs off and the next
 *  flush asks again, and the whole take goes up under its own key regardless. */
export const SEGMENT_PUT_FLOOR_MS = 15_000
const segmentDeadlineMs = (bytes: number) =>
  Math.max(SEGMENT_PUT_FLOOR_MS, Math.ceil(bytes / PUT_BYTES_PER_MS))

/**
 * SINGLE-FLIGHT PER TAKE. The pump is fired from the flush queue and awaited by
 * the stop leg, so two calls can genuinely overlap — and two overlapping runs
 * would mint the same seqs twice and PUT the same immutable keys twice, where
 * the second copy can only be refused. A second caller gets the RUNNING promise,
 * which is what makes the stop leg's `await` mean "the pump has finished",
 * whichever call started it.
 */
const inFlight = new Map<string, Promise<void>>()

/**
 * ⚖ AND "JOINED" IS NOT "SAW THE TAIL" (slice five packet C fix round 1, K3).
 * The one follow-up run a `fresh` caller is owed, per take.
 *
 * Single-flight above answers "has the pump finished?", which is the right
 * answer for every flush-time call and the WRONG one for the stop leg. A run
 * takes its row list ONCE, at its own start; a run that started at the flush
 * before the stop listed the disk before the tail segment was written to it. So
 * the stop leg joining that run and calling it "the segments are up" is a claim
 * about a snapshot taken five seconds before the moment it cares about — and
 * item 2's order (last segment PUT → whole-take PUT) quietly stops holding on
 * exactly the slow link it was written for.
 *
 * `fresh: true` therefore means a run that STARTS AFTER any run already in
 * flight. ONE follow-up, never a queue: a second `fresh` caller during the same
 * run gets the same follow-up, because one run that starts after this one is
 * all any of them asked for.
 */
const pendingFresh = new Map<string, Promise<void>>()

/**
 * The per-take backoff window. MEMORY ONLY, and deliberately: it dies with the
 * page, and the next page's first flush pumps again — which is the behaviour
 * that is wanted, because a reload is a new attempt at everything. Persisting it
 * would cost a store write per refusal on the capture hot path to slow down a
 * retry that a reload already means to make.
 */
const backoff = new Map<string, { until: number; step: number }>()

/**
 * ⚖ AND HOW MANY SEQS TO ASK FOR, WHICH IS NOT A CONSTANT (fix round 2, M2).
 * The door's own ceiling is SEGMENT_BATCH and that is what a take starts at.
 * But a full catch-up is the batch's worth of storage round trips inside the
 * caller's 30 s door, so on slow storage the answer can expire before it
 * arrives — and asking for the SAME sixty again, for as long as the latency
 * lasts, is a recording that never catches up. `upstream` is the code both
 * arms give a door that ran out of time, so it HALVES the next ask; a mint
 * that answers restores the ceiling.
 *
 * Progress is guaranteed by the floor: a batch of one is two storage calls,
 * which no honest door misses — so the prefix advances by at least one segment
 * per flush even on the worst link this can meet. Memory only, like the
 * backoff beside it, and for the same reason.
 */
const batchAsk = new Map<string, number>()

function bumpBackoff(takeId: string): void {
  const step = (backoff.get(takeId)?.step ?? 0) + 1
  // Jittered, so a salon of phones that all lost the same access point do not
  // come back in lockstep and refuse together again.
  const wait =
    Math.min(SEGMENT_BACKOFF_MAX_MS, SEGMENT_BACKOFF_MIN_MS * 2 ** (step - 1)) +
    Math.random() * SEGMENT_BACKOFF_MIN_MS
  backoff.set(takeId, { until: Date.now() + wait, step })
}

/** ⚖ AND A PUMP THAT STOPPED FOR GOOD SAYS SO ONCE (slice five packet C fix
 *  round 1, R1). `segmentError` is read by this file's own early return and by
 *  nothing else — no 要対応 row, no audit — so a take whose head start was
 *  switched off permanently used to leave no trace anywhere a person or a log
 *  could meet it. One line at MARK TIME, which is once per take and never on a
 *  retryable refusal, makes the one thing worth knowing legible: this take is
 *  no longer sending segments, and why. */
async function stopSegments(takeId: string, code: string): Promise<void> {
  console.warn('[segment-uploader] segments stopped for', takeId, code)
  await markSegmentError(takeId, code)
}

/** ONE segment PUT, under its own size-derived deadline.
 *
 *  `segmentDeadlineMs` is storage-put's RATE (~10 KB/s of the blob's own size,
 *  `PUT_BYTES_PER_MS`, imported so a segment and its take can never drift into
 *  two upload policies) under a floor of this file's own — see
 *  SEGMENT_PUT_FLOOR_MS for why a take's 60 s is the wrong number for ~5 s of
 *  audio the stop leg is waiting behind. A segment is small, so in practice
 *  this IS the floor: it exists to release a socket that will never answer, not
 *  to police a slow one.
 *
 *  AbortController + a timer, never AbortSignal.timeout: that static is absent
 *  from jsdom (this file's own tests) and from WebViews older than Chrome 103,
 *  where reaching for it would throw and fail every segment.
 *
 *  ⚖ LANDED IS `put.ok` AND NOTHING ELSE. A 409 here — in either spelling — is
 *  NOT a landing: the mint probed this key a moment ago and found it free, so
 *  an object appearing since is a race the door did not see, and the next
 *  pump's mint answers it with a SIZE, which is the only form of "already
 *  there" this path may act on. */
async function putSegment(url: string, blob: Blob, contentType: string): Promise<boolean> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), segmentDeadlineMs(blob.size))
  try {
    const put = await fetch(url, {
      method: 'PUT',
      // The SERVER's contentType for the key it composed, never a guess of
      // ours: the key's extension and this header come off the same closed map,
      // so the object's label and its name can never disagree.
      headers: { 'content-type': contentType },
      body: blob,
      signal: deadline.signal,
    })
    return put.ok
  } catch {
    // An abort, a dead socket, a WebView that killed the request. All moments
    // in time: the seq is simply not landed, the pool stops launching more, and
    // the backoff below decides when to ask again.
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Send whatever of this take the server does not have yet. Fire-and-forget from
 * the flush queue; awaited exactly once, by the stop leg, right before the
 * whole-take PUT (⚖ v2 item 2: last segment PUT → whole-take PUT → finalize).
 *
 * NEVER THROWS. Its callers are the capture path and the stop leg, and neither
 * may be failed by an upload: every refusal here is recorded on the take (or in
 * the backoff map) and the take carries on exactly as it would have.
 *
 * `fresh: true` asks for a run that STARTS after any run already in flight —
 * the stop leg's ask, and only its ask (see `pendingFresh`). Without it, an
 * overlapping call joins the running one, which is what every flush-time
 * trigger wants. It also skips the backoff window, for the reason written at
 * that check: the stop is the one moment the tail is a PROMISE rather than a
 * retry.
 */
export async function pumpSegments(
  port: RecordingPipelinePort,
  takeId: string,
  opts?: { fresh?: boolean },
): Promise<void> {
  const running = inFlight.get(takeId)
  if (!running) return startPump(port, takeId, opts)
  if (!opts?.fresh) return running
  const waiting = pendingFresh.get(takeId)
  if (waiting) return waiting
  const followUp = running
    // pumpOnce never rejects — one try/catch around its whole body — and this
    // keeps that true of the composed promise the stop leg awaits bare.
    .catch(() => {})
    .then(() => {
      // Cleared as the follow-up STARTS, not when it ends. A `fresh` caller
      // arriving from here on is asking for a run that starts after THIS one,
      // and handing it this one would be the very join the option refuses.
      pendingFresh.delete(takeId)
      // ⚖ AND THE SLOT IS STILL OWNED BY EXACTLY ONE RUN (fix round 2, M3).
      // The run this followed cleared `inFlight` in a `.finally` that fires
      // BEFORE this callback, so a flush-time call landing in that gap has
      // already started a run of its own. Starting a second one here would put
      // TWO runs on the same take: the same seqs minted twice, the same
      // immutable keys PUT twice, the loser reading a 409 as a refusal and
      // arming a backoff on a take that is doing fine.
      //
      // THE INVARIANT, stated: `inFlight` holds at most one run per take at any
      // instant, and what `fresh` promises is a START-AFTER, not a run of its
      // own. A run found here necessarily started after the previous one
      // settled, so it read the store after it — which is exactly the property
      // the stop leg needs, and joining it satisfies the ask.
      const live = inFlight.get(takeId)
      return live ?? startPump(port, takeId, opts)
    })
  pendingFresh.set(takeId, followUp)
  return followUp
}

function startPump(
  port: RecordingPipelinePort,
  takeId: string,
  opts?: { fresh?: boolean },
): Promise<void> {
  const run = pumpOnce(port, takeId, opts).finally(() => inFlight.delete(takeId))
  inFlight.set(takeId, run)
  return run
}

async function pumpOnce(
  port: RecordingPipelinePort,
  takeId: string,
  opts?: { fresh?: boolean },
): Promise<void> {
  try {
    // ⚖ THE STOP'S OWN ATTEMPT IS NOT A RETRY (fix round 2, M1). Every other
    // caller honours the window — the trigger is a flush every ~5 s, and a take
    // whose door is refusing must not ask twelve times a minute. The stop leg
    // is the one caller for which that is wrong: it runs ONCE, at the only
    // instant the tail segment exists and the take is about to be sealed, and
    // one transient refusal on any of the last flushes arms a 5–65 s window
    // that would make it a silent no-op — the tail never attempted at all, on
    // exactly the bad link the head start is worth most. So `fresh` gets its
    // one attempt (bounded by its own per-PUT deadlines and the leg's total
    // budget), and a failure still arms the backoff below for the flushes that
    // come after.
    const wait = opts?.fresh ? undefined : backoff.get(takeId)
    if (wait && Date.now() < wait.until) return

    const meta = await readTakeUploadMeta(takeId)
    // Gone, another staffer's, or no store at all — the owner gate's answer,
    // and nothing to send either way.
    if (!meta) return
    // The start-mint has not stamped a row yet. The segment door mints against
    // that row, so there is nothing to ask for; the next flush asks again, and
    // the stop leg waits for the mint on its own account.
    if (!meta.recordingSessionId) return
    // The WHOLE take is already on the server under its immutable finalized key
    // — which supersedes every segment of it. Nothing left to catch up.
    if (meta.finalizedAt) return
    // A refusal that cannot become a yes: a terminal mint code, or the
    // mismatch below. Read BEFORE the segment blobs, so a stopped pump costs
    // one meta read rather than a disk walk.
    if (meta.segmentError) return

    const from = meta.uploadedSeq ?? -1
    // The disk holds nothing the server does not. The ordinary answer between
    // the last flush that landed and the next one.
    if (meta.lastSeq <= from) return

    // CONTIGUOUS from `from + 1`, stopping at the first gap — `uploadedSeq` is a
    // prefix, and a seq behind a hole advances nothing (see the store's own
    // docblock).
    const ask = batchAsk.get(takeId) ?? SEGMENT_BATCH
    const rows = await listTakeSegmentsAfter(takeId, from, ask)
    if (rows.length === 0) return

    const minted = await port.mintSegmentUrls(
      takeId,
      // The mint's own default for a take written with no container — an empty
      // string composes no extension, and these keys must be the ones the
      // assembler will look for.
      meta.mimeType || 'audio/webm',
      meta.recordingSessionId,
      rows.map((r) => r.seq),
    )
    if ('error' in minted) {
      // TERMINAL_SECURE_ERRORS is the ONE list that says which refusals can
      // never turn into a yes — shared with the whole-take path so the two
      // cannot drift, and read here without writing anything of that path's.
      if (TERMINAL_SECURE_ERRORS.has(minted.error)) await stopSegments(takeId, minted.error)
      else {
        // The door ran out of time (or storage did) — ask for less next time,
        // down to one seq. See `batchAsk`: this is what keeps a catch-up on a
        // slow link from re-asking the same impossible batch for ever.
        if (minted.error === 'upstream') batchAsk.set(takeId, Math.max(1, Math.floor(ask / 2)))
        bumpBackoff(takeId)
      }
      return
    }
    // The door answered, so the ceiling is the right ask again.
    batchAsk.delete(takeId)

    // The door answers per seq; index them so the pool can pair each blob with
    // its own answer without assuming the two lists came back in one order.
    const answers = new Map(minted.segments.map((s) => [s.seq, s]))
    const landed = new Set<number>()
    let failed = false
    let mismatch = false

    // A SHARED CURSOR, so the pool takes rows IN SEQ ORDER: the earliest seqs
    // are the ones that can advance the prefix, so they must be the ones that
    // go first when the network only has room for three.
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        // Stop LAUNCHING more the moment anything refused — the in-flight ones
        // finish on their own. Past a failure the prefix cannot advance any
        // further, so every extra PUT is bandwidth taken from the recording
        // that is still running.
        if (failed || mismatch || next >= rows.length) return
        const row = rows[next++]
        const answer = answers.get(row.seq)
        if (!answer) {
          // The door did not answer this seq at all. Nothing to act on, and not
          // a fact about the bytes — treat it as the refusal it is.
          failed = true
          return
        }
        if ('url' in answer) {
          if (await putSegment(answer.url, row.blob, answer.contentType)) landed.add(row.seq)
          else failed = true
          continue
        }
        // ⚖ AN OBJECT IS ALREADY AT THIS KEY. Adopted ONLY when its byte length
        // is this device's own segment — the retry whose markSegmentsUploaded
        // was lost, and the one legitimate case. A DIFFERENT length is somebody
        // else's bytes where ours should be: terminal FOR THE SEGMENTS, and
        // nothing is deleted, nothing is overwritten, and the take still
        // secures whole at stop under a key of its own.
        if (answer.existingSize === row.blob.size) landed.add(row.seq)
        // ⚖ AND A SIZE-LESS ANSWER IS NOT A VERDICT ABOUT ANYONE'S BYTES (fix
        // round 1, K6). `null` is storage declining to report a length, not a
        // length that disagrees — finalize splits exactly these two off one
        // `info()` read (`size_unknown` vs `size_mismatch`, finalize-take.ts)
        // and falls through the unknown. Marked terminal here it would mean a
        // storage-shape change switching every take's pump off fleet-wide, for
        // good, on evidence about the API rather than about the audio. So it is
        // a refusal like any other: backoff, and the next flush asks again.
        else if (answer.existingSize === null) failed = true
        else mismatch = true
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(SEGMENT_CONCURRENCY, rows.length) }, () => worker()),
    )

    if (mismatch) await stopSegments(takeId, 'seg_mismatch')

    // THE CONTIGUOUS PREFIX, and only it. A seq that landed after a gap is real
    // on storage and stays there — it simply does not move the mark, because
    // what the mark promises is that everything up to it is present.
    let landedUpTo = from
    while (landed.has(landedUpTo + 1)) landedUpTo++
    if (landedUpTo > from) await markSegmentsUploaded(takeId, landedUpTo)

    if (failed || mismatch) bumpBackoff(takeId)
    else backoff.delete(takeId)
  } catch (err) {
    // Nothing above is allowed to fail a recording (see the export's docblock).
    // A throw that reaches here is a store or a door behaving in a way nobody
    // classified — a moment in time, so the take is left exactly as it was and
    // the next flush asks again after a backoff.
    console.warn('[segment-uploader] pump failed:', err)
    bumpBackoff(takeId)
  }
}

/** Test seam ONLY — the module's maps are process-wide, and a jest file that
 *  drives several takes through the pump would otherwise inherit the previous
 *  case's backoff window. Never called from product code. */
export function __resetSegmentPumpState(): void {
  inFlight.clear()
  pendingFresh.clear()
  backoff.clear()
  batchAsk.clear()
}

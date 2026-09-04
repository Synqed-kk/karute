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
import { putDeadlineMs } from '@/lib/recording/storage-put'

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
 * The per-take backoff window. MEMORY ONLY, and deliberately: it dies with the
 * page, and the next page's first flush pumps again — which is the behaviour
 * that is wanted, because a reload is a new attempt at everything. Persisting it
 * would cost a store write per refusal on the capture hot path to slow down a
 * retry that a reload already means to make.
 */
const backoff = new Map<string, { until: number; step: number }>()

function bumpBackoff(takeId: string): void {
  const step = (backoff.get(takeId)?.step ?? 0) + 1
  // Jittered, so a salon of phones that all lost the same access point do not
  // come back in lockstep and refuse together again.
  const wait =
    Math.min(SEGMENT_BACKOFF_MAX_MS, SEGMENT_BACKOFF_MIN_MS * 2 ** (step - 1)) +
    Math.random() * SEGMENT_BACKOFF_MIN_MS
  backoff.set(takeId, { until: Date.now() + wait, step })
}

/** ONE segment PUT, under its own size-derived deadline.
 *
 *  `putDeadlineMs` is storage-put's shared rule (a floor of 60 s, then ~10 KB/s
 *  of the blob's own size) — the same one secure-take gives the whole take, so
 *  a segment and a take cannot drift into two timeout policies. A segment is
 *  small, so in practice this is the floor: it exists to release a socket that
 *  will never answer, not to police a slow one.
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
  const timer = setTimeout(() => deadline.abort(), putDeadlineMs(blob.size))
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
 */
export async function pumpSegments(
  port: RecordingPipelinePort,
  takeId: string,
): Promise<void> {
  const running = inFlight.get(takeId)
  if (running) return running
  const run = pumpOnce(port, takeId).finally(() => inFlight.delete(takeId))
  inFlight.set(takeId, run)
  return run
}

async function pumpOnce(port: RecordingPipelinePort, takeId: string): Promise<void> {
  try {
    const wait = backoff.get(takeId)
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
    const rows = await listTakeSegmentsAfter(takeId, from, SEGMENT_BATCH)
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
      if (TERMINAL_SECURE_ERRORS.has(minted.error)) await markSegmentError(takeId, minted.error)
      else bumpBackoff(takeId)
      return
    }

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
        // was lost, and the one legitimate case. Anything else (a different
        // length, or storage answering without one at all) is somebody's bytes
        // where ours should be: terminal FOR THE SEGMENTS, and nothing is
        // deleted, nothing is overwritten, and the take still secures whole at
        // stop under a key of its own.
        if (answer.existingSize === row.blob.size) landed.add(row.seq)
        else mismatch = true
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(SEGMENT_CONCURRENCY, rows.length) }, () => worker()),
    )

    if (mismatch) await markSegmentError(takeId, 'seg_mismatch')

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

/** Test seam ONLY — the two module maps are process-wide, and a jest file that
 *  drives several takes through the pump would otherwise inherit the previous
 *  case's backoff window. Never called from product code. */
export function __resetSegmentPumpState(): void {
  inFlight.clear()
  backoff.clear()
}

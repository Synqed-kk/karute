// RecordingPipelinePort — thin (Vite) implementation (packet 08 Decision 2). No
// supabase-js: the facade mints a service-role signed UPLOAD url
// (POST /recordings/upload-url), the shell PUTs the blob straight to storage with
// plain fetch, and transcription runs by PATH against the /api/app/v1/ai twin
// (the server verifies the tenant prefix; since PR4 it deletes nothing, and the
// path it is handed is the take's own finalized object).

import type {
  MintTakeUrlPortResult,
  RecordingPipelinePort,
} from '@/lib/ports/recording-port'
import { getDataPort } from '@/lib/ports/data-port'
// The staged PUT's deadline, from the module that already holds the whole-take
// one (slice five fix round 3, F7). It imports nothing app-side, which is why
// a port may reach it.
import { putDeadlineMs } from '@/lib/recording/storage-put'
import type {
  EnqueueRecordingJobInput,
  RecordingJobStatusView,
} from '@/actions/recording-jobs'
import type {
  EnqueueFromSessionInput,
  EnqueueFromSessionResult,
} from '@/lib/recording/enqueue-from-session'
import type {
  FinalizeTakeInput,
  FinalizeTakeResult,
} from '@/lib/recording/finalize-take'

/** The mint's OWN refusal codes — the closed set the shared core answers with
 *  (src/lib/recording/mint-take-url.ts). An ALLOWLIST, because the value read
 *  below is a facade MESSAGE: only these may become a `secureError`, so a
 *  sentence from some other guard can never be mistaken for a code the take
 *  store judges as terminal. */
const MINT_ERROR_CODES = new Set([
  'bad_mime',
  'bad_take_id',
  // The door's refusal for a client-named take that carries no row (PR2 fix
  // round 7). TERMINAL, and it was missing here (fix round 7): read as the
  // generic `mint_400` it stayed retryable, so the phone re-uploaded a whole
  // take against an answer that can never change.
  'bad_input',
  'exists',
  'reserved_elsewhere',
  'forbidden',
  'not_found',
  // ⚖ THE SEGMENT DOOR'S OWN FENCE (slice five packet C, D6): the row has not
  // reserved this take's key, so nothing may hang under it. TERMINAL — a
  // binding does not change because time passed — and the take is not lost by
  // it: it is still secured WHOLE at stop by the independent take path.
  'not_reserved',
  'upstream',
])

/** How long the phone waits on a door that has not answered. Not a performance
 *  budget — a device that walks out of signal STALLS its requests rather than
 *  failing them, and a stalled mint or finalize holds secure-take's one-at-a-
 *  time slot for the whole page lifetime, so every other owed take starves.
 *  30 s for these three: they are small JSON calls (the whole-take PUT carries
 *  its own, size-derived deadline in secure-take.ts).
 *
 *  AbortController + a timer rather than AbortSignal.timeout: that static is
 *  absent from jsdom (this port's own tests) and from WebViews older than
 *  Chrome 103, where reaching for it would throw and fail every take. */
const DOOR_TIMEOUT_MS = 30_000

async function doorFetch(path: string, init: RequestInit): Promise<Response> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), DOOR_TIMEOUT_MS)
  try {
    return await getDataPort().apiFetch(path, { ...init, signal: deadline.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Facade classification → the mint code it carries, for the refusals the route
 *  spells out for a human instead of echoing the code (…/upload-url/route.ts). */
const FACADE_CODE_TO_MINT: Record<string, string> = {
  forbidden: 'forbidden',
  tenant_forbidden: 'forbidden',
  not_found: 'not_found',
  upstream_unavailable: 'upstream',
  // The route's OWN validation refusals — 'malformed JSON body', 'invalid
  // upload-url payload' — which carry a sentence rather than a mint code, so
  // the allowlist above cannot catch them. Read as the generic `mint_400` they
  // stayed RETRYABLE, and a body this server will never accept does not become
  // acceptable by sending it again: the phone re-uploaded a whole take on every
  // cooldown, forever. TERMINAL, exactly like the mint's own `bad_input` (fix
  // round 13, P3). The mint's named 400s still win — `bad_mime`, `bad_take_id`
  // and `bad_input` ride this same classification with the CODE as the message,
  // and mintErrorCode reads the allowlist first.
  validation: 'bad_input',
}

/** WHICH refusal, from the facade's error body — `{ error: { code, message } }`.
 *  The status alone cannot tell `exists` from `reserved_elsewhere` (both 409),
 *  and those two are TERMINAL while a 502 is not: a phone that only saw the
 *  number would re-upload a whole take that is permanently spoken for.
 *  `mint_<status>` remains the fallback for a body that names nothing we know
 *  (a proxy page, an auth blip) — retryable, which is the safe default. */
function mintErrorCode(body: unknown, status: number): string {
  const err = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error
  const message = typeof err?.message === 'string' ? err.message : ''
  if (MINT_ERROR_CODES.has(message)) return message
  const code = typeof err?.code === 'string' ? err.code : ''
  return FACADE_CODE_TO_MINT[code] ?? `mint_${status}`
}

export const viteRecordingPort: RecordingPipelinePort = {
  aiBase: '/api/app/v1/ai',
  // The job's audio_path is the take's own finalized key (PR4) — minted by the
  // fenced take door, so the worker can prove ownership. Server path ON.
  supportsServerJob: true,
  // A2-2 discard transcripts, LIVE on the phone since PHONEWIRE-2C: the persist
  // actions have a facade door now (…/recordings/discards/transcript POST, wired
  // in actions.vite.ts), so the collection this flag guards can actually happen.
  // Flipping it is the whole fix — the record page's discard arm, take-store
  // stamp and collection sweep are SHARED code that was already correct and now
  // simply runs. Its audio leg is the take's own finalized object (PR4).
  supportsDiscardTranscript: true,
  async prepareTranscription(blob, finalizedPath, opts) {
    // THE HAPPY PATH UPLOADS NOTHING (PR4): the whole take is already at its
    // finalized key, so the facade is simply handed that path — and it deletes
    // nothing when it is done, because the finalized object is evidence.
    if (finalizedPath) return { body: { path: finalizedPath }, path: finalizedPath }

    // The fallback, for a take the store never held (see the port's doc):
    // byte-for-byte the staging this arm always did.
    // 1. Service-minted signed upload URL (tenant-prefixed path). The body is
    //    new (fix round 7) and the door has always parsed one: `stagedFor` is
    //    the session a DISCARD's staged copy is named for, and null — the
    //    in-tab fallback's shape — is the server-named take this leg has always
    //    minted.
    //    ⚖ …AND IT NAMES ITS TAKE AND ITS CONTAINER (slice five packet B, D10).
    //    `stagedTake` fills the key's uuid slot, which is what lets the core row
    //    find this row-less object; `mimeType` is `blob.type`, the take's OWN
    //    container from the store's meta — until this round every phone copy was
    //    composed and PUT as webm, so iOS mp4 bytes were mislabelled twice over.
    //    An empty type is omitted and the server's default stands.
    //    ⚖ …AND THE UNBOUND FALLBACK SENDS NEITHER (slice five fix round 3, F2).
    //    Both fields used to ride ONE body for both branches, and the door's
    //    pair rule (record-schemas.ts) refuses a bare `mimeType` that names
    //    neither a takeId nor a stagedFor — which is exactly the in-tab
    //    fallback's shape, and the blob it carries always has a type
    //    (loadTakeBlob sets it from the take's meta). So every phone take whose
    //    stop-time upload had failed died at 録音を使用 with a 400. The web arm
    //    never had it (recording-port.ts puts both inside the stagedFor branch);
    //    this now mirrors it, and the unbound body is byte-identical to the one
    //    this leg sent before packet B — which also spares it a `.strict()`
    //    refusal from a server that predates `stagedTake`.
    const res = await doorFetch('/api/app/v1/recordings/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        opts?.stagedFor
          ? {
              stagedFor: opts.stagedFor,
              stagedTake: opts.stagedTake ?? null,
              ...(blob.type ? { mimeType: blob.type } : {}),
            }
          : { stagedFor: null },
      ),
    })
    if (!res.ok) throw new Error(`Upload URL failed (${res.status})`)
    // The facade echoes the mint's WHOLE result (…/upload-url/route.ts's
    // `ok(ctx, minted)`), so contentType is the same closed-map answer that
    // decided the key's extension — never this arm's own guess. `url` is absent
    // and `existingSize` present on the door's OTHER success arm (fix round 2),
    // which is why neither is destructured as a bare string.
    const minted = (await res.json()) as {
      path: string
      url?: string
      contentType: string
      existingSize?: number | null
    }

    // ⚖ ADOPT ONLY WHAT IS OUR OWN BYTE LENGTH (fix round 2). The door signed
    // nothing because the object is ALREADY at this key — and since packet B
    // that key is composable in advance, so its mere existence says nothing
    // about who wrote it. The only safe reading is "this is the copy we PUT,
    // whose markTakeStaged was lost", and the one thing a caller who never held
    // the recording cannot forge is its size. Anything else throws: the take
    // stays unstaged, its discard stamp stands, and the next sweep asks the
    // mint again — one small JSON call per mount, no upload, nothing released.
    if ('existingSize' in minted && minted.existingSize !== undefined) {
      if (minted.existingSize !== blob.size) throw new Error('staged copy mismatch')
      return { body: { path: minted.path }, path: minted.path }
    }
    if (!minted.url) throw new Error('Upload URL failed (no url)')

    // 2. PUT the blob directly to storage (the signed URL carries the token).
    //    ⚖ UNDER A DEADLINE, LIKE EVERY OTHER CALL ON THIS ARM (slice five fix
    //    round 3, F7). A phone that walks out of signal STALLS its sockets
    //    rather than failing them, and this one is held by `runDiscardTranscript`
    //    inside its module-level `inFlight` set while `sweepDiscardTranscripts`
    //    waits on it sequentially — so one hung staged PUT withheld the discard
    //    words of every take behind it for the rest of the app run. The deadline
    //    is the take's own size at ~10 KB/s (storage-put.ts, the same one the
    //    whole-take PUT carries), and an AbortController with a clearable timer
    //    rather than `AbortSignal.timeout` for the reason DOOR_TIMEOUT_MS names.
    const putDeadline = new AbortController()
    const putTimer = setTimeout(() => putDeadline.abort(), putDeadlineMs(blob.size))
    let put: Response
    try {
      put = await fetch(minted.url, {
        method: 'PUT',
        headers: { 'content-type': minted.contentType },
        body: blob,
        signal: putDeadline.signal,
      })
    } finally {
      clearTimeout(putTimer)
    }
    // EVERY refusal is a failure here, the 409 included (fix round 2). On the
    // WHOLE-TAKE path "already there" is a success because finalize re-proves
    // the object's size and its row's ownership afterwards; a staged copy is
    // row-less and has no finalize, so the size match at the MINT is the only
    // proof there is. A 409 reaching here is a race the mint did not see a
    // moment ago — the next mount's mint answers it with a size.
    if (!put.ok) throw new Error(`Upload failed (${put.status})`)

    // 3. Transcribe by PATH.
    return { body: { path: minted.path }, path: minted.path }
  },
  // ⚖ NULL, AND THE COHORT IS EMPTY BY CONSTRUCTION (PR4 fix round 7). The
  // backfill this answers exists for takes finalized by slice THREE's code and
  // read by slice FOUR's — a window no phone release ever shipped: slice three
  // never went out on its own here, so no phone take can carry `finalizedAt`
  // without `finalizedPath`. Answering null keeps such a take on exactly the
  // behaviour it has today rather than inventing a key this arm cannot prove.
  async finalizedKey() {
    return null
  },
  // Capture pipeline PR3 fix round 6 — the session door, the phone twin of the
  // web action (thin/ports/actions.vite.ts#facadeStartRecordingSession, which
  // the recorder's own start-mint reaches by the same route). Spelled here like
  // every other call in this file rather than imported from that module: this
  // port is loaded on its own by the thin entry and by its tests.
  //
  // Effectful row mint → the route REQUIRES an Idempotency-Key. FAIL-OPEN like
  // the recorder's: every failure is null, and secure-take reads that as a
  // retryable 'session'.
  async startSession({ takeId, mimeType, ...input }) {
    const post = (body: unknown) =>
      doorFetch('/api/app/v1/recordings/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // ⚖ A FRESH KEY PER ATTEMPT (fix round 12, P3) — one discipline with
          // the web arm's twin (thin/ports/actions.vite.ts#idemPost), which has
          // always minted a uuid here.
          //
          // Round 7 keyed this off the TAKE so a retry after a lost reply
          // landed back on the same row instead of orphaning another. That is
          // real, but it collided with the step back below: an
          // Idempotency-Key is a promise that the SAME request gets the SAME
          // answer, so the door replaying its 400 to the second, differently
          // shaped body is correct behaviour — and it made the step back
          // unreachable. A take on a server that predates the pair then got no
          // row at all, and audio that has no row never leaves the device.
          // Losing a take beats leaving a stray row, so the orphan-row
          // degradation core already accepts for this door (packet-10 fact 3,
          // the web arm's standing trade) is the one both arms now take.
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      })
    try {
      // ⚖ BORN RESERVED (fix round 8): the take and its container travel
      // together so the door composes this take's finalized key AT CREATE —
      // the row is never unbound, and the mint that follows answers "already
      // ours". Both or neither: half the pair is a validation 400.
      let res = mimeType ? await post({ ...input, takeId, mimeType }) : await post(input)
      // TRANSITIONAL, and the only reason this is not one call: a server that
      // predates the pair refuses the whole body (the door's schema is strict),
      // and a capture that lost its row over a field the server has never heard
      // of would be a regression. Step back to today's body ONCE — never a
      // loop, and never on any other status: 400 is the door saying it does not
      // know these fields. Delete with the fallback in the actions port's
      // facadeStartRecordingSession (the twin the recorder's own start-mint
      // reaches) once every deployed server takes the pair.
      if (mimeType && res.status === 400) res = await post(input)
      if (!res.ok) return null
      const body = (await res.json().catch(() => null)) as { id?: string | null } | null
      return body?.id ? { id: body.id } : null
    } catch {
      return null
    }
  },
  // Capture pipeline PR3 — the two doors secureTake knocks on. Same
  // apiFetch discipline as the transcribe leg above (Bearer + the store lens are
  // assembled in facade-fetch.ts, never spelled here), plus a JSON body: the
  // device NAMES the take and the container it recorded.
  async mintTakeUrl(takeId: string, mimeType: string, recordingSessionId: string | null) {
    const res = await doorFetch('/api/app/v1/recordings/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // recordingSessionId is the row the mint RESERVES this key on — sent even
      // when null, which is the shape that asks the mint to create the row.
      body: JSON.stringify({ takeId, mimeType, recordingSessionId }),
    })
    const body = (await res.json().catch(() => null)) as
      | (MintTakeUrlPortResult & { token?: string })
      | null
    // A refusal comes back NAMED, never thrown (the port contract) — and an
    // unreadable 2xx body is a refusal too, not an assumed success: the same
    // guard finalizeTake below carries, for the same reason.
    if (!res.ok || !body || 'error' in body) return { error: mintErrorCode(body, res.status) }
    // ⚖ THE TOKEN IS DROPPED HERE (fix round 13, P3), not merely absent from the
    // type: the facade echoes the mint's whole result, and `token` already rides
    // inside `url`. Handing a caller a credential the port contract says it
    // never gets is how a second signed-request assembler is born. Same fields,
    // same reason, as the web arm (lib/ports/recording-port.ts).
    //
    // ⚖ AND REBUILT BY ARM (hotfix 2026-09-05), the way mintSegmentUrls below
    // already does it. The take mint answers "the object is already there, here
    // is its size" when this take's own row reserved the key and storage holds
    // it — and that arm must carry NO `url` key at all: a `url: undefined` on
    // the rebuilt object would pass a shape check in secureTake and reach fetch.
    const { path, contentType, recordingSessionId: bound } = body
    return 'url' in body
      ? { path, url: body.url, contentType, recordingSessionId: bound }
      : { path, contentType, recordingSessionId: bound, existingSize: body.existingSize ?? null }
  },
  // Slice five packet C (D6) — the segment door, the same upload-url door one
  // function up with a `seqs` list on the body. It reserves nothing and writes
  // nothing; see the port contract for the fence that stands in for that, and
  // for why an object already at a segment key is answered with its SIZE rather
  // than signed over.
  //
  // ⚖ AND THE DOOR'S OWN TIMEOUT ARRIVES AS A CODE, NOT AS A THROW (fix round
  // 4, Q1). `doorFetch` is an AbortController and a `try/finally` with no catch,
  // so its 30 s deadline REJECTS out of here — and a rejection is the one shape
  // this port's caller cannot read. The pump's belt (segment-uploader.ts
  // `batchAsk`) halves the next catch-up on `upstream` PRECISELY because a
  // 60-seq batch is what makes that door run out of time; reaching the pump as
  // a throw instead, it lands in the outer catch, bumps the backoff and halves
  // nothing — so the phone re-asks for the same impossible sixty for as long as
  // the latency lasts, which is the offline take that never catches up. This is
  // the primary platform, so the belt has to work here first. `catch { return
  // { error: 'upstream' } }` is `startSession`'s own idiom five hundred lines
  // up (`catch { return null }` there — a named retryable code here, because
  // this caller reads codes), and 'upstream' is retryable, never terminal.
  async mintSegmentUrls(
    takeId: string,
    mimeType: string,
    recordingSessionId: string,
    seqs: number[],
  ) {
    try {
      const res = await doorFetch('/api/app/v1/recordings/upload-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ takeId, mimeType, recordingSessionId, seqs }),
      })
      const body = (await res.json().catch(() => null)) as {
        segments?: {
          seq: number
          path: string
          url?: string
          contentType: string
          existingSize?: number | null
        }[]
      } | null
      // A refusal comes back NAMED, never thrown (the port contract) — and an
      // unreadable or shapeless 2xx body is a refusal too, not an assumed
      // success: the same guard the two doors above carry, for the same reason.
      if (!res.ok || !body || 'error' in body || !Array.isArray(body.segments))
        return { error: mintErrorCode(body, res.status) }
      // ⚖ THE TOKEN IS DROPPED HERE (packet B's rule, on this door too): the
      // facade echoes the mint's whole result, and `token` already rides inside
      // `url`. Rebuilt field by field rather than spread, so a credential can
      // never ride through on a future field addition — and the two arms are
      // told apart by `url`, which is the field only the signed one has.
      return {
        segments: body.segments.map((s) =>
          s.url
            ? { seq: s.seq, path: s.path, url: s.url, contentType: s.contentType }
            : {
                seq: s.seq,
                path: s.path,
                contentType: s.contentType,
                existingSize: s.existingSize ?? null,
              },
        ),
      }
    } catch {
      // The abort above, a dead socket, a WebView that killed the request. All
      // moments in time and all retryable — and the code the pump's belt reads.
      return { error: 'upstream' }
    }
  },
  async finalizeTake(input: FinalizeTakeInput) {
    const res = await doorFetch('/api/app/v1/recordings/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = (await res.json().catch(() => null)) as FinalizeTakeResult | null
    // The route answers every SOFT refusal (object_missing, already-finalized)
    // in a 2xx body, so a non-2xx here is real transport/auth trouble —
    // reported as 'failed', which leaves the take un-finalized for the retry.
    // Guarding on `!res.ok` as well as the body is the discard port's lesson:
    // a facade error body parses perfectly.
    //
    // …except a 403, which is the door saying this take is not this caller's to
    // finalize. That is a fact about the caller, not a moment in time: folded
    // into 'failed' it made the phone re-upload a whole take forever, so it
    // comes back as the TERMINAL 'forbidden' the web twin already answers.
    if (res.status === 403) return { error: 'forbidden' as const }
    if (!res.ok || !body) return { error: 'failed' as const }
    return body
  },
  async enqueueJob(input: EnqueueRecordingJobInput) {
    const res = await getDataPort().apiFetch('/api/app/v1/recordings/job', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(input),
    })
    const body = (await res.json().catch(() => null)) as
      | { ok: true; jobId: string; status: string }
      | { error?: { message?: string } }
      | null
    if (!res.ok || !body) {
      const err = body as { error?: { message?: string } } | null
      return { error: err?.error?.message ?? `Enqueue failed (${res.status})` }
    }
    return body as { ok: true; jobId: string; status: string }
  },
  async enqueueJobFromSession(input: EnqueueFromSessionInput): Promise<EnqueueFromSessionResult> {
    const res = await getDataPort().apiFetch('/api/app/v1/recordings/job/from-session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Same derivation as enqueueJob above. A stable per-session key would
        // buy nothing here: core's enqueue is already idempotent per recording
        // session (it re-arms rather than minting a second job), and the door
        // bounds this header at the trust boundary expecting the 36-char uuid
        // every other client sends.
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(input),
    })
    const body = (await res.json().catch(() => null)) as
      | { ok: true; jobId: string; status: string }
      | { error?: { code?: string } }
      | null
    if (!res.ok || !body || !('ok' in body)) {
      // The facade names its refusal in `error.code` (forbidden / not_found /
      // validation / upstream_unavailable). Mapped onto the shared body's own
      // closed union so both arms answer the caller in one vocabulary; anything
      // that named nothing — a proxy page, an auth blip — is `upstream`, the
      // retryable arm.
      const code = (body as { error?: { code?: string } } | null)?.error?.code
      if (code === 'forbidden') return { error: 'forbidden' }
      // The door answers 404 for BOTH "no such session" and "the server does
      // not hold this audio", deliberately: which of the two is not the
      // caller's business, and the row says the same thing either way — there
      // is nothing here to save. One code out.
      if (code === 'not_found') return { error: 'not_found' }
      return { error: 'upstream' }
    }
    return body
  },
  async mintPlaybackUrl(karuteId: string) {
    const res = await getDataPort().apiFetch(
      `/api/app/v1/recordings/playback-url?karuteId=${encodeURIComponent(karuteId)}`,
    )
    const body = (await res.json().catch(() => null)) as
      | { url?: string; expiresAt?: string; durationSeconds?: number | null }
      | { error?: { code?: string } }
      | null
    if (!res.ok || !body || !('url' in body) || typeof body.url !== 'string') {
      // The facade names its refusal in `error.code` (forbidden / not_found /
      // validation / upstream_unavailable). `mint_<status>` is the fallback for
      // a non-2xx that named nothing — a proxy page, an auth blip — so the card
      // still has something honest to log.
      const code = (body as { error?: { code?: string } } | null)?.error?.code
      return { error: typeof code === 'string' ? code : `mint_${res.status}` }
    }
    return {
      url: body.url,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : '',
      durationSeconds: typeof body.durationSeconds === 'number' ? body.durationSeconds : null,
    }
  },
  async jobStatus(recordingSessionId) {
    const res = await getDataPort().apiFetch(
      `/api/app/v1/recordings/job/${encodeURIComponent(recordingSessionId)}`,
    )
    const body = (await res.json().catch(() => null)) as
      | RecordingJobStatusView
      | { error?: { message?: string } }
      | null
    if (!res.ok || !body) {
      const err = body as { error?: { message?: string } } | null
      return {
        error: err?.error?.message ?? `Job status failed (${res.status})`,
        // Only a true 404 means "no job for this session" (the facade maps
        // core trouble to upstream_unavailable, never 404) — the port
        // contract's definitive-absence signal.
        notFound: res.status === 404,
      }
    }
    return body as RecordingJobStatusView
  },
}

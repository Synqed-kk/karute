// RecordingPipelinePort — thin (Vite) implementation (packet 08 Decision 2). No
// supabase-js: the facade mints a service-role signed UPLOAD url
// (POST /recordings/upload-url), the shell PUTs the blob straight to storage with
// plain fetch, and transcription runs by PATH against the /api/app/v1/ai twin
// (the server verifies the tenant prefix + deletes the object after — so there is
// no client-side cleanup).

import type {
  MintTakeUrlPortResult,
  RecordingPipelinePort,
} from '@/lib/ports/recording-port'
import { getDataPort } from '@/lib/ports/data-port'
import type {
  EnqueueRecordingJobInput,
  RecordingJobStatusView,
} from '@/actions/recording-jobs'
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
  // stageForJob uses the upload-url facade, which mints a tenant-scoped
  // `app_${businessId}_*` key — so the worker can prove ownership. Server path ON.
  supportsServerJob: true,
  // A2-2 discard transcripts, LIVE on the phone since PHONEWIRE-2C: the persist
  // actions have a facade door now (…/recordings/discards/transcript POST, wired
  // in actions.vite.ts), so the collection this flag guards can actually happen.
  // Flipping it is the whole fix — the record page's discard arm, take-store
  // stamp and collection sweep are SHARED code that was already correct and now
  // simply runs. stageForJob above is the audio leg it uses.
  supportsDiscardTranscript: true,
  async prepareTranscription(blob) {
    // 1. Service-minted signed upload URL (tenant-prefixed path).
    const res = await getDataPort().apiFetch('/api/app/v1/recordings/upload-url', {
      method: 'POST',
    })
    if (!res.ok) throw new Error(`Upload URL failed (${res.status})`)
    const { path, url } = (await res.json()) as { path: string; url: string }

    // 2. PUT the blob directly to storage (the signed URL carries the token).
    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'audio/webm' },
      body: blob,
    })
    if (!put.ok) throw new Error(`Upload failed (${put.status})`)

    // 3. Transcribe by PATH; the server deletes the object after — no cleanup here.
    return { body: { path }, cleanup: () => {} }
  },
  async stageForJob(blob) {
    // Same upload-url facade PUT flow as prepareTranscription steps 1-2,
    // minus the transcribe body — the worker deletes the object on success.
    const res = await getDataPort().apiFetch('/api/app/v1/recordings/upload-url', {
      method: 'POST',
    })
    if (!res.ok) throw new Error(`Upload URL failed (${res.status})`)
    const { path, url } = (await res.json()) as { path: string; url: string }

    const put = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'audio/webm' },
      body: blob,
    })
    if (!put.ok) throw new Error(`Upload failed (${put.status})`)
    return { path }
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
  async startSession({ takeId, ...input }) {
    try {
      const res = await doorFetch('/api/app/v1/recordings/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // ⚖ KEYED OFF THE TAKE, never a fresh uuid (fix round 7). This call
          // is retried by design — a dead socket on the way BACK is
          // indistinguishable from one on the way out, so a fresh key per
          // attempt leaves core a new orphan row every time a reply is lost.
          // One take owns one row, so the take id is the key.
          'idempotency-key': `session-${takeId}`,
        },
        body: JSON.stringify(input),
      })
      if (!res.ok) return null
      const body = (await res.json().catch(() => null)) as { id?: string | null } | null
      return body?.id ? { id: body.id } : null
    } catch {
      return null
    }
  },
  // Capture pipeline PR3 — the two doors secureTake knocks on. Same
  // apiFetch discipline as stageForJob above (Bearer + the store lens are
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
    const body = (await res.json().catch(() => null)) as MintTakeUrlPortResult | null
    // A refusal comes back NAMED, never thrown (the port contract) — and an
    // unreadable 2xx body is a refusal too, not an assumed success: the same
    // guard finalizeTake below carries, for the same reason.
    if (!res.ok || !body) return { error: mintErrorCode(body, res.status) }
    return body
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

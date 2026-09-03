// RecordingPipelinePort — thin (Vite) implementation (packet 08 Decision 2). No
// supabase-js: the facade mints a service-role signed UPLOAD url
// (POST /recordings/upload-url), the shell PUTs the blob straight to storage with
// plain fetch, and transcription runs by PATH against the /api/app/v1/ai twin
// (the server verifies the tenant prefix + deletes the object after — so there is
// no client-side cleanup).

import type { RecordingPipelinePort } from '@/lib/ports/recording-port'
import { getDataPort } from '@/lib/ports/data-port'
import type {
  EnqueueRecordingJobInput,
  RecordingJobStatusView,
} from '@/actions/recording-jobs'
import type {
  FinalizeTakeInput,
  FinalizeTakeResult,
} from '@/lib/recording/finalize-take'

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
  // Capture pipeline PR3 — the two doors secureTake knocks on. Same
  // apiFetch discipline as stageForJob above (Bearer + the store lens are
  // assembled in facade-fetch.ts, never spelled here), plus a JSON body: the
  // device NAMES the take and the container it recorded.
  async mintTakeUrl(takeId: string, mimeType: string) {
    const res = await getDataPort().apiFetch('/api/app/v1/recordings/upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ takeId, mimeType }),
    })
    // The status is the whole diagnosis — a 403 (wrong tenant) and a 502
    // (storage down) are the same word to a caller that only sees a throw, and
    // the take meta would record both as 'network'. Named here so secure-take
    // writes `mint_<status>` instead.
    if (!res.ok) {
      throw Object.assign(new Error(`Upload URL failed (${res.status})`), {
        secureError: `mint_${res.status}`,
      })
    }
    return (await res.json()) as { path: string; url: string; contentType: string }
  },
  async finalizeTake(input: FinalizeTakeInput) {
    const res = await getDataPort().apiFetch('/api/app/v1/recordings/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = (await res.json().catch(() => null)) as FinalizeTakeResult | null
    // The route answers every SOFT refusal (object_missing, already-finalized)
    // in a 2xx body, so a non-2xx here is real transport/auth/forbidden trouble
    // — reported as 'failed', which leaves the take un-finalized for the retry.
    // Guarding on `!res.ok` as well as the body is the discard port's lesson:
    // a facade error body parses perfectly.
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

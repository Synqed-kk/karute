// Server-side recording→karute pipeline worker (Liam ask 2026-07-19).
//
// The client uploads audio + enqueues a core job (synqed.recordingJobs) keyed
// on the recording_sessions row, then just polls. This worker claims jobs and
// runs the SAME internals the interactive flow uses — runTranscription /
// runKaruteExtraction / runKaruteSummary (#497-501 twins) — then writes the
// karute record through the idempotent by-recording-session save with the SAME
// fail-closed consent gate. A dead tab costs nothing; back-to-back customers
// queue instead of silently dropping (the old single-slot orchestration).
//
// Concurrency + retries live in core's job store: atomic SKIP LOCKED claim,
// stale-claim reclaim (dead worker), attempts→FAILED. The terminal save is
// idempotent (UNIQUE recording_session_id on karute_records + upsert), so
// at-least-once processing can never duplicate a record.
//
// Transaction rule (Liam): AI calls NEVER run inside a write transaction —
// transcribe/extract/summarize happen first, then one short save.

import { SynqedClient, type RecordingJob } from '@synqed-kk/client'
import { createServiceClient } from '@/lib/supabase/service'
import { runTranscription, speakerIdMode, loadStaffReferenceForStaff } from '@/lib/ai/transcribe'
import { runKaruteExtraction } from '@/lib/ai/karute-extract'
import { runKaruteSummary } from '@/lib/ai/karute-summarize'
import { buildDiarizedTranscript, toSpeakerText } from '@/lib/diarized'
import { isConsentCurrent, CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import { audit } from '@/lib/audit'
import { setKaruteOutcomeWithClient } from '@/lib/karute/outcome'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

/** The enqueue payload contract (client → core job row → this worker). */
export interface RecordingJobPayload {
  business_id?: string // informational; the job row's business_id is authoritative
  customer_id: string
  /** Acting staff (synqed staff id) — the recorder, for attribution + audit. */
  staff_id: string
  appointment_id?: string | null
  store_id?: string | null
  /** Path in the `recordings` storage bucket (uploaded via the facade URL). */
  audio_path: string
  audio_mime?: string
  locale?: string
  duration_seconds?: number
  /** Coaching label chosen at stop (packet 22 B4) — written via the SAME
   *  best-effort upsert the interactive save uses (setKaruteOutcomeWithClient),
   *  but a failure here THROWS (unlike the interactive save's swallow):
   *  the audio is deleted right after this function returns, so a silently
   *  lost label has no retry path. Absent = no outcome to write. */
  outcome?: SessionOutcome
}

function coreClient(businessId: string): SynqedClient {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) throw new Error('SYNQED core env missing')
  return new SynqedClient({ baseUrl, apiKey, businessId })
}

/** Process one claimed job end-to-end. Throws on failure — the caller reports
 *  fail() to core, which requeues or FAILs by attempts. */
async function processJob(job: RecordingJob): Promise<string> {
  const payload = job.payload as unknown as RecordingJobPayload
  if (!payload?.customer_id || !payload.staff_id || !payload.audio_path) {
    throw new Error('Job payload missing customer_id/staff_id/audio_path')
  }
  const synqed = coreClient(job.business_id)

  // Tenancy gate at the chokepoint EVERY arm routes through — the last line
  // before a service-role read + delete of the object (no RLS on that client).
  // A job's audio MUST live under this job's own tenant prefix; anything else
  // — a cross-tenant `app_${other}_*` key OR a non-tenant-scoped `rec_*` key
  // whose owner can't be verified — is refused before it can be read or
  // deleted. This is why the ONLY audio the worker will touch is a
  // `app_${businessId}_*` object the upload-url facade minted for THIS tenant;
  // both the facade route and the web action enforce the same shape up front,
  // and this is the invariant that holds even if a future caller forgets to.
  if (!payload.audio_path.startsWith(`app_${job.business_id}_`)) {
    throw new Error('audio_path does not belong to this job’s business')
  }

  // Consent gate FIRST — fail closed before spending a yen on transcription.
  // Same rule as the interactive save: unreadable consent rejects, never bypasses.
  const { consent } = await synqed.customers.getConsent(payload.customer_id)
  if (!isConsentCurrent(consent)) throw new Error(CONSENT_REQUIRED_ERROR)

  // Signed READ url for Deepgram — server-minted from the storage path, same
  // by-construction SSRF posture as the facade transcribe twin.
  const supabase = createServiceClient()
  const { data: signed, error: signErr } = await supabase.storage
    .from('recordings')
    .createSignedUrl(payload.audio_path, 3600)
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Audio not readable at ${payload.audio_path}: ${signErr?.message ?? 'no url'}`)
  }

  // Org toggles the interactive route resolves per-request; here per-job.
  // Same read (core org-settings blob), same defaults as the transcribe route.
  const org = await synqed.orgSettings.get().catch(() => null)
  const settings = (org?.settings ?? null) as Parameters<typeof loadStaffReferenceForStaff>[0]
  const diarize = settings?.speaker_diarization !== false
  const businessType = settings?.business_type ?? null
  const locale = payload.locale ?? 'ja'

  // 1. Transcribe (voiceprint reference = the RECORDER's enrollment clip).
  const mode = speakerIdMode()
  const reference =
    mode === 'off' ? null : await loadStaffReferenceForStaff(settings, payload.staff_id)
  const transcription = (await runTranscription({
    audio: { url: signed.signedUrl },
    locale,
    diarize,
    reference,
    mode,
    businessType,
  })) as {
    transcript?: string
    paragraphs?: never[]
    words?: never[]
    confidence?: number
    speakerId?: { mode?: string; staffSpeakerIndex?: number; confidence?: number }
  }
  const flat = transcription.transcript ?? ''
  if (!flat.trim()) throw new Error('EMPTY_TRANSCRIPT')
  // Same Stage-0 diarization assembly as the interactive pipeline: labeled
  // text when attribution succeeds, flat transcript on any failure.
  const sid = transcription.speakerId
  const staffHint =
    sid && sid.mode === 'enforce'
      ? { speaker: sid.staffSpeakerIndex as number, confidence: sid.confidence as number }
      : null
  const diarized = buildDiarizedTranscript(
    transcription.paragraphs ?? [],
    transcription.words ?? [],
    transcription.confidence ?? 0,
    staffHint,
  )
  const transcript = diarized ? toSpeakerText(diarized) : flat

  // 2+3. Extract + summarize from the transcript (independent → parallel).
  const customer = await synqed.customers.get(payload.customer_id).catch(() => null)
  const common = {
    transcript,
    locale,
    customerName: customer?.name ?? null,
    sessionDate: new Date().toISOString().slice(0, 10),
    businessType,
  }
  const [extraction, summary] = await Promise.all([
    runKaruteExtraction(common),
    runKaruteSummary(common),
  ])

  // 4. ONE short write — the same idempotent by-recording-session upsert the
  // interactive path uses (core #38): a reclaimed/retried job converges on the
  // same record instead of duplicating it.
  const record = await upsertKaruteRecord(synqed, job, payload, {
    transcript,
    summary: summary.result.summary,
    entries: extraction.result.entries,
  })

  // Coaching label (packet 22 B4) — same idempotent upsert the interactive
  // save uses. UNLIKE that call site, a write failure here THROWS: the audio
  // is deleted right after this function returns, so there is no later
  // opportunity to retry just the outcome — failing the whole job lets core's
  // requeue converge on the SAME record (the upsert above is idempotent too).
  if (payload.outcome) {
    const outcomeResult = await setKaruteOutcomeWithClient(synqed, {
      karuteRecordId: record,
      customerId: payload.customer_id,
      status: payload.outcome.status,
      reason: payload.outcome.reason,
      isFirstVisit: payload.outcome.isFirstVisit,
      decidedBy: payload.staff_id,
    })
    if (outcomeResult.error) throw new Error(`outcome write failed: ${outcomeResult.error}`)
  }

  // Audit: the save is a completed action (server-side actor = the recorder).
  audit({
    category: 'karute',
    action: 'karute.save',
    actorId: payload.staff_id,
    actorType: 'staff',
    businessId: job.business_id,
    targetType: 'karute',
    targetId: record,
    detail: {
      via: 'job_pipeline',
      recording_session_id: job.recording_session_id,
      customer_id: payload.customer_id,
    },
    source: 'system',
  })

  // 5. Audio lifecycle: job complete → delete, exactly like the interactive
  // flow. Best-effort — a leftover object is cleaned by the daily sweep.
  await supabase.storage.from('recordings').remove([payload.audio_path]).catch(() => {})

  return record
}

// The extraction schema's Entry shape (types/ai): title IS the content line;
// snake_case fields per the structured-output contract.
type ExtractedEntry = {
  category: string
  title: string
  source_quote: string
  confidence_score: number
}

async function upsertKaruteRecord(
  synqed: SynqedClient,
  job: RecordingJob,
  payload: RecordingJobPayload,
  result: { transcript: string; summary: string; entries: ExtractedEntry[] },
): Promise<string> {
  const entries = result.entries.map((e) => ({
    category: e.category.toUpperCase() as
      | 'SYMPTOM' | 'TREATMENT' | 'BODY_AREA' | 'PREFERENCE'
      | 'LIFESTYLE' | 'NEXT_VISIT' | 'PRODUCT' | 'OTHER',
    content: e.title,
    original_quote: e.source_quote || null,
    confidence: e.confidence_score ?? 0,
    is_manual: false,
  }))

  // Same upsert contract as createOrUpdateKaruteRecord (actions/karute.ts):
  // only a 404 means "no record yet" — any other failure must throw so the
  // job retries rather than minting stale-content success.
  const existing = await synqed.karuteRecords
    .getByRecordingSession(job.recording_session_id)
    .catch((err: unknown) => {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? (err as { status: unknown }).status
          : undefined
      if (status === 404) return null
      throw err
    })
  if (existing) {
    await synqed.karuteRecords.update(existing.id, {
      transcript: result.transcript,
      ai_summary: result.summary,
      entries,
      appointment_id: payload.appointment_id ?? null,
    })
    return existing.id
  }
  const record = await synqed.karuteRecords.create({
    customer_id: payload.customer_id,
    staff_id: payload.staff_id,
    store_id: payload.store_id ?? null,
    appointment_id: payload.appointment_id ?? null,
    recording_session_id: job.recording_session_id,
    status: 'DRAFT',
    transcript: result.transcript,
    ai_summary: result.summary,
    duration_minutes: payload.duration_seconds
      ? Math.round(payload.duration_seconds / 60)
      : null,
    entries,
  })
  return record.id
}

/** Claim-and-process loop with a wall-clock budget (the route's maxDuration
 *  minus headroom). Returns counts for the tick's log line. */
export async function processRecordingJobs(budgetMs: number): Promise<{
  processed: number
  failed: number
}> {
  const deadline = Date.now() + budgetMs
  // Worker verbs are cross-tenant — business on this client is irrelevant for
  // claim/fail/complete, and per-job calls build a per-business client above.
  const worker = coreClient('00000000-0000-0000-0000-000000000000')
  let processed = 0
  let failed = 0

  while (Date.now() < deadline) {
    const job = await worker.recordingJobs.claim()
    if (!job) break
    try {
      const recordId = await processJob(job)
      await worker.recordingJobs.complete(job.id, recordId)
      processed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await worker.recordingJobs.fail(job.id, message).catch(() => {})
      failed++
      console.error(`[jobs] recording job ${job.id} failed:`, message)
    }
  }
  return { processed, failed }
}

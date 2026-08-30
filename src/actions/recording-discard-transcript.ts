'use server'

// A2-2 — the WORDS behind a reasoned discard (packet P5-A2, ⚖ 8/20 discard
// doctrine).
//
// WHY THIS EXISTS. A2-1 keeps the `recording_sessions` ROW of a discarded take,
// but nothing in this repo has ever written a TranscriptionSegment: the worker
// puts its transcript on a KARUTE RECORD, and a discard never gets one. So a
// manager reading 破棄の記録 saw the staffer's CLAIM with nothing to check it
// against. These two actions put the words next to the claim (⚖ 8/25 ruling A).
//
// ⛔ NOT THE JOB QUEUE. The only consumer of `recordingJobs` is the worker
// (lib/jobs/process-recording.ts), whose terminal step CREATES a normal DRAFT
// karute — a discarded recording enqueued there would surface as a real karute
// in every カルテ list (evidence corruption, doctrine R2). The mechanism here is
// `recordings.upsertSegments`, never enqueue.
//
// ⛔ NO PROMPT CHANGES. Transcription is not the summary prompt; a discard never
// reaches extraction or summarization, so KARUTE_PROMPT_VERSION is untouched.
//
// GATE: `records.write` — the RECORDER's own capability, the same one staging
// and enqueue carry. Reading these words back is a different question with a
// different gate (`staff.manage`, in recording-discards.ts).

import type { SynqedClient } from '@synqed-kk/client'
import { requireCapability } from '@/lib/auth/require-permission'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { newSynqedClient, getSynqedClient } from '@/lib/synqed/client'
import { createServiceClient } from '@/lib/supabase/service'
import { isOwnRecordingKey } from '@/lib/recording/key-grammar'
import { isConsentCurrent } from '@/lib/consent'
import { resolveSynqedStaffId } from '@/lib/synqed/staff-map'
import { runTranscription, speakerIdMode, loadStaffReferenceForStaff } from '@/lib/ai/transcribe'
import { buildDiarizedTranscript, toSpeakerText } from '@/lib/diarized'

/**
 * `skipped` is a SETTLED outcome, not a failure: the words are deliberately not
 * kept, so the caller deletes its take exactly as it would on success. Only
 * `error` means "try again later" — the take stays, stamped, for the sweep.
 * 'unsupported' is produced by the thin port alone (no facade route yet).
 */
export type DiscardTranscriptWrite =
  | { ok: true }
  | { skipped: 'consent' | 'empty' | 'unsupported' }
  | { error: 'forbidden' | 'not_discarded' | 'failed' }

type Core = Pick<SynqedClient, 'recordings' | 'recordingDiscards' | 'customers'>

/**
 * ⚖ 8/20 ⑤, FAIL CLOSED. A walk-in take has no customer who could have
 * consented, and a stale or unreadable consent is not consent — exactly the
 * worker's shape (process-recording.ts:81-84). For these takes the reason-only
 * row IS the doctrine outcome: nothing is transcribed and nothing is kept.
 */
async function consentAllows(synqed: Core, customerId: string | null): Promise<boolean> {
  if (!customerId) return false
  const { consent } = await synqed.customers.getConsent(customerId)
  return isConsentCurrent(consent)
}

/**
 * Content is persisted ONLY for a session a staff member has already discarded
 * WITH a written reason. Without this probe these actions would be a general
 * "write words onto any recording session" door.
 */
async function hasStaffDiscard(synqed: Core, recordingSessionId: string): Promise<boolean> {
  const res = await synqed.recordingDiscards.list({
    recording_session_id: recordingSessionId,
    source: 'STAFF',
    page_size: 1,
  })
  return (res?.events ?? []).some((e) => !!e?.reason)
}

/**
 * ONE segment carrying the whole text.
 * ponytail: PipelineResult and the worker's transcript are both flat
 * speaker-labeled text with no timestamps, and A2-4 renders text, not a
 * timeline. Upgrade path: real paragraph segments if a timeline surface ever
 * exists. `replace: true` makes a retry idempotent — a double persist leaves
 * one segment, never two copies of the same words.
 */
async function writeTranscript(
  synqed: Core,
  recordingSessionId: string,
  text: string,
  durationSeconds: number,
): Promise<void> {
  await synqed.recordings.upsertSegments(
    recordingSessionId,
    [
      {
        segment_index: 0,
        text,
        start_time: 0,
        end_time: Math.max(0, Math.round(durationSeconds)),
      },
    ],
    { replace: true },
  )
}

/**
 * The `review` origin: the take was already transcribed in-tab, so the words are
 * IN HAND and this costs zero transcription spend. Nothing is uploaded and
 * nothing is transcribed here.
 */
export async function persistDiscardTranscript(input: {
  recordingSessionId: string
  transcript: string
  durationSeconds: number
  customerId: string | null
}): Promise<DiscardTranscriptWrite> {
  try {
    await requireCapability('records.write')
    const text = input.transcript.trim()
    if (!text) return { skipped: 'empty' }
    const synqed = await getSynqedClient()
    if (!(await hasStaffDiscard(synqed, input.recordingSessionId))) {
      return { error: 'not_discarded' }
    }
    // Same gate as the transcribe twin: the doctrine question is whether the
    // customer's words may be KEPT, not merely whether transcribing costs money.
    if (!(await consentAllows(synqed, input.customerId))) return { skipped: 'consent' }
    await writeTranscript(synqed, input.recordingSessionId, text, input.durationSeconds)
    return { ok: true }
  } catch (err) {
    console.warn('[discard-transcript] persist failed:', err)
    return { error: 'failed' }
  }
}

/**
 * The `recorder` origin (and every retry of it): 使用 was never tapped, so no
 * transcript exists yet. The staged take is transcribed through the EXISTING
 * internals the worker uses — same org settings, same diarization assembly —
 * and the staged object is deleted afterwards, read-then-delete like the worker.
 *
 * Below the accidental-tap floor this is never called at all (⚖ spend gate);
 * that decision lives at the call site, with the floor constant.
 */
export async function transcribeAndPersistDiscard(input: {
  recordingSessionId: string
  audioPath: string
  customerId: string | null
  durationSeconds: number
  locale: string
}): Promise<DiscardTranscriptWrite> {
  try {
    await requireCapability('records.write')
    const businessId = await getBusinessId()
    // Tenant fence on a CLIENT-SUPPLIED key — the same invariant
    // enqueueRecordingJob enforces. The service-role client below bypasses RLS,
    // so this is the only thing standing between a caller and another tenant's
    // audio.
    if (!isOwnRecordingKey(input.audioPath, businessId)) return { error: 'forbidden' }

    const synqed = newSynqedClient(businessId)
    if (!(await hasStaffDiscard(synqed, input.recordingSessionId))) {
      return { error: 'not_discarded' }
    }

    const supabase = createServiceClient()
    if (!(await consentAllows(synqed, input.customerId))) {
      // Nothing is transcribed — but the staged object is still ours to sweep.
      await supabase.storage.from('recordings').remove([input.audioPath])
      return { skipped: 'consent' }
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from('recordings')
      .createSignedUrl(input.audioPath, 3600)
    if (signErr || !signed?.signedUrl) return { error: 'failed' }

    // The SAME org-derived options the worker resolves per job
    // (process-recording.ts:96-137) — this is that transcription, not a new one.
    const org = await synqed.orgSettings.get().catch(() => null)
    const settings = (org?.settings ?? null) as Parameters<typeof loadStaffReferenceForStaff>[0]
    const mode = speakerIdMode()
    // Voice reference = the DISCARDING staffer's own enrollment clip (#401),
    // resolved from the cookie session — they are the recorder.
    const selfStaffId = await getCurrentUserStaffId()
    const staffId = selfStaffId
      ? await resolveSynqedStaffId(selfStaffId).catch(() => selfStaffId)
      : null
    const reference = mode === 'off' ? null : await loadStaffReferenceForStaff(settings, staffId)
    const transcription = (await runTranscription({
      audio: { url: signed.signedUrl },
      locale: input.locale || 'ja',
      diarize: settings?.speaker_diarization !== false,
      reference,
      mode,
      businessType: settings?.business_type ?? null,
    })) as {
      transcript?: string
      paragraphs?: never[]
      words?: never[]
      confidence?: number
      speakerId?: { mode?: string; staffSpeakerIndex?: number; confidence?: number }
    }

    // Same Stage-0 diarization assembly as the worker: labeled text when
    // attribution succeeds, flat transcript on any failure.
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
    const text = (diarized ? toSpeakerText(diarized) : (transcription.transcript ?? '')).trim()

    if (text) await writeTranscript(synqed, input.recordingSessionId, text, input.durationSeconds)
    // Read-then-delete, the worker's posture. After the write, so a failed write
    // still has its audio for the next sweep.
    await supabase.storage.from('recordings').remove([input.audioPath])
    // Silence is an honest answer — A2-4 renders "no words" rather than a lie.
    return text ? { ok: true } : { skipped: 'empty' }
  } catch (err) {
    console.warn('[discard-transcript] transcribe failed:', err)
    return { error: 'failed' }
  }
}

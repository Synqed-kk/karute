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
import { getMyCapabilities } from '@/lib/auth/require-permission'
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
 * TRI-STATE, and the shape is decided by a COST ASYMMETRY, not by tidiness.
 *
 * A capability denial is TERMINAL and must say so: reported as `failed`, a
 * caller who can never succeed re-staged the whole audio on every record-page
 * mount until the take-store TTL pruned it. `forbidden` is this union's settled
 * refusal, and the client drops the take.
 *
 * But an EMPTY capability set has TWO causes and cannot tell them apart, which
 * is why the old blanket `requireCapability`-throws-so-it-is-forbidden shape was
 * wrong: an identity that could not be RESOLVED also reaches
 * `getMyCapabilities` as an empty set (require-permission.ts:31-33), because
 * `getCurrentUserStaffId` swallows an auth blip, a rotated JWT and a failed
 * staff-list read alike (staff.ts:209-216, :259-264). Answering
 * `forbidden` there is the same mistake `consentAllows` refuses to make one
 * function down: a probe that cannot READ is not an answer. Wrong `failed` costs
 * one wasted upload per mount, for ≤7 days, and the words survive. Wrong
 * `forbidden` deletes the take on the device and the words are gone forever —
 * exactly the evidence this action exists to keep. So the doubt goes to
 * `failed`, and only a RESOLVED identity that genuinely lacks `records.write`
 * earns the terminal answer.
 *
 * The two calls compose because both are React `cache()`d per request: the id
 * this checks is the id `getMyCapabilities` resolves against, so once it is
 * non-null an empty set can only mean a real denial. Nothing here re-implements
 * the auth module — a throw out of capability resolution is caught and is a
 * retry too.
 *
 * ponytail: `capabilitiesForUser`'s own DB fallback degrades to the
 * `practitioner` preset, which HOLDS `records.write` — so a profiles-read
 * failure fails OPEN into the write path rather than into a false `forbidden`.
 * That is the auth module's call, not this action's, and is out of scope here.
 */
async function recordsWriteGate(): Promise<DiscardTranscriptWrite | null> {
  try {
    if (!(await getCurrentUserStaffId())) return { error: 'failed' }
    return (await getMyCapabilities()).has('records.write') ? null : { error: 'forbidden' }
  } catch {
    return { error: 'failed' }
  }
}

/**
 * ⚖ 8/20 ⑤, FAIL CLOSED. A walk-in take has no customer who could have
 * consented, and a stale or unreadable consent is not consent — exactly the
 * worker's shape (process-recording.ts:81-84). For these takes the reason-only
 * row IS the doctrine outcome: nothing is transcribed and nothing is kept.
 *
 * The customer is read off the SESSION ROW, never off the caller's input. These
 * actions are reachable directly by any `records.write` holder, and a
 * client-named customer had no other effect here — it is written nowhere and
 * decides where nothing lands, so nothing downstream would contradict a wrong
 * one. It was a free lever: name any consenting customer of the business and a
 * non-consenting customer's words become transcribable. The session row's
 * binding is the record-time fact (doctrine R3). Not cryptographic — that column
 * is itself client-set at mint time behind this same capability; what deriving
 * removes is the ability to SWAP the id at persist time.
 *
 * An unreadable session row propagates rather than answering "no consent": a
 * probe that cannot read is not an answer, and the caller is owed the retry.
 */
async function consentAllows(synqed: Core, recordingSessionId: string): Promise<boolean> {
  const recording = await synqed.recordings.get(recordingSessionId)
  const customerId = recording?.customer_id ?? null
  if (!customerId) return false
  const { consent } = await synqed.customers.getConsent(customerId)
  return isConsentCurrent(consent)
}

/**
 * Content is persisted ONLY for a session a staff member has already discarded
 * WITH a written reason. Without this probe these actions would be a general
 * "write words onto any recording session" door.
 *
 * The session id is re-checked in code: this probe is a fence, and a fence does
 * not trust the query filter it asked for. If core ever stopped honouring
 * `recording_session_id` (a rename on an SDK bump, a regression) every session
 * in a business with one reasoned discard would pass — silently, and green,
 * because a fake that implements the filter cannot see it. Same
 * defense-in-depth as process-recording.ts's key-prefix re-check.
 */
async function hasStaffDiscard(synqed: Core, recordingSessionId: string): Promise<boolean> {
  const res = await synqed.recordingDiscards.list({
    recording_session_id: recordingSessionId,
    source: 'STAFF',
    page_size: 1,
  })
  return (res?.events ?? []).some(
    (e) => !!e?.reason && e.recording_session_id === recordingSessionId,
  )
}

/**
 * WHAT THIS PROBE DELIVERS, and what it does not. `records.write` is the
 * RECORDER's own capability, so without it the staffer who discarded the take
 * could call either action again and replace the words a manager is about to
 * check their written claim against. It shuts the SEQUENTIAL door: call either
 * action again later and the landed text stands.
 *
 * A hit is `{ ok: true }`, not an error: honest retries and double-taps converge
 * on the same settled outcome, and it sits ahead of the consent gate because an
 * already-landed transcript needs no consent re-answer.
 *
 * It is check-then-write, so a CONCURRENCY WINDOW remains: two calls that both
 * pass the probe both write, and `upsertSegments(..., {replace:true})` makes
 * that last-write-wins. Closing it for real is a core-side uniqueness constraint
 * (P5-B) — the same ceiling, and the same answer, as the discard row's own BA-1
 * note (lib/recording/discard.ts). The client-side in-flight guard
 * (lib/recording/discard-transcript.ts) narrows the same-page case; it is not a
 * lock.
 *
 * Three more residuals, stated rather than implied:
 *   - the FIRST write is client-trusted — nothing app-side proves the text came
 *     off the take that was discarded;
 *   - the discard-row fence proves a discard EXISTS on this session, not that
 *     the caller is the one who made it (`discarded_by` is deliberately not
 *     compared: the staff-card / login-uuid id split makes a strict compare
 *     refuse honest callers);
 *   - the ⚖ spend floor is decided at the call site, on a client-sent duration.
 *     The server still has no AUTHORITATIVE one, so a crafted call can
 *     transcribe a sub-floor take. `recordings.duration_seconds` is written as
 *     of the names fix (2026-08-31), but only by the discard path and only from
 *     the duration that same client reported — client-reported, not
 *     server-derived, and not written at all until the discard's receipt has
 *     landed. Flooring it against itself would prove nothing. Money, not
 *     evidence; a server-side floor waits on a duration core measures.
 * Custody of the first-write claim is core-side work (P5-B), not something this
 * action can close.
 *
 * A probe that cannot read fails the action rather than falling through to the
 * write — an unreadable ledger is not permission to overwrite.
 */
async function alreadyLanded(synqed: Core, recordingSessionId: string): Promise<boolean> {
  const res = await synqed.recordings.listSegments(recordingSessionId)
  return (res?.segments ?? []).length > 0
}

/**
 * ONE segment carrying the whole text.
 * ponytail: PipelineResult and the worker's transcript are both flat
 * speaker-labeled text with no timestamps, and A2-4 renders text, not a
 * timeline. Upgrade path: real paragraph segments if a timeline surface ever
 * exists. `replace: true` stays behind `alreadyLanded`, where it is retry
 * safety — never two copies of the same words — and not an overwrite door.
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
}): Promise<DiscardTranscriptWrite> {
  const denied = await recordsWriteGate()
  if (denied) return denied
  try {
    const text = input.transcript.trim()
    if (!text) return { skipped: 'empty' }
    const synqed = await getSynqedClient()
    if (!(await hasStaffDiscard(synqed, input.recordingSessionId))) {
      return { error: 'not_discarded' }
    }
    if (await alreadyLanded(synqed, input.recordingSessionId)) return { ok: true }
    // Same gate as the transcribe twin: the doctrine question is whether the
    // customer's words may be KEPT, not merely whether transcribing costs money.
    if (!(await consentAllows(synqed, input.recordingSessionId))) return { skipped: 'consent' }
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
 * that decision lives at the call site, with the floor constant, and the server
 * still cannot re-check it. `recordings.duration_seconds` does get written now
 * (the names fix, 2026-08-31), but the discard path stamps it from the SAME
 * client-reported duration — so it is a record of what the client said, not an
 * authoritative measurement to floor against (see alreadyLanded).
 */
export async function transcribeAndPersistDiscard(input: {
  recordingSessionId: string
  audioPath: string
  durationSeconds: number
  locale: string
}): Promise<DiscardTranscriptWrite> {
  const denied = await recordsWriteGate()
  if (denied) return denied
  try {
    const businessId = await getBusinessId()
    // Tenant fence on a CLIENT-SUPPLIED key — the same invariant
    // enqueueRecordingJob enforces. The service-role client below bypasses RLS,
    // so this is the only thing standing between a caller and another tenant's
    // audio. AHEAD of the janitor below on purpose: a foreign key is the one
    // exit that must never touch the object it names.
    if (!isOwnRecordingKey(input.audioPath, businessId)) return { error: 'forbidden' }

    const supabase = createServiceClient()
    try {
      const synqed = newSynqedClient(businessId)
      if (!(await hasStaffDiscard(synqed, input.recordingSessionId))) {
        return { error: 'not_discarded' }
      }

      // `||` short-circuits on purpose: consent is not re-asked once the words
      // have landed.
      const landed = await alreadyLanded(synqed, input.recordingSessionId)
      if (landed || !(await consentAllows(synqed, input.recordingSessionId))) {
        return landed ? { ok: true } : { skipped: 'consent' }
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
      // Silence is an honest answer — A2-4 renders "no words" rather than a lie.
      return text ? { ok: true } : { skipped: 'empty' }
    } finally {
      // ONE janitor, on EVERY exit past the tenant fence — refusal, failure and
      // success alike. The client uploads before it calls, so an exit that left
      // the object behind orphaned a DISCARDED recording's audio in the bucket
      // (≤25 h, until the flat-key cleanup cron) and the next sweep uploaded
      // another. Read-then-delete stays the worker's posture: a failed write
      // does not need this object back — the sweep re-stages from the take that
      // is still in the store.
      // Wrapped: the outcome the caller reads must reflect the WRITE, never the
      // janitor, and a `finally` that throws would REPLACE the answer.
      try {
        await supabase.storage.from('recordings').remove([input.audioPath])
      } catch (err) {
        console.warn('[discard-transcript] staged audio sweep failed:', err)
      }
    }
  } catch (err) {
    console.warn('[discard-transcript] transcribe failed:', err)
    return { error: 'failed' }
  }
}

import 'server-only'

// The two client-threaded discard-transcript bodies, moved out of
// src/actions/recording-discard-transcript.ts (PKT-SEC-CORES-C, 2026-09-23).
// Every runtime export of a 'use server' module is registered as a
// browser-callable server action with no authentication of its own — and
// passing a client object as the first argument is no barrier, because the
// reply decoder revives nested references. These two are INTERNAL helpers:
// they take an already-scoped client — and, for the transcribe door, an actor
// the CALLER resolved — and trust that caller to have gated the request. They
// live here, in a server-only module with NO directive, so the only way in is
// a server-side import: the cookie wrappers in
// src/actions/recording-discard-transcript.ts and the facade route
// src/app/api/app/v1/recordings/discards/transcript/route.ts POST.
//
// WHY THESE WORDS EXIST AT ALL — the A2-2 doctrine, the `records.write` gate,
// and the ⛔ NOT THE JOB QUEUE / ⛔ NO PROMPT CHANGES rulings — stays in that
// action file's header, its one home.

import type { SynqedClient } from '@synqed-kk/client'
import { createServiceClient } from '@/lib/supabase/service'
import { isOwnAudioKey, isOwnRecordingKey, isStagedKeyFor, parseRecordingKey } from '@/lib/recording/key-grammar'
import { resolveTakeAudio } from '@/lib/recording/take-audio'
import { isConsentCurrent } from '@/lib/consent'
import { resolveSynqedStaffIdForBusiness } from '@/lib/synqed/staff-map'
import { runMeteredTranscription, speakerIdMode, loadStaffReferenceForStaff } from '@/lib/ai/transcribe'
import { buildDiarizedTranscript, toSpeakerText } from '@/lib/diarized'

/**
 * `skipped` is a SETTLED outcome, not a failure: the words are deliberately not
 * kept, so the caller deletes its take exactly as it would on success. Only
 * `error` means "try again later" — the take stays, stamped, for the sweep.
 *
 * A fourth answer, `skipped: 'unsupported'`, was the thin port's alone while the
 * phone had no facade route. It has one now (PHONEWIRE-2C), so nothing can
 * produce that value and it is gone rather than left as a contract nobody keeps.
 */
export type DiscardTranscriptWrite =
  | { ok: true }
  | { skipped: 'consent' | 'empty' }
  | { error: 'forbidden' | 'not_discarded' | 'failed' }

type Core = Pick<SynqedClient, 'recordings' | 'recordingDiscards' | 'customers'>
/** The transcribe door reads org settings too (diarization + business type), and
 *  since the spend wall (2026-09-08) it asks the AI ledger before it spends. */
type TranscribeCore = Core & Pick<SynqedClient, 'orgSettings' | 'aiRateLimit'>

/**
 * WHO is writing — resolved by the CALLER, never by the shared body, exactly as
 * DiscardRecordingActor is (lib/recording/discard.ts). `staffId` is the
 * auth-user uuid both doors already hold (getCurrentUserStaffId on web,
 * `identity.authUserId` on the facade) and decides ONE thing, whose voice
 * reference the transcription gets; `null` means "no reference". `businessId` is
 * the tenant fence the staged key is checked against.
 *
 * Only the transcribe door needs one — the review door writes words already in
 * hand and reads nothing outside the client's own tenant scope, the same reason
 * getDiscardTranscriptWithClient takes no actor either.
 */
export interface DiscardTranscriptActor {
  staffId: string | null
  businessId: string
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
async function consentAllows(
  synqed: Core,
  recording: { customer_id?: string | null } | null,
): Promise<boolean> {
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
export async function persistDiscardTranscriptWithClient(
  synqed: Core,
  input: {
    recordingSessionId: string
    transcript: string
    durationSeconds: number
  },
): Promise<DiscardTranscriptWrite> {
  try {
    const text = input.transcript.trim()
    if (!text) return { skipped: 'empty' }
    if (!(await hasStaffDiscard(synqed, input.recordingSessionId))) {
      return { error: 'not_discarded' }
    }
    if (await alreadyLanded(synqed, input.recordingSessionId)) return { ok: true }
    // Same gate as the transcribe twin: the doctrine question is whether the
    // customer's words may be KEPT, not merely whether transcribing costs money.
    // The row is read HERE and handed in, exactly as the twin does it — the
    // customer is the row's, never the caller's.
    const recording = await synqed.recordings.get(input.recordingSessionId)
    if (!(await consentAllows(synqed, recording))) return { skipped: 'consent' }
    await writeTranscript(synqed, input.recordingSessionId, text, input.durationSeconds)
    return { ok: true }
  } catch (err) {
    console.warn('[discard-transcript] persist failed:', err)
    return { error: 'failed' }
  }
}

/**
 * The `recorder` origin (and every retry of it): 使用 was never tapped, so no
 * transcript exists yet. The take's FINALIZED object is transcribed through the
 * EXISTING internals the worker uses — same org settings, same diarization
 * assembly — and ⚖ it is left exactly where it is (PR4): a discarded
 * recording's audio is kept in full (⚖ 8/20 discard doctrine), only its words
 * are collected here.
 *
 * Below the accidental-tap floor this is never called at all (⚖ spend gate);
 * that decision lives at the call site, with the floor constant, and the server
 * still cannot re-check it. `recordings.duration_seconds` does get written now
 * (the names fix, 2026-08-31), but the discard path stamps it from the SAME
 * client-reported duration — so it is a record of what the client said, not an
 * authoritative measurement to floor against (see alreadyLanded).
 */
export async function transcribeAndPersistDiscardWithClient(
  synqed: TranscribeCore,
  actor: DiscardTranscriptActor,
  input: {
    recordingSessionId: string
    audioPath: string
    durationSeconds: number
    locale: string
  },
): Promise<DiscardTranscriptWrite> {
  try {
    // Tenant fence on a CLIENT-SUPPLIED key — the same invariant
    // enqueueRecordingJob enforces. The service-role client below bypasses RLS,
    // so this is the only thing standing between a caller and another tenant's
    // audio. FIRST on purpose: a foreign key is the one exit that must never
    // reach the object it names, not even to read it.
    //
    // THREE SHAPES REACH IT: the take's own finalized key — which has to pass
    // because the ordinary discard names the row's own pointer — the nightly
    // job's RESCUE of that take (⚖ ADDENDUM 9.1: a karute made from a rescue
    // must be discardable, and its audio path is a `rsc/` key), and a STAGED
    // copy named for THIS session, which is the only claim this door honours in
    // place of that pointer. Asked once, read twice: here as the tenant fence,
    // and below as the binding.
    //
    // `isOwnAudioKey`, not `isOwnRecordingKey`: this is an AUDIO path, and the
    // row-POINTER check further down stays take-only. A segment, a staged copy
    // of another session and every other tenant's object are refused by both.
    const ownStaged = isStagedKeyFor(
      input.audioPath,
      actor.businessId,
      input.recordingSessionId,
    )
    if (!ownStaged && !isOwnAudioKey(input.audioPath, actor.businessId)) {
      return { error: 'forbidden' }
    }

    const supabase = createServiceClient()
    if (!(await hasStaffDiscard(synqed, input.recordingSessionId))) {
      return { error: 'not_discarded' }
    }

    // Consent is not re-asked once the words have landed, and the row below is
    // not read for a call that has nothing left to do.
    if (await alreadyLanded(synqed, input.recordingSessionId)) return { ok: true }

    // ⚖ THE AUDIO KEY COMES OFF THE ROW (capture pipeline PR4 fix round 1). The
    // object is PERMANENT now — nothing sweeps it after this call — so a
    // client-named path is a standing lever: any records.write holder could
    // name a colleague's finished take and have it transcribed onto a session
    // that really was discarded, and the words would land as that session's.
    // `audio_storage_path` is the record-time fact the mint reserved and
    // finalize proved, exactly as the customer above is read off the row rather
    // than off the caller. The client's claim stands in ONLY for a row that
    // carries no pointer (a session minted before the reservation existed), and
    // the tenant fence at the top of this function is the belt under both.
    // An unreadable row throws into the catch below rather than answering.
    const recording = await synqed.recordings.get(input.recordingSessionId)
    const pointer = recording?.audio_storage_path ?? null
    if (pointer && !isOwnRecordingKey(pointer, actor.businessId)) return { error: 'forbidden' }
    // ⚖ …AND ONLY WHILE THE OBJECT IT NAMES IS REALLY THERE (fix round 3).
    // Every session is BORN RESERVED (session-mint.ts), so the pointer names
    // this take's finalized key from the row's first instant — including for a
    // take that can NEVER be sealed under it (a lost tail, a stop leg that died
    // before it could stamp, a terminal refusal). That key holds no object, and
    // fix round 2 stages such a take's own blob under a second key and sends
    // THAT path here. Preferring the pointer threw it away: the signing below
    // fails, `failed` is retryable, and every record-page mount re-staged a
    // fresh whole-take copy of the same audio, for ever, while the words never
    // landed.
    //
    // THE ROW CANNOT ANSWER THIS — verified, not assumed. The mint creates the
    // row carrying the key AND status UPLOADING; finalize adds duration_seconds
    // and writes the SAME UPLOADING back (finalize-take.ts), so no status
    // flips; and the reasoned discard this action requires has itself already
    // stamped duration_seconds on the row (discard.ts's stampRecordingDuration,
    // fired after the receipt lands — which hasStaffDiscard above proves it
    // did). Every row reaching this line therefore looks finalized whether or
    // not it is. Storage is the only honest fact, asked with the ONE existence
    // probe the upload mint and the session mint already share.
    //
    // Asked ONLY when the caller named a DIFFERENT key: the ordinary discard
    // sends the finalized key itself, so there is nothing to decide and nothing
    // to pay for. A probe that cannot READ is not an answer ('unknown') — and
    // since ADDENDUM 9.2 H4 it no longer keeps the pointer either: the arm
    // below returns `failed`, which is retryable, rather than signing a key
    // nobody has confirmed holds anything. The full reason is in the ⚖ block
    // at the end of this comment.
    // B5 is untouched: a colleague's FINISHED take has an object, so a row
    // pointing at one still wins over any claim, and `input.audioPath` cleared
    // the SAME isOwnRecordingKey fence at the top of this function before
    // anything here read it.
    //
    // ⚖ …AND A CLAIM IS ONLY EVER THIS SESSION'S OWN STAGED COPY (fix round 7).
    // Two branches reach `input.audioPath` — a row that carries no pointer, and
    // a pointer whose object never landed — and both used to accept ANY
    // same-tenant key, so a records.write holder could name a COLLEAGUE'S
    // finished take and have its words written onto an unrelated discarded
    // session. A staged copy now carries the session it was staged for in its
    // KEY, which is the identity a row-less object otherwise has none of, so
    // the claim is CHECKED rather than trusted. B5 is untouched: a pointer
    // whose object is really there still wins, whatever the caller named.
    //
    // ⚖ …AND THE POINTER IS RESOLVED, NOT PROBED (ADDENDUM 9.2 H4, Liam
    // 2026-09-06 "b"). The nightly job writes BESIDE a take now, so for a
    // rescued recording the pointer names a key that is genuinely empty while
    // the audio sits one prefix over. A bare `objectExists(pointer)` therefore
    // read false and sent every rescued karute to `forbidden` — a state nobody
    // decided. resolveTakeAudio asks the same question in the order every
    // reader shares: the phone's object first, the rescue second. `absent` is
    // the old false and keeps the staged-claim arm below; an UNANSWERABLE probe
    // is `failed` — retryable — never `forbidden`, because refusing somebody's
    // own discard on a storage blip is a permission answer we do not have.
    let audioPath = input.audioPath
    const parsedPointer = pointer ? parseRecordingKey(pointer, actor.businessId) : null
    if (pointer && pointer === input.audioPath) {
      audioPath = pointer
    } else if (parsedPointer?.kind === 'take') {
      const resolved = await resolveTakeAudio(
        actor.businessId,
        parsedPointer.takeId,
        parsedPointer.ext,
      )
      if (resolved === 'unknown') return { error: 'failed' }
      if (resolved !== 'absent') audioPath = resolved.key
      else if (!ownStaged) return { error: 'forbidden' }
    } else if (!ownStaged) {
      return { error: 'forbidden' }
    }

    if (!(await consentAllows(synqed, recording))) return { skipped: 'consent' }

    const { data: signed, error: signErr } = await supabase.storage
      .from('recordings')
      .createSignedUrl(audioPath, 3600)
    if (signErr || !signed?.signedUrl) return { error: 'failed' }

    // The SAME org-derived options the worker resolves per job
    // (process-recording.ts:96-137) — this is that transcription, not a new one.
    const org = await synqed.orgSettings.get().catch(() => null)
    const settings = (org?.settings ?? null) as Parameters<typeof loadStaffReferenceForStaff>[0]
    const mode = speakerIdMode()
    // Voice reference = the DISCARDING staffer's own enrollment clip (#401) —
    // they are the recorder. The id arrives on the actor (cookie session on
    // web, Bearer `sub` on the facade); the map lookup is the tenant-explicit
    // twin, so neither door has to reach for a cookie to know its business.
    const selfStaffId = actor.staffId
    const staffId = selfStaffId
      ? await resolveSynqedStaffIdForBusiness(selfStaffId, actor.businessId).catch(
          () => selfStaffId,
        )
      : null
    const reference = mode === 'off' ? null : await loadStaffReferenceForStaff(settings, staffId)
    // The take these words belong to, read off the key the fences above proved
    // (a staged claim carries the session, not a take — then there is none).
    const parsedAudio = parseRecordingKey(audioPath, actor.businessId)
    // Only the provider body is used here; the meter files this door's own
    // receipt (including whether the debit landed) from inside the wrapper.
    const { result: transcription } = (await runMeteredTranscription(
      {
        synqed,
        businessId: actor.businessId,
        door: 'discard',
        recordingSessionId: input.recordingSessionId,
        customerId: recording?.customer_id ?? null,
        staffId,
        takeId: parsedAudio && 'takeId' in parsedAudio ? parsedAudio.takeId : null,
      },
      {
        audio: { url: signed.signedUrl },
        locale: input.locale || 'ja',
        diarize: settings?.speaker_diarization !== false,
        reference,
        mode,
        businessType: settings?.business_type ?? null,
      },
    )) as {
      result: {
        transcript?: string
        paragraphs?: never[]
        words?: never[]
        confidence?: number
        speakerId?: { mode?: string; staffSpeakerIndex?: number; confidence?: number }
      }
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
    //
    // ⚖ AND NOTHING IS SWEPT (capture pipeline PR4). A `finally` here used to
    // delete the object on EVERY exit past the tenant fence, back when the
    // client staged a throwaway copy before every call. The audio it now reads
    // is the take's own FINALIZED object — the discarded recording itself, kept
    // in full (⚖ 8/20 discard doctrine) — so there is nothing to sweep and
    // nothing this may destroy.
    return text ? { ok: true } : { skipped: 'empty' }
  } catch (err) {
    // A SPEND-WALL refusal lands here too, and `failed` is the right answer for
    // it: retryable, and cheap — one refused ledger read per record-page mount
    // and no money, until the rolling window frees and the sweep succeeds.
    console.warn('[discard-transcript] transcribe failed:', err)
    return { error: 'failed' }
  }
}

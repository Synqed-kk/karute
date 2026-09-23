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
//
// TWO DOORS, ONE BODY (PHONEWIRE-2C). The phone reaches server code only through
// facade routes, so each action here is split the repo's usual way (discard.ts,
// recording-discards.ts): a `*WithClient` body taking its client — and, where it
// needs one, its ACTOR — from the caller, plus the cookie wrapper the web page
// still calls. The facade twin (…/recordings/discards/transcript POST) resolves
// both from the verified Bearer identity. The capability gate stays OUTSIDE the
// shared body deliberately: cookies answer it one way (recordsWriteGate below,
// tri-state) and a Bearer route another (ensureCapability) — a body that trusted
// a caller-supplied actor for the gate would be a door with no lock.
//
// …AND THE SHARED BODIES ARE NOT IN THIS FILE (PKT-SEC-CORES-C, 2026-09-23).
// Every runtime export of a 'use server' module is a browser-callable endpoint
// with no authentication of its own, so a body that takes its client from the
// caller may not be one: both live in src/lib/recording/discard-transcript.core.ts,
// a server-only module. Only the cookie wrappers and their gate are below.

import { getMyCapabilities } from '@/lib/auth/require-permission'
import { getBusinessId, getCurrentAccessToken, getCurrentUserStaffId } from '@/lib/staff'
import { newSynqedClient, getSynqedClient } from '@/lib/synqed/client'
// The two client-threaded bodies left this file for that server-only module;
// never re-export them from here.
import {
  persistDiscardTranscriptWithClient,
  transcribeAndPersistDiscardWithClient,
} from '@/lib/recording/discard-transcript.core'

export type DiscardTranscriptWrite =
  import('@/lib/recording/discard-transcript.core').DiscardTranscriptWrite
export type DiscardTranscriptActor =
  import('@/lib/recording/discard-transcript.core').DiscardTranscriptActor

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

/** Cookie door for the above — the web record page's own call. */
export async function persistDiscardTranscript(input: {
  recordingSessionId: string
  transcript: string
  durationSeconds: number
}): Promise<DiscardTranscriptWrite> {
  const denied = await recordsWriteGate()
  if (denied) return denied
  try {
    return await persistDiscardTranscriptWithClient(await getSynqedClient(), input)
  } catch (err) {
    console.warn('[discard-transcript] persist failed:', err)
    return { error: 'failed' }
  }
}

/**
 * Cookie door for the above — the web record page's own call.
 *
 * The two identity reads move AHEAD of the tenant fence, which the fence's own
 * docstring is unaffected by: it guards the SERVICE-ROLE storage client, and
 * neither read touches storage. Both are React `cache()`d and both were already
 * resolved by recordsWriteGate one line up, so a foreign key costs the same
 * nothing it always did.
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
    return await transcribeAndPersistDiscardWithClient(
      newSynqedClient(businessId, await getCurrentAccessToken()),
      { staffId: await getCurrentUserStaffId(), businessId },
      input,
    )
  } catch (err) {
    console.warn('[discard-transcript] transcribe failed:', err)
    return { error: 'failed' }
  }
}

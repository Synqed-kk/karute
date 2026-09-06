'use server'

import { getBusinessId, getCurrentAccessToken, getCurrentUserStaffId } from '@/lib/staff'
import { can, getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { holdsOwnerKeys } from '@/lib/auth/permissions'
import { getSynqedClient, newSynqedClient } from '@/lib/synqed/client'
import { resolveWebAuditContext } from '@/lib/audit-web'
import { deleteRecordingSessionWithClient } from '@/lib/recording/session-cleanup'
import { startRecordingSessionWithClient } from '@/lib/recording/session-mint'
import {
  finalizeTakeWithClient,
  type FinalizeTakeInput,
  type FinalizeTakeResult,
} from '@/lib/recording/finalize-take'

/**
 * Mints a `recording_sessions` row (synqed-core, server-generated uuid) the
 * moment a recording starts, so the eventual karute save can attach
 * recording_session_id — the id core's createKaruteRecord dedupes an
 * idempotent retry against (PR #38). A client-invented id would FK-violate;
 * this id MUST come from synqed.recordings.create().
 *
 * Called from GlobalRecorder.start() IN PARALLEL with getUserMedia — recording
 * must never be blocked or delayed by this network call. On ANY failure
 * (no staff identity, capability denied, SDK throw) returns null: the save
 * simply proceeds without recording_session_id, exactly like before this
 * feature existed (no dedupe for that save — accepted graceful degradation).
 *
 * BORN RESERVED (fix round 10). `takeId` + `mimeType` are OPTIONAL, and when
 * they arrive the minted row already carries this take's storage key — see
 * session-mint.ts (fix round 11: moved out of this 'use server' file, which
 * would otherwise expose businessId to a client-invokable action) for why one
 * atomic create replaces the mint's update.
 */
export async function startRecordingSession(input: {
  customerId?: string | null
  appointmentId?: string | null
  takeId?: string | null
  mimeType?: string | null
}): Promise<{ id: string } | null> {
  try {
    // Recording a session = records.write — same gate saveKaruteRecord uses
    // (owner / manager / senior / practitioner — not frontdesk).
    await requireCapability('records.write')

    const synqed = await getSynqedClient()

    // Recorder-first attribution (the signed-in staff), appointment-staff
    // fallback only when the account has no staff identity of its own.
    const staffId = await getCurrentUserStaffId()
    // The tenant prefix a client-named take's key carries — read off the COOKIE
    // session, never off the argument (this is a 'use server' export, so the
    // argument is caller-supplied JSON however it is typed, and businessId is
    // the whole fence on a service-role storage key). Resolved ONLY when there
    // is a key to compose, so a start with no take makes exactly the calls it
    // made before this round.
    const businessId = input.takeId ? await getBusinessId() : null
    // THE STORE THE DEVICE IS IN (slice three ③) — the SAME value
    // enqueueRecordingJob already stamps on the job payload
    // (actions/recording-jobs.ts), so one recording never carries two answers
    // to "which branch was this". Read off the cookie session, never the
    // argument, exactly like businessId above.
    //
    // It adds no new failure mode to this door: `requireCapability` above has
    // already resolved (and React-cached) the capabilities and the staff id
    // this scope reads, the active store is a cookie, and the two core lookups
    // it can still make — getPrimaryStoreId and getStaffStoresStrict — both
    // swallow their own failures to null (actions/stores.ts). Dynamic import,
    // the repo convention for this module (see actions/regenerate-karute.ts):
    // a top-level one drags the ESM-only SDK into this module's jest graph.
    const { storeId } = await (await import('@/lib/auth/store-scope')).resolveStoreScope()
    const res = await startRecordingSessionWithClient(synqed, {
      ...input,
      selfStaffId: staffId,
      businessId,
      storeId,
    })
    // A take id or container this server will not store, a key already spoken
    // for (`exists`), or storage failing to answer (`upstream`) — every
    // refusal this core can produce is still a settled object, never a throw,
    // and this door's contract stays fail-OPEN: null, exactly like every other
    // failure here. The take keeps its id, the upload mint refuses it the same
    // way (bad_take_id / bad_mime / exists), and capture is never blocked. The
    // facade twin, which can answer in statuses, 400s/409s/502s instead.
    return res && 'error' in res ? null : res
  } catch (err) {
    console.error('[startRecordingSession] failed:', err)
    return null
  }
}

/**
 * Web door for "this take is complete" — the cookie twin of
 * POST /api/app/v1/recordings/finalize. Both call the ONE choke point
 * (lib/recording/finalize-take.ts), which owns the tenant fence, the ownership
 * check, the idempotency and the single audit row.
 *
 * Every identity the core needs is resolved HERE, from the cookie session:
 * a caller cannot name its own business, staff or reach. Finalize still CHOOSES
 * no store — it never mints a row any more (the mint binds the take to one
 * first), so it has none to pick. What it DOES need since slice three ③ is the
 * caller's own store REACH: finalizing a colleague's take is the owner's hand,
 * and the owner's hand stops at the stores that person can see. Resolved only
 * when the pair is held, so an assignment blip never costs a recorder her own
 * take. Same wording as the facade twin (recordings/finalize/route.ts).
 *
 * NEVER THROWS. Finalize runs on the stop path, and a thrown finalize would
 * put an error dialog between the staffer and a take whose audio is already
 * on the server. Every failure is a settled `{ error }` the caller can retry.
 */
export async function finalizeTake(input: FinalizeTakeInput): Promise<FinalizeTakeResult> {
  try {
    // Same gate as the mint and the session start — recording = records.write —
    // but asked with can(), not requireCapability(): this action answers in a
    // result UNION, and a denied capability is TERMINAL. Folded into the catch
    // below it became 'failed', which the client reads as RETRYABLE and would
    // loop on forever against a permission it will never gain. Same reason
    // createAppointment (src/actions/appointments.ts) uses can(). A THROW from
    // here is still infrastructure, and still maps to the retryable 'failed'.
    if (!(await can('records.write'))) return { error: 'forbidden' }
    const [businessId, staffId, capabilities] = await Promise.all([
      getBusinessId(),
      getCurrentUserStaffId(),
      getMyCapabilities(),
    ])
    // ③ THE OWNER'S HAND REACHES ONLY WHERE THE PERSON CAN SEE. Resolved ONLY
    // when the pair is held (the playback action's idiom, src/actions/
    // recording-playback.ts): a recorder acting on her OWN session never
    // reaches the store leg, so an assignment blip must not cost her the take.
    // One spelling of the web act scope — viewerScopeForActs; dynamic import,
    // the repo convention (a top-level one drags the ESM-only SDK into this
    // module's jest graph).
    const pairHeld = holdsOwnerKeys(capabilities)
    const allowedStoreIds = pairHeld
      ? await (await import('@/lib/auth/store-scope')).viewerScopeForActs()
      : null

    return await finalizeTakeWithClient(
      newSynqedClient(businessId, await getCurrentAccessToken()),
      {
        staffId,
        businessId,
        holdsOwnerKeys: pairHeld,
        allowedStoreIds,
        source: 'web',
      },
      input,
    )
  } catch (err) {
    console.warn('[finalizeTake] failed:', err)
    return { error: 'failed' }
  }
}

/**
 * The mint's undo — see lib/recording/session-cleanup.ts for why this exists
 * and when it gets deleted. Web door; the facade twin is
 * /api/app/v1/recordings/session/[id]. Fire-and-forget by contract: callers
 * never await it into the discard UX.
 */
export async function deleteRecordingSession(
  recordingSessionId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    // Same gate the mint carries — only a recorder discards a recording.
    await requireCapability('records.write')
    const [synqed, staffId, ctx] = await Promise.all([
      getSynqedClient(),
      getCurrentUserStaffId(),
      resolveWebAuditContext(),
    ])
    return await deleteRecordingSessionWithClient(
      synqed,
      { staffId, businessId: ctx.businessId, source: 'web' },
      recordingSessionId,
    )
  } catch (err) {
    // Never blocks the discard — the row just stays until the 7-day window
    // rolls past it.
    console.warn('[deleteRecordingSession] failed:', err)
    return { error: 'failed' }
  }
}

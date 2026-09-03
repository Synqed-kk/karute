'use server'

import type { SynqedClient } from '@synqed-kk/client'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { can, getMyCapabilities, requireCapability } from '@/lib/auth/require-permission'
import { getSynqedClient, newSynqedClient } from '@/lib/synqed/client'
import { resolveWebAuditContext } from '@/lib/audit-web'
import { deleteRecordingSessionWithClient } from '@/lib/recording/session-cleanup'
import { composeTakeKey } from '@/lib/recording/key-grammar'
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
 * they arrive the minted row already carries this take's storage key — see the
 * core below for why one atomic create replaces the mint's update.
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
    const res = await startRecordingSessionWithClient(synqed, {
      ...input,
      selfStaffId: staffId,
      businessId,
    })
    // A take id or container this server will not store is a CLIENT bug, and
    // this door's contract is fail-OPEN: null, exactly like every other failure
    // here. The take keeps its id, the upload mint refuses it the same way
    // (bad_take_id / bad_mime), and capture is never blocked. The facade twin,
    // which can answer in statuses, 400s instead.
    return res && 'error' in res ? null : res
  } catch (err) {
    console.error('[startRecordingSession] failed:', err)
    return null
  }
}

/** `bad_input` is the only refusal this core can produce: a take pair it will
 *  not compose a key from. `null` stays what it has always been — no staff
 *  identity to attribute a row to, the fail-OPEN case. */
export type StartRecordingSessionResult = { id: string } | { error: 'bad_input' } | null

/**
 * Recording-session mint core — EXPLICIT business-scoped client + a resolved
 * self staff id, no cookie (packet 08 §Build 3). Shared by the web action
 * (cookie → getCurrentUserStaffId) and the facade route (Bearer → selfStaffId).
 * Recorder-first attribution with the appointment-staff fallback; a null on any
 * unresolvable staff preserves the web action's fail-OPEN contract (capture
 * proceeds without dedupe — never blocked on the mint). Throws only on a genuine
 * SDK failure, which the callers swallow to null.
 *
 * BORN RESERVED (fix round 10). This is the ONE door that mints rows, and as of
 * this round every row it mints for a client-named take is created WITH the
 * take's key on it. Why: the upload mint used to reserve the key by UPDATING an
 * unbound row, and two mints naming DIFFERENT takes on one unbound row can both
 * read `audio_storage_path === null` and then write in turn — the second
 * silently repoints the row and orphans the first take's object, and core's
 * unique key never fires because the two keys differ. Closing that from this
 * repo needs a conditional update core does not expose (Anthony addendum #4).
 * A row that is never unbound cannot be raced for: the recorder already owns
 * its take id (take-store) and has already negotiated its container at start(),
 * so the binding can be part of the create itself — one write, no window. The
 * mint's update path survives only for LEGACY rows minted before this round.
 *
 * KNOWN CEILING, and it is the one fix round 7 moved row-minting HERE to escape:
 * a create that carries a key is no longer a safe blind retry. Round 7's
 * argument was that this door's retry "carries no key" — as of this round a
 * client-named start does, so a LOST RESPONSE after a successful create leaves
 * the client with no session id, and re-sending the SAME take composes the SAME
 * key, which core's unique index refuses (409). That throw is swallowed to the
 * fail-OPEN null by both doors, so capture is never blocked, but the take is
 * unrecoverable: no id to name its row with, and the key is spoken for.
 * THE CLIENT RULE that closes it (PR3, and the reason the client contract says
 * so explicitly): a take-carrying start that comes back null must be retried
 * with a FRESH take id, never the same one — a new take id is free, and it is
 * the client that owns the take store. Nothing server-side can recover the
 * first row, because core exposes no lookup by audio_storage_path.
 */
export async function startRecordingSessionWithClient(
  synqed: Pick<SynqedClient, 'appointments' | 'recordings'>,
  input: {
    customerId?: string | null
    appointmentId?: string | null
    selfStaffId: string | null
    /** The caller's VERIFIED tenant — the prefix the composed key carries, and
     *  the only thing standing between a caller and another tenant's audio once
     *  a service-role client reaches that key. Cookie on web, Bearer identity on
     *  the facade; NEVER a body field. Read only when `takeId` is present. */
    businessId?: string | null
    /** The device's own take id. Absent → today's unbound row, byte for byte. */
    takeId?: string | null
    /** The recorder's negotiated container, for the key's extension. */
    mimeType?: string | null
  },
): Promise<StartRecordingSessionResult> {
  // THE RESERVATION, composed BEFORE anything is created: a key this server
  // would refuse must never leave a row behind for the client to inherit.
  let reservation: { audio_storage_path: string; status: 'UPLOADING' } | undefined
  if (input.takeId != null || input.mimeType != null) {
    // THE FIELD-PAIR RULE, for BOTH doors. The facade's zod refine says the same
    // thing, but the web action is a 'use server' export that runs no schema at
    // all, so the rule has to live where both doors pass through — the same
    // reason mintTakeUploadUrl parses on its own first line. businessId is
    // checked HERE rather than merely typed: an empty tenant would compose
    // `app__<uuid>.ext`, a prefix no fence can attribute to anyone.
    if (!input.takeId || !input.mimeType || !input.businessId) return { error: 'bad_input' }
    // The SAME fence the upload mint runs — case-exact uuid, the closed MIME
    // map, and a re-parse of its own output, so the only key that reaches a row
    // is one `isOwnRecordingKey` would accept for this same business. A THROW
    // from it is a composer/parser DRIFT bug, never caller input (both fields
    // are validated inside it first): it is deliberately not caught, because
    // both doors already swallow a throw to their fail-open null, which leaves
    // no row and no reservation — the safe side.
    const composed = composeTakeKey(input.businessId, input.takeId, input.mimeType)
    if (composed === null) return { error: 'bad_input' }
    // UPLOADING, the status the mint's own reservation writes: the take's bytes
    // are on their way and nothing owns this row yet — there is no job to
    // preserve a status for, the row is one call old.
    reservation = { audio_storage_path: composed.key, status: 'UPLOADING' }
  }

  let staffId: string | null = input.selfStaffId
  if (!staffId && input.appointmentId) {
    const appt = await synqed.appointments.get(input.appointmentId).catch(() => null)
    staffId = appt?.staff_id ?? null
  }
  if (!staffId) return null

  // No store_id: saveKaruteRecord's create() call doesn't send one either.
  // The spread is EMPTY on the absent-take path — the payload is the same three
  // keys, byte for byte, as before this round.
  const recording = await synqed.recordings.create({
    staff_id: staffId,
    customer_id: input.customerId ?? null,
    appointment_id: input.appointmentId ?? null,
    ...reservation,
  })
  return { id: recording.id }
}

/**
 * Web door for "this take is complete" — the cookie twin of
 * POST /api/app/v1/recordings/finalize. Both call the ONE choke point
 * (lib/recording/finalize-take.ts), which owns the tenant fence, the ownership
 * check, the idempotency and the single audit row.
 *
 * Every identity the core needs is resolved HERE, from the cookie session:
 * a caller cannot name its own business, staff or reach. NO store: finalize
 * never mints a row any more (the mint binds the take to one first), so it has
 * no store to choose — see actions/recording-upload.ts#mintRecordingUploadUrl.
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
    return await finalizeTakeWithClient(
      newSynqedClient(businessId),
      {
        staffId,
        businessId,
        canViewAll: capabilities.has('recordings.viewAll'),
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

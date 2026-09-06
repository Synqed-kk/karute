// Facade: mint a recording_sessions row at record-start (packet 08 Decision 3).
// The facade twin of startRecordingSession — recorder-first attribution
// (selfStaffId) with the appointment-staff fallback, on the business-scoped
// client. Effectful row mint → Idempotency-Key REQUIRED (orphan rows stay the
// accepted degradation, packet-10 fact 3); records.write; revocation-sensitive
// (recordings.session.mint). Fail-OPEN contract (capture must NEVER block on
// the mint): like the web action, a genuine SDK failure is swallowed to
// { id: null } after logging — the mint core documents that callers swallow.
//
// FIX ROUND 10 — BORN RESERVED. The body may now carry { takeId, mimeType }, and
// when it does the row is created WITH that take's storage key already on it
// (see startRecordingSessionWithClient for why one atomic create replaces the
// upload mint's update). That pair is the ONE thing here that is NOT fail-open:
// a take id or container this server will not store is a client error with a
// name, because a 200 {id:null} would tell the caller "carry on regardless"
// about a key it has to fix first. The tenant prefix the key carries comes from
// the VERIFIED Bearer identity, never from the body.
//
// SLICE THREE ③ — THE STORE. The row is now minted carrying the store the
// caller is working in (the `store-id` header, clamped). The clamp runs OUTSIDE
// the fail-open try: a store this caller may not use is a 403, never a 200
// {id:null} that would let the take be captured against it anyway.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { extractBearer } from '@/lib/app-api/identity'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import {
  startRecordingSessionWithClient,
  type StartRecordingSessionResult,
} from '@/lib/recording/session-mint'
import { SessionMintSchema } from '@/lib/app-api/record-schemas'

export const runtime = 'nodejs'

export const POST = facadeHandler('recordings.session.mint', async (ctx) => {
  // Recording a session = records.write (only recorders stage a session).
  ensureCapability(ctx.identity.capabilities, 'records.write')
  // UNCHANGED by fix round 10. Presence/format only: this route validates a
  // bounded key and discards it — it forwards nothing to core, unlike the money
  // paths that spend theirs (packs/redeem, cancel, no-show; see
  // karute/manual/route.ts's note for the same posture spelled out). What the
  // take pair adds is on the CLIENT's side: a retried start should carry the
  // key derived from its own takeId, so the retry is one act to the caller too.
  // The server cannot prove that and does not pretend to — a second start with
  // the same take composes the same storage key, and core's unique index is
  // what actually refuses the duplicate reservation.
  // PR3 is the client work that makes the above true — deriving the header
  // value FROM takeId (never a fresh random string per attempt) is what turns
  // a lost-response retry into one act. This route does not and cannot check
  // that relationship; presence/format is the whole gate, same as before a
  // take pair ever existed in this body.
  requireIdempotencyKey(ctx.req)

  // An empty/absent body is valid (walk-in with no ids yet) — but a non-empty
  // body that fails to parse is a client error, NOT a walk-in: silently minting
  // an unassociated session would drop the customer/appointment link the
  // caller tried to send.
  let body: unknown = {}
  const raw = await ctx.req.text()
  if (raw.trim() !== '') {
    try {
      body = JSON.parse(raw)
    } catch {
      throw new AppApiError('validation', 'malformed JSON body')
    }
  }
  const parsed = SessionMintSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((e) => e.message).join(', '))
  }

  const synqed = newSynqedClient(ctx.identity.businessId, extractBearer(ctx.req))
  const selfStaffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)

  // THE STORE THIS RECORDING IS MADE IN (slice three ③) — the Bearer twin of
  // the web action's resolveStoreScope(), and the same call the job route makes
  // for the same field (recordings/job/route.ts:102-113): no active-store
  // cookie exists here, so the store travels as an explicit `store-id` header
  // and is PROVEN to be this caller's before it is written to anything.
  //
  // OUTSIDE the fail-open try below, deliberately. A store-id the caller may
  // not use is a `store_forbidden` throw, and it must leave as the 403 every
  // other facade route answers with — swallowed into `{ id: null }` it would
  // read to the client as "carry on, the mint just failed", and the take would
  // be captured against a store this caller was refused. The inbox route places
  // its clamp for exactly this reason (recordings/inbox/route.ts).
  //
  // ⚖ AND SO DOES A LOOKUP FAILURE — an upstream blip here reads as 403, not
  // 5xx, because that is the clamp's own fail-closed shape (store-clamp.ts:74
  // and :109, both without the `store_header` marker, so the thin shell's
  // stranded-pin self-heal correctly does not fire). It is NOT swallowed to
  // `storeId: null`: under the ruled null rule an unstamped row is permanently
  // OPEN at the take doors, so swallowing would turn a momentary blip into a
  // permanent, invisible widening. Capture is not blocked either way — the
  // client reads every non-2xx as a null mint, and the drain re-mints later
  // with the CORRECT store.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  // Fail-OPEN parity with the web action: a null mint (unresolvable staff) is
  // NOT an error, and a genuine SDK throw is swallowed to { id: null } too —
  // the client proceeds without dedupe, capture never blocks on the mint.
  let result: StartRecordingSessionResult = null
  try {
    result = await startRecordingSessionWithClient(synqed, {
      customerId: parsed.data.customerId ?? null,
      appointmentId: parsed.data.appointmentId ?? null,
      selfStaffId,
      // The VERIFIED tenant, never a body field — it is the prefix the composed
      // key carries, and therefore the whole fence on a service-role key.
      businessId: ctx.identity.businessId,
      takeId: parsed.data.takeId ?? null,
      mimeType: parsed.data.mimeType ?? null,
      storeId: clamp.storeId,
    })
  } catch (err) {
    console.error('[recordings.session.mint] failed:', err)
  }
  // Named, so the recorder can renegotiate its container rather than retry
  // blind. Checked OUTSIDE the try: an AppApiError thrown inside it would be
  // swallowed by the fail-open catch above and answered as a 200.
  if (result && 'error' in result) {
    // Storage failed to say whether the key is free (fix round 11) — a real
    // upstream outage, never the client's fault, and never folded into the
    // generic 400 below.
    if (result.error === 'upstream') {
      throw new AppApiError('upstream_unavailable', 'could not verify the take key is free')
    }
    // The composed key is already SPOKEN FOR (fix round 11, fresh-eyes #7 P2)
    // — never a legitimate retry on a session this door is about to CREATE, so
    // this is the mint's own 'exists' verdict, one door earlier: 409, the
    // client's "start a new take", same posture as the upload mint's twin.
    if (result.error === 'exists') {
      throw new AppApiError('conflict', result.error)
    }
    throw new AppApiError('validation', result.error)
  }
  return ok(ctx, { id: result?.id ?? null })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.

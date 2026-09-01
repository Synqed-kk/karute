// Facade: A2-4 — the words behind ONE discard row, read on open. The phone
// arm's twin of the web getDiscardTranscript() action, sharing the SAME twin
// (getDiscardTranscriptWithClient, src/actions/recording-discards.ts) so the
// two doors cannot answer the same row differently.
//
// Gate: 'staff.manage', the same predicate the list route and the web action
// enforce.
//
// SCOPE, carried verbatim from the twin's docstring: this reads segments for
// ANY session id a `staff.manage` caller names. That equals the discard
// doctrine's intent only because the A2-2 actions are the sole writers of
// segments in this repo — a kept recording's transcript lives on its karute
// record, never here. Any FUTURE segments writer puts other recordings' words
// behind this gate and must revisit the scope. (Core-side ownership fencing is
// already queued as a spec line for Anthony; this is the documented Phase-A
// accepted class, not a gap to patch here.)
//
// THE HONESTY LAW (A2-4): only core's own "there is no such recording" (404)
// comes back as `{ segments: [] }` — the swept-session answer. Every other
// upstream failure is an ERROR status, never a 2xx with empty segments, on a
// screen whose whole job is checking a staffer's claim.
//
// audit: 'recordings.discards.transcript' is a deliberate 'skip' in
// FACADE_AUDIT_MAP — same manager-read parity as the list route beside it.
//
// ── POST — A2-2 on the phone (PHONEWIRE-2C) ─────────────────────────────────
// The WRITE half of the same resource, running the SAME shared bodies the web
// actions run. Until now the family was web-only
// (`supportsDiscardTranscript: false`), so a phone discard above the ⚖ floor
// filed a correct reason row and threw the audio away — その録音の文字起こしは
// ありません, forever.
//
// ONE ROUTE, TWO SHAPES, taken from the client relay rather than chosen: it has
// exactly two call sites — `review` (words in hand: `transcript`) and
// `recorder` (nothing transcribed yet: `audioPath` + `locale`) — writing the
// SAME thing to the SAME resource, differing only in where the text comes from.
// A mode flag would be a vocabulary neither door speaks; two routes would be two
// endpoint keys, two revocation rows and two audit rows for one act. Both union
// members are `.strict()`, so a body is never ambiguous about which it is —
// the receipt sibling's own posture (…/recordings/discard/route.ts).
//
// GATE: 'records.write', the predicate the web actions' recordsWriteGate
// enforces — NOT the GET's 'staff.manage'. Reading a colleague's words back is
// the manager question; writing your own take's words is the recorder's.
// NO Idempotency-Key, like that same sibling: the dedupe is SERVER-derived
// (alreadyLanded), a stronger key than one the relay could forget to send.
//
// ⛔ NEVER THE JOB QUEUE — the shared body transcribes DIRECTLY and writes
// recordings.upsertSegments; enqueueing would surface a discarded take as a
// real DRAFT karute (doctrine R2, see that module's header). This route imports
// the shared body and nothing else, and a mutation test pins that a happy-path
// POST creates neither a job row nor a karute.
//
// audit: 'recordings.discards.transcript.write' is a 'skip' on the SAME ruling
// as the shared body's SDK_WRITE_ALLOWLIST row — the authorising staff discard
// already emitted its receipt, and ⚖ 8/17 keeps the CONTENT out of audit
// details. One act, one row, whichever door files it.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { getDiscardTranscriptWithClient } from '@/actions/recording-discards'
import {
  persistDiscardTranscriptWithClient,
  transcribeAndPersistDiscardWithClient,
} from '@/actions/recording-discard-transcript'
import { DiscardTranscriptDTO } from '@/lib/app-api/discard-reasons-dto'
import { DiscardTranscriptWriteSchema } from '@/lib/app-api/record-schemas'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'

export const runtime = 'nodejs'

export const GET = facadeHandler('recordings.discards.transcript', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.manage')

  const sessionId = new URL(ctx.req.url).searchParams.get('sessionId')?.trim()
  // Unlike the audit route's tolerant filters, this param IS the request — a
  // missing one has no sane default, so it is refused rather than guessed.
  if (!sessionId) throw new AppApiError('validation', 'sessionId is required')

  const synqed = newSynqedClient(ctx.identity.businessId)

  let result
  try {
    result = await getDiscardTranscriptWithClient(synqed, sessionId)
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'the discard transcript is unavailable')
  }

  // Parsed at the door, same reason (and same placement outside the catch) as
  // the list route beside it.
  return ok(ctx, DiscardTranscriptDTO.parse(result))
})

export const POST = facadeHandler('recordings.discards.transcript.write', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  let raw: unknown
  try {
    raw = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  // Parsed at the DOOR and OUTSIDE the try below, same placement rule the GET
  // obeys: a malformed body is this caller's 400, never an upstream 502.
  const parsed = DiscardTranscriptWriteSchema.safeParse(raw)
  if (!parsed.success) throw new AppApiError('validation', 'invalid discard transcript payload')
  const body = parsed.data

  // ROSTER GATE — the half of recordsWriteGate a capability check cannot carry.
  // On web the acting id comes from getCurrentUserStaffId, which is itself a
  // roster-membership probe (`list.some(s => s.id === userId)`), and the gate
  // refuses outright when it answers null. `ctx.identity.authUserId` carries no
  // such proof, so passing it raw let a records.write holder who is NOT on this
  // business's roster reach resolveSynqedStaffIdForBusiness — whose create-on-miss
  // would MINT a phantom synqed staff record for that profile (the #566 finding
  // the appointments and recordings/job facades were both hardened against).
  // resolveSelfStaffId is that same predicate, Bearer-side.
  //
  // Placed ahead of BOTH shapes, not just the transcribe one: the review door
  // is gated on web by the identical `if (!(await getCurrentUserStaffId()))`
  // line, so gating only the resolver's caller would fix the minting and leave
  // the two doors disagreeing about who may write.
  //
  // NOT a 403, deliberately — that is the one divergence a status choice could
  // still cause. `staffListByBusinessOrThrow` throws on a failed read, so a null
  // here is ambiguous exactly as the web docstring says (a real removal, or a
  // read that could not answer), and the web sends that doubt to `failed`, not
  // `forbidden`. The thin port maps 403 to the TERMINAL refusal that deletes the
  // take: wrong `forbidden` loses the words forever, wrong `failed` costs one
  // wasted upload per mount for ≤7 days. 502 is what the port reads as `failed`.
  if (!(await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId))) {
    throw new AppApiError(
      'upstream_unavailable',
      'no acting staff identity for this user; nothing was written',
    )
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  const result =
    'transcript' in body
      ? await persistDiscardTranscriptWithClient(synqed, body)
      : await transcribeAndPersistDiscardWithClient(
          synqed,
          { staffId: ctx.identity.authUserId, businessId: ctx.identity.businessId },
          body,
        )

  // The shared body's ONE security refusal — a staged key belonging to another
  // tenant — is the only member of its union that is not a settled domain
  // answer, so it leaves as a real 403 rather than riding out in a 2xx where no
  // error log or metric would ever see it. The relay reads a 403 back as the
  // same terminal `{ error: 'forbidden' }` the web action returns, so the take
  // is settled identically on both doors.
  if ('error' in result && result.error === 'forbidden') {
    throw new AppApiError('forbidden', 'that staged audio is not this business’s')
  }
  // Everything else IS the answer the relay branches on (retry vs settle) —
  // returned verbatim, so the phone and the web page read one contract.
  return ok(ctx, result)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.

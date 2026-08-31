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

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { getDiscardTranscriptWithClient } from '@/actions/recording-discards'
import { DiscardTranscriptDTO } from '@/lib/app-api/discard-reasons-dto'

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

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.

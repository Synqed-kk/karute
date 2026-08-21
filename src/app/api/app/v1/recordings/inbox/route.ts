// Facade: 録音履歴 — the phone arm's twin of the listRecordingsInbox web action
// (Build F1). Same readRecordingsInbox core on the Bearer-scoped client, so web
// and thin derive identical rows. Read-only → no Idempotency-Key, and not
// revocation-sensitive (no write side effect), like every other facade GET.
//
// SECURITY (the construction contract this route is built to):
//   - staff_id is derived from the AUTHENTICATED actor. The route accepts NO
//     staff_id parameter, so a caller cannot ask for someone else's sessions —
//     a supplied one is simply not read.
//   - store-id is still CLAMPED: a request naming a store the caller may not
//     see is refused (403) before any read, per the store-isolation law. The
//     clamped id is not used as a filter — recordings rows carry no store_id
//     (recordings.create never sets one), so filtering by it would return an
//     empty list for everyone. Actor scoping is strictly NARROWER than a store
//     lens anyway: these are the caller's own recordings and nobody else's.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { RecordingsInboxDTO } from '@/lib/app-api/recordings-inbox-dto'
import { readRecordingsInbox } from '@/lib/recordings/inbox-read'

export const runtime = 'nodejs'

export const GET = facadeHandler('recordings.inbox', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  const synqed = newSynqedClient(ctx.identity.businessId)

  // Store clamp BEFORE any read — a store_forbidden throw must reach the client
  // as 403, so it stays outside the 502 catch below.
  await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  try {
    // INSIDE the try on purpose: this is a roster read, so a transient core
    // failure must surface as 502 upstream_unavailable like every other read on
    // this route (and like screens/record's own roster read). Outside it, the
    // same blip escaped as a bare 500.
    const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)
    // No staff identity → no sessions of your own (parity with the web action).
    if (!staffId) return ok(ctx, RecordingsInboxDTO.parse({ sessions: [] }))

    const sessions = await readRecordingsInbox({
      synqed,
      staffId,
      // Tenant key for the shared read's server-side customer name fill
      // (⚖ Liam 2026-08-17) — from the VERIFIED token identity, never a header.
      businessId: ctx.identity.businessId,
      now: new Date(),
    })
    return ok(ctx, RecordingsInboxDTO.parse({ sessions }))
  } catch (err) {
    if (err instanceof AppApiError) throw err
    throw new AppApiError('upstream_unavailable', 'recordings inbox unavailable')
  }
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.

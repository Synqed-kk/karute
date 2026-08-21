// Facade: remove the recording_sessions row a deliberate 破棄 just orphaned
// (Build F1 fix round 3) — the device twin of the deleteRecordingSession web
// action. Both doors call the ONE choke point
// (lib/recording/session-cleanup.ts#deleteRecordingSessionWithClient), which
// also owns the ownership check and the single audit row.
//
// ⚠ INTERIM — P5's kept-discard build replaces this. See the choke point's
// header for the full ruling.
//
// Effectful → Idempotency-Key REQUIRED, same as the session mint it undoes.
// records.write, and the shared core refuses any session the caller does not
// own (core's own DELETE is business-scoped only).

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { requireIdempotencyKey, resolveSelfStaffId } from '@/lib/app-api/customer-facade'
import { deleteRecordingSessionWithClient } from '@/lib/recording/session-cleanup'

export const runtime = 'nodejs'

type Params = { id: string }

export const DELETE = facadeHandler<Params>(
  'recordings.session.delete',
  async (ctx: FacadeContext<Params>) => {
    ensureCapability(ctx.identity.capabilities, 'records.write')
    requireIdempotencyKey(ctx.req)

    const { id } = await ctx.route.params
    if (!id) throw new AppApiError('validation', 'recording session id is required')

    const synqed = newSynqedClient(ctx.identity.businessId)
    const staffId = await resolveSelfStaffId(ctx.identity.businessId, ctx.identity.authUserId)

    const result = await deleteRecordingSessionWithClient(
      synqed,
      {
        staffId,
        businessId: ctx.identity.businessId,
        source: 'facade',
        requestId: ctx.meta.requestId,
      },
      id,
    )
    // A refusal is NOT an error the client should act on: the discard already
    // happened locally and nothing here can be retried into success. Report it
    // honestly in the body and keep the 2xx, same fail-open posture as the
    // mint (whose failure is swallowed to { id: null }).
    return ok(ctx, result)
  },
)

export const OPTIONS = DELETE // facadeHandler short-circuits OPTIONS before auth.

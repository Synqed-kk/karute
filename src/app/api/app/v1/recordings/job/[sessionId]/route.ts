// Facade: read the server-side recording job's status (packet 22 B2). Poll
// twin of the client's getRecordingJobStatus (src/actions/recording-jobs.ts)
// on the Bearer-scoped client — that action reads getSynqedClient() (cookie
// businessId), which the facade must never touch, so the mapping is
// reproduced here on the business-scoped client instead of importing it.
// Read-only → no Idempotency-Key. Not revocation-sensitive: this GET has no
// write side effect (unlike 'stores.list'/'audit.list'), so it stays on the
// local fast-path like every other unlisted facade GET.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import type { RecordingJobStatusView } from '@/actions/recording-jobs'

export const runtime = 'nodejs'

type Params = { sessionId: string }

export const GET = facadeHandler<Params>(
  'recordings.job.status',
  async (ctx: FacadeContext<Params>) => {
    ensureCapability(ctx.identity.capabilities, 'records.write')

    const { sessionId } = await ctx.route.params
    if (!sessionId) throw new AppApiError('validation', 'sessionId is required')

    const synqed = newSynqedClient(ctx.identity.businessId)
    try {
      const job = await synqed.recordingJobs.getByRecordingSession(sessionId)
      const view: RecordingJobStatusView = {
        status: job.status,
        karuteRecordId: job.karute_record_id,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        lastError: job.status === 'FAILED' ? job.last_error : null,
      }
      return ok(ctx, view)
    } catch {
      throw new AppApiError('not_found', 'recording job not found')
    }
  },
)

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.

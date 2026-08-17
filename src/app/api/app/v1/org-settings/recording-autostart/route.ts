// Facade: flip 自動録音 for one store (recording-integrity PR A4). The device
// twin of the web setRecordingAutostart action — both call the shared write
// site setRecordingAutostartWithClient (src/lib/settings/recording-autostart.ts,
// directive-free by design), so one flip writes exactly one
// settings.recording_autostart_toggle row.
//
// Its OWN endpoint rather than a field on PATCH /org-settings: that route's
// DTO deliberately omits this key (an unaudited, unvalidated door onto the
// same switch would defeat §8.1's whole point), and the request here is a
// DELTA — (storeId, enabled) — so the resulting id list is computed server-
// side from a fresh read instead of being overwritten wholesale by whatever
// list the client last saw.
//
// Capability settings.manage — the same gate the web action and the
// org-settings PATCH route apply. FACADE_AUDIT_MAP['orgSettings.recordingAutostart']
// is a deliberate 'skip': the generic on-2xx hook would double-log the row the
// choke point already wrote.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { setRecordingAutostartWithClient } from '@/lib/settings/recording-autostart'

export const runtime = 'nodejs'

export const POST = facadeHandler('orgSettings.recordingAutostart', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'settings.manage')

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const { storeId, enabled } = (body ?? {}) as { storeId?: unknown; enabled?: unknown }
  if (typeof storeId !== 'string' || typeof enabled !== 'boolean') {
    throw new AppApiError('validation', 'storeId (string) and enabled (boolean) are required')
  }

  const businessId = ctx.identity.businessId
  const result = await setRecordingAutostartWithClient(
    newSynqedClient(businessId),
    {
      staffId: ctx.identity.authUserId,
      businessId,
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    storeId,
    enabled,
  )

  if (!result.ok) {
    if (result.error === 'unknown_store') {
      throw new AppApiError('validation', 'no such store in this business')
    }
    // The choke point's own attribution guard — unreachable from here (Bearer
    // identity always carries both ids), mapped honestly rather than being
    // reported as an upstream failure if that ever stops being true.
    if (result.error === 'forbidden') {
      throw new AppApiError('forbidden', 'no staff identity for this change')
    }
    throw new AppApiError('upstream_unavailable', 'the auto-start setting could not be saved')
  }

  return ok(ctx, { storeIds: result.storeIds })
})

export const OPTIONS = POST // facadeHandler short-circuits OPTIONS before auth.

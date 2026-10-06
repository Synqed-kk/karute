// Facade: 今すぐ同期 — trigger an immediate QuickReserve crawl instead of
// waiting for synqed-core's 15-min cron (Liam ruling 7/24, packet 32: the v2
// read-only status card, packet 31, gains exactly ONE action). Mirrors the
// web route's exact contract (src/app/api/sync/quickreserve/route.ts):
// success spread + folded skipped count, a friendly not-configured message
// (owner hasn't saved QR credentials yet — not a failure, not a 5xx), any
// other upstream failure → the facade family's 502. TRIGGER ONLY — no body,
// no credential path; credentials stay sealed behind the web-only config
// route.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import {
  resolveSyncRunStore,
  SyncStoreDependencyError,
  SyncStoreForbidden,
  SyncStoreUnassigned,
} from '@/lib/sync/resolve-run-store'

export const runtime = 'nodejs'
export const maxDuration = 300 // the crawl itself can take minutes (web parity)

export const POST = facadeHandler('sync.run', async (ctx: FacadeContext) => {
  // Gate: owner OR sync.view — the same grant that shows the card the button
  // lives on. sync.view alone is sufficient here (not isOwner || has(...)
  // like the screens/settings route computes): ROLE_PRESETS.owner carries
  // every capability, and the owner role can never be reassigned away from
  // 'owner' via the permissions-write surface (actions/permissions.ts), so
  // the owner always holds sync.view too — checking it alone is equivalent
  // without a staffList round-trip this simple mutation route would
  // otherwise be the only one to pay.
  ensureCapability(ctx.identity.capabilities, 'sync.view')

  const synqed = newSynqedClient(ctx.identity.businessId)
  try {
    // CORE-43: crawl the request's store row. The store is resolved by the
    // ONE helper the web run uses too; its mapping table (case × web × phone)
    // heads src/lib/sync/resolve-run-store.ts.
    const { storeId } = await resolveSyncRunStore({
      synqed,
      authUserId: ctx.identity.authUserId,
      capabilities: ctx.identity.capabilities,
      requestedStoreId: ctx.req.headers.get('store-id'),
    })
    const result = await synqed.sync.runNow('QUICKRESERVE', { karute_store_id: storeId })
    // Web parity: the run's audit row names the store that ran.
    ctx.auditStoreId = storeId
    ctx.auditDetail = { karute_store_id: storeId }
    return ok(ctx, {
      success: true,
      ...result,
      // The settings UI shows "created/updated/skipped"; fold core's two skip
      // buckets so that line stays meaningful (web parity).
      skipped: result.skipped_no_staff + result.skipped_deleted,
    })
  } catch (err) {
    // The facade's codes for the helper's three answers (web: 409 · 409 · 502).
    if (err instanceof SyncStoreForbidden) {
      throw new AppApiError('store_forbidden', err.message, { reason: 'store_header' })
    }
    if (err instanceof SyncStoreUnassigned) {
      throw new AppApiError('store_unassigned', 'no store is assigned to your account yet')
    }
    if (err instanceof SyncStoreDependencyError) throw new AppApiError('upstream_unavailable', err.message)
    const message = err instanceof Error ? err.message : 'Sync failed'
    // Not-yet-configured is an expected state (owner hasn't saved their QR
    // login), not a failure — friendly 200 message, matching the web route.
    if (/config not found|no credentials/i.test(message)) {
      return ok(ctx, {
        // Machine-readable code so the CLIENT localizes (Greptile #602: the
        // ja card must not render hard-coded English); message kept for API
        // ergonomics / non-UI consumers.
        code: 'not_configured',
        message: 'QR sync not configured — save your Quick Reserve login first.',
      })
    }
    throw new AppApiError('upstream_unavailable', message)
  }
})

export const OPTIONS = POST

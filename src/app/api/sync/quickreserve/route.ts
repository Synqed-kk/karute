import { NextResponse } from 'next/server'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { auditWeb } from '@/lib/audit-web'
import { getMyCapabilities, ensureCapability } from '@/lib/auth/require-permission'
import { errorBody, toAppApiError } from '@/lib/app-api/errors'
import { resolveSyncRunStore, webSyncStoreError } from '@/lib/sync/resolve-run-store'

export const maxDuration = 300

/**
 * Manual "今すぐ同期" — delegates the QuickReserve crawl to synqed-core, which
 * owns the (encrypted) QR credentials and the reservation→appointment sync
 * (find-or-create customer by QR id, upsert by reservation id, orphan-cancel).
 *
 * Scheduled syncs are dispatched by core's own cron (every 15 min, per each
 * tenant's interval + business hours), so karute no longer runs the crawl or
 * carries a sync cron itself — see synqed-core /v1/sync/cron/dispatch.
 *
 * Capability gate + audit row bring this in line with the facade twin
 * (src/app/api/app/v1/sync/run/route.ts, FACADE_AUDIT_MAP['sync.run']) —
 * contract §3.1, PR-M2: this business-wide trigger was reachable by ANY
 * signed-in staff before, ungated and unlogged.
 */
export async function POST(request: Request) {
  try {
    await getBusinessId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let capabilities: Awaited<ReturnType<typeof getMyCapabilities>>
  try {
    capabilities = await getMyCapabilities()
    ensureCapability(capabilities, 'sync.view')
  } catch (err) {
    const apiErr = toAppApiError(err)
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status })
  }

  // The store the form SHOWS, sent by SyncSection (or a row's store, sent by
  // the all-stores list) — never the cookie. The same helper decides whether
  // this caller may run it. No body (or no storeId key) = the helper's own
  // default. A body that is not a JSON object, or a storeId that is not a
  // non-empty string, is refused — never a silent run of another store.
  const raw = await request.text()
  let body: Record<string, unknown> | null = null
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_store_id' }, { status: 400 })
    }
  }
  if (body && Object.hasOwn(body, 'storeId') && (typeof body.storeId !== 'string' || !body.storeId)) {
    return NextResponse.json({ error: 'invalid_store_id' }, { status: 400 })
  }
  const requestedStoreId = typeof body?.storeId === 'string' ? body.storeId : null

  const synqed = await getSynqedClient()
  // PR-M5: one id per request — both 2xx emit paths below carry it (this
  // route landed with PR-M2 mid-wave; the CP5 scan caught the missing
  // threading at the M5 rebase, exactly as designed).
  const requestId = crypto.randomUUID()
  // Hoisted so the not-configured audit row below names the store too.
  let storeId: string | undefined
  try {
    // CORE-43: crawl the shown store's own row — 銀座's button runs 銀座.
    // The store is resolved by the ONE helper the phone run uses too; its
    // mapping table (case × web × phone) heads src/lib/sync/resolve-run-store.ts.
    ;({ storeId } = await resolveSyncRunStore({
      synqed,
      authUserId: await getCurrentUserStaffId(),
      capabilities,
      requestedStoreId,
    }))
    const result = await synqed.sync.runNow('QUICKRESERVE', { karute_store_id: storeId })
    await auditWeb({
      category: 'settings',
      action: 'settings.sync_run_now',
      targetType: 'business',
      requestId,
      detail: { karute_store_id: storeId },
    })
    return NextResponse.json({
      success: true,
      ...result,
      // The settings UI shows "created/updated/skipped"; fold core's two skip
      // buckets so that line stays meaningful.
      skipped: result.skipped_no_staff + result.skipped_deleted,
    })
  } catch (e) {
    // A store this caller may not run, or no store at all, is refused — never
    // a fallback to another store's crawl (the same answer the config save
    // gives). A store read that THREW is a dependency failure: 502.
    const storeError = webSyncStoreError(e)
    if (storeError) return NextResponse.json(storeError.body, { status: storeError.status })
    const message = e instanceof Error ? e.message : 'Sync failed'
    // Not-yet-configured is an expected state (owner hasn't saved their QR login),
    // not a failure — return a friendly message so the panel doesn't show a red
    // error, matching the pre-delegation behavior. Still a 2xx → still an
    // audit row (facade parity: FACADE_AUDIT_MAP fires on any 2xx).
    if (/config not found|no credentials/i.test(message)) {
      await auditWeb({
        category: 'settings',
        action: 'settings.sync_run_now',
        targetType: 'business',
        requestId,
        detail: { karute_store_id: storeId ?? null },
      })
      return NextResponse.json({
        message: 'QR sync not configured — save your Quick Reserve login first.',
      })
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

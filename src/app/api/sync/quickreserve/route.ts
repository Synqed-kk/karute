import { NextResponse } from 'next/server'
import { getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'

export const maxDuration = 300

/**
 * Manual "今すぐ同期" — delegates the QuickReserve crawl to synqed-core, which
 * owns the (encrypted) QR credentials and the reservation→appointment sync
 * (find-or-create customer by QR id, upsert by reservation id, orphan-cancel).
 *
 * Scheduled syncs are dispatched by core's own cron (every 15 min, per each
 * tenant's interval + business hours), so karute no longer runs the crawl or
 * carries a sync cron itself — see synqed-core /v1/sync/cron/dispatch.
 */
export async function POST() {
  try {
    await getBusinessId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const synqed = await getSynqedClient()
  try {
    const result = await synqed.sync.runNow('QUICKRESERVE')
    return NextResponse.json({
      success: true,
      ...result,
      // The settings UI shows "created/updated/skipped"; fold core's two skip
      // buckets so that line stays meaningful.
      skipped: result.skipped_no_staff + result.skipped_deleted,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sync failed'
    // Not-yet-configured is an expected state (owner hasn't saved their QR login),
    // not a failure — return a friendly message so the panel doesn't show a red
    // error, matching the pre-delegation behavior.
    if (/config not found|no credentials/i.test(message)) {
      return NextResponse.json({
        message: 'QR sync not configured — save your Quick Reserve login first.',
      })
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

import { NextResponse } from 'next/server'
import { newSynqedClient } from '@/lib/synqed/client'
import { autoBurnForBusiness, type AutoBurnSummary } from '@/lib/packs/auto-burn'
import { ymdInJst } from '@/lib/date/jst'

// 自動消化 cron (packet 11). Runs 06:00 JST (vercel.json `0 21 * * *` UTC) over
// YESTERDAY's bookings — the schedule IS the grace window (see auto-burn.ts).
//
// This endpoint SPENDS CUSTOMER MONEY, so the auth is the /api/cleanup shape
// verbatim and fails CLOSED: no CRON_SECRET configured → 401, never "run
// unauthenticated because the env is missing".
//
// A cron has no session, so tenancy comes from an env allowlist rather than
// getBusinessId().
// ponytail: env allowlist; core-side dispatch (like the sync cron) when
// multi-tenant matters.
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const businessIds = (process.env.AUTO_BURN_BUSINESS_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const date = ymdInJst(new Date(Date.now() - 86_400_000))

  const results: Array<AutoBurnSummary | { businessId: string; error: string }> = []
  for (const businessId of businessIds) {
    try {
      results.push(await autoBurnForBusiness(newSynqedClient(businessId), businessId, date))
    } catch (err) {
      // One tenant's failure must not skip the rest — and must still be seen.
      results.push({ businessId, error: err instanceof Error ? err.message : 'unknown' })
    }
  }

  // The weekly sheet-sync lane reads this line to keep the two systems from
  // confusing staff about who burned what.
  console.log('[auto-burn]', JSON.stringify({ date, results }))
  return NextResponse.json({ date, results })
}

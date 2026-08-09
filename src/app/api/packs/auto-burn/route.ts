import { NextResponse } from 'next/server'
import { newSynqedClient } from '@/lib/synqed/client'
import { autoBurnRecentDays, type AutoBurnSummary } from '@/lib/packs/auto-burn'

// 自動消化 cron (packet 11). TWO schedules, one path (vercel.json, UTC):
// `0 0-14 * * *` = hourly 09:00–23:00 JST, the sweep that burns a ticket ~2h
// after its session ends; `30 23 * * *` = 08:30 JST, the settle-up pass that
// closes a late-evening session and advances the day marker. Liam's ruling
// 2026-08-08 — the burn follows the session, same day, instead of waiting for a
// nightly batch; the grace is what a last-minute cancellation needs to reach
// Karute through core's 15-minute crawl. Full contract and the residuals
// (a correction entered after the grace, a same-day undo) live in auto-burn.ts.
//
// Each business processes every JST day in the scan window its marker hasn't
// cleared — always including today — so a missed or failed run catches up on
// the next tick. Overlapping ticks are idempotent through GUARD 1 (the
// appointment match) plus the DB's appointment-scoped partial unique index,
// which is the only one of the two guards with a database backstop. Guard 2
// (one customer-day, one ticket) is in-app ONLY: two passes racing inside one
// customer-day would need a duplicate platform delivery or an operator ?force=1
// mid-pass to beat it, and a SCHEDULED overlap is structurally impossible
// (maxDuration 300 < every inter-tick gap). Accepted residual, round 2 —
// closing it is a core-side unique index (parked Anthony ask).
// `?force=1` reprocesses the whole window (the deliberate backfill lever) — not
// a second auth surface: the CRON_SECRET check below still gates it.
//
// This endpoint SPENDS CUSTOMER MONEY, so the auth is the /api/cleanup shape
// verbatim and fails CLOSED: no CRON_SECRET configured → 401, never "run
// unauthenticated because the env is missing".
//
// A cron has no session, so tenancy comes from an env allowlist rather than
// getBusinessId().
// ponytail: env allowlist; core-side dispatch (like the sync cron) when
// multi-tenant matters.
// 300 is in-plan (/api/jobs/process and /api/sync/run already run at 300): the
// loop is serial across businesses × days, and a timeout loses the summary AND
// the after()-scheduled audit rows for work that already happened.
export const maxDuration = 300

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
  const force = new URL(request.url).searchParams.get('force') === '1'
  // An unset/empty allowlist answers 200 [] — correct (nothing is configured to
  // burn) but indistinguishable in the log from a night where nothing was
  // burnable (round 2 G9). Say which one it is.
  if (businessIds.length === 0) {
    console.warn('[auto-burn] AUTO_BURN_BUSINESS_IDS is empty — no business is enrolled')
  }

  const results: Array<AutoBurnSummary | { businessId: string; error: string }> = []
  for (const businessId of businessIds) {
    let done: Array<AutoBurnSummary | { businessId: string; error: string }>
    try {
      done = await autoBurnRecentDays(newSynqedClient(businessId), businessId, force)
    } catch (err) {
      // One tenant's failure must not skip the rest — and must still be seen.
      done = [{ businessId, error: err instanceof Error ? err.message : 'unknown' }]
    }
    results.push(...done)
    // Logged INSIDE the loop (blind-round F10): a timeout on business N must
    // still leave businesses 1..N-1 readable in the Vercel log. The weekly
    // sheet-sync lane reads these lines to keep the two systems from confusing
    // staff about who burned what.
    console.log('[auto-burn]', JSON.stringify({ businessId, results: done }))
  }

  return NextResponse.json({ results })
}

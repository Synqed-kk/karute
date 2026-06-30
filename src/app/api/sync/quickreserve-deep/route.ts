import { NextResponse } from 'next/server'

export const maxDuration = 300

/**
 * Deep customer crawl (full QR profile + visit history) — RETIRED from karute.
 *
 * It logged into QuickReserve from here, but the QR credentials moved to
 * synqed-core in the DB consolidation and are encrypted server-side, so karute
 * can no longer authenticate to QR. The crawl has to run where the credentials
 * live (core). Until that port exists, return an explicit status instead of a
 * confusing 500 from the dropped `sync_config` table.
 *
 * Follow-up: port this enrichment crawl into synqed-core behind the sync
 * namespace (the daily reservation sync already lives there). Tracked as the
 * "deep QR crawl" (customer-data work, Part 2).
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'The deep QuickReserve crawl now runs in synqed-core (QR credentials are encrypted there). The karute-side crawl was retired in the DB consolidation.',
      retired: true,
    },
    { status: 501 },
  )
}

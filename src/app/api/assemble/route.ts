import { NextResponse } from 'next/server'
import { runAssembler, realAssemblerDeps } from '@/lib/recording/assembler'

// The nightly assembler (build 23 slice ③, design D4) — 03:07 JST, the quiet
// hour (`7 18 * * *` UTC in vercel.json; the :07 is the fleet-spread habit).
//
// WHY ITS OWN ROUTE and not a leg of /api/cleanup, whose docstring reserved
// this join. Cleanup is the lane's REPORT-ONLY sweep with a 30-second budget;
// this is the FIRST job in the app that WRITES an object into the recordings
// bucket, it needs the worker's budget to rebuild a take, and it deserves its
// own line in the audit story rather than hiding inside a janitor's summary.
// It is not a leg of the minutely worker either: walking `seg/` sixty times an
// hour buys nothing over once a night.
//
// AND IT ONLY EVER ADDS. Nothing here deletes — not a segment after it is
// read, not an object it did not write (⚖ audio is never deleted).
//
// Auth is /api/cleanup's block verbatim and fails CLOSED: no CRON_SECRET
// configured → 401, never "run unauthenticated because the env is missing".
// This endpoint reaches storage and core with service-role credentials and no
// user session at all, so it must not be publicly callable.
export const maxDuration = 300

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 270s inside a 300s function — the worker's shape: headroom to finish the
  // take in hand and report, so a run never dies unreported at the wall.
  const summary = await runAssembler(realAssemblerDeps(), { budgetMs: 270_000 })

  // The scheduler reads only the HTTP status, so a run that could not see the
  // whole tree must not record as a green one — /api/cleanup's rule. A BUDGET
  // stop is different and stays a 200: the walk saw every candidate, tonight
  // simply ended, and tomorrow continues where it stopped.
  return NextResponse.json(summary, { status: summary.walkComplete ? 200 : 500 })
}

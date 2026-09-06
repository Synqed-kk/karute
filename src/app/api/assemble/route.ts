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

  // The scheduler reads only the HTTP status, so TWO failures must not record
  // as a green night.
  //
  // A BLIND WALK — /api/cleanup's rule: a run that could not see the whole tree
  // says so with a 500.
  //
  // A LOST RECEIPT (⚖ 2026-09-07) — an object was written and its durable
  // capture_resumed row was not. The audio is rescued, but its key is now
  // occupied, so every later night skips it and nothing retries the row on its
  // own. Cleanup's rule extended: a rescue with no receipt is not a green run.
  //
  // A BUDGET stop is different and stays a 200: the walk saw every candidate
  // and tonight simply ended. The next run starts ROTATION_STRIDE folders
  // further along the same list (the walk strides by a night's reach and
  // wraps), so nights that each reach at least that many cover the whole tree
  // within ceil(N / ROTATION_STRIDE) nights — and a slower night still advances
  // the start by the stride, so what it skipped is reached when the walk comes
  // round (at most N nights, except the named residual: a folder count that is
  // itself a multiple of ROTATION_STRIDE). Closing that exactly would take a
  // resume cursor. That is what makes this 200 honest.
  return NextResponse.json(summary, {
    status: summary.walkComplete && summary.auditLost === 0 ? 200 : 500,
  })
}

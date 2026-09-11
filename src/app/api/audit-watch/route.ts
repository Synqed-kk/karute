import { NextResponse } from 'next/server'
import { watchOneBusiness } from '@/lib/audit-watch/run'
import { rotateBusinessIds } from '@/lib/audit-watch/rotate-business-ids'

// The audit-watch cron (監査ログ round 2 PR C) — hourly, writes what did NOT
// happen: a recording that never became a karute (recording.karute_missing)
// and a same-recording transcription retry storm (recording.transcribe_storm).
// The third new action, recording.transcribe_failed, is emitted by the WORKER
// itself (src/lib/jobs/process-recording.ts) on the exhausted retry round —
// this route never sees it.
//
// CP1: a PLAIN CRON_SECRET route, the /api/cleanup block verbatim — NEVER
// facadeHandler. No actor is ever resolved and no view receipt is ever
// written; every read runs through the SDK directly (see run.ts).
//
// Fails CLOSED like every other cron: no CRON_SECRET configured → 401, never
// "run unauthenticated because the env is missing". Businesses come from an
// env allowlist (no session to resolve tenancy from), same shape as
// src/app/api/packs/auto-burn/route.ts.
//
// `?dry=1` (or AUDIT_WATCH_WRITE unset/not '1') returns the candidate list
// and writes nothing — the rollout door (deploy writer-off → dry-run a salon
// → writer-on). `mode` in the response says which ran.
export const maxDuration = 300

const BUDGET_MS = 270_000

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dry = new URL(request.url).searchParams.get('dry') === '1'
  const mode: 'dry' | 'write' = !dry && process.env.AUDIT_WATCH_WRITE === '1' ? 'write' : 'dry'

  const businessIds = (process.env.AUDIT_WATCH_BUSINESS_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (businessIds.length === 0) {
    console.warn('[audit-watch] AUDIT_WATCH_BUSINESS_IDS is empty — no business is enrolled')
  }

  const deadline = Date.now() + BUDGET_MS
  const now = new Date()
  // Greptile round 3 finding 2: rotate the starting business per run so one
  // slow early business can't starve the tail of the allowlist every hour
  // (see rotateBusinessIds in run.ts).
  const results = []
  for (const businessId of rotateBusinessIds(businessIds, now)) {
    results.push(await watchOneBusiness(businessId, now, mode, deadline))
  }

  // F-b: an error is not a green run — but a business's own catch never
  // stops the loop, so every OTHER business still gets its pass. A budget
  // stop (`truncated`) stays a 200, same rule as /api/assemble: the walk saw
  // everything and simply ran out of time.
  const status = results.some((r) => r.error) ? 500 : 200
  return NextResponse.json({ mode, results }, { status })
}

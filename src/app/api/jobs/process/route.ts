import { NextResponse } from 'next/server'
import { processRecordingJobs } from '@/lib/jobs/process-recording'

// The pipeline worker tick. Two callers:
//   - Vercel Cron (minutely) — Authorization: Bearer CRON_SECRET, the sweep
//     that picks up anything the kick missed (dead runtime, deploy, burst).
//   - The enqueue path's same-deployment kick (x-worker-key = CRON_SECRET) so
//     a freshly enqueued job starts in seconds, not at the next minute tick.
// Claims are atomic in core (SKIP LOCKED), so overlapping ticks are safe —
// they just drain the queue faster.
export const maxDuration = 300

export async function GET(request: Request) {
  return run(request)
}
export async function POST(request: Request) {
  return run(request)
}

async function run(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') ?? ''
  const workerKey = request.headers.get('x-worker-key') ?? ''
  if (!secret || (auth !== `Bearer ${secret}` && workerKey !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // 270s budget inside a 300s function — headroom for the final complete/fail
  // report so a job never dies unreported at the wall.
  const result = await processRecordingJobs(270_000)
  return NextResponse.json(result)
}

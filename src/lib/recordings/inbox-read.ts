/**
 * 録音履歴 — the SERVER half of the inbox read (Build F1).
 *
 * Identity-agnostic on purpose: it takes an already-scoped SynqedClient and the
 * actor's staff id, so the web server action (cookie) and the facade route
 * (Bearer) share ONE read and can never derive different rows. The pure fold
 * lives next door in inbox.ts.
 *
 * WHY THE JOIN LOOKS LIKE THIS
 *  - Enumeration is `recordings.list({ staff_id })`. That is the ONLY read that
 *    is actor-scoped by construction: both the web action and the facade mint
 *    a recording_sessions row stamped with the signed-in staff's id
 *    (startRecordingSessionWithClient), so "my sessions" is a server filter,
 *    not a client one.
 *  - The karute join is listed for the WINDOW and matched client-side on
 *    recording_session_id — deliberately WITHOUT a staff_id filter. The two
 *    write paths stamp DIFFERENT ids on the record: the interactive save writes
 *    the profile/auth id (actions/karute.ts) while the worker writes the
 *    synqed staff id resolved at enqueue (actions/recording-jobs.ts →
 *    lib/jobs/process-recording.ts). Filtering by either one would make every
 *    record written by the OTHER path invisible, and a saved session would then
 *    render as 失敗. Only records whose session is in MY set are ever read, so
 *    the wider list leaks nothing.
 *  - `Recording.status` is never read — the app sets it once at create and
 *    never advances it, so it says nothing about the pipeline.
 *  - recordingJobs has no bulk list, so job state is an N+1 over the RESIDUE
 *    (record-less sessions only), bounded by the 7-day window and capped.
 */

import type { SynqedClient } from '@synqed-kk/client'
import { paginateDedupe } from '@/lib/customers/paginate'
import { INBOX_WINDOW_MS, type InboxServerSession, type InboxJobStatus } from './inbox'

/** Core clamps page_size at 500 — the house pattern's page size. */
const PAGE_SIZE = 500

/** Probes run newest-first; past this the oldest record-less sessions keep
 *  jobStatus null (they are already outside every in-flight window, so the
 *  fold reads them as failed either way). Logged, never silent. */
const MAX_JOB_PROBES = 100

/** How many status probes are in flight at once — the residue is normally 0–2
 *  rows; the pool only matters on a genuinely broken tenant. */
const PROBE_CONCURRENCY = 6

export interface InboxReadDeps {
  synqed: Pick<SynqedClient, 'recordings' | 'karuteRecords' | 'recordingJobs'>
  /** The AUTHENTICATED actor's staff id. Never a caller-supplied parameter. */
  staffId: string
  now: Date
}

export async function readRecordingsInbox({
  synqed,
  staffId,
  now,
}: InboxReadDeps): Promise<InboxServerSession[]> {
  const from = new Date(now.getTime() - INBOX_WINDOW_MS).toISOString()

  const [sessions, records] = await Promise.all([
    paginateDedupe((page) =>
      synqed.recordings
        .list({ staff_id: staffId, from, page, page_size: PAGE_SIZE })
        .then((r) => ({ items: r.recordings, total: r.total })),
    ),
    paginateDedupe((page) =>
      synqed.karuteRecords
        .list({ from, page, page_size: PAGE_SIZE })
        .then((r) => ({ items: r.karute_records, total: r.total })),
    ),
  ])

  const recordBySession = new Map<string, string>()
  for (const r of records) {
    if (r.recording_session_id) recordBySession.set(r.recording_session_id, r.id)
  }

  const rows: InboxServerSession[] = sessions.map((s) => ({
    recordingSessionId: s.id,
    customerId: s.customer_id ?? null,
    createdAt: s.created_at,
    durationSeconds: s.duration_seconds ?? null,
    karuteRecordId: recordBySession.get(s.id) ?? null,
    jobStatus: null,
    jobLastError: null,
  }))

  // Residue = the only sessions whose job state can still matter.
  const residue = rows
    .filter((r) => !r.karuteRecordId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  if (residue.length > 0) {
    console.info(
      `[recordings-inbox] job probes: ${Math.min(residue.length, MAX_JOB_PROBES)} of ` +
        `${residue.length} record-less sessions (${sessions.length} in window)`,
    )
  }
  if (residue.length > MAX_JOB_PROBES) {
    console.warn(
      `[recordings-inbox] ${residue.length - MAX_JOB_PROBES} oldest record-less sessions ` +
        'left unprobed (cap reached)',
    )
  }

  const probes = residue.slice(0, MAX_JOB_PROBES)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, probes.length) }, async () => {
      for (let i = next++; i < probes.length; i = next++) {
        const row = probes[i]
        // A 404 means "no job for this session" — a real answer, and the state
        // the fold needs. Any other failure is also swallowed to null: the row
        // then reads as unsettled/failed rather than claiming a status we do
        // not have.
        const job = await synqed.recordingJobs
          .getByRecordingSession(row.recordingSessionId)
          .catch(() => null)
        if (!job) continue
        row.jobStatus = job.status as InboxJobStatus
        row.jobLastError = job.status === 'FAILED' ? job.last_error : null
      }
    }),
  )

  return rows
}

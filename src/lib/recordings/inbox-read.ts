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
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import { INBOX_WINDOW_MS, type InboxServerSession } from './inbox'

/**
 * BOTH list endpoints this file calls REJECT a page_size above 200 — they do
 * not clamp it. Core validates with `z.coerce.number().int().min(1).max(200)`
 * (synqed-core src/validations/recording.ts + karute.ts, verified 2026-08-25),
 * so 500 came back 400 on every request and the inbox rendered empty behind its
 * 「一部の録音を読み込めませんでした」 line. Caught on the live preview; the
 * mocked suites could not see it.
 *
 * paginateDedupe's own doc says core "clamps page_size at 500" — that is TRUE
 * of the customers endpoint it was written for and MUST NOT be carried over to
 * other endpoint families. Check the family's own validator before raising it.
 */
const PAGE_SIZE = 200

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
  /** Tenant key for the name fill below — the cookie arm resolves it with
   *  getBusinessId(), the Bearer arm from its verified token identity. */
  businessId: string
  now: Date
}

/**
 * Fill each row's display name SERVER-SIDE (⚖ Liam 2026-08-17).
 *
 * These rows are STAFF-scoped (recordings.list({staff_id})) while the record
 * screen's customer array is STORE-scoped, so a clamped staffer's own recording
 * of an out-of-store customer has an id that array cannot resolve — it would
 * render 不明. Resolving here is what keeps the roster off the wire: the
 * business-wide list is used strictly as a `.get(id)` lookup, so only the names
 * these rows actually reference ever ship (the maps rule, store-scope.ts
 * ~:170-177 / ~:288-294 — a clamped client must never RECEIVE another branch's
 * names, so filtering after shipping was never an option).
 *
 * Lives in this shared read so the cookie action and the Bearer facade route
 * cannot disagree about a row's name — the same reason the read itself is here.
 * Degrades to the pre-fill behaviour: a failed list read leaves the name absent
 * and the client's own map answers.
 */
async function fillCustomerNames(
  rows: InboxServerSession[],
  businessId: string,
): Promise<InboxServerSession[]> {
  if (!rows.some((r) => r.customerId)) return rows
  const list = await getCachedCustomerListFor(businessId).catch((err: unknown) => {
    console.warn('[recordings-inbox] customer name fill degraded:', err)
    return []
  })
  const nameById = new Map(list.map((c) => [c.id, c.name]))
  return rows.map((r) => {
    const name = r.customerId ? nameById.get(r.customerId) : undefined
    return name ? { ...r, customerName: name } : r
  })
}

export async function readRecordingsInbox({
  synqed,
  staffId,
  businessId,
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
    jobProbeFailed: false,
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
        // ONLY a 404 means "no job for this session" — the repo's own rule for
        // this exact class of lookup (actions/karute.ts's upsert probe). Every
        // other failure (timeout, 5xx, network-dark) is NOT an answer, and
        // collapsing it into "no job" is how a blip turns a session core is
        // actively processing into a 復元可能 row offering a second save.
        // Structural status check, not instanceof, so a partial test mock of
        // the client package can't break the detection.
        const job = await synqed.recordingJobs
          .getByRecordingSession(row.recordingSessionId)
          .catch((err: unknown) => {
            const status =
              err && typeof err === 'object' && 'status' in err
                ? (err as { status: unknown }).status
                : undefined
            if (status === 404) return null
            console.warn(
              `[recordings-inbox] job probe failed for ${row.recordingSessionId} (status ${String(status)}):`,
              err,
            )
            row.jobProbeFailed = true
            return null
          })
        if (!job) continue
        row.jobStatus = job.status
        row.jobLastError = job.status === 'FAILED' ? job.last_error : null
      }
    }),
  )

  return fillCustomerNames(rows, businessId)
}

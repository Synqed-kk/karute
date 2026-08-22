/**
 * 録音履歴 (recordings inbox) — the PURE state derivation (Build F1).
 *
 * WHY IT EXISTS: a recording could disappear in silence. Supersession drops a
 * run un-settled, a closed app kills the in-tab pipeline, a server job can fail
 * after nobody is listening — and nothing on any screen said so. This module
 * turns three independent facts (a recording_sessions row, whether a karute
 * record exists for it, and whether the device still holds the audio) into ONE
 * honest row per session.
 *
 * NO CLAIM WITHOUT EVIDENCE. Every state below is decided by something we can
 * actually read; where the data cannot tell us what happened we say so
 * ('unsettled') instead of guessing. In particular `Recording.status` is NEVER
 * read: the app writes it once at create and never advances it, so it carries
 * no pipeline meaning (code-truth 2026-08-25 §6).
 *
 * Pure (no server deps, no browser deps) so both arms — the web server action
 * and the thin facade route — derive the identical rows, and so the whole
 * table is unit-testable.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** How far back the inbox looks. Matches the take TTL (take-store.ts) so a
 *  「復元可能」 row never outlives the audio it offers to save. */
export const INBOX_WINDOW_MS = 7 * DAY_MS

/**
 * How long a session with NO record, NO job and NO local take is still read as
 * in-flight rather than lost.
 *
 * It exists because the honest answer during that window is "we don't know
 * yet": the session row is minted at record START, and nothing server-side
 * advances while the recording runs (Recording.status is never updated). A
 * session being recorded RIGHT NOW on the staffer's phone looks — from the
 * desktop, which holds none of that device's takes — exactly like a session
 * whose audio was lost. Calling that 失敗 would be a lie on every live
 * cross-device recording, so the window covers a full long session (the app's
 * own overrun warnings top out well inside three hours) and the row reads
 * 処理中 + 「まだ結果が届いていません」 until it closes.
 */
export const SESSION_UNSETTLED_GRACE_MS = 3 * 60 * 60 * 1000

/** The five states of the mock, in the mock's own vocabulary. */
export type InboxState =
  /** 保存済み — a karute record exists for this session. */
  | 'saved'
  /** 確認待ち — the record exists but this device never settled its take, so
   *  the staffer never saw the save land. */
  | 'awaiting-check'
  /** 処理中 — something is still working on it (or has not reported back). */
  | 'processing'
  /** 失敗 — no record, and nothing is in flight. */
  | 'failed'
  /** 復元可能 — the audio is still on THIS device and was never saved. */
  | 'recoverable'

/** The sub-line under a row. One reason, one message key, no free text. */
export type InboxReason =
  | 'transcribing'
  | 'unsettled'
  | 'autoSaved'
  | 'emptyTranscript'
  | 'genericFailure'
  | 'localAudio'

/** The statuses this build knows how to read. Anything else on the wire is
 *  narrowed to "unknown, still in flight" — see `jobStatus` below. */
const KNOWN_JOB_STATUSES = new Set<string>(['QUEUED', 'RUNNING', 'DONE', 'FAILED'])

/** One recording session as the SERVER can see it. */
export interface InboxServerSession {
  recordingSessionId: string
  customerId: string | null
  /** Name resolved SERVER-SIDE at row-build time, when the arm that built the
   *  row can see the whole business (⚖ Liam 2026-08-17): these rows are
   *  STAFF-scoped (recordings.list({staff_id})), so a staffer's own recording
   *  of a customer outside their assigned store has an id the caller's
   *  store-scoped customer array cannot resolve. Filled from the business-wide
   *  cached list used strictly as a `.get(id)` lookup — only the names these
   *  rows actually reference ship, never the roster (the maps rule,
   *  store-scope.ts ~:170-177 / ~:288-294). Absent = fall back to the caller's
   *  own list, which is today's behaviour. */
  customerName?: string | null
  /** ISO — when the session was minted, i.e. when recording started. */
  createdAt: string
  durationSeconds: number | null
  /** The karute record for this session, when one exists. */
  karuteRecordId: string | null
  /**
   * The job's status STRING as core reported it, probed only for record-less
   * sessions. `null` means a DEFINITIVE "no job for this session" (a 404).
   *
   * Deliberately a plain string, not the union: a phone runs a BAKED bundle,
   * so the day core adds a fifth status value a narrow enum would reject the
   * whole payload and the inbox would go blank on every phone in the field.
   * An unrecognised value is narrowed below to the same honest "we don't know"
   * handling a failed probe gets.
   */
  jobStatus: string | null
  /**
   * The probe itself failed with anything other than a 404 — a timeout, a 5xx,
   * a network blip. This is NOT "no job": it is "we could not find out", and
   * the two must never collapse into one signal (a probe blip used to read as
   * 復元可能, offering 保存する for audio a live job may already be processing).
   */
  jobProbeFailed: boolean
  /** Present only on FAILED — mapped to a reason, never rendered raw. */
  jobLastError: string | null
}

/** One device-local take (lib/karute/take-store). Audio is guaranteed: the
 *  store only ever returns takes with at least one persisted segment. */
export interface InboxLocalTake {
  takeId: string
  recordingSessionId: string | null
  customerId: string | null
  customerName: string | null
  startedAt: number
  updatedAt: number
}

export interface InboxRow {
  /** Stable React key + test handle. */
  key: string
  state: InboxState
  reason: InboxReason | null
  recordingSessionId: string | null
  /** The take this row can save/retry from, when the device still holds one. */
  takeId: string | null
  karuteRecordId: string | null
  customerId: string | null
  /** Bind-time name snapshot off the take, else the server row's own fill.
   *  null → the consumer falls back to the caller's customer list; this module
   *  never fetches. */
  customerName: string | null
  /** Epoch ms — when the audio started. */
  startedAt: number
  durationSeconds: number | null
  /** 再試行 is offered ONLY when the audio is still here. Without the blob the
   *  link would promise a retry the app cannot perform. */
  canRetry: boolean
}

/** The states that mean a human still owes this recording something AND can
 *  actually act on it. 処理中 and 保存済み are deliberately NOT counted —
 *  nothing to do. A failed row with no retryable take is also excluded — no
 *  再試行 button renders for it (see canRetry), so counting it would demand
 *  an action the staff member cannot perform. */
export function needsAttention(row: InboxRow): boolean {
  return (
    row.state === 'awaiting-check' ||
    (row.state === 'failed' && row.canRetry) ||
    row.state === 'recoverable'
  )
}

export function countNeedsAttention(rows: readonly InboxRow[]): number {
  return rows.reduce((n, r) => n + (needsAttention(r) ? 1 : 0), 0)
}

/**
 * Fold sessions + device-local takes into one row per session.
 *
 * PRECEDENCE (packet F1): record-exists beats job-state beats take-only. One
 * session = one row; a take carrying no session id gets a row of its own.
 * Several takes on the SAME session (supersession leaves them) collapse into
 * that session's single row, newest take first — that take is the one a save
 * would use.
 */
export function deriveInboxRows(input: {
  sessions: readonly InboxServerSession[]
  takes: readonly InboxLocalTake[]
  now: number
  windowMs?: number
}): InboxRow[] {
  const { sessions, takes, now } = input
  const windowMs = input.windowMs ?? INBOX_WINDOW_MS
  const floor = now - windowMs

  // Newest take per session id; every other take stands on its own.
  const takeBySession = new Map<string, InboxLocalTake>()
  const orphanTakes: InboxLocalTake[] = []
  for (const t of takes) {
    if (!t.recordingSessionId) {
      orphanTakes.push(t)
      continue
    }
    const seen = takeBySession.get(t.recordingSessionId)
    if (!seen || t.startedAt > seen.startedAt) takeBySession.set(t.recordingSessionId, t)
  }

  const rows: InboxRow[] = []

  for (const s of sessions) {
    const startedAt = Date.parse(s.createdAt)
    if (Number.isNaN(startedAt) || startedAt < floor) continue
    const take = takeBySession.get(s.recordingSessionId) ?? null
    const base = {
      key: `session:${s.recordingSessionId}`,
      recordingSessionId: s.recordingSessionId,
      takeId: take?.takeId ?? null,
      karuteRecordId: s.karuteRecordId,
      customerId: s.customerId ?? take?.customerId ?? null,
      // Take snapshot first (bind-time truth), then the server fill; null only
      // when neither arm could name the customer.
      customerName: take?.customerName ?? s.customerName ?? null,
      startedAt,
      durationSeconds: s.durationSeconds ?? takeDuration(take),
      canRetry: false,
    }

    if (s.karuteRecordId) {
      // The record landed. An un-settled local take means the CLIENT never saw
      // it land (supersession / closed app / crash-cron class) — we cannot
      // reliably attribute WHICH, so the row says only what is true: it was
      // saved automatically and nobody has confirmed it.
      rows.push(
        take
          ? { ...base, state: 'awaiting-check', reason: 'autoSaved' }
          : { ...base, state: 'saved', reason: null },
      )
      continue
    }

    // WE DO NOT KNOW what this job is doing — the probe failed with something
    // other than a 404, or core reported a status this build has never heard
    // of. Both mean the same thing and must be handled the same way: treat it
    // as STILL IN FLIGHT. Never 失敗 (we have no failure to report) and never
    // 復元可能 even with a take on the device — offering 保存する here would
    // hand the staffer a save for audio a live job may already be turning into
    // a record, which is the double-write the whole pipeline is built to avoid.
    if (s.jobProbeFailed || (s.jobStatus !== null && !KNOWN_JOB_STATUSES.has(s.jobStatus))) {
      rows.push({ ...base, state: 'processing', reason: 'unsettled' })
      continue
    }

    if (s.jobStatus === 'QUEUED' || s.jobStatus === 'RUNNING') {
      rows.push({ ...base, state: 'processing', reason: 'transcribing' })
      continue
    }

    if (s.jobStatus === 'FAILED') {
      rows.push({
        ...base,
        state: 'failed',
        // The SAME mapping PipelineErrorCard uses — one honest string for the
        // one error core names, generic for everything else.
        reason: s.jobLastError === 'EMPTY_TRANSCRIPT' ? 'emptyTranscript' : 'genericFailure',
        canRetry: !!take,
      })
      continue
    }

    if (s.jobStatus === 'DONE') {
      // DONE with no record is a core anomaly (global-pipeline treats it the
      // same way). No reason to claim beyond the generic one.
      // ponytail: the 再試行 this offers converges on the SAME core job row
      // (enqueue is idempotent per recording_session), so on a phone — where
      // the server path owns the run — a retry re-arms the anomaly rather than
      // healing it, and fails visibly with the take kept. On web the retry
      // genuinely heals it (the in-tab pipeline writes the record itself), so
      // the affordance stays. Upgrade path if this is ever seen in the field:
      // a core-side "re-mint the job" verb, or hiding retry on the thin arm.
      rows.push({ ...base, state: 'failed', reason: 'genericFailure', canRetry: !!take })
      continue
    }

    // No job row at all — the enqueue never landed, or this device's run died
    // before one existed.
    if (take) {
      rows.push({ ...base, state: 'recoverable', reason: 'localAudio' })
      continue
    }
    // ponytail: `now` is the CLIENT's clock and `startedAt` is the SERVER's
    // stamp, so a badly-skewed device reads ages wrong — far-behind clocks hold
    // a lost session at 処理中 longer, far-ahead ones call it 失敗 early. Same
    // assumption the take TTL and the 7-day window already run on. Upgrade path
    // if drift is ever observed in the field: have the read return the age
    // server-computed and compare that instead of two clocks.
    rows.push(
      now - startedAt <= SESSION_UNSETTLED_GRACE_MS
        ? { ...base, state: 'processing', reason: 'unsettled' }
        : { ...base, state: 'failed', reason: 'genericFailure' },
    )
  }

  // Takes whose session id never resolved (the mint failed, or predates it):
  // no server row can ever represent them, so they carry their own.
  for (const t of orphanTakes) {
    if (t.startedAt < floor) continue
    rows.push({
      key: `take:${t.takeId}`,
      state: 'recoverable',
      reason: 'localAudio',
      recordingSessionId: null,
      takeId: t.takeId,
      karuteRecordId: null,
      customerId: t.customerId,
      customerName: t.customerName,
      startedAt: t.startedAt,
      durationSeconds: takeDuration(t),
      canRetry: false,
    })
  }

  rows.sort((a, b) => b.startedAt - a.startedAt)
  return rows
}

/** Rough length from the take's own stamps — the same estimate the recovery
 *  banner shows (updatedAt is bumped on every ~5s segment flush). */
function takeDuration(take: InboxLocalTake | null): number | null {
  if (!take) return null
  const sec = Math.round((take.updatedAt - take.startedAt) / 1000)
  return sec > 0 ? sec : null
}

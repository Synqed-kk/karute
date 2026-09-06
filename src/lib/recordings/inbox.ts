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

/** The states of the mock, in the mock's own vocabulary. */
export type InboxState =
  /** 破棄済み — a staff member deliberately threw this take away and wrote why
   *  (⚖ 8/20 doctrine, packet item A2-3). It is NOT a failure and NOT an
   *  outstanding job: it is a finished, deliberate decision, so the row is
   *  inert — grayed, no retry, no navigation to content. Before A2-1 the
   *  session row was hard-deleted on discard and this state could not exist;
   *  the row now survives BECAUSE the written reason keys on it. */
  | 'discarded'
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
  /** …and the SAME device audio when the stop could not finish writing it
   *  (capture pipeline PR3 fix round 16). The take's final flush was skipped —
   *  the next customer's recording cleared the chunks out from under it — so
   *  what is on disk is SHORT of what the recorder captured. No drain will ever
   *  seal it (isStoppedTake refuses the flag, secureTake refuses it again), and
   *  that refusal is precisely why the row has to SAY so: it is 復元可能 and
   *  counted in 要対応 like any other unsaved take, but the audio it offers ends
   *  partway, and a staff member deciding what to do with it deserves to know
   *  that before they press 保存する rather than after. */
  | 'tailIncomplete'

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
  /**
   * A STAFF row exists for this session in core's discard ledger — the staff
   * member deliberately threw the take away and wrote why (P5-A).
   *
   * Optional so every existing caller and fixture keeps compiling and reads
   * as "not discarded", which is the honest default: absent evidence of a
   * discard is not evidence of one. Filled by inbox-read.ts from ONE batched
   * ledger read per derivation pass, never a per-row probe.
   */
  discardedByStaff?: boolean
  /**
   * WHAT THE SERVER HOLDS for this session's audio, when it holds anything
   * (build 23 slice ③). Derived by the shared read (inbox-read.ts) for
   * record-less sessions only; this module never asks storage anything.
   *
   *   'object'   — the take's own finalized object is on the server and no job
   *                has touched it. Either the nightly assembler sealed a
   *                stranded take, or a phone finalized at stop and then died
   *                before 録音を使用. Same news to a staffer either way: the
   *                whole audio the server received is there, and unsaved.
   *   'segments' — only PART of it is there, as the take's segment folder, and
   *                the nightly job will finish what it can.
   *
   * NO PATH AND NO KEY EVER RIDES WITH IT (recordings-inbox-dto.ts's own rule:
   * metadata only). The value says WHETHER, never WHERE — the save door
   * derives the storage path from the ROW, server-side, and would refuse a
   * client-named one anyway.
   *
   * Optional/nullish on purpose, the `discardedByStaff` idiom above: absent =
   * an older server that never derived it, which the fold treats exactly as
   * today. And the DTO ships it as a PLAIN STRING for `jobStatus`'s reason —
   * an enum would blank every baked phone the day a third value lands — so a
   * value that is not one of these two literals reaches the fold typed as one
   * and is narrowed to "absent" by the same `===` comparisons.
   */
  serverAudio?: 'segments' | 'object' | null
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
  /** The stop's final flush was SKIPPED, so this take's disk copy is short of
   *  what its recorder captured (take-store's `tailIncomplete`). Optional
   *  because every take written before fix round 16 carries no such field, and
   *  absent means the honest thing: nothing says this take lost its tail. */
  tailIncomplete?: boolean
  /** A stop leg began for this take and never finished (take-store's
   *  `stopPendingAt`, cleared by the duration stamp). Same fact for whoever
   *  reads the row as a lost tail: the recording has an end nobody wrote. */
  stopPendingAt?: number
  /** Capture pipeline PR4 fix round 1: past the take TTL and the server still
   *  does not have it, so the store's prune refused it (take-store.ts). Its
   *  session is older than the window this fold and the server read both use,
   *  so nothing else can represent it — the take carries its own row, exempt
   *  from the floor. Absent on every ordinary take, which is what they are. */
  expiredUnsecured?: boolean
  /** The stop's own measured length (take-store's `durationMs`). Optional
   *  because a take that never reached a clean stop carries no stamp — and
   *  that is exactly the take whose flush-window estimate is the only length
   *  there is. */
  durationMs?: number
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
 *  an action the staff member cannot perform. 破棄済み is likewise never
 *  counted (A2-3): the staff member already decided AND explained; putting it
 *  in 要対応 would demand an action for a finished decision, which is the
 *  unclearable-badge problem the old cleanup existed to avoid. */
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
  /** ⚖ EXPIRED, UNSECURED, STILL ON THE DEVICE (PR4 fix round 1). These are the
   *  takes the store's TTL prune REFUSED — audio the server never received, so
   *  destroying it was never an option — and they are older than the window,
   *  which means the server read (bounded by the same INBOX_WINDOW_MS) returned
   *  no session for them and the loops below would drop them on the floor
   *  check. They are exactly the rows a human has to see: kept forever,
   *  invisible everywhere else. So they are pulled out here and given rows of
   *  their own, age notwithstanding. */
  const strandedTakes: InboxLocalTake[] = []
  for (const t of takes) {
    if (t.expiredUnsecured) {
      strandedTakes.push(t)
      continue
    }
    if (!t.recordingSessionId) {
      orphanTakes.push(t)
      continue
    }
    const seen = takeBySession.get(t.recordingSessionId)
    if (!seen || t.startedAt > seen.startedAt) takeBySession.set(t.recordingSessionId, t)
  }

  const rows: InboxRow[] = []
  /** Sessions that produced a row. Only the stranded loop reads it, and only to
   *  stand down if the two windows ever drift apart far enough for a stranded
   *  take's session to still be in this list — one row per session, always. */
  const rendered = new Set<string>()

  for (const s of sessions) {
    const startedAt = Date.parse(s.createdAt)
    if (Number.isNaN(startedAt) || startedAt < floor) continue
    rendered.add(s.recordingSessionId)
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

    // PRECEDENCE, ABOVE EVERYTHING (A2-3). A deliberate discard is a decision
    // a human already made and explained; nothing the job probe or the local
    // take says can outrank it. Placing it first is what makes G9's outcome —
    // a discarded session resurfacing as a green 保存済み / an actionable
    // 復元可能 row offering to save audio the staff member threw away —
    // structurally impossible rather than merely unlikely.
    if (s.discardedByStaff) {
      // The ids stay TRUE (this module never invents or erases evidence); what
      // makes the row inert is `canRetry: false` plus the state itself, which
      // RecordingsInboxCard's actionFor checks FIRST and answers with no
      // affordance at all — no 保存する, no 再試行, no 開く.
      rows.push({ ...base, state: 'discarded', reason: null, canRetry: false })
      continue
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
      rows.push({ ...base, state: 'recoverable', reason: recoverableReason(take) })
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

  // The stranded takes, in the SAME vocabulary as everything else: 復元可能,
  // counted in 要対応, offering the one action that resolves it, 保存する. No
  // 再試行 (there is no job to re-run) and no navigation (there is no record
  // yet). The sub-line comes from `recoverableReason` like every other
  // take-only row — a take that lost its tail (fix round 16) or whose stop
  // never finished (round 17) is exactly the take that could never be secured
  // and therefore the one most likely to strand here, so it says 「録音が途中で
  // 終わっています」 rather than the plainer 「この端末に音声が残っています
  // （未保存）」. No new strings either way.
  for (const t of strandedTakes) {
    if (t.recordingSessionId && rendered.has(t.recordingSessionId)) continue
    rows.push({
      key: `take:${t.takeId}`,
      state: 'recoverable',
      reason: recoverableReason(t),
      recordingSessionId: t.recordingSessionId,
      takeId: t.takeId,
      karuteRecordId: null,
      customerId: t.customerId,
      customerName: t.customerName,
      startedAt: t.startedAt,
      durationSeconds: takeDuration(t),
      canRetry: false,
    })
  }

  // Takes whose session id never resolved (the mint failed, or predates it):
  // no server row can ever represent them, so they carry their own.
  for (const t of orphanTakes) {
    if (t.startedAt < floor) continue
    rows.push({
      key: `take:${t.takeId}`,
      state: 'recoverable',
      reason: recoverableReason(t),
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

/** Why a 復元可能 row is 復元可能 — device audio, and whether the stop managed
 *  to finish writing it: a lost tail (fix round 16) and a stop that never
 *  finished at all (round 17) are the same news to a staffer, and the same
 *  sub-line. Only the two take-only branches ask:
 *  the failed/DONE branches carry the SERVER's reason, which is the more
 *  specific fact about what went wrong and must not be overwritten by a
 *  device-side one. */
function recoverableReason(take: InboxLocalTake): InboxReason {
  return take.tailIncomplete || take.stopPendingAt !== undefined
    ? 'tailIncomplete'
    : 'localAudio'
}

/** The take's length. The STOP STAMP when there is one (slice five, D12) — it
 *  is what the recorder measured, pauses subtracted — else the flush window,
 *  which is the same rough estimate the recovery banner shows (updatedAt is
 *  bumped on every ~5 s segment flush) and the only length an unfinished take
 *  has. */
function takeDuration(take: InboxLocalTake | null): number | null {
  if (!take) return null
  const sec =
    take.durationMs !== undefined
      ? Math.round(take.durationMs / 1000)
      : Math.round((take.updatedAt - take.startedAt) / 1000)
  return sec > 0 ? sec : null
}

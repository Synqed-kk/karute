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
  /** THE AUDIO IS ON THE SERVER, and no job has turned it into anything
   *  (build 23 slice ③). The nightly assembler sealed a stranded take, or a
   *  phone finalized this one at stop and then never got to 録音を使用 — the
   *  row cannot tell which, and does not need to: the news to a staffer is the
   *  same, and so is the one action.
   *
   *  It rides state `recoverable` ON PURPOSE, and that is the whole reason
   *  this needs no new state, no new chip and no change to 要対応: 復元可能
   *  already means "unsaved audio exists and 保存する will save it", the card
   *  already renders the solid 保存する for it, and needsAttention already
   *  counts it. The only thing that differs from `localAudio` is WHERE the
   *  audio is, which is exactly what the sub-line says. */
  | 'serverAudio'
  /** PART of it is on the server (slice ③): the take's segments are there, the
   *  whole object is not, and the nightly job will finish what it can.
   *
   *  It rides state `processing` and is therefore NEVER counted in 要対応 —
   *  correctly, because there is nothing a staff member can do about it yet.
   *  What it replaces is the lie: until this build such a row sat at 失敗
   *  saying 「この録音は保存されませんでした」 while the server was in fact
   *  holding most of the recording. */
  | 'partialOnServer'
  /** UPDATE 25 GROUP A, d3 — a take carries a session id the SERVER did not
   *  return (a lost mint reply, a truncated read, the other staff-id space).
   *  Past SESSION_UNSETTLED_GRACE_MS with still no server answer, this is the
   *  honest name for "we could not read your session" — distinct from
   *  `localAudio`, whose session the server DID return. */
  | 'sessionUnlisted'
  /** UPDATE 25 GROUP A, piece r — this take's secure attempt was TERMINALLY
   *  refused because its own session already carries a karute (Group B's d4,
   *  `reserved_elsewhere`/`exists`). The session's row reads 保存済み without
   *  this take; the take gets this row instead, so its audio is never invisible
   *  and 保存する never overwrites the visit's saved karute (F1). */
  | 'refusedHasRecord'

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
  /**
   * THIS READ could not fully judge the session — a job probe past
   * MAX_JOB_PROBES, a job probe that THREW instead of answering (alongside
   * `jobProbeFailed`), an audio candidate dropped by maxAudioProbes, a storage
   * probe that threw or answered 'unknown', a degraded discard ledger, or a
   * truncated sessions/records read (inbox-read.ts; the last two, PR C2a's
   * P1-1 / P3-11). Such a row reads `failed`/`processing` shape-identically
   * to a real miss, so the audit-watch cron (PR C2) drops it before treating
   * it as evidence — a row this pass could not fully check is not proof of
   * one.
   *
   * Optional/additive, the `discardedByStaff` idiom: this fold never reads
   * it (absence = "fully checked", which is every row before this build),
   * and the DTO's plain z.object strips it — the phone parses nothing new.
   */
  probeIncomplete?: true
  /**
   * ⚖ UPDATE 25 GROUP B, d5. The recording's `staff_id` (Recording.staff_id,
   * the SDK's own field) — absent from every reader of this interface until
   * now, so optional/nullish matches the file's own established idiom
   * (`discardedByStaff?`, `serverAudio?`, `probeIncomplete?` above). Fed to
   * the audit-watch cron's find-no-sessions-today.ts finder ONLY; the pure
   * fold (deriveInboxRows below) never reads it, and the facade DTO
   * (recordings-inbox-dto.ts) does not declare it either — zod's z.object
   * STRIPS unknown keys on `.parse()`, so this never reaches a phone. Two id
   * spaces, not one (session-mint.ts:156-160): the auth/profile id on a
   * resolved-identity mint, the core staff id on the appointment-fallback
   * mint — the finder normalizes both through a roster map, never assumes
   * one space here.
   */
  staffId?: string | null
  /**
   * UPDATE 25 GROUP A, piece c. Computed SERVER-SIDE (inbox-read.ts) from the
   * SERVER clock: `ymdInJst(createdAt) === ymdInJst(now)`. The never-backfill
   * fence for the same-day 手書き door — the card must never compute "today"
   * from a render-time clock, and a take-only row (this device's phone clock)
   * is never trusted for it either (see InboxRow.sameDay below).
   *
   * Optional/nullish, the `discardedByStaff` idiom above: absent = an older
   * server that never derived it, which the fold treats as `false` — the door
   * stays closed rather than open on an unproven day.
   */
  sameDay?: boolean
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
  /** UPDATE 25 GROUP A, piece r. This take's last secure attempt refused
   *  TERMINALLY (take-store's `TERMINAL_SECURE_ERRORS` — `exists`,
   *  `reserved_elsewhere`, etc). Mapped by the store from `secureError`, never
   *  read here beyond the boolean: this module stays pure and must never
   *  import take-store (F6). Absent/false = not terminal, which is every take
   *  before this field existed and every ordinary retryable failure. */
  secureTerminal?: boolean
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
  /** THE SAVE COMES FROM THE SERVER, not from this device (slice ③). True only
   *  on the `serverAudio` row, so the card's button and the page's handler read
   *  ONE flag instead of matching on a reason string — a reason is a display
   *  fact, and routing a save off one is how the two drift apart. */
  serverAudio?: boolean
  /** UPDATE 25 GROUP A, piece c — THE FENCE for the same-day 手書き door.
   *  `s.sameDay === true` on a session row (the server's own JST-day proof);
   *  `false` on every take-only row, whose only clock is this device's — never
   *  trusted for a never-backfill decision. The card renders the door ONLY
   *  when this is true; never computed from a render-time clock. */
  sameDay: boolean
  /** UPDATE 25 GROUP A, FIX ROUND, F4. ONE flag instead of matching on a
   *  reason string (this file's own law, above) — set on piece r's take row
   *  AND on a d3 row for a take whose secure attempt was terminally refused,
   *  so the page's save door (RecordPageView) can branch on the same ground
   *  for BOTH: a d3 row is just a refusal whose session the server also never
   *  returned, and it must detach before promoting exactly like piece r's row
   *  does, or its save reaches the same F1 overwrite. Optional/nullish, the
   *  `probeIncomplete?` idiom — absent = not terminal, true on every row
   *  before this field existed. */
  secureTerminal?: true
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
  /** FIX ROUND 2 (Greptile issue 1) — the SERVER half of this read threw
   *  (inbox-store's `readServerSessions`), so `sessions` is `[]` not because
   *  the server returned nothing but because nothing was asked. Optional, the
   *  file's own idiom: absent = an ordinary complete read, which is every
   *  call before this field existed. */
  serverReadFailed?: boolean
}): InboxRow[] {
  const { sessions, takes, now, serverReadFailed = false } = input
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
      // c: the server's own JST-day proof, never a render-time clock.
      sameDay: s.sameDay === true,
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
      // UPDATE 25 GROUP A, piece r. A take TERMINALLY refused because THIS
      // session already has a karute (Group B's d4 — `exists`/
      // `reserved_elsewhere`) is not this session's un-settled take: folding it
      // under the saved row makes the refused audio invisible and its 開く
      // action opens a karute that is not this recording. The session reads
      // what is true — saved, no take — and the refused take gets its own
      // honest row, offered for save (F1's overwrite is closed on the page
      // side: the door detaches the take's stale session before re-offering
      // it, so a save here can only ever create a NEW record).
      if (take?.secureTerminal) {
        rows.push({ ...base, takeId: null, state: 'saved', reason: null })
        rows.push({
          key: `take:${take.takeId}`,
          state: 'recoverable',
          reason: 'refusedHasRecord',
          recordingSessionId: s.recordingSessionId,
          takeId: take.takeId,
          karuteRecordId: null,
          customerId: base.customerId,
          customerName: base.customerName,
          startedAt: take.startedAt,
          durationSeconds: takeDuration(take),
          canRetry: false,
          sameDay: false,
          // FIX ROUND F4 — the page branches on this, not on the reason string.
          secureTerminal: true,
        })
        continue
      }
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
      // ⚖ A SPENT AFFORDANCE IS NOT A LOST RECORDING (fix round 1, R10b). A
      // server-audio row whose job failed — consent, an empty transcript, a
      // Deepgram outage — used to become permanently inert: no take on this
      // device meant `canRetry: false`, and the derivation stopped offering
      // 保存する the moment a job row existed. The audio is still on the
      // server, and core re-arms a FAILED job per session, so 再試行 reaches
      // the same door again. The reason stays the SERVER's (the more specific
      // fact about what went wrong); only the affordance comes back.
      rows.push({
        ...base,
        state: 'failed',
        // The SAME mapping PipelineErrorCard uses — one honest string for the
        // one error core names, generic for everything else.
        reason: s.jobLastError === 'EMPTY_TRANSCRIPT' ? 'emptyTranscript' : 'genericFailure',
        canRetry: !!take || s.serverAudio === 'object',
        // The flag means "the save comes from the SERVER", so it is set only
        // when this device holds nothing — a take on the device still routes
        // 再試行 down the take path, exactly as it did before.
        serverAudio: !take && s.serverAudio === 'object' ? true : undefined,
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
    //
    // THE LOCAL TAKE WINS, ALWAYS (slice ③). A device that still holds the
    // audio holds the COMPLETE copy: the server's is at best the same bytes
    // and at worst a prefix the assembler could seal, so a row with a take
    // keeps today's 復元可能/localAudio and today's save path, untouched.
    if (take) {
      rows.push({ ...base, state: 'recoverable', reason: recoverableReason(take) })
      continue
    }
    // …and only THEN what the server holds. `===` on purpose: the value is a
    // plain string on the wire, so a literal this build never heard of falls
    // straight through to today's grace/failed line rather than inventing a
    // state for it.
    if (s.serverAudio === 'object') {
      // 復元可能 with the SAME chip, the SAME solid 保存する and the SAME place
      // in 要対応 as a device-held take. Only the sub-line and the save's
      // source differ — and `takeId` stays null because this device holds
      // nothing, which is also what makes 再試行 impossible here (canRetry).
      rows.push({
        ...base,
        state: 'recoverable',
        reason: 'serverAudio',
        takeId: null,
        canRetry: false,
        serverAudio: true,
      })
      continue
    }
    if (s.serverAudio === 'segments') {
      // 処理中, never counted: the server has part of the recording and the
      // nightly job will finish what it can. Nothing for a human to do, and
      // saying 失敗 about audio the server is holding was the lie this closes.
      rows.push({ ...base, state: 'processing', reason: 'partialOnServer' })
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

  // UPDATE 25 GROUP A, d3. A take carries a session id, but that session is
  // absent from what the SERVER returned — a lost mint reply after core
  // committed, a session minted under the OTHER staff-id space
  // (session-mint.ts:156-161), or a truncated read. Nothing before this build
  // ever renders such a take: the sessions loop above only reads
  // `takeBySession` for sessions the server actually returned. `rendered` is
  // built by that same loop, so this only fires for a session that never
  // reached it (never double-counts a session the loop already rendered).
  //
  // FIX ROUND, n3 — 「サーバーの記録には見つかりません」 is a claim ABOUT THE
  // SERVER; a probe that could not fully check every returned row
  // (`probeIncomplete`) means this read simply did not get a complete answer,
  // which is no evidence the server lacks a record. Computed once, honestly:
  // a session the read DID return but could not fully judge still counts as
  // "not complete" for this purpose — the fold cannot tell which unlisted
  // session it would have implicated.
  //
  // FIX ROUND 2 (Greptile issue 1) — A FAILED READ IS NOT EVIDENCE EITHER. An
  // outage that threw before ANY session came back looks, to `takeBySession`,
  // identical to a server that genuinely listed nothing for these takes — so
  // without `serverReadFailed` this loop turned every session-stamped take
  // past the grace into a d3 row claiming 「サーバーの記録には見つかりません」
  // on zero evidence. A failed read gets NO unlisted-session rows at all:
  // main's exact behaviour for such a take (no row), and the partial banner
  // already tells the staffer the read was incomplete.
  const readComplete = !serverReadFailed && !sessions.some((s) => s.probeIncomplete)
  if (!serverReadFailed) {
    for (const [sessionId, take] of takeBySession) {
      if (rendered.has(sessionId)) continue
      if (take.startedAt < floor) continue
      // Honest about what this read could not tell us: within the grace, a
      // live job on a session we simply could not read back may still own
      // this take (never offer a save under it); past the grace, nothing is
      // coming.
      const unsettled = now - take.startedAt <= SESSION_UNSETTLED_GRACE_MS
      rows.push({
        key: `take:${take.takeId}`,
        state: unsettled ? 'processing' : 'recoverable',
        // Past the grace: 'sessionUnlisted' claims the server has no record,
        // which is only honest when the read was COMPLETE. A truncated read
        // gets the device-side reason instead — it claims nothing the read
        // cannot back up.
        reason: unsettled ? 'unsettled' : readComplete ? 'sessionUnlisted' : recoverableReason(take),
        recordingSessionId: sessionId,
        takeId: take.takeId,
        karuteRecordId: null,
        customerId: take.customerId,
        customerName: take.customerName,
        startedAt: take.startedAt,
        durationSeconds: takeDuration(take),
        canRetry: false,
        sameDay: false,
        // FIX ROUND F4 — a d3 row for a take terminally refused because its
        // (unlisted) session already holds a karute must detach exactly like
        // piece r's row, or its save reaches the same F1 overwrite.
        secureTerminal: take.secureTerminal ? true : undefined,
      })
    }
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
      sameDay: false,
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
      sameDay: false,
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

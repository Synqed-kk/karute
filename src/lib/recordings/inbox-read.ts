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
 *    render as 失敗. The list itself is fetched UNSCOPED (every staffer's
 *    records in the window) for exactly that reason; only records whose
 *    session is in MY set are ever ATTACHED to a row, so the wider list is
 *    read into this function but never ships to the client.
 *  - `Recording.status` is never read — the app sets it once at create and
 *    never advances it, so it says nothing about the pipeline.
 *  - recordingJobs has no bulk list, so job state is an N+1 over the RESIDUE
 *    (record-less sessions only), bounded by the 7-day window and capped.
 *  - The discard ledger (P5-A, item A2-3) is ONE batched read per pass, not a
 *    probe per row: recordingDiscards.list has no date or session-set filter,
 *    so the only shapes available are "everything" or "one session at a time",
 *    and the latter would be a second N+1 across the WHOLE window rather than
 *    the residue. Sessions carrying a STAFF row render as 破棄済み, and only
 *    that — the fold's first branch, ahead of everything.
 *  - WHAT THE SERVER HOLDS (`serverAudio`, build 23 slice ③) is derived at the
 *    very end, for the narrow cohort below. STORAGE answers it, never the row
 *    (⚖ D8', hardened by fix round 1's R1): a take the nightly assembler
 *    rebuilt carries a rebuilt OBJECT and a duration that is still null — core
 *    fences the duration write behind a human actor, so no cron can stamp one —
 *    while a reasoned DISCARD stamps a duration with no object behind it at
 *    all. So neither the presence nor the absence of a duration is evidence
 *    here: the take's segment folder is listed, and only a folder holding seq 0
 *    is asked where its audio is — the phone's own object first, the nightly
 *    rescue beside it (amendment 9). The one raw fact the derivation reads —
 *    the storage pointer — stays in a LOCAL map and never reaches the returned
 *    rows: this read's output is the facade's wire shape, and that shape
 *    carries metadata only.
 */

import type { SynqedClient } from '@synqed-kk/client'
import { paginateDedupe } from '@/lib/customers/paginate'
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import { parseRecordingKey } from '@/lib/recording/key-grammar'
import { ymdInJst } from '@/lib/date/jst'
import {
  deriveInboxRows,
  INBOX_WINDOW_MS,
  SESSION_UNSETTLED_GRACE_MS,
  type InboxServerSession,
} from './inbox'

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

/** The STORAGE probes' own cap (slice ③). Deliberately the same number as the
 *  job budget above, and named separately so a future change to one is not a
 *  silent change to the other: these are a different kind of round trip, to a
 *  different service, on a narrower cohort.
 *
 *  ponytail: since R3 the candidate set is a SUBSET of the job-probed rows, so
 *  at equal numbers this cap can never bite — the job cap dominates it. It
 *  stays because that is a coincidence of the two constants, not a property:
 *  raise MAX_JOB_PROBES alone and this is the only thing bounding storage.
 *
 *  ⚖ …and that coincidence made R3's own pin VACUOUS (fix round 2, R3). With
 *  both caps equal AND sorted the same way, a fixture one row over the job cap
 *  is dropped by the AUDIO cap too, so removing the job-cap fence changed no
 *  assertion — the mutant survived a cold battery run. Both numbers are
 *  overridable through InboxReadDeps for that reason, so a test can make them
 *  diverge and leave exactly one explanation for an excluded row. */
const MAX_AUDIO_PROBES = MAX_JOB_PROBES

/** Pages of the discard ledger read per pass. Discards are rare by nature, so
 *  20 × 200 is years of them.
 *  ponytail: past the cap the OLDEST discards stop being recognised and their
 *  sessions fall back to whatever the job probe says — a 失敗 row for a take
 *  that was deliberately thrown away. Upgrade path if a tenant ever reaches it:
 *  ask core for a date-range (or session-set) filter on recordingDiscards.list,
 *  which is the same gap that forces this read to be unfiltered at all. */
const MAX_DISCARD_PAGES = 20

/** Recording hole PR-7 — at most this many failed sessions are asked for a
 *  warning fact per read, newest first (the fold's own order), and the whole
 *  lookup gets WARNING_DEADLINE_MS before the read moves on without it
 *  (fix round 1, Greptile P1: the inbox and the audit-watch cron both wait on
 *  this read, and the cron's 30 s reserve never budgeted for it).
 *  ponytail: the ceiling is 20 per-session audit reads, six at a time, 2 s
 *  total — past either, the OLDEST (or slowest) failed rows keep the generic
 *  失敗 line: honest, just unexplained. Upgrade path: an `action` filter on
 *  core's ListAuditOptions (CORE-19 item 2) makes this ONE call per read. */
const MAX_WARNING_READS = 20
const WARNING_DEADLINE_MS = 2_000
/** One page of the session's `recording`-category rows — the audit-watch
 *  dedupe read's own shape and size (run.ts isNewCandidate). */
const WARNING_PAGE_SIZE = 50

/**
 * Sessions in this window that a staff member deliberately discarded.
 *
 * Degrades to an EMPTY SET on failure, never a thrown read: a ledger blip must
 * not blank the whole 録音履歴. The cost of degrading is that a discarded
 * session reads as it did before P5-A for one render — honest-if-stale, and
 * strictly better than showing the staffer nothing.
 *
 * ⚖ …BUT THE DEGRADATION IS NOW REPORTED (fix round 1, R9b). Reading as it did
 * before P5-A was harmless while the worst a discarded row could do was look
 * 失敗. Since slice ③ the same blindness would offer 保存する over audio a
 * staff member deliberately threw away — so the caller is told, and stands the
 * whole server-audio derivation down for that pass.
 */
async function readStaffDiscardedSessions(
  synqed: Pick<SynqedClient, 'recordingDiscards'>,
): Promise<{ discarded: Set<string>; degraded: boolean }> {
  const discarded = new Set<string>()
  try {
    for (let page = 1; page <= MAX_DISCARD_PAGES; page++) {
      const res = await synqed.recordingDiscards.list({
        source: 'STAFF',
        page,
        page_size: PAGE_SIZE,
      })
      const events = res?.events ?? []
      for (const e of events) {
        if (e?.recording_session_id) discarded.add(e.recording_session_id)
      }
      if (events.length === 0 || page * PAGE_SIZE >= (res?.total ?? 0)) break
    }
  } catch (err) {
    console.warn('[recordings-inbox] discard ledger read degraded:', err)
    return { discarded: new Set(), degraded: true }
  }
  return { discarded, degraded: false }
}

/**
 * Does the server hold this take's SEGMENTS — is seq 000000 in its folder?
 *
 * The cheapest honest read there is: ONE listing of the take's own folder,
 * limit 1, name ascending. Seq 0 present means the recorder's very first flush
 * landed, which is exactly what the nightly assembler needs to seal a prefix;
 * a folder whose first leaf is anything else has no prefix to assemble and the
 * row must not claim one. `'unknown'` on any storage trouble — a blip is not
 * an answer, and the caller leaves the row exactly as it was.
 */
export type SegmentsProbe = (businessId: string, takeKey: string) => Promise<boolean | 'unknown'>

/**
 * WHERE THIS TAKE'S AUDIO ACTUALLY IS — the phone's own object, the nightly
 * rescue beside it, or neither.
 *
 * ⚖ THE PROOF, NOT THE ROW (D8' amendment). A take the assembler rebuilt has
 * bytes and a duration that is still null — core fences `recordings.update`
 * behind a human actor, so no cron can stamp one — and the row's own
 * `finalizedBefore` reads false for exactly the rescue this feature exists to
 * surface. Storage is the only honest witness.
 *
 * ⚖ AND THE RESCUE LIVES AT ITS OWN KEY (amendment 9, Liam "b"). Since the
 * assembler stopped writing under the take's own key there are two places to
 * look, in one fixed precedence, and `resolveTakeAudio` is that precedence's
 * ONE home — asked here through a seam so the suites can answer it without a
 * bucket. The INBOX does not care which of the two answered: 保存する saves
 * whatever the server holds, and the door resolves the path again for itself.
 */
export type TakeAudioProbe = (
  businessId: string,
  takeId: string,
  ext: string,
) => Promise<{ key: string; rescued: boolean } | 'absent' | 'unknown'>

/** The one storage call each probe makes, as a seam. Both PRODUCTION probes are
 *  built over one of these rather than reaching for a client themselves — the
 *  fix-round-1 lesson: a default nothing can call is a default nothing tests,
 *  and the seq-0 rule below was the load-bearing line with no pin on it. */
type ListFn = (
  folder: string,
  opts: { limit: number; sortBy: { column: string; order: string } },
) => Promise<{ data: Array<{ name: string }> | null; error: unknown }>

/** The REAL segments probe, over whatever `list` it is handed. Exported for its
 *  own tests; the default below hands it the service client's. */
export function makeSegmentsProbe(list: ListFn): SegmentsProbe {
  return async (businessId, takeKey) => {
    const parsed = parseRecordingKey(takeKey, businessId)
    // Not this tenant's take → not a folder we may look in. No call at all.
    if (parsed?.kind !== 'take') return false
    try {
      // The folder IS the take key without its extension — composeSegmentKey
      // builds `seg/app_<biz>_<take>/<seq>.<ext>` from the same two pieces the
      // pointer carries, and parseRecordingKey above already proved the shape.
      const folder = takeKey.slice(0, takeKey.lastIndexOf('.'))
      const { data, error } = await list(`seg/${folder}`, {
        limit: 1,
        sortBy: { column: 'name', order: 'asc' },
      })
      if (error) {
        console.warn('[recordings-inbox] segment probe failed:', error)
        return 'unknown'
      }
      // EXACT name equality on the FIRST leaf, never a length check: a folder
      // whose prefix starts at seq 3 has nothing the assembler can seal, and
      // painting it 「途中まで届いています」 would promise a rescue that cannot
      // happen. Named rather than inlined so the rule has a line a mutation
      // anchor can hold (a backtick cannot ride in one — the battery's own
      // shell-quoting limit).
      const firstLeaf = `000000.${parsed.ext}`
      return data?.[0]?.name === firstLeaf
    } catch (err) {
      console.warn('[recordings-inbox] segment probe failed:', err)
      return 'unknown'
    }
  }
}

const probeTakeAudio: TakeAudioProbe = async (businessId, takeId, ext) => {
  // Lazy for the same reason the segment default is: the resolver's graph
  // reaches the service client and the SDK, and nothing that injects its own
  // probe should have to load either.
  const { resolveTakeAudio } = await import('@/lib/recording/take-audio')
  return resolveTakeAudio(businessId, takeId, ext)
}

const listFirstSegment: SegmentsProbe = async (businessId, takeKey) => {
  const { createServiceClient } = await import('@/lib/supabase/service')
  const storage = createServiceClient().storage.from('recordings')
  return makeSegmentsProbe((folder, opts) =>
    storage.list(folder, opts as Parameters<typeof storage.list>[1]),
  )(businessId, takeKey)
}

export interface InboxReadDeps {
  synqed: Pick<
    SynqedClient,
    'recordings' | 'karuteRecords' | 'recordingJobs' | 'recordingDiscards' | 'audit'
  >
  /** The AUTHENTICATED actor's staff id — never a client-supplied parameter.
   *  `null` = the WHOLE business (the audit-watch cron, which has no single
   *  staffer to scope to): omits `staff_id` from the list call entirely
   *  rather than filtering by one. */
  staffId: string | null
  /** Tenant key for the name fill below — the cookie arm resolves it with
   *  getBusinessId(), the Bearer arm from its verified token identity. */
  businessId: string
  now: Date
  /** How the 'segments' half of `serverAudio` is answered. Injected so the
   *  suites can answer it without a bucket — and so this read stays the ONE
   *  place that decides WHEN to ask. Default = the service-client listing
   *  above. */
  segmentsProbe?: SegmentsProbe
  /** How the 'object' half is answered — the phone's object or the rescue
   *  beside it, through the ONE resolver every reader shares. Injected for the
   *  same reason. */
  takeAudioProbe?: TakeAudioProbe
  /** The two probe budgets, overridable ONLY so a test can make them diverge
   *  (fix round 2, R3 — see MAX_AUDIO_PROBES above). Production never passes
   *  them; both defaults are the constants. */
  maxJobProbes?: number
  maxAudioProbes?: number
  /** The warning lookup's deadline (PR-7 fix round 1), overridable ONLY so a
   *  test need not wait 2 s. Production never passes it. */
  warningDeadlineMs?: number
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
    // `!== undefined`, not truthy: a customer genuinely named '' is a resolved
    // answer, and dropping it would send the row back to the client's map —
    // which for a clamped caller answers 不明.
    return name !== undefined ? { ...r, customerName: name } : r
  })
}

export async function readRecordingsInbox({
  synqed,
  staffId,
  businessId,
  now,
  segmentsProbe = listFirstSegment,
  takeAudioProbe = probeTakeAudio,
  maxJobProbes = MAX_JOB_PROBES,
  maxAudioProbes = MAX_AUDIO_PROBES,
  warningDeadlineMs = WARNING_DEADLINE_MS,
}: InboxReadDeps): Promise<InboxServerSession[]> {
  const from = new Date(now.getTime() - INBOX_WINDOW_MS).toISOString()

  // P3-11: neither call named itself, so a truncated page fell back to
  // paginateDedupe's 'customers cache' default and pointed triage at the
  // wrong subsystem. A truncated records read is also worse than a log line:
  // a dropped karute record makes a saved session look record-less (a false
  // miss), and a truncated sessions read means the window itself isn't whole
  // — either one marks every record-less row below.
  let readTruncated = false
  const onTruncated = () => {
    readTruncated = true
  }

  const [sessions, records, discardLedger] = await Promise.all([
    paginateDedupe(
      (page) =>
        synqed.recordings
          .list({ ...(staffId !== null ? { staff_id: staffId } : {}), from, page, page_size: PAGE_SIZE })
          .then((r) => ({ items: r.recordings, total: r.total })),
      50,
      'recordings inbox sessions',
      onTruncated,
    ),
    paginateDedupe(
      (page) =>
        synqed.karuteRecords
          .list({ from, page, page_size: PAGE_SIZE })
          .then((r) => ({ items: r.karute_records, total: r.total })),
      50,
      'recordings inbox records',
      onTruncated,
    ),
    readStaffDiscardedSessions(synqed),
  ])

  const recordBySession = new Map<string, string>()
  for (const r of records) {
    if (r.recording_session_id) recordBySession.set(r.recording_session_id, r.id)
  }

  /** The ONE row fact the `serverAudio` derivation reads, and the one the WIRE
   *  must never carry: the storage POINTER (the DTO's rule — metadata only, no
   *  audio path). Kept here rather than on the row so what this function
   *  RETURNS stays exactly the shape it returned before this build. Nothing
   *  else is carried: since fix round 1's R1 the derivation asks STORAGE, so
   *  the row's own duration and status say nothing it may act on. */
  const pointerBySession = new Map<string, string>()
  for (const s of sessions) {
    if (s.audio_storage_path) pointerBySession.set(s.id, s.audio_storage_path)
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
    discardedByStaff: discardLedger.discarded.has(s.id),
    // ⚖ UPDATE 25 GROUP B, d5: the ONE line that fills the new optional
    // field (inbox.ts) from the raw SDK row — zero extra reads, the row was
    // already here. Consumed only by the audit-watch cron's per-staffer
    // finder; the facade DTO doesn't declare it, so it never leaves the
    // server.
    staffId: s.staff_id ?? null,
    // ⚖ UPDATE 25 GROUP A, piece c — the never-backfill fence. Both the
    // JST-day comparison AND `now` are the SERVER's (F4: `now` here is
    // `new Date()` on both the cookie action and the facade route, never a
    // client timestamp) — a phone's clock never decides this.
    sameDay: ymdInJst(new Date(s.created_at)) === ymdInJst(now),
  }))

  // P3-11 / ⚖ fix round d5b (NB-4, mutant M17): a truncated sessions or
  // records page means this pass cannot swear to ANY row, not only the
  // record-less ones — a truncated SESSIONS walk can drop rows before a
  // record ever gets matched to them, so a row that happens to carry a
  // karute record on THIS page is no safer than one that doesn't. Mark every
  // row, same idiom as the degraded-ledger branch below.
  if (readTruncated) {
    for (const r of rows) r.probeIncomplete = true
  }

  // Residue = the only sessions whose job state can still matter.
  const residue = rows
    // A discarded session's job state cannot change what the row says (the
    // discard outranks it in the fold), so probing one is a wasted round trip.
    .filter((r) => !r.karuteRecordId && !r.discardedByStaff)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  if (residue.length > 0) {
    console.info(
      `[recordings-inbox] job probes: ${Math.min(residue.length, maxJobProbes)} of ` +
        `${residue.length} record-less sessions (${sessions.length} in window)`,
    )
  }
  if (residue.length > maxJobProbes) {
    console.warn(
      `[recordings-inbox] ${residue.length - maxJobProbes} oldest record-less sessions ` +
        'left unprobed (cap reached)',
    )
  }

  const probes = residue.slice(0, maxJobProbes)
  /** ⚖ WHO WAS ACTUALLY ASKED (fix round 1, R3). A row past the cap keeps
   *  `jobStatus: null, jobProbeFailed: false` — the exact shape of a real 404 —
   *  so without this set the server-audio derivation would read "never asked"
   *  as "definitively no job" and offer 保存する over audio a live job may
   *  already be processing. */
  const probedSessions = new Set(probes.map((r) => r.recordingSessionId))
  // F-e (監査ログ round 2 PR C2): a row past the cap was never asked at all —
  // mark it so the audit-watch cron never treats its shape-identical "no job"
  // look as a judged miss.
  for (const row of residue.slice(maxJobProbes)) row.probeIncomplete = true
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, probes.length) }, async () => {
      for (let i = next++; i < probes.length; i = next++) {
        const row = probes[i]
        // ONLY a 404 means "no job for this session" — the repo's own rule for
        // this exact class of lookup (lib/karute/karute.core.ts's upsert probe). Every
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
            row.probeIncomplete = true
            return null
          })
        if (!job) continue
        row.jobStatus = job.status
        row.jobLastError = job.status === 'FAILED' ? job.last_error : null
      }
    }),
  )

  // ⚖ A LEDGER WE COULD NOT READ MEANS NO SERVER SAVE THIS RENDER (R9b). Every
  // discarded session looks un-discarded on a degraded pass, and the one thing
  // this build adds to such a row is an offer to save the audio a staff member
  // threw away. Said out loud, once, rather than silently skipped.
  if (discardLedger.degraded) {
    console.warn(
      '[recordings-inbox] discard ledger degraded — server-audio derivation skipped for this read',
    )
    // P1-1 (監査ログ round 2 lens): on this pass every discarded session in
    // the window reads discardedByStaff: false, so a real discard falls
    // through the fold shape-identically to a genuine miss. Mark every
    // record-less row so the audit-watch cron stands down too (R9b already
    // stands the screen down for the same reason).
    for (const r of rows) if (!r.karuteRecordId) r.probeIncomplete = true
  } else {
    await deriveServerAudio(rows, pointerBySession, probedSessions, businessId, now.getTime(), {
      takeAudioProbe,
      segmentsProbe,
      maxAudioProbes,
    })
  }

  await attachCaptureWarnings(synqed, rows, pointerBySession, businessId, now.getTime(), warningDeadlineMs)

  return fillCustomerNames(rows, businessId)
}

/**
 * WHY A FAILED RECORDING FAILED, when the recorder was warned (recording hole
 * PR-7). A server-only fold — no device takes, the same call the audit-watch
 * cron makes — picks the sessions that would read genericFailure, and ONLY
 * those are asked for their newest recording.capture_warned row; zero calls
 * when there are none. The fact rides the session as `captureWarning`, and
 * every fold downstream (the screen's, the cron's) names it.
 *
 * ⚖ THE FACT MUST BE ABOUT THIS ROW'S TAKE (fix round 1, Greptile P1). A
 * session can be retaken, and a RETAKE moves the row's pointer to the new
 * take (see deriveServerAudio's note), so a warning filed for take A says
 * nothing about why take B failed. The row's own take is the one its storage
 * POINTER names — parsed here, locally, and never put on the wire — and only
 * a fact whose `detail.take_id` is that take counts. A row whose pointer names
 * something other than this tenant's take (staged, rescue, another tenant's)
 * cannot be matched, so it is not asked at all.
 *
 * ⚖ …BUT A SESSION WITH NO POINTER AT ALL IS ASKED (fix round 2, Greptile
 * R2-1). It never bound a take, so there is no take for a fact to mismatch —
 * and "the upload never arrived" is exactly the failure a warning explains.
 * For it the NEWEST capture_warned row counts, whatever its take_id.
 *
 * A read that throws is not an answer: the session keeps no field (today's
 * generic line), the miss is logged, and the inbox still returns. So is one
 * that has not answered by the DEADLINE: answers are collected aside and
 * applied once, when the lookup finishes or the deadline passes — whichever is
 * first — so a late answer can never change a row after this read returned,
 * and no new read starts after the deadline. (recording-port.ts has a
 * withDeadline, but it lives in the client port's module graph.)
 */
async function attachCaptureWarnings(
  synqed: Pick<SynqedClient, 'audit'>,
  rows: InboxServerSession[],
  /** sessionId → the row's storage POINTER (readRecordingsInbox's local map). */
  pointerBySession: ReadonlyMap<string, string>,
  businessId: string,
  nowMs: number,
  deadlineMs: number,
): Promise<void> {
  /** sessionId → the row's own take id, or null for a session that never
   *  bound one (no pointer: any take's fact counts). */
  const takeIdBySession = new Map<string, string | null>()
  for (const r of deriveInboxRows({ sessions: rows, takes: [], now: nowMs })) {
    if (r.reason !== 'genericFailure' || !r.recordingSessionId) continue
    const pointer = pointerBySession.get(r.recordingSessionId)
    if (pointer === undefined) {
      takeIdBySession.set(r.recordingSessionId, null)
      continue
    }
    const parsed = parseRecordingKey(pointer, businessId)
    if (parsed?.kind === 'take') takeIdBySession.set(r.recordingSessionId, parsed.takeId)
  }
  const failed = [...takeIdBySession.keys()]
  if (failed.length > MAX_WARNING_READS) {
    console.warn(
      `[recordings-inbox] ${failed.length - MAX_WARNING_READS} oldest failed sessions ` +
        'left unasked for a warning fact (cap reached)',
    )
  }
  const asks = failed.slice(0, MAX_WARNING_READS)
  if (asks.length === 0) return
  const found = new Map<string, 'device' | 'server'>()
  let settled = 0
  let stopped = false
  let next = 0
  const lookup = Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, asks.length) }, async () => {
      for (let i = next++; !stopped && i < asks.length; i = next++) {
        const id = asks[i]
        try {
          const res = await synqed.audit.list({
            target_type: 'recording',
            target_id: id,
            category: 'recording',
            page_size: WARNING_PAGE_SIZE,
          })
          // Newest first (the SDK's own contract), so the first match is the
          // latest raise ON THIS ROW'S TAKE (any take, for an unbound session).
          // Only the two known codes are carried.
          const takeId = takeIdBySession.get(id)
          const fact = res.events.find(
            (e) =>
              e.action === 'recording.capture_warned' &&
              (takeId === null ||
                (e.detail as { take_id?: unknown } | null | undefined)?.take_id === takeId),
          )
          const reason = (fact?.detail as { reason?: unknown } | null | undefined)?.reason
          if (reason === 'device' || reason === 'server') found.set(id, reason)
        } catch (err) {
          console.warn(`[recordings-inbox] warning-fact read failed for ${id}:`, err)
        } finally {
          settled++
        }
      }
    }),
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const inTime = await Promise.race([
    lookup.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), deadlineMs)
    }),
  ])
  clearTimeout(timer)
  if (!inTime) {
    stopped = true
    console.warn(
      `[recordings-inbox] warning-fact lookup past ${deadlineMs} ms — ` +
        `${asks.length - settled} failed sessions left generic`,
    )
  }
  const byId = new Map(rows.map((r) => [r.recordingSessionId, r]))
  for (const [id, reason] of found) {
    const row = byId.get(id)
    if (row) row.captureWarning = reason
  }
}

/**
 * WHAT THE SERVER HOLDS, for the rows where it can still matter (slice ③).
 *
 * WHO IS ASKED, and every exclusion is a refusal to guess:
 *  · no karute record and no staff discard — either one answers the row higher
 *    up in the fold, and a discard outranks everything;
 *  · the ledger was READABLE this pass. When it degraded (its catch returns an
 *    empty set) every discarded session in the window looks un-discarded, so
 *    this whole derivation stands down: we could not check discards, so we
 *    offer no server save this render (⚖ fix round 1, R9b);
 *  · the job was ACTUALLY PROBED. Rows past MAX_JOB_PROBES carry
 *    `jobStatus: null, jobProbeFailed: false` — shape-identical to a real 404
 *    but never asked — and admitting them would offer 保存する over audio a
 *    live job may already be processing (⚖ R3);
 *  · that probe said "no job" or "FAILED". A live/unknown job is answered
 *    higher up; a FAILED one is admitted on purpose so a spent row keeps its
 *    one affordance (⚖ R10b — core re-arms a failed job per session);
 *  · the pointer parses as THIS business's take;
 *  · the row is past the unsettled grace, below which it already reads 処理中 —
 *    UNLESS its job already FAILED. The grace guards a row that may still be
 *    mid-upload with no job yet; a job row is proof a door already proved the
 *    audio and queued it, so a server save that fails inside the grace keeps
 *    its 再試行 instead of sitting inert for three hours (fix round 6, R2).
 *    THE HONEST COST: a young FAILED row whose folder holds only segments
 *    still reads 失敗 — the fold's FAILED branch reads 'object' alone — so its
 *    listing was asked for nothing; rare, capped, and cheaper than coupling
 *    this read to the fold. A RETAKE on the same session (take-store's
 *    'superseded') moves the row's pointer to the new take: the resolver then
 *    answers about THAT take, which is the honest audio either way — 'absent'
 *    while it uploads (nothing offered), 'object' once it lands (再試行 over
 *    the new take).
 *
 * ⚖ STORAGE IS THE ONLY WITNESS (D8', hardened in fix round 1 R1). There is no
 * duration fast path, because a duration is NOT proof that an object exists:
 * discard.ts's stampRecordingDuration writes a client-reported length with no
 * object behind it at all (take-binding.ts says so in capitals). Trusting it
 * would paint 復元可能 + 保存する over nothing, the door would answer no_audio,
 * and the 要対応 count would be one a staffer could never clear.
 *
 * ⚖ AND THE PHONE'S OWN KEY IS ASKED FIRST (ADDENDUM 9.4, 2026-09-07).
 * `resolveTakeAudio` is the ONE precedence for "where is this take's audio" —
 * the phone's whole object, then the rescue beside it — and it needs no
 * segments to answer. WHY THAT ORDER: a whole object can exist with no `seg/`
 * folder behind it at all. Every take recorded by a shell older than the
 * segment pump (#836) is that shape, which is every fielded phone until this
 * build's bake reaches it; so is a take whose stop-time pump was refused or
 * budget-cut and whose object landed on a later drain. Asking the listing
 * first hid all of them behind 失敗 while the save door would have queued
 * them happily. So, per candidate:
 *  · the resolver first: a key (the phone's object OR the rescue — the inbox
 *    does not care which) → 'object', and nothing else is asked;
 *  · 'unknown' → nothing at all, and no listing. A blip is not evidence in
 *    either direction, and the row keeps exactly today's behaviour;
 *  · 'absent' → THEN the listing, which now gates only the half it can speak
 *    for: seq 000000 present → 'segments'; anything else, or 'unknown' →
 *    nothing.
 *
 * THE HONEST CALL COUNT: still up to THREE storage calls per candidate row —
 * the phone's key, the rescue's, then the listing — and the cap below bounds
 * the CANDIDATES, not the calls. A finished-object row now pays ONE. The only
 * row that pays MORE than before is a dead folder with no seq 0 (three calls
 * instead of one), which is rare and bounded by the same cap. One pool, one
 * cap, for the same reason the job probes have theirs: a genuinely broken
 * tenant must not turn one inbox read into hundreds of storage round trips.
 * Newest-first, and the drop is logged.
 *
 * THE HONEST REMAINING COST: a take with nothing on the server at all — no
 * object at either key, no seq 0 in the folder — still reads 失敗, which is
 * exactly what it is.
 */
async function deriveServerAudio(
  rows: readonly InboxServerSession[],
  /** sessionId → the row's storage POINTER. The one raw fact the derivation
   *  needs and the wire must never carry, kept out of the returned rows on
   *  purpose (the DTO's rule: metadata only, no audio path). */
  pointerBySession: ReadonlyMap<string, string>,
  /** The sessions whose job state was ACTUALLY probed — see the doc above. */
  probedSessions: ReadonlySet<string>,
  businessId: string,
  nowMs: number,
  deps: { takeAudioProbe: TakeAudioProbe; segmentsProbe: SegmentsProbe; maxAudioProbes: number },
): Promise<void> {
  const candidates: Array<{ row: InboxServerSession; key: string; takeId: string; ext: string }> = []
  for (const row of rows) {
    if (row.karuteRecordId || row.discardedByStaff) continue
    if (!probedSessions.has(row.recordingSessionId)) continue
    if (row.jobProbeFailed) continue
    if (row.jobStatus !== null && row.jobStatus !== 'FAILED') continue
    const key = pointerBySession.get(row.recordingSessionId)
    if (!key) continue
    // The take fence, not merely "parses": a segment leaf, a staged copy and
    // another tenant's key are all false here however the row reads. What it
    // yields — the take id and the container — is also what the resolver takes,
    // so the fence and the question can never be about two different takes.
    const parsed = parseRecordingKey(key, businessId)
    if (parsed?.kind !== 'take') continue
    if (row.jobStatus !== 'FAILED' && nowMs - Date.parse(row.createdAt) <= SESSION_UNSETTLED_GRACE_MS)
      continue
    candidates.push({ row, key, takeId: parsed.takeId, ext: parsed.ext })
  }

  if (candidates.length > deps.maxAudioProbes) {
    console.warn(
      `[recordings-inbox] ${candidates.length - deps.maxAudioProbes} oldest unsettled sessions ` +
        'left un-probed for server audio (cap reached)',
    )
  }
  // `rows` is the server list's own order, so re-sort to the residue's
  // newest-first rule before the cap decides who is dropped.
  candidates.sort((a, b) => Date.parse(b.row.createdAt) - Date.parse(a.row.createdAt))
  const probeList = candidates.slice(0, deps.maxAudioProbes)
  // F-e: the oldest candidates the cap itself drops were never probed either.
  for (const c of candidates.slice(deps.maxAudioProbes)) c.row.probeIncomplete = true
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, probeList.length) }, async () => {
      for (let i = next++; i < probeList.length; i = next++) {
        const { row, key, takeId, ext } = probeList[i]
        // ⚖ ONE ROW'S BAD LUCK IS NOT THE WHOLE SCREEN'S (fix round 4, R1).
        // Both production probes can THROW, not just answer 'unknown':
        // listFirstSegment builds the service client outside makeSegmentsProbe's
        // own try (a missing or rotated SUPABASE env throws on construction),
        // and resolveTakeAudio throws by design when a key fails its grammar. A
        // rejection here escapes Promise.all and takes the whole 録音履歴 server
        // half down with it — a 502 at the facade, 「サーバー側の読み込みに失敗」
        // on the web — which is the opposite of the rule this loop is written to:
        // a probe we could not ask leaves the row EXACTLY as it was. The job
        // probe next door already degrades this way.
        try {
          // THE PHONE'S KEY FIRST (ADDENDUM 9.4), because a whole object needs
          // no segments behind it. Only a proven 'absent' buys the listing, and
          // the listing now gates the RESCUE half alone.
          const audio = await deps.takeAudioProbe(businessId, takeId, ext)
          if (audio === 'unknown') {
            // F-e: a blip is not an answer — the row keeps today's behaviour,
            // but this pass could not judge it either way.
            row.probeIncomplete = true
            continue
          }
          if (audio !== 'absent') {
            row.serverAudio = 'object'
            continue
          }
          const segments = await deps.segmentsProbe(businessId, key)
          if (segments === true) row.serverAudio = 'segments'
          else if (segments === 'unknown') row.probeIncomplete = true
        } catch (err) {
          // A probe we could not ask is not an answer: the row keeps today's
          // behaviour and the next render asks again.
          console.warn(
            `[recordings-inbox] server-audio probe failed for ${row.recordingSessionId}:`,
            err,
          )
          row.probeIncomplete = true
          continue
        }
      }
    }),
  )
}

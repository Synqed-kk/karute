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
import {
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
    'recordings' | 'karuteRecords' | 'recordingJobs' | 'recordingDiscards'
  >
  /** The AUTHENTICATED actor's staff id. Never a caller-supplied parameter. */
  staffId: string
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
}: InboxReadDeps): Promise<InboxServerSession[]> {
  const from = new Date(now.getTime() - INBOX_WINDOW_MS).toISOString()

  const [sessions, records, discardLedger] = await Promise.all([
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
  }))

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

  // ⚖ A LEDGER WE COULD NOT READ MEANS NO SERVER SAVE THIS RENDER (R9b). Every
  // discarded session looks un-discarded on a degraded pass, and the one thing
  // this build adds to such a row is an offer to save the audio a staff member
  // threw away. Said out loud, once, rather than silently skipped.
  if (discardLedger.degraded) {
    console.warn(
      '[recordings-inbox] discard ledger degraded — server-audio derivation skipped for this read',
    )
  } else {
    await deriveServerAudio(rows, pointerBySession, probedSessions, businessId, now.getTime(), {
      takeAudioProbe,
      segmentsProbe,
      maxAudioProbes,
    })
  }

  return fillCustomerNames(rows, businessId)
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
 *  · the row is past the unsettled grace, below which it already reads 処理中.
 *
 * ⚖ STORAGE IS THE ONLY WITNESS (D8', hardened in fix round 1 R1). There is no
 * duration fast path, because a duration is NOT proof that an object exists:
 * discard.ts's stampRecordingDuration writes a client-reported length with no
 * object behind it at all (take-binding.ts says so in capitals). Trusting it
 * would paint 復元可能 + 保存する over nothing, the door would answer no_audio,
 * and the 要対応 count would be one a staffer could never clear.
 *
 * ⚖ AND THE SEGMENT FOLDER IS ASKED FIRST (amendment 9's ADDENDUM 9.2, M1).
 * The rescue lives at its own key now, and a folder with no seq 0 was never
 * rescued and never can be — so the cheap listing that already answers the
 * 'segments' half is also the gate on asking about audio at all:
 *  · seq 0 present → `resolveTakeAudio`: a key (the phone's object OR the
 *    rescue — the inbox does not care which) → 'object'; 'absent' →
 *    'segments'; 'unknown' → nothing.
 *  · anything else from the listing → nothing at all, and no second call.
 *  · 'unknown' from either probe → nothing. A blip is not evidence in either
 *    direction, and the row keeps exactly today's behaviour.
 * NAMED COST of that order: a take shorter than one flush window has no
 * segments to list, so its finished object is not offered here — it reads as
 * it did before this build. Nothing is claimed that cannot be saved.
 *
 * THE HONEST CALL COUNT: up to THREE storage calls per candidate row — the
 * listing, then the phone's key, then the rescue's — and the cap below bounds
 * the CANDIDATES, not the calls. One pool, one cap, for the same reason the
 * job probes have theirs: a genuinely broken tenant must not turn one inbox
 * read into hundreds of storage round trips. Newest-first, and the drop is
 * logged.
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
    if (nowMs - Date.parse(row.createdAt) <= SESSION_UNSETTLED_GRACE_MS) continue
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
  const probeList = candidates
    .sort((a, b) => Date.parse(b.row.createdAt) - Date.parse(a.row.createdAt))
    .slice(0, deps.maxAudioProbes)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, probeList.length) }, async () => {
      for (let i = next++; i < probeList.length; i = next++) {
        const { row, key, takeId, ext } = probeList[i]
        // The listing FIRST, and it is a gate as well as a fact: no seq 0, no
        // rescue is possible, so nothing else is asked (ADDENDUM 9.2 M1).
        if ((await deps.segmentsProbe(businessId, key)) !== true) continue
        const audio = await deps.takeAudioProbe(businessId, takeId, ext)
        if (audio === 'unknown') continue
        row.serverAudio = audio === 'absent' ? 'segments' : 'object'
      }
    }),
  )
}

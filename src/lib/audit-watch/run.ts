/**
 * 監査ログ round 2, PR C — subject 4: one business's audit-watch pass
 * (PACKET-AUDITLOG-PR-C-SERVER-WATCH-2026-09-11.md item 4). The cron route
 * (src/app/api/audit-watch/route.ts) is thin auth + allowlist + loop; this is
 * where the two candidate detectors (find-karute-missing.ts,
 * find-transcribe-storms.ts) meet the read/write — same route/lib split as
 * src/app/api/packs/auto-burn/route.ts ↔ src/lib/packs/auto-burn.ts.
 *
 * ALL reads go through the SDK directly (synqed.audit.list, never
 * listAuditLogWithClient — that helper writes its own privacy.audit_log.view
 * receipt per call, which this cron must never do: CP1, no actor, no view
 * row).
 */
import type { Appointment, AuditEvent, RecentRedemption } from '@synqed-kk/client'
import { newSynqedClient } from '@/lib/synqed/client'
import { audit } from '@/lib/audit'
import { readRecordingsInbox } from '@/lib/recordings/inbox-read'
import { deriveInboxRows, INBOX_WINDOW_MS, type InboxRow } from '@/lib/recordings/inbox'
import { findKaruteMissing, lastAssemblerPassAt } from '@/lib/audit-watch/find-karute-missing'
import { ASSEMBLE_AFTER_MS } from '@/lib/recording/assembler'
import { findTranscribeStorms } from '@/lib/audit-watch/find-transcribe-storms'
import { findNoSessionsToday } from '@/lib/audit-watch/find-no-sessions-today'
import { isTerminalStatus } from '@/lib/appointments/status'
import { ymdInJst, jstWallTimeToDate, partsInJst } from '@/lib/date/jst'

const AUDIT_PAGE_SIZE = 200
/** Safety stop on the category:'recording' page walk (mirrors /api/cleanup's
 *  MAX_PAGES idiom) — the deadline below is the honest stop in practice. */
const MAX_AUDIT_PAGES = 50
/** Per-candidate idempotency-check page size (packet item 4c). */
const DEDUPE_PAGE_SIZE = 50
/** P2-5: never START a business's un-budgeted read (up to 50 pages of
 *  sessions + 50 of karute records, 20 of discards, ~100 job/audio probes —
 *  none of it sees the deadline once begun) with less than this much of the
 *  wall left. The assembler's own idiom for the exact same law — "never
 *  START what the wall will interrupt" — is TAKE_RESERVE_MS,
 *  src/lib/recording/assembler.ts:157. */
const BUSINESS_RESERVE_MS = 30_000

/** ⚖ UPDATE 25 GROUP B, d5. Core rejects page_size above 200 on staff.list
 *  (staff-map.ts's own precedent); a 40-page cap is auto-burn.ts's own idiom
 *  for a paginate-to-exhaustion loop that must still stop on a broken core. */
const APPOINTMENTS_PAGE_SIZE = 500
const MAX_APPOINTMENTS_PAGES = 40
const STAFF_PAGE_SIZE = 200
const MAX_STAFF_PAGES = 25

type Detail = Record<string, string | number | boolean | null>

/** F-a: the `?dry=1` door's whole point is for the OWNER to read the list
 *  before the writer ever flips — ids and codes only, never a name, never a
 *  raw error. Filled in BOTH modes (in write mode it is what was written),
 *  only for candidates that passed the prior-row check: a skipped candidate
 *  (a prior row already exists) is not new information and is not listed. */
export interface WatchCandidate {
  action: string
  targetId: string
  day?: string
  reason?: string
  count?: number
  costCentsEstimate?: number
}

export interface BusinessWatchResult {
  businessId: string
  candidates: number
  written: number
  skipped: number
  truncated: boolean
  /** F-b: a caught error is not a green run — decoupled from `truncated`,
   *  which stays reserved for an honest budget stop (the assembler's own
   *  rule: a run that could not see everything says so, a run that simply
   *  ran out of time is still a 200). */
  error: boolean
  /** F-e: sessions this run could not fully judge (a job/audio probe past its
   *  cap, or a storage probe that threw/answered 'unknown') and therefore
   *  dropped before they could become a candidate — so the dry list shows how
   *  many were left unjudged rather than silently under-counting. */
  unchecked: number
  list: WatchCandidate[]
}

function detailDay(detail: unknown): unknown {
  return detail && typeof detail === 'object' ? (detail as Record<string, unknown>).day : undefined
}

/** ONE per-target dedupe read (CP2): true when NO existing row shares this
 *  action (and, for a storm, the same detail.day). No action filter exists on
 *  ListAuditOptions yet (Anthony ticket item 2), so this scans the target's
 *  small `recording`-category page client-side.
 *
 * F-d: THE CEILING, named. This reads only ONE page of DEDUPE_PAGE_SIZE rows —
 * a target with more `recording`-category rows than that could hide an older
 * watch row past the page and re-write it. Two things stand behind this,
 * neither of them this scan: the deterministic `request_id` — P2-2:
 * `audit-watch:<action>:<target>` for karute_missing (one fact per target,
 * ever — the RUN's day is not the SESSION's day, so a day suffix here was
 * never actually stable across runs), `audit-watch:<action>:<target>:<day>`
 * for a storm (one fact per target per storm-day, `storm.day` itself fixed
 * once the storm exists) — and the reader's own belt-dedupe fold on (action,
 * target, request_id) — a re-write lands as a harmless duplicate, never a
 * second candidate a human has to re-triage. CORE-19 item 2 (an `action`
 * filter on ListAuditOptions) removes the ceiling outright, once it lands. */
async function isNewCandidate(
  synqed: ReturnType<typeof newSynqedClient>,
  targetId: string,
  action: string,
  day: string | null,
): Promise<boolean> {
  const existing = await synqed.audit.list({
    target_type: 'recording',
    target_id: targetId,
    category: 'recording',
    page_size: DEDUPE_PAGE_SIZE,
  })
  return !existing.events.some((e) => e.action === action && (day == null || detailDay(e.detail) === day))
}

/** ⚖ UPDATE 25 GROUP B, d5. Today's KEPT appointments (auto-burn.ts's
 *  paginate-to-exhaustion idiom, one call per business per ≥21:00 JST
 *  evaluation — normally a single page). Terminal (CANCELLED/NO_SHOW)
 *  bookings are dropped: a "kept" appointment is what gate (a) needs. */
async function pageTodaysAppointments(
  synqed: ReturnType<typeof newSynqedClient>,
  ymd: string,
): Promise<(Appointment & { staff_id: string })[]> {
  const from = new Date(`${ymd}T00:00:00+09:00`).toISOString()
  const to = new Date(`${ymd}T23:59:59.999+09:00`).toISOString()
  const appointments: Appointment[] = []
  for (let page = 1; page <= MAX_APPOINTMENTS_PAGES; page++) {
    const res = await synqed.appointments.list({ from, to, page, page_size: APPOINTMENTS_PAGE_SIZE })
    appointments.push(...res.appointments)
    if (res.appointments.length === 0 || appointments.length >= res.total) break
  }
  // by-date.ts's own precedent: a BLOCK-kind row (or any staff-less booking)
  // has nothing for the per-staffer finder to join against — never invent one.
  return appointments.filter(
    (a): a is Appointment & { staff_id: string } => a.staff_id != null && !isTerminalStatus(a.status),
  )
}

/** ⚖ UPDATE 25 GROUP B, d5 (L2 §1). `recording_sessions.staff_id` is NOT a
 *  single id space — the auth/profile id on a resolved-identity mint, the
 *  CORE staff id on the appointment-fallback mint (session-mint.ts:156-160)
 *  — while `appointments.staff_id` is always the core id. This is the
 *  two-way normalize-to-core-id map the finder joins both through:
 *  `id → id` (core id maps to itself) and `user_id → id` (the linked profile
 *  maps to its card). One roster read per business per ≥21:00 JST
 *  evaluation, same MAX_PAGES idiom as staff-map.ts's own precedent. */
async function buildStaffCoreIdMap(
  synqed: ReturnType<typeof newSynqedClient>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let page = 1; page <= MAX_STAFF_PAGES; page++) {
    const res = await synqed.staff.list({ page, page_size: STAFF_PAGE_SIZE })
    for (const s of res.staff) {
      map.set(s.id, s.id)
      if (s.user_id) map.set(s.user_id, s.id)
    }
    if (res.staff.length === 0 || page * STAFF_PAGE_SIZE >= res.total) break
  }
  return map
}

/** Every `recording`-category event since `from`, paged to completion or
 *  until `deadline` — no action filter exists server-side, so the storm
 *  finder filters to `recording.transcribe` itself. */
async function pageRecordingEvents(
  synqed: ReturnType<typeof newSynqedClient>,
  from: string,
  to: string,
  deadline: number,
): Promise<{ events: AuditEvent[]; truncated: boolean }> {
  const events: AuditEvent[] = []
  for (let page = 1; page <= MAX_AUDIT_PAGES; page++) {
    if (Date.now() >= deadline) return { events, truncated: true }
    const res = await synqed.audit.list({ category: 'recording', from, to, page, page_size: AUDIT_PAGE_SIZE })
    events.push(...res.events)
    if (res.events.length === 0 || page * AUDIT_PAGE_SIZE >= res.total) return { events, truncated: false }
  }
  return { events, truncated: true }
}

/** store_id/appointment_id/staff_id aren't on InboxRow (the 録音履歴 screen
 *  never needed them) — one Recording read per candidate fills them. Rare by
 *  construction (this whole feature exists because misses are rare), so a
 *  per-candidate `get` is cheaper than widening the shared inbox row shape
 *  for a field only this cron reads. ticket_burned reuses auto-burn.ts:367's
 *  ONE-bulk-read-then-filter idiom (never a per-appointment SDK call — none
 *  exists): null when there is no appointment to check, or the bulk read
 *  itself failed. */
async function karuteMissingDetail(
  synqed: ReturnType<typeof newSynqedClient>,
  row: InboxRow,
  redemptions: RecentRedemption[] | null,
): Promise<Detail> {
  const recording = await synqed.recordings.get(row.recordingSessionId as string).catch(() => null)
  const appointmentId = recording?.appointment_id ?? null
  return {
    recording_session_id: row.recordingSessionId,
    customer_id: row.customerId,
    staff_id: recording?.staff_id ?? null,
    appointment_id: appointmentId,
    store_id: recording?.store_id ?? null,
    duration_seconds: row.durationSeconds,
    reason: row.reason,
    ticket_burned:
      appointmentId == null || redemptions == null
        ? null
        : redemptions.some((r) => r.appointment_id === appointmentId),
  }
}

export async function watchOneBusiness(
  businessId: string,
  now: Date,
  mode: 'dry' | 'write',
  deadline: number,
): Promise<BusinessWatchResult> {
  const result: BusinessWatchResult = {
    businessId,
    candidates: 0,
    written: 0,
    skipped: 0,
    truncated: false,
    error: false,
    unchecked: 0,
    list: [],
  }
  if (Date.now() + BUSINESS_RESERVE_MS > deadline) {
    result.truncated = true
    return result
  }
  try {
    // P2-4: constructed INSIDE the try — a missing-env throw here is the
    // same class of failure as any other read, and must reach the same
    // catch (F-b) so this business's error doesn't kill the route's loop
    // over every OTHER business (route.ts has no try of its own).
    const synqed = newSynqedClient(businessId)

    // (a) recording.karute_missing candidates.
    const sessions = await readRecordingsInbox({ synqed, staffId: null, businessId, now })
    const allRows = deriveInboxRows({ sessions, takes: [], now: now.getTime() })
    // F-e: a session this pass could not fully judge reads `failed`/
    // `processing` shape-identically to a real miss (find-karute-missing.ts's
    // own ponytail note) — never write a row for one; count it instead so the
    // dry list shows how many were left unjudged.
    //
    // ⚖ fix round d5b (NB-4, mutant M17): since inbox-read.ts now marks EVERY
    // row `probeIncomplete` on a truncated sessions/records walk (not only
    // the record-less ones), `incompleteIds` — and so `result.unchecked` —
    // can include a row that already carries a karute record. That changes
    // nothing for `missing` below: findKaruteMissing only ever accepts state
    // 'recoverable' | 'failed', and a row with a karuteRecordId always folds
    // to 'saved' / 'awaiting-check' (inbox.ts) — never a candidate either
    // way, dropped or not. `result.unchecked` grows ONLY on a truncated walk
    // or a capped/thrown probe (F-e above) — never on anything else.
    const incompleteIds = new Set(
      sessions.filter((s) => s.probeIncomplete).map((s) => s.recordingSessionId),
    )
    result.unchecked = incompleteIds.size
    const rows = allRows.filter(
      (r) => r.recordingSessionId === null || !incompleteIds.has(r.recordingSessionId),
    )
    const missing = findKaruteMissing({
      rows,
      now: now.getTime(),
      lastAssemblerPassAt: lastAssemblerPassAt(now.getTime()),
      assembleAfterMs: ASSEMBLE_AFTER_MS,
    })

    // (b) recording.transcribe_storm candidates — since the start of
    // yesterday JST, so a storm spanning the JST midnight boundary is never
    // split across two runs. P3-9: derived from the injected `now`, not the
    // wall clock (jstStartOfToday() takes no argument and always reads the
    // real clock) — same jst helpers jstStartOfToday itself is built from,
    // parameterized here so the window is testable and never inverts under
    // an injected past `now`.
    const from = new Date(jstWallTimeToDate(ymdInJst(now), '00:00').getTime() - 24 * 60 * 60 * 1000)
    const { events, truncated: pagesTruncated } = await pageRecordingEvents(
      synqed,
      from.toISOString(),
      now.toISOString(),
      deadline,
    )
    if (pagesTruncated) result.truncated = true
    // Greptile round 3 finding 1: never derive a storm from a truncated walk
    // (deadline or the 50-page cap) — a partial page can undercount a storm,
    // or miss one crossing the cap entirely, and the prior-row check then
    // blocks any later correction once the day IS whole (a closed day's
    // count/cost frozen low forever). findTranscribeStorms' own `truncated`
    // field stays part of its contract; a WRITTEN row here always comes from
    // a whole walk. The day is closed either way, so waiting for a fresh,
    // un-truncated budget next hour costs nothing.
    //
    // P2-7: closed days only — a day still in progress can only ever grow
    // (more receipts may land before midnight), so listing/writing it now
    // would freeze a count and cost that are not yet whole. This is
    // evidence, not a real-time alarm: the spend wall
    // (src/lib/ai/transcribe.ts) is the actual brake against runaway
    // transcription cost. Today's storm waits for tomorrow's first run.
    const storms = pagesTruncated
      ? []
      : findTranscribeStorms({ events, truncated: pagesTruncated }).filter(
          (s) => s.day < ymdInJst(now),
        )

    result.candidates = missing.length + storms.length

    const redemptions =
      missing.length > 0
        ? await synqed.packs
            .listRecentRedemptions(new Date(now.getTime() - INBOX_WINDOW_MS).toISOString())
            .catch(() => null)
        : null

    // (c) idempotency + write, one candidate at a time (CP2 — a candidate
    // skipped here is never walked again in this run).
    for (const row of missing) {
      if (Date.now() >= deadline) {
        result.truncated = true
        break
      }
      const targetId = row.recordingSessionId as string
      const isNew = await isNewCandidate(synqed, targetId, 'recording.karute_missing', null)
      if (!isNew) {
        result.skipped++
        continue
      }
      // F-a: listed in BOTH modes, ids and codes only — never before the
      // dedupe check above (a skipped candidate is not new information).
      result.list.push({
        action: 'recording.karute_missing',
        targetId,
        reason: row.reason ?? undefined,
      })
      if (mode === 'write') {
        // P2-3: the row-level store (src/lib/audit.ts:50, the idiom every
        // appointment emitter uses) so a store-scoped 監査ログ can see this
        // row — never just inside detail. karuteMissingDetail already reads
        // the recording for detail.store_id; reuse it instead of a second
        // fetch.
        const detail = await karuteMissingDetail(synqed, row, redemptions)
        audit({
          category: 'recording',
          action: 'recording.karute_missing',
          actorId: null,
          actorType: 'system',
          businessId,
          targetType: 'recording',
          targetId,
          storeId: typeof detail.store_id === 'string' ? detail.store_id : undefined,
          severity: 'notice',
          detail,
          // P2-2: no day suffix — deterministic across runs (was ymdInJst(now),
          // the RUN's day, which changes daily for the same never-resolved
          // session; the packet's ceiling comment above assumed this already
          // held).
          requestId: `audit-watch:recording.karute_missing:${targetId}`,
          source: 'system',
        })
        // F-c: `written` counts only real writes — dry mode leaves it at 0
        // (`candidates` is the count, `list` the content).
        // P3-8: "real write" means HANDED to the writer, not landed —
        // audit() returns void and forwards the core write via after()
        // (src/lib/audit.ts:18-33), so a forwarding failure is swallowed
        // into a drop counter there, invisible here. Not a correctness gap:
        // a dropped write leaves no prior row, so the next hourly run's
        // isNewCandidate check re-writes it.
        result.written++
      }
    }

    for (const storm of storms) {
      if (Date.now() >= deadline) {
        result.truncated = true
        break
      }
      const isNew = await isNewCandidate(synqed, storm.targetId, 'recording.transcribe_storm', storm.day)
      if (!isNew) {
        result.skipped++
        continue
      }
      result.list.push({
        action: 'recording.transcribe_storm',
        targetId: storm.targetId,
        day: storm.day,
        count: storm.count,
        costCentsEstimate: storm.costCentsEstimate,
      })
      if (mode === 'write') {
        // P2-3: one extra per-candidate recording read fills the row-level
        // store, same idiom as karuteMissingDetail — rare by construction (a
        // storm event exists only when its source recording did too).
        const recording = await synqed.recordings.get(storm.targetId).catch(() => null)
        audit({
          category: 'recording',
          action: 'recording.transcribe_storm',
          actorId: null,
          actorType: 'system',
          businessId,
          targetType: 'recording',
          targetId: storm.targetId,
          storeId: recording?.store_id ?? undefined,
          severity: 'notice',
          detail: {
            recording_session_id: storm.targetId,
            customer_id: storm.customerId,
            staff_id: storm.staffId,
            // second-order delta-verify finding: consistent with
            // karuteMissingDetail's own store_id field (same recordings.get
            // result feeds both this and the row-level storeId above).
            store_id: recording?.store_id ?? null,
            count: storm.count,
            cost_cents_estimate: storm.costCentsEstimate,
            truncated: storm.truncated,
            day: storm.day,
          },
          requestId: `audit-watch:recording.transcribe_storm:${storm.targetId}:${storm.day}`,
          source: 'system',
        })
        // P3-8: same "handed to the writer, not landed" semantics as the
        // karute_missing counter above.
        result.written++
      }
    }

    // (c) recording.no_sessions_today — Group B d5: a staffer who usually
    // records but produced no session today (packet's own 9/9 shape: OTHER
    // phones minted fine while one staffer's minted nothing). Evaluated only
    // in the FIRST hourly run at or after 21:00 JST, so a half-day never
    // fires; a truncated events walk OR sessions walk this run means this
    // pass could not fully judge the business, so it stays SILENT (the
    // storms rule — the 22:23/23:23 runs get their own chance, never a false
    // zero). Reuses the SAME `sessions` walk (a) already read and the SAME
    // `events` page (b) already paged for dedupe — zero extra audit reads.
    // NB-7 (⚖ fix round d5b): the two new reads below (appointments, roster)
    // do NOT run "at most once per business per day" — `alreadyFired` only
    // becomes true once a row EXISTS, so they run on EVERY ≥21:00 JST run
    // until one is written (up to three: 21:23 · 22:23 · 23:23).
    //
    // ⚖ THIS ROW IS A CHECK, NEVER A DIAGNOSIS (design law §1 Layer A) — it
    // names a staffer who usually records and produced no session today; it
    // does not and cannot say WHY (a legitimate day off is already excluded
    // by the "kept appointment today" gate; a customer who declined consent
    // is an accepted false-positive class — no bulk per-customer consent
    // read exists to build a gate against it from, so none is built here).
    if (partsInJst(now).hour >= 21 && !pagesTruncated && incompleteIds.size === 0) {
      const today = ymdInJst(now)
      // DEDUPE with zero new reads (L2 §4): the already-paged `events` cover
      // [yesterday JST start, now] — a superset of all of today — so any
      // prior row for today is already in hand. isNewCandidate stays
      // UNCHANGED; this is a plain scan of what's already in memory.
      const alreadyFired = events.some(
        (e) => e.action === 'recording.no_sessions_today' && detailDay(e.detail) === today,
      )
      if (!alreadyFired) {
        const todayStart = jstWallTimeToDate(today, '00:00')
        // The SAME probeIncomplete-filtered set (a) already built for
        // findKaruteMissing — never the raw `sessions` array, or a truncated
        // page could undercount a real staffer's sessions and manufacture a
        // false "zero today" (L2 MUST 2).
        const completeSessions = sessions.filter((s) => !s.probeIncomplete)
        const [todaysAppointments, staffCoreIdMap] = await Promise.all([
          pageTodaysAppointments(synqed, today),
          buildStaffCoreIdMap(synqed),
        ])
        const found = findNoSessionsToday({
          sessions: completeSessions,
          appointments: todaysAppointments,
          staffIdToCoreId: staffCoreIdMap,
          now: now.getTime(),
          todayStart,
        })
        if (found) {
          result.candidates += 1
          // F-a: listed in BOTH modes, ids and codes only. targetId here is
          // the BUSINESS id (the dry list's own display handle) — the actual
          // audit row below carries NO target at all (target-less by design,
          // audit.ts:52).
          result.list.push({
            action: 'recording.no_sessions_today',
            targetId: businessId,
            day: found.day,
            count: found.staff_ids.length,
          })
          if (mode === 'write') {
            audit({
              category: 'recording',
              action: 'recording.no_sessions_today',
              actorId: null,
              actorType: 'system',
              businessId,
              targetType: 'business',
              // NO targetId (audit.ts:52, targetId optional) — a business-day
              // fact, not one recording's. storeId omitted for the same reason.
              severity: 'warning',
              detail: { ...found },
              requestId: `audit-watch:recording.no_sessions_today:${businessId}:${found.day}`,
              source: 'system',
            })
            result.written++
          }
        }
      }
    }
  } catch (err) {
    // F-b: an error is not a green run. Decoupled from `truncated` — a
    // budget stop is honest (the walk saw everything and simply ran out of
    // time); a caught error means the walk itself could not be trusted.
    console.error('[audit-watch]', businessId, err instanceof Error ? err.message : err)
    result.error = true
  }
  return result
}

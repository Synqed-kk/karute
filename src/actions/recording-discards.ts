'use server'

// 破棄の記録 — the manager read of core's discard ledger (packet P5-A item A-6,
// ⚖ 8/25 ruling B for the counts).
//
// WHY THIS EXISTS AT ALL. P5-A makes every deliberate discard demand a typed
// reason. The packet's own field-visibility principle is that the friction
// NEVER ships without a place a manager can read what was written — a required
// explanation nobody can ever see is a toll, not a record. This is that place.
//
// GATE: the EXISTING owner/manager line, `staff.manage` — the one capability
// the owner and manager presets carry and senior/practitioner/frontdesk do not
// (lib/auth/permissions.ts). Deliberately NOT a new capability: `integrity.view`
// is a B-5 item, and inventing it here would ship a permission with no settings
// UI to grant it. Enforced HERE, server-side; the tab filter is only exposure
// reduction.
//
// The reason TEXT lives in core's discard row and never in an audit detail
// (⚖ 8/17 doc law) — so reading it is exactly what this action is for, and the
// receipt's `discard_row_id` is the pointer that leads here.

import { newSynqedClient } from '@/lib/synqed/client'
import { getMyCapabilities, ensureCapability } from '@/lib/auth/require-permission'
import { getBusinessId, getCurrentUserStaffId, staffListByBusinessOrThrow } from '@/lib/staff'
import { synqedStaffCardsForBusiness } from '@/lib/synqed/staff-map'
import { paginateDedupe } from '@/lib/customers/paginate'

/** One row of the 破棄の記録 list. Ids resolved to names server-side, because
 *  these rows are business-wide while a clamped caller's own roster is not. */
export interface DiscardReasonRow {
  id: string
  recordingSessionId: string
  /** ISO — when the discard was recorded. */
  createdAt: string
  /** null when the id matches no current roster card (a departed staffer, or
   *  the login-uuid/staff-card id-space split). The row still renders; only
   *  the name is unknown, and saying so is honest. */
  staffName: string | null
  staffId: string | null
  reason: string
  // ── The recording BEHIND the discard (the redesign, ⚖ 8/31). ──────────────
  // All five are nullable and every one of them means the SAME thing when null:
  // we could not read it. The enrichment reads below are best-effort by
  // construction — a failed join must never fail the list — and the recordings
  // read is date-ranged and page-capped, so an old row can legitimately fall
  // outside it. The section renders every absence honestly (no name, no pill,
  // no store) rather than inventing a value or hiding the row.
  /** The customer the take was attached to. Null when none was chosen (the
   *  顧客未選択 population — a genuine state, not a failure) as well as when
   *  the recording could not be read. */
  customerId: string | null
  customerName: string | null
  /** ISO — when the RECORDING started. Deliberately separate from `createdAt`
   *  above, which is when the discard was WRITTEN: the two are minutes to days
   *  apart, and a manager checking a session needs the session's own time. */
  recordingCreatedAt: string | null
  durationSeconds: number | null
  storeName: string | null
}

export interface DiscardReasonCounts {
  /** Discards recorded in the CURRENT calendar month, whole business. */
  thisMonth: number
  /** Every STAFF discard the ledger holds (within the page cap below). */
  total: number
  // NOTE: past the cap these are FLOORS, not totals — `truncated` on the result
  // says so, and the section renders the qualifier ON the tiles because a
  // number that cannot say it is complete must say it is not (⚖ 8/25).
  /** Per staffer, this month, newest-heaviest first. Plain counts — ⚖ 8/25
   *  ruling B: labelled facts, never a threshold, grade or ranking colour. */
  byStaff: { staffId: string; staffName: string | null; thisMonth: number }[]
}

export type ListDiscardReasonsResult =
  | { ok: true; rows: DiscardReasonRow[]; counts: DiscardReasonCounts; truncated: boolean }
  | { ok: false; error: 'forbidden' | 'failed' }

/** Core rejects a page_size above 200 on this family (the recordings/karute
 *  validator, verified 2026-08-25 — see lib/recordings/inbox-read.ts's note).
 *  It does NOT clamp; it 400s. */
const PAGE_SIZE = 200
/** ponytail: 20 pages = 4,000 discards, years of them for a real salon. Past
 *  that the list truncates and SAYS SO (`truncated`) rather than quietly
 *  under-reporting a count. Upgrade path if a tenant ever reaches it: ask core
 *  for a date-range filter on recordingDiscards.list — it has none today, which
 *  is also why the month count is derived here rather than queried. */
const MAX_PAGES = 20

/** How far BEFORE the oldest discard the recordings window opens. A recording
 *  always starts before its discard is written, and the gap is unbounded in
 *  principle — a take left running over a service, a next-morning clean-up of
 *  yesterday's session. 48h covers every real case; anything older simply
 *  degrades to nulls, which is the honest answer and not a broken row. */
const RECORDING_WINDOW_MARGIN_MS = 48 * 60 * 60 * 1000

function startOfThisMonth(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

/** What the discard rows say about the recordings behind them — resolved in
 *  ONE-SHOT MAPS, never a per-row get. The list can hold thousands of rows and
 *  a `.get()` each would be exactly the N+1 the lazy transcript read exists to
 *  avoid.
 *
 *  EVERY read here is best-effort. A discard ledger that can be read must not
 *  be withheld because a name lookup failed, so each branch catches, warns, and
 *  answers an empty map: the rows then render with absences the section states
 *  plainly. Failing the list instead would trade a complete answer for no
 *  answer at all.
 */
async function readDiscardRecordingContext(
  synqed: ReturnType<typeof newSynqedClient>,
  sessionIds: Set<string>,
  oldestDiscardMs: number,
): Promise<{
  recordingById: Map<
    string,
    { created_at: string; duration_seconds: number | null; customer_id: string | null; store_id: string | null }
  >
  customerNameById: Map<string, string>
  storeNameById: Map<string, string>
}> {
  const from = new Date(oldestDiscardMs - RECORDING_WINDOW_MARGIN_MS).toISOString()
  const to = new Date().toISOString()

  const [recordings, storeNameById] = await Promise.all([
    // ISO datetime strings on `from`/`to` — the shape the shipped 録音履歴 read
    // already sends core (lib/recordings/inbox-read.ts), not an assumption
    // about the validator.
    //
    // ponytail: page-capped at MAX_PAGES × 200 like every other read in this
    // file. The ceiling is real — a tenant whose oldest discard is a year old
    // asks for a year of recordings, and past 4,000 the window is only partly
    // read, so WHICH rows keep their detail depends on core's own sort order.
    // Rows the read misses degrade to nulls and say so on screen. Upgrade path
    // if a tenant ever reaches it: ask core for a session-id filter on
    // recordings.list (it has none today — only from/to/customer/store/staff),
    // which turns this whole window into one exact batch.
    paginateDedupe(
      (page) =>
        synqed.recordings
          .list({ from, to, page, page_size: PAGE_SIZE })
          .then((r) => ({ items: r.recordings, total: r.total })),
      MAX_PAGES,
    ).catch((err: unknown) => {
      // Shadowed by the outer guard at the call site — an empty recordings map
      // and a null context produce the SAME five nulls, and a mutation run
      // proved it (removing this catch fails nothing). Kept anyway: it names
      // WHICH read failed in the log, which is the difference between one
      // triage step and three, and it is the seam that stops being redundant
      // the moment a field arrives that does not hang off a recording.
      console.warn('[discard-reasons] recording detail degraded:', err)
      return []
    }),
    // `stores.list()` direct rather than the settings tree's listStores(): that
    // helper takes `ensurePrimary` (a lazy core WRITE, which has no business
    // behind a manager's read) and pulls two per-store COUNT reads this join
    // has no use for. Same one call it makes for the names themselves.
    synqed.stores
      .list()
      .then((r) => new Map(r.stores.map((s) => [s.id, s.name])))
      .catch((err: unknown) => {
        console.warn('[discard-reasons] store name fill degraded:', err)
        return new Map<string, string>()
      }),
  ])

  // Only the sessions the ledger actually names are kept: the window is a
  // date range over ALL recordings, and holding the rest would be a whole
  // tenant's session list in memory for nothing.
  const recordingById = new Map(recordings.filter((r) => sessionIds.has(r.id)).map((r) => [r.id, r]))

  // The maps rule (store-scope.ts): only the names these rows REFERENCE ever
  // leave core — an ids batch, never the customer roster.
  const customerIds = [
    ...new Set(
      [...recordingById.values()]
        .map((r) => r.customer_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]
  const customerNameById = new Map<string, string>()
  for (let i = 0; i < customerIds.length; i += PAGE_SIZE) {
    const chunk = customerIds.slice(i, i + PAGE_SIZE)
    try {
      // `include_deleted` because a customer removed since the discard is still
      // the customer that take was attached to — the audit viewer's own batch
      // resolves them the same way. Chunked to the page cap and caught PER
      // CHUNK: one bad id can fail its whole batch (#743), and dropping the
      // names it carried beats dropping every name on the screen.
      const { customers } = await synqed.customers.list({
        ids: chunk,
        include_deleted: true,
        page_size: PAGE_SIZE,
      })
      for (const c of customers) customerNameById.set(c.id, c.name)
    } catch (err: unknown) {
      console.warn('[discard-reasons] customer name fill degraded for one batch:', err)
    }
  }

  return { recordingById, customerNameById, storeNameById }
}

/** SynqedError's HTTP status, duck-typed — same reason as store-clamp.ts's own:
 *  a VALUE import of the SDK class pulls the ESM-only package into jest, and
 *  instanceof is fragile across module instances. A network TypeError has no
 *  numeric status, so it is correctly not an upstream answer. */
function upstreamStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/**
 * The 破棄の記録 list itself, on a CALLER-SUPPLIED client — the ONE body both
 * doors run (P-B, the 監査ログ precedent: listAuditLogWithClient). The web
 * action below resolves its client from the cookie identity; the facade route
 * (src/app/api/app/v1/recordings/discards) resolves it from the Bearer
 * identity. Neither can drift into a different list.
 *
 * ⚖ 8/25 ruling B travels with this body: the per-staff counts are plain
 * labelled facts, and past the page cap they are FLOORS — `truncated` says so
 * rather than letting a short number pass as a total.
 *
 * THROWS on failure, deliberately: an upstream blip must never reach a caller
 * as an empty ledger. Each door maps the throw into its own contract (the web
 * action's `{ ok:false, error:'failed' }`, the route's facade error status).
 */
export async function listDiscardReasonsWithClient(
  synqed: ReturnType<typeof newSynqedClient>,
  businessId: string,
): Promise<{ rows: DiscardReasonRow[]; counts: DiscardReasonCounts; truncated: boolean }> {
  // SYSTEM rows are cleanup bookkeeping with no reason and no human behind
  // them (spec §3.7) — this screen is about what STAFF wrote.
  const events = []
  let truncated = false
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await synqed.recordingDiscards.list({
      source: 'STAFF',
      page,
      page_size: PAGE_SIZE,
    })
    const batch = res?.events ?? []
    events.push(...batch)
    if (batch.length === 0 || events.length >= (res?.total ?? 0)) break
    if (page === MAX_PAGES) truncated = true
  }

  // Names join at read time: rows store ids only, and these are business-wide
  // while the caller's own roster array may be store-clamped. Degrades to
  // "name unknown" rather than failing the whole read.
  //
  // TWO ID SPACES, and the ledger holds the one karute does not use. Core
  // normalises `discarded_by` to the synqed staff CARD id on write, while
  // `staffListByBusinessOrThrow` is Supabase PROFILES keyed by login uuid —
  // so a profiles-only map matched nothing and every row read 担当者不明.
  // The map is therefore keyed by BOTH: the card id (what rows actually
  // carry) and the profile id (kept so any odd historical row still names).
  // The recording behind each row joins in the SAME pass as the names, on the
  // same best-effort terms. Skipped entirely on an empty ledger: there is
  // nothing to enrich, and a business with no discards should pay no reads for
  // the screen that says so.
  const usable = events.filter((e) => e?.id && e.reason)
  const oldestDiscardMs = usable.length
    ? Math.min(...usable.map((e) => Date.parse(e.created_at)).filter((n) => Number.isFinite(n)))
    : NaN

  const [roster, cards, context] = await Promise.all([
    staffListByBusinessOrThrow(businessId).catch((err: unknown) => {
      console.warn('[discard-reasons] staff name fill degraded:', err)
      return [] as Awaited<ReturnType<typeof staffListByBusinessOrThrow>>
    }),
    // Already graceful by contract — [] on any failure, never a throw.
    synqedStaffCardsForBusiness(businessId),
    Number.isFinite(oldestDiscardMs)
      ? // The enrichment's OUTER guard, and the one that actually enforces the
        // law: each read inside catches its own failure, but a client missing a
        // resource entirely throws before any of those catches can attach. One
        // guard here covers every path in — including any read added later —
        // so the answer to "the ledger is readable but the detail is not" is
        // always the ledger, never nothing.
        readDiscardRecordingContext(
          synqed,
          new Set(usable.map((e) => e.recording_session_id)),
          oldestDiscardMs,
        ).catch((err: unknown) => {
          console.warn('[discard-reasons] recording context degraded:', err)
          return null
        })
      : null,
  ])
  // A BLANK profile name is not a name. `'' ?? card.name` is `''`, so a
  // linked card whose profile carries an empty (or whitespace-only)
  // full_name lost the card's own name too and read 担当者不明 on a row we
  // could have named honestly. Normalised here, at the one place the profile
  // side is built, so both the card fallback below and the profile-keyed
  // rows get the same answer.
  const profileNames = new Map<string, string | null>(
    roster.map((s) => [s.id, s.full_name?.trim() ? s.full_name : null]),
  )
  const nameById = new Map(profileNames)
  for (const card of cards) {
    // The profile's own full_name when the card is linked — that is the name
    // the rest of karute shows. Else the card's own name, so a departed or
    // unlinked staffer is still named honestly instead of erased. Read from
    // `profileNames`, never from the map being written, so the answer cannot
    // depend on roster order.
    const name = (card.user_id ? profileNames.get(card.user_id) : null) ?? card.name
    if (name) nameById.set(card.id, name)
  }

  const rows: DiscardReasonRow[] = usable
    .map((e) => {
      const rec = context?.recordingById.get(e.recording_session_id) ?? null
      const customerId = rec?.customer_id ?? null
      return {
        id: e.id,
        recordingSessionId: e.recording_session_id,
        createdAt: e.created_at,
        staffId: e.discarded_by ?? null,
        staffName: (e.discarded_by ? nameById.get(e.discarded_by) : null) ?? null,
        reason: e.reason as string,
        customerId,
        // A customer whose name the batch could not resolve keeps its ID and
        // loses only the name — the same honest split the staff join makes.
        customerName: (customerId ? context?.customerNameById.get(customerId) : null) ?? null,
        recordingCreatedAt: rec?.created_at ?? null,
        durationSeconds: rec?.duration_seconds ?? null,
        storeName: (rec?.store_id ? context?.storeNameById.get(rec.store_id) : null) ?? null,
      }
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  const monthFloor = startOfThisMonth(new Date())
  const thisMonthRows = rows.filter((r) => Date.parse(r.createdAt) >= monthFloor)

  const perStaff = new Map<string, { staffName: string | null; thisMonth: number }>()
  for (const r of thisMonthRows) {
    if (!r.staffId) continue
    const seen = perStaff.get(r.staffId)
    if (seen) seen.thisMonth += 1
    else perStaff.set(r.staffId, { staffName: r.staffName, thisMonth: 1 })
  }

  return {
    rows,
    truncated,
    counts: {
      thisMonth: thisMonthRows.length,
      total: rows.length,
      byStaff: [...perStaff.entries()]
        .map(([staffId, v]) => ({ staffId, ...v }))
        .sort((a, b) => b.thisMonth - a.thisMonth),
    },
  }
}

/** The WEB door onto the twin above: the cookie identity's `staff.manage`
 *  gate, its business id, and the ok/error union the section branches on. */
export async function listDiscardReasons(): Promise<ListDiscardReasonsResult> {
  try {
    const caps = await getMyCapabilities()
    ensureCapability(caps, 'staff.manage')
  } catch {
    return { ok: false, error: 'forbidden' }
  }

  try {
    const businessId = await getBusinessId()
    if (!businessId) return { ok: false, error: 'forbidden' }
    const synqed = newSynqedClient(businessId)
    return { ok: true, ...(await listDiscardReasonsWithClient(synqed, businessId)) }
  } catch (err) {
    console.warn('[discard-reasons] list failed:', err)
    return { ok: false, error: 'failed' }
  }
}

export type GetDiscardTranscriptResult =
  | {
      ok: true
      /** Empty when the discard kept no words — see the three states A2-4
       *  renders. `durationSeconds` is what separates "the recording was under
       *  the floor" from "there is simply no transcript". */
      segments: {
        text: string
        /** Seconds into the recording. REQUIRED on core's segment and so never
         *  null out of the twin below — nullable HERE because the thin port
         *  satisfies this same union and an older deployment answers without
         *  it, in which case the panel simply shows no 5-minute markers rather
         *  than computing them from a missing number. */
        startTime: number | null
      }[]
      durationSeconds: number | null
    }
  | { ok: false; error: 'forbidden' | 'failed' }

/**
 * A2-4 — the words behind ONE discard row, on a CALLER-SUPPLIED client. Same
 * P-B shape as listDiscardReasonsWithClient above: the ONE body the web action
 * and the facade route (…/recordings/discards/transcript) share.
 *
 * ⚖ 8/25 ruling A: the written reason is the staffer's CLAIM, and this is what
 * a manager checks it against. The lazy per-row read is why it is a separate
 * call (the list screen must not pay an N+1 for text nobody has opened).
 *
 * Missing pieces degrade to nulls rather than failing the read — a discard from
 * before A2-2, a consent-refused take and a swept session row are all legitimate
 * "no words" answers, and the section says so honestly instead of guessing. A
 * read that FAILED is not one of them: it THROWS, and each door reports that it
 * could not look — never empty segments.
 *
 * SCOPE, deliberately: this reads segments for ANY session id a `staff.manage`
 * caller names. That equals the discard doctrine's intent only because the A2-2
 * actions are the sole writers of segments in this repo — a kept recording's
 * transcript lives on its karute record, never here. Any FUTURE segments writer
 * puts other recordings' words behind this gate and must revisit the scope.
 */
export async function getDiscardTranscriptWithClient(
  synqed: ReturnType<typeof newSynqedClient>,
  recordingSessionId: string,
): Promise<{ segments: { text: string; startTime: number }[]; durationSeconds: number | null }> {
  const [segments, recording] = await Promise.all([
    // A FAILED READ IS NOT AN ABSENCE. A blanket catch here answered
    // `{ok:true, segments:[]}` for a 500, a timeout or a mid-deploy blip, and
    // the section printed 「文字起こしはありません」 — a claim about the words
    // on a screen whose whole job is checking a staffer's claim. Only core's
    // own "there is no such recording" (404 — a swept session row, one of the
    // legitimate no-words populations in the docstring above) is an answer;
    // everything else propagates and the section says it could not look.
    synqed.recordings
      .listSegments(recordingSessionId)
      .then((r) => r?.segments ?? [])
      .catch((err: unknown) => {
        if (upstreamStatus(err) === 404) return []
        throw err
      }),
    // Metadata stays best-effort: a duration we cannot read costs the
    // below-floor distinction, never the honesty of the words themselves.
    synqed.recordings.get(recordingSessionId).catch(() => null),
  ])

  return {
    segments: segments
      .sort((a, b) => a.segment_index - b.segment_index)
      // `start_time` is a REQUIRED number on core's segment (SDK 1.28.0), which
      // is what lets the panel place its 5-minute markers at all. Carried
      // through as-is — the sort key stays segment_index, because that is the
      // order the words were written in and a clock is not a guarantee of it.
      .map((s) => ({ text: s.text, startTime: s.start_time }))
      .filter((s) => !!s.text?.trim()),
    durationSeconds: recording?.duration_seconds ?? null,
  }
}

/** The WEB door onto the twin above — same `staff.manage` gate as the list,
 *  enforced server-side, and the same ok/error union the section branches on. */
export async function getDiscardTranscript(
  recordingSessionId: string,
): Promise<GetDiscardTranscriptResult> {
  try {
    const caps = await getMyCapabilities()
    ensureCapability(caps, 'staff.manage')
  } catch {
    return { ok: false, error: 'forbidden' }
  }

  try {
    const businessId = await getBusinessId()
    if (!businessId) return { ok: false, error: 'forbidden' }
    const synqed = newSynqedClient(businessId)
    return { ok: true, ...(await getDiscardTranscriptWithClient(synqed, recordingSessionId)) }
  } catch (err) {
    console.warn('[discard-reasons] transcript read failed:', err)
    return { ok: false, error: 'failed' }
  }
}

/**
 * The staffer's OWN discard count for the current month (⚖ 8/25 ruling B, the
 * staff half): everyone can see their own number, and only their own.
 *
 * No capability gate on purpose — this is self-knowledge, and Liam's ruling is
 * that the count must never be the thing that makes someone hesitate to discard
 * a recording they should discard. It is a labelled fact next to their own
 * history, not a score anyone else reads here.
 */
export async function myDiscardCountThisMonth(): Promise<number | null> {
  try {
    const businessId = await getBusinessId()
    const staffId = await getCurrentUserStaffId()
    if (!businessId || !staffId) return null
    const synqed = newSynqedClient(businessId)

    // EVERY id this viewer is known by. `staffId` is the login uuid, but core
    // stamps the staff CARD id onto every ledger row — matching on the uuid
    // alone counted zero of the viewer's own discards.
    //
    // Resolved by FILTERING the cached card roster, never by a resolver, for
    // two reasons. (1) This read carries NO capability gate at all — it is
    // self-knowledge by ⚖ ruling — so nothing reachable from it may write.
    // `lookupSynqedStaffIdForBusiness` looks read-only and is not: on an
    // email-only match it fires a core `staff.update` self-heal, which put a
    // core WRITE behind a gate-free read. (2) It answers with the FIRST
    // matching card and stops, so a viewer linked from TWO cards (a re-invite,
    // a store move, an import) had half their own month missing. Both cured by
    // taking all of them. `synqedStaffCardsForBusiness` is [] on any failure by
    // contract, which simply leaves today's uuid-only count — never a null.
    const cards = await synqedStaffCardsForBusiness(businessId)
    const myIds = new Set<string>([staffId])
    for (const card of cards) if (card.user_id === staffId) myIds.add(card.id)

    const monthFloor = startOfThisMonth(new Date())
    let mine = 0
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await synqed.recordingDiscards.list({
        source: 'STAFF',
        page,
        page_size: PAGE_SIZE,
      })
      const batch = res?.events ?? []
      for (const e of batch) {
        const isMine = !!e?.discarded_by && myIds.has(e.discarded_by)
        if (isMine && Date.parse(e.created_at) >= monthFloor) mine += 1
      }
      if (batch.length === 0 || page * PAGE_SIZE >= (res?.total ?? 0)) break
      // Past the cap the ledger was only partly read, so `mine` is a FLOOR and
      // not the count. Same rule as the catch below: a number we cannot back is
      // not shown at all — the header renders nothing on null.
      if (page === MAX_PAGES) return null
    }
    return mine
  } catch (err) {
    // A count that cannot be read is simply not shown — never a zero, which
    // would be a claim ("you discarded nothing") we cannot make.
    console.warn('[discard-reasons] own count failed:', err)
    return null
  }
}

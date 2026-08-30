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
import {
  lookupSynqedStaffIdForBusiness,
  synqedStaffCardsForBusiness,
} from '@/lib/synqed/staff-map'

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

function startOfThisMonth(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

/** SynqedError's HTTP status, duck-typed — same reason as store-clamp.ts's own:
 *  a VALUE import of the SDK class pulls the ESM-only package into jest, and
 *  instanceof is fragile across module instances. A network TypeError has no
 *  numeric status, so it is correctly not an upstream answer. */
function upstreamStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

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
    const [roster, cards] = await Promise.all([
      staffListByBusinessOrThrow(businessId).catch((err: unknown) => {
        console.warn('[discard-reasons] staff name fill degraded:', err)
        return [] as Awaited<ReturnType<typeof staffListByBusinessOrThrow>>
      }),
      // Already graceful by contract — [] on any failure, never a throw.
      synqedStaffCardsForBusiness(businessId),
    ])
    const profileNames = new Map(roster.map((s) => [s.id, s.full_name]))
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

    const rows: DiscardReasonRow[] = events
      .filter((e) => e?.id && e.reason)
      .map((e) => ({
        id: e.id,
        recordingSessionId: e.recording_session_id,
        createdAt: e.created_at,
        staffId: e.discarded_by ?? null,
        staffName: (e.discarded_by ? nameById.get(e.discarded_by) : null) ?? null,
        reason: e.reason as string,
      }))
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
      ok: true,
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
      segments: { text: string }[]
      durationSeconds: number | null
    }
  | { ok: false; error: 'forbidden' | 'failed' }

/**
 * A2-4 — the words behind ONE discard row, read on open.
 *
 * ⚖ 8/25 ruling A: the written reason is the staffer's CLAIM, and this is what
 * a manager checks it against. Same `staff.manage` gate as the list above,
 * enforced server-side; the lazy per-row read is why it is a separate action
 * (the list screen must not pay an N+1 for text nobody has opened).
 *
 * Missing pieces degrade to nulls rather than failing the read — a discard from
 * before A2-2, a consent-refused take and a swept session row are all legitimate
 * "no words" answers, and the section says so honestly instead of guessing. A
 * read that FAILED is not one of them: it answers `ok:false` and the section
 * says it could not look (see the catch below).
 *
 * SCOPE, deliberately: this reads segments for ANY session id a `staff.manage`
 * caller names. That equals the discard doctrine's intent only because the A2-2
 * actions are the sole writers of segments in this repo — a kept recording's
 * transcript lives on its karute record, never here. Any FUTURE segments writer
 * puts other recordings' words behind this gate and must revisit the scope.
 */
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
      ok: true,
      segments: segments
        .sort((a, b) => a.segment_index - b.segment_index)
        .map((s) => ({ text: s.text }))
        .filter((s) => !!s.text?.trim()),
      durationSeconds: recording?.duration_seconds ?? null,
    }
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

    // The viewer's OTHER id. `staffId` is the login uuid, but core stamps the
    // staff CARD id onto every ledger row — matching on the uuid alone counted
    // zero of the viewer's own discards. NO-CREATE lookup on purpose (the
    // resolve* twins mint a staff record on a miss, which a read must never
    // do); null is tolerated and simply leaves today's uuid-only behaviour.
    const cardId = await lookupSynqedStaffIdForBusiness(staffId, businessId).catch(
      (err: unknown) => {
        console.warn('[discard-reasons] own card-id lookup degraded:', err)
        return null
      },
    )

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
        const isMine = e?.discarded_by === staffId || (!!cardId && e?.discarded_by === cardId)
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

// R8 fix round 1 (§2 / L1): resolveDiscardFacts lifted out of
// src/actions/recording-discards.ts, a 'use server' module. Every export of a
// 'use server' file becomes a callable server reference — this function takes
// a caller-supplied businessId and no capability/session gate of its own (it
// is deliberately ungated: callers invoke it only for a karute already known
// to be DISCARDED and only after the viewer is confirmed allowed to open it),
// so leaving it in the action namespace exposed a latent server action id.
// This is a plain module — no 'use server' directive — so it creates no
// server reference at all. Body, signature and degrade posture unchanged.

import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import {
  synqedStaffCardsForBusiness,
  staffNameByIdAcrossCardsAndProfiles,
} from '@/lib/synqed/staff-map'

/** Core rejects a page_size above 200 on this family (the recordings/karute
 *  validator, verified 2026-08-25 — see lib/recordings/inbox-read.ts's note).
 *  It does NOT clamp; it 400s. (recording-discards.ts's own PAGE_SIZE is
 *  module-private, so this is the same constant, not a shared import.) */
const PAGE_SIZE = 200
/** Fix round 2 (Greptile #909, finding 3): the SDK exposes no sort and server
 *  order is not a contract, so a session with more than one page of STAFF
 *  discard events could show a stale reason/actor/time. Page to completion
 *  before sorting. 5 pages is a runaway guard, not an expected size — a
 *  single session cannot honestly carry 1,000 staff discard events. */
const MAX_PAGES = 5

/**
 * R8 discarded-record door (⚖ Liam 2026-09-13, A6/A7) — the facts block's own
 * reads, on a CALLER-SUPPLIED client (web: cookie; facade: Bearer), so BOTH
 * doors call the SAME body and never derive a different set of facts. Reuses
 * the SAME lifted name-join (staffNameByIdAcrossCardsAndProfiles) the manager
 * ledger read (recording-discards.ts) uses — one home, not two implementations.
 *
 * NEVER throws: every read inside degrades independently, and the whole
 * function degrades to all-null fields on any unexpected failure (D-8 photos
 * posture — an accessory read that blipped must cost a FACT, never the
 * screen). Callers invoke this ONLY for a karute already known to be
 * DISCARDED (and only after the viewer is confirmed allowed to open it) —
 * this function does not itself gate anything.
 */
export async function resolveDiscardFacts(
  synqed: Pick<ReturnType<typeof newSynqedClient>, 'recordingDiscards'>,
  businessId: string,
  opts: { recordingSessionId: string | null; recordStaffId: string | null },
): Promise<{
  discardLedger: { reason: string | null; discardedByName: string | null; discardedAt: string | null } | null
  recordStaffName: string | null
}> {
  const degraded = { discardLedger: null, recordStaffName: null }
  try {
    const [roster, cards] = await Promise.all([
      staffListByBusinessOrThrow(businessId).catch((err: unknown) => {
        console.warn('[resolveDiscardFacts] staff name fill degraded:', err)
        return [] as Awaited<ReturnType<typeof staffListByBusinessOrThrow>>
      }),
      // Already graceful by contract — [] on any failure, never a throw.
      synqedStaffCardsForBusiness(businessId),
    ])
    const nameById = staffNameByIdAcrossCardsAndProfiles(roster, cards)
    const recordStaffName = opts.recordStaffId
      ? (nameById.get(opts.recordStaffId) ?? null)
      : null

    if (!opts.recordingSessionId) return { discardLedger: null, recordStaffName }

    const events: NonNullable<Awaited<ReturnType<typeof synqed.recordingDiscards.list>>>['events'] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await synqed.recordingDiscards.list({
        recording_session_id: opts.recordingSessionId,
        source: 'STAFF',
        page,
        page_size: PAGE_SIZE,
      })
      const batch = res?.events ?? []
      events.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }
    const newest = events
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
    const discardLedger = newest
      ? {
          reason: newest.reason ?? null,
          discardedByName: newest.discarded_by ? (nameById.get(newest.discarded_by) ?? null) : null,
          discardedAt: newest.created_at ?? null,
        }
      : null
    return { discardLedger, recordStaffName }
  } catch (err) {
    console.warn('[resolveDiscardFacts] degraded — the facts block shows what it can:', err)
    return degraded
  }
}

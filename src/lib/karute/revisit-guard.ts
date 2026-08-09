import 'server-only'
import type { SynqedClient } from '@synqed-kk/client'
import { isReturningCustomer } from '@/lib/customers/status-signals'

/**
 * Server-side eligibility for the `'revisit'` outcome (Greptile #689).
 *
 * The 「既存のお客様（通常ご来店）」 card is gated in the dialog, but the UI is
 * not a trust boundary: any authenticated client could POST `status:'revisit'`
 * for a first-visit prospect and quietly excuse them from the closing-rate
 * denominator. This re-derives the same truth the screen does, server-side.
 *
 * SAME SIGNAL SET as the record screen's own gate (record-screen.ts, the
 * `targetReturning` derivation) — deliberately identical, because a narrower
 * server rule would 400 saves the UI legitimately offered. A QuickReserve
 * regular with visit_count 0 but a live 6回券 is returning on both sides or
 * neither.
 *
 * FAIL-CLOSED: every read is caught to a no-signal value, and `isReturningCustomer`
 * ORs its signals — so an unreadable customer, an unreachable core, or a
 * genuinely new prospect all land on `false`. Unknown is never returning,
 * mirroring resolveReturningForOutcome's UNKNOWN → hidden on the client.
 *
 * Reads go straight through the passed client rather than the `*WithClient`
 * helpers in lib/customers/queries + lib/packs/store: those pull the ESM SDK
 * into every module graph that reaches an outcome write, and this needs three
 * raw fields, not their mapped view-models (their redemption-count join is
 * pure waste here — the raw pack row already carries status + kind).
 */
export type RevisitGuardClient = Pick<SynqedClient, 'customers' | 'packs' | 'karuteRecords'>

/**
 * WHICH karute record belongs to the session being decided — it must not count
 * as its own proof of prior history (delta-verify, 2026-08-10).
 *
 * Every outcome write happens AFTER that session's record exists: the facade
 * save creates it, then writes the outcome; processJob upserts, then writes the
 * outcome; an enqueued retake converges on take-1's record by recording session.
 * So an unfiltered `karuteRecords.list(...).length` counts the very record this
 * save just produced, and a first-visit prospect proves they're a regular using
 * a record they created one line earlier — the guard passes vacuously on exactly
 * the boundary it exists to defend.
 *
 * No default and no optional field: each boundary must SAY what it excludes, so
 * a new caller cannot inherit a silent do-nothing.
 */
export type RevisitExclusion =
  /** Chokepoint — the record is already written, so exclude it by exact id. */
  | { karuteRecordId: string }
  /** Enqueue — no record id exists yet, but a retake reuses the recording
   *  session, and core links the record to it (KaruteRecord.recording_session_id,
   *  live on the list rows the detail screen already reads). */
  | { recordingSessionId: string }

export async function isReturningCustomerServerSide(
  synqed: RevisitGuardClient,
  customerId: string,
  exclude: RevisitExclusion,
): Promise<boolean> {
  const isOwnSession = (row: { id: string; recording_session_id?: string | null }) =>
    'karuteRecordId' in exclude
      ? row.id === exclude.karuteRecordId
      : row.recording_session_id === exclude.recordingSessionId
  const [customer, hasActivePack, otherKaruteCount] = await Promise.all([
    synqed.customers.get(customerId).catch(() => null),
    synqed.packs
      .listPacks(customerId)
      .then((packs) => packs.some((p) => p.status === 'active' && p.kind === 'pack'))
      .catch(() => false),
    // page_size 3, not 1: this feeds a `> 0` test, but the session's OWN record
    // is in the list and gets filtered out, so one row of headroom is not
    // enough to see a genuine prior record behind it.
    synqed.karuteRecords
      .list({ customer_id: customerId, page_size: 3 })
      .then((r) => (r.karute_records ?? []).filter((row) => !isOwnSession(row)).length)
      .catch(() => 0),
  ])

  return isReturningCustomer({
    joinDateIso: null,
    lastVisitIso: null,
    isExistingCustomer: customer?.is_existing_customer,
    visitCount: customer?.visit_count,
    // OTHER sessions only — never this one (see RevisitExclusion).
    karuteCount: otherKaruteCount,
    // Both halves, exactly as the screen does it: has_ticket_pack is the QR
    // cache field (stale/absent for an in-app purchase), the live list is the
    // authority for a pack bought minutes ago at the 結果 dialog.
    hasTicketPack: (customer?.has_ticket_pack ?? false) || hasActivePack,
  })
}

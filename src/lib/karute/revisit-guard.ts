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
 * TRI-STATE, because fail-closed has a flip side. A read that FAILS is not
 * evidence of a first-time visitor — collapsing both to `false` means a core
 * blip silently drops an HONEST returning customer's label. So:
 *   'returning'     — some successful read produced a true signal. OR-semantics
 *                     are preserved: one true signal wins even if others failed.
 *   'not_returning' — every read succeeded and the verdict is genuinely false.
 *                     Deterministic; no retry can change it.
 *   'unknown'       — at least one read failed and nothing that succeeded was
 *                     true. We do not know, and must not pretend either way.
 * Failed reads get ONE cheap in-request retry before 'unknown' is declared;
 * most transients recover inside it.
 *
 * How callers must treat 'unknown' depends on whether anything is already
 * persisted, and the two answers are opposites:
 *   PRE-persist (enqueue, the edit PUT) — nothing was written, so failing
 *     honestly is free and correct: surface a RETRYABLE upstream error, never
 *     a validation 400, which would blame the client for our infra.
 *   POST-persist (the save paths, the worker) — the karute already exists.
 *     Deliberate, documented FAIL-OPEN: write the label and warn loudly. The
 *     dialog's own gate is server-derived from the brief, so the client is not
 *     the authority being trusted here; and an attacker cannot induce core read
 *     failures on demand, so this opens no practical bypass. Silently losing an
 *     honest label after a durable save is the worse harm. This applies ONLY to
 *     infra failure — 'not_returning' still drops the label.
 *
 * Reads go straight through the passed client rather than the `*WithClient`
 * helpers in lib/customers/queries + lib/packs/store: those pull the ESM SDK
 * into every module graph that reaches an outcome write, and this needs three
 * raw fields, not their mapped view-models (their redemption-count join is
 * pure waste here — the raw pack row already carries status + kind).
 */
export type RevisitGuardClient = Pick<SynqedClient, 'customers' | 'packs' | 'karuteRecords'>

/** The three customer fields the derivation reads. */
type CustomerSignals = {
  is_existing_customer?: boolean
  visit_count?: number
  has_ticket_pack?: boolean
}

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

export type RevisitEligibility = 'returning' | 'not_returning' | 'unknown'

/** A settled read: we distinguish "read said no" from "read never answered". */
type Read<T> = { ok: true; value: T } | { ok: false }
const settle = <T>(p: Promise<T>): Promise<Read<T>> =>
  p.then((value) => ({ ok: true as const, value })).catch(() => ({ ok: false as const }))

export async function isReturningCustomerServerSide(
  synqed: RevisitGuardClient,
  customerId: string,
  exclude: RevisitExclusion,
): Promise<RevisitEligibility> {
  const isOwnSession = (row: { id: string; recording_session_id?: string | null }) =>
    'karuteRecordId' in exclude
      ? row.id === exclude.karuteRecordId
      : row.recording_session_id === exclude.recordingSessionId

  type Reads = [Read<CustomerSignals>, Read<boolean>, Read<number>]
  // Re-runs ONLY the reads that failed; a successful one is passed through
  // untouched, so the retry costs at most what actually broke.
  const gather = async (prev?: Reads): Promise<Reads> =>
    Promise.all([
      prev?.[0].ok
        ? prev[0]
        : settle(synqed.customers.get(customerId) as Promise<CustomerSignals>),
      prev?.[1].ok
        ? prev[1]
        : settle(
            synqed.packs
              .listPacks(customerId)
              .then((packs) => packs.some((p) => p.status === 'active' && p.kind === 'pack')),
          ),
      prev?.[2].ok
        ? prev[2]
        : settle(
            // page_size 3, not 1: this feeds a `> 0` test, but the session's OWN
            // record is in the list and gets filtered out, so one row of headroom
            // is not enough to see a genuine prior record behind it.
            synqed.karuteRecords
              .list({ customer_id: customerId, page_size: 3 })
              .then((r) => (r.karute_records ?? []).filter((row) => !isOwnSession(row)).length),
          ),
    ])

  // Signals from the reads that SUCCEEDED. A failed read contributes nothing
  // rather than a falsy value, so it can never masquerade as a negative.
  const verdict = ([customer, pack, count]: Reads): boolean =>
    isReturningCustomer({
      joinDateIso: null,
      lastVisitIso: null,
      isExistingCustomer: customer.ok ? customer.value.is_existing_customer : undefined,
      visitCount: customer.ok ? customer.value.visit_count : undefined,
      // OTHER sessions only — never this one (see RevisitExclusion).
      karuteCount: count.ok ? count.value : undefined,
      // Both halves, exactly as the screen does it: has_ticket_pack is the QR
      // cache field (stale/absent for an in-app purchase), the live list is the
      // authority for a pack bought minutes ago at the 結果 dialog.
      hasTicketPack:
        (customer.ok ? customer.value.has_ticket_pack : false) || (pack.ok ? pack.value : false),
    })

  let reads = await gather()
  // A true signal already answers the question — never spend a retry on it.
  if (!verdict(reads) && reads.some((r) => !r.ok)) reads = await gather(reads)

  if (verdict(reads)) return 'returning'
  return reads.every((r) => r.ok) ? 'not_returning' : 'unknown'
}

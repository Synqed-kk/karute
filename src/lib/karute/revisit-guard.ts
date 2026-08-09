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

export async function isReturningCustomerServerSide(
  synqed: RevisitGuardClient,
  customerId: string,
): Promise<boolean> {
  const [customer, hasActivePack, karuteCount] = await Promise.all([
    synqed.customers.get(customerId).catch(() => null),
    synqed.packs
      .listPacks(customerId)
      .then((packs) => packs.some((p) => p.status === 'active' && p.kind === 'pack'))
      .catch(() => false),
    // page_size 1 — this only ever feeds a `> 0` test, so never pull the
    // screen's ten rows just to read `.length`.
    synqed.karuteRecords
      .list({ customer_id: customerId, page_size: 1 })
      .then((r) => r.karute_records?.length ?? 0)
      .catch(() => 0),
  ])

  return isReturningCustomer({
    joinDateIso: null,
    lastVisitIso: null,
    isExistingCustomer: customer?.is_existing_customer,
    visitCount: customer?.visit_count,
    karuteCount,
    // Both halves, exactly as the screen does it: has_ticket_pack is the QR
    // cache field (stale/absent for an in-app purchase), the live list is the
    // authority for a pack bought minutes ago at the 結果 dialog.
    hasTicketPack: (customer?.has_ticket_pack ?? false) || hasActivePack,
  })
}

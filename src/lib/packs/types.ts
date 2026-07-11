// 回数券 (ticket-pack) domain types — mirrors supabase/migrations/
// 20260610000000_ticket_packs.sql. synqed ids are opaque strings.

export type PackKind = 'pack' | 'subscription' | 'single'
// 'backfill' is pack_redemptions-only (the 未処理来店 reconcile fix writes it;
// the ticket_packs check constraint deliberately does NOT accept it).
export type PackSource = 'manual' | 'import' | 'qr' | 'pos' | 'backfill'
export type PackStatus = 'active' | 'exhausted' | 'cancelled'
export type LifecycleStatus = 'active' | 'graduated' | 'lost'

export interface TicketPack {
  id: string
  customer_id: string
  kind: PackKind
  pack_size: number
  unit_price: number
  total_price: number | null
  purchase_round: number
  purchased_at: string | null
  source: PackSource
  status: PackStatus
  notes: string | null
}

export interface PackRedemption {
  id: string
  pack_id: string
  customer_id: string
  redeemed_on: string
  appointment_id: string | null
  karute_record_id: string | null
}

/** A pack joined with its consumption — what every surface renders.
 *  remaining/unconsumedValue are COMPUTED here, once (single source). */
export interface PackWithUsage extends TicketPack {
  redeemedCount: number
  /** pack_size − redeemedCount, floored at 0. */
  remaining: number
  /** remaining × unit_price (yen) — the 消化残高. */
  unconsumedValue: number
  /** Latest redeemed_on (yyyy-mm-dd) — drives the 使い切り day counter. */
  lastRedeemedOn: string | null
}

export interface CustomerLifecycle {
  customer_id: string
  status: LifecycleStatus
  referral: boolean
}

/** Next 購入回数 for a NEW pack: highest STORED round + 1, never a row count.
 *  The imports collapsed history to one row per customer (a round-4 regular
 *  has 1 row), so COUNT-based numbering relabels regulars 初回. The stored
 *  purchase_round carries the truth the sheet loaded. */
export function nextPurchaseRound(packs: ReadonlyArray<Pick<TicketPack, 'kind' | 'purchase_round'>>): number {
  const rounds = packs
    .filter((p) => p.kind === 'pack')
    // Legacy app-created packs stored 0-based rounds — read 0 as round 1 so
    // the follow-up purchase becomes 2, not a second 初回.
    .map((p) => Math.max(p.purchase_round, 1))
  return rounds.length === 0 ? 1 : Math.max(...rounds) + 1
}

/** Compute usage for a pack from its redemption count — the ONE place the
 *  残回数/消化残高 math lives. Every surface goes through this. */
export function withUsage(
  pack: TicketPack,
  redeemedCount: number,
  lastRedeemedOn: string | null = null,
): PackWithUsage {
  const remaining = Math.max(0, pack.pack_size - redeemedCount)
  return {
    ...pack,
    redeemedCount,
    remaining,
    unconsumedValue: remaining * pack.unit_price,
    lastRedeemedOn,
  }
}

// 回数券 (ticket-pack) domain types — mirrors supabase/migrations/
// 20260610000000_ticket_packs.sql. synqed ids are opaque strings.

export type PackKind = 'pack' | 'subscription' | 'single'
export type PackSource = 'manual' | 'import' | 'qr' | 'pos'
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
}

export interface CustomerLifecycle {
  customer_id: string
  status: LifecycleStatus
  referral: boolean
}

/** Compute usage for a pack from its redemption count — the ONE place the
 *  残回数/消化残高 math lives. Every surface goes through this. */
export function withUsage(pack: TicketPack, redeemedCount: number): PackWithUsage {
  const remaining = Math.max(0, pack.pack_size - redeemedCount)
  return {
    ...pack,
    redeemedCount,
    remaining,
    unconsumedValue: remaining * pack.unit_price,
  }
}

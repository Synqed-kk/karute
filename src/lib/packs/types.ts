// 回数券 (ticket-pack) domain types — mirrors supabase/migrations/
// 20260610000000_ticket_packs.sql. synqed ids are opaque strings.

export type PackKind = 'pack' | 'subscription' | 'single'
// 'backfill' is pack_redemptions-only (the 未処理来店 reconcile fix writes it;
// the ticket_packs check constraint deliberately does NOT accept it).
// 'auto' = the 自動消化 cron (packet 11). Core stores `source` verbatim
// (packs.service.ts addRedemption: `source: input.source ?? 'manual'`), so
// widening this union needs no core or schema change.
export type PackSource = 'manual' | 'import' | 'qr' | 'pos' | 'backfill' | 'auto'
// 'void' = CORE-12 (core PR #86, deployed; docs/pack-corrections.md) — a
// status UPDATE, never a delete; active-pack reads omit it, history stays.
// This is a PACK status only — the redemption-row `source` vocabulary
// 'recovery'/'correction' CORE-12 also adds is a DIFFERENT field this repo
// does not type at all (no app-api DTO parses a redemption row; see
// customer-profile-screen-dto.ts's PackWithUsageSchema.source, which is
// unrelated) — never conflate the two.
export type PackStatus = 'active' | 'exhausted' | 'cancelled' | 'void'
// UPDATE 26 fix round 1 (X2, lens F2): a READ-side-only widening. Core has
// shipped exactly 4 statuses; a 5th one the DTO cannot recognize must stay
// honestly unknown, never be claimed as 'void' (the old `.catch('void')`
// rendered a definite 「無効」 for a pack whose real state nobody here knows).
// PackStatus itself — the WRITE type (setPackStatusAction, updatePackStatus,
// the ticket_packs check constraint) — is UNTOUCHED; only the type a READER
// (PackWithUsage, the DTO) may carry gains 'unknown'.
export type PackStatusRead = PackStatus | 'unknown'
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
 *  remaining/unconsumedValue are COMPUTED here, once (single source).
 *  status is READ-widened to PackStatusRead (X2, fix round 1) — the DTO's
 *  fail-safe can degrade an unrecognized future status to 'unknown' here;
 *  TicketPack itself (the WRITE shape) keeps the narrower PackStatus. */
export interface PackWithUsage extends Omit<TicketPack, 'status'> {
  status: PackStatusRead
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
 *  purchase_round carries the truth the sheet loaded.
 *
 *  回数券 update 25, p3 — counts only REAL PURCHASES: an ALLOW-list
 *  (status === 'active' || 'exhausted'), so a 'cancelled' row and a 'void'
 *  one (CORE-12, now on this repo's PackStatus union — update 26) are both
 *  excluded without naming 'void' here; the ALLOW-list already keeps
 *  excluding anything that isn't active/exhausted. A
 *  cancelled/voided pack was never a real purchase — the customer's next
 *  genuine buy should renumber as if it never happened (docs/
 *  store-transfer-design.md §7.4's own pending fix: "nextRound counts
 *  cancelled packs toward the next round — a voided first pack can produce
 *  a 2枚目 label"). Takes PackStatusRead (not PackStatus) so the caller's
 *  PackWithUsage[] (X2 widened status) still passes straight through — the
 *  ALLOW-list already excludes anything that isn't 'active'/'exhausted', so
 *  'unknown' is excluded the same way 'cancelled'/'void' already are,
 *  without naming it. */
export function nextPurchaseRound(
  packs: ReadonlyArray<{ kind: PackKind; purchase_round: number; status: PackStatusRead }>,
): number {
  const rounds = packs
    .filter((p) => p.kind === 'pack' && (p.status === 'active' || p.status === 'exhausted'))
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

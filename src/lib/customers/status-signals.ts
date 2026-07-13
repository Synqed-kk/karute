// ─── SINGLE SOURCE OF TRUTH for customer status ──────────────────────────────
// One chopstick through the apple: a customer's status is decided in ONE place
// and that value is shown on EVERY surface (list, profile, recording target, 予約
// agenda). No page re-derives it from its own partial inputs — that's what made
// the badge disagree across pages (新規 on the list, 継続中 on the profile).
//
// PURE + CLIENT-SAFE, split out of list-enrich.ts (packet-02 / Fable review
// round 1): list-enrich mixes this logic with service-role enrichment
// (SynqedClient + next/cache), so client code importing the helpers dragged the
// server module into the thin bundle's graph — it only stayed out by the grace
// of tree-shaking. The thin boundary plugin now refuses unported next/* imports
// outright, so the client-safe surface lives here, importable from anywhere.

import { jstDaysBetween } from '@/lib/date/jst'
import type { CustomerStatusKey } from '@/components/customers/redesign/types'

/** Every signal of prior history. Gathered the SAME way on each surface so the
 *  result is identical for a given customer everywhere. */
export interface CustomerStatusSignals {
  joinDateIso: string | null
  lastVisitIso: string | null
  /** QuickReserve "returning customer" flag. */
  isExistingCustomer?: boolean
  /** QR lifetime visit count (visits_number_cache). */
  visitCount?: number
  /** Recorded karute sessions in this system. */
  karuteCount?: number
  /** Past appointments on file. */
  pastAppointmentCount?: number
  /** Holds a 回数券 / multi-session pass → definitively a returning customer. */
  hasTicketPack?: boolean
  /** Upcoming booking on file → the customer is ALREADY coming back, so the
   *  chase states (要フォロー/休眠) are moot: a follow-up queue containing
   *  people who already booked wastes staff calls (Liam; Kitano's sheet keys
   *  every chase list on 次回予約なし). Self-healing: a no-show stops being
   *  "upcoming" and the customer re-enters the queue automatically. Matches
   *  resolvePackAlert, which has required hasNextBooking=false from day one. */
  hasUpcomingBooking?: boolean
  /** customer_lifecycle.status — a staff DECISION that outranks cadence math.
   *  卒業 (graduated) / 離客 (lost) customers must never fake-render as 休眠/
   *  要フォロー: that red would poison the 200-row scan with known-closed
   *  cases (the Kitano sheet tracks 卒業/離客 as its first two columns). */
  lifecycleStatus?: 'active' | 'graduated' | 'lost'
}

/** Has this customer been here before (i.e. NOT 新規)? ANY signal counts. The
 *  badge AND the recording/agenda "first visit" checks both call this, so they
 *  can never disagree. (QR regulars like a 6回券 holder with 0 recordings but
 *  visit_count 5 are correctly returning — the bug was surfaces ignoring those.) */
export function isReturningCustomer(s: CustomerStatusSignals): boolean {
  return (
    (s.isExistingCustomer ?? false) ||
    (s.visitCount ?? 0) > 0 ||
    (s.karuteCount ?? 0) > 0 ||
    (s.pastAppointmentCount ?? 0) > 0 ||
    (s.hasTicketPack ?? false)
  )
}

/** The 来店 count shown to staff — the strongest evidence of visits we have,
 *  consistent on every surface. */
export function customerVisitCount(s: CustomerStatusSignals): number {
  return Math.max(
    s.visitCount ?? 0,
    s.karuteCount ?? 0,
    s.pastAppointmentCount ?? 0,
  )
}

/** THE status-badge resolver. Every surface MUST call this (not the raw rules)
 *  so the badge is computed once and rendered identically everywhere. */
export function resolveCustomerStatus(s: CustomerStatusSignals): CustomerStatusKey {
  // Staff decisions first: 卒業/離客 are terminal states — no cadence rule may
  // override them (a graduated customer 200 days out is NOT 休眠).
  if (s.lifecycleStatus === 'graduated') return 'graduated'
  if (s.lifecycleStatus === 'lost') return 'lost'
  const now = Date.now()
  if (!isReturningCustomer(s)) {
    if (s.joinDateIso && now - new Date(s.joinDateIso).getTime() < 30 * 86_400_000)
      return 'new'
    if (!s.lastVisitIso) return 'new'
  }
  // Returning but no dated visit yet → on-track (not new, not dormant).
  if (!s.lastVisitIso) return 'on-track'
  // A booked customer is never a chase target — see hasUpcomingBooking doc.
  if (s.hasUpcomingBooking) return 'on-track'
  // JST calendar days — the SAME rule the ago-string uses (jstDaysBetween),
  // so 「90日前」 and the 休眠 chip can never disagree around midnight.
  const daysSince = jstDaysBetween(s.lastVisitIso, new Date(now))
  // >= : the label says 休眠（90日以上） — 以上 is inclusive, so exactly-90 is
  // dormant, not 要フォロー. One source; every surface inherits.
  if (daysSince >= 90) return 'dormant'
  if (daysSince > 60) return 'needs-followup'
  return 'on-track'
}

/** @deprecated Thin shim → resolveCustomerStatus. Prefer the resolver (it takes
 *  the full signal set) so no caller can pass a partial signal again. Kept for
 *  existing callers + tests. */
export function deriveStatus(
  joinDateIso: string | null,
  lastVisitIso: string | null,
  isExistingCustomer = false,
  priorVisitCount = 0,
): CustomerStatusKey {
  return resolveCustomerStatus({
    joinDateIso,
    lastVisitIso,
    isExistingCustomer,
    karuteCount: priorVisitCount,
  })
}

// PURE alert assembly — no server imports (testable in Jest, importable from
// client components for types). The loader lives in ./alerts.ts.
//
// Dashboard 離客/upsell alert rules: same resolvePackAlert as the 顧客 list
// (chopstick) + dashboard-specific handling — manager dismissals silence the
// CONTACT alert only, 卒業/離客 excluded, most-days-absent first.

import { daysSince, resolvePackAlert } from './resolve'
import type { CustomerPackUsage } from './store'
import type { CustomerLifecycle } from './types'

export interface PackAlertEntry {
  customerId: string
  name: string
  karuteNumber: string | null
  remaining: number
  size: number
  unconsumed: number
  daysSinceLastVisit: number | null
  hasNextBooking: boolean
}

export interface PackAlerts {
  /** Tickets left + no next booking + threshold+ days unseen → contact NOW.
   *  Sorted most-days-absent first. Manager dismissals excluded. */
  contact: PackAlertEntry[]
  /** 残り1回 → suggest the next pack at their upcoming visit. */
  low: PackAlertEntry[]
}

export interface ComputePackAlertsInput {
  usage: ReadonlyMap<string, CustomerPackUsage>
  lifecycles: ReadonlyMap<string, CustomerLifecycle>
  /** Customers whose contact alert a manager dismissed (audit-trailed). */
  dismissed: ReadonlySet<string>
  nameById: ReadonlyMap<string, string>
  visitById: ReadonlyMap<
    string,
    { lastVisitIso: string | null; nextAppointmentIso: string | null }
  >
  karuteNumberById: ReadonlyMap<string, string>
  thresholdDays?: number
  now?: Date
}

export function computePackAlerts(input: ComputePackAlertsInput): PackAlerts {
  const contact: PackAlertEntry[] = []
  const low: PackAlertEntry[] = []
  for (const [customerId, u] of input.usage) {
    const visits = input.visitById.get(customerId)
    const daysSinceLastVisit = daysSince(visits?.lastVisitIso ?? null, input.now)
    const hasNextBooking = !!visits?.nextAppointmentIso
    const level = resolvePackAlert({
      remainingTotal: u.remaining,
      hasActivePack: u.hasActivePack,
      daysSinceLastVisit,
      hasNextBooking,
      lifecycleStatus: input.lifecycles.get(customerId)?.status,
      thresholdDays: input.thresholdDays,
    })
    if (!level) continue
    const entry: PackAlertEntry = {
      customerId,
      name: input.nameById.get(customerId) ?? '—',
      karuteNumber: input.karuteNumberById.get(customerId) ?? null,
      remaining: u.remaining,
      size: u.size,
      unconsumed: u.unconsumed,
      daysSinceLastVisit,
      hasNextBooking,
    }
    // A manager dismissal silences the CONTACT alert only — the 残り1回 upsell
    // nudge is a different conversation and stays visible.
    if (level === 'contact') {
      if (!input.dismissed.has(customerId)) contact.push(entry)
    } else {
      low.push(entry)
    }
  }
  contact.sort(
    (a, b) => (b.daysSinceLastVisit ?? 0) - (a.daysSinceLastVisit ?? 0),
  )
  low.sort((a, b) => (b.unconsumed ?? 0) - (a.unconsumed ?? 0))
  return { contact, low }
}

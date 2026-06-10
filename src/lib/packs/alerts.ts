// Dashboard 離客/upsell alert LOADER — bulk reads + the pure assembly from
// ./alerts-core (kept separate so the rules are Jest-testable without the
// next/cache + service-client import chain).

import { getBusinessId } from '@/lib/staff'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { enrichCustomers } from '@/lib/customers/list-enrich'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import {
  listActiveDismissals,
  listAllLifecycles,
  listAllPackUsage,
  listRecentContacts,
} from './store'
import { computePackAlerts, type PackAlerts } from './alerts-core'

export type { PackAlertEntry, PackAlerts } from './alerts-core'

/** Server loader for the dashboard. Bulk reads only (no per-customer queries);
 *  every map is empty until the ticket_packs migration applies → { [], [] }. */
export async function getPackAlerts(thresholdDays?: number): Promise<PackAlerts> {
  const [usage, lifecycles, dismissed, customers, businessId, recentContacts] =
    await Promise.all([
      listAllPackUsage(),
      listAllLifecycles(),
      listActiveDismissals(),
      getCachedCustomerList(),
      getBusinessId().catch(() => null),
      // 31 days covers both consumers: the 7-day 対応中 snooze AND the
      // current-calendar-month 対応→再来店 metric.
      listRecentContacts(31),
    ])
  if (usage.size === 0) {
    return {
      contact: [],
      low: [],
      inProgress: [],
      totals: { atRiskValue: 0, unconsumedTotal: 0, holderCount: 0 },
      monthly: { contacted: 0, rebooked: 0 },
    }
  }

  // Latest contact per customer (rows arrive newest-first) + this month's set.
  const recentContactAt = new Map<string, string>()
  const monthlyContactIds = new Set<string>()
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  for (const row of recentContacts) {
    if (!recentContactAt.has(row.customer_id)) {
      recentContactAt.set(row.customer_id, row.contacted_at)
    }
    if (new Date(row.contacted_at) >= monthStart) {
      monthlyContactIds.add(row.customer_id)
    }
  }

  const holderIds = Array.from(usage.keys())
  const enrichment =
    businessId && holderIds.length
      ? await enrichCustomers(businessId, holderIds)
      : new Map()
  const visitById = new Map(
    Array.from(enrichment.entries()).map(([id, e]) => [
      id,
      {
        lastVisitIso: e.lastVisitIso,
        nextAppointmentIso: e.nextAppointmentIso,
      },
    ]),
  )
  return computePackAlerts({
    usage,
    lifecycles,
    dismissed,
    nameById: new Map(customers.map((c) => [c.id, c.name])),
    visitById,
    karuteNumberById: assignSequentialKaruteNumbers(customers),
    recentContactAt,
    monthlyContactIds,
    thresholdDays,
  })
}

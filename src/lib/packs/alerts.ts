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
} from './store'
import { computePackAlerts, type PackAlerts } from './alerts-core'

export type { PackAlertEntry, PackAlerts } from './alerts-core'

/** Server loader for the dashboard. Bulk reads only (no per-customer queries);
 *  every map is empty until the ticket_packs migration applies → { [], [] }. */
export async function getPackAlerts(thresholdDays?: number): Promise<PackAlerts> {
  const [usage, lifecycles, dismissed, customers, businessId] = await Promise.all([
    listAllPackUsage(),
    listAllLifecycles(),
    listActiveDismissals(),
    getCachedCustomerList(),
    getBusinessId().catch(() => null),
  ])
  if (usage.size === 0) {
    return {
      contact: [],
      low: [],
      totals: { atRiskValue: 0, unconsumedTotal: 0, holderCount: 0 },
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
    thresholdDays,
  })
}

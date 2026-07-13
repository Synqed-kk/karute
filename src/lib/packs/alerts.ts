// Dashboard 離客/upsell alert LOADER — bulk reads + the pure assembly from
// ./alerts-core (kept separate so the rules are Jest-testable without the
// next/cache + service-client import chain).

import { getBusinessId } from '@/lib/staff'
import {
  getCachedCustomerList,
  getCachedCustomerListFor,
} from '@/lib/customers/cached'
import {
  effectiveLastVisitIso,
  enrichCustomers,
} from '@/lib/customers/list-enrich'
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
 *  every map is empty until the ticket_packs migration applies → { [], [] }.
 *
 *  storeId (the CLAMPED resolveStoreScope().storeId, never a raw cookie)
 *  applies the viewer's store lens: pack data has no store column server-side
 *  (#465 family), so holders are clamped by MEMBERSHIP — anyone outside the
 *  store-filtered customer list is dropped before the alert/totals math.
 *  Fail CLOSED: if the lens fetch errors, return the empty shape rather than
 *  another store's holders. */
export async function getPackAlerts(
  thresholdDays?: number,
  storeId?: string | null,
): Promise<PackAlerts> {
  const empty: PackAlerts = {
    contact: [],
    low: [],
    inProgress: [],
    totals: { atRiskValue: 0, unconsumedTotal: 0, holderCount: 0 },
    monthly: { contacted: 0, rebooked: 0 },
  }
  const [usageAll, lifecyclesAll, dismissed, customers, businessId, recentContacts] =
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
  if (usageAll.size === 0) return empty

  let usage = usageAll
  let lifecycles = lifecyclesAll
  let inStore: Set<string> | null = null
  if (storeId && businessId) {
    try {
      const storeCustomers = await getCachedCustomerListFor(businessId, storeId)
      inStore = new Set(storeCustomers.map((c) => c.id))
      usage = new Map([...usageAll].filter(([id]) => inStore!.has(id)))
      lifecycles = new Map([...lifecyclesAll].filter(([id]) => inStore!.has(id)))
    } catch {
      return empty
    }
  }
  if (usage.size === 0) return empty

  // Latest contact per customer (rows arrive newest-first) + this month's set.
  // Same store lens as usage/lifecycles: the 今月 対応→再来店 footer must count
  // the viewer's store only, not company-wide contact volume.
  const recentContactAt = new Map<string, string>()
  const monthlyContactIds = new Set<string>()
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  for (const row of recentContacts) {
    if (inStore && !inStore.has(row.customer_id)) continue
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
  // last_visit_at fallback (sheet import / deep crawl) — same ONE rule the
  // list adapter uses, so the dashboard and the list can never disagree about
  // who is N days absent.
  const lastVisitAtById = new Map(
    customers.map((c) => [
      c.id,
      (c as { last_visit_at?: string | null }).last_visit_at ?? null,
    ]),
  )
  const visitById = new Map(
    Array.from(enrichment.entries()).map(([id, e]) => [
      id,
      {
        lastVisitIso: effectiveLastVisitIso(
          e.lastVisitIso,
          lastVisitAtById.get(id),
        ),
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

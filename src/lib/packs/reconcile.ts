// 未処理来店 loader — gathers real data for the pure detector
// (reconcile-core.ts) and resolves display fields. Mirrors alerts.ts: every
// read degrades gracefully, so the dashboard renders an empty strip rather
// than erroring if anything is unavailable.

import type { SynqedClient } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCachedCustomerList, getCachedCustomerListFor } from '@/lib/customers/cached'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { ymdInJst } from '@/lib/date/jst'
import { isTerminalStatus } from '@/lib/appointments/status'
import {
  listAllLifecycles,
  listAllLifecyclesWithClient,
  listAllPackUsage,
  listAllPackUsageWithClient,
  listRecentRedemptions,
  listRecentRedemptionsWithClient,
  listVisitReconcileDismissals,
  listVisitReconcileDismissalsWithClient,
} from './store'
import {
  findUnprocessedVisits,
  shiftDay,
  type ReconcileAppointment,
  type UnprocessedVisit,
} from './reconcile-core'

export interface ReconcileEntry extends UnprocessedVisit {
  name: string
  karuteNumber: string | null
  remaining: number
  size: number
  /** この日に消化 target — null disables the redeem button (display-only row). */
  packId: string | null
}

export interface ReconcileData {
  entries: ReconcileEntry[]
  truncated: number
}

const LOOKBACK_DAYS = 7

/** storeId = the CLAMPED resolveStoreScope().storeId (never a raw cookie).
 *  Store-filters the appointment window server-side so the 未処理来店 todos
 *  only surface the viewer's own store's visits (#465 family). The karute
 *  read stays unfiltered ON PURPOSE: it only feeds a has-karute lookup keyed
 *  by the (already store-filtered) appointment ids — filtering it too would
 *  false-positive a todo for any legacy record with a mis-stamped store.
 *  null/undefined = no filter (business has no stores / lookup failed). */
export async function loadUnprocessedVisits(
  storeId?: string | null,
): Promise<ReconcileData> {
  try {
    const synqed = await getSynqedClient()
    const todayJst = ymdInJst(new Date())
    const fromIso = new Date(`${shiftDay(todayJst, -LOOKBACK_DAYS)}T00:00:00+09:00`).toISOString()
    const toIso = new Date(`${todayJst}T23:59:59.999+09:00`).toISOString()

    const [usage, lifecycles, dismissalRows, redemptions, customers] =
      await Promise.all([
        listAllPackUsage(),
        listAllLifecycles(),
        listVisitReconcileDismissals(LOOKBACK_DAYS + 1),
        listRecentRedemptions(LOOKBACK_DAYS + 1),
        getCachedCustomerList(),
      ])
    if (usage.size === 0) return { entries: [], truncated: 0 }

    // Appointments + karute records in the window (paginated — the window can
    // exceed one page on busy weeks).
    const appointments: Array<{
      id: string
      customer_id: string
      starts_at: string
      status?: string
      notes?: string | null
    }> = []
    for (let page = 1; page <= 10; page++) {
      const res = await synqed.appointments.list({
        from: fromIso,
        to: toIso,
        page,
        page_size: 200,
        store_id: storeId ?? undefined,
      })
      appointments.push(
        ...(res.appointments as unknown as typeof appointments),
      )
      if (res.appointments.length < 200) break
    }
    const karuteByAppointment = new Set<string>()
    for (let page = 1; page <= 10; page++) {
      const res = await synqed.karuteRecords.list({
        from: fromIso,
        to: toIso,
        page,
        page_size: 200,
      })
      for (const k of res.karute_records as Array<{ appointment_id?: string | null }>) {
        if (k.appointment_id) karuteByAppointment.add(k.appointment_id)
      }
      if (res.karute_records.length < 200) break
    }

    const mapped: ReconcileAppointment[] = appointments.map((a) => ({
      id: a.id,
      customerId: a.customer_id,
      visitDayJst: ymdInJst(new Date(a.starts_at)),
      isCancelled: isTerminalStatus(a.status ?? ''),
      isImport: (a.notes ?? '').includes('sheet-import'),
      hasKarute: karuteByAppointment.has(a.id),
    }))

    const dismissals = new Set(
      dismissalRows.map((d) => `${d.customer_id}|${d.visit_day}`),
    )
    const { visits, truncated } = findUnprocessedVisits({
      holders: usage,
      lifecycles,
      appointments: mapped,
      redemptions: redemptions.map((r) => ({
        customerId: r.customer_id,
        appointmentId: r.appointment_id,
        redeemedOn: r.redeemed_on,
      })),
      dismissals,
      todayJst,
    })

    const nameById = new Map(customers.map((c) => [c.id, c.name]))
    const karuteNumberById = assignSequentialKaruteNumbers(customers)
    const entries: ReconcileEntry[] = visits.map((v) => ({
      ...v,
      name: nameById.get(v.customerId) ?? '—',
      karuteNumber: karuteNumberById.get(v.customerId) ?? null,
      remaining: usage.get(v.customerId)?.remaining ?? 0,
      size: usage.get(v.customerId)?.size ?? 0,
      packId: usage.get(v.customerId)?.firstPackId ?? null,
    }))
    return { entries, truncated }
  } catch {
    return { entries: [], truncated: 0 }
  }
}

/** Business-scoped twin of loadUnprocessedVisits (design-parity P-B-1 —
 *  also the dashboard screen's owner-band reconcile source once wired to the
 *  facade in PR 2; unused by PR 1's web path, which still reads the graceful
 *  cookie version above). THROWS on failure — the facade caller (PR 2)
 *  decides graceful vs 502, same split as the other WithClient twins in this
 *  family; the cookie wrapper above keeps today's graceful-empty contract. */
export async function loadUnprocessedVisitsWithClient(
  synqed: SynqedClient,
  businessId: string,
  storeId?: string | null,
): Promise<ReconcileData> {
  const todayJst = ymdInJst(new Date())
  const fromIso = new Date(
    `${shiftDay(todayJst, -LOOKBACK_DAYS)}T00:00:00+09:00`,
  ).toISOString()
  const toIso = new Date(`${todayJst}T23:59:59.999+09:00`).toISOString()

  const [usage, lifecycles, dismissalRows, redemptions, customers] =
    await Promise.all([
      listAllPackUsageWithClient(synqed),
      listAllLifecyclesWithClient(synqed),
      listVisitReconcileDismissalsWithClient(synqed, LOOKBACK_DAYS + 1),
      listRecentRedemptionsWithClient(synqed, LOOKBACK_DAYS + 1),
      getCachedCustomerListFor(businessId),
    ])
  if (usage.size === 0) return { entries: [], truncated: 0 }

  const appointments: Array<{
    id: string
    customer_id: string
    starts_at: string
    status?: string
    notes?: string | null
  }> = []
  for (let page = 1; page <= 10; page++) {
    const res = await synqed.appointments.list({
      from: fromIso,
      to: toIso,
      page,
      page_size: 200,
      store_id: storeId ?? undefined,
    })
    appointments.push(...(res.appointments as unknown as typeof appointments))
    if (res.appointments.length < 200) break
  }
  const karuteByAppointment = new Set<string>()
  for (let page = 1; page <= 10; page++) {
    const res = await synqed.karuteRecords.list({
      from: fromIso,
      to: toIso,
      page,
      page_size: 200,
    })
    for (const k of res.karute_records as Array<{ appointment_id?: string | null }>) {
      if (k.appointment_id) karuteByAppointment.add(k.appointment_id)
    }
    if (res.karute_records.length < 200) break
  }

  const mapped: ReconcileAppointment[] = appointments.map((a) => ({
    id: a.id,
    customerId: a.customer_id,
    visitDayJst: ymdInJst(new Date(a.starts_at)),
    isCancelled: isTerminalStatus(a.status ?? ''),
    isImport: (a.notes ?? '').includes('sheet-import'),
    hasKarute: karuteByAppointment.has(a.id),
  }))

  const dismissals = new Set(
    dismissalRows.map((d) => `${d.customer_id}|${d.visit_day}`),
  )
  const { visits, truncated } = findUnprocessedVisits({
    holders: usage,
    lifecycles,
    appointments: mapped,
    redemptions: redemptions.map((r) => ({
      customerId: r.customer_id,
      appointmentId: r.appointment_id,
      redeemedOn: r.redeemed_on,
    })),
    dismissals,
    todayJst,
  })

  const nameById = new Map(customers.map((c) => [c.id, c.name]))
  const karuteNumberById = assignSequentialKaruteNumbers(customers)
  const entries: ReconcileEntry[] = visits.map((v) => ({
    ...v,
    name: nameById.get(v.customerId) ?? '—',
    karuteNumber: karuteNumberById.get(v.customerId) ?? null,
    remaining: usage.get(v.customerId)?.remaining ?? 0,
    size: usage.get(v.customerId)?.size ?? 0,
    packId: usage.get(v.customerId)?.firstPackId ?? null,
  }))
  return { entries, truncated }
}

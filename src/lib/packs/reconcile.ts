// 未処理来店 loader — gathers real data for the pure detector
// (reconcile-core.ts) and resolves display fields. Mirrors alerts.ts: every
// read degrades gracefully, so the dashboard renders an empty strip rather
// than erroring if anything is unavailable.

import { getSynqedClient } from '@/lib/synqed/client'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { assignSequentialKaruteNumbers } from '@/lib/customers/identity'
import { ymdInJst } from '@/lib/date/jst'
import {
  listAllLifecycles,
  listAllPackUsage,
  listRecentRedemptions,
  listVisitReconcileDismissals,
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
}

export interface ReconcileData {
  entries: ReconcileEntry[]
  truncated: number
}

const LOOKBACK_DAYS = 7

export async function loadUnprocessedVisits(): Promise<ReconcileData> {
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
      isCancelled: (a.status ?? '') === 'CANCELLED',
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
    }))
    return { entries, truncated }
  } catch {
    return { entries: [], truncated: 0 }
  }
}

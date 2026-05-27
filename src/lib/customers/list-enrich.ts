// Batches the per-customer enrichments that the redesigned list page needs:
// last-visit date + total karute count, both grouped by client_id in a single
// service-role read so we don't N+1.
//
// Fields the list still stubs (no producer in karute today):
//   - aiPredict.{label,when} — needs the rebooking-window model
//   - visitsDone / visitsTotal — needs a "course" concept the data model doesn't have
//   - status enum — we derive a best-guess from cadence (see derive)

import { createServiceClient } from '@/lib/supabase/service'
import { getSynqedClient } from '@/lib/synqed/client'
import type { CustomerListRow, CustomerStatusKey } from '@/components/customers/redesign/types'

export interface CustomerEnrichment {
  totalKarute: number
  lastVisitIso: string | null
  visitsDone: number
}

export async function enrichCustomers(
  businessId: string,
  customerIds: string[],
): Promise<Map<string, CustomerEnrichment>> {
  const map = new Map<string, CustomerEnrichment>()
  if (customerIds.length === 0) return map

  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = service as any

  // Karute comes from synqed-core (the source of truth), bucketed by the
  // person (synqed `customer_id`). The appointment last-visit fallback still
  // reads Supabase directly — TODO: that table has the same legacy-drift issue
  // as karute did; route it through synqed-core too.
  const idSet = new Set(customerIds)
  const [karuteRes, apptRes] = await Promise.all([
    getSynqedClient().then((c) => c.karuteRecords.list({ page_size: 500 })),
    sb
      .from('appointments')
      .select('client_id, start_time')
      .in('client_id', customerIds),
  ])

  type KaruteRow = { client_id: string; session_date: string | null; created_at: string }
  type ApptRow = { client_id: string; start_time: string }

  const karuteByClient = new Map<string, KaruteRow[]>()
  for (const r of karuteRes.karute_records) {
    if (!r.customer_id || !idSet.has(r.customer_id)) continue
    const arr = karuteByClient.get(r.customer_id) ?? []
    arr.push({ client_id: r.customer_id, session_date: r.created_at, created_at: r.created_at })
    karuteByClient.set(r.customer_id, arr)
  }

  const apptByClient = new Map<string, ApptRow[]>()
  for (const a of (apptRes.data ?? []) as ApptRow[]) {
    const arr = apptByClient.get(a.client_id) ?? []
    arr.push(a)
    apptByClient.set(a.client_id, arr)
  }

  for (const id of customerIds) {
    const karute = karuteByClient.get(id) ?? []
    const appts = apptByClient.get(id) ?? []
    let lastVisitIso: string | null = null
    for (const k of karute) {
      const dt = k.session_date ?? k.created_at
      if (!lastVisitIso || dt > lastVisitIso) lastVisitIso = dt
    }
    // Fall back to appointment last-time if no karute yet.
    if (!lastVisitIso) {
      for (const a of appts) {
        if (!lastVisitIso || a.start_time > lastVisitIso) lastVisitIso = a.start_time
      }
    }
    map.set(id, {
      totalKarute: karute.length,
      lastVisitIso,
      visitsDone: karute.length,
    })
  }

  return map
}

export function deriveStatus(
  joinDateIso: string | null,
  lastVisitIso: string | null,
): CustomerStatusKey {
  const now = Date.now()
  if (joinDateIso) {
    const ageMs = now - new Date(joinDateIso).getTime()
    if (ageMs < 30 * 24 * 60 * 60 * 1000) return 'new'
  }
  if (!lastVisitIso) return 'new'
  const daysSince = Math.floor((now - new Date(lastVisitIso).getTime()) / 86_400_000)
  if (daysSince > 90) return 'dormant'
  if (daysSince > 60) return 'needs-followup'
  return 'on-track'
}

export function formatJoinDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatLastVisit(iso: string | null): { date: string; ago: string } {
  if (!iso) return { date: '—', ago: 'No visits' }
  const dt = new Date(iso)
  const date = dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const days = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86_400_000))
  const ago =
    days === 0
      ? 'Today'
      : days === 1
        ? '1 day ago'
        : days < 30
          ? `${days} days ago`
          : `${Math.floor(days / 30)} mo ago`
  return { date, ago }
}

export function deriveKaruteNumber(id: string): string {
  return `#${id.replace(/-/g, '').slice(0, 5).toUpperCase()}`
}

// Default AI-predict stub. Hardcoded "Soon" timing — replace with the
// rebooking-window model output when it lands.
export function defaultAiPredict(status: CustomerStatusKey): CustomerListRow['aiPredict'] {
  if (status === 'dormant') return { label: 'Reach out', when: 'This week' }
  if (status === 'needs-followup') return { label: 'Follow up', when: 'Soon' }
  return { label: 'Recommend', when: '—' }
}

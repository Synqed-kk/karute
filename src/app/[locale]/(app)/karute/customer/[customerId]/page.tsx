import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'

import { getCustomer } from '@/lib/customers/queries'
import { getCustomerContact } from '@/lib/customers/customer-detail-cached'
import { getStaffList, getBusinessId } from '@/lib/staff'
import { createServiceClient } from '@/lib/supabase/service'
import { getSynqedClient } from '@/lib/synqed/client'
import {
  deriveStatus,
  formatJoinDate,
} from '@/lib/customers/list-enrich'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import type { CustomerProfileData } from '@/components/customers/redesign/types'
import type { CustomerSessionEntry } from '@/components/customers/redesign/profile/SessionsTabContent'
import { KaruteCustomerDetailView } from '@/components/karute/spike-lifted/KaruteCustomerDetailView'

/**
 * /karute/customer/[customerId]
 *
 * Customer-centric karute detail page — reached from the カルテ tab
 * (bottom-left) → tap a customer card. Mirrors the design spike's
 * karute detail page (vertical stack of AI sections), distinct from
 * the customer-profile page (/customers/[id]) reached from the 顧客
 * tab which uses the tabbed layout.
 *
 * Data pipeline largely mirrors /customers/[id]/page.tsx — fetches
 * the customer + their karute_records via service client + the
 * tenant customer list for sequential-karute-number computation.
 * Only the rendered component differs (KaruteCustomerDetailView vs
 * CustomerProfileView).
 */
export default async function KaruteCustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string; locale: string }>
}) {
  const { customerId } = await params
  const customer = await getCustomer(customerId).catch(() => null)
  if (!customer) notFound()

  const businessId = await getBusinessId()
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = service as any
  const synqed = await getSynqedClient()

  const [contact, staffList, karuteRes, allCustomersList, locale] =
    await Promise.all([
      getCustomerContact(customerId),
      getStaffList(),
      sb
        .from('karute_records')
        .select(
          'id, session_date, created_at, summary, staff_profile_id, customer_id, client_id, entries(count)',
        )
        .eq('customer_id', businessId)
        .eq('client_id', customerId)
        .order('session_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      synqed.customers.list({
        page: 1,
        page_size: 500,
        sort_by: 'created_at',
        sort_order: 'asc',
      }),
      getLocale(),
    ])

  type KaruteRow = {
    id: string
    session_date: string | null
    created_at: string
    summary: string | null
    staff_profile_id: string | null
    entries: Array<{ count: number }> | null
  }
  const karuteRecords = (karuteRes.data ?? []) as KaruteRow[]
  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )

  const lastVisitIso =
    karuteRecords[0]?.session_date ?? karuteRecords[0]?.created_at ?? null
  const status = deriveStatus(customer.created_at, lastVisitIso)

  const sessions: CustomerSessionEntry[] = karuteRecords.map((r, i) => {
    const dt = new Date(r.session_date ?? r.created_at)
    const entryCount = Array.isArray(r.entries)
      ? (r.entries[0]?.count ?? 0)
      : 0
    return {
      id: r.id,
      karuteId: r.id,
      date: new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
        year: 'numeric',
        month: locale === 'ja' ? 'long' : 'short',
        day: 'numeric',
      }).format(dt),
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()],
      // Service '—' + duration 0 instead of 'Session'/60 — same
      // '施術' bug fixed on the karute list. ANTHONY: thread real
      // values once karute_records gets the service + duration_minutes
      // columns.
      service: '—',
      duration: 0,
      summary: r.summary ?? '—',
      staffName: r.staff_profile_id
        ? (staffNameById.get(r.staff_profile_id) ?? 'Unknown')
        : 'Unknown',
      entryCount,
      aiSummarized: Boolean(r.summary),
      memoryAdded: null,
      isLatest: i === 0,
    }
  })

  const preferredStaffId: string | null = customer.assigned_staff_id ?? null

  const profile: CustomerProfileData = {
    id: customer.id,
    name: customer.name,
    initials: deriveFamilyInitials(customer.name),
    karuteNumber:
      assignSequentialKaruteNumbers(allCustomersList.customers).get(
        customer.id,
      ) ?? '#00000',
    age: null,
    gender: null,
    joinDate: formatJoinDate(customer.created_at, locale),
    totalKarute: karuteRecords.length,
    phone: contact.phone ?? customer.phone,
    email: contact.email ?? customer.email,
    bookingMemo: customer.notes ?? null,
    preferredStaffName: preferredStaffId
      ? (staffNameById.get(preferredStaffId) ?? null)
      : null,
    nextVisitPredicted: '—',
    status,
    memoryCount: 0,
    sessionCount: karuteRecords.length,
    photoCount: 0,
  }

  return <KaruteCustomerDetailView customer={profile} sessions={sessions} />
}

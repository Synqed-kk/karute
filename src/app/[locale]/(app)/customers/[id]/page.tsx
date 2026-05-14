import { notFound } from 'next/navigation'

import { getCustomer } from '@/lib/customers/queries'
import { getCustomerContact } from '@/lib/customers/customer-detail-cached'
import { getStaffList, getBusinessId } from '@/lib/staff'
import { createServiceClient } from '@/lib/supabase/service'
import { listCustomerPhotos } from '@/actions/customers'
import { CustomerProfileView } from '@/components/customers/redesign/profile/CustomerProfileView'
import type { CustomerProfileData } from '@/components/customers/redesign/types'
import {
  deriveKaruteNumber,
  deriveStatus,
  formatJoinDate,
} from '@/lib/customers/list-enrich'
import type { CustomerSessionEntry } from '@/components/customers/redesign/profile/SessionsTabContent'
import type { CustomerPhoto } from '@/components/customers/redesign/profile/PhotosTabContent'

interface CustomerProfilePageProps {
  params: Promise<{ id: string; locale: string }>
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function prettyDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default async function CustomerProfilePage({
  params,
}: CustomerProfilePageProps) {
  const { id } = await params
  const customer = await getCustomer(id).catch(() => null)
  if (!customer) notFound()

  // Fetch supporting data in parallel: contact (cached), staff list (cached),
  // karute_records for the customer, and photos.
  const businessId = await getBusinessId()
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = service as any

  const [contact, staffList, karuteRes, photosResult] = await Promise.all([
    getCustomerContact(id),
    getStaffList(),
    sb
      .from('karute_records')
      .select(
        'id, session_date, created_at, summary, staff_profile_id, customer_id, client_id, entries(count)',
      )
      .eq('customer_id', businessId)
      .eq('client_id', id)
      .order('session_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    listCustomerPhotos(id).catch(() => ({
      photos: [] as Array<{
        id: string
        signed_url: string | null
        category: string
        caption: string | null
      }>,
    })),
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

  const photos: CustomerPhoto[] = (photosResult.photos ?? []).map((p) => ({
    id: p.id,
    signedUrl: p.signed_url,
    category: p.category,
    caption: p.caption,
  }))

  const sessions: CustomerSessionEntry[] = karuteRecords.map((r, i) => {
    const dt = new Date(r.session_date ?? r.created_at)
    const entryCount = Array.isArray(r.entries) ? (r.entries[0]?.count ?? 0) : 0
    return {
      id: r.id,
      karuteId: r.id,
      date: prettyDate(r.session_date ?? r.created_at),
      weekday: WEEKDAYS[dt.getDay()],
      service: 'Session',
      duration: 60,
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
    initials: deriveInitials(customer.name),
    karuteNumber: deriveKaruteNumber(customer.id),
    age: null,
    gender: null,
    joinDate: formatJoinDate(customer.created_at),
    totalKarute: karuteRecords.length,
    phone: contact.phone ?? customer.phone,
    email: contact.email ?? customer.email,
    preferredStaffName: preferredStaffId
      ? (staffNameById.get(preferredStaffId) ?? null)
      : null,
    nextVisitPredicted: status === 'dormant' ? 'Re-engage' : '—',
    status,
    memoryCount: 0, // Customer Memory backend not built yet
    sessionCount: karuteRecords.length,
    photoCount: photos.length,
  }

  return (
    <CustomerProfileView
      customer={profile}
      sessions={sessions}
      photos={photos}
    />
  )
}

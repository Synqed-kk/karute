import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CustomerProfileHeader } from '@/components/customers/CustomerProfileHeader'
import { CustomerDetailTabs } from '@/components/customers/CustomerDetailTabs'
import type { CustomerRow } from '@/types/database'

interface CustomerProfilePageProps {
  params: Promise<{ id: string; locale: string }>
  searchParams: Promise<{ historyPage?: string }>
}

export default async function CustomerProfilePage({
  params,
}: CustomerProfilePageProps) {
  const { id, locale } = await params

  const supabase = await createClient()

  // Fetch customer + karute records with entries and staff profiles in parallel
  const [customerResult, karuteResult] = await Promise.all([
    supabase.from('customers').select('*').eq('id', id).single(),
    supabase
      .from('karute_records')
      .select(
        `
        id,
        created_at,
        session_date,
        summary,
        transcript,
        staff_profile_id,
        profiles:staff_profile_id ( full_name ),
        entries (
          id,
          category,
          content,
          source_quote,
          confidence_score,
          is_manual,
          created_at
        )
      `,
        { count: 'exact' },
      )
      .eq('client_id', id)
      .order('session_date', { ascending: false }),
  ])

  if (customerResult.error || !customerResult.data) {
    notFound()
  }

  const customer = customerResult.data as CustomerRow

  type KaruteRecordWithEntries = {
    id: string
    created_at: string
    session_date: string
    summary: string | null
    transcript: string | null
    staff_profile_id: string | null
    profiles: { full_name: string } | null
    entries: Array<{
      id: string
      category: string
      content: string
      source_quote: string | null
      confidence_score: number | null
      is_manual: boolean
      created_at: string
    }>
  }

  const karuteRecords = (karuteResult.data ?? []) as KaruteRecordWithEntries[]
  const totalVisitCount = karuteResult.count ?? 0

  const lastVisit: string | null = karuteRecords[0]?.session_date ?? null

  return (
    <div className="space-y-6">
      {/* Profile header with inline edit */}
      <CustomerProfileHeader
        customer={customer}
        visitCount={totalVisitCount}
        lastVisit={lastVisit}
      />

      {/* Tabbed detail content */}
      <CustomerDetailTabs
        customer={customer}
        karuteRecords={karuteRecords}
        totalVisitCount={totalVisitCount}
        locale={locale}
      />
    </div>
  )
}

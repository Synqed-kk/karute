import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { CustomerProfileHeader } from '@/components/customers/CustomerProfileHeader'
import { KaruteHistoryList } from '@/components/customers/KaruteHistoryList'
import type { CustomerRow } from '@/types/database'

const HISTORY_PAGE_SIZE = 10

interface CustomerProfilePageProps {
  params: Promise<{ id: string; locale: string }>
  searchParams: Promise<{ historyPage?: string }>
}

export default async function CustomerProfilePage({
  params,
  searchParams,
}: CustomerProfilePageProps) {
  const { id } = await params
  const { historyPage: historyPageParam } = await searchParams

  const historyPage = Math.max(1, Number(historyPageParam ?? '1') || 1)

  const t = await getTranslations('customers')

  const supabase = await createClient()

  const [customerResult, karuteResult] = await Promise.all([
    supabase.from('customers').select('*').eq('id', id).single(),
    // client_id is the FK → customers.id (001_initial_schema.sql line 54)
    // Filters karute records for this specific client's sessions
    supabase
      .from('karute_records')
      .select('id, created_at, summary, staff_profile_id, session_date, profiles:staff_profile_id ( full_name )', { count: 'exact' })
      .eq('client_id', id)
      .order('session_date', { ascending: false })
      .range((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE - 1),
  ])

  if (customerResult.error || !customerResult.data) {
    notFound()
  }

  const customer = customerResult.data as CustomerRow
  const karuteRecords = (karuteResult.data ?? []) as Array<{
    id: string
    created_at: string
    summary: string | null
    staff_profile_id: string | null
    session_date: string
    profiles: { full_name: string } | null
  }>
  const totalKaruteCount = karuteResult.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalKaruteCount / HISTORY_PAGE_SIZE))

  const visitCount = totalKaruteCount
  const lastVisit: string | null = karuteRecords[0]?.session_date ?? null

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        {t('profile.back')}
      </Link>

      {/* Profile header with inline edit */}
      <CustomerProfileHeader
        customer={customer}
        visitCount={visitCount}
        lastVisit={lastVisit}
      />

      {/* Karute history */}
      <KaruteHistoryList
        records={karuteRecords}
        currentPage={historyPage}
        totalPages={totalPages}
      />
    </div>
  )
}

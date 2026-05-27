import { createClient } from '@/lib/supabase/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId } from '@/lib/staff'
import { DataExportView } from '@/components/export/redesign/DataExportView'
import type { ScopeKey } from '@/lib/export/scopes'

export default async function DataExportPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()

  const synqed = await getSynqedClient()
  const service = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = service as any

  const [
    {
      data: { user },
    },
    businessId,
    customers,
    bookings,
    karute,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getBusinessId().catch(() => null),
    synqed.customers.list({ page_size: 1 }).catch(() => ({ total: 0 })),
    synqed.appointments.list({ page_size: 1 }).catch(() => ({ total: 0 })),
    Promise.resolve(null),
  ])

  let karuteCount = 0
  if (businessId) {
    const { count } = await sb
      .from('karute_records')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', businessId)
    karuteCount = count ?? 0
  }

  void karute

  const totals: Record<ScopeKey, number> = {
    customers: customers.total ?? 0,
    bookings: bookings.total ?? 0,
    karute: karuteCount,
  }

  const recipientEmail = user?.email ?? 'owner@example.com'

  return (
    <DataExportView
      locale={locale}
      totals={totals}
      recipientEmail={recipientEmail}
    />
  )
}

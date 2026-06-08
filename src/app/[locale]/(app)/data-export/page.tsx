import { createClient } from '@/lib/supabase/server'
import { getSynqedClient } from '@/lib/synqed/client'
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

  const [
    {
      data: { user },
    },
    customers,
    bookings,
    karute,
  ] = await Promise.all([
    supabase.auth.getUser(),
    synqed.customers.list({ page_size: 1 }).catch(() => ({ total: 0 })),
    synqed.appointments.list({ page_size: 1 }).catch(() => ({ total: 0 })),
    // karute total from synqed-core (the Supabase mirror is empty post-migration).
    synqed.karuteRecords.list({ page_size: 1 }).catch(() => ({ total: 0 })),
  ])

  const karuteCount = karute.total ?? 0

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

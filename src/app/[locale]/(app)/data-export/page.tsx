import { createClient } from '@/lib/supabase/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { DataExportView } from '@/components/export/redesign/DataExportView'
import type { ScopeKey } from '@/lib/export/scopes'

export default async function DataExportPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()

  // Store clamp (#465 family), matching /api/export: a branch-restricted
  // staff's counts stay inside their store lens; viewAll / floating staff see
  // business-wide totals. Fail CLOSED: unresolved scope → zero counts, never
  // business-wide ones.
  const storeScope = await resolveStoreScope().catch(() => null)
  const storeId = storeScope?.allowedStoreIds
    ? (storeScope.storeId ?? undefined)
    : undefined
  const scopeFailed = storeScope === null

  const synqedPromise = getSynqedClient()
  const zero = { total: 0 }

  const [
    {
      data: { user },
    },
    customers,
    bookings,
    karute,
  ] = await Promise.all([
    supabase.auth.getUser(),
    scopeFailed
      ? zero
      : synqedPromise.then((synqed) =>
          synqed.customers
            .list({ page_size: 1, store_id: storeId })
            .catch(() => zero),
        ),
    scopeFailed
      ? zero
      : synqedPromise.then((synqed) =>
          synqed.appointments
            .list({ page_size: 1, store_id: storeId })
            .catch(() => zero),
        ),
    // karute total from synqed-core (the Supabase mirror is empty post-migration).
    scopeFailed
      ? zero
      : synqedPromise.then((synqed) =>
          synqed.karuteRecords
            .list({ page_size: 1, store_id: storeId })
            .catch(() => zero),
        ),
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

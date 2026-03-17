import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { KaruteListItem } from '@/components/karute/KaruteListItem'

interface KaruteListPageProps {
  params: Promise<{ locale: string }>
}

/**
 * Karute records list page at /[locale]/karute.
 *
 * Server component. Fetches all karute_records for the current user's
 * business, ordered by created_at descending (most recent first).
 *
 * Uses a nested PostgREST select to include customer name and entry count
 * in a single query.
 */
export default async function KaruteListPage({ params }: KaruteListPageProps) {
  const { locale } = await params
  const t = await getTranslations('karute')
  const supabase = await createClient()

  const { data: records, error } = await supabase
    .from('karute_records')
    .select(
      `
      id,
      created_at,
      summary,
      customers:client_id ( id, name ),
      entries ( id )
    `,
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      </div>

      {/* Records list */}
      {!records || records.length === 0 ? (
        <div className="rounded-lg border border-border py-12 text-center text-sm text-muted-foreground">
          {t('noKarute')}
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((record) => {
            // customers is a single object from the FK join (customers:client_id alias)
            // Supabase PostgREST returns it as a single object for .select('customers:client_id (id, name)')
            const customer = (record as unknown as { customers: { id: string; name: string } | null }).customers

            const customerName = customer?.name ?? 'Unknown'
            const entryCount = Array.isArray(record.entries) ? record.entries.length : 0

            return (
              <KaruteListItem
                key={record.id}
                id={record.id}
                customerName={customerName}
                createdAt={record.created_at}
                entryCount={entryCount}
                summary={record.summary}
                locale={locale}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

import { createClient } from '@/lib/supabase/server'
import { KaruteListView } from '@/components/karute/KaruteListView'
import {
  karuteRecordsToRichRows,
  type KaruteListRecord,
} from '@/lib/adapters/karute-list'

/**
 * Karute records list page at /[locale]/karute.
 *
 * Fetches all karute_records for the current user's business, ordered by
 * session_date descending. Renders the redesigned list view (header, search,
 * status filters, date groups, desktop/mobile rows).
 */
export default async function KaruteListPage() {
  const supabase = await createClient()

  const { data: records, error } = await supabase
    .from('karute_records')
    .select(
      `
      id,
      session_date,
      created_at,
      summary,
      transcript,
      staff_profile_id,
      customers:client_id ( id, name ),
      profiles:staff_profile_id ( id, full_name ),
      entries ( id )
    `,
    )
    .order('session_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const rows = karuteRecordsToRichRows(
    (records ?? []) as unknown as KaruteListRecord[],
  )

  return <KaruteListView rows={rows} />
}

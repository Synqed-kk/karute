import { createClient } from '@/lib/supabase/server'
import { KaruteListView } from '@/components/karute/KaruteListView'
import {
  karuteRecordsToRowData,
  type KaruteListRecord,
} from '@/lib/adapters/karute-list'

/**
 * Karute records list page at /[locale]/karute.
 *
 * Fetches all karute_records for the current user's business, ordered by
 * created_at descending. Renders via synqed-ui's KaruteListRow + chrome.
 */
export default async function KaruteListPage() {
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

  const rows = karuteRecordsToRowData(
    (records ?? []) as unknown as KaruteListRecord[],
  )

  return <KaruteListView rows={rows} />
}

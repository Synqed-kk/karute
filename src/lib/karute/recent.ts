import { getSynqedClient } from '@/lib/synqed/client'
import { getCachedCustomerList } from '@/lib/customers/cached'

export interface RecentKaruteForAI {
  id: string
  summary: string | null
  created_at: string
  customerName: string
  entries: { category: string; content: string }[]
}

/**
 * Recent karute records shaped for AI prompt context, read through synqed-core
 * (the source of truth) — not the empty legacy karute_records Supabase table.
 *
 * The list endpoint doesn't embed entries or customer names, so we resolve
 * names from the cached customer list and fetch each record's entries in
 * parallel. Bounded by `limit` (callers pass 5–10), and only hit from
 * rate-limited AI routes, so the extra gets are acceptable.
 */
export async function getRecentKaruteForAI(
  limit: number,
): Promise<RecentKaruteForAI[]> {
  const synqed = await getSynqedClient()
  const { karute_records } = await synqed.karuteRecords.list({
    page_size: limit,
  })
  if (karute_records.length === 0) return []

  const [customers, entriesPerRecord] = await Promise.all([
    getCachedCustomerList(),
    Promise.all(
      karute_records.map((r) =>
        synqed.karuteRecords
          .get(r.id, { include_entries: true })
          .then((full) => full.entries ?? [])
          .catch(() => []),
      ),
    ),
  ])
  const nameById = new Map(customers.map((c) => [c.id, c.name]))

  return karute_records.map((r, i) => ({
    id: r.id,
    summary: r.ai_summary,
    created_at: r.created_at,
    customerName: r.customer_id
      ? (nameById.get(r.customer_id) ?? 'Unknown')
      : 'Unknown',
    entries: entriesPerRecord[i].map((e) => ({
      category: e.category,
      content: e.content,
    })),
  }))
}

import 'server-only'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCachedCustomerList } from '@/lib/customers/cached'

export interface AiKaruteContextRow {
  id: string
  customerName: string
  createdAt: string
  summary: string | null
  entries: Array<{ category: string; content: string }>
}

/**
 * Recent karute records from synqed-core (the source of truth), with customer
 * names resolved — the context the AI insights + chat routes feed the model.
 *
 * Both routes previously read the EMPTY Supabase `karute_records` mirror, so the
 * AI had ZERO session data (insights returned nothing; chat had no context).
 * This reads synqed (where karute actually lives). Best-effort: [] on failure.
 */
export async function getRecentKaruteForAI(
  limit: number,
): Promise<AiKaruteContextRow[]> {
  try {
    const synqed = await getSynqedClient()
    const [res, customers] = await Promise.all([
      synqed.karuteRecords.list({ page_size: limit }),
      getCachedCustomerList(),
    ])
    const nameById = new Map(customers.map((c) => [c.id, c.name]))
    return (res.karute_records ?? [])
      .map((r) => ({
        id: r.id,
        customerName: r.customer_id
          ? (nameById.get(r.customer_id) ?? 'Unknown')
          : 'Unknown',
        createdAt: r.created_at,
        summary: r.ai_summary ?? null,
        // The list endpoint doesn't include per-entry detail (only entry_count),
        // so the AI context is summary-based — sufficient for insights/chat.
        entries: (r.entries ?? []).map((e) => ({
          category: String(e.category),
          content: e.content,
        })),
      }))
      // synqed-core already orders createdAt desc (karute.service.ts), but sort
      // defensively so "recent" can't silently become "oldest" if that changes.
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch (err) {
    console.error('[getRecentKaruteForAI] synqed fetch failed:', err)
    return []
  }
}

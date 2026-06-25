// synqed-core is the SOLE read source for karute records. The Supabase
// `karute_records` table is empty (every write goes to synqed-core) and is being
// dropped as part of the "no karute DB" consolidation. This module fetches from
// synqed-core and adapts to the shape the detail page + exporters consume. The
// filename/export names are retained to avoid churning the ~6 import sites; the
// implementation no longer touches Supabase.

/** A karute record with its related customer + entries — the shape consumed by
 *  the detail page, the PDF/text exporters, and the karute-detail adapters.
 *  Column names mirror the legacy Supabase read shape callers were built against:
 *    - customer_id   = tenant/business id
 *    - client_id     = the salon client this karute belongs to
 *    - staff_profile_id = the staff who ran the session */
export interface KaruteWithRelations {
  id: string
  created_at: string
  session_date: string | null
  summary: string | null
  transcript: string | null
  customer_id: string | null
  client_id: string | null
  staff_profile_id: string | null
  profiles: { id: string; full_name: string } | null
  customers: { id: string; name: string } | null
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

/**
 * Fetch a single karute record (with customer + entries) from synqed-core — the
 * authoritative write store. Returns null when the record doesn't exist (→ 404)
 * or on any error. Best-effort customer-name resolution via the cached synqed
 * customer list; staff name is unresolved here (synqed staff_id ≠ profile id) so
 * the header renders '—'. session_date isn't persisted on synqed-core, so the
 * header falls back to created_at.
 *
 * Lazy imports keep this module's graph free of the synqed-core ESM client for
 * callers/tests that never resolve a record.
 */
export async function getKaruteRecord(
  id: string,
): Promise<KaruteWithRelations | null> {
  try {
    const { getSynqedClient } = await import('@/lib/synqed/client')
    const synqed = await getSynqedClient()
    const rec = await synqed.karuteRecords.get(id).catch(() => null)
    if (!rec) return null

    const { getCachedCustomerList } = await import('@/lib/customers/cached')
    const customers = await getCachedCustomerList().catch(() => [])
    const customerName = rec.customer_id
      ? customers.find((c) => c.id === rec.customer_id)?.name ?? null
      : null

    return {
      id: rec.id,
      created_at: rec.created_at,
      // synqed-core has no session_date; the header falls back to created_at.
      session_date: null,
      summary: rec.ai_summary ?? null,
      transcript: rec.transcript ?? null,
      // Supabase column semantics: customer_id = tenant, client_id = the client.
      customer_id: rec.business_id ?? null,
      client_id: rec.customer_id ?? null,
      staff_profile_id: rec.staff_id ?? null,
      // staff name unresolved here (synqed staff_id ≠ profile id); header renders '—'.
      profiles: null,
      customers: rec.customer_id
        ? { id: rec.customer_id, name: customerName ?? '—' }
        : null,
      entries: (rec.entries ?? []).map((e) => ({
        id: e.id,
        // synqed entry categories are UPPERCASE; the UI adapters key on lowercase.
        category: e.category.toLowerCase(),
        content: e.content,
        source_quote: e.original_quote ?? null,
        confidence_score: e.confidence ?? null,
        is_manual: e.is_manual ?? false,
        created_at: e.created_at,
      })),
    }
  } catch (err) {
    console.error('[getKaruteRecord] synqed-core fetch failed:', err)
    return null
  }
}

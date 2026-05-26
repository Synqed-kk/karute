import { getSynqedClient } from '@/lib/synqed/client'
import { getStaffById } from '@/lib/staff'
import { SynqedError } from '@synqed-kk/client'

/**
 * Karute record + related customer/staff/entries, shaped for the detail page
 * and its adapters (`lib/adapters/karute-detail.ts`), the PDF/text exporters,
 * and `formatKaruteText`.
 *
 * Field names are the frontend's historical (legacy-Supabase) names so the
 * many consumers don't change:
 *   - client_id        = the individual salon client (synqed `customer_id`)
 *   - staff_profile_id = the staff who ran the session (synqed `staff_id`)
 *   - summary          = synqed `ai_summary`
 *   - session_date     = no dedicated column upstream; mirrors `created_at`
 */
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
    confidence_score: number
    is_manual: boolean
    created_at: string
  }>
}

/**
 * Fetch a single karute record with its customer, staff, and entries.
 *
 * Reads through synqed-core (the source of truth) rather than querying
 * `karute_records` directly in Supabase — that table is a legacy empty shell;
 * the live data lives in synqed-core, which is also where the save path writes
 * (`actions/karute.ts` → `synqed.karuteRecords.create`). synqed-core returns
 * `customer_id`/`staff_id`/`ai_summary`; we resolve the customer + staff names
 * and remap to the frontend's historical field names above.
 *
 * @returns null if no record exists with the given id (→ notFound() upstream).
 * @throws on any non-404 fetch failure (propagates to the error boundary).
 */
export async function getKaruteRecord(
  id: string,
): Promise<KaruteWithRelations | null> {
  const synqed = await getSynqedClient()

  let rec
  try {
    rec = await synqed.karuteRecords.get(id, { include_entries: true })
  } catch (err) {
    if (err instanceof SynqedError && err.status === 404) return null
    throw err
  }

  // Names aren't joined by synqed-core's get(); resolve them in parallel.
  const [staff, customer] = await Promise.all([
    getStaffById(rec.staff_id).catch(() => null),
    rec.customer_id
      ? synqed.customers
          .get(rec.customer_id)
          .then((c) => ({ id: c.id, name: c.name }))
          .catch(() => null)
      : Promise.resolve(null),
  ])

  return {
    id: rec.id,
    created_at: rec.created_at,
    session_date: rec.created_at,
    summary: rec.ai_summary,
    transcript: rec.transcript,
    customer_id: null,
    client_id: rec.customer_id,
    staff_profile_id: rec.staff_id,
    profiles: staff ? { id: staff.id, full_name: staff.full_name ?? '—' } : null,
    customers: customer,
    entries: (rec.entries ?? []).map((e) => ({
      id: e.id,
      category: e.category.toLowerCase(),
      content: e.content,
      source_quote: e.original_quote,
      confidence_score: e.confidence,
      is_manual: e.is_manual,
      created_at: e.created_at,
    })),
  }
}

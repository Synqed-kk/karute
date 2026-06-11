import type { SynqedClient } from '@synqed-kk/client'

/**
 * A karute row normalized to the Supabase `karute_records` read shape that the
 * karute list + customer session-history pages consume. Superset of both pages'
 * local row types (extra fields are ignored structurally).
 */
export interface KaruteListRow {
  id: string
  session_date: string | null
  created_at: string
  summary: string | null
  transcript: string | null
  staff_profile_id: string | null
  customer_id: string | null
  client_id: string
  entries: Array<{ count: number }>
  /** Session metadata persisted on synqed-core karute_records
   *  (2026-06-11). Optional: Supabase-side rows predate the columns. */
  service?: string | null
  duration_minutes?: number | null
}

/**
 * Lists karute records from synqed-core (the authoritative write store) as rows
 * shaped like the Supabase read. The page reads UNION these with the Supabase
 * query so karute created via synqed-core (manual create + recording saves)
 * actually appear in the list and in a customer's session history — the
 * Supabase `karute_records` table is effectively empty since every write goes
 * to synqed-core. Same read-migration pattern as the staff fix (#107) and the
 * karute detail fallback (#109).
 *
 * session_date / service / duration_minutes now persist on synqed-core
 * (2026-06-11 migration); the installed client types predate them, hence the
 * structural reads. `staff_profile_id` carries the synqed staff id (id-space
 * differs from profiles.id), so staff-name lookups may fall back to 'Unknown'
 * until the rename lands — non-fatal. Degrades to [] on any error.
 */
export async function listSynqedKaruteRows(
  synqed: SynqedClient,
  opts?: { customerId?: string },
): Promise<KaruteListRow[]> {
  try {
    const res = await synqed.karuteRecords.list({
      ...(opts?.customerId ? { customer_id: opts.customerId } : {}),
      page_size: 200,
    })
    return (res.karute_records ?? []).map((r) => {
      const extra = r as unknown as {
        session_date?: string | null
        service?: string | null
        duration_minutes?: number | null
      }
      return {
        id: r.id,
        session_date: extra.session_date ?? null,
        created_at: r.created_at,
        summary: r.ai_summary ?? null,
        transcript: r.transcript ?? null,
        staff_profile_id: r.staff_id ?? null,
        customer_id: r.business_id ?? null,
        client_id: r.customer_id ?? '',
        entries: [{ count: r.entry_count ?? r.entries?.length ?? 0 }],
        service: extra.service ?? null,
        duration_minutes: extra.duration_minutes ?? null,
      }
    })
  } catch (err) {
    console.error('[listSynqedKaruteRows] synqed-core fetch failed:', err)
    return []
  }
}

/**
 * Unions Supabase rows with synqed-core rows, de-duped by id (Supabase wins on
 * conflict), sorted by session_date ?? created_at descending, capped at `limit`.
 */
export function mergeKaruteRows<
  T extends { id: string; session_date: string | null; created_at: string },
>(supabaseRows: T[], synqedRows: T[], limit = 200): T[] {
  const seen = new Set(supabaseRows.map((r) => r.id))
  const merged = [...supabaseRows, ...synqedRows.filter((r) => !seen.has(r.id))]
  merged.sort((a, b) => {
    const da = a.session_date ?? a.created_at
    const db = b.session_date ?? b.created_at
    return db.localeCompare(da)
  })
  return merged.slice(0, limit)
}

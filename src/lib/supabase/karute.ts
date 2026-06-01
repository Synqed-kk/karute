import { createClient } from '@/lib/supabase/server'
import type { QueryData } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

/** Synchronous Supabase client type for QueryData inference (not called at runtime) */
type SyncSupabaseClient = ReturnType<typeof createServerClient<Database>>

/**
 * Reference query used to derive the KaruteWithRelations type.
 * Uses the synchronous client type for QueryData inference.
 * Not called directly — createClient() is called per-request inside getKaruteRecord().
 *
 * Column names match database.ts (Supabase CLI format):
 *  - client_id       = FK → customers.id (the individual salon client)
 *  - staff_profile_id = FK → profiles.id (the staff who ran the session)
 *  - session_date    = actual appointment date (timestamptz)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _karuteWithRelationsQuery = (supabase: SyncSupabaseClient) =>
  supabase
    .from('karute_records')
    .select(
      `
      id,
      created_at,
      session_date,
      summary,
      transcript,
      customer_id,
      client_id,
      staff_profile_id,
      profiles:staff_profile_id ( id, full_name ),
      customers:client_id ( id, name ),
      entries (
        id,
        category,
        content,
        source_quote,
        confidence_score,
        is_manual,
        created_at
      )
    `,
    )
    .eq('id', '')
    .single()

/** Inferred TypeScript type for a karute record with nested customer and entries */
export type KaruteWithRelations = QueryData<
  ReturnType<typeof _karuteWithRelationsQuery>
>

/**
 * Fetch a single karute record with its related customer and entries.
 * Entries are ordered by created_at ascending so AI entries (inserted first)
 * appear before manually added entries in a consistent order.
 *
 * @throws {Error} if Supabase returns an error (propagates to the page for error boundaries)
 * @returns null if no record found with the given id
 */
export async function getKaruteRecord(
  id: string,
): Promise<KaruteWithRelations | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('karute_records')
    .select(
      `
      id,
      created_at,
      session_date,
      summary,
      transcript,
      customer_id,
      client_id,
      staff_profile_id,
      profiles:staff_profile_id ( id, full_name ),
      customers:client_id ( id, name ),
      entries (
        id,
        category,
        content,
        source_quote,
        confidence_score,
        is_manual,
        created_at
      )
    `,
    )
    .eq('id', id)
    .order('created_at', { foreignTable: 'entries', ascending: true })
    .single()

  if (error) {
    // PGRST116 = "The result contains 0 rows". The record may have been written
    // to synqed-core (manual create via createManualKaruteRecord, or a recording
    // save via saveKaruteRecord) and not yet mirrored into Supabase. Fall back to
    // synqed-core so a freshly-created karute resolves instead of 404ing. Mirrors
    // the staff-roster read fix (#107) — synqed-core is the authoritative write
    // target; Supabase is the (still-being-migrated) read store.
    if (error.code === 'PGRST116') return getKaruteRecordFromSynqed(id)
    throw new Error(error.message)
  }

  return data
}

/**
 * Synqed-core fallback for getKaruteRecord. Fetches the karute from synqed-core
 * (the write target) and adapts it to the Supabase KaruteWithRelations shape the
 * detail page consumes. Returns null only when the record genuinely doesn't
 * exist in either store (→ real 404). Best-effort customer-name resolution via
 * the cached synqed customer list; staff name falls back to '—'.
 *
 * Lazy imports keep this module's graph free of the synqed-core ESM client for
 * callers/tests that never hit the fallback.
 */
async function getKaruteRecordFromSynqed(
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

    const adapted = {
      id: rec.id,
      created_at: rec.created_at,
      // synqed-core has no session_date; the header falls back to created_at.
      session_date: null,
      summary: rec.ai_summary,
      transcript: rec.transcript,
      // Supabase column semantics: customer_id = tenant, client_id = the client.
      customer_id: rec.business_id,
      client_id: rec.customer_id,
      staff_profile_id: rec.staff_id,
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
        source_quote: e.original_quote,
        confidence_score: e.confidence,
        is_manual: e.is_manual,
        created_at: e.created_at,
      })),
    }

    return adapted as unknown as KaruteWithRelations
  } catch (err) {
    console.error('[getKaruteRecord] synqed-core fallback failed:', err)
    return null
  }
}

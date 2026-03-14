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
    // PGRST116 = "The result contains 0 rows" — return null for notFound() handling
    if (error.code === 'PGRST116') return null
    throw new Error(error.message)
  }

  return data
}

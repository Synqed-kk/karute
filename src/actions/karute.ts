'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getActiveStaffId } from '@/lib/staff'
import type { SaveKaruteInput } from '@/types/karute'

/**
 * Save a karute record with all AI-extracted entries.
 *
 * Pattern: sequential inserts with cleanup on failure.
 * Step 1: Insert karute_records row, capture new ID.
 * Step 2: Bulk-insert all entries with that karute_record_id.
 * Cleanup: If entries insert fails, delete the orphaned karute_records row.
 *
 * IMPORTANT: redirect() is called OUTSIDE the try/catch block.
 * redirect() throws a Next.js control-flow exception that would be swallowed
 * by try/catch, silently preventing navigation.
 *
 * Schema note (001_initial_schema.sql):
 * - client_id: FK → customers.id (the individual salon client)
 * - customer_id: business tenant UUID (for RLS, from profiles.customer_id)
 * - staff_profile_id: FK → profiles.id
 */
export async function saveKaruteRecord(
  input: SaveKaruteInput,
): Promise<{ error: string } | void> {
  const supabase = await createClient()

  let recordId: string

  try {
    // Read staff_id from the active-staff cookie — never accept it from client.
    const staffProfileId = await getActiveStaffId()

    if (!staffProfileId) {
      return { error: 'No active staff member selected. Please select a staff member from the header.' }
    }

    // Step 1: Insert the karute record and get its generated ID.
    // customer_id = business tenant UUID (for RLS) — use input.customerId as proxy.
    // client_id   = FK → customers.id (the individual salon client).
    const { data: record, error: recordError } = await supabase
      .from('karute_records')
      .insert({
        customer_id: input.customerId,
        client_id: input.customerId,
        staff_profile_id: staffProfileId,
        transcript: input.transcript,
        summary: input.summary,
      })
      .select('id')
      .single()

    if (recordError) {
      return { error: recordError.message }
    }

    recordId = record.id

    // Step 2: Bulk-insert all AI-extracted entries linked to the new record
    const { error: entriesError } = await supabase.from('entries').insert(
      input.entries.map((entry) => ({
        karute_record_id: recordId,
        category: entry.category,
        content: entry.content,
        source_quote: entry.sourceQuote ?? null,
        confidence_score: entry.confidenceScore,
        is_manual: false,
      })),
    )

    if (entriesError) {
      // Cleanup: delete the orphaned karute_records row so the customer's
      // history doesn't show a record with no entries
      await supabase
        .from('karute_records')
        .delete()
        .eq('id', recordId)

      return { error: entriesError.message }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unexpected error' }
  }

  // revalidate and redirect OUTSIDE try/catch — redirect() throws internally
  revalidatePath(`/customers/${input.customerId}`)
  redirect(`/karute/${recordId}`)
}

/**
 * Same as saveKaruteRecord but returns the record ID instead of redirecting.
 * Used by the RecordingPanel which stays on the appointments page.
 */
export async function saveKaruteRecordInline(
  input: SaveKaruteInput,
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient()

  const staffProfileId = await getActiveStaffId()
  if (!staffProfileId) {
    return { error: 'No active staff member selected.' }
  }

  const { data: record, error: recordError } = await supabase
    .from('karute_records')
    .insert({
      customer_id: input.customerId,
      client_id: input.customerId,
      staff_profile_id: staffProfileId,
      transcript: input.transcript,
      summary: input.summary,
    })
    .select('id')
    .single()

  if (recordError) return { error: recordError.message }

  const { error: entriesError } = await supabase.from('entries').insert(
    input.entries.map((entry) => ({
      karute_record_id: record.id,
      category: entry.category,
      content: entry.content,
      source_quote: entry.sourceQuote ?? null,
      confidence_score: entry.confidenceScore,
      is_manual: false,
    })),
  )

  if (entriesError) {
    await supabase.from('karute_records').delete().eq('id', record.id)
    return { error: entriesError.message }
  }

  revalidatePath(`/customers/${input.customerId}`)
  return { id: record.id }
}

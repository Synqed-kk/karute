'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { AddEntryInput } from '@/types/karute'
import { getTenantId } from '@/lib/staff'

/**
 * Add a single manual entry to an existing karute record.
 * Manual entries: is_manual=true, confidence_score=null, source_quote=null.
 * Staff use this to capture entries the AI missed during review.
 */
export async function addManualEntry(
  input: AddEntryInput,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const tenantId = await getTenantId()

  const { error } = await supabase.from('entries').insert({
    karute_record_id: input.karuteRecordId,
    customer_id: tenantId,
    category: input.category,
    content: input.content,
    is_manual: true,
    confidence_score: null,
    source_quote: null,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/karute/${input.karuteRecordId}`)
  return {}
}

/**
 * Delete an entry from a karute record.
 * Revalidates the karute detail page after deletion.
 */
export async function deleteEntry(
  entryId: string,
  karuteRecordId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('entries')
    .delete()
    .eq('id', entryId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/karute/${karuteRecordId}`)
  return {}
}

'use server'

import { revalidatePath } from 'next/cache'
import { getSynqedClient } from '@/lib/synqed/client'
import { requireCapability } from '@/lib/auth/require-permission'
import type { AddEntryInput } from '@/types/karute'

/**
 * Add a single manual entry to an existing karute record.
 * Manual entries: is_manual=true, confidence=null, original_quote=null.
 */
export async function addManualEntry(
  input: AddEntryInput,
): Promise<{ error?: string }> {
  try {
    // Editing a karute's entries = records.write. Thrown → caught below → house
    // { error } shape the AddEntryForm already toasts.
    await requireCapability('records.write')

    const synqed = await getSynqedClient()
    await synqed.karuteRecords.addEntry(input.karuteRecordId, {
      category: input.category.toUpperCase() as 'SYMPTOM' | 'TREATMENT' | 'BODY_AREA' | 'PREFERENCE' | 'LIFESTYLE' | 'NEXT_VISIT' | 'PRODUCT' | 'OTHER',
      content: input.content,
      is_manual: true,
      confidence: null,
      original_quote: null,
    })
    revalidatePath(`/karute/${input.karuteRecordId}`)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Delete an entry from a karute record.
 */
export async function deleteEntry(
  entryId: string,
  karuteRecordId: string,
): Promise<{ error?: string }> {
  try {
    // Removing a single entry is part of EDITING a record (curating its entries),
    // not deleting the whole karute — so records.write, same as adding one. The
    // practitioner who wrote the record can fix a wrong entry. Thrown → caught
    // below → house { error } shape.
    await requireCapability('records.write')

    const synqed = await getSynqedClient()
    await synqed.karuteRecords.deleteEntry(karuteRecordId, entryId)
    revalidatePath(`/karute/${karuteRecordId}`)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

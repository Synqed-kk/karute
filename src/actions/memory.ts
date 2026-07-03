'use server'

// Staff-owned customer-memory mutations (pin / edit / soft-delete / manual
// add). The customer_memory_items schema anticipated these from day one
// (source='staff' in the check, `pinned` column, soft `deleted_at`) — the
// blocking dialog claiming this needed core-side work was stale. Any staff
// may curate memory (it's care work, not an admin privilege); the AI delta
// path stays scoped to source='ai_extraction' and never touches these rows.

import { revalidatePath } from 'next/cache'
import { getLocale } from 'next-intl/server'
import { getBusinessId } from '@/lib/staff'
import {
  addStaffMemoryItem,
  setMemoryItemPinned,
  softDeleteAiExtractionItems,
  softDeleteMemoryItem,
  updateMemoryItem,
} from '@/lib/karute/customer-memory'
import type { MemoryItem } from '@/lib/karute/memory-types'

const revalidateProfile = () =>
  revalidatePath('/[locale]/(app)/customers/[id]', 'page')

const CATEGORIES: MemoryItem['category'][] = [
  'personal',
  'body',
  'preference',
  'goal',
  'lifestyle',
]

export async function addMemoryItemAction(input: {
  customerId: string
  category: MemoryItem['category']
  label: string
  detail?: string | null
}): Promise<{ ok: boolean }> {
  const label = input.label?.trim()
  if (!input.customerId || !label) return { ok: false }
  if (!CATEGORIES.includes(input.category)) return { ok: false }
  const businessId = await getBusinessId().catch(() => null)
  const result = await addStaffMemoryItem({
    customerId: input.customerId,
    businessId,
    category: input.category,
    label,
    detail: input.detail?.trim() || null,
  })
  if (result.ok) revalidateProfile()
  return { ok: result.ok }
}

export async function updateMemoryItemAction(input: {
  id: string
  label: string
  detail?: string | null
}): Promise<{ ok: boolean }> {
  const label = input.label?.trim()
  if (!input.id || !label) return { ok: false }
  const result = await updateMemoryItem(input.id, {
    label,
    detail: input.detail?.trim() || null,
  })
  if (result.ok) revalidateProfile()
  return result
}

export async function toggleMemoryPinAction(
  id: string,
  pinned: boolean,
): Promise<{ ok: boolean }> {
  if (!id) return { ok: false }
  const result = await setMemoryItemPinned(id, pinned)
  if (result.ok) revalidateProfile()
  return result
}

export async function deleteMemoryItemAction(id: string): Promise<{ ok: boolean }> {
  if (!id) return { ok: false }
  const result = await softDeleteMemoryItem(id)
  if (result.ok) revalidateProfile()
  return result
}


/**
 * 再学習 — rebuild this customer's AI memory from their transcripts with the
 * CURRENT prompt. Wipes only the AI's own unpinned items (staff-added, pinned,
 * and staff-edited items survive), then re-runs the same backfill the profile
 * page bootstraps with. Existing customers get today's extraction quality on
 * demand instead of waiting for their next session.
 */
export async function relearnCustomerMemoryAction(
  customerId: string,
): Promise<{ ok: boolean; items: number }> {
  if (!customerId) return { ok: false, items: 0 }
  try {
    const [{ getSynqedClient }, { listSynqedKaruteRows }, { backfillMemoryFromTranscripts }] =
      await Promise.all([
        import('@/lib/synqed/client'),
        import('@/lib/karute/synqed-records'),
        import('@/lib/karute/memory-ingest'),
      ])
    const synqed = await getSynqedClient()
    const rows = await listSynqedKaruteRows(synqed, { customerId })
    const transcripts = rows.map((r) => r.transcript ?? '').filter((t) => t.trim())
    if (transcripts.length === 0) return { ok: false, items: 0 }

    const wiped = await softDeleteAiExtractionItems(customerId)
    if (!wiped.ok) return { ok: false, items: 0 }

    const businessId = await getBusinessId().catch(() => null)
    const items = await backfillMemoryFromTranscripts({
      customerId,
      businessId,
      transcripts,
      locale: await getLocale(),
    })
    revalidateProfile()
    return { ok: true, items: items.length }
  } catch (err) {
    console.error('[relearnCustomerMemoryAction] failed:', err)
    return { ok: false, items: 0 }
  }
}

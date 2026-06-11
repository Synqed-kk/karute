'use server'

// Staff-owned customer-memory mutations (pin / edit / soft-delete / manual
// add). The customer_memory_items schema anticipated these from day one
// (source='staff' in the check, `pinned` column, soft `deleted_at`) — the
// blocking dialog claiming this needed core-side work was stale. Any staff
// may curate memory (it's care work, not an admin privilege); the AI delta
// path stays scoped to source='ai_extraction' and never touches these rows.

import { revalidatePath } from 'next/cache'
import { getBusinessId } from '@/lib/staff'
import {
  addStaffMemoryItem,
  setMemoryItemPinned,
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

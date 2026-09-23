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
import type { MemoryItem } from '@/lib/karute/memory-types'
// The six WithClient cores live in a server-only module (PKT-SEC-CORES-D3,
// 2026-09-23): every runtime export of this 'use server' file is a
// browser-callable endpoint, so only the web actions below stay here.
import {
  addMemoryItemWithClient,
  deleteMemoryItemWithClient,
  relearnCustomerMemoryWithClient,
  toggleMemoryPinWithClient,
  updateMemoryItemWithClient,
  upsertPassportFieldWithClient,
} from '@/lib/customers/memory.core'

const revalidateProfile = () =>
  revalidatePath('/[locale]/(app)/customers/[id]', 'page')

// ── Web server actions (cookie identity → delegate to the cores) ─────────────

export async function addMemoryItemAction(input: {
  customerId: string
  category: MemoryItem['category']
  label: string
  detail?: string | null
}): Promise<{ ok: boolean }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  const [synqed, businessId] = await Promise.all([getSynqedClient(), getBusinessId().catch(() => null)])
  const result = await addMemoryItemWithClient(synqed, businessId, input)
  if (result.ok) revalidateProfile()
  return result
}

export async function updateMemoryItemAction(input: {
  id: string
  label: string
  detail?: string | null
}): Promise<{ ok: boolean }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  const result = await updateMemoryItemWithClient(await getSynqedClient(), input)
  if (result.ok) revalidateProfile()
  return result
}

export async function toggleMemoryPinAction(id: string, pinned: boolean): Promise<{ ok: boolean }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  const result = await toggleMemoryPinWithClient(await getSynqedClient(), id, pinned)
  if (result.ok) revalidateProfile()
  return result
}

export async function deleteMemoryItemAction(id: string): Promise<{ ok: boolean }> {
  const { getSynqedClient } = await import('@/lib/synqed/client')
  const result = await deleteMemoryItemWithClient(await getSynqedClient(), id)
  if (result.ok) revalidateProfile()
  return result
}

export async function relearnCustomerMemoryAction(
  customerId: string,
): Promise<{ ok: boolean; items: number; locked?: boolean }> {
  const [{ getSynqedClient }, { featureAllowed }] = await Promise.all([
    import('@/lib/synqed/client'),
    import('@/lib/subscription/feature-gate'),
  ])
  const { canUseDevRegen } = await import('@/actions/dev-tools')
  const [synqed, businessId, locale, planAllowed, regenAllowed] = await Promise.all([
    getSynqedClient(),
    getBusinessId().catch(() => null),
    getLocale(),
    featureAllowed('customerMemoryAutoExtract'),
    canUseDevRegen(),
  ])
  const result = await relearnCustomerMemoryWithClient(
    synqed,
    { businessId, locale, planAllowed, regenAllowed },
    customerId,
  )
  if (result.ok) revalidateProfile()
  return result
}

export async function upsertPassportFieldAction(input: {
  customerId: string
  fieldKey: string
  value: string
}): Promise<{ ok: boolean }> {
  const [{ getSynqedClient }, { getOrgSettings }] = await Promise.all([
    import('@/lib/synqed/client'),
    import('@/actions/org-settings'),
  ])
  const [synqed, businessId, orgSettings] = await Promise.all([
    getSynqedClient(),
    getBusinessId().catch(() => null),
    getOrgSettings().catch(() => null),
  ])
  const result = await upsertPassportFieldWithClient(synqed, businessId, orgSettings?.business_type, input)
  if (result.ok) revalidateProfile()
  return result
}

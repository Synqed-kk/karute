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
  getMemoryItemCustomerId,
  restoreMemoryItems,
  setMemoryItemPinned,
  softDeleteAiExtractionItems,
  softDeleteMemoryItem,
  updateMemoryItem,
  upsertPassportField,
} from '@/lib/karute/customer-memory'
import type { MemoryItem } from '@/lib/karute/memory-types'
// Type-only (erased at runtime — preserves this file's dynamic-import discipline;
// the client itself is imported dynamically inside the web wrappers below).
import type { getSynqedClient } from '@/lib/synqed/client'

/** Business-scoped client — the ownership oracle threaded through every core so
 *  the cookie web path and the Bearer facade path share ONE tenancy gate. */
type ScopedClient = Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>
type FullClient = Awaited<ReturnType<typeof getSynqedClient>>

const revalidateProfile = () =>
  revalidatePath('/[locale]/(app)/customers/[id]', 'page')

// ── Tenant guard (customer-data isolation) ──────────────────────────────────
// The memory mutations below run on the RLS-bypassing service client, keyed
// only by a client-supplied id/customerId. Without an app-level ownership check
// a staff member at business A could edit/pin/delete a memory item (or write to
// a customer) at business B by supplying its id. getCustomer() resolves through
// the business-scoped core client, so it rejects any customer outside the
// caller's business — making it the ownership oracle for both cases.

/** True when this business-scoped client owns the customer — a cross-tenant id
 *  reads as not-found through the business-scoped core client. The ownership
 *  oracle for the customerId-addressed writes, on BOTH identity paths. */
async function ownsCustomerWithClient(synqed: ScopedClient, customerId: string): Promise<boolean> {
  const { getCustomerWithClient } = await import('@/lib/customers/queries')
  return !!(await getCustomerWithClient(synqed, customerId).catch(() => null))
}

/** True when the client's business owns the customer this memory item belongs to.
 *  Missing item or a cross-tenant item id → false (→ not_found on the facade). */
async function ownsMemoryItemWithClient(synqed: ScopedClient, id: string): Promise<boolean> {
  const customerId = await getMemoryItemCustomerId(id)
  if (!customerId) return false
  return ownsCustomerWithClient(synqed, customerId)
}

const CATEGORIES: MemoryItem['category'][] = [
  'personal',
  'body',
  'preference',
  'goal',
  'lifestyle',
]

// ── WithClient cores (SINGLE SOURCE) ─────────────────────────────────────────
// Each core takes the business-scoped client (ownership oracle) + explicit
// identity, runs the SAME validation + ownership guard + service-role write, and
// returns WITHOUT revalidating (a web-only concern). The web actions wrap with
// the cookie client + revalidateProfile; the facade routes wrap with
// newSynqedClient(businessId). Logic lives HERE, never copied into a route.

export async function addMemoryItemWithClient(
  synqed: ScopedClient,
  businessId: string | null,
  input: {
    customerId: string
    category: MemoryItem['category']
    label: string
    detail?: string | null
  },
): Promise<{ ok: boolean }> {
  const label = input.label?.trim()
  if (!input.customerId || !label) return { ok: false }
  if (!CATEGORIES.includes(input.category)) return { ok: false }
  if (!(await ownsCustomerWithClient(synqed, input.customerId))) return { ok: false }
  const result = await addStaffMemoryItem({
    customerId: input.customerId,
    businessId,
    category: input.category,
    label,
    detail: input.detail?.trim() || null,
  })
  return { ok: result.ok }
}

export async function updateMemoryItemWithClient(
  synqed: ScopedClient,
  input: { id: string; label: string; detail?: string | null },
): Promise<{ ok: boolean }> {
  const label = input.label?.trim()
  if (!input.id || !label) return { ok: false }
  if (!(await ownsMemoryItemWithClient(synqed, input.id))) return { ok: false }
  return updateMemoryItem(input.id, { label, detail: input.detail?.trim() || null })
}

export async function toggleMemoryPinWithClient(
  synqed: ScopedClient,
  id: string,
  pinned: boolean,
): Promise<{ ok: boolean }> {
  if (!id) return { ok: false }
  if (!(await ownsMemoryItemWithClient(synqed, id))) return { ok: false }
  return setMemoryItemPinned(id, pinned)
}

export async function deleteMemoryItemWithClient(
  synqed: ScopedClient,
  id: string,
): Promise<{ ok: boolean }> {
  if (!id) return { ok: false }
  if (!(await ownsMemoryItemWithClient(synqed, id))) return { ok: false }
  return softDeleteMemoryItem(id)
}

/** Staff edit of a passport field. `businessType` (org-settings) is threaded so
 *  the allowlist resolves identically on both paths; keys are locale-invariant
 *  so the JA definition set is canonical. */
export async function upsertPassportFieldWithClient(
  synqed: ScopedClient,
  businessId: string | null,
  businessType: string | null | undefined,
  input: { customerId: string; fieldKey: string; value: string },
): Promise<{ ok: boolean }> {
  const value = input.value?.trim()
  if (!input.customerId || !input.fieldKey || !value) return { ok: false }
  if (!(await ownsCustomerWithClient(synqed, input.customerId))) return { ok: false }
  const { resolvePassportFields } = await import('@/lib/karute/business-ai-tokens')
  const allowedKeys = new Set(
    resolvePassportFields(businessType ?? null, 'ja').map((f) => f.key),
  )
  if (!allowedKeys.has(input.fieldKey)) return { ok: false }
  const result = await upsertPassportField({
    customerId: input.customerId,
    businessId,
    fieldKey: input.fieldKey,
    value,
  })
  return { ok: result.ok }
}

/**
 * 再学習 core — rebuild this customer's AI memory from transcripts with the
 * CURRENT prompt. Wipes only the AI's own unpinned items, then re-runs the
 * backfill the profile page bootstraps with. `planAllowed` is resolved by the
 * caller with ITS identity (web → featureAllowed; facade →
 * featureAllowedForBusiness) and checked BEFORE the wipe. The wipe→restore
 * safety (any throw after a non-empty wipe restores) is preserved.
 */
export async function relearnCustomerMemoryWithClient(
  synqed: FullClient,
  opts: { businessId: string | null; locale: string; planAllowed: boolean },
  customerId: string,
): Promise<{ ok: boolean; items: number; locked?: boolean }> {
  if (!customerId) return { ok: false, items: 0 }
  let wipedIds: string[] = []
  try {
    const [{ listSynqedKaruteRows }, { backfillMemoryFromTranscripts }] = await Promise.all([
      import('@/lib/karute/synqed-records'),
      import('@/lib/karute/memory-ingest'),
    ])
    const rows = await listSynqedKaruteRows(synqed, { customerId })
    const transcripts = rows.map((r) => r.transcript ?? '').filter((t) => t.trim())
    if (transcripts.length === 0) return { ok: false, items: 0 }

    // Plan gate — BEFORE the wipe (a locked plan leaves memory untouched).
    if (!opts.planAllowed) return { ok: false, items: 0, locked: true }

    const wiped = await softDeleteAiExtractionItems(customerId)
    if (!wiped.ok) return { ok: false, items: 0 }
    wipedIds = wiped.ids

    const [{ generateCustomerPassport }, { getCustomerWithClient }] = await Promise.all([
      import('@/lib/karute/ai-passport'),
      import('@/lib/customers/queries'),
    ])
    const [items, customer] = await Promise.all([
      backfillMemoryFromTranscripts({ customerId, businessId: opts.businessId, transcripts, locale: opts.locale }),
      getCustomerWithClient(synqed, customerId).catch(() => null),
    ])
    if (items.length === 0 && wipedIds.length > 0) {
      await restoreMemoryItems(wipedIds)
      return { ok: false, items: 0 }
    }
    const { memoContent } = await import('@/lib/sync/qr-notes')
    await generateCustomerPassport({
      customerId,
      customerName: customer?.name ?? '',
      transcripts,
      intakeMemo: memoContent(customer?.notes),
      locale: opts.locale,
    }).catch(() => null)
    return { ok: true, items: items.length }
  } catch (err) {
    console.error('[relearnCustomerMemoryWithClient] failed:', err)
    if (wipedIds.length > 0) await restoreMemoryItems(wipedIds).catch(() => {})
    return { ok: false, items: 0 }
  }
}

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
  const [synqed, businessId, locale, planAllowed] = await Promise.all([
    getSynqedClient(),
    getBusinessId().catch(() => null),
    getLocale(),
    featureAllowed('customerMemoryAutoExtract'),
  ])
  const result = await relearnCustomerMemoryWithClient(synqed, { businessId, locale, planAllowed }, customerId)
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

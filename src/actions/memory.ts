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

const revalidateProfile = () =>
  revalidatePath('/[locale]/(app)/customers/[id]', 'page')

// ── Tenant guard (customer-data isolation) ──────────────────────────────────
// The memory mutations below run on the RLS-bypassing service client, keyed
// only by a client-supplied id/customerId. Without an app-level ownership check
// a staff member at business A could edit/pin/delete a memory item (or write to
// a customer) at business B by supplying its id. getCustomer() resolves through
// the business-scoped core client, so it rejects any customer outside the
// caller's business — making it the ownership oracle for both cases.

/** True when the caller's business owns the customer this memory item belongs
 *  to. False when the item is missing or belongs to another business. */
async function callerOwnsMemoryItem(id: string): Promise<boolean> {
  const customerId = await getMemoryItemCustomerId(id)
  if (!customerId) return false
  return callerOwnsCustomer(customerId)
}

/** True when the caller's business owns this customer (business-scoped lookup
 *  rejects a cross-tenant id). Used for the customerId-addressed writes. */
async function callerOwnsCustomer(customerId: string): Promise<boolean> {
  const { getCustomer } = await import('@/lib/customers/queries')
  const customer = await getCustomer(customerId).catch(() => null)
  return !!customer
}

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
  if (!(await callerOwnsCustomer(input.customerId))) return { ok: false }
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
  if (!(await callerOwnsMemoryItem(input.id))) return { ok: false }
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
  if (!(await callerOwnsMemoryItem(id))) return { ok: false }
  const result = await setMemoryItemPinned(id, pinned)
  if (result.ok) revalidateProfile()
  return result
}

export async function deleteMemoryItemAction(id: string): Promise<{ ok: boolean }> {
  if (!id) return { ok: false }
  if (!(await callerOwnsMemoryItem(id))) return { ok: false }
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
): Promise<{ ok: boolean; items: number; locked?: boolean }> {
  if (!customerId) return { ok: false, items: 0 }
  // Tracked outside the try so the catch can restore too — ANY throw after a
  // successful wipe (locale lookup, import, network) must not leave the
  // customer's memory empty.
  let wipedIds: string[] = []
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

    // Plan gate (P4): checked BEFORE the wipe — a locked plan must return with
    // the customer's memory untouched (backfill would silently skip and the
    // restore path would have to undo an avoidable wipe). `locked` lets the
    // button show honest upgrade copy instead of a generic failure.
    const { featureAllowed } = await import('@/lib/subscription/feature-gate')
    if (!(await featureAllowed('customerMemoryAutoExtract'))) {
      return { ok: false, items: 0, locked: true }
    }

    const wiped = await softDeleteAiExtractionItems(customerId)
    if (!wiped.ok) return { ok: false, items: 0 }
    wipedIds = wiped.ids

    const businessId = await getBusinessId().catch(() => null)
    const locale = await getLocale()
    // Passport (これまで box) regenerates alongside the memory items — same
    // sources, same tap. Best-effort: a passport failure never fails 再学習.
    const [{ generateCustomerPassport }, { getCustomer }] = await Promise.all([
      import('@/lib/karute/ai-passport'),
      import('@/lib/customers/queries'),
    ])
    const [items, customer] = await Promise.all([
      backfillMemoryFromTranscripts({ customerId, businessId, transcripts, locale }),
      getCustomer(customerId).catch(() => null),
    ])
    // Wipe→backfill isn't atomic. backfill is best-effort ([] on any internal
    // failure), so an empty result after a non-empty wipe means the re-learn
    // FAILED — restore the wiped items instead of leaving the memory empty.
    // (Checked BEFORE the passport spends tokens on a failed run.)
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
      locale,
    }).catch(() => null)
    revalidateProfile()
    return { ok: true, items: items.length }
  } catch (err) {
    console.error('[relearnCustomerMemoryAction] failed:', err)
    if (wipedIds.length > 0) await restoreMemoryItems(wipedIds).catch(() => {})
    return { ok: false, items: 0 }
  }
}

/** Staff edit of a passport field — durable human truth (source='staff',
 *  pinned). The AI passport renders underneath but never overrides it. */
export async function upsertPassportFieldAction(input: {
  customerId: string
  fieldKey: string
  value: string
}): Promise<{ ok: boolean }> {
  const value = input.value?.trim()
  if (!input.customerId || !input.fieldKey || !value) return { ok: false }
  if (!(await callerOwnsCustomer(input.customerId))) return { ok: false }
  // Only known passport field keys are storable — an arbitrary string would
  // create orphan rows no UI ever renders. Keys are locale-invariant, so the
  // JA definition set is the canonical allowlist.
  const [{ resolvePassportFields }, { getOrgSettings }] = await Promise.all([
    import('@/lib/karute/business-ai-tokens'),
    import('@/actions/org-settings'),
  ])
  const orgSettings = await getOrgSettings().catch(() => null)
  const allowedKeys = new Set(
    resolvePassportFields(orgSettings?.business_type, 'ja').map((f) => f.key),
  )
  if (!allowedKeys.has(input.fieldKey)) return { ok: false }
  const businessId = await getBusinessId().catch(() => null)
  const result = await upsertPassportField({
    customerId: input.customerId,
    businessId,
    fieldKey: input.fieldKey,
    value,
  })
  if (result.ok) revalidateProfile()
  return { ok: result.ok }
}

import 'server-only'

// The six client-threaded customer-memory cores, moved out of
// src/actions/memory.ts (PKT-SEC-CORES-D3, 2026-09-23). Every runtime export
// of a 'use server' module is registered as a browser-callable server action
// with no authentication of its own — and passing a client object as the first
// argument is no barrier, because the reply decoder revives nested references.
// These six are INTERNAL helpers: they take an already-scoped client and trust
// the caller to have gated the request. They live here, in a server-only module
// with NO directive, so the only way in is a server-side import — the web
// actions in src/actions/memory.ts and the facade routes under
// src/app/api/app/v1/customers/[id]/ (memory POST, memory/[itemId]
// PATCH/DELETE, memory/relearn, passport).
//
// The tenant guard and the category list the six need came with them;
// revalidateProfile (Next cache) is a web-wrapper concern and stayed behind.

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
// Type-only (erased at runtime — the cores never construct the cookie-session
// client; callers thread their own).
import type { getSynqedClient } from '@/lib/synqed/client'

/** Business-scoped client — the ownership oracle threaded through every core so
 *  the cookie web path and the Bearer facade path share ONE tenancy gate. */
type ScopedClient = Pick<Awaited<ReturnType<typeof getSynqedClient>>, 'customers'>
type FullClient = Awaited<ReturnType<typeof getSynqedClient>>

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
  opts: {
    businessId: string | null
    locale: string
    planAllowed: boolean
    /** Dev-tool gate (Liam 2026-07-16): the owner, or a person the owner gave
     *  BOTH keys by hand (see actions/dev-tools.ts). Fail-closed check below. */
    regenAllowed: boolean
  },
  customerId: string,
): Promise<{ ok: boolean; items: number; locked?: boolean }> {
  if (!customerId) return { ok: false, items: 0 }
  // 再学習 is gated to the owner, or a person the owner gave BOTH keys by hand
  // (see actions/dev-tools.ts) — Liam 2026-07-16: its cost scales with the
  // customer's ENTIRE session history and it reads raw transcripts. The gate is an
  // EXPLICIT caller-proven flag because the two worlds prove it differently —
  // cookie path: canUseDevRegen() (dev-tools.ts); Bearer facade: the SAME two
  // capability keys off the verified token. Fail closed here so no caller can
  // skip the decision.
  if (!opts.regenAllowed) return { ok: false, items: 0 }
  // Tracked outside the try so the catch can restore too — ANY throw after a
  // successful wipe (locale lookup, import, network) must not leave the
  // customer's memory empty.
  let wipedIds: string[] = []
  try {
    const [{ listSynqedKaruteRows }, { backfillMemoryFromTranscripts }] = await Promise.all([
      import('@/lib/karute/synqed-records'),
      import('@/lib/karute/memory-ingest'),
    ])
    const rows = await listSynqedKaruteRows(synqed, { customerId })
    // Newest-first — backfill's contract (its over-cap keep + oldest→newest
    // chunk processing both assume it; core's list order is not guaranteed).
    rows.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    const transcripts = rows
      .map((r) => ({ text: r.transcript ?? '', date: r.session_date ?? r.created_at ?? null }))
      .filter((t) => t.text.trim())
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
      // The passport prompt takes bare strings (its own cache/versioning
      // lane); the dated objects exist for the memory backfill above.
      transcripts: transcripts.map((t) => t.text),
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

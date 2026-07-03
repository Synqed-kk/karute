import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import type { MemoryItem, MemoryDeltaOp } from './memory-types'

const TABLE = 'customer_memory_items'

/**
 * The customer's living memory — durable facts accumulated across sessions.
 * Read from the transitional Supabase table. Best-effort: returns [] if the
 * table doesn't exist yet (migration not applied) or on any error, so callers
 * never break.
 */
export async function getCustomerMemory(
  customerId: string,
): Promise<MemoryItem[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createServiceClient() as any
    const { data, error } = await sb
      .from(TABLE)
      .select(
        'id, category, label, detail, source, confidence, pinned, suggest_talking_point, updated_at',
      )
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
    if (error || !data) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((r) => ({
      id: r.id,
      category: r.category,
      label: r.label,
      detail: r.detail ?? null,
      source: r.source,
      confidence: r.confidence ?? 0.8,
      pinned: !!r.pinned,
      suggestTalkingPoint: !!r.suggest_talking_point,
      updatedAt: r.updated_at ?? '',
    }))
  } catch (err) {
    console.error('[getCustomerMemory] failed (table may not exist yet):', err)
    return []
  }
}

/**
 * Apply an extractor delta. The AI only ever touches its OWN items
 * (source='ai_extraction', not pinned) — staff-pinned + intake-form items are
 * human-owned and protected at the query level. Best-effort: silently no-ops if
 * the table is absent. Never throws (the caller is a best-effort save hook).
 */
export async function applyMemoryDelta(params: {
  customerId: string
  businessId?: string | null
  ops: MemoryDeltaOp[]
}): Promise<void> {
  const { customerId, businessId, ops } = params
  if (!ops.length) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createServiceClient() as any
    const nowIso = new Date().toISOString()
    for (const op of ops) {
      // Confidence floor enforced at the store too (belt and braces with the
      // extractor's post-parse filter): an add with missing/low confidence is
      // dropped, never defaulted — defaulting waved the shakiest items through.
      if (op.action === 'add' && (op.confidence == null || op.confidence < 0.7)) {
        continue
      }
      if (op.action === 'add' && op.label && op.category) {
        await sb.from(TABLE).insert({
          customer_id: customerId,
          business_id: businessId ?? null,
          category: op.category,
          label: op.label,
          detail: op.detail ?? null,
          confidence: op.confidence,
          suggest_talking_point: op.suggestTalkingPoint ?? false,
          source: 'ai_extraction',
        })
      } else if (op.action === 'update' && op.id) {
        await sb
          .from(TABLE)
          .update({
            ...(op.label ? { label: op.label } : {}),
            ...(op.detail !== undefined && op.detail !== null
              ? { detail: op.detail }
              : {}),
            ...(op.confidence != null ? { confidence: op.confidence } : {}),
            ...(op.suggestTalkingPoint != null
              ? { suggest_talking_point: op.suggestTalkingPoint }
              : {}),
            updated_at: nowIso,
          })
          .eq('id', op.id)
          .eq('source', 'ai_extraction')
          .eq('pinned', false)
      } else if (op.action === 'remove' && op.id) {
        await sb
          .from(TABLE)
          .update({ deleted_at: nowIso })
          .eq('id', op.id)
          .eq('source', 'ai_extraction')
          .eq('pinned', false)
      }
    }
  } catch (err) {
    console.error('[applyMemoryDelta] failed (table may not exist yet):', err)
  }
}

// ─── Staff-owned mutations (pin / edit / delete / manual add) ────────────────
// The schema anticipated these from day one: source='staff' is in the check,
// `pinned` exists, delete is SOFT (deleted_at) so nothing is ever lost. The
// AI delta path above remains scoped to source='ai_extraction' and never
// touches staff rows (migration comment = law).

export async function addStaffMemoryItem(input: {
  customerId: string
  businessId?: string | null
  category: MemoryItem['category']
  label: string
  detail?: string | null
}): Promise<{ ok: boolean; id?: string }> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb
      .from(TABLE)
      .insert({
        customer_id: input.customerId,
        business_id: input.businessId ?? null,
        category: input.category,
        label: input.label,
        detail: input.detail ?? null,
        source: 'staff',
        confidence: 1,
      })
      .select('id')
      .single()
    if (error) throw error
    return { ok: true, id: (data as { id: string }).id }
  } catch {
    return { ok: false }
  }
}

export async function updateMemoryItem(
  id: string,
  patch: { label?: string; detail?: string | null },
): Promise<{ ok: boolean }> {
  try {
    const sb = createServiceClient()
    const { error } = await sb
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export async function setMemoryItemPinned(
  id: string,
  pinned: boolean,
): Promise<{ ok: boolean }> {
  try {
    const sb = createServiceClient()
    const { error } = await sb
      .from(TABLE)
      .update({ pinned, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** SOFT delete (deleted_at) — reversible by design; reads filter it out. */
export async function softDeleteMemoryItem(id: string): Promise<{ ok: boolean }> {
  try {
    const sb = createServiceClient()
    const { error } = await sb
      .from(TABLE)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

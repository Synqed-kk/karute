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
    // NEVER swallow PostgREST errors silently — a missing table GRANT hid every
    // memory read/write for a week behind empty results (customer page showed
    // メモリー 0 while 7 rows existed; brief hooks died). Log loudly.
    if (error) {
      console.error('[getCustomerMemory] postgrest error:', error.message ?? error)
      return []
    }
    if (!data) return []
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
    // Dedup backstop for adds (field bug 2026-07-15: relearn re-added a pinned
    // survivor under a new suffix — 「ゴルフ肘：施術回避」 next to pinned
    // 「ゴルフ肘」). Prompt rule 4 teaches the model not to; this holds when it
    // doesn't listen. Match = same category + same label prefix before 「：」/:.
    // SCOPED to unpinned ai_extraction rows on purpose: a stem collision with a
    // pinned/staff row must NOT suppress the add — those rows are frozen to the
    // AI (update is impossible), so suppression would leave a genuinely NEW
    // fact about the same body part (e.g. pinned 「腰」 + new 「腰：手術予定」)
    // with no path into memory at all. Dropping a safety fact is worse than a
    // duplicate row; vs pinned rows the prompt layer is the only dedup.
    // ponytail: prefix match only — real similarity scoring only if the field
    // shows a duplicate shape this misses.
    const normalizeLabel = (label: string) => label.split(/[：:]/)[0].trim().toLowerCase()
    let liveLabelKeys: Set<string> | null = null
    if (ops.some((o) => o.action === 'add')) {
      const { data } = await sb
        .from(TABLE)
        .select('category, label')
        .eq('customer_id', customerId)
        .eq('source', 'ai_extraction')
        .eq('pinned', false)
        .is('deleted_at', null)
      liveLabelKeys = new Set(
        ((data ?? []) as Array<{ category: string; label: string }>).map(
          (r) => `${r.category}|${normalizeLabel(r.label)}`,
        ),
      )
    }
    for (const op of ops) {
      // Confidence floor enforced at the store too (belt and braces with the
      // extractor's post-parse filter), on EVERY op: update rewrites a fact,
      // remove soft-deletes it — a shaky or confidence-less op must not touch
      // the store (a misread all-clear could erase a safety item). Dropped,
      // never defaulted — defaulting waved the shakiest items through.
      if (op.confidence == null || op.confidence < 0.7) {
        continue
      }
      if (op.action === 'add' && op.label && op.category) {
        const labelKey = `${op.category}|${normalizeLabel(op.label)}`
        if (liveLabelKeys?.has(labelKey)) {
          console.warn(
            '[applyMemoryDelta] duplicate add skipped (same category + label stem):',
            op.category,
            op.label,
          )
          continue
        }
        liveLabelKeys?.add(labelKey)
        const { error } = await sb.from(TABLE).insert({
          customer_id: customerId,
          business_id: businessId ?? null,
          category: op.category,
          label: op.label,
          detail: op.detail ?? null,
          confidence: op.confidence,
          suggest_talking_point: op.suggestTalkingPoint ?? false,
          source: 'ai_extraction',
        })
        if (error) console.error('[applyMemoryDelta] insert failed:', error.message ?? error)
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

/** The customer a memory item belongs to — null when the id doesn't exist (or
 *  is already soft-deleted / errored). The id-addressed mutations below run on
 *  the RLS-BYPASSING service client and filter only by `id`, so the action
 *  layer MUST resolve the owning customer and confirm the caller's business
 *  owns it before mutating (see callerOwnsMemoryItem in actions/memory.ts).
 *  Without that, a raw item id from another business is editable cross-tenant. */
export async function getMemoryItemCustomerId(id: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createServiceClient() as any
    const { data, error } = await sb
      .from(TABLE)
      .select('customer_id')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) {
      console.error('[getMemoryItemCustomerId] postgrest error:', error.message ?? error)
      return null
    }
    return data?.customer_id ?? null
  } catch (err) {
    console.error('[getMemoryItemCustomerId] failed:', err)
    return null
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
      // A human edit makes the item HUMAN-OWNED: source flips to 'staff' so
      // the AI delta path and the 再学習 wipe (both scoped to ai_extraction)
      // can never overwrite or discard what a person corrected.
      .update({ ...patch, source: 'staff', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/**
 * 再学習 wipe: soft-delete the AI's own unpinned items so a fresh backfill can
 * re-learn from the transcripts with the CURRENT prompt. Pinned items and
 * anything human-owned (source='staff'/'intake_form' — including AI items a
 * staff member edited, which flip to 'staff') always survive.
 */
export async function softDeleteAiExtractionItems(
  customerId: string,
): Promise<{ ok: boolean; ids: string[] }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createServiceClient() as any
    const { data, error } = await sb
      .from(TABLE)
      .update({ deleted_at: new Date().toISOString() })
      .eq('customer_id', customerId)
      .eq('source', 'ai_extraction')
      .eq('pinned', false)
      .is('deleted_at', null)
      .select('id')
    if (error) {
      console.error('[softDeleteAiExtractionItems] postgrest error:', error.message ?? error)
      return { ok: false, ids: [] }
    }
    // The wiped ids let the caller RESTORE if the follow-up backfill fails —
    // wipe→backfill isn't atomic, and a failed backfill must not leave the
    // customer's memory empty.
    return { ok: true, ids: (data ?? []).map((r: { id: string }) => r.id) }
  } catch (err) {
    console.error('[softDeleteAiExtractionItems] failed:', err)
    return { ok: false, ids: [] }
  }
}

/** Undo a 再学習 wipe: bring soft-deleted rows back (deleted_at=null). */
export async function restoreMemoryItems(ids: string[]): Promise<{ ok: boolean }> {
  if (ids.length === 0) return { ok: true }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createServiceClient() as any
    const { error } = await sb
      .from(TABLE)
      .update({ deleted_at: null })
      .in('id', ids)
    if (error) throw error
    return { ok: true }
  } catch (err) {
    console.error('[restoreMemoryItems] failed:', err)
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


// ─── Customer passport (これまで box) staff overrides ────────────────────────
// The AI-derived passport lives in ai_cache (regenerated by 再学習); a staff
// EDIT of a field is durable truth and rides this table as a special row:
// category='passport', label=<field key>, detail=<value>, source='staff',
// pinned=true. No enum/schema constraint exists on category (verified), and
// the AI delta path never touches source='staff' rows. getCustomerMemory
// callers must route these rows to the passport, not the item sections.

export const PASSPORT_CATEGORY = 'passport'

export async function upsertPassportField(input: {
  customerId: string
  businessId?: string | null
  fieldKey: string
  value: string
}): Promise<{ ok: boolean }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createServiceClient() as any
    const { data: existing, error: readErr } = await sb
      .from(TABLE)
      .select('id')
      .eq('customer_id', input.customerId)
      .eq('category', PASSPORT_CATEGORY)
      .eq('label', input.fieldKey)
      .is('deleted_at', null)
      .limit(1)
    if (readErr) throw readErr
    if (existing?.[0]?.id) {
      const { error } = await sb
        .from(TABLE)
        .update({
          detail: input.value,
          source: 'staff',
          pinned: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing[0].id)
      if (error) throw error
    } else {
      const { error } = await sb.from(TABLE).insert({
        customer_id: input.customerId,
        business_id: input.businessId ?? null,
        category: PASSPORT_CATEGORY,
        label: input.fieldKey,
        detail: input.value,
        confidence: 1,
        pinned: true,
        source: 'staff',
      })
      if (error) throw error
    }
    return { ok: true }
  } catch (err) {
    console.error('[upsertPassportField] failed:', err)
    return { ok: false }
  }
}
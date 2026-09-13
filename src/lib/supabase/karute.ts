// synqed-core is the SOLE read source for karute records. The Supabase
// `karute_records` table is empty (every write goes to synqed-core) and is being
// dropped as part of the "no karute DB" consolidation. This module fetches from
// synqed-core and adapts to the shape the detail page + exporters consume. The
// filename/export names are retained to avoid churning the ~6 import sites; the
// implementation no longer touches Supabase.

import type { EntryAuthor } from '@synqed-kk/client'
import { effectiveSummary } from '@/lib/karute/effective-summary'
import { statusOf } from '@/lib/recording/take-binding'

/** A karute record with its related customer + entries — the shape consumed by
 *  the detail page, the PDF/text exporters, and the karute-detail adapters.
 *  Column names mirror the legacy Supabase read shape callers were built against:
 *    - customer_id   = tenant/business id
 *    - client_id     = the salon client this karute belongs to
 *    - staff_profile_id = the staff who ran the session */
export interface KaruteWithRelations {
  id: string
  created_at: string
  session_date: string | null
  summary: string | null
  /** True when `summary` is the human overlay (edited_summary), not the AI's
   *  own text — drives the amber pencil on the 詳細記録 card. */
  summary_edited?: boolean
  transcript: string | null
  customer_id: string | null
  client_id: string | null
  staff_profile_id: string | null
  /** This session's store (synqed-core store_id) — the next-booking line's
   *  store-scoped lookup + cross-store naming (D7). Optional: legacy/cached
   *  shapes that predate this field simply omit it. */
  store_id?: string | null
  /** The appointment this karute is linked to, if any — excluded from the
   *  next-booking line's candidates so an early-in-visit save can't surface
   *  "next" = the visit happening right now. */
  appointment_id?: string | null
  recording_session_id: string | null
  /** Core's workflow state (DRAFT/REVIEW/APPROVED/DISCARDED) — R8 discarded-
   *  record door, 2026-09-13. `string`, deliberately NOT the SDK's own
   *  KaruteStatus union: 1.34's type predates DISCARDED (core sends it; the
   *  installed client type doesn't declare it), so a literal `=== 'DISCARDED'`
   *  compare on the SDK-typed pre-mapper value fails tsc (TS2367) — this
   *  widened field is the ONLY place `discarded` may be derived from.
   *  Optional/additive: legacy/cached shapes that predate this field simply
   *  omit it. */
  status?: string
  profiles: { id: string; full_name: string } | null
  customers: { id: string; name: string } | null
  entries: Array<{
    id: string
    category: string
    content: string
    source_quote: string | null
    confidence_score: number | null
    is_manual: boolean
    created_at: string
    /** Provenance (edit-layer Wave 2). Optional — legacy/cached rows may lack it. */
    author?: EntryAuthor
    version?: number
    original_ai_content?: string | null
  }>
}

/**
 * Fetch a single karute record (with customer + entries) from synqed-core — the
 * authoritative write store. Returns null when the record doesn't exist (→ 404)
 * or on any error. Best-effort customer-name resolution via the cached synqed
 * customer list; staff name is unresolved here (synqed staff_id ≠ profile id) so
 * the header renders '—'. session_date isn't persisted on synqed-core, so the
 * header falls back to created_at.
 *
 * Lazy imports keep this module's graph free of the synqed-core ESM client for
 * callers/tests that never resolve a record.
 */
/**
 * Adapt a raw synqed-core karute record into the KaruteWithRelations shape the
 * detail page + adapters consume. Pure mapping (no fetch) so the cookie web read
 * (getKaruteRecord) and the facade Bearer read (packet 07 screen GET) map records
 * identically — customerName is resolved by the caller from whichever customer
 * list it has in hand.
 */
export function mapSynqedKaruteRecord(
  rec: {
    id: string
    created_at: string
    ai_summary?: string | null
    /** Human overlay (the pencil) — effectiveSummary prefers this over ai_summary. */
    edited_summary?: string | null
    transcript?: string | null
    business_id?: string | null
    customer_id?: string | null
    staff_id?: string | null
    store_id?: string | null
    appointment_id?: string | null
    recording_session_id?: string | null
    /** See KaruteWithRelations.status above — kept `string` here too, never
     *  the SDK's KaruteStatus, for the same TS2367 reason. */
    status?: string
    entries?: Array<{
      id: string
      category: string
      content: string
      original_quote?: string | null
      confidence?: number | null
      is_manual?: boolean | null
      created_at: string
      /** Provenance (edit-layer Wave 2) — absent on legacy/cached rows. */
      author?: EntryAuthor
      version?: number
      original_ai_content?: string | null
    }> | null
  },
  customerName: string | null,
): KaruteWithRelations {
  return {
    id: rec.id,
    created_at: rec.created_at,
    // synqed-core has no session_date; the header falls back to created_at.
    session_date: null,
    summary: effectiveSummary(rec),
    summary_edited: (rec.edited_summary ?? null) !== null,
    transcript: rec.transcript ?? null,
    // Supabase column semantics: customer_id = tenant, client_id = the client.
    customer_id: rec.business_id ?? null,
    client_id: rec.customer_id ?? null,
    staff_profile_id: rec.staff_id ?? null,
    store_id: rec.store_id ?? null,
    appointment_id: rec.appointment_id ?? null,
    // '' is not a session — normalize empty string the same as absent/null.
    recording_session_id: rec.recording_session_id || null,
    status: rec.status,
    // staff name unresolved here (synqed staff_id ≠ profile id); header renders '—'.
    profiles: null,
    customers: rec.customer_id
      ? { id: rec.customer_id, name: customerName ?? '—' }
      : null,
    entries: (rec.entries ?? []).map((e) => ({
      id: e.id,
      // synqed entry categories are UPPERCASE; the UI adapters key on lowercase.
      category: e.category.toLowerCase(),
      content: e.content,
      source_quote: e.original_quote ?? null,
      confidence_score: e.confidence ?? null,
      is_manual: e.is_manual ?? false,
      created_at: e.created_at,
      author: e.author,
      version: e.version,
      original_ai_content: e.original_ai_content ?? null,
    })),
  }
}

export async function getKaruteRecord(
  id: string,
): Promise<KaruteWithRelations | null> {
  try {
    const { getSynqedClient } = await import('@/lib/synqed/client')
    const synqed = await getSynqedClient()
    const rec = await synqed.karuteRecords.get(id).catch(() => null)
    if (!rec) return null

    const { getCachedCustomerList } = await import('@/lib/customers/cached')
    const customers = await getCachedCustomerList().catch(() => [])
    const customerName = rec.customer_id
      ? customers.find((c) => c.id === rec.customer_id)?.name ?? null
      : null

    return mapSynqedKaruteRecord(rec, customerName)
  } catch (err) {
    console.error('[getKaruteRecord] synqed-core fetch failed:', err)
    return null
  }
}

/**
 * Discarded-record sibling of {@link getKaruteRecord} (R8 discarded-record
 * door, ⚖ Liam 2026-09-13). NEVER edits getKaruteRecord in place — this is a
 * NEW function, used only by the /karute/[id] page, which decides AFTER this
 * read (via canOpenDiscardedRecord) whether the viewer may actually see what
 * came back; this reader itself never gates on the caller (own-ness cannot be
 * known before the read completes — A1).
 *
 * Ordinary SDK get() first (identical to getKaruteRecord for a live record —
 * zero behavior change there, no retry ever fires). Only a 404 retries ONCE
 * via a raw business-scoped fetch with `include_discarded=true` (SDK 1.34
 * predates the typed option — same raw-transport idiom as
 * synqed-records.ts's listMixedKaruteRecords). A non-404 failure degrades to
 * null immediately, same posture as getKaruteRecord — this sibling does NOT
 * inherit getKaruteRecord's blanket catch-everything-then-decide; it branches
 * on status BEFORE deciding to retry (cold-read SHOULD #3).
 */
export async function getKaruteRecordIncludingDiscarded(
  id: string,
): Promise<KaruteWithRelations | null> {
  try {
    const { getSynqedClient } = await import('@/lib/synqed/client')
    const synqed = await getSynqedClient()

    let rec: Parameters<typeof mapSynqedKaruteRecord>[0] | null = null
    try {
      rec = await synqed.karuteRecords.get(id)
    } catch (err) {
      if (statusOf(err) !== 404) {
        console.error('[getKaruteRecordIncludingDiscarded] synqed-core fetch failed:', err)
        return null
      }
      try {
        rec = await synqed.fetch<Parameters<typeof mapSynqedKaruteRecord>[0]>(
          `/karute-records/${id}?include_discarded=true`,
        )
      } catch (retryErr) {
        console.error('[getKaruteRecordIncludingDiscarded] raw retry failed:', retryErr)
        return null
      }
    }
    if (!rec) return null

    const { getCachedCustomerList } = await import('@/lib/customers/cached')
    const customers = await getCachedCustomerList().catch(() => [])
    const customerName = rec.customer_id
      ? customers.find((c) => c.id === rec!.customer_id)?.name ?? null
      : null

    return mapSynqedKaruteRecord(rec, customerName)
  } catch (err) {
    console.error('[getKaruteRecordIncludingDiscarded] unexpected failure:', err)
    return null
  }
}

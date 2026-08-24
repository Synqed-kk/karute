import type { SynqedClient } from '@synqed-kk/client'
import { effectiveSummary } from '@/lib/karute/effective-summary'

/**
 * A karute row normalized to the Supabase `karute_records` read shape that the
 * karute list + customer session-history pages consume. Superset of both pages'
 * local row types (extra fields are ignored structurally).
 */
export interface KaruteListRow {
  id: string
  session_date: string | null
  created_at: string
  summary: string | null
  transcript: string | null
  staff_profile_id: string | null
  customer_id: string | null
  client_id: string
  entries: Array<{ count: number }>
  /** Session metadata persisted on synqed-core karute_records
   *  (2026-06-11). Optional: Supabase-side rows predate the columns. */
  service?: string | null
  duration_minutes?: number | null
}

/**
 * Lists karute records from synqed-core (the authoritative write store) as rows
 * shaped like the Supabase read. The page reads UNION these with the Supabase
 * query so karute created via synqed-core (manual create + recording saves)
 * actually appear in the list and in a customer's session history — the
 * Supabase `karute_records` table is effectively empty since every write goes
 * to synqed-core. Same read-migration pattern as the staff fix (#107) and the
 * karute detail fallback (#109).
 *
 * session_date / service / duration_minutes now persist on synqed-core
 * (2026-06-11 migration); the installed client types predate them, hence the
 * structural reads. `staff_profile_id` carries the synqed staff id (id-space
 * differs from profiles.id), so staff-name lookups may fall back to 'Unknown'
 * until the rename lands — non-fatal. Degrades to [] on any error.
 */
export async function listSynqedKaruteRows(
  synqed: SynqedClient,
  opts?: { customerId?: string; storeId?: string | null },
): Promise<KaruteListRow[]> {
  try {
    return await listSynqedKaruteRowsOrThrow(synqed, opts)
  } catch (err) {
    console.error('[listSynqedKaruteRows] synqed-core fetch failed:', err)
    return []
  }
}

/**
 * Throwing sibling of {@link listSynqedKaruteRows}: the SAME read + row mapping,
 * but WITHOUT the graceful [] fallback. The BFF facade (packet 05) must NOT
 * freeze an empty-but-200 karute list into a mobile cache on a synqed outage —
 * the packet-03 failure contract classifies any upstream failure as a 502
 * (batch-1 ruling 3 / customers-route WithClient precedent). The web page keeps
 * the swallowing wrapper above; only the facade calls this variant.
 */
export async function listSynqedKaruteRowsOrThrow(
  synqed: SynqedClient,
  opts?: { customerId?: string; storeId?: string | null },
): Promise<KaruteListRow[]> {
  const res = await synqed.karuteRecords.list({
    ...(opts?.customerId ? { customer_id: opts.customerId } : {}),
    // Active-store lens for the karute LIST: scope records to the current
    // branch so 代官山 karute don't surface under 銀座. The customer PROFILE
    // passes NO storeId (full cross-store history). null/undefined = all
    // stores. Core honors store_id (karute.service.ts); SDK 1.9.0 types it.
    ...(opts?.storeId ? { store_id: opts.storeId } : {}),
    page_size: 200,
  })
  return (res.karute_records ?? []).map((r) => {
    const extra = r as unknown as {
      session_date?: string | null
      service?: string | null
      duration_minutes?: number | null
    }
    return {
      id: r.id,
      session_date: extra.session_date ?? null,
      created_at: r.created_at,
      summary: effectiveSummary(r),
      transcript: r.transcript ?? null,
      staff_profile_id: r.staff_id ?? null,
      customer_id: r.business_id ?? null,
      client_id: r.customer_id ?? '',
      entries: [{ count: r.entry_count ?? r.entries?.length ?? 0 }],
      service: extra.service ?? null,
      duration_minutes: extra.duration_minutes ?? null,
    }
  })
}

/** {@link listSynqedKaruteRowsWithTotal} / …OrThrow return shape: the mapped
 *  rows (subject to page_size, same as today) PLUS the server's reported
 *  `total` for the query as sent (all-time store total when called with no
 *  from/to, or a date-windowed count when called with them — see the doc
 *  comment below). */
export interface KaruteRowsWithTotal {
  rows: KaruteListRow[]
  total: number
}

/**
 * Sibling of {@link listSynqedKaruteRowsOrThrow} that also reads the synqed
 * response's `total` and accepts `from`/`to` — needed for the カルテ tab's
 * honest header (PR-1b 正直ヘッダー): monthCount is now a SERVER total, not a
 * client-side filter over the loaded page. One function serves both call
 * shapes so the mapping logic lives in one place:
 *   - main row read (page_size 200, no from/to) → total = store-wide count
 *   - 今月 probe (from/to = JST month bounds, page_size 1) → rows ignored,
 *     only total read
 * The existing {@link listSynqedKaruteRows} / {@link listSynqedKaruteRowsOrThrow}
 * pair, their 8 call sites, and their test pins are UNTOUCHED — this is an
 * ADDITION, not a replacement (their row-mapping logic is duplicated here on
 * purpose rather than refactored, to keep the pinned pair's body exactly as
 * it was).
 */
export async function listSynqedKaruteRowsWithTotalOrThrow(
  synqed: SynqedClient,
  opts?: {
    customerId?: string
    storeId?: string | null
    from?: string
    to?: string
    /** 1-based. Only the PR-2a window loader pages; every other caller reads
     *  page 1 implicitly, exactly as before. */
    page?: number
    page_size?: number
  },
): Promise<KaruteRowsWithTotal> {
  const res = await synqed.karuteRecords.list({
    ...(opts?.customerId ? { customer_id: opts.customerId } : {}),
    ...(opts?.storeId ? { store_id: opts.storeId } : {}),
    ...(opts?.from ? { from: opts.from } : {}),
    ...(opts?.to ? { to: opts.to } : {}),
    ...(opts?.page ? { page: opts.page } : {}),
    page_size: opts?.page_size ?? 200,
  })
  const rows = (res.karute_records ?? []).map((r) => {
    const extra = r as unknown as {
      session_date?: string | null
      service?: string | null
      duration_minutes?: number | null
    }
    return {
      id: r.id,
      session_date: extra.session_date ?? null,
      created_at: r.created_at,
      summary: effectiveSummary(r),
      transcript: r.transcript ?? null,
      staff_profile_id: r.staff_id ?? null,
      customer_id: r.business_id ?? null,
      client_id: r.customer_id ?? '',
      entries: [{ count: r.entry_count ?? r.entries?.length ?? 0 }],
      service: extra.service ?? null,
      duration_minutes: extra.duration_minutes ?? null,
    }
  })
  return { rows, total: res.total ?? 0 }
}

/** Graceful sibling of {@link listSynqedKaruteRowsWithTotalOrThrow} — degrades
 *  to `{rows: [], total: 0}` on a synqed-core failure, same swallow-and-log
 *  posture as {@link listSynqedKaruteRows}. The facade route (packet 05
 *  failure contract) uses the throwing variant directly. */
export async function listSynqedKaruteRowsWithTotal(
  synqed: SynqedClient,
  opts?: Parameters<typeof listSynqedKaruteRowsWithTotalOrThrow>[1],
): Promise<KaruteRowsWithTotal> {
  try {
    return await listSynqedKaruteRowsWithTotalOrThrow(synqed, opts)
  } catch (err) {
    console.error('[listSynqedKaruteRowsWithTotal] synqed-core fetch failed:', err)
    return { rows: [], total: 0 }
  }
}

/**
 * NOTE (PR-2a): the main-read + 今月-probe pairing that used to live here moved
 * to `karute-window.ts` as {@link loadKaruteWindowWithMonthProbe} — its main
 * leg is now the first DATE WINDOW rather than a flat newest-200 read. The
 * independent-legs contract (each leg its own catch, null = that leg failed)
 * moved with it, unchanged.
 */

/**
 * Unions Supabase rows with synqed-core rows, de-duped by id (Supabase wins on
 * conflict), sorted by session_date ?? created_at descending, capped at `limit`.
 */
export function mergeKaruteRows<
  T extends { id: string; session_date: string | null; created_at: string },
>(supabaseRows: T[], synqedRows: T[], limit = 200): T[] {
  const seen = new Set(supabaseRows.map((r) => r.id))
  const merged = [...supabaseRows, ...synqedRows.filter((r) => !seen.has(r.id))]
  merged.sort((a, b) => {
    const da = a.session_date ?? a.created_at
    const db = b.session_date ?? b.created_at
    return db.localeCompare(da)
  })
  return merged.slice(0, limit)
}

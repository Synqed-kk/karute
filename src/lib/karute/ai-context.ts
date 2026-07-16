import 'server-only'
import type { Appointment, KaruteRecord } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { effectiveSummary } from '@/lib/karute/effective-summary'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { isTerminalStatus } from '@/lib/appointments/status'
import { JST_OFFSET, jstWallTimeToDate, ymdInJst } from '@/lib/date/jst'

export interface AiKaruteContextRow {
  id: string
  customerName: string
  createdAt: string
  summary: string | null
  entries: Array<{ category: string; content: string }>
}

/** Map raw synqed karute rows to the AI context shape, newest-first. Shared by
 *  the generic recent slice and the targeted (per-customer / today) fetches so
 *  every path produces byte-identical rows. */
function mapKaruteRows(
  records: KaruteRecord[],
  nameById: Map<string, string>,
): AiKaruteContextRow[] {
  return records
    .map((r) => ({
      id: r.id,
      customerName: r.customer_id
        ? (nameById.get(r.customer_id) ?? 'Unknown')
        : 'Unknown',
      createdAt: r.created_at,
      summary: effectiveSummary(r),
      entries: (r.entries ?? []).map((e) => ({
        category: String(e.category),
        content: e.content,
      })),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Join AI context rows into the single prompt block the chat/insights routes
 *  hand the model. This is the ONE place the format lives — the route used to
 *  inline it, so keeping it identical guarantees the no-hint path is unchanged. */
export function formatKaruteContext(rows: AiKaruteContextRow[]): string {
  return rows
    .map((r) => {
      const entries = r.entries
        .map((e) => `[${e.category}] ${e.content}`)
        .join(', ')
      return `${r.customerName} (${r.createdAt}): ${r.summary ?? 'No summary'}. Entries: ${entries}`
    })
    .join('\n')
}

/**
 * Recent karute records from synqed-core (the source of truth), with customer
 * names resolved — the context the AI insights + chat routes feed the model.
 *
 * Both routes previously read the EMPTY Supabase `karute_records` mirror, so the
 * AI had ZERO session data (insights returned nothing; chat had no context).
 * This reads synqed (where karute actually lives). Best-effort: [] on failure.
 */
export async function getRecentKaruteForAI(
  limit: number,
  storeId?: string,
): Promise<AiKaruteContextRow[]> {
  try {
    const synqed = await getSynqedClient()
    const [res, customers] = await Promise.all([
      // storeId absent (default) = today's behavior (no store filter). Callers
      // that resolve a restricted staff's store scope pass it to clamp reads.
      synqed.karuteRecords.list({ page_size: limit, store_id: storeId }),
      getCachedCustomerList(),
    ])
    const nameById = new Map(customers.map((c) => [c.id, c.name]))
    // synqed-core already orders createdAt desc (karute.service.ts); mapKaruteRows
    // re-sorts defensively so "recent" can't silently become "oldest".
    return mapKaruteRows(res.karute_records ?? [], nameById)
  } catch (err) {
    console.error('[getRecentKaruteForAI] synqed fetch failed:', err)
    return []
  }
}

/**
 * One customer's recent karute records, store-scope-clamped. Powers the chat
 * route's `{customer_id}` context hint: a chip about 田中様 answers from 田中様's
 * own history instead of the generic recent slice.
 *
 * `storeId` clamps the read (a restricted staff passes their store) — a customer
 * outside that store simply yields no rows, so the id can't widen exposure.
 * Returns the resolved name alongside the rows so the caller can label the slice
 * (「田中様のカルテN件」) even when the customer has zero records. [] on failure.
 */
export async function getCustomerKaruteForAI(
  customerId: string,
  limit: number,
  storeId?: string,
): Promise<{ customerName: string | null; rows: AiKaruteContextRow[] }> {
  try {
    const synqed = await getSynqedClient()
    const [res, customers] = await Promise.all([
      synqed.karuteRecords.list({
        customer_id: customerId,
        page_size: limit,
        store_id: storeId,
      }),
      getCachedCustomerList(),
    ])
    const nameById = new Map(customers.map((c) => [c.id, c.name]))
    const rows = mapKaruteRows(res.karute_records ?? [], nameById)
    // B1: the label name comes ONLY from the store-clamped rows themselves. A
    // customer outside the caller's store yields zero clamped rows → null → the
    // route emits NO label. rows[0].customerName was resolved from the clamped
    // row's own customer_id, so it can never name an out-of-scope customer.
    // Reading the business-wide cache by the raw param is what leaked identity
    // before, so we deliberately don't do that here.
    const rowName = rows[0]?.customerName
    const customerName = rowName && rowName !== 'Unknown' ? rowName : null
    return { customerName, rows }
  } catch (err) {
    console.error('[getCustomerKaruteForAI] synqed fetch failed:', err)
    return { customerName: null, rows: [] }
  }
}

/** Today's (JST) LIVE appointments, store-scope-clamped. Shared by the signal
 *  engine and the `{scope:'today'}` context hint so "today's roster" is defined
 *  in exactly one place. Excludes terminal bookings (CANCELLED **and** NO_SHOW)
 *  via `isTerminalStatus` — a no-show must not inflate the roster count, the
 *  ticket-low count, the 「N名」 chip, or the today slice. [] on failure. */
export async function getTodaysAppointments(
  storeId?: string,
): Promise<Appointment[]> {
  try {
    const synqed = await getSynqedClient()
    const day = ymdInJst()
    // Day window matches the house convention in src/actions/appointments.ts
    // (getAppointmentsByDate): JST 00:00:00 → 23:59:59.999 so the last-minute
    // appointments agree with the 予約 agenda's "today".
    const from = jstWallTimeToDate(day, '00:00').toISOString()
    const to = new Date(`${day}T23:59:59.999${JST_OFFSET}`).toISOString()
    const res = await synqed.appointments.list({
      from,
      to,
      store_id: storeId,
      page_size: 100,
    })
    return (res.appointments ?? []).filter((a) => !isTerminalStatus(a.status))
  } catch (err) {
    console.error('[getTodaysAppointments] synqed fetch failed:', err)
    return []
  }
}

/** Last karute record for each customer on today's roster — the `{scope:'today'}`
 *  context slice. Roster is store-scoped upstream, so the per-customer reads stay
 *  in scope. `rosterSize` is the count of DISTINCT today-appointment customers —
 *  the honest 「N名」 for the context label; `rows` only covers customers who
 *  actually have a record (unknowns would otherwise collapse the count). Empty
 *  roster or failure → `{ rosterSize: 0, rows: [] }`. */
export async function getTodayRosterKaruteForAI(
  storeId?: string,
): Promise<{ rosterSize: number; rows: AiKaruteContextRow[] }> {
  try {
    const appts = await getTodaysAppointments(storeId)
    const customerIds = [
      ...new Set(appts.map((a) => a.customer_id).filter(Boolean)),
    ]
    if (customerIds.length === 0) return { rosterSize: 0, rows: [] }
    const synqed = await getSynqedClient()
    const [perCustomer, customers] = await Promise.all([
      Promise.all(
        customerIds.map((id) =>
          synqed.karuteRecords.list({
            customer_id: id,
            page_size: 1,
            store_id: storeId,
          }),
        ),
      ),
      getCachedCustomerList(),
    ])
    const nameById = new Map(customers.map((c) => [c.id, c.name]))
    const rows = perCustomer.flatMap((res) => res.karute_records ?? [])
    return { rosterSize: customerIds.length, rows: mapKaruteRows(rows, nameById) }
  } catch (err) {
    console.error('[getTodayRosterKaruteForAI] synqed fetch failed:', err)
    return { rosterSize: 0, rows: [] }
  }
}

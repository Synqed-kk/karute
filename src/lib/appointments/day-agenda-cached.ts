import { unstable_cache } from 'next/cache'
import { newSynqedClient } from '@/lib/synqed/client'
import { getBusinessId } from '@/lib/staff'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import { getAppointmentsByDateWithClient } from '@/lib/appointments/by-date'
import type { AppointmentRow } from '@/actions/appointments'

// WEB-ONLY 60s cache over the 予約 day agenda's fetch. The facade appointments
// screen GET keeps calling the raw by-date path — this module must never be
// imported from src/app/api (enforced by web-only-cache-facade-ban.test.ts).
// Auth resolves OUTSIDE the cache (cookies() inside an unstable_cache body
// throws, next/dist/server/request/cookies.js E846); the body builds an
// env-scoped client from the explicit businessId.
//
// Customer names are NOT baked into the cached rows. The body fetches with an
// empty name map and getCachedDayAgenda decorates rows AFTER the cache read,
// from the same 60s customer-list cache the uncached code path uses — so name
// freshness is byte-for-byte today's behavior, and the body never re-pays the
// full customer pagination on a cache regeneration (nested unstable_cache
// bypasses the inner cache's READ path — verified in installed Next 16.2.3,
// unstable-cache.js isNestedUnstableCache).
//
// Error envelope, stated honestly (verified against installed Next source):
//   - COLD miss: a thrown fetch error is never stored (cacheNewResult only
//     runs after a successful resolve); the wrapper returns [] for that
//     request and the next request retries.
//   - WARM but TTL-stale: Next serves the last-known-good entry immediately
//     and refreshes in the background; a failing refresh is swallowed by Next
//     (console.error) and the stale entry keeps serving while the backend is
//     down. DELIBERATE: last-known-good beats a blank agenda mid-outage —
//     same fail-open posture as the rest of the app.
const dayAgendaByBusiness = unstable_cache(
  async (
    businessId: string,
    storeId: string,
    dateStr: string,
  ): Promise<AppointmentRow[]> => fetchDayAgendaRows(businessId, storeId, dateStr),
  ['appointments-day-agenda-v2'],
  // Invalidation: every web appointment mutation (create/update/delete/
  // cancel/restore/no-show) and the karute writers fire updateTag('dashboard')
  // — web edits repaint immediately. 'staff-list' covers the baked
  // status_set_by_name strings. No 'customers' tag: names live outside the
  // entry. App/facade mutations and external writers (QR sync, Reserve) bump
  // nothing — they appear within the 60s TTL, the same ceiling the dashboard
  // card has today.
  { revalidate: 60, tags: ['dashboard', 'staff-list'] },
)

// The raw day fetch (3 core calls), shared by the cached path and the
// uncached null-scope bypass below. includeCancelled is FIXED true — the
// agenda is the one consumer that renders terminal rows as tombstones; not a
// parameter, so the cache key never varies on it.
function fetchDayAgendaRows(
  businessId: string,
  storeId: string | null,
  dateStr: string,
): Promise<AppointmentRow[]> {
  return getAppointmentsByDateWithClient(newSynqedClient(businessId), dateStr, {
    storeId: storeId ?? undefined,
    nameById: new Map(),
    includeCancelled: true,
  })
}

/**
 * 予約 page's day-agenda read: getAppointmentsByDate's cookie fan-out with a
 * 60s per-(business, store, day) cache in the middle, names decorated after
 * the cache read.
 *
 * A null store scope NEVER touches the cache. storeId only resolves null for
 * a zero-store business, a truly floating staff — or a DEGRADED RBAC lookup
 * (getStaffStores swallows core errors to [], dropping the clamp). Memoizing
 * that last case would serve a transient outage's unclamped, business-wide
 * row set to later requests for 60s (blind-round tenancy finding); bypassing
 * keeps degraded requests exactly as live as today's uncached code.
 *
 * Errors are swallowed to [] OUT HERE — the cached body throws, so a cold
 * miss during an outage is never stored as an empty agenda.
 */
export async function getCachedDayAgenda(
  dateStr: string,
): Promise<AppointmentRow[]> {
  try {
    const [businessId, scope] = await Promise.all([
      getBusinessId(),
      resolveStoreScope(),
    ])
    const rows = scope.storeId
      ? await dayAgendaByBusiness(businessId, scope.storeId, dateStr)
      : await fetchDayAgendaRows(businessId, null, dateStr)
    // Same name source and freshness as the uncached path (60s list cache,
    // 'customers' tag) — a rename shows on the next click even on a warm
    // agenda entry. New objects, never mutation of the cached rows.
    const customers = await getCachedCustomerListFor(businessId)
    const nameById = new Map(customers.map((c) => [c.id, c.name]))
    return rows.map((r) => ({
      ...r,
      customers: nameById.has(r.client_id)
        ? { name: nameById.get(r.client_id)! }
        : null,
    }))
  } catch {
    return []
  }
}

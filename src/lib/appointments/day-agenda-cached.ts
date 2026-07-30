import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId } from '@/lib/staff'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import { getAppointmentsByDateWithClient } from '@/lib/appointments/by-date'
import type { AppointmentRow } from '@/actions/appointments'

// WEB-ONLY 60s cache over the 予約 day agenda's fetch. The facade appointments
// screen GET keeps calling the raw by-date path — this module must never be
// imported from src/app/api. Same shape as dashboardByDay / customerListByBusiness:
// auth resolves OUTSIDE the cache (cookies() inside an unstable_cache body
// throws at runtime), the body builds its own env-scoped client.
//
// Cache key = (businessId, storeId, dateStr). storeId is the RBAC-RESOLVED
// scope, not the raw cookie — so a clamped staff's entry can never be served
// to (or poisoned by) a different store's view; users who resolve to the same
// (business, store) see identical rows by construction (the fetch has no
// per-user filter).
//
// Invalidation envelope, stated honestly:
//   - Web mutations: every appointment action (create/update/delete/cancel/
//     restore/no-show) and the karute writers call updateTag('dashboard') —
//     a web-originated change repaints the agenda immediately.
//   - 'customers' / 'staff-list': renames drop the baked-in name strings.
//   - App/facade mutations and external writers (QR sync, Reserve) bump no
//     tag — they appear within the 60s TTL, the same ceiling the dashboard
//     card already has. Names edited outside the web app can compound to
//     ~120s (60s customer-list cache baked into a 60s agenda entry).
const dayAgendaByBusiness = unstable_cache(
  async (
    businessId: string,
    storeId: string | null,
    dateStr: string,
  ): Promise<AppointmentRow[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) {
      throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
    }
    const synqed = new SynqedClient({ baseUrl, apiKey, businessId })
    // businessId-explicit variant — no auth read in the cache context. Nested
    // unstable_cache is the established pattern (see getCachedCustomerListFor).
    const customers = await getCachedCustomerListFor(businessId)
    // includeCancelled is FIXED true — the agenda is the one consumer that
    // renders terminal rows as tombstones. Not a parameter on purpose: no
    // other caller may share this cache, so the key never varies on it.
    return getAppointmentsByDateWithClient(synqed, dateStr, {
      storeId: storeId ?? undefined,
      nameById: new Map(customers.map((c) => [c.id, c.name])),
      includeCancelled: true,
    })
  },
  ['appointments-day-agenda-v1'],
  { revalidate: 60, tags: ['dashboard', 'customers', 'staff-list'] },
)

/**
 * 予約 page's day-agenda read: getAppointmentsByDate's cookie fan-out with a
 * 60s per-(business, store, day) cache in the middle. Errors are swallowed to
 * [] OUT HERE — the cached body throws, so a transient core outage is never
 * stored as an empty agenda for 60s; the next request retries.
 */
export async function getCachedDayAgenda(
  dateStr: string,
): Promise<AppointmentRow[]> {
  try {
    const [businessId, scope] = await Promise.all([
      getBusinessId(),
      resolveStoreScope(),
    ])
    return await dayAgendaByBusiness(businessId, scope.storeId ?? null, dateStr)
  } catch {
    return []
  }
}

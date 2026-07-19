// Chrome screen facade GET (design-parity Gap A) — the Bearer-path twin of
// what the web (app) layout assembles server-side: next-customer for the
// bottom-nav mic label, the notification feed for the bell, and the store
// rows for the switcher. Same split as every screens route: identity from
// the token, reads on the business-scoped client, store lens via the
// explicit `store-id` header clamp (never a cookie).

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ChromeScreenDTO } from '@/lib/app-api/chrome-dto'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import { getAppointmentsByDateWithClient } from '@/lib/appointments/by-date'
import { pickNextCustomer } from '@/lib/appointments/next-customer'
import { buildNotificationFeed } from '@/lib/notifications/derive'
import { ymdInJst } from '@/lib/date/jst'

function readLocale(ctx: { req: Request }): 'ja' | 'en' {
  const raw = new URL(ctx.req.url).searchParams.get('locale')
  return raw === 'en' ? 'en' : 'ja'
}

/** The feed bakes web hrefs (`/ja/appointments`); the shell router is
 *  single-locale and unprefixed. */
function stripLocalePrefix(href: string | null): string | null {
  return href ? href.replace(/^\/(ja|en)(?=\/|$)/, '') || '/' : null
}

export const GET = facadeHandler('screens.chrome', async (ctx) => {
  // Same gate as the record screen: the chrome carries customer names (the
  // mic label + notification titles).
  ensureCapability(ctx.identity.capabilities, 'customers.view')
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const locale = readLocale(ctx)

  // Store clamp BEFORE any read — store_forbidden must reach the client as
  // 403, outside the 502 catch below.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  try {
    // Every source is individually best-effort — chrome must render even if
    // one read degrades (empty feed / no label / hidden switcher), matching
    // the web layout's catch-to-empty seeding. Today's appointments are
    // fetched ONCE and feed BOTH the next-customer pick and the feed's
    // 本日のご予約 digest (Greptile #562: no double day-read per request).
    const customersPromise = getCachedCustomerListFor(businessId).catch(
      () => [],
    )
    const apptsPromise = customersPromise
      .then((customers) =>
        getAppointmentsByDateWithClient(synqed, ymdInJst(new Date()), {
          nameById: new Map(customers.map((c) => [c.id, c.name])),
        }),
      )
      .catch(() => [])
    const [storeRows, notifications, todayAppts] = await Promise.all([
      synqed.stores
        .list()
        .then((r) => r.stores)
        .catch(() => []),
      Promise.all([customersPromise, apptsPromise])
        .then(([customers, appts]) => {
          const existingById = new Map(
            customers.map((c) => [c.id, c.isExistingCustomer]),
          )
          return buildNotificationFeed(businessId, locale, clamp.storeId, {
            todayAppointments: appts.map((a) => ({
              isExistingCustomer: existingById.get(a.client_id),
            })),
          })
        })
        .catch(() => []),
      apptsPromise,
    ])

    // Same visibility rule as the web layout: a branch-restricted staff only
    // sees their own store(s) in the switcher.
    const visibleStores = clamp.allowedStoreIds
      ? storeRows.filter((s) => clamp.allowedStoreIds!.includes(s.id))
      : storeRows

    return ok(
      ctx,
      ChromeScreenDTO.parse({
        staffId: ctx.identity.authUserId,
        nextCustomer: pickNextCustomer(
          todayAppts,
          ctx.identity.authUserId,
          Date.now(),
        ),
        notifications: notifications.map((n) => ({
          ...n,
          href: stripLocalePrefix(n.href),
        })),
        stores: visibleStores.map((s) => ({
          id: s.id,
          name: s.name,
          isPrimary: s.is_primary,
          active: s.active,
        })),
        activeStoreId: clamp.storeId,
      }),
    )
  } catch {
    throw new AppApiError('upstream_unavailable', 'chrome screen data unavailable')
  }
})

export const OPTIONS = GET

// Facade twin of the web getRecoveryDayFacts action (PR-B1 D2/D4): the
// recording DAY's bookings + 回数券 facts + that day's burn history, for the
// recovery banner's 保存先 picker. Same shared derivation the web action runs
// (lib/karute/recovery-facts), on the Bearer client, under the same store
// clamp every other recording surface applies.
//
// Gated on records.write — this is part of saving a record, and the rows are
// booked-customer data. Never a tenancy oracle: the business-scoped client
// simply returns no rows for a day outside it.

import { getTranslations } from 'next-intl/server'

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import { buildRecoveryDayFacts } from '@/lib/karute/recovery-facts'

export const runtime = 'nodejs'

const YMD = /^\d{4}-\d{2}-\d{2}$/

function readLocale(ctx: FacadeContext): 'ja' | 'en' {
  return new URL(ctx.req.url).searchParams.get('locale') === 'en' ? 'en' : 'ja'
}

export const GET = facadeHandler('recovery.day_facts', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'records.write')

  const url = new URL(ctx.req.url)
  const date = url.searchParams.get('date') ?? ''
  if (!YMD.test(date)) throw new AppApiError('validation', 'date must be YYYY-MM-DD')
  const pinnedCustomerId = url.searchParams.get('pinnedCustomerId') ?? undefined

  const synqed = newSynqedClient(ctx.identity.businessId)
  // Store clamp BEFORE any read, OUTSIDE the degrade below — a store_forbidden
  // throw must reach the client as 403, never as an empty day.
  const clamp = await resolveStoreForRequest({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  const t = await getTranslations({ locale: readLocale(ctx), namespace: 'reservation.status' })
  try {
    return ok(
      ctx,
      await buildRecoveryDayFacts(synqed, {
        dateYmd: date,
        storeId: clamp.storeId ?? undefined,
        pinnedCustomerId,
        statusLabel: (key) => t(key),
      }),
    )
  } catch (err) {
    // Same degrade the web action takes: no rows to offer and 消化 state
    // UNKNOWN (never 「未処理」 — F7). The banner still saves; it just can't
    // re-point or state the ticket line.
    console.error('[recovery.day_facts] unavailable:', err)
    return ok(ctx, { date, bookings: [], packs: [], redeemed: null })
  }
})

export const OPTIONS = GET

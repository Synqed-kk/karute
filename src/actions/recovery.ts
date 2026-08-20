'use server'

// Recovery-banner reads (PR-B1). ONE action: the recording DAY's bookings +
// 回数券 facts + that day's burn history, for the banner's 保存先 picker and its
// 回数券 line. Everything is derived server-side on the business-scoped client
// (R-B4), so phones get the behavior without a re-bake and the client never
// gets a wider data tier than the Build A picker already exposes — only the
// DATE moves.
//
// EVERY server dependency is loaded DYNAMICALLY inside the action, exactly like
// the pack actions next door: RecordPageView is a client component that imports
// this module, so a static `next-intl/server` / synqed-client import here walks
// straight into its bundle graph (and into every jsdom suite that renders it).
// Only types cross the top-level boundary — they are erased.

import type { RecoveryDayFacts } from '@/lib/karute/recovery-facts'

/** Empty-but-honest shape: no rows to offer, and 消化 state UNKNOWN (never
 *  「未処理」 — F7: derived truth or nothing). */
const unavailable = (date: string): RecoveryDayFacts => ({
  date,
  bookings: [],
  packs: [],
  redeemed: null,
})

const YMD = /^\d{4}-\d{2}-\d{2}$/

export async function getRecoveryDayFacts(input: {
  /** JST yyyy-mm-dd of the interrupted recording. */
  date: string
  /** The take's originally-bound customer (pinned in the picker). */
  pinnedCustomerId?: string | null
}): Promise<RecoveryDayFacts> {
  if (!YMD.test(input.date)) return unavailable(input.date)
  try {
    const [{ getTranslations }, { requireCapability }, { getSynqedClient }, { resolveStoreScope }, { buildRecoveryDayFacts }] =
      await Promise.all([
        import('next-intl/server'),
        import('@/lib/auth/require-permission'),
        import('@/lib/synqed/client'),
        import('@/lib/auth/store-scope'),
        import('@/lib/karute/recovery-facts'),
      ])
    // Same gate the recording flow itself carries — a recovery banner is part
    // of saving a record, and these rows are booked-customer data.
    await requireCapability('records.write')
    const [synqed, scope, tStatus] = await Promise.all([
      getSynqedClient(),
      resolveStoreScope(),
      getTranslations('reservation.status'),
    ])
    return await buildRecoveryDayFacts(synqed, {
      dateYmd: input.date,
      storeId: scope.storeId ?? undefined,
      pinnedCustomerId: input.pinnedCustomerId ?? undefined,
      statusLabel: (key) => tStatus(key),
    })
  } catch (err) {
    console.error('[recovery] day facts unavailable:', err)
    return unavailable(input.date)
  }
}

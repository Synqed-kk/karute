import { redirect } from 'next/navigation'

/**
 * /karute/customer/[customerId] — REMOVED, now a permanent redirect.
 *
 * This was a near-duplicate of the customer hub (/customers/[id]) that the
 * design spike never had. Two customer-detail pages made navigation
 * unpredictable — a カルテ-list tap and a 顧客-list tap landed on different
 * pages, one missing info. The カルテ list now routes straight to the hub
 * (see karute/page.tsx placeholder rows); this route redirects so any stale
 * or bookmarked links resolve to the canonical page.
 *
 * Canonical IA (matches the spike): two destinations only —
 *   - /customers/[id]  → the customer hub (identity + メモリー/履歴/写真 tabs)
 *   - /karute/[id]     → the rich single-session karute record
 *
 * (The old KaruteCustomerDetailView component is now unused — left in place
 * for a follow-up dead-code sweep rather than deleted inline here.)
 */
export default async function KaruteCustomerRedirect({
  params,
}: {
  params: Promise<{ customerId: string; locale: string }>
}) {
  const { customerId, locale } = await params
  redirect(`/${locale}/customers/${customerId}`)
}

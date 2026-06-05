import { redirect } from 'next/navigation'

/**
 * /karute/customer/[customerId] — RETIRED & consolidated.
 *
 * This route used to render KaruteCustomerDetailView: a second, near-duplicate
 * customer page that (a) duplicated the canonical customer profile at
 * /customers/[id] (SAME data pipeline, different layout) and (b) wrongly placed
 * single-SESSION content (entry timeline, AI summary, transcript) on a CUSTOMER
 * page. Single-session content belongs on /karute/[id]; everything about the
 * person belongs on /customers/[id].
 *
 * To keep exactly ONE customer page with no dead ends, this route now redirects
 * to the canonical /customers/[id]. (The カルテ-list placeholder rows already
 * link straight there.) Kept as a redirect rather than deleted so any existing
 * bookmark / deep link lands on the right page instead of a 404.
 */
export default async function RetiredKaruteCustomerRedirect({
  params,
}: {
  params: Promise<{ customerId: string; locale: string }>
}) {
  const { customerId, locale } = await params
  redirect(`/${locale}/customers/${customerId}`)
}

// 売上分析 — the room the ACCEPTED DESKTOP MOCK describes, running on
// PLAY-PHASE FIXTURES.
//
// SERVER COMPONENT ON PURPOSE, like the other rooms: every read, join, sum and
// date format happens in `analytics-props.ts`, so the client receives plain
// strings and numbers. No timezone and no locale can drift between the two
// renders, and no data access exists on the client at all.
//
// Everything between the admission gate and the render lives beside this file
// (the room-3 F1 law), so the evidence harness renders the SAME assembly this
// route does rather than a hand-written replica of it.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { AnalyticsScreen } from './AnalyticsScreen'
import { analyticsProps } from './analytics-props'
import './analytics.css'

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string; month?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  const { props, storeKey } = await analyticsProps({ locale, store: query.store, month: query.month })

  // ⚖ VIEW STATE IS STORE-SCOPED. `?store=` navigation keeps the same screen
  // instance, so the open tab, the opened table row, an open popover and the
  // tour's step would all survive a lens switch — a 銀座 row read at a 代官山
  // desk, which is the isolation law failing at the frame rather than at the
  // read. Keying by the resolved lens resets all of it.
  //
  // ⚠ `?month=` DELIBERATELY DOES NOT REMOUNT: the chart's own click is a month
  // link, and its 「scroll into view and pulse」 answer (⚖-ADJ C) is state that
  // has to survive that navigation. Same store, same screen.
  return <AnalyticsScreen key={storeKey} {...props} />
}

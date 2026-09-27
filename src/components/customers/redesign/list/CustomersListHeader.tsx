'use client'

import { useTranslations } from 'next-intl'
import { NotificationBell } from '@/components/notifications/NotificationBell'

interface CustomersListHeaderProps {
  /**
   * Optional heading override. Defaults to the customer-list heading
   * (顧客 / Customers) when omitted. The カルテ tab passes its own
   * heading ("カルテ") so the same list view can be reused under a
   * different page identity. Keeps the i18n / wiring lazy — heading
   * is fully owned by the calling page.
   */
  heading?: string
}

/**
 * The desktop title bar — mirrors the design spike:
 *
 *   ┌───────────────────────────────────────────────────────┐ ← sticky
 *   │                       顧客                       (🔔) │
 *   └───────────────────────────────────────────────────────┘ ← divider
 *
 * ⚖ 顧客 TAB LOCKED 02:1x (Liam): the status line 「登録中の顧客 · 全… 」 and the
 * 「+ 新規顧客」 button below this bar are gone — the add is the blue circle at
 * the end of the search row (CustomersListView).
 *
 * The title bar (顧客 + bell) sticks at the top of the scrolling
 * `<main>` container so it stays visible while the list scrolls.
 * Negative horizontal margins escape the app shell's `p-4 md:p-6`
 * wrapper so the sticky bar bleeds edge-to-edge instead of leaving
 * a gap at the sides; padding is re-applied inside the bar for the
 * content inset.
 *
 * Bell is the shared <NotificationBell> (desktop variant) — the same
 * component MobileHeader renders, so the desktop + mobile bells can't
 * diverge. It opens the NotificationsPanel and shows the red unread
 * badge driven by the v1 derived feed (buildNotificationFeed →
 * NotificationsProvider). This desktop bar is `hidden md:block`; the
 * MobileHeader bell is `md:hidden`, so exactly one bell is visible at
 * any width.
 */
export function CustomersListHeader({ heading }: CustomersListHeaderProps) {
  const t = useTranslations('customers.list')
  // Fragment (not a wrapping div) so the sticky bar becomes a DIRECT child
  // of CustomersListView's outer flex-col. That outer column spans the entire scrollable page (header +
  // filters + cards), which is what the sticky bar's containing block
  // needs to be — otherwise the bar releases the moment its short
  // local wrapper scrolls past, which is what was happening before.
  return (
    <>
      {/* Sticky title bar — pins to top of <main> for the whole page
       *  scroll. Slight transparency (`bg-background/80`) + a
       *  `backdrop-blur` gives the bleed-through effect from the
       *  spike: cards underneath read faintly through the bar as you
       *  scroll, rather than the bar being a hard solid strip.
       *
       *  Mobile-hidden — the global MobileHeader (layout-level) now
       *  owns mobile chrome (title + bell). Showing both produced
       *  doubled bars at the top of every list page. Desktop keeps
       *  this local bar so the heading + bell stay reachable on
       *  wider viewports where MobileHeader doesn't render. */}
      <div className="sticky top-0 z-20 -mx-4 hidden border-b border-border/40 bg-background/80 px-4 backdrop-blur md:-mx-6 md:block md:px-6">
        <div className="relative flex items-center justify-center py-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground md:text-lg">
            {heading ?? t('heading')}
          </h1>
          {/* Shared bell — opens the NotificationsPanel + shows the unread
           *  badge. `absolute right-0` is applied inside the component so it
           *  pins to the bar's right edge, same as the old stub. */}
          <NotificationBell variant="desktop" />
        </div>
      </div>
    </>
  )
}

'use client'

import type { StaffComboboxOption } from '@/components/karute/StaffCombobox'
import { useTranslations } from 'next-intl'
import { CustomerSheet } from '@/components/customers/CustomerSheet'
import { NotificationBell } from '@/components/notifications/NotificationBell'

interface CustomersListHeaderProps {
  total: number
  showing: number
  /**
   * Optional heading override. Defaults to the customer-list heading
   * (顧客 / Customers) when omitted. The カルテ tab passes its own
   * heading ("カルテ") so the same list view can be reused under a
   * different page identity. Keeps the i18n / wiring lazy — heading
   * is fully owned by the calling page.
   */
  heading?: string
  /** Tenant staff roster — threaded through to CustomerSheet's 指名スタッフ picker. */
  assignableStaff?: StaffComboboxOption[]
}

/**
 * Two-section header — mirrors the design spike:
 *
 *   ┌───────────────────────────────────────────────────────┐ ← sticky
 *   │                       顧客                       (🔔) │
 *   └───────────────────────────────────────────────────────┘ ← divider
 *     登録中の顧客 · 全128 · 24名を表示中           [+ 新規顧客]   ← scrolls
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
export function CustomersListHeader({ total, showing, heading, assignableStaff }: CustomersListHeaderProps) {
  const t = useTranslations('customers.list')
  // Fragment (not a wrapping div) so the sticky bar and the info row
  // become DIRECT children of CustomersListView's outer flex-col.
  // That outer column spans the entire scrollable page (header +
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

      {/* Status line (left) + action button (right) — scrolls with the
       *  list. Spacing handled by the parent flex-col's `gap-4` so no
       *  explicit pt here. */}
      {/* Header structure contract (Liam 8/7): natural-height items-center
       *  row, no wrap — the 32px create button dictates row height on
       *  顧客/カルテ/予約 alike, so it holds one slot across tabs. flex-wrap
       *  removed: it dropped the button to a second line on narrow phones
       *  (same bug カルテ fixed earlier); the status text truncates instead. */}
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground">
          {t('statusLine', { total, showing })}
        </p>
        <CustomerSheet assignableStaff={assignableStaff} />
      </div>
    </>
  )
}

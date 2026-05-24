'use client'

import { Bell } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CustomerSheet } from '@/components/customers/CustomerSheet'

interface CustomersListHeaderProps {
  total: number
  showing: number
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
 * Bell icon is a VISUAL-ONLY placeholder — the design spike also
 * shipped it as a stub, so there's no existing implementation to
 * port over. The whole notifications surface is new work:
 *   ANTHONY: this needs end-to-end build-out —
 *     • notifications table (or however you want to model the
 *       data — could also be derived from existing booking /
 *       karute events)
 *     • read API + count query (server) → exposed to a client
 *       hook like `useUnreadNotificationsCount()`
 *     • notifications drawer / popover component
 *     • wire onClick on this button to open the drawer
 *     • mark-read mutation when an item is viewed/clicked
 *     • optional: red count badge overlay on the bell when
 *       unread > 0 (component already has the spot for a
 *       `<span>` absolutely-positioned over the icon)
 *
 *   Pre-merge: feel free to leave it as a placeholder for now —
 *   the visual is what Liam asked for. Notifications can land in
 *   its own PR.
 */
export function CustomersListHeader({ total, showing }: CustomersListHeaderProps) {
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
       *  scroll, rather than the bar being a hard solid strip. */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-border/40 bg-background/80 px-4 backdrop-blur md:-mx-6 md:px-6">
        <div className="relative flex items-center justify-center py-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground md:text-lg">
            {t('heading')}
          </h1>
          <button
            type="button"
            className="absolute right-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('notifications')}
            // STUB — click does nothing yet. See the ANTHONY block
            // in the component docstring above for the full
            // build-out (the spike also shipped this as a stub).
          >
            <Bell size={16} />
          </button>
        </div>
      </div>

      {/* Status line (left) + action button (right) — scrolls with the
       *  list. Spacing handled by parent flex-col's `gap-3` so no
       *  explicit pt here. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs tabular-nums text-muted-foreground">
          {t('statusLine', { total, showing })}
        </p>
        <CustomerSheet />
      </div>
    </>
  )
}

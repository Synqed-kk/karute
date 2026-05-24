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
 * Bell icon is a placeholder for the notifications drawer.
 * ANTHONY: wire to the real notifications source — count badge,
 * onClick → drawer/popover, mark-read endpoint, etc. Component
 * already has the slot for a red `<span>` badge over the bell.
 */
export function CustomersListHeader({ total, showing }: CustomersListHeaderProps) {
  const t = useTranslations('customers.list')
  return (
    <div className="flex flex-col">
      {/* Sticky title bar — pins to top of <main> while the list scrolls */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-border/40 bg-background/95 px-4 backdrop-blur md:-mx-6 md:px-6">
        <div className="relative flex items-center justify-center py-3">
          <h1 className="text-base font-semibold tracking-tight text-foreground md:text-lg">
            {t('heading')}
          </h1>
          <button
            type="button"
            className="absolute right-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('notifications')}
            // ANTHONY: stub — replace with real notifications drawer
            // trigger + populate a red count badge above the icon
            // when unread > 0.
          >
            <Bell size={18} />
          </button>
        </div>
      </div>

      {/* Status line (left) + action button (right) — scrolls with content */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
        <p className="text-xs tabular-nums text-muted-foreground">
          {t('statusLine', { total, showing })}
        </p>
        <CustomerSheet />
      </div>
    </div>
  )
}

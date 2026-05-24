'use client'

import { useTranslations } from 'next-intl'
import { CustomerSheet } from '@/components/customers/CustomerSheet'

interface CustomersListHeaderProps {
  total: number
  showing: number
}

/**
 * Page header — mirrors the design-spike's compact two-row layout:
 *
 *   [           顧客           ]
 *   登録中の顧客 · 全128 · 24名を表示中    [+ 新規顧客]
 *   ─────────────────────────────────
 *
 * Title is small + centered (text-base on mobile, text-lg on desktop)
 * — earlier version was text-2xl/md:text-[26px] which ate too much
 * vertical real estate above the fold. Status line sits left, action
 * button sits right. Thin divider below provides the visual section
 * break the spike uses.
 */
export function CustomersListHeader({ total, showing }: CustomersListHeaderProps) {
  const t = useTranslations('customers.list')
  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: small centered title */}
      <h1 className="text-center text-base font-semibold tracking-tight text-foreground md:text-lg">
        {t('heading')}
      </h1>

      {/* Row 2: status line (left) + action button (right) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs tabular-nums text-muted-foreground">
          {t('statusLine', { total, showing })}
        </p>
        <CustomerSheet />
      </div>

      {/* Thin divider to seal off the header section */}
      <div className="mt-1 border-b border-border/40" />
    </div>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import { CustomerSheet } from '@/components/customers/CustomerSheet'

interface CustomersListHeaderProps {
  total: number
  showing: number
}

export function CustomersListHeader({ total, showing }: CustomersListHeaderProps) {
  const t = useTranslations('customers.list')
  return (
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
      {/* Title block — centered on mobile (matches design spike), left-
       *  aligned on desktop where it sits next to the action button. */}
      <div className="flex min-w-0 flex-col gap-1 text-center md:text-left">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[26px]">
          {t('heading')}
        </h1>
        <div className="flex items-center justify-center gap-2 text-xs tabular-nums text-muted-foreground md:justify-start">
          <span>{t('total', { total })}</span>
          <span aria-hidden>·</span>
          <span>{t('showing', { n: showing })}</span>
        </div>
      </div>
      <div className="flex justify-center md:justify-end">
        <CustomerSheet />
      </div>
    </div>
  )
}

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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[26px]">
          {t('heading')}
        </h1>
        <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
          <span>{t('total', { total })}</span>
          <span aria-hidden>·</span>
          <span>{t('showing', { n: showing })}</span>
        </div>
      </div>
      <CustomerSheet />
    </div>
  )
}

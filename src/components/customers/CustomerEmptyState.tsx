'use client'

import { UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { CustomerSheet } from '@/components/customers/CustomerSheet'

export function CustomerEmptyState() {
  const t = useTranslations('customers')

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
        <UserPlus className="size-8 text-muted-foreground" />
      </div>
      <h2 className="mb-2 text-xl font-semibold">{t('empty.title')}</h2>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">
        {t('empty.description')}
      </p>
      <CustomerSheet />
    </div>
  )
}

'use client'

import { useTranslations } from 'next-intl'

export function RecordPageHeader() {
  const t = useTranslations('recording')
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
        {t('title')}
      </h1>
      <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
    </div>
  )
}

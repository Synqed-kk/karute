'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { Upload, Settings, Download } from 'lucide-react'

export function PageHeader() {
  const t = useTranslations('dataExport')
  const router = useRouter()

  return (
    <header className="rounded-2xl border border-border/30 bg-gradient-to-br from-card to-card/40 px-6 py-5 mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold tracking-[0.18em] uppercase text-blue-500 dark:text-blue-300/80 mb-1">
            {t('eyebrow')}
          </div>
          <h1 className="text-[24px] md:text-[26px] font-bold leading-tight flex items-center gap-2">
            <Download className="size-6 shrink-0 text-blue-500 dark:text-blue-300" />
            {t('title')}
          </h1>
          <p className="text-[13px] md:text-[13.5px] text-muted-foreground mt-1.5 max-w-xl">
            {t('description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/data-import')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            <Upload className="size-3.5" />
            {t('switchToImport')}
          </button>
          <button
            type="button"
            onClick={() => router.push('/settings')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            <Settings className="size-3.5" />
            {t('exportSettings')}
          </button>
        </div>
      </div>
    </header>
  )
}

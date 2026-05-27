'use client'

import { useTranslations } from 'next-intl'
import { FileSpreadsheet, History } from 'lucide-react'

// Recent-exports UI ships as an empty state until the export-history backend
// is in place. The audit log feature is on the roadmap (see Settings → Audit).
export function RecentExportsTable() {
  const t = useTranslations('dataExport')

  return (
    <section className="rounded-xl border border-border/30 bg-card/50 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/30 bg-muted/30">
        <div className="flex items-center gap-2">
          <h3 className="text-[14px] font-semibold">{t('recentExports')}</h3>
          <span className="text-[11px] text-muted-foreground font-mono">0</span>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 h-7 text-xs text-muted-foreground opacity-60 cursor-not-allowed"
          title={t('comingSoonExport')}
        >
          <FileSpreadsheet className="size-3" />
          {t('refresh')}
        </button>
      </div>
      <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
        <div className="rounded-full bg-muted p-3">
          <History className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t('comingSoonExport')}
        </p>
      </div>
    </section>
  )
}

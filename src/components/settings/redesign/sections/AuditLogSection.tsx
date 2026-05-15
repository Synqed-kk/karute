'use client'

import { useTranslations } from 'next-intl'
import { Search, Filter, FileText } from 'lucide-react'

const AUDIT_ENABLED = process.env.NEXT_PUBLIC_FEATURE_AUDIT_LOG === 'true'

export function AuditLogSection() {
  const t = useTranslations('settings')

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t('auditLog')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('auditLogDescription')}
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="search"
            disabled={!AUDIT_ENABLED}
            placeholder="Search events…"
            className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-sm disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          disabled={!AUDIT_ENABLED}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground disabled:opacity-50"
        >
          <Filter className="size-4" />
          Filter
        </button>
      </div>

      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/50 bg-card/30 px-6 py-12 text-center">
        <div className="rounded-full bg-muted p-3">
          <FileText className="size-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t('auditLogEmpty')}
        </p>
        <a
          href="mailto:sales@synqed.jp?subject=Audit%20Log%20Upgrade"
          className="mt-2 rounded-md bg-foreground text-background px-4 py-2 text-xs font-semibold hover:bg-foreground/90"
        >
          {t('contactSales')}
        </a>
      </div>
    </div>
  )
}

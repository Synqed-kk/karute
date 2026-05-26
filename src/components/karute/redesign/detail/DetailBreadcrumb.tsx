'use client'

import { useTranslations } from 'next-intl'
import { ChevronRight, FileText } from 'lucide-react'

import { Link } from '@/i18n/navigation'

interface DetailBreadcrumbProps {
  customerId: string | null
  customerName: string
  karuteNumber: string
  sessionDateLong: string
  karuteId: string
}

export function DetailBreadcrumb({
  customerId,
  customerName,
  karuteNumber,
  sessionDateLong,
  karuteId,
}: DetailBreadcrumbProps) {
  const t = useTranslations('karuteDetail')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link
          href={'/customers' as Parameters<typeof Link>[0]['href']}
          className="hover:text-foreground"
        >
          {t('breadcrumb.customers')}
        </Link>
        <ChevronRight size={14} className="opacity-50" />
        {customerId ? (
          <Link
            href={`/customers/${customerId}` as Parameters<typeof Link>[0]['href']}
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <span>{customerName}</span>
            <span className="tabular-nums text-xs text-muted-foreground/80">
              {karuteNumber}
            </span>
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span>{customerName}</span>
            <span className="tabular-nums text-xs text-muted-foreground/80">
              {karuteNumber}
            </span>
          </span>
        )}
        <ChevronRight size={14} className="opacity-50" />
        <span className="font-medium text-foreground">
          {t('breadcrumb.karute', { date: sessionDateLong })}
        </span>
      </nav>
      <div className="flex items-center gap-2">
        <Link
          href={`/api/karute/${karuteId}/export/pdf` as Parameters<typeof Link>[0]['href']}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
        >
          <FileText size={14} />
          <span>{t('actions.exportPdf')}</span>
        </Link>
        {/* Share button removed — earlier render had no onClick + no
         *  navigator.share() call, so the icon was decoration sitting
         *  next to the working PDF export and reading as the same kind
         *  of action. ANTHONY: when share-link generation is wired
         *  (signed URL + scope choice owner-vs-customer), restore as a
         *  <Link href=...> with the lucide Share2 icon. */}
      </div>
    </div>
  )
}

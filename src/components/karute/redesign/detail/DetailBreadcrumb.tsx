'use client'

import { useTranslations } from 'next-intl'
import { ChevronRight, FileText, Share2 } from 'lucide-react'

import { Link } from '@/i18n/navigation'

// Share gated on NEXT_PUBLIC_FEATURE_KARUTE_SHARE. ANTHONY needs to
// add: signed-URL generation for the karute detail page (probably
// /api/karute/[id]/share-link with expiry + scope), plus a decision
// on whether the share target is owner-only (intra-org) or customer-
// shareable (read-only link with PII scrub). The button shape below
// is the affordance spec; the onClick should POST to that endpoint
// and call navigator.share() with the returned URL.
const FEATURE_KARUTE_SHARE =
  process.env.NEXT_PUBLIC_FEATURE_KARUTE_SHARE === 'true'

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
        {/* PDF export is a DOWNLOAD hitting an API route — a plain <a download>,
         *  NOT the i18n <Link>. The i18n Link locale-prefixed the href to
         *  /ja/api/karute/.../export/pdf (no such route → 404) AND prefetched it,
         *  spamming the console with 404s. The route lives at /api/... (no locale).*/}
        <a
          href={`/api/karute/${karuteId}/export/pdf`}
          download
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
        >
          <FileText size={14} />
          <span>{t('actions.exportPdf')}</span>
        </a>
        {FEATURE_KARUTE_SHARE && (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Share2 size={14} />
            <span>{t('actions.share')}</span>
          </button>
        )}
      </div>
    </div>
  )
}

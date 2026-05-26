'use client'

// ─────────────────────────────────────────────────────────────
// RecentImportsTable — past import jobs
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/import/RecentImportsTable.tsx
// Shows the latest 10-20 imports per business — file name +
// size, scope, timestamp, who ran it, success / error counts,
// status pill, signed-URL download of the original file.
//
// ANTHONY:
//   - records prop is hydrated from a `import_sessions` query
//     scoped to business_id, ordered by created_at desc
//   - download button opens a Supabase Storage signed URL
//     (60s TTL) of the original file in import-archive/<id>/
//   - status pill flips live via Supabase Realtime channel
//     filtered on (business_id, session_id)

import { Download, FileSpreadsheet } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { ImportRecord, ImportScope, ImportStatus } from './types'

interface RecentImportsTableProps {
  records: ImportRecord[]
}

const statusStyles: Record<ImportStatus, string> = {
  completed:
    'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/20',
  processing:
    'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30',
  failed:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20',
  validating:
    'bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-500/10 dark:text-yellow-300 dark:border-yellow-500/30',
}

const statusKey: Record<ImportStatus, string> = {
  completed: 'statusCompleted',
  processing: 'statusProcessing',
  failed: 'statusFailed',
  validating: 'statusValidating',
}

const scopeKey: Record<ImportScope, string> = {
  customers: 'scopeCustomers',
  reservations: 'scopeReservations',
  karute: 'scopeKarute',
}

export function RecentImportsTable({ records }: RecentImportsTableProps) {
  const t = useTranslations('dataImport.recent')
  const tScope = useTranslations('dataImport.scope')
  const tStatus = useTranslations('dataImport.status')

  return (
    <section className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
        <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t('count', { n: records.length })}
        </span>
      </div>

      {records.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {t('emptyState')}
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/5">
          {records.map((r) => {
            const successRate =
              r.recordCount > 0
                ? Math.round((r.successCount / r.recordCount) * 100)
                : 0
            return (
              <div
                key={r.id}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 dark:border-blue-500/15 dark:bg-blue-500/10">
                  <FileSpreadsheet className="size-4 text-blue-600 dark:text-blue-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-sm font-medium text-foreground">
                      {r.fileName}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {r.fileSize}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {tScope(scopeKey[r.scope])} · {r.importedAt} ·{' '}
                    {r.importedBy}
                  </div>
                </div>
                <div className="w-[140px] shrink-0 text-right text-xs">
                  <div className="tabular-nums text-foreground">
                    <span className="font-medium text-green-700 dark:text-green-300">
                      {r.successCount}
                    </span>
                    <span className="text-muted-foreground">
                      {' '}
                      / {r.recordCount}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {t('successRate', { pct: successRate })}
                    {r.errorCount > 0 && (
                      <span className="ml-1.5 text-red-700 dark:text-red-300">
                        · {t('failedCount', { n: r.errorCount })}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium ${statusStyles[r.status]}`}
                >
                  {tStatus(statusKey[r.status])}
                </span>
                <button
                  type="button"
                  aria-label={t('downloadAria')}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-gray-100 hover:text-foreground dark:hover:bg-white/10"
                >
                  <Download className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

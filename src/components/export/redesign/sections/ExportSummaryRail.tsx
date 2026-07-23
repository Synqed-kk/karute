'use client'

import { useTranslations } from 'next-intl'
import { Download, RefreshCw, CheckCircle2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import {
  SCOPES,
  FORMATS,
  isWired,
  type FormatKey,
  type ScheduleKey,
  type ScopeKey,
} from '@/lib/export/scopes'
import type { ExportStep } from '../DataExportView'

interface ExportSummaryRailProps {
  scopeKey: ScopeKey
  format: FormatKey
  columns: string[]
  filters: Record<string, string[]>
  range: string
  privacy: boolean
  schedule: ScheduleKey
  onExport: () => void
  onReset: () => void
  busy: boolean
  step: ExportStep
  fileName: string
  downloadUrl: string | null
  /** Packet 23: called on a tap when there's no downloadUrl (thin — no
   *  object URL, the port's deliverFile handles the blob it already holds). */
  onDeliverFile: () => void
  totals: Record<ScopeKey, number>
}

const RANGE_FACTOR: Record<string, number> = {
  '7d': 0.04,
  '30d': 0.18,
  '90d': 0.45,
  ytd: 0.66,
  all: 1,
  custom: 0.5,
}

const SCHEDULE_BADGE: Record<ScheduleKey, string> = {
  once: '',
  weekly: 'weekly',
  monthly: 'monthly',
}

export function ExportSummaryRail({
  scopeKey,
  format,
  columns,
  filters,
  range,
  privacy,
  schedule,
  onExport,
  onReset,
  busy,
  step,
  fileName,
  downloadUrl,
  onDeliverFile,
  totals,
}: ExportSummaryRailProps) {
  const t = useTranslations('dataExport')
  const scope = SCOPES[scopeKey]
  const fmt = FORMATS.find((f) => f.key === format)

  const baseCount = totals[scopeKey] ?? 0
  const filterCount = Object.values(filters).reduce(
    (n, arr) => n + (arr?.length || 0),
    0,
  )
  const rangeFactor = RANGE_FACTOR[range] ?? 0.18
  const filterFactor = Math.max(0.05, 1 - filterCount * 0.18)
  const estimated = Math.max(
    1,
    Math.round(baseCount * rangeFactor * filterFactor),
  )
  const wired = isWired(scopeKey, format)

  return (
    <aside className="rounded-xl border border-border/30 bg-card/60 p-5 xl:sticky xl:top-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
          {t('exportSummary')}
        </div>
        {schedule !== 'once' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 border border-violet-500/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
            <RefreshCw className="size-2.5" /> {SCHEDULE_BADGE[schedule]}
          </span>
        )}
      </div>

      <div className="font-mono text-[12.5px] truncate" title={fileName}>
        {fileName}
      </div>
      <div className="text-[11.5px] text-muted-foreground mt-0.5">
        ≈ {estimated.toLocaleString()} {t('rows')}
      </div>

      <div className="border-t border-border/30 my-4" />

      <dl className="text-[12px] grid grid-cols-[100px_1fr] gap-y-2.5">
        <dt className="text-muted-foreground">{t('scope')}</dt>
        <dd className="flex items-center gap-1.5">
          {scope.label}
          <span className="font-mono text-muted-foreground">
            · {scope.labelJa}
          </span>
        </dd>

        <dt className="text-muted-foreground">{t('format')}</dt>
        <dd>{fmt?.label ?? format.toUpperCase()}</dd>

        <dt className="text-muted-foreground">{t('columns')}</dt>
        <dd>
          {columns.length}{' '}
          <span className="text-muted-foreground">
            / {scope.columns.length}
          </span>
        </dd>

        <dt className="text-muted-foreground">{t('dateRange')}</dt>
        <dd>
          {range === 'all'
            ? t('presetAll')
            : range === 'custom'
              ? t('presetCustom')
              : range === '7d'
                ? t('preset7d')
                : range === '30d'
                  ? t('preset30d')
                  : range === '90d'
                    ? t('preset90d')
                    : range === 'ytd'
                      ? t('presetYtd')
                      : range}
        </dd>

        <dt className="text-muted-foreground">{t('filters')}</dt>
        <dd>
          {filterCount === 0 ? (
            <span className="text-muted-foreground">{t('noneApplied')}</span>
          ) : (
            t('filtersActive', { count: filterCount })
          )}
        </dd>

        <dt className="text-muted-foreground">{t('privacy')}</dt>
        <dd
          className={
            privacy ? 'text-emerald-700 dark:text-emerald-300' : undefined
          }
        >
          {privacy ? t('redactPiiShort') : t('rawValues')}
        </dd>
      </dl>

      <div className="border-t border-border/30 my-4" />

      {step === 'configure' && (
        <>
          <button
            type="button"
            onClick={onExport}
            disabled={columns.length === 0 || busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="size-4" />
            {t('exportRows', { count: estimated.toLocaleString() })}
          </button>
          {!wired && (
            <div className="text-[10.5px] text-amber-700 dark:text-amber-300/80 mt-2 leading-relaxed">
              {t('comingSoonExport')}
            </div>
          )}
          <div className="text-[10.5px] text-muted-foreground mt-2 leading-relaxed">
            {t('auditNote')}
          </div>
        </>
      )}

      {step === 'preparing' && (
        <>
          <div className="mb-2 flex items-center gap-2 text-[12.5px]">
            <Spinner />
            {t('generating')} <span className="font-mono">{fileName}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-blue-500 animate-pulse" style={{ width: '64%' }} />
          </div>
        </>
      )}

      {step === 'done' && (
        <>
          <div className="mb-3 flex items-start gap-2.5 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-200">
                {t('exportReady')}
              </div>
              <div className="text-[11.5px] text-emerald-700/70 dark:text-emerald-100/70">
                {t('linkValid')}
              </div>
            </div>
          </div>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download={fileName}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Download className="size-4" />
              {t('downloadFile', { ext: format.toUpperCase() })}
            </a>
          ) : (
            // Thin: no object URL to link to — hand the already-fetched blob
            // to the port's deliverFile on this tap (the user gesture WebKit's
            // share() needs).
            <button
              type="button"
              onClick={onDeliverFile}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Download className="size-4" />
              {t('downloadFile', { ext: format.toUpperCase() })}
            </button>
          )}
          {downloadUrl && (
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(downloadUrl)
                toast.success('Copied')
              }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted mt-2"
            >
              <Copy className="size-3" />
              {t('copySignedUrl')}
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground mt-3 underline-offset-2 hover:underline"
          >
            Configure another export
          </button>
        </>
      )}
    </aside>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block size-3.5 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin"
      aria-hidden="true"
    />
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  defaultColumnsFor,
  FORMATS,
  isWired,
  type FormatKey,
  type ScopeKey,
  type ScheduleKey,
} from '@/lib/export/scopes'
import { ExportStepper } from './sections/ExportStepper'
import { ExportScopePicker } from './sections/ExportScopePicker'
import { ExportFormatPicker } from './sections/ExportFormatPicker'
import { ExportColumnsPicker } from './sections/ExportColumnsPicker'
import { ExportFilterPanel } from './sections/ExportFilterPanel'
import { ExportAdvancedOptions } from './sections/ExportAdvancedOptions'
import { ExportSummaryRail } from './sections/ExportSummaryRail'
import { RecentExportsTable } from './sections/RecentExportsTable'
import { PageHeader } from './sections/PageHeader'

export type ExportStep = 'configure' | 'preparing' | 'done'

interface DataExportViewProps {
  locale: string
  totals: Record<ScopeKey, number>
  /** Owner email used in the schedule-delivery hint. */
  recipientEmail: string
}

export function DataExportView({
  locale,
  totals,
  recipientEmail,
}: DataExportViewProps) {
  const t = useTranslations('dataExport')

  const [scope, setScope] = useState<ScopeKey>('customers')
  const [format, setFormat] = useState<FormatKey>('csv')
  const [step, setStep] = useState<ExportStep>('configure')
  const [privacy, setPrivacy] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleKey>('once')
  const [dateRange, setDateRange] = useState('30d')
  const [columns, setColumns] = useState<string[]>(() => defaultColumnsFor('customers'))
  const [filters, setFilters] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  // Reset format if the new scope doesn't support it
  useEffect(() => {
    const fmt = FORMATS.find((f) => f.key === format)
    if (fmt && !fmt.supports.includes(scope)) {
      setFormat('csv')
    }
  }, [scope, format])

  // Reset columns + filters when scope flips
  useEffect(() => {
    setColumns(defaultColumnsFor(scope))
    setFilters({})
    setStep('configure')
    setDownloadUrl(null)
  }, [scope])

  const activeStep = step === 'done' ? 3 : step === 'preparing' ? 2 : 0

  const fileName = useMemo(() => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '_')
    const ext = format === 'xlsx' ? 'xlsx' : format
    return `${scope}_${stamp}.${ext}`
  }, [scope, format])

  async function handleExport() {
    if (!isWired(scope, format)) {
      toast.message(t('comingSoonExport'))
      return
    }
    setBusy(true)
    setStep('preparing')
    try {
      const params = new URLSearchParams({
        scope,
        format,
        privacy: privacy ? '1' : '0',
        dateRange,
        columns: columns.join(','),
      })
      const filterPairs = Object.entries(filters).flatMap(([k, vs]) =>
        vs.map((v) => `${k}=${encodeURIComponent(v)}`),
      )
      if (filterPairs.length) params.set('filters', filterPairs.join('&'))

      const res = await fetch(`/api/export?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setDownloadUrl(url)
      setStep('done')
      // Auto-trigger the download
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      console.error('[export]', err)
      toast.error(t('exportFailed'))
      setStep('configure')
    } finally {
      setBusy(false)
    }
  }

  function handleReset() {
    setStep('configure')
    setDownloadUrl(null)
  }

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 md:px-6 lg:px-8 py-6 md:py-8">
      <PageHeader />

      <ExportStepper activeStep={activeStep} />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        <div className="min-w-0 space-y-6">
          <ExportScopePicker
            value={scope}
            onChange={setScope}
            totals={totals}
            locale={locale}
          />

          <ExportFormatPicker
            scopeKey={scope}
            value={format}
            onChange={setFormat}
          />

          <ExportColumnsPicker
            scopeKey={scope}
            selected={columns}
            onChange={setColumns}
            privacy={privacy}
          />

          <ExportFilterPanel
            scopeKey={scope}
            filters={filters}
            onChange={setFilters}
            range={dateRange}
            onRangeChange={setDateRange}
          />

          <ExportAdvancedOptions
            privacy={privacy}
            onPrivacyChange={setPrivacy}
            schedule={schedule}
            onScheduleChange={setSchedule}
            scopeKey={scope}
            recipientEmail={recipientEmail}
          />

          <RecentExportsTable />
        </div>

        <div className="hidden xl:block">
          <ExportSummaryRail
            scopeKey={scope}
            format={format}
            columns={columns}
            filters={filters}
            range={dateRange}
            privacy={privacy}
            schedule={schedule}
            onExport={handleExport}
            onReset={handleReset}
            busy={busy}
            step={step}
            fileName={fileName}
            downloadUrl={downloadUrl}
            totals={totals}
          />
        </div>
      </div>

      <div className="xl:hidden mt-6">
        <ExportSummaryRail
          scopeKey={scope}
          format={format}
          columns={columns}
          filters={filters}
          range={dateRange}
          privacy={privacy}
          schedule={schedule}
          onExport={handleExport}
          onReset={handleReset}
          busy={busy}
          step={step}
          fileName={fileName}
          downloadUrl={downloadUrl}
          totals={totals}
        />
      </div>

      <footer className="mt-12 pt-6 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <ShieldGlyph />
          {t('footerNote')}
        </div>
        <div>{t('footerVersion')}</div>
      </footer>
    </div>
  )
}

function ShieldGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z" />
    </svg>
  )
}

'use client'

import { getDataPort } from '@/lib/ports/data-port'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  // Thin path only (packet 23): the fetched blob held in state instead of an
  // object URL, so the done-step affordance can hand it to deliverFile on a
  // later user gesture (WebKit's share() needs one — see the port's doc).
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null)
  const [delivering, setDelivering] = useState(false)

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
    setPendingBlob(null)
  }, [scope])

  // The FULL request as a key (fresh-eyes rounds 2+3): the pickers stay
  // tappable while a fetch is in flight and after completion, so a result is
  // only valid while EVERY parameter that produced it still matches the
  // screen. Round 2 keyed scope|format only; round 3 caught the worse case —
  // flip 個人情報をリダクト mid-fetch and the RAW file delivers under a
  // panel that says redacted. Any param change: (a) drops an in-flight
  // result, (b) resets a shown done panel — the summary rail always renders
  // LIVE state, so a held blob must never outlive the state that made it.
  const requestKey = useMemo(
    () =>
      [
        scope,
        format,
        privacy ? '1' : '0',
        dateRange,
        // columns order matters (it IS the CSV column order); filters are an
        // unordered map — sort keys so clear-and-rebuild in a different order
        // can't falsely invalidate a still-accurate result (round 4).
        columns.join(','),
        Object.keys(filters)
          .sort()
          .map((k) => `${k}:${filters[k].join('+')}`)
          .join('&'),
      ].join('|'),
    [scope, format, privacy, dateRange, columns, filters],
  )
  const liveExportKey = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    liveExportKey.current = requestKey
    setStep((s) => (s === 'configure' ? s : 'configure'))
    setDownloadUrl(null)
    setPendingBlob(null)
    // Abort the abandoned fetch in the CLEANUP (rounds 4+5): it runs both
    // before the next param-change invocation (round 4's greyed dead-window
    // fix) AND on unmount (round 5 — navigating away mid-export otherwise
    // let the fetch finish in the background; on web the auto-deliver then
    // fired a surprise PII file download onto an unrelated page).
    return () => abortRef.current?.abort()
  }, [requestKey])

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
    // Hoisted above the try: the catch's staleness check needs it too.
    const startKey = requestKey
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

      // exportBase seam: web same-origin base vs the shell's facade twin —
      // the cookie-only web route 401s on the Bearer path (aiBase precedent;
      // Greptile P1 on #588). Values live on the ports; the seam-coverage
      // sweep fails any quoted web-path literal in components, comments
      // included.
      const ac = new AbortController()
      abortRef.current = ac
      const port = getDataPort()
      const res = await port.apiFetch(`${port.exportBase}?${params.toString()}`, {
        signal: ac.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      if (liveExportKey.current !== startKey) {
        // ANY export parameter changed while this fetch ran — the result no
        // longer matches the request on screen. Drop it and unstick the
        // step; they re-tap export.
        setStep('configure')
        return
      }
      if (port.supportsAutoDeliver) {
        // Web: current behavior verbatim — a persistent object-URL link/copy
        // button (ExportSummaryRail's done step) PLUS the auto-triggered
        // download, now living in the port's deliverFile.
        setDownloadUrl(URL.createObjectURL(blob))
        setStep('done')
        await port.deliverFile(blob, fileName)
      } else {
        // Thin: no auto-deliver (no user gesture yet for WebKit's share()) —
        // hold the blob for the done-step affordance to hand to deliverFile.
        setPendingBlob(blob)
        setStep('done')
      }
    } catch (err) {
      // An abandoned request (params changed → aborted, or failed after
      // going stale) must never toast — the user already replaced it
      // (round 4: the stale-failure toast referred to an export the user
      // had forgotten about).
      if ((err as Error)?.name === 'AbortError' || liveExportKey.current !== startKey) {
        setStep((s) => (s === 'preparing' ? 'configure' : s))
        return
      }
      console.error('[export]', err)
      toast.error(t('exportFailed'))
      setStep('configure')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeliverFile() {
    // Re-entrancy guard: a second tap while the share sheet is open would
    // fire a concurrent share() — WebKit rejects it with a non-Abort error,
    // which would fall through to the clipboard and toast 'copied' while the
    // first sheet is still up.
    if (!pendingBlob || delivering) return
    setDelivering(true)
    try {
      const result = await getDataPort().deliverFile(pendingBlob, fileName)
      if (result === 'copied') toast.message(t('copiedToClipboard'))
    } catch (err) {
      console.error('[export]', err)
      toast.error(t('exportFailed'))
    } finally {
      setDelivering(false)
    }
  }

  function handleReset() {
    setStep('configure')
    setDownloadUrl(null)
    setPendingBlob(null)
    // `delivering` deliberately NOT reset: it mirrors an in-flight share
    // sheet, not this panel — clearing it early would re-arm the button the
    // re-entrancy guard exists to disable. Its own finally clears it.
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

          {/* RecentExportsTable hidden — backend for export history
           *  (`export_jobs` or similar) doesn't exist yet, so the
           *  table always renders empty with a disabled refresh
           *  button + hardcoded "0" count. ANTHONY: when an
           *  export-history backend ships, unwrap this gate. */}
          {process.env.NEXT_PUBLIC_FEATURE_EXPORT_HISTORY === 'true' && (
            <RecentExportsTable />
          )}
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
            onDeliverFile={handleDeliverFile}
            delivering={delivering}
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
          onDeliverFile={handleDeliverFile}
          delivering={delivering}
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

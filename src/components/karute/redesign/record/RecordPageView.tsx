'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, ConsentCheckCard } from '@synqed-kk/ui'

import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { useWaveformBars } from '@/hooks/use-waveform-bars'
import { PipelineContainer } from '@/components/review/PipelineContainer'
import { useTimetableStore } from '@/stores/timetable-store'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import {
  getCustomerConsent,
  grantCustomerConsent,
} from '@/actions/customers'

import { RecordPageHeader } from './RecordPageHeader'
import {
  RecordingTargetCard,
  type RecordTargetAppointment,
  type RecordTargetBooking,
} from './RecordingTargetCard'
import {
  PreSessionBriefCard,
  type PreSessionBrief,
} from './PreSessionBriefCard'
import { SourceModeChips } from './SourceModeChips'
import { RecordButtonCard } from './RecordButtonCard'
import { ConsentPill } from './ConsentPill'
import {
  RecentRecordingsCard,
  type RecentRecording,
} from './RecentRecordingsCard'
import { LiveTranscriptCard } from './LiveTranscriptCard'

export interface RecordPageNextAppointment {
  id: string
  customerName: string
  customerId: string
  startTime: string
  durationMinutes: number
  title: string | null
  notes: string | null
  /** Server-derived status at render time. Decouples this client
   *  component from `Date.now()` (which React Compiler flags as
   *  impure during render). Re-derive on the next server render
   *  if the page is revisited. */
  statusKey?: 'in-session' | 'booked' | 'done'
}

export interface RecordPageViewProps {
  customers: CustomerOption[]
  locale: string
  nextAppointment: RecordPageNextAppointment | null
  nearbyBookings: RecordTargetBooking[]
  brief: PreSessionBrief | null
  recentRecordings: RecentRecording[]
  /** Pre-formatted "Mar 12, 2026" (or locale equivalent). */
  consentDate: string | null
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatHHMM(d: Date): string {
  // Pin to JST so the time-range pill ("11:30–12:30") matches the booking
  // dialog input regardless of where the renderer is running.
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function RecordPageView({
  customers,
  locale,
  nextAppointment,
  nearbyBookings,
  brief,
  recentRecordings,
  consentDate,
}: RecordPageViewProps) {
  const t = useTranslations('recording')
  const tc = useTranslations('common')
  const recordingAppointmentId = useTimetableStore((s) => s.recordingAppointmentId)

  const {
    state: recState,
    result,
    error: micError,
    stream,
    startedAt,
    startRecording,
    stopRecording,
    discardRecording,
  } = useGlobalRecorder()

  type Phase = 'idle' | 'recording' | 'recorded' | 'pipeline'
  const [phase, setPhase] = useState<Phase>(() => {
    if (recState === 'recording' || recState === 'paused') return 'recording'
    if (recState === 'recorded') return 'recorded'
    return 'idle'
  })
  const [showNoBookingPrompt, setShowNoBookingPrompt] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)

  const [consent, setConsent] = useState<{ granted: boolean; grantedAt: string | null } | null>(null)
  const [showConsentDialog, setShowConsentDialog] = useState(false)
  const [consentSubmitting, setConsentSubmitting] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)

  const customerIdForConsent = nextAppointment?.customerId ?? null
  const refreshConsent = useCallback(async () => {
    if (!customerIdForConsent) {
      setConsent(null)
      return
    }
    try {
      const { consent: row } = await getCustomerConsent(customerIdForConsent)
      setConsent({ granted: !!row, grantedAt: row?.granted_at ?? null })
    } catch {
      setConsent({ granted: false, grantedAt: null })
    }
  }, [customerIdForConsent])
  useEffect(() => {
    refreshConsent()
  }, [refreshConsent])

  async function handleGrantConsent() {
    if (!customerIdForConsent) return
    setConsentSubmitting(true)
    setConsentError(null)
    const r = await grantCustomerConsent(customerIdForConsent, { method: 'VERBAL' })
    setConsentSubmitting(false)
    if (!r.ok) {
      setConsentError(r.error)
      return
    }
    setShowConsentDialog(false)
    await refreshConsent()
  }

  const consentRequired = !!customerIdForConsent
  const consentGranted = consent?.granted ?? false
  const recordingBlocked = consentRequired && !consentGranted

  const bars = useWaveformBars(stream, recState === 'recording')
  const normalizedBars = bars.map((h) => Math.max(0.15, Math.min(1, h / 100)))
  const [frozenBars, setFrozenBars] = useState<number[]>([])
  useEffect(() => {
    if (recState === 'recording') setFrozenBars(bars)
  }, [recState, bars])

  // Sync global recorder state to local phase
  useEffect(() => {
    if (recState === 'recording' || recState === 'paused') {
      setPhase('recording')
    } else if (recState === 'recorded' && result) {
      setRecordingDuration(Math.round(result.durationMs / 1000))
      setPhase('recorded')
    } else if (recState === 'idle') {
      setPhase('idle')
    }
  }, [recState, result])

  const elapsed = useElapsed(recState, startedAt)

  function handleStartRecording() {
    if (!nextAppointment) {
      setShowNoBookingPrompt(true)
      return
    }
    startRecording()
  }
  function handleStartAnyway() {
    setShowNoBookingPrompt(false)
    startRecording()
  }
  function handleDiscard() {
    discardRecording()
    setPhase('idle')
  }
  function handleUseRecording() {
    setPhase('pipeline')
  }
  function handleNewSession() {
    discardRecording()
    setPhase('idle')
  }

  // Pipeline phase — delegate to existing review/save flow
  if (phase === 'pipeline' && result) {
    const effectiveAppointmentId = recordingAppointmentId ?? nextAppointment?.id
    const effectiveCustomerId = recordingAppointmentId ? undefined : nextAppointment?.customerId
    return (
      <PipelineContainer
        audioBlob={result.blob}
        locale={locale}
        customers={customers}
        duration={Math.round(result.durationMs / 1000)}
        appointmentId={effectiveAppointmentId}
        appointmentCustomerId={effectiveCustomerId}
        onCancel={handleNewSession}
        onSaved={handleNewSession}
      />
    )
  }

  // Map nextAppointment to the target card shape. Status key comes
  // from the server (sessions/page.tsx derives it from now vs the
  // appointment window — keeps this client component pure for
  // React Compiler). 新規 (isFirstTimeVisit) flows from the brief.
  const targetAppointment: RecordTargetAppointment | null = nextAppointment
    ? {
        id: nextAppointment.id,
        customerName: nextAppointment.customerName,
        initials: deriveInitials(nextAppointment.customerName),
        karuteNumber: null,
        service: nextAppointment.title ?? '—',
        timeRange: (() => {
          const start = new Date(nextAppointment.startTime)
          const end = new Date(
            start.getTime() + nextAppointment.durationMinutes * 60_000,
          )
          return `${formatHHMM(start)}–${formatHHMM(end)}`
        })(),
        staffName: '—',
        statusKey: nextAppointment.statusKey ?? 'booked',
        isNew: brief?.isFirstTimeVisit ?? false,
      }
    : null

  const isRecording = phase === 'recording'
  // When there's no booking, the empty-state target card is a small banner —
  // collapse to a single column so the record button isn't dwarfed by a half-empty grid.
  const layoutMode: 'single' | 'split' = targetAppointment ? 'split' : 'single'

  const recorderControls = phase === 'recorded' ? (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-7 shadow-sm">
      <div className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {`${pad2(Math.floor(recordingDuration / 60))}:${pad2(recordingDuration % 60)}`}
      </div>
      <div className="flex h-10 items-end gap-[3px] opacity-50">
        {frozenBars.map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-muted-foreground/50"
            style={{ height: `${Math.max(15, Math.min(100, h * 0.6))}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex w-full items-center gap-3">
        <Button variant="outline" size="md" className="flex-1" onClick={handleDiscard}>
          {t('discard')}
        </Button>
        <Button variant="default" size="md" className="flex-1" onClick={handleUseRecording}>
          {t('useRecording')}
        </Button>
      </div>
    </section>
  ) : (
    <RecordButtonCard
      customerName={nextAppointment?.customerName ?? null}
      isRecording={isRecording}
      elapsedSeconds={elapsed}
      waveform={normalizedBars}
      onStart={() => {
        if (recordingBlocked) return
        handleStartRecording()
      }}
      onStop={stopRecording}
    />
  )

  const recorderColumn = (
    <div className="flex flex-col gap-3.5">
      <SourceModeChips />
      {recorderControls}
      <div className="flex justify-center">
        <ConsentPill consentDate={consentDate} />
      </div>
      {phase === 'idle' && nextAppointment && consent && !consent.granted && (
        <ConsentCheckCard
          consented={false}
          customerName={nextAppointment.customerName}
          labels={{
            grantedTitle: t('consentGrantedTitle'),
            grantedDesc: t('consentGrantedDesc'),
            grantedWhen: t('consentGrantedWhen'),
            missingTitle: t('consentMissingTitle'),
            missingDesc: t('consentMissingDesc'),
            startFlow: t('consentStartFlow'),
          }}
          onStartConsent={() => {
            setConsentError(null)
            setShowConsentDialog(true)
          }}
        />
      )}
    </div>
  )

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <RecordPageHeader />

      {micError && (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-destructive) 30%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)',
            color: 'var(--color-destructive)',
          }}
        >
          {t('micError')}
        </div>
      )}

      {layoutMode === 'split' ? (
        <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 self-start">
            <RecordingTargetCard
              appointment={targetAppointment}
              nearbyBookings={nearbyBookings}
            />
            <PreSessionBriefCard
              brief={brief}
              customerName={nextAppointment?.customerName ?? null}
            />
          </div>
          <div className="self-start">{recorderColumn}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <RecordingTargetCard
            appointment={targetAppointment}
            nearbyBookings={nearbyBookings}
          />
          <PreSessionBriefCard
            brief={brief}
            customerName={nextAppointment?.customerName ?? null}
          />
          <div className="mx-auto w-full max-w-md">{recorderColumn}</div>
        </div>
      )}

      <LiveTranscriptCard connected={false} lines={[]} />

      <RecentRecordingsCard recordings={recentRecordings} />

      {/* Consent dialog */}
      {showConsentDialog && nextAppointment && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => !consentSubmitting && setShowConsentDialog(false)}
          />
          <div
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl bg-card p-6 shadow-xl ring-1 ring-border"
          >
            <h3 className="text-base font-semibold text-foreground">{t('consentDialogTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('consentDialogInstructions')}</p>
            <div className="rounded-md bg-muted p-4 text-sm leading-relaxed text-foreground">
              {t('consentScript', { customerName: nextAppointment.customerName })}
            </div>
            {consentError && <p className="text-sm text-destructive">{consentError}</p>}
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setShowConsentDialog(false)}
                disabled={consentSubmitting}
              >
                {tc('cancel')}
              </Button>
              <Button
                variant="default"
                size="md"
                className="flex-1"
                onClick={handleGrantConsent}
                disabled={consentSubmitting}
              >
                {consentSubmitting ? tc('saving') : t('consentConfirmButton')}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* No-booking prompt */}
      {showNoBookingPrompt && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowNoBookingPrompt(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">{t('noBookingTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('noBookingDescription')}</p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setShowNoBookingPrompt(false)}
              >
                {tc('cancel')}
              </Button>
              <Button
                variant="default"
                size="md"
                className="flex-1"
                onClick={handleStartAnyway}
              >
                {t('recordAnyway')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function useElapsed(recState: string, startedAt: number | null): number {
  const [seconds, setSeconds] = useState(() => {
    if (recState === 'recording' && startedAt) {
      return Math.floor((Date.now() - startedAt) / 1000)
    }
    return 0
  })
  useEffect(() => {
    if (recState !== 'recording') return
    const id = setInterval(() => {
      if (startedAt) setSeconds(Math.floor((Date.now() - startedAt) / 1000))
      else setSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [recState, startedAt])
  useEffect(() => {
    if (recState === 'idle') setSeconds(0)
  }, [recState])
  return seconds
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

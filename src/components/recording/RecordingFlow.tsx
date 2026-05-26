'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import {
  AudioSourceIndicator,
  Button,
  ConsentCheckCard,
  DisclosureModeIndicator,
  PageHeader,
} from '@synqed-kk/ui'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { useWaveformBars } from '@/hooks/use-waveform-bars'
import { PipelineContainer } from '@/components/review/PipelineContainer'
import { useTimetableStore } from '@/stores/timetable-store'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import {
  getCustomerConsent,
  grantCustomerConsent,
} from '@/actions/customers'

type FlowPhase = 'idle' | 'recording' | 'recorded' | 'pipeline'

interface NextAppointment {
  id: string
  customerName: string
  customerId: string
  startTime: string
  durationMinutes: number
  title: string | null
  notes: string | null
}

interface RecordingFlowProps {
  customers: CustomerOption[]
  locale: string
  nextAppointment?: NextAppointment | null
  staffOptions: { id: string; name: string }[]
}

export function RecordingFlow({ customers, locale, nextAppointment, staffOptions }: RecordingFlowProps) {
  const t = useTranslations('recording')
  const tc = useTranslations('common')
  // Appointment ID set when recording was started from dashboard appointment click
  const recordingAppointmentId = useTimetableStore((s) => s.recordingAppointmentId)

  const {
    state: recState,
    result,
    error: micError,
    stream,
    startedAt,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    discardRecording,
  } = useGlobalRecorder()

  // Initialize phase from current recorder state so there's no flash of idle UI
  const [phase, setPhase] = useState<FlowPhase>(() => {
    if (recState === 'recording' || recState === 'paused') return 'recording'
    if (recState === 'recorded') return 'recorded'
    return 'idle'
  })
  const [showNoBookingPrompt, setShowNoBookingPrompt] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)

  // Consent state — fetched per-customer when there's an upcoming appointment.
  const [consent, setConsent] = useState<{
    granted: boolean
    grantedAt: string | null
  } | null>(null)
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
    const result = await grantCustomerConsent(customerIdForConsent, {
      method: 'VERBAL',
    })
    setConsentSubmitting(false)
    if (!result.ok) {
      setConsentError(result.error)
      return
    }
    setShowConsentDialog(false)
    await refreshConsent()
  }

  // Recording is gated on consent only when a customer is bound to the session.
  const consentRequired = !!customerIdForConsent
  const consentGranted = consent?.granted ?? false
  const recordingBlocked = consentRequired && !consentGranted

  const bars = useWaveformBars(stream, recState === 'recording')
  // Cache the most recent live bars in STATE (not a ref) so we can
  // render a frozen dimmed version after recording stops. React
  // Compiler flags both reads AND writes of refs during render as
  // errors ("Cannot access refs during render") — moving to state
  // makes the snapshot officially reactive and fixes the lint
  // errors that were surfacing in the Vercel toolbar's "10 Issues"
  // badge. The state only updates while recording, so it captures
  // the last live bars at the moment recording stops; afterwards
  // it persists for the dimmed render.
  const [lastBars, setLastBars] = useState<number[]>([])
  useEffect(() => {
    if (recState === 'recording') {
      setLastBars(bars)
    }
  }, [recState, bars])

  // Sync global recorder state to local phase
  useEffect(() => {
    if (recState === 'recording' || recState === 'paused') {
      setPhase('recording')
    } else if (recState === 'recorded' && result) {
      setRecordingDuration(Math.round(result.durationMs / 1000))
      setPhase('recorded')
    }
  }, [recState, result])

  function handleStartRecording() {
    if (!nextAppointment) {
      setShowNoBookingPrompt(true)
      return
    }
    startRecording()
  }

  function handleStartAnywayWithoutBooking() {
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

  // --- Pipeline phase: processes audio then shows review+save in one screen ---
  if (phase === 'pipeline' && result) {
    // Use the appointment from dashboard click if available, otherwise fall back to next appointment
    const effectiveAppointmentId = recordingAppointmentId ?? nextAppointment?.id
    const effectiveCustomerId = recordingAppointmentId
      ? undefined // customer will be resolved from the appointment in the pipeline
      : nextAppointment?.customerId

    return (
      <PipelineContainer
        audioBlob={result.blob}
        locale={locale}
        customers={customers}
        duration={result ? Math.round(result.durationMs / 1000) : 0}
        appointmentId={effectiveAppointmentId}
        appointmentCustomerId={effectiveCustomerId}
        staffOptions={staffOptions}
        onCancel={handleNewSession}
        onSaved={handleNewSession}
      />
    )
  }

  // Format appointment details
  const appointmentDate = nextAppointment
    ? new Date(nextAppointment.startTime).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : null
  const appointmentTime = nextAppointment
    ? new Date(nextAppointment.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  const frozenBars =
    lastBars.length > 0 ? lastBars.map((h) => Math.max(6, h * 0.4)) : []

  // --- Idle / Recording / Recorded phases ---
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4 md:px-6 py-6">
      <div className="w-full max-w-md">
        <PageHeader
          title={t('title')}
          subtitle={t('recordDescription')}
          actions={
            <div className="flex items-center gap-2">
              <AudioSourceIndicator
                source="phone_mic"
                label={t('title')}
                size="compact"
              />
              <DisclosureModeIndicator
                mode="A"
                label="Mode A"
                summary="Implicit recording"
                size="compact"
              />
            </div>
          }
        />
      </div>

      {/* Microphone error */}
      {micError && (
        <div
          className="rounded-[var(--radius-md)] border px-4 py-3 text-sm max-w-md text-center"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-destructive) 30%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)',
            color: 'var(--color-destructive)',
          }}
        >
          {t('micError')}
        </div>
      )}

      {/* Waveform + timer area — visible during recording AND recorded phases */}
      <div className="flex flex-col items-center justify-center h-[160px] w-full max-w-xs">
        {phase === 'recording' && (
          <>
            <div className="flex items-end justify-center gap-[3px] h-[100px] w-full">
              {bars.map((height, i) => (
                <div
                  key={i}
                  className="w-[6px] rounded-full bg-red-500/70 transition-[height] duration-100 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
                  style={{ height: `${height}px` }}
                />
              ))}
            </div>
            <div className="mt-2">
              <RecordingTimer paused={recState === 'paused'} startedAt={startedAt} />
            </div>
            {recState === 'paused' && (
              <p className="text-sm text-muted-foreground mt-1">{t('paused')}</p>
            )}
          </>
        )}
        {phase === 'recorded' && frozenBars.length > 0 && (
          <>
            <div className="flex items-end justify-center gap-[3px] h-[100px] w-full opacity-50">
              {frozenBars.map((height, i) => (
                <div
                  key={i}
                  className="w-[6px] rounded-full bg-muted-foreground/40"
                  style={{ height: `${height}px` }}
                />
              ))}
            </div>
            <p className="mt-2 text-lg font-mono text-muted-foreground tabular-nums">
              {String(Math.floor(recordingDuration / 60)).padStart(2, '0')}:
              {String(recordingDuration % 60).padStart(2, '0')}
            </p>
          </>
        )}
      </div>

      {/* Action buttons — stop replaces record in same position */}
      <div className="relative flex items-center justify-center h-16">
        {/* Center button: Record (idle) or Stop (recording) */}
        {phase === 'idle' && (
          <button
            type="button"
            onClick={handleStartRecording}
            disabled={recordingBlocked}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 transition-colors shadow-lg shadow-red-500/25 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500"
            aria-label={t('start')}
          >
            <MicIcon />
          </button>
        )}

        {phase === 'recording' && (
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 transition-colors shadow-lg shadow-red-500/25"
            aria-label={t('stop')}
          >
            <StopIcon />
          </button>
        )}

        {/* Pause/Resume button — appears to the right when recording */}
        {phase === 'recording' && (
          <div className="absolute left-[calc(50%+48px)]">
            {recState === 'paused' ? (
              <button
                type="button"
                onClick={resumeRecording}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                aria-label={t('resume')}
              >
                <PlayIcon />
              </button>
            ) : (
              <button
                type="button"
                onClick={pauseRecording}
                className="flex items-center justify-center w-10 h-10 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                aria-label={t('paused')}
              >
                <PauseIcon />
              </button>
            )}
          </div>
        )}

        {/* RECORDED: discard / use recording */}
        {phase === 'recorded' && (
          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" onClick={handleDiscard}>
              {t('discard')}
            </Button>
            <Button variant="default" size="lg" onClick={handleUseRecording}>
              {t('useRecording')}
            </Button>
          </div>
        )}
      </div>

      {/* Recording consent — only when there's a customer bound to the session and we're idle */}
      {phase === 'idle' && nextAppointment && consent && (
        <div className="w-full max-w-sm">
          <ConsentCheckCard
            consented={consent.granted}
            consentDate={
              consent.grantedAt
                ? new Date(consent.grantedAt).toLocaleDateString(locale)
                : undefined
            }
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
        </div>
      )}

      {/* Appointment card with full details */}
      <div
        className="w-full max-w-sm rounded-[var(--radius-lg)] p-4 ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        style={{
          backgroundColor: 'var(--color-bg-card)',
        }}
      >
        <p
          className="text-xs font-medium mb-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t('recordingFor')}
        </p>
        {nextAppointment ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">{nextAppointment.customerName}</p>
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{appointmentDate}</span>
              <span>{appointmentTime}</span>
              <span>{nextAppointment.durationMinutes}min</span>
            </div>
            {nextAppointment.title && (
              <p className="text-sm text-foreground/80">{nextAppointment.title}</p>
            )}
            {nextAppointment.notes && (
              <p className="text-xs text-muted-foreground italic">{nextAppointment.notes}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noUpcomingAppointment')}</p>
        )}
      </div>

      {/* Consent script modal — staff reads the script aloud, customer agrees verbally */}
      {showConsentDialog && nextAppointment && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => !consentSubmitting && setShowConsentDialog(false)}
          />
          <div
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-[var(--radius-lg)] p-6 shadow-xl space-y-4 ring-1 ring-black/5"
            style={{ backgroundColor: 'var(--color-bg-card)' }}
          >
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              {t('consentDialogTitle')}
            </h3>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {t('consentDialogInstructions')}
            </p>
            <div
              className="rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] p-4 text-sm leading-relaxed"
              style={{ color: 'var(--color-text)' }}
            >
              {t('consentScript', { customerName: nextAppointment.customerName })}
            </div>
            {consentError && (
              <p className="text-sm text-[var(--color-destructive)]">{consentError}</p>
            )}
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

      {/* No-booking prompt modal */}
      {showNoBookingPrompt && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setShowNoBookingPrompt(false)} />
          <div
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm rounded-[var(--radius-lg)] border p-6 shadow-xl space-y-4"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-bg-card)',
            }}
          >
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              {t('noBookingTitle')}
            </h3>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {t('noBookingDescription')}
            </p>
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
                onClick={handleStartAnywayWithoutBooking}
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

// --- Sub-components ---

function RecordingTimer({ paused, startedAt }: { paused: boolean; startedAt: number | null }) {
  const t = useTranslations('recording')
  const [seconds, setSeconds] = useState(() => {
    // Initialize from global recorder's startedAt so timer survives navigation
    if (startedAt) return Math.floor((Date.now() - startedAt) / 1000)
    return 0
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (paused) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [paused])

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  // Whisper transcription has a server timeout (~5 min) and quality drops on
  // very long single-recording sessions. Warn at 30 min so the stylist knows
  // to wrap up or split into multiple recordings.
  const longRecording = seconds >= 30 * 60
  return (
    <div className="flex flex-col items-center gap-1">
      <p
        className={
          longRecording
            ? 'text-2xl font-mono tabular-nums text-[var(--color-warning)]'
            : 'text-2xl font-mono tabular-nums text-foreground/70'
        }
      >
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </p>
      {longRecording && (
        <p className="text-[11px] text-[var(--color-warning)]">
          {t('longRecordingWarning')}
        </p>
      )}
    </div>
  )
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-white">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-white">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-white">
      <polygon points="6,3 20,12 6,21" />
    </svg>
  )
}

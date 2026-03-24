'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { useWaveformBars } from '@/hooks/use-waveform-bars'
import { PipelineContainer } from '@/components/review/PipelineContainer'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

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
}

export function RecordingFlow({ customers, locale, nextAppointment }: RecordingFlowProps) {
  const t = useTranslations('recording')
  const [phase, setPhase] = useState<FlowPhase>('idle')
  const [showNoBookingPrompt, setShowNoBookingPrompt] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)

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

  const bars = useWaveformBars(stream, recState === 'recording')
  const lastBarsRef = useRef<number[]>([])
  if (recState === 'recording') {
    lastBarsRef.current = bars
  }

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
    return (
      <PipelineContainer
        audioBlob={result.blob}
        locale={locale}
        customers={customers}
        duration={result ? Math.round(result.durationMs / 1000) : 0}
        appointmentId={nextAppointment?.id}
        appointmentCustomerId={nextAppointment?.customerId}
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

  const frozenBars = lastBarsRef.current.length > 0
    ? lastBarsRef.current.map((h) => Math.max(6, h * 0.4))
    : []

  // --- Idle / Recording / Recorded phases ---
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      {/* Microphone error */}
      {micError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300 max-w-md text-center">
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
              <RecordingTimer paused={recState === 'paused'} />
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
            className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 transition-colors shadow-lg shadow-red-500/25"
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
          <>
            <button
              type="button"
              onClick={handleDiscard}
              className="px-5 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              {t('discard')}
            </button>
            <button
              type="button"
              onClick={handleUseRecording}
              className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              {t('useRecording')}
            </button>
          </>
        )}
      </div>

      {/* Title + subtitle below buttons */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('recordDescription')}</p>
      </div>

      {/* Appointment card with full details */}
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">{t('recordingFor')}</p>
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

      {/* No-booking prompt modal */}
      {showNoBookingPrompt && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setShowNoBookingPrompt(false)} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-foreground">{t('noBookingTitle')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('noBookingDescription')}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowNoBookingPrompt(false)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartAnywayWithoutBooking}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {t('recordAnyway')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// --- Sub-components ---

function RecordingTimer({ paused }: { paused: boolean }) {
  const [seconds, setSeconds] = useState(0)
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
  return (
    <p className="text-2xl font-mono text-foreground/70 tabular-nums">
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </p>
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

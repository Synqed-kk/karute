'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useMediaRecorder } from '@/hooks/use-media-recorder'
import { useWaveformBars } from '@/hooks/use-waveform-bars'
import { PipelineContainer } from '@/components/review/PipelineContainer'
import { ReviewConfirmStep } from '@/components/review/ReviewConfirmStep'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import type { Entry } from '@/types/ai'

type FlowPhase = 'idle' | 'recording' | 'recorded' | 'pipeline' | 'confirm'

interface NextAppointment {
  id: string
  customerName: string
  customerId: string
  startTime: string
  durationMinutes: number
}

interface RecordingFlowProps {
  customers: CustomerOption[]
  locale: string
  nextAppointment?: NextAppointment | null
}

interface ConfirmData {
  transcript: string
  summary: string
  entries: Entry[]
  duration: number
}

export function RecordingFlow({ customers, locale, nextAppointment }: RecordingFlowProps) {
  const t = useTranslations('recording')
  const [phase, setPhase] = useState<FlowPhase>('idle')
  const [confirmData, setConfirmData] = useState<ConfirmData | null>(null)

  const {
    state: recState,
    result,
    error: micError,
    stream,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    discardRecording,
  } = useMediaRecorder()

  const bars = useWaveformBars(stream, recState === 'recording')

  // Sync useMediaRecorder state to flow phase
  useEffect(() => {
    if (recState === 'recording' || recState === 'paused') {
      setPhase('recording')
    } else if (recState === 'recorded' && result) {
      setPhase('recorded')
    }
  }, [recState, result])

  function handleDiscard() {
    discardRecording()
    setPhase('idle')
  }

  function handleUseRecording() {
    setPhase('pipeline')
  }

  function handlePipelineConfirm(data: { entries: Entry[]; summary: string; transcript: string }) {
    setConfirmData({
      transcript: data.transcript,
      summary: data.summary,
      entries: data.entries,
      duration: result ? Math.round(result.durationMs / 1000) : 0,
    })
    setPhase('confirm')
  }

  function handleNewSession() {
    discardRecording()
    setConfirmData(null)
    setPhase('idle')
  }

  // --- Pipeline phase: hand off to PipelineContainer ---
  if (phase === 'pipeline' && result) {
    return (
      <PipelineContainer
        audioBlob={result.blob}
        locale={locale}
        onConfirm={handlePipelineConfirm}
        onCancel={handleNewSession}
      />
    )
  }

  // --- Confirm phase: show save flow ---
  if (phase === 'confirm' && confirmData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Review Complete</h1>
          <button
            type="button"
            onClick={handleNewSession}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('newSession')}
          </button>
        </div>
        <ReviewConfirmStep
          transcript={confirmData.transcript}
          summary={confirmData.summary}
          entries={confirmData.entries}
          customers={customers}
          duration={confirmData.duration}
          appointmentId={nextAppointment?.id}
          appointmentCustomerId={nextAppointment?.customerId}
        />
      </div>
    )
  }

  // Format appointment time
  const appointmentTime = nextAppointment
    ? new Date(nextAppointment.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  // --- Idle / Recording / Recorded phases ---
  return (
    <div className="flex flex-col items-center pt-12 min-h-[60vh] gap-6">
      {/* Header — always visible at top */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('recordDescription')}</p>
      </div>

      {/* Next appointment info */}
      {nextAppointment && (
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Recording for</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">{nextAppointment.customerName}</p>
              <p className="text-xs text-muted-foreground">
                {appointmentTime} &middot; {nextAppointment.durationMinutes}min
              </p>
            </div>
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        </div>
      )}

      {/* Microphone error */}
      {micError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300 max-w-md text-center">
          {t('micError')}
        </div>
      )}

      {/* Fixed-height area for waveform + timer so buttons don't jump */}
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
      </div>

      {/* Action buttons — always in the same vertical position */}
      <div className="flex items-center justify-center gap-4 h-16">
        {phase === 'idle' && (
          <button
            type="button"
            onClick={startRecording}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 transition-colors shadow-lg shadow-red-500/25"
            aria-label={t('start')}
          >
            <MicIcon />
          </button>
        )}

        {phase === 'recording' && (
          <>
            {recState === 'paused' ? (
              <button
                type="button"
                onClick={resumeRecording}
                className="flex items-center justify-center w-12 h-12 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                aria-label={t('resume')}
              >
                <PlayIcon />
              </button>
            ) : (
              <button
                type="button"
                onClick={pauseRecording}
                className="flex items-center justify-center w-12 h-12 rounded-full bg-muted hover:bg-muted/80 transition-colors"
                aria-label={t('paused')}
              >
                <PauseIcon />
              </button>
            )}
            <button
              type="button"
              onClick={stopRecording}
              className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500 hover:bg-red-400 transition-colors shadow-lg shadow-red-500/25"
              aria-label={t('stop')}
            >
              <StopIcon />
            </button>
          </>
        )}

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

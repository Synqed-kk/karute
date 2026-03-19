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

interface RecordingFlowProps {
  customers: CustomerOption[]
  locale: string
}

interface ConfirmData {
  transcript: string
  summary: string
  entries: Entry[]
  duration: number
}

export function RecordingFlow({ customers, locale }: RecordingFlowProps) {
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
            className="text-sm text-white/50 hover:text-white/70 transition-colors"
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
        />
      </div>
    )
  }

  // --- Idle / Recording / Recorded phases ---
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh]">
      <div className="w-full max-w-md rounded-2xl bg-gradient-to-b from-[#1a2332] to-[#0f1923] p-10 flex flex-col items-center gap-8 shadow-2xl">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t('title')}</h1>
        <p className="text-sm text-white/40">{t('recordDescription')}</p>
      </div>

      {/* Microphone error */}
      {micError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 max-w-md text-center">
          {t('micError')}
        </div>
      )}

      {/* Waveform visualization */}
      {phase === 'recording' && (
        <div className="flex items-end justify-center gap-[3px] h-[100px] w-full max-w-xs">
          {bars.map((height, i) => (
            <div
              key={i}
              className="w-[6px] rounded-full bg-[#5cbfcf] transition-[height] duration-75"
              style={{ height: `${height}px` }}
            />
          ))}
        </div>
      )}

      {/* Timer */}
      {phase === 'recording' && <RecordingTimer paused={recState === 'paused'} />}

      {/* Status text */}
      {phase === 'recording' && recState === 'paused' && (
        <p className="text-sm text-white/40">{t('paused')}</p>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-5">
        {phase === 'idle' && (
          <div className="flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={startRecording}
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#5cbfcf] text-white shadow-[0_0_30px_rgba(92,191,207,0.4)] transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(92,191,207,0.6)] active:scale-95"
              aria-label={t('start')}
            >
              <MicIcon />
            </button>
            <span className="text-xs text-white/40">Tap to start recording</span>
          </div>
        )}

        {phase === 'recording' && (
          <>
            {recState === 'paused' ? (
              <button
                type="button"
                onClick={resumeRecording}
                className="flex items-center justify-center w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                aria-label={t('resume')}
              >
                <PlayIcon />
              </button>
            ) : (
              <button
                type="button"
                onClick={pauseRecording}
                className="flex items-center justify-center w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                aria-label={t('paused')}
              >
                <PauseIcon />
              </button>
            )}
            <button
              type="button"
              onClick={stopRecording}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all hover:scale-105 active:scale-95"
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
              className="rounded-full border border-white/20 px-6 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              {t('discard')}
            </button>
            <button
              type="button"
              onClick={handleUseRecording}
              className="rounded-full bg-[#5cbfcf] px-6 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(92,191,207,0.3)] transition hover:bg-[#4db0c0]"
            >
              {t('useRecording')}
            </button>
          </>
        )}
      </div>
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
    <p className="text-5xl font-extralight tracking-[0.3em] font-mono text-white/70 tabular-nums">
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

'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useMediaRecorder } from '@/hooks/use-media-recorder'
import { useRecordingTimer } from '@/hooks/use-recording-timer'
import { useTimetableStore } from '@/stores/timetable-store'
import { runAIPipeline, type PipelineStep, type PipelineResult } from '@/lib/ai-pipeline'
import { saveKaruteRecordInline } from '@/actions/karute'
import { CustomerCombobox, type CustomerOption } from '@/components/karute/CustomerCombobox'
import { QuickCreateCustomer } from '@/components/karute/QuickCreateCustomer'
import type { Entry } from '@/types/ai'
import type { EntryCategory } from '@/lib/karute/categories'

type PanelPhase = 'record' | 'pipeline' | 'review' | 'save' | 'done'

export interface ActiveAppointment {
  id: string
  clientId: string
  customerName: string
  barId: string // the appt_* bar ID on the timeline
}

interface RecordingPanelProps {
  activeStaffId: string
  customers: CustomerOption[]
  locale: string
  onClose: () => void
  /** If recording is started during an active appointment, auto-assign customer */
  activeAppointment?: ActiveAppointment | null
}

const STEP_LABELS: Record<PipelineStep, string> = {
  transcribing: 'Transcribing audio...',
  extracting: 'Extracting entries...',
  summarizing: 'Generating summary...',
  complete: 'Complete',
  error: 'Error',
}

export function RecordingPanel({ activeStaffId, customers: initialCustomers, locale, onClose, activeAppointment }: RecordingPanelProps) {
  const t = useTranslations('recording')
  const tKarute = useTranslations('karute')
  const {
    state: recState,
    result,
    stream,
    error,
    startRecording,
    stopRecording,
    discardRecording,
  } = useMediaRecorder()

  const { formatted: timerFormatted } = useRecordingTimer(recState === 'recording')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vizFrameRef = useRef<number | undefined>(undefined)

  // Dot equalizer — draws dots that react to audio
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width
    const H = canvas.height
    const DOT_COUNT = 24
    const DOT_RADIUS = 3
    const GAP = (W - DOT_COUNT * DOT_RADIUS * 2) / (DOT_COUNT - 1)

    if (!stream || recState !== 'recording') {
      // Draw static dots
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i < DOT_COUNT; i++) {
        const x = i * (DOT_RADIUS * 2 + GAP) + DOT_RADIUS
        ctx.beginPath()
        ctx.arc(x, H / 2, DOT_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(92, 191, 207, 0.35)'
        ctx.fill()
      }
      if (vizFrameRef.current) cancelAnimationFrame(vizFrameRef.current)
      return
    }

    const audioCtx = new AudioContext()
    audioCtxRef.current = audioCtx
    if (audioCtx.state === 'suspended') audioCtx.resume()

    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.3
    analyserRef.current = analyser

    const source = audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)

    const dataArray = new Uint8Array(analyser.fftSize)

    function draw() {
      vizFrameRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(dataArray)

      // Compute RMS audio level
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128
        sum += val * val
      }
      const level = Math.min(1, Math.sqrt(sum / dataArray.length) * 4)

      ctx.clearRect(0, 0, W, H)

      for (let i = 0; i < DOT_COUNT; i++) {
        const x = i * (DOT_RADIUS * 2 + GAP) + DOT_RADIUS
        const center = DOT_COUNT / 2
        const dist = Math.abs(i - center) / center
        const wave = Math.cos(dist * Math.PI * 0.5)
        const jitter = 0.3 + Math.sin(i * 1.7 + Date.now() * 0.005) * 0.2
        const dotLevel = level * wave * jitter
        const yOffset = dotLevel * (H * 0.4)

        // Dot moves up/down from center based on audio
        const y = H / 2 - yOffset
        const radius = DOT_RADIUS + dotLevel * 2
        const alpha = 0.35 + dotLevel * 0.65

        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(92, 191, 207, ${alpha})`
        ctx.fill()
      }
    }

    draw()

    return () => {
      if (vizFrameRef.current) cancelAnimationFrame(vizFrameRef.current)
      audioCtx.close()
    }
  }, [stream, recState])
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const startBar = useTimetableStore((s) => s.startRecordingBar)
  const stopBar = useTimetableStore((s) => s.stopRecordingBar)
  const tickBar = useTimetableStore((s) => s.tickRecordingBar)
  const setBarType = useTimetableStore((s) => s.setBarType)
  const finalizeBar = useTimetableStore((s) => s.finalizeBar)
  const removeBar = useTimetableStore((s) => s.removeBar)

  // Panel phase state
  const [phase, setPhase] = useState<PanelPhase>('record')
  const [barId, setBarId] = useState<string | null>(null)

  // Pipeline state
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>('transcribing')
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null)

  // Save state — auto-assign customer from active appointment
  const [customerList, setCustomerList] = useState<CustomerOption[]>(initialCustomers)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    activeAppointment?.clientId ?? null
  )
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Tick the recording bar every 60s to grow it
  useEffect(() => {
    if (recState === 'recording') {
      tickIntervalRef.current = setInterval(() => tickBar(), 60_000)
    } else {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
    }
    return () => {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current)
    }
  }, [recState, tickBar])

  const handleStart = useCallback(async () => {
    await startRecording()
    if (activeAppointment) {
      // Use the existing appointment bar — don't create a new one
      setBarId(activeAppointment.barId)
      setBarType(activeAppointment.barId, 'recording', 'Recording...')
    } else {
      startBar(activeStaffId)
    }
  }, [startRecording, startBar, activeStaffId, activeAppointment, setBarType])

  const handleStop = useCallback(() => {
    stopRecording()
    if (activeAppointment) {
      // Keep the appointment bar ID, just update its visual
      setBarType(activeAppointment.barId, 'recording', 'Stopped')
    } else {
      const id = stopBar()
      if (id) setBarId(id)
    }
  }, [stopRecording, stopBar, activeAppointment, setBarType])

  const handleDiscard = useCallback(() => {
    if (barId) removeBar(barId)
    discardRecording()
    onClose()
  }, [barId, removeBar, discardRecording, onClose])

  // "Use Recording" → start AI pipeline
  const handleUseRecording = useCallback(async () => {
    if (!result || !barId) return

    // Transition bar to processing
    setBarType(barId, 'processing', 'Processing...')
    setPhase('pipeline')
    setPipelineError(null)
    setPipelineStep('transcribing')

    try {
      const pResult = await runAIPipeline(result.blob, locale, (step) => {
        setPipelineStep(step)
      })
      setPipelineResult(pResult)
      setPhase('review')
    } catch (err) {
      setPipelineStep('error')
      setPipelineError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    }
  }, [result, barId, setBarType, locale])

  // Retry pipeline after error
  const handleRetry = useCallback(() => {
    handleUseRecording()
  }, [handleUseRecording])

  // Move from review to save
  const handleConfirmReview = useCallback((data: { entries: Entry[]; summary: string; transcript: string }) => {
    setPipelineResult((prev) => prev ? { ...prev, ...data } : prev)
    setPhase('save')
  }, [])

  // Save karute — stay on appointments page, finalize the bar
  const handleSaveAndStay = useCallback(async () => {
    if (!pipelineResult || !selectedCustomerId || !barId) return

    setIsSaving(true)
    const saveResult = await saveKaruteRecordInline({
      customerId: selectedCustomerId,
      transcript: pipelineResult.transcript,
      summary: pipelineResult.summary,
      entries: pipelineResult.entries.map((e) => ({
        category: e.category as EntryCategory,
        content: e.title,
        sourceQuote: e.source_quote,
        confidenceScore: e.confidence_score,
      })),
      duration: result ? Math.round(result.durationMs / 1000) : undefined,
    })

    if ('error' in saveResult) {
      toast.error(saveResult.error)
      setIsSaving(false)
      return
    }

    // Success — finalize the timeline bar with the real karute ID
    finalizeBar(barId, saveResult.id)
    setPhase('done')
    setIsSaving(false)
  }, [pipelineResult, selectedCustomerId, barId, result, finalizeBar])

  const handleCustomerCreated = useCallback((newCustomer: CustomerOption) => {
    setCustomerList((prev) => [newCustomer, ...prev])
    setSelectedCustomerId(newCustomer.id)
    setShowQuickCreate(false)
  }, [])

  const canClose = phase === 'record' && (recState === 'idle' || recState === 'recorded')

  return (
    <>
    {/* Grey overlay behind panel */}
    <div className="fixed inset-0 z-40 bg-black/40 animate-in fade-in-0 duration-300" onClick={canClose ? onClose : undefined} />

    <div className="fixed left-[118px] top-[56px] bottom-[12px] z-50 w-[400px] flex flex-col rounded-2xl bg-gradient-to-b from-[#1a2332] to-[#0f1923] shadow-2xl transition-all duration-500 ease-out animate-in slide-in-from-left-8 fade-in-0">
      {/* Close button */}
      {(canClose || phase === 'done') && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-10 text-white/40 hover:text-white/80 transition-colors"
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* ===================== RECORD PHASE ===================== */}
      {phase === 'record' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
              {t('micError')}
            </div>
          )}

          {/* Dot equalizer */}
          <canvas
            ref={canvasRef}
            width={280}
            height={96}
            className="w-64 h-16"
          />

          {/* Timer */}
          <div className="text-5xl font-extralight tracking-[0.3em] tabular-nums font-mono text-white/70">
            {timerFormatted}
          </div>

          {/* Staff name */}
          {activeAppointment ? (
            <div className="text-sm text-white/50">{activeAppointment.customerName}</div>
          ) : (
            <div className="text-sm text-white/50">
              {recState === 'recording' && t('recordingInProgress')}
              {recState === 'recorded' && t('useRecording')}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-5">
            {recState === 'idle' && (
              <div className="flex flex-col items-center gap-4">
                <button
                  type="button"
                  onClick={handleStart}
                  className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#5cbfcf] text-white shadow-[0_0_30px_rgba(92,191,207,0.4)] transition-all hover:scale-105 hover:shadow-[0_0_40px_rgba(92,191,207,0.6)] active:scale-95"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </svg>
                </button>
                <span className="text-xs text-white/40">Tap to start recording</span>
              </div>
            )}

            {recState === 'recording' && (
              <button
                type="button"
                onClick={handleStop}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all hover:scale-105 active:scale-95"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            )}

            {recState === 'recorded' && (
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
      )}

      {/* ===================== PIPELINE PHASE ===================== */}
      {phase === 'pipeline' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
          {!pipelineError ? (
            <>
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-[#5cbfcf]" />
              <div className="text-sm font-medium text-white/70">
                {STEP_LABELS[pipelineStep]}
              </div>
              <div className="flex gap-1.5">
                {(['transcribing', 'extracting', 'complete'] as PipelineStep[]).map((step, i) => {
                  const steps: PipelineStep[] = ['transcribing', 'extracting', 'complete']
                  const currentIdx = steps.indexOf(pipelineStep)
                  const stepIdx = i
                  return (
                    <div
                      key={step}
                      className={`h-1.5 w-8 rounded-full ${
                        stepIdx <= currentIdx ? 'bg-[#5cbfcf]' : 'bg-white/10'
                      }`}
                    />
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-red-400">{pipelineError}</div>
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-full bg-[#84a2aa] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6d8d96]"
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}

      {/* ===================== REVIEW PHASE ===================== */}
      {phase === 'review' && pipelineResult && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <h4 className="mb-1 text-xs font-semibold text-white/40">{tKarute('summary')}</h4>
            <p className="text-sm text-white/70 leading-relaxed">{pipelineResult.summary}</p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <h4 className="mb-1 text-xs font-semibold text-white/40">{tKarute('entries')}</h4>
            <div className="space-y-1.5">
              {pipelineResult.entries.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="shrink-0 rounded bg-[#5cbfcf]/20 px-1.5 py-0.5 text-xs font-medium text-[#5cbfcf]">
                    {entry.category}
                  </span>
                  <span className="text-white/70">{entry.title}</span>
                </div>
              ))}
              {pipelineResult.entries.length === 0 && (
                <p className="text-xs text-white/30">{tKarute('noEntries')}</p>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleDiscard}
              className="flex-1 rounded-lg border border-white/20 py-2 text-sm font-medium text-white/60 transition hover:bg-white/10"
            >
              {t('discard')}
            </button>
            <button
              type="button"
              onClick={() => handleConfirmReview({
                entries: pipelineResult.entries,
                summary: pipelineResult.summary,
                transcript: pipelineResult.transcript,
              })}
              className="flex-1 rounded-lg bg-[#5cbfcf] py-2 text-sm font-semibold text-white transition hover:bg-[#4db0c0]"
            >
              {tKarute('saveKarute')}
            </button>
          </div>
        </div>
      )}

      {/* ===================== SAVE PHASE ===================== */}
      {phase === 'save' && (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          <h3 className="text-sm font-semibold text-white/80">{tKarute('saveKarute')}</h3>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-white/40">
              {tKarute('customer')}
            </label>

            {showQuickCreate ? (
              <QuickCreateCustomer
                onCreated={handleCustomerCreated}
                onCancel={() => setShowQuickCreate(false)}
              />
            ) : (
              <CustomerCombobox
                customers={customerList}
                selectedId={selectedCustomerId}
                onSelect={setSelectedCustomerId}
                onCreateNew={() => setShowQuickCreate(true)}
                disabled={isSaving}
              />
            )}
          </div>

          {!showQuickCreate && (
            <button
              type="button"
              onClick={handleSaveAndStay}
              disabled={isSaving || !selectedCustomerId}
              className="mt-auto rounded-lg bg-[#5cbfcf] py-2.5 text-sm font-semibold text-white transition hover:bg-[#4db0c0] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? tKarute('saving') : tKarute('saveKarute')}
            </button>
          )}
        </div>
      )}

      {/* ===================== DONE PHASE ===================== */}
      {phase === 'done' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#5cbfcf]/20">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#5cbfcf]" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <p className="text-sm font-medium text-white/80">Karute saved</p>
          <p className="text-xs text-white/40">Click the bar on the timeline to view</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-lg bg-[#5cbfcf] px-8 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4db0c0]"
          >
            Done
          </button>
        </div>
      )}
    </div>
    </>
  )
}

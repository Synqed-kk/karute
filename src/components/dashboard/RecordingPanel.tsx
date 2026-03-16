'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useMediaRecorder } from '@/hooks/use-media-recorder'
import { useWaveformBars } from '@/hooks/use-waveform-bars'
import { useRecordingTimer } from '@/hooks/use-recording-timer'
import { useTimetableStore } from '@/stores/timetable-store'
import { runAIPipeline, type PipelineStep, type PipelineResult } from '@/lib/ai-pipeline'
import { saveKaruteRecord } from '@/actions/karute'
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

  const bars = useWaveformBars(stream, recState === 'recording')
  const { formatted: timerFormatted } = useRecordingTimer(recState === 'recording')
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

  // Save karute — stay on dashboard, finalize the bar
  const handleSaveAndStay = useCallback(async () => {
    if (!pipelineResult || !selectedCustomerId || !barId) return

    setIsSaving(true)
    try {
      // Call the save action but we'll handle the redirect error
      const saveResult = await saveKaruteRecord({
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

      if (saveResult && 'error' in saveResult) {
        toast.error(saveResult.error)
        setIsSaving(false)
        return
      }
    } catch (err: unknown) {
      // The save action calls redirect() which throws a special error with digest
      // digest format: "NEXT_REDIRECT;type;destination;statusCode;..."
      const digest = (err as { digest?: string })?.digest
      if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
        const parts = digest.split(';')
        const destination = parts.slice(2, -2).join(';')
        const match = destination.match(/\/karute\/([a-f0-9-]+)/)
        if (match) {
          finalizeBar(barId, match[1])
        } else {
          setBarType(barId, 'booking')
        }
        setPhase('done')
        setIsSaving(false)
        return
      }
      toast.error(err instanceof Error ? err.message : 'Save failed')
      setIsSaving(false)
    }
  }, [pipelineResult, selectedCustomerId, barId, result, finalizeBar, setBarType])

  const handleCustomerCreated = useCallback((newCustomer: CustomerOption) => {
    setCustomerList((prev) => [newCustomer, ...prev])
    setSelectedCustomerId(newCustomer.id)
    setShowQuickCreate(false)
  }, [])

  const canClose = phase === 'record' && (recState === 'idle' || recState === 'recorded')

  return (
    <div className="fixed left-[102px] top-[44px] bottom-[12px] z-50 w-[340px] flex flex-col rounded-2xl border border-white/20 bg-white/90 shadow-2xl backdrop-blur-md dark:bg-[#3a3a3a]/90 transition-all duration-500 ease-out animate-in slide-in-from-left-8 fade-in-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200/60 px-4 py-3 dark:border-gray-700/60">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          {phase === 'record' && t('title')}
          {phase === 'pipeline' && 'Processing'}
          {phase === 'review' && 'Review'}
          {phase === 'save' && tKarute('saveKarute')}
          {phase === 'done' && 'Saved'}
        </h3>
        {(canClose || phase === 'done') && (
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ===================== RECORD PHASE ===================== */}
      {phase === 'record' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {t('micError')}
            </div>
          )}

          {/* Waveform — synqdev/karute style */}
          <div className="flex h-24 items-center justify-center gap-[3px]">
            {bars.map((h, i) => {
              const barHeight = recState === 'recording' ? Math.max(6, h) : 6

              return (
                <div
                  key={i}
                  className={`w-1.5 rounded-full transition-all duration-150 ease-out ${
                    recState === 'recording'
                      ? 'bg-[#84a2aa]'
                      : 'bg-gray-400/30 dark:bg-gray-600/30'
                  }`}
                  style={{ height: `${barHeight}px` }}
                />
              )
            })}
          </div>

          {/* Timer */}
          <div className="text-4xl font-light tracking-widest tabular-nums font-mono text-foreground">
            {timerFormatted}
          </div>

          {/* Status */}
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {recState === 'idle' && t('idle')}
            {recState === 'recording' && t('recordingInProgress')}
            {recState === 'recorded' && t('useRecording')}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4">
            {recState === 'idle' && (
              <button
                type="button"
                onClick={handleStart}
                className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:shadow-xl active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </button>
            )}

            {recState === 'recording' && (
              <button
                type="button"
                onClick={handleStop}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            )}

            {recState === 'recorded' && (
              <>
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="rounded-full border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  {t('discard')}
                </button>
                <button
                  type="button"
                  onClick={handleUseRecording}
                  className="rounded-full bg-[#84a2aa] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6d8d96]"
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
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
          {!pipelineError ? (
            <>
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-300 border-t-[#8b5cf6]" />
              <div className="text-sm font-medium text-gray-600 dark:text-gray-300">
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
                        stepIdx <= currentIdx ? 'bg-[#8b5cf6]' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    />
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm text-red-500">{pipelineError}</div>
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
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className="rounded-lg border border-gray-200/60 bg-gray-50/80 p-3 dark:border-gray-700/60 dark:bg-[#2a2a2a]/80">
            <h4 className="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400">{tKarute('summary')}</h4>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{pipelineResult.summary}</p>
          </div>

          <div className="rounded-lg border border-gray-200/60 bg-gray-50/80 p-3 dark:border-gray-700/60 dark:bg-[#2a2a2a]/80">
            <h4 className="mb-1 text-xs font-semibold text-gray-500 dark:text-gray-400">{tKarute('entries')}</h4>
            <div className="space-y-1.5">
              {pipelineResult.entries.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="shrink-0 rounded bg-[#84a2aa]/20 px-1.5 py-0.5 text-xs font-medium text-[#84a2aa]">
                    {entry.category}
                  </span>
                  <span className="text-gray-700 dark:text-gray-300">{entry.title}</span>
                </div>
              ))}
              {pipelineResult.entries.length === 0 && (
                <p className="text-xs text-gray-400">{tKarute('noEntries')}</p>
              )}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleDiscard}
              className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
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
              className="flex-1 rounded-lg bg-[#84a2aa] py-2 text-sm font-semibold text-white transition hover:bg-[#6d8d96]"
            >
              {tKarute('saveKarute')}
            </button>
          </div>
        </div>
      )}

      {/* ===================== SAVE PHASE ===================== */}
      {phase === 'save' && (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
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
              className="mt-auto rounded-lg bg-[#84a2aa] py-2.5 text-sm font-semibold text-white transition hover:bg-[#6d8d96] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? tKarute('saving') : tKarute('saveKarute')}
            </button>
          )}
        </div>
      )}

      {/* ===================== DONE PHASE ===================== */}
      {phase === 'done' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600 dark:text-green-400" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Karute saved</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Click the bar on the timeline to view</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-lg bg-[#84a2aa] px-6 py-2 text-sm font-semibold text-white transition hover:bg-[#6d8d96]"
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}

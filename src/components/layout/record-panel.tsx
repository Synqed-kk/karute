'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useLocale } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Pause, Play, Square, X } from 'lucide-react'
import { useTimetableStore } from '@/stores/timetable-store'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { useRecordPanel } from '@/components/providers/record-panel-provider'
import { useOrg } from '@/components/providers/org-provider'

const KARUTE_PATH =
  'M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 5.9l1.8 1.8a1 1 0 0 1-1.4 1.4l-1.8-1.8A7 7 0 0 1 5 9a7 7 0 0 1 7-7Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-3.5 4.3 7-2.8a.8.8 0 0 1 .6 1.5l-7 2.8a.8.8 0 1 1-.6-1.5ZM6.5 19.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z'

function Equalizer({ level }: { level: number }) {
  const bars = Array.from({ length: 24 }, (_, i) => {
    const center = 12
    const dist = Math.abs(i - center) / center
    const wave = Math.cos(dist * Math.PI * 0.5)
    const jitter = 0.4 + Math.sin(i * 1.7) * 0.2 + Math.cos(i * 2.3) * 0.15
    const h = level > 0.01 ? Math.max(0.06, level * wave * jitter) : 0.06
    return Math.min(1, h)
  })

  return (
    <div className="flex h-14 items-center justify-center gap-[2px]">
      {bars.map((h, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full bg-gradient-to-t from-teal-400 to-cyan-300 dark:from-teal-500 dark:to-cyan-400"
          animate={{ height: Math.max(3, h * 56) }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

function PulseRings({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border-2 border-teal-400/40 dark:border-teal-500/30"
          initial={{ width: 72, height: 72, opacity: 0.6 }}
          animate={{ width: 140, height: 140, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }}
        />
      ))}
    </>
  )
}

function RecordingUI() {
  const t = useTranslations('recording')
  const locale = useLocale()
  const { staff, org } = useOrg()
  const { startRecordingBar, stopRecordingBar, recordingBarId } = useTimetableStore()
  const didStopRef = useRef(false)
  const [processing, setProcessing] = useState(false)
  const [processingLabel, setProcessingLabel] = useState('')
  const lastBarIdRef = useRef<string | null>(null)

  const {
    status,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    audioBlob,
    elapsedSeconds,
    audioLevel,
  } = useAudioRecorder()

  // Track the bar ID before stop clears it
  useEffect(() => {
    if (recordingBarId) lastBarIdRef.current = recordingBarId
  }, [recordingBarId])

  const handleStart = useCallback(() => {
    didStopRef.current = false
    setProcessing(false)
    startRecording()
    startRecordingBar(staff.id, org.id)
  }, [startRecording, startRecordingBar, staff.id, org.id])

  const handleStop = useCallback(() => {
    stopRecording()
    stopRecordingBar()
    didStopRef.current = true
  }, [stopRecording, stopRecordingBar])

  // Update recording bar duration while recording
  useEffect(() => {
    if (status !== 'recording' || !recordingBarId) return
    const interval = setInterval(() => {
      const store = useTimetableStore.getState()
      if (store.recordingStartMinute === null) return
      const now = new Date()
      const currentMinute = now.getHours() * 60 + now.getMinutes()
      const duration = Math.max(1, currentMinute - store.recordingStartMinute)
      store.setBars(
        store.bars.map((b) =>
          b.id === recordingBarId ? { ...b, durationMinute: duration } : b
        )
      )
    }, 10000)
    return () => clearInterval(interval)
  }, [status, recordingBarId])

  // Process audio after recording stops
  useEffect(() => {
    if (!audioBlob || status !== 'stopped' || !didStopRef.current) return
    didStopRef.current = false

    const barId = lastBarIdRef.current
    if (!barId) return

    async function processAudio(blob: Blob, recordingId: string) {
      setProcessing(true)
      const store = useTimetableStore.getState()

      // Set bar to processing state
      store.setBars(
        store.bars.map((b) =>
          b.id === recordingId ? { ...b, type: 'processing' as const, subtitle: 'Transcribing...' } : b
        )
      )

      try {
        // 1. Transcribe
        setProcessingLabel('Transcribing...')
        const formData = new FormData()
        formData.append('audio', new File([blob], 'recording.webm', { type: blob.type }))
        formData.append('locale', locale)
        const transcribeRes = await fetch('/api/transcriptions', { method: 'POST', body: formData })

        if (!transcribeRes.ok) {
          console.error('Transcription failed')
          const s = useTimetableStore.getState()
          s.setBars(s.bars.map((b) =>
            b.id === recordingId ? { ...b, type: 'booking' as const, subtitle: 'Failed' } : b
          ))
          setProcessing(false)
          return
        }

        const transcription = await transcribeRes.json()

        // Update bar label
        useTimetableStore.getState().setBars(
          useTimetableStore.getState().bars.map((b) =>
            b.id === recordingId ? { ...b, subtitle: 'Classifying...' } : b
          )
        )

        // 2. Classify
        setProcessingLabel('Classifying...')
        const classifyRes = await fetch('/api/classifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: transcription.text, locale }),
        })

        let classification = { summary: '', entries: [] }
        if (classifyRes.ok) {
          classification = await classifyRes.json()
        }

        // 3. Store results in sessionStorage keyed by recording ID
        const karuteData = {
          segments: transcription.segments || [],
          entries: classification.entries || [],
          aiSummary: classification.summary || '',
          staffName: staff.name,
          date: new Date().toISOString().slice(0, 10),
        }
        sessionStorage.setItem(`karute_${recordingId}`, JSON.stringify(karuteData))

        // Update bar to completed booking
        const finalStore = useTimetableStore.getState()
        finalStore.setBars(
          finalStore.bars.map((b) =>
            b.id === recordingId ? { ...b, type: 'booking' as const, subtitle: 'Ready' } : b
          )
        )
      } catch (err) {
        console.error('Processing failed:', err)
        const s = useTimetableStore.getState()
        s.setBars(s.bars.map((b) =>
          b.id === recordingId ? { ...b, type: 'booking' as const, subtitle: 'Error' } : b
        ))
      } finally {
        setProcessing(false)
        setProcessingLabel('')
      }
    }

    processAudio(audioBlob, barId)
  }, [audioBlob, status, staff.name])

  const isRecording = status === 'recording'
  const isPaused = status === 'paused'
  const isActive = isRecording || isPaused
  const minutes = Math.floor(elapsedSeconds / 60)
  const secs = elapsedSeconds % 60
  const timer = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

  return (
    <div className="flex flex-col items-center gap-6">
      <Equalizer level={audioLevel} />

      <motion.div
        className="select-none"
        initial={{ opacity: 0.4 }}
        animate={{ opacity: isActive ? 1 : 0.4 }}
      >
        <span className="font-mono text-4xl font-extralight tracking-[0.15em] text-gray-800 tabular-nums dark:text-white/90">
          {timer}
        </span>
      </motion.div>

      <p className="text-xs text-gray-500 dark:text-white/50">
        {staff.name}
      </p>

      <div className="flex items-center gap-5">
        {!isActive ? (
          <motion.button
            onClick={handleStart}
            className="flex size-18 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-cyan-500 text-white shadow-lg shadow-teal-400/30 dark:shadow-teal-500/20"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.95 }}
            aria-label={t('startLabel')}
          >
            <Mic className="size-7" />
          </motion.button>
        ) : (
          <>
            <div className="relative flex items-center justify-center">
              <PulseRings active={isRecording} />
              <motion.button
                onClick={isPaused ? resumeRecording : pauseRecording}
                className="relative z-10 flex size-12 items-center justify-center rounded-full border-2 border-teal-400/50 bg-white/80 text-gray-700 shadow-md backdrop-blur-sm dark:border-teal-500/40 dark:bg-white/10 dark:text-white"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.95 }}
                aria-label={isPaused ? t('resume') : t('pause')}
              >
                {isPaused ? <Play className="size-5" /> : <Pause className="size-5" />}
              </motion.button>
            </div>
            <motion.button
              onClick={handleStop}
              className="flex size-12 items-center justify-center rounded-full bg-red-500 text-white shadow-md shadow-red-500/30"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
              aria-label={t('stop')}
            >
              <Square className="size-5" />
            </motion.button>
          </>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-white/40">
        {processing ? processingLabel : isActive ? (isRecording ? 'Recording...' : 'Paused') : 'Tap to start recording'}
      </p>
    </div>
  )
}

export function RecordPanelBackdrop() {
  const { open, setOpen } = useRecordPanel()
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-40 rounded-[28px] bg-black/20 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => setOpen(false)}
        />
      )}
    </AnimatePresence>
  )
}

export function RecordPanel() {
  const { open, setOpen } = useRecordPanel()
  const [introDone, setIntroDone] = useState(false)

  return (
    <AnimatePresence onExitComplete={() => setIntroDone(false)}>
      {open && (
        <motion.div
          className="absolute inset-y-0 left-full z-50 ml-2 flex w-[360px] items-center justify-center overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-50 via-gray-100 to-slate-200 shadow-2xl dark:from-[#1a1a2e] dark:via-[#16213e] dark:to-[#0f3460]"
          initial={{ x: -40, opacity: 0, scale: 0.95 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ x: -40, opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        >
          {/* Ambient glow */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-1/2 h-[250px] w-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-400/10 blur-[60px] dark:bg-teal-500/10" />
          </div>

          {/* Close button */}
          <button
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 z-20 rounded-full p-1.5 text-gray-400 transition hover:bg-black/5 hover:text-gray-600 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Morph & Pulse intro */}
          {!introDone && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="absolute rounded-full border-2 border-teal-400/40"
                  initial={{ width: 40, height: 40, opacity: 0.6 }}
                  animate={{ width: 300, height: 300, opacity: 0 }}
                  transition={{ duration: 1, delay: i * 0.15, ease: 'easeOut' }}
                />
              ))}
              <motion.div
                initial={{ opacity: 1, scale: 1, rotate: 0 }}
                animate={{ opacity: 0, scale: 0, rotate: 180 }}
                transition={{ delay: 0.25, duration: 0.4, ease: [0.76, 0, 0.24, 1] }}
                onAnimationComplete={() => setIntroDone(true)}
              >
                <svg className="h-12 w-12 text-teal-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d={KARUTE_PATH} />
                </svg>
              </motion.div>
            </div>
          )}

          {/* Recording UI */}
          <motion.div
            className="relative z-10 w-full px-6"
            initial={{ opacity: 0, scale: 0.3 }}
            animate={introDone ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.45, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <RecordingUI />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

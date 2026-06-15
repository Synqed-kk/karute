'use client'
import { useState, useRef, useCallback } from 'react'
import { recordingAudioConstraints } from '@/lib/recording-constraints'

// Full state machine: idle → recording → paused ↔ recording → recorded
export type RecordingState = 'idle' | 'recording' | 'paused' | 'recorded'

export interface RecordingResult {
  blob: Blob
  mimeType: string
  durationMs: number
}

/**
 * Negotiate the best supported audio format at runtime.
 * Priority: webm/opus (best compression) → webm → mp4 (iOS Safari) → ogg → wav (fallback)
 * NEVER hardcode a format — iOS Safari < 18.4 does not support audio/webm.
 */
function getSupportedMimeType(): string {
  const formats = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ]
  return formats.find(f => MediaRecorder.isTypeSupported(f)) ?? ''
}

export function useMediaRecorder() {
  const [state, setState] = useState<RecordingState>('idle')
  const [result, setResult] = useState<RecordingResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const pausedDurationRef = useRef<number>(0) // Accumulates time paused
  const pauseStartRef = useRef<number>(0)     // When current pause began

  const startRecording = useCallback(async () => {
    setError(null)
    setResult(null)
    chunksRef.current = []
    pausedDurationRef.current = 0

    let micStream: MediaStream
    try {
      // Dashboard quick-record widgets: apply the standard voice-capture
      // constraints (noise suppression on by default).
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: recordingAudioConstraints(true),
        video: false,
      })
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.')
      return
    }

    setStream(micStream)

    const mimeType = getSupportedMimeType()
    // Voice-optimized bitrate — see global-recorder.ts. ~2.7x smaller than the
    // browser default (~128 kbps) so long (60-90 min) sessions don't exceed the
    // Supabase Storage upload limit. 48 kbps keeps a 3x margin over the ~16 kbps
    // Opus/ASR threshold — negligible accuracy impact even on noisy audio.
    const recorder = new MediaRecorder(micStream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 48_000,
    })

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const totalElapsed = Date.now() - startTimeRef.current
      const durationMs = totalElapsed - pausedDurationRef.current
      const blob = new Blob(chunksRef.current, {
        type: mimeType || recorder.mimeType,
      })
      setResult({ blob, mimeType: mimeType || recorder.mimeType, durationMs })
      setState('recorded')

      // Stop all mic tracks to release the microphone indicator
      micStream.getTracks().forEach(track => track.stop())
      setStream(null)
    }

    mediaRecorderRef.current = recorder
    startTimeRef.current = Date.now()
    recorder.start(100) // Collect chunks every 100ms for smooth waveform data
    setState('recording')
  }, [])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      // Resume before stopping if paused — MediaRecorder.stop() requires active state
      if (mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume()
      }
      mediaRecorderRef.current.stop()
    }
  }, [])

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause()
      pauseStartRef.current = Date.now()
      setState('paused')
    }
  }, [])

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume()
      // Accumulate time spent paused so durationMs excludes it
      pausedDurationRef.current += Date.now() - pauseStartRef.current
      setState('recording')
    }
  }, [])

  const discardRecording = useCallback(() => {
    setResult(null)
    setError(null)
    chunksRef.current = []
    pausedDurationRef.current = 0
    // Ensure stream tracks are stopped if somehow still active
    stream?.getTracks().forEach(track => track.stop())
    setStream(null)
    setState('idle')
  }, [stream])

  return {
    state,
    result,
    error,
    stream,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    discardRecording,
  }
}

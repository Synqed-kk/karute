'use client'
import { useState, useRef, useCallback } from 'react'

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
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.')
      return
    }

    setStream(micStream)

    const mimeType = getSupportedMimeType()
    // Pin the bitrate explicitly at 128 kbps — see global-recorder.ts. Keeps
    // file size predictable (~0.96 MB/min); long-session uploads are handled by
    // the raised 200 MB bucket cap, not by degrading audio quality.
    const recorder = new MediaRecorder(micStream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 128_000,
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

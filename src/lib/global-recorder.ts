'use client'

import type { RecordingResult } from '@/hooks/use-media-recorder'

/**
 * Global MediaRecorder singleton.
 * Survives React component unmounts/remounts so recording
 * continues when navigating between pages.
 */

type Listener = () => void

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const formats = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ]
  return formats.find(f => MediaRecorder.isTypeSupported(f)) ?? ''
}

class GlobalRecorder {
  state: 'idle' | 'recording' | 'paused' | 'recorded' = 'idle'
  result: RecordingResult | null = null
  error: string | null = null
  stream: MediaStream | null = null
  startedAt: number | null = null

  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startTime = 0
  private pausedDuration = 0
  private pauseStart = 0
  private listeners = new Set<Listener>()
  version = 0

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private notify() {
    this.version++
    this.listeners.forEach(fn => fn())
  }

  async start() {
    this.error = null
    this.result = null
    this.chunks = []
    this.pausedDuration = 0

    let micStream: MediaStream
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      this.error = 'Microphone access denied.'
      this.notify()
      return
    }

    this.stream = micStream
    const mimeType = getSupportedMimeType()
    // Voice-optimized bitrate. The browser default (~128 kbps) makes a 60-90 min
    // session ~80-90 MB, which blows past Supabase Storage's per-bucket limit
    // (50 MB on Free) — the upload fails with "object exceeded the maximum allowed
    // size". 48 kbps opus is ~2.7x smaller (~32 MB for 90 min) and keeps a
    // comfortable accuracy margin: ASR shows no significant Opus degradation at
    // ≥16 kbps, so 48 leaves 3x headroom for noisy-salon / phone-mic / 2-speaker
    // audio. Deepgram accuracy tracks sample rate, not bitrate. (Pair with a
    // raised bucket file_size_limit + resumable uploads for 2-hr sessions.)
    const recorder = new MediaRecorder(micStream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 48_000,
    })

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }

    recorder.onstop = () => {
      const totalElapsed = Date.now() - this.startTime
      const durationMs = totalElapsed - this.pausedDuration
      const blob = new Blob(this.chunks, { type: mimeType || recorder.mimeType })
      this.result = { blob, mimeType: mimeType || recorder.mimeType, durationMs }
      this.state = 'recorded'
      this.startedAt = null
      micStream.getTracks().forEach(t => t.stop())
      this.stream = null
      this.notify()
    }

    this.recorder = recorder
    this.startTime = Date.now()
    this.startedAt = Date.now()
    recorder.start(100)
    this.state = 'recording'
    this.notify()
  }

  stop() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      if (this.recorder.state === 'paused') this.recorder.resume()
      this.recorder.stop()
    }
  }

  pause() {
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.pause()
      this.pauseStart = Date.now()
      this.state = 'paused'
      this.notify()
    }
  }

  resume() {
    if (this.recorder && this.recorder.state === 'paused') {
      this.recorder.resume()
      this.pausedDuration += Date.now() - this.pauseStart
      this.state = 'recording'
      this.notify()
    }
  }

  discard() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      // Stop without triggering onstop result
      this.recorder.ondataavailable = null
      this.recorder.onstop = null
      try { this.recorder.stop() } catch {}
    }
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.result = null
    this.error = null
    this.chunks = []
    this.pausedDuration = 0
    this.state = 'idle'
    this.startedAt = null
    this.recorder = null
    this.notify()
  }
}

// Module-level singleton
export const globalRecorder = new GlobalRecorder()

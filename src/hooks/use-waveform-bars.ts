'use client'
import { useEffect, useRef, useState, useMemo } from 'react'

const BAR_COUNT = 30

/**
 * useWaveformBars — returns number[30] bar heights (6–96px range).
 *
 * Matches synqdev/karute reference implementation:
 * 1. Compute a single audioLevel (0-1) from the mic stream via RMS
 * 2. Generate bar heights using cosine wave + jitter pattern
 *
 * @param stream  Live MediaStream from getUserMedia. null = bars go flat.
 * @param active  When false, bars return to flat immediately.
 */
export function useWaveformBars(
  stream: MediaStream | null,
  active: boolean
): number[] {
  const [audioLevel, setAudioLevel] = useState(0)
  const animFrameRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!stream || !active) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      setAudioLevel(0)
      return
    }

    const audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume()

    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.15

    const source = audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)

    const dataArray = new Uint8Array(analyser.fftSize)

    function update() {
      animFrameRef.current = requestAnimationFrame(update)
      analyser.getByteTimeDomainData(dataArray)

      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        const val = (dataArray[i] - 128) / 128
        sum += val * val
      }
      const rms = Math.sqrt(sum / dataArray.length)
      const normalized = Math.min(1, rms * 5)
      setAudioLevel(normalized)
    }

    update()

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      audioCtx.close()
    }
  }, [stream, active])

  // Generate bar heights from audioLevel — matches reference exactly
  const bars = useMemo(() => {
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      const center = BAR_COUNT / 2
      const distFromCenter = Math.abs(i - center) / center
      const wave = Math.cos(distFromCenter * Math.PI * 0.5)
      const jitter = 0.3 + Math.sin(i * 1.7) * 0.2 + Math.cos(i * 2.3) * 0.15
      const height = audioLevel > 0.01
        ? Math.max(0.08, audioLevel * wave * jitter)
        : 0.08
      return Math.max(6, Math.min(96, height * 96))
    })
  }, [audioLevel])

  return bars
}

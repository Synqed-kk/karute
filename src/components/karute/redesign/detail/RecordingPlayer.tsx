'use client'

// The play button (build 23 slice ①) — hearing a session again, inside the
// 文字起こし card the words already live in.
//
// THE URL IS MINTED ON THE FIRST TAP, never on mount. The mint files one
// `recording.play` audit row, and a row per CARD OPEN would say something the
// row does not mean. So the element is created with no src and stays silent
// until someone actually asks to listen.
//
// RECORDING ALWAYS WINS (D-6). There is exactly one microphone and one audio
// context on this device: a play tap while the recorder is live is REFUSED with
// one quiet line, and a recorder that STARTS while this is playing pauses it.
// Playback never reaches the mic path.
//
// NO DOWNLOAD, and nothing anywhere on this row says who may hear the take
// (⚖ 9/3). The two lines it can show are about THIS attempt — "not while you
// are recording", "that did not play" — never about permission.
//
// ponytail: the scrub is a native <input type="range">. The element IS the
// direct manipulation — no pointer capture, no spring, no velocity carry; the
// mock's spring was demo choreography and the real thing seeks real audio.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'

import { getRecordingPipelinePort } from '@/lib/ports/recording-port'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { cn } from '@/lib/utils'

/** ⚖ Liam 9/3: "X2 or X3". */
const SPEEDS = [1, 1.5, 2, 3] as const
const SKIP_S = 15
/** How long an inline notice stays before the row goes quiet again. */
const NOTICE_MS = 3000

/** m:ss, and h:mm:ss once a take passes the hour. Tabular everywhere it shows. */
function clock(seconds: number): string {
  const t = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

interface RecordingPlayerProps {
  karuteId: string
  /** The row's own length. Null on a take finalized before it landed — the
   *  element's own metadata then fills the total in. */
  durationSeconds: number | null
}

export function RecordingPlayer({ karuteId, durationSeconds }: RecordingPlayerProps) {
  const t = useTranslations('karuteDetail')
  const audioRef = useRef<HTMLAudioElement>(null)
  /** The minted url, and whether this player has already spent its ONE re-mint
   *  on it (D-3: a listen longer than the TTL resumes once, honestly logged as
   *  a second listen — it never loops). */
  const url = useRef<string | null>(null)
  const remintUsed = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [total, setTotal] = useState(durationSeconds ?? 0)
  const [speedIndex, setSpeedIndex] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  const recorder = useGlobalRecorder()
  const recorderLive = recorder.state === 'recording' || recorder.state === 'paused'

  const say = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  // RECORDING WINS: a recorder that starts while this is playing pauses it.
  // Not a refusal — the staffer is mid-session and the sound must stop itself.
  useEffect(() => {
    if (recorder.state !== 'recording') return
    const audio = audioRef.current
    if (audio && !audio.paused) {
      audio.pause()
      setPlaying(false)
    }
  }, [recorder.state])

  // Release on unmount: an element left with a src holds a decoded buffer (and
  // a live connection) for a card nobody is looking at any more.
  useEffect(() => {
    const audio = audioRef.current
    return () => {
      if (!audio) return
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }, [])

  const mint = useCallback(async (): Promise<string | null> => {
    if (url.current) return url.current
    setBusy(true)
    try {
      const result = await getRecordingPipelinePort().mintPlaybackUrl(karuteId)
      if ('error' in result) {
        say(t('transcript.playbackUnavailable'))
        return null
      }
      url.current = result.url
      if (result.durationSeconds !== null) setTotal(result.durationSeconds)
      return result.url
    } finally {
      setBusy(false)
    }
  }, [karuteId, say, t])

  const toggle = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    if (recorderLive) {
      say(t('transcript.playBlockedWhileRecording'))
      return
    }
    if (!audio.paused) {
      audio.pause()
      setPlaying(false)
      return
    }
    const src = await mint()
    if (!src) return
    if (audio.src !== src) {
      audio.src = src
      audio.playbackRate = SPEEDS[speedIndex]
    }
    try {
      await audio.play()
      setPlaying(true)
    } catch {
      // D-11, Karute web in mobile Safari: the async mint can outlive the tap's
      // gesture (NotAllowedError). The url is in hand now, so the SECOND tap
      // plays — the button stays on 再生 rather than lying about its state.
      setPlaying(false)
    }
  }, [mint, recorderLive, say, speedIndex, t])

  const seekBy = useCallback(
    (delta: number) => {
      const audio = audioRef.current
      if (!audio) return
      const max = total || audio.duration || 0
      const next = Math.min(Math.max(audio.currentTime + delta, 0), max)
      audio.currentTime = next
      setElapsed(next)
    },
    [total],
  )

  const cycleSpeed = useCallback(() => {
    const next = (speedIndex + 1) % SPEEDS.length
    setSpeedIndex(next)
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next]
  }, [speedIndex])

  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0
  const press = 'transition-transform duration-(--duration-press) ease-(--ease-out) motion-safe:active:scale-[0.97]'

  return (
    <div className="border-t border-border px-4 pb-4 pt-3.5">
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (durationSeconds === null && Number.isFinite(e.currentTarget.duration)) {
            setTotal(e.currentTarget.duration)
          }
        }}
        onEnded={() => setPlaying(false)}
        onError={() => {
          // The signed url expired under a long listen (D-3). Re-mint ONCE and
          // resume where the ear was; a second failure just says so.
          const audio = audioRef.current
          if (!audio || !url.current || remintUsed.current) {
            say(t('transcript.playbackUnavailable'))
            return
          }
          remintUsed.current = true
          const at = elapsed
          url.current = null
          void (async () => {
            const src = await mint()
            if (!src) return
            audio.src = src
            audio.currentTime = at
            audio.playbackRate = SPEEDS[speedIndex]
            try {
              await audio.play()
              setPlaying(true)
            } catch {
              setPlaying(false)
            }
          })()
        }}
      />

      <div className="flex items-center gap-[9px]">
        <button
          type="button"
          onClick={() => void toggle()}
          aria-label={playing ? t('transcript.pause') : t('transcript.play')}
          className={cn(
            'inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
            busy && 'opacity-60',
            press,
          )}
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button
          type="button"
          onClick={() => seekBy(-SKIP_S)}
          aria-label={t('transcript.back15')}
          className={cn(
            'inline-flex h-[34px] min-w-11 items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-2 text-[11px] font-semibold tabular-nums text-muted-foreground hover:bg-muted',
            press,
          )}
        >
          <RotateCcw size={13} />
          <span>{SKIP_S}</span>
        </button>
        <button
          type="button"
          onClick={() => seekBy(SKIP_S)}
          aria-label={t('transcript.fwd15')}
          className={cn(
            'inline-flex h-[34px] min-w-11 items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-2 text-[11px] font-semibold tabular-nums text-muted-foreground hover:bg-muted',
            press,
          )}
        >
          <RotateCw size={13} />
          <span>{SKIP_S}</span>
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={cycleSpeed}
          aria-label={t('transcript.speed')}
          className={cn(
            'inline-flex h-[34px] min-w-[50px] items-center justify-center rounded-full border border-primary/30 bg-primary/8 px-2.5 text-[12.5px] font-bold tabular-nums text-primary',
            press,
          )}
        >
          {t('transcript.speedChip', { rate: SPEEDS[speedIndex] })}
        </button>
      </div>

      <div className="px-0 pb-1 pt-2.5">
        <input
          type="range"
          min={0}
          max={total || 0}
          step={0.1}
          value={Math.min(elapsed, total || 0)}
          disabled={total <= 0}
          onChange={(e) => {
            const next = Number(e.target.value)
            if (audioRef.current) audioRef.current.currentTime = next
            setElapsed(next)
          }}
          aria-label={t('transcript.title')}
          className={cn(
            'h-[5px] w-full cursor-pointer appearance-none rounded-full disabled:cursor-default',
            '[&::-webkit-slider-thumb]:size-[15px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[1.5px] [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow-sm',
            '[&::-moz-range-thumb]:size-[15px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[1.5px] [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-card',
          )}
          // The fill is the value made visible — a gradient stop at the played
          // fraction, so there is no second element to keep in sync with it.
          style={{
            background: `linear-gradient(to right, var(--primary) ${pct}%, var(--border) ${pct}%)`,
          }}
        />
      </div>

      <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span className="font-semibold text-foreground/70">{clock(elapsed)}</span>
        <span>{clock(total)}</span>
      </div>

      {notice && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{notice}</p>
      )}
    </div>
  )
}

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
import { recorderIsLive, useGlobalRecorder } from '@/hooks/use-global-recorder'
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
  /** The mint in flight, so a second tap joins it instead of starting another
   *  (F5). Cleared in the same `finally` that clears `busy`. */
  const pending = useRef<Promise<string | null> | null>(null)

  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [total, setTotal] = useState(durationSeconds ?? 0)
  const [speedIndex, setSpeedIndex] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  // The hook is here to RE-RENDER on recorder changes; it is never the value a
  // guard is decided on (fix round 2, F3). A snapshot read at the top of an
  // async handler is stale by the time the mint resolves, and that window is
  // exactly long enough to start a recording in.
  const recorder = useGlobalRecorder()

  const say = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  // RECORDING WINS: a recorder that starts while this is playing pauses it.
  // Not a refusal — the staffer is mid-session and the sound must stop itself.
  // (`playing` follows from the element's own pause event — F6.)
  useEffect(() => {
    if (recorder.state !== 'recording') return
    const audio = audioRef.current
    if (audio && !audio.paused) audio.pause()
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
    // ONE TAP, ONE MINT (fix round 2, F5). `url.current` is only set AFTER the
    // round trip, so two taps inside it used to run two full mints — two signed
    // urls and two `recording.play` rows for one listen. Tapping again while
    // nothing has visibly happened is the normal impatient gesture on a phone,
    // so this is the common case, not the corner. The second tap awaits the
    // SAME promise.
    if (pending.current) return pending.current
    setBusy(true)
    const run = (async () => {
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
        pending.current = null
        setBusy(false)
      }
    })()
    pending.current = run
    return run
  }, [karuteId, say, t])

  /** Point the element at `src` and start it. `playing` is NOT set here — the
   *  element's own `play`/`pause` events are the truth (F6). */
  const start = useCallback(
    (audio: HTMLAudioElement, src: string) => {
      // ⚖ THE LAST-MOMENT GUARD (F3). Asked here, immediately before play(), so
      // it covers the caller that awaited a mint AND the re-mint path — the two
      // windows in which a recording can start after the first check passed.
      if (recorderIsLive()) {
        say(t('transcript.playBlockedWhileRecording'))
        return
      }
      if (audio.src !== src) {
        audio.src = src
        audio.playbackRate = SPEEDS[speedIndex]
      }
      // D-11, Karute web in mobile Safari: the async mint can outlive the tap's
      // gesture (NotAllowedError). The url is in hand by then, so the SECOND
      // tap plays — the button stays on 再生 rather than lying about its state.
      // No notice: the staffer's own next tap is the recovery.
      void audio.play().catch(() => {})
    },
    [say, speedIndex, t],
  )

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (recorderIsLive()) {
      say(t('transcript.playBlockedWhileRecording'))
      return
    }
    if (!audio.paused) {
      audio.pause()
      return
    }
    // ⚖ THE SECOND TAP IS SYNCHRONOUS (F4). With a url already in hand there is
    // NO await before play(), so the call stays inside the tap's user-gesture
    // token. Karute web in mobile Safari is the door that needs this: whether
    // WebKit forwards a gesture across a microtask is version-dependent, and a
    // shipped play button must not depend on it. The async path is taken only
    // for the FIRST mint.
    if (url.current) {
      start(audio, url.current)
      return
    }
    void mint().then((src) => {
      if (src) start(audio, src)
    })
  }, [mint, say, start, t])

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
        // ⚖ THE ELEMENT IS THE TRUTH (F6). On a phone the system pauses media
        // constantly — an incoming call, another app taking the audio session,
        // Control Center, the lock screen, a headphone button. Driving `playing`
        // from our own toggle left the button reading 一時停止 while nothing
        // played, and the first tap then only paused an already-paused element.
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
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
          void mint().then((src) => {
            if (!src) return
            // Through `start`, so the re-mint inherits the last-moment recorder
            // guard it used to have none of (F3).
            start(audio, src)
            audio.currentTime = at
          })
        }}
      />

      <div className="flex items-center gap-[9px]">
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
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
          aria-label={t('transcript.seek')}
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

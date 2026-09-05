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

/** What the total reads before anything is known (F10). A job-owned row can
 *  carry a null duration, and `preload="none"` means no metadata loads until
 *  the first play — so the slot used to state 0:00 for a recording that is
 *  certainly not zero seconds long. ⚖ numbers say what they count: an unknown
 *  length says it is unknown. */
const UNKNOWN_CLOCK = '–:––'

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
  const noticeTimer = useRef<number | null>(null)
  /** A finger (or an arrow key) is on the scrub right now — so the element's own
   *  `timeupdate` must not move the thumb out from under it (fix round 3). */
  const scrubbing = useRef(false)

  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [total, setTotal] = useState(durationSeconds ?? 0)
  const [speedIndex, setSpeedIndex] = useState(0)
  /** What the ELEMENT is actually running (F7). WebKit may clamp above ~2×, so
   *  the chip renders what came back, never what we asked for — a UI that
   *  states a rate the engine refused is stating a fact that is not true. Null
   *  until an element exists to ask; the requested value stands in. */
  const [effectiveRate, setEffectiveRate] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // The hook is here to RE-RENDER on recorder changes; it is never the value a
  // guard is decided on (fix round 2, F3). A snapshot read at the top of an
  // async handler is stale by the time the mint resolves, and that window is
  // exactly long enough to start a recording in.
  const recorder = useGlobalRecorder()

  const say = useCallback((message: string) => {
    setNotice(message)
    // Cleared on the next notice AND on unmount (F10) — otherwise a card
    // navigated away from within 3 s of a refusal sets state on a dead tree,
    // and two notices in a row would let the first one's timer blank the second.
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS)
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
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
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
        setEffectiveRate(audio.playbackRate)
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
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = SPEEDS[next]
    // READ IT BACK (F7). A clamping engine then simply self-describes.
    setEffectiveRate(audio.playbackRate)
  }, [speedIndex])

  /** Commit the scrub's position to the element. Called on RELEASE only —
   *  pointer up, touch end, key up — never per pixel of the drag: against a
   *  signed remote url every write is a seek and every seek is a byte-range
   *  request, which on LTE with a 90-minute take is a stutter, not a scrub.
   *
   *  ⚠ IT READS THE RANGE, NOT `elapsed` (fix round 3). A PLAYING element fires
   *  `timeupdate` ~4×/s, and each one used to overwrite `elapsed` — so if the
   *  last event before the finger lifted was a tick rather than a change (the
   *  common case: the finger stops before it rises), the release seeked to the
   *  PLAYHEAD and the staffer's scrub vanished silently. The input's own value
   *  is the one thing a tick cannot move. */
  const commitSeek = useCallback((e: React.SyntheticEvent<HTMLInputElement>) => {
    // ONE RELEASE, ONE SEEK. iOS fires `pointerup` AND `touchend` for a single
    // finger lift, so this ran twice — two byte-range requests against the
    // signed url, which is the exact thing commit-on-release exists to avoid.
    // The same ref that owns the drag makes the commit idempotent for free.
    if (!scrubbing.current) return
    scrubbing.current = false
    const next = Number(e.currentTarget.value)
    if (!Number.isFinite(next)) return
    const audio = audioRef.current
    if (audio) audio.currentTime = next
    setElapsed(next)
  }, [])

  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0
  const press = 'transition-transform duration-(--duration-press) ease-(--ease-out) motion-safe:active:scale-[0.97]'

  return (
    <div className="border-t border-border px-4 pb-4 pt-3.5">
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={(e) => {
          // The drag owns the thumb while it lasts; the playhead gets it back on
          // release. Without this a playing take fought the finger ~4×/s.
          if (scrubbing.current) return
          setElapsed(e.currentTarget.currentTime)
        }}
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
            'inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
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
            'relative inline-flex h-[34px] min-w-11 items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-2 text-[11px] font-semibold tabular-nums text-muted-foreground hover:bg-muted before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-[""]',
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
            'relative inline-flex h-[34px] min-w-11 items-center justify-center gap-0.5 rounded-lg border border-border bg-card px-2 text-[11px] font-semibold tabular-nums text-muted-foreground hover:bg-muted before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-[""]',
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
            'relative inline-flex h-[34px] min-w-[50px] items-center justify-center rounded-full border border-primary/30 bg-primary/8 px-2.5 text-[12.5px] font-bold tabular-nums text-primary before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-[""]',
            press,
          )}
        >
          {/* ⚖ blind native check: 「1倍」 is not how Japanese says normal speed.
              Rate 1 — the EFFECTIVE rate, so an engine that clamped back to 1
              also says 標準 — gets its own word. */}
          {(effectiveRate ?? SPEEDS[speedIndex]) === 1
            ? t('transcript.speedNormal')
            : t('transcript.speedChip', { rate: effectiveRate ?? SPEEDS[speedIndex] })}
        </button>
      </div>

      <div className="px-0">
        <input
          type="range"
          min={0}
          max={total || 0}
          step={0.1}
          value={Math.min(elapsed, total || 0)}
          disabled={total <= 0}
          // The drag moves the DISPLAY only; the element is seeked on release.
          onPointerDown={() => void (scrubbing.current = true)}
          onTouchStart={() => void (scrubbing.current = true)}
          onKeyDown={() => void (scrubbing.current = true)}
          // Belt: a synthetic change with no pointer/key phase (a test, an
          // assistive tool) still claims the thumb for the duration of the drag.
          onChange={(e) => {
            scrubbing.current = true
            setElapsed(Number(e.target.value))
          }}
          onPointerUp={commitSeek}
          // An interrupted drag (the finger leaves the surface, a call arrives)
          // must release the thumb too — otherwise the display freezes for good.
          onPointerCancel={commitSeek}
          onTouchEnd={commitSeek}
          onKeyUp={commitSeek}
          aria-label={t('transcript.seek')}
          className={cn(
            // ⚠ `touch-pan-y` is load-bearing (fix round 3). F8 made this a
            // 44 px × full-width band across a page the staffer scrolls, and
            // WebKit's slider claims the touch on `touchstart` without
            // releasing it for a vertical pan — so a thumb-swipe that happened
            // to start on the scrub would scrub, or do nothing, instead of
            // scrolling the karute. `touch-action: pan-y` gives the browser the
            // vertical gesture back and leaves the horizontal drag to the
            // slider: the standard recipe for a horizontal control inside a
            // vertical scroller, and the one place F8's "the target grew, the
            // look did not" was not free.
            'h-11 w-full cursor-pointer touch-pan-y appearance-none bg-transparent disabled:cursor-default',
            '[&::-webkit-slider-thumb]:size-[15px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[1.5px] [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow-sm',
            '[&::-moz-range-thumb]:size-[15px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[1.5px] [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-card',
          )}
          // The fill is the value made visible — a gradient stop at the played
          // fraction, so there is no second element to keep in sync with it.
          // ⚖ 44 pt (F8). The input is 44 px tall so the thumb's hit area is
          // the whole row; the 5 px track is DRAWN as a centred band, so the
          // look is the mock's and only the target grew.
          style={{
            background: `linear-gradient(to right, var(--primary) ${pct}%, var(--border) ${pct}%) center / 100% 5px no-repeat`,
            borderRadius: '999px',
          }}
        />
      </div>

      <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span className="font-semibold text-foreground/70">{clock(elapsed)}</span>
        <span>{total > 0 ? clock(total) : UNKNOWN_CLOCK}</span>
      </div>

      {notice && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{notice}</p>
      )}
    </div>
  )
}

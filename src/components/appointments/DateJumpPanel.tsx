'use client'

// 日付ジャンプ — the 予約 date chip's own calendar (Liam-approved mock,
// date-jump-picker-20260914/DATE-JUMP-PICKER-MOCK.html).
//
// It replaces the hidden native <input type="date"> the chip used to open: the
// OS wheel showed staff nothing, while the 月 view's own dots + counts answer
// 「来月どんな感じ？」 without leaving the day. One tap on a day IS the
// decision — the panel closes and the page moves to that date WITH ITS MODE
// UNCHANGED (日 stays 日, 週 stays 週, 月 stays 月).
//
// WHAT IT REUSES, and why:
//   - MonthGrid (@synqed-kk/ui) draws the cells — the same component the 月
//     view renders, so a day cell can never look like two different things.
//   - appointmentsToMonthCells (src/lib/adapters/reservation.ts) builds both
//     the real cells (server-side, behind the host's loader) and the
//     day-numbers-only skeleton a not-yet-loaded month shows, so the grid
//     SHAPE comes from one rule too.
//   - The open/outside-pointerdown/Escape-with-IME-guard idiom is
//     KaruteMonthSelector's (spike-lifted/list), the app's field-proven
//     anchored panel — the idiom, not the component: the content is a
//     calendar, not a list.
//
// MOTION is plain CSS transitions on inline transforms (the business shell's
// makeSpring is business territory and is deliberately not imported): open
// 180 ms / close 140 ms ease-out from the chip, month change a 220 ms
// horizontal slide the finger can interrupt, level 1⇄2 a 160 ms blur
// crossfade. `prefers-reduced-motion` drops every transform and leaves the
// fades — read in JS as well as CSS, because the month commit is driven by a
// timer that must fire immediately when the animation is off.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { MonthGrid, type MonthGridCell } from '@synqed-kk/ui'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { appointmentsToMonthCells } from '@/lib/adapters/reservation'
import { computeMonthRange, jstMidnight } from '@/lib/date/calendar-range'
import {
  formatMonthChipJst,
  formatMonthTitleJst,
  formatYearTitleJst,
  jstStartOfToday,
} from '@/lib/date/jst'
import {
  dateJumpReducer,
  firstDayOfMonthKey,
  initialDateJumpState,
  monthKeyInJst,
  monthKeyOf,
  monthsToLoad,
  shiftMonthKey,
  splitMonthKey,
  toMonthGridCells,
  type MonthCellData,
  type MonthKey,
} from '@/lib/appointments/date-jump'

/** ms — kept beside the class strings that spell the same numbers. */
const OPEN_MS = 180
const CLOSE_MS = 140
const SLIDE_MS = 220
/** Finger travel before the gesture claims an axis. */
const AXIS_LOCK_PX = 10
/** Fraction of the grid's width that commits a month on release. */
const COMMIT_FRACTION = 0.4
/** px/ms — a flick commits regardless of distance. */
const COMMIT_VELOCITY = 0.5
/** Upward travel that closes the panel. */
const SWIPE_UP_PX = 40

/** The marker AppointmentsView puts inside the header's date chip: the chip is
 *  rendered by @synqed-kk/ui with no ref, class hook or aria-expanded prop, and
 *  its `dateDisplay` props are ReactNodes — so the marker rides in on the copy
 *  we already own. Fails soft: no marker, no chip state. */
export const DATE_JUMP_CHIP_MARKER = 'data-date-jump-chip'

function chipButton(anchor: HTMLElement | null): HTMLElement | null {
  if (!anchor) return null
  try {
    return anchor.querySelector<HTMLElement>(`button:has([${DATE_JUMP_CHIP_MARKER}])`)
  } catch {
    // :has() is everywhere the app runs, but a stub DOM may not implement it.
    return null
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    // A DOM without matchMedia (jsdom) means "no preference expressed" — the
    // panel keeps its motion rather than refusing to mount.
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export interface DateJumpPanelProps {
  open: boolean
  onClose: () => void
  /** The relative wrapper holding BOTH the header (with its chip) and this
   *  panel — a pointerdown inside it is never "outside". */
  anchorRef: RefObject<HTMLDivElement | null>
  /** The date the page is on: the month the panel opens at. */
  selectedDate: Date
  /** The page's own 月 cells, when it is in 月 mode — that month needs no
   *  fetch. Null in 日/週 mode. */
  seedCells: MonthGridCell[] | null
  /** THE DATA DOOR, injected by the host: the phone hands over the facade GET,
   *  web hands over the getMonthCells server action. Rejecting = that month
   *  shows as failed and is retried on the next visit. */
  loadMonthCells: (monthKey: MonthKey) => Promise<MonthCellData[]>
  /** Tapping a day. The caller decides what "go there" means — and keeps the
   *  current 日/週/月 mode while doing it. */
  onPickDay: (date: Date) => void
  /** Mon-first localized weekday headers, the same array the 月 view feeds
   *  MonthGrid. */
  weekdayLabels: [string, string, string, string, string, string, string]
}

export function DateJumpPanel({
  open,
  onClose,
  anchorRef,
  selectedDate,
  seedCells,
  loadMonthCells,
  onPickDay,
  weekdayLabels,
}: DateJumpPanelProps) {
  const locale = useLocale()
  const t = useTranslations('reservation')
  const reduced = usePrefersReducedMotion()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const paneRefs = {
    prev: useRef<HTMLDivElement>(null),
    current: useRef<HTMLDivElement>(null),
    next: useRef<HTMLDivElement>(null),
  }

  const openMonth = monthKeyInJst(selectedDate)
  const [state, dispatch] = useReducer(
    dateJumpReducer,
    undefined,
    () => initialDateJumpState(openMonth, seedCells),
  )
  const stateRef = useRef(state)
  stateRef.current = state

  // Mount/unmount around the close animation so the panel is really gone
  // (no stray tab stops) once it has faded out.
  const [rendered, setRendered] = useState(open)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) {
      setRendered(true)
      const id = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const id = setTimeout(() => setRendered(false), CLOSE_MS)
    return () => clearTimeout(id)
  }, [open])

  // Every open starts on the page's current month again — the panel is a jump
  // tool, not a place you leave a cursor. Already-fetched months stay cached.
  // Adjusted DURING render, not in an effect: an effect would let one commit
  // render (and therefore the loader effect below) run against the month the
  // panel was left on, firing a fetch for a month nobody asked for.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) dispatch({ type: 'open', month: openMonth, seed: seedCells })
  }

  // The chip is the trigger: it must say so, and it must look pressed. Both
  // are set on the package's own button (see DATE_JUMP_CHIP_MARKER).
  useEffect(() => {
    const chip = chipButton(anchorRef.current)
    chip?.setAttribute('aria-expanded', open ? 'true' : 'false')
  }, [open, anchorRef])

  // Outside pointerdown + Escape — KaruteMonthSelector's handler, including the
  // pointerdown choice and the IME guard (a 変換-cancel Escape belongs to the
  // input method, not to this panel). Escape hands focus back to the chip.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const anchor = anchorRef.current
      if (anchor && !anchor.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.isComposing || e.keyCode === 229) return
      onClose()
      chipButton(anchorRef.current)?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  // Focus lands in the panel, not at the top of the document.
  useEffect(() => {
    if (open && rendered) panelRef.current?.focus()
  }, [open, rendered])

  // ── the data door ────────────────────────────────────────────────────────
  // A month read is a CACHE write, not a UI write, so it is never cancelled:
  // the answer is wanted whichever month is on screen by the time it lands.
  // Cancelling on every dep change stranded the most ordinary gesture there is
  // — open the panel, tap › before the prefetch answers, and the month you land
  // on sat at 「予約状況を読み込み中」 forever, because `pending` reads as "in
  // flight" and the request it was waiting on had been thrown away. The only
  // guard is UNMOUNT.
  const mountedRef = useRef(true)
  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )
  // The months with a promise actually outstanding. A pending cache entry with
  // no promise behind it cannot exist: this set is what makes a second request
  // for the same month impossible, and every settle clears its key.
  const inFlightRef = useRef<Set<MonthKey>>(new Set())

  const requestMonth = useCallback(
    (key: MonthKey) => {
      if (inFlightRef.current.has(key)) return
      inFlightRef.current.add(key)
      dispatch({ type: 'pending', month: key })
      loadMonthCells(key).then(
        (cells) => {
          inFlightRef.current.delete(key)
          if (mountedRef.current) {
            dispatch({ type: 'loaded', month: key, cells: toMonthGridCells(cells) })
          }
        },
        () => {
          inFlightRef.current.delete(key)
          if (mountedRef.current) dispatch({ type: 'failed', month: key })
        },
      )
    },
    [loadMonthCells],
  )

  const visibleEntry = state.cache.get(state.visibleMonth)
  const visibleLoaded = visibleEntry?.status === 'loaded'
  useEffect(() => {
    if (!open) return
    for (const key of monthsToLoad(stateRef.current)) requestMonth(key)
    // stateRef (not `state`) on purpose: this must run when the VISIBLE month
    // changes or finishes loading, never on every cache write — a failed month
    // would otherwise re-request itself forever.
  }, [open, state.visibleMonth, visibleLoaded, requestMonth])

  // ── cells ────────────────────────────────────────────────────────────────
  const today = useMemo(() => jstStartOfToday(), [])
  const cellsFor = useCallback(
    (key: MonthKey): MonthGridCell[] => {
      // Whatever this month last answered with, even while it is being
      // re-read: a refresh must not blink real dots back to bare numbers.
      const entry = state.cache.get(key)
      if (entry?.cells) return entry.cells
      // PENDING ≠ EMPTY: the day numbers (and today's circle) with no counts —
      // built by the SAME builder, from no appointments.
      const { monthStart, monthEnd } = computeMonthRange(firstDayOfMonthKey(key))
      return appointmentsToMonthCells([], monthStart, monthEnd, today)
    },
    [state.cache, today],
  )

  // ── month slide ──────────────────────────────────────────────────────────
  // `slide` is the committed direction being animated; `drag` is the live
  // finger offset. Transitions run only when the finger is off the glass.
  const [slide, setSlide] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The direction in flight, in a ref as well as state: the handlers below
  // read it inside one React batch, where the state value is still the old one.
  const slideRef = useRef(0)

  const commitSlide = useCallback(() => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current)
      commitTimer.current = null
    }
    const k = slideRef.current
    if (k === 0) return
    slideRef.current = 0
    setSlide(0)
    dispatch({ type: 'shiftMonth', delta: k })
  }, [])

  const startSlide = useCallback(
    (delta: number) => {
      slideRef.current = delta
      setDrag(null)
      setSlide(delta)
      commitTimer.current = setTimeout(commitSlide, reduced ? 0 : SLIDE_MS)
    },
    [commitSlide, reduced],
  )

  const goMonth = useCallback(
    (delta: number) => {
      // A second tap mid-slide lands the month in flight first and starts the
      // next one on the FOLLOWING frame — the transition is interruptible, not
      // queued. Doing both in one batch would leave the track parked at the
      // same offset, and staff tapping › three times to reach 12月 would watch
      // two of the three months arrive without moving.
      if (slideRef.current !== 0) {
        commitSlide()
        requestAnimationFrame(() => startSlide(delta))
        return
      }
      startSlide(delta)
    },
    [commitSlide, startSlide],
  )

  const jumpToMonth = useCallback(
    (key: MonthKey) => {
      commitSlide()
      slideRef.current = 0
      setSlide(0)
      setDrag(null)
      dispatch({ type: 'setMonth', month: key })
      dispatch({ type: 'setLevel', level: 'grid' })
    },
    [commitSlide],
  )

  useEffect(
    () => () => {
      if (commitTimer.current) clearTimeout(commitTimer.current)
    },
    [],
  )

  // ── gestures: horizontal = month, upward = close ─────────────────────────
  const gesture = useRef<{
    id: number
    x0: number
    y0: number
    lastX: number
    lastT: number
    velocity: number
    axis: 'none' | 'x' | 'y'
  } | null>(null)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    commitSlide()
    gesture.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      lastX: e.clientX,
      lastT: e.timeStamp,
      velocity: 0,
      axis: 'none',
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    if (g.axis === 'none') {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (g.axis === 'x') e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (g.axis === 'y') {
      if (dy <= -SWIPE_UP_PX) {
        gesture.current = null
        onClose()
      }
      return
    }
    const dt = Math.max(1, e.timeStamp - g.lastT)
    g.velocity = (e.clientX - g.lastX) / dt
    g.lastX = e.clientX
    g.lastT = e.timeStamp
    setDrag(dx)
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    gesture.current = null
    if (!g || g.axis !== 'x') {
      setDrag(null)
      return
    }
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    const width = gridRef.current?.clientWidth ?? 0
    const dx = e.clientX - g.x0
    const far = width > 0 && Math.abs(dx) > width * COMMIT_FRACTION
    const flick = Math.abs(g.velocity) > COMMIT_VELOCITY
    setDrag(null)
    if (far || flick) startSlide(dx < 0 ? 1 : -1)
  }

  // ── height: 5-row and 6-row months differ; follow the pane in view ────────
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    if (!rendered || state.level !== 'grid') return
    const pane =
      slide > 0 ? paneRefs.next.current : slide < 0 ? paneRefs.prev.current : paneRefs.current.current
    if (pane) setHeight(pane.offsetHeight)
    // paneRefs is a stable object of stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, state.level, state.visibleMonth, slide, visibleLoaded])

  if (!rendered) return null

  const prevKey = shiftMonthKey(state.visibleMonth, -1)
  const nextKey = shiftMonthKey(state.visibleMonth, 1)
  const monthTitle = formatMonthTitleJst(firstDayOfMonthKey(state.visibleMonth), locale)
  // A month with cells on screen says nothing: a background refresh is not
  // news, and a failed refresh still leaves real (if older) counts to read.
  // Only a month that has NEVER answered gets a line.
  const status = visibleEntry?.cells ? 'loaded' : (visibleEntry?.status ?? 'pending')
  const atMonths = state.level === 'months'
  const [visibleYear, visibleMonthNumber] = splitMonthKey(state.visibleMonth)

  const trackTransform =
    drag !== null
      ? `translateX(${drag}px)`
      : slide !== 0
        ? `translateX(${-slide * 100}%)`
        : 'translateX(0)'

  const pane = (key: MonthKey, ref: RefObject<HTMLDivElement | null>, className?: string) => (
    <div ref={ref} className={cn('w-full', className)}>
      <MonthGrid
        cells={cellsFor(key)}
        copy={{ weekdayLabels }}
        hideLegend
        onPickDay={(date) => {
          onPickDay(date)
          onClose()
        }}
        className="rounded-none border-0 bg-transparent shadow-none"
      />
    </div>
  )

  return (
    <>
      {/* Scrim over the content the panel hangs in front of. Full-bleed: the
       *  page wrapper's px-4/md:px-6 gutters are part of what it covers. */}
      <div
        aria-hidden
        onPointerDown={onClose}
        className="absolute -left-4 -right-4 top-full z-30 h-screen bg-foreground/20 transition-opacity md:-left-6 md:-right-6"
        style={{
          opacity: shown ? 1 : 0,
          transitionDuration: `${shown ? 150 : CLOSE_MS}ms`,
        }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        // The shell's tab-swipe must not change the screen under an open
        // overlay (thin/gestures.ts walks for this tag).
        data-gesture-inert=""
        className="absolute inset-x-0 top-full z-40 mt-2 origin-top overflow-hidden rounded-xl border border-border bg-card shadow-lg outline-none transition-[opacity,transform] ease-[cubic-bezier(0.23,1,0.32,1)]"
        style={{
          opacity: shown ? 1 : 0,
          // prefers-reduced-motion: fades only — no transform to animate.
          transform: shown || reduced ? 'none' : 'translateY(-4px) scaleY(0.96)',
          transitionDuration: `${shown ? OPEN_MS : CLOSE_MS}ms`,
        }}
      >
        <div className="flex items-center gap-1 border-b border-black/5 px-2 py-2">
          <button
            type="button"
            aria-label={t('prev')}
            onClick={() => (atMonths ? dispatch({ type: 'shiftYear', delta: -1 }) : goMonth(-1))}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-card text-muted-foreground transition-transform duration-100 hover:bg-muted active:scale-[0.97]"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            id={titleId}
            aria-expanded={atMonths}
            onClick={() => dispatch({ type: 'setLevel', level: atMonths ? 'grid' : 'months' })}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] text-sm font-semibold tabular-nums text-foreground transition-transform duration-100 hover:bg-muted active:scale-[0.97]"
          >
            <span>
              {atMonths ? formatYearTitleJst(jstMidnight(state.year, 1, 1), locale) : monthTitle}
            </span>
            <ChevronDown
              className="size-3.5 shrink-0 text-muted-foreground transition-transform"
              style={{
                transform: atMonths ? 'rotate(180deg)' : 'none',
                transitionDuration: reduced ? '0ms' : '160ms',
              }}
              aria-hidden
            />
          </button>
          <button
            type="button"
            aria-label={t('next')}
            onClick={() => (atMonths ? dispatch({ type: 'shiftYear', delta: 1 }) : goMonth(1))}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-card text-muted-foreground transition-transform duration-100 hover:bg-muted active:scale-[0.97]"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>

        <div className="relative">
          {/* level 1 — the month grid */}
          <div
            className={cn('transition-[opacity,filter]', atMonths && 'pointer-events-none absolute inset-x-0 top-0')}
            style={{
              opacity: atMonths ? 0 : 1,
              filter: atMonths && !reduced ? 'blur(2px)' : 'none',
              transitionDuration: reduced ? '0ms' : '160ms',
            }}
            aria-hidden={atMonths}
          >
            <div
              ref={gridRef}
              className="relative touch-none overflow-hidden"
              style={{
                height,
                transition: drag !== null || reduced ? 'none' : `height ${SLIDE_MS}ms cubic-bezier(0.32,0.72,0,1)`,
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
            >
              <div
                className="relative w-full"
                style={{
                  transform: trackTransform,
                  transition:
                    drag !== null || reduced
                      ? 'none'
                      : `transform ${SLIDE_MS}ms cubic-bezier(0.32,0.72,0,1)`,
                }}
              >
                {pane(prevKey, paneRefs.prev, 'absolute -left-full top-0')}
                {pane(state.visibleMonth, paneRefs.current)}
                {pane(nextKey, paneRefs.next, 'absolute left-full top-0')}
              </div>
            </div>

            {/* Always mounted so it is a stable live region: a month that goes
             *  from loading to failed must be ANNOUNCED, not silently redrawn.
             *  Empty (and unpadded) once the month is loaded. */}
            <p
              role="status"
              className={cn(
                'px-3 text-[11px]',
                status === 'loaded' && 'hidden',
                status === 'failed' ? 'pt-2 text-[var(--color-warning)]' : 'pt-2 text-muted-foreground',
              )}
            >
              {status === 'loaded'
                ? ''
                : status === 'failed'
                  ? t('dateJump.failed')
                  : t('dateJump.loading')}
            </p>

            {/* Legend — the 月 view's own three words, plus what the number is
             *  (the package's legend strip never said). Rendered here rather
             *  than by MonthGrid because it must stay put while the months
             *  slide underneath it. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-black/5 px-3 py-2 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-[var(--color-success)]" aria-hidden />
                {t('month.legendLight')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-[var(--color-accent)]" aria-hidden />
                {t('month.legendMedium')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-[var(--color-warning)]" aria-hidden />
                {t('month.legendBusy')}
              </span>
              <span aria-hidden className="text-border">
                ／
              </span>
              <span>{t('dateJump.legendCount')}</span>
            </div>

            <div className="flex items-center border-t border-black/5 px-2 py-1.5">
              <button
                type="button"
                onClick={() => {
                  onPickDay(today)
                  onClose()
                }}
                className="inline-flex h-8 items-center rounded-[var(--radius-sm)] px-2 text-sm font-medium text-primary transition-transform duration-100 hover:bg-primary/10 active:scale-[0.97]"
              >
                {t('today')}
              </button>
            </div>
          </div>

          {/* level 2 — the year's twelve months */}
          <div
            className={cn(
              'p-3 transition-[opacity,filter]',
              !atMonths && 'pointer-events-none absolute inset-x-0 top-0',
            )}
            style={{
              opacity: atMonths ? 1 : 0,
              filter: !atMonths && !reduced ? 'blur(2px)' : 'none',
              transitionDuration: reduced ? '0ms' : '160ms',
            }}
            aria-hidden={!atMonths}
          >
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 12 }, (_, i) => {
                const month = i + 1
                const isCurrent = state.year === visibleYear && month === visibleMonthNumber
                return (
                  <button
                    key={month}
                    type="button"
                    aria-pressed={isCurrent}
                    tabIndex={atMonths ? undefined : -1}
                    onClick={() => jumpToMonth(monthKeyOf(state.year, month))}
                    className={cn(
                      'inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] border text-sm font-semibold tabular-nums transition-transform duration-100 active:scale-[0.97]',
                      isCurrent
                        ? 'border-primary bg-primary/8 text-primary'
                        : 'border-border bg-card text-foreground hover:bg-muted',
                    )}
                  >
                    {formatMonthChipJst(jstMidnight(state.year, month, 1), locale)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

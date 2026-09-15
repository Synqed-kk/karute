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
// MOTION is the STUDIO SPRING, ported from the approved mock rather than
// re-described: src/lib/motion/spring.ts is the mock's own `makeSpring`
// (DATE-JUMP-PICKER-MOCK.html:465-496, response 0.30, damping 1.0). Two
// instances of it own the moving pixels and write them every frame through
// refs — the panel's opacity/transform plus the scrim's opacity (MOCK
// 1061-1067), and the month track's x in pixels plus the grid's height while a
// shift is armed (MOCK 1069-1093). React sets none of those properties and no
// CSS transition is declared for them: a transition fighting a per-frame write
// is a second motion language on one element, and a transition cannot be
// handed a flick's velocity.
//
// The chevron, the level 1⇄2 blur crossfade and the press scale stay plain CSS
// cubic-beziers (design §3) — they are states, not gestures.
// `prefers-reduced-motion` keeps the fades and drops the transforms: the open
// spring still runs (the panel fades in), its `apply` simply writes no
// transform, and the slide spring lands every `set` instantly.

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
import { makeSpring, type Spring, type SpringOptions } from '@/lib/motion/spring'
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

/** Finger travel before the gesture claims an axis (MOCK 1345). */
const AXIS_LOCK_PX = 6
/** Fraction of the grid's width that commits a month on release (MOCK 1365). */
const COMMIT_FRACTION = 0.25
/** px/s — a flick commits regardless of distance (MOCK 1365-1366). */
const COMMIT_VELOCITY = 550
/** Upward travel that closes the panel. */
const SWIPE_UP_PX = 40

/**
 * The press feedback every button in the panel shares, and the reduced-motion
 * answer to it. Gated in JS rather than with a `motion-reduce:` utility on
 * purpose: Tailwind v4 emits `active:scale-[0.97]` as the standalone
 * `scale: .97` property (read back from the built stylesheet), so
 * `transform: none` cannot cancel it, and a `motion-reduce:scale-100` loses to
 * `:active` on specificity. Dropping the class is the only version that
 * actually leaves opacity alone, which is what L5 asks for.
 */
const PRESS =
  'transition-transform duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]'
const PRESS_REDUCED = 'transition-none'

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
  const press = reduced ? PRESS_REDUCED : PRESS
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  /** The height wrapper the months slide inside — the mock's `gridWrap`. */
  const gridRef = useRef<HTMLDivElement>(null)
  /** The three-pane strip the spring translates — the mock's `track`. */
  const trackRef = useRef<HTMLDivElement>(null)
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

  // ── the panel's own spring: open and close (MOCK 1061-1067, 1095-1113) ────
  // `reduced` is read through a ref rather than closed over: the springs are
  // built once, and the media query can answer after they exist.
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  // Mount/unmount around the close animation so the panel is really gone
  // (no stray tab stops) once it has faded out.
  const [rendered, setRendered] = useState(open)
  /** Has this mount had its CLOSED style written yet? Cleared at rest, so a
   *  reopen mid-close continues instead of re-seating. */
  const seatedRef = useRef(false)

  // D1 — the OPEN spring never runs `reduced`. Design §3 asks for "fades only",
  // so under reduce the fade still plays at full speed and only the transform
  // is dropped (in `apply`). The mock jumps instantly there; §3 outranks it.
  const openOpts = useRef<SpringOptions>({
    response: 0.3,
    damping: 1,
    eps: 0.004,
    onRest: (p) => {
      if (p !== 0) return
      seatedRef.current = false
      setRendered(false)
    },
  }).current
  const openSpringRef = useRef<Spring | null>(null)
  if (!openSpringRef.current) {
    openSpringRef.current = makeSpring((p) => {
      const dialog = panelRef.current
      if (dialog) {
        dialog.style.opacity = String(p)
        dialog.style.transform = reducedRef.current
          ? 'none'
          : `scaleY(${(0.96 + 0.04 * p).toFixed(4)}) translateY(${(-4 * (1 - p)).toFixed(2)}px)`
      }
      // The scrim's own class carries the mock's alpha (bg-foreground/20 ≈ the
      // mock's rgba(17,20,24,.22) × 0.9), so the spring writes p, not p × 0.9.
      const scrim = scrimRef.current
      if (scrim) scrim.style.opacity = String(p)
    }, openOpts)
  }
  const openSpring = openSpringRef.current

  // THE PRODUCTION FIX, BY CONSTRUCTION. `jump(0)` writes the closed style
  // synchronously in the commit that mounted the panel and BEFORE the browser
  // paints it, so the first picture of this element is always the closed one —
  // and every frame after it is written by the spring itself, not inferred by
  // the transition engine from a style delta it may never have seen. The old
  // code mounted closed and flipped open one rAF later: production's faster JS
  // put both commits inside a single frame, the browser painted only the open
  // state, and the panel snapped into place with no animation at all.
  useLayoutEffect(() => {
    if (open) {
      if (!rendered) {
        setRendered(true)
        return
      }
      if (!seatedRef.current) {
        seatedRef.current = true
        openSpring.jump(0)
      }
      // Reopening mid-close picks up from wherever the fade got to — the same
      // path back, interruptible, never a jump to 0.
      openSpring.set(1)
      return
    }
    if (rendered) openSpring.set(0)
  }, [open, rendered, openSpring])

  useEffect(() => () => openSpring.stop(), [openSpring])

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
  // guard is UNMOUNT — and it is re-armed in the effect BODY, not just cleared
  // in the cleanup. StrictMode mounts, runs effects, unmounts and remounts; a
  // cleanup-only guard latches false for the component's life there, and every
  // month read is discarded — the very symptom this fix exists to kill, in
  // exactly the two environments the first browser pass runs in (`next dev`
  // defaults to strict; thin/main.tsx wraps the shell in it).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
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
        (error) => {
          inFlightRef.current.delete(key)
          // Degraded is allowed, silent is not (the same line the facade's
          // menus read is held to, app-api/screens/appointments/route.ts:92-98):
          // staff get a Japanese line, and whoever reads the console gets the
          // cause. Never rethrown — the panel keeps working without counts.
          console.warn('[date-jump] month read failed', { month: key, error })
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

  // ── month slide + swipe: the mock's slideSpring (MOCK 1069-1093, 1134-1149,
  //    1332-1374) ──────────────────────────────────────────────────────────
  // The spring's value IS the track's x in pixels, and while a shift is armed
  // it interpolates the grid's height between the two months' row counts. Both
  // used to be CSS transitions with a commit timer behind them; the timer was
  // the thing that could lose a tap, and a transition cannot be handed the
  // velocity of a flick.
  /** The shift this travel commits when the spring comes to rest. */
  const pendingRef = useRef(0)
  /** The same number as RENDER state, because the JSX needs it too (which pane
   *  may take a tap). The ref is what the spring's own callbacks read
   *  synchronously mid-frame; a ref alone cannot re-render the panes when a
   *  flick arms a shift at pointerup. Both are written through `setPending`
   *  and never apart. */
  const [liveDir, setLiveDir] = useState(0)
  const setPending = useCallback((k: number) => {
    pendingRef.current = k
    setLiveDir(k)
  }, [])
  const hFromRef = useRef<number | null>(null)
  const hToRef = useRef<number | null>(null)
  /** Bumped by every new slide request so the layout effect below starts the
   *  travel AFTER the panes have re-keyed — the heights it measures are then
   *  the two months actually on screen. */
  const [travel, setTravel] = useState(0)

  /** The live gesture. Declared here because the re-seat effect has to know
   *  whether a finger is on the glass. */
  const gesture = useRef<{
    id: number
    x0: number
    y0: number
    dx: number
    dir: number
    lastX: number
    lastT: number
    velocity: number
    axis: 'none' | 'x' | 'y'
  } | null>(null)

  /** How far a month travels. The fallback is the mock's own (MOCK 1088): a
   *  DOM that has never laid out still has to produce a finite target. */
  const paneW = useCallback(() => gridRef.current?.clientWidth || 377, [])

  /** MOCK 1090-1093 — the two heights the slide interpolates between. `0`
   *  disarms and hands the height back to the pane in flow. */
  const armHeights = useCallback((k: number) => {
    if (!k) {
      hFromRef.current = null
      hToRef.current = null
      if (gridRef.current) gridRef.current.style.height = ''
      return
    }
    hFromRef.current = paneRefs.current.current?.offsetHeight ?? null
    hToRef.current = (k > 0 ? paneRefs.next.current : paneRefs.prev.current)?.offsetHeight ?? null
    // paneRefs is a stable object of stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** MOCK 1079-1087. Lands the armed shift. The track's re-seat and the height
   *  reset are NOT done here: they belong to the same paint as the pane
   *  re-key, which is the layout effect below — otherwise one frame shows the
   *  month that just landed sitting at the old month's offset. */
  const commitPending = useCallback(() => {
    const k = pendingRef.current
    if (!k) return
    setPending(0)
    hFromRef.current = null
    hToRef.current = null
    dispatch({ type: 'shiftMonth', delta: k })
  }, [setPending])
  const commitPendingRef = useRef(commitPending)
  commitPendingRef.current = commitPending

  const slideOpts = useRef<SpringOptions>({
    response: 0.3,
    damping: 1,
    eps: 0.4,
    onRest: () => commitPendingRef.current(),
  }).current
  // Reduced motion: every `set` lands instantly. The design gives a slide no
  // fade to play instead, so the month is simply there.
  slideOpts.reduced = reduced
  const slideSpringRef = useRef<Spring | null>(null)
  if (!slideSpringRef.current) {
    slideSpringRef.current = makeSpring((x) => {
      const track = trackRef.current
      if (track) track.style.transform = `translate3d(${x}px,0,0)`
      const wrap = gridRef.current
      const from = hFromRef.current
      const to = hToRef.current
      if (wrap && from !== null && to !== null) {
        const t = Math.min(1, Math.abs(x) / Math.max(1, wrap.clientWidth || 377))
        wrap.style.height = `${(from + (to - from) * t).toFixed(1)}px`
      }
    }, slideOpts)
  }
  const slideSpring = slideSpringRef.current
  useEffect(() => () => slideSpring.stop(), [slideSpring])

  // Every pane re-key and every new slide request lands here, BEFORE paint:
  // re-seat the track, arm the heights of the months now on screen, and start
  // the travel that is waiting.
  useLayoutEffect(() => {
    const g = gesture.current
    if (g && g.axis === 'x') {
      // A finger owns the track — re-seat under it, not at 0.
      slideSpring.jump(g.dx)
      armHeights(g.dir)
      return
    }
    slideSpring.jump(0)
    const k = pendingRef.current
    armHeights(k)
    if (k) slideSpring.set(-k * paneW())
  }, [travel, state.visibleMonth, slideSpring, armHeights, paneW])

  /** MOCK 1134-1141. A second tap mid-slide LANDS the first instantly and then
   *  slides the next: the taps cannot race each other, because each one closes
   *  the travel before it opens its own. No queue, no commit timer. */
  const goMonth = useCallback(
    (delta: number) => {
      commitPendingRef.current()
      setPending(delta)
      setTravel((n) => n + 1)
    },
    [setPending],
  )

  /** MOCK 1143-1149. */
  const jumpToMonth = useCallback(
    (key: MonthKey) => {
      setPending(0)
      setTravel((n) => n + 1)
      dispatch({ type: 'setMonth', month: key })
      dispatch({ type: 'setLevel', level: 'grid' })
    },
    [setPending],
  )

  // Opening or closing starts the slide over: land nothing, arm nothing. A
  // travel left in flight across a close walked the panel off the month it had
  // just reopened on.
  useLayoutEffect(() => {
    setPending(0)
    slideSpring.jump(0)
    armHeights(0)
  }, [open, slideSpring, armHeights, setPending])

  // ── gestures: horizontal = month, upward = close ─────────────────────────
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Deliberately does NOT touch the slide — the mock's pointerdown commits,
    // and this app's does not (R10): committing here changed the month under
    // the finger between pointerdown and click, and she tapped 9/1 and landed
    // on 10/1. A tap leaves the travel in flight to its own spring.
    gesture.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      dx: 0,
      dir: 0,
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
      if (g.axis === 'x') {
        // NOW it is a drag, and a drag is a new intention: land what is moving
        // so the finger takes over from rest. No cell can be tapped past this
        // point — the pointer is captured by the grid.
        commitPending()
        // Optional call: a stub DOM may not implement pointer capture, and the
        // drag still works without it.
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }
    }
    if (g.axis === 'y') {
      if (dy <= -SWIPE_UP_PX) {
        gesture.current = null
        onClose()
      }
      return
    }
    const dt = Math.max(1, e.timeStamp - g.lastT)
    // px/s — the unit the spring's nudge speaks (MOCK 1351).
    g.velocity = ((e.clientX - g.lastX) / dt) * 1000
    g.lastX = e.clientX
    g.lastT = e.timeStamp
    const k0 = dx < 0 ? 1 : -1
    if (k0 !== g.dir) {
      g.dir = k0
      armHeights(k0)
    }
    g.dx = dx
    slideSpring.jump(dx)
    e.preventDefault()
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    gesture.current = null
    if (!g || g.axis !== 'x') return
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // MOCK 1364-1370: distance OR speed commits, and the flick's velocity is
    // handed into the spring so the release continues the throw.
    const dx = slideSpring.value()
    const width = paneW()
    const k =
      dx < -width * COMMIT_FRACTION || g.velocity < -COMMIT_VELOCITY
        ? 1
        : dx > width * COMMIT_FRACTION || g.velocity > COMMIT_VELOCITY
          ? -1
          : 0
    slideSpring.nudge(g.velocity)
    setPending(k)
    armHeights(k)
    slideSpring.set(k ? -k * width : 0)
  }


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

  // Off-screen panes stay MOUNTED (the slide needs them drawn) but are inert:
  // ~40 day buttons per pane in a month clipped out of view were in the tab
  // order, and the previous month's pane sits FIRST in DOM order, so tabbing
  // off the header walked into a month nobody could see — and Enter there
  // navigated to a date nobody chose.
  //
  // LIVE is `liveDir`: the month the panel is on, or — while a shift is armed
  // — the month that shift is travelling TOWARD. The slide spring rests on
  // 0.4 px, so it keeps creeping for ~350 ms after the track has visually
  // stopped, and the commit only happens at rest: measured on the production
  // build, the track is 98.7 % of the way across at 301 ms with the new month
  // filling the screen, and `state.visibleMonth` does not change until ~611 ms.
  // Leaving the incoming pane inert through that window is a landed month that
  // swallows taps — the exact miss this panel exists to remove. `onPickDay`
  // carries the cell's own Date, so an early tap goes to the day that was
  // tapped, never to the same square of another month.
  //
  // `key` is the month: a landed month MOUNTS, it does not inherit the cell
  // nodes of the month before it. MonthGrid's cell carries `transition-colors`,
  // so reusing them ran a 150 ms background fade on 21 cells 46 ms after the
  // month had already arrived — the month developing after it landed. The mock
  // replaces the pane's markup and has nothing left to fade.
  const pane = (
    key: MonthKey,
    ref: RefObject<HTMLDivElement | null>,
    paneDir: -1 | 0 | 1,
    className?: string,
  ) => (
    <div key={key} ref={ref} className={cn('w-full', className)} inert={paneDir !== liveDir || undefined}>
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
        ref={scrimRef}
        aria-hidden
        onPointerDown={onClose}
        className="absolute -left-4 -right-4 top-full z-30 h-screen bg-foreground/20 md:-left-6 md:-right-6"
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
        // The opacity and transform are the open spring's, written every
        // frame through panelRef — React must not set them here.
        className="absolute inset-x-0 top-full z-40 mt-2 origin-top overflow-hidden rounded-xl border border-border bg-card shadow-lg outline-none"
      >
        <div className="flex items-center gap-1 border-b border-black/5 px-2 py-2">
          <button
            type="button"
            aria-label={t('prev')}
            onClick={() => (atMonths ? dispatch({ type: 'shiftYear', delta: -1 }) : goMonth(-1))}
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-card text-muted-foreground hover:bg-muted',
              press,
            )}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            id={titleId}
            aria-expanded={atMonths}
            onClick={() => {
              // Land the month in flight BEFORE the level changes: it would
              // otherwise land ~300 ms later, and shiftMonth resets the level
              // to the grid — the year chips closed themselves while the staff
              // member was reading them. Committing first also means the chips
              // open on the year of the month that actually landed.
              // (commitPending's shiftMonth is itself what re-seats the
              // track, in the layout effect on the new month.)
              if (!atMonths) commitPending()
              dispatch({ type: 'setLevel', level: atMonths ? 'grid' : 'months' })
            }}
            className={cn(
              'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] text-sm font-semibold tabular-nums text-foreground hover:bg-muted',
              press,
            )}
          >
            <span>
              {atMonths ? formatYearTitleJst(jstMidnight(state.year, 1, 1), locale) : monthTitle}
            </span>
            <ChevronDown
              // The mock's own curve (MOCK 249, design §3). Without it the
              // rotate inherits Tailwind's default ease-in-out and loiters
              // before it turns.
              className="size-3.5 shrink-0 text-muted-foreground transition-transform ease-[cubic-bezier(0.23,1,0.32,1)]"
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
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-card text-muted-foreground hover:bg-muted',
              press,
            )}
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
            // aria-hidden on a subtree whose ~110 buttons stayed focusable is
            // the aria-hidden-focus violation; inert is what actually takes
            // them out of the tab order.
            inert={atMonths || undefined}
          >
            {/* The height is the pane in flow's own at rest, and the slide
              *  spring's interpolation while a shift is armed — never React's,
              *  or a re-render mid-slide would stamp the resting one back on. */}
            <div
              ref={gridRef}
              className="relative touch-none overflow-hidden"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
            >
              <div ref={trackRef} className="relative w-full">
                {pane(prevKey, paneRefs.prev, -1, 'absolute -left-full top-0')}
                {pane(state.visibleMonth, paneRefs.current, 0)}
                {pane(nextKey, paneRefs.next, 1, 'absolute left-full top-0')}
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
                className={cn(
                  'inline-flex h-8 items-center rounded-[var(--radius-sm)] px-2 text-sm font-medium text-primary hover:bg-primary/10',
                  press,
                )}
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
            inert={!atMonths || undefined}
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
                    onClick={() => jumpToMonth(monthKeyOf(state.year, month))}
                    className={cn(
                      'inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] border text-sm font-semibold tabular-nums',
                      press,
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

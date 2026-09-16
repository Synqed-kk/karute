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
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { MonthGrid, type MonthGridCell } from '@synqed-kk/ui'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { makeSpring, type Spring, type SpringOptions } from '@/lib/motion/spring'
import { useHorizontalSlide, usePrefersReducedMotion } from '@/lib/motion/use-horizontal-slide'
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

interface PaneProps {
  cells: MonthGridCell[]
  copy: { weekdayLabels: DateJumpPanelProps['weekdayLabels'] }
  onPickDay: (date: Date) => void
}

/**
 * One month's grid, and the only part of a pane that is expensive to draw.
 *
 * MonthGrid is a plain `forwardRef` in the package — nothing memoizes it there
 * — while the panel re-renders on every `setPending`, every armed-direction flip and
 * every cache write. All three panes were therefore redrawing ~40 day buttons
 * each time: measured on the production build under a 4× CPU throttle, ONE
 * month change cost four long tasks of ~90-100 ms, and browsing months is the
 * gesture staff make most.
 *
 * `memo`'s shallow compare is what stops that, so all three props are
 * identity-stable across a shift: `cells` is the cache's own array (or the
 * skeleton built once per month), `copy` and `onPickDay` are memoized in the
 * panel. Everything that DOES change on a shift — `inert`, the className and
 * the pane ref — stays on the wrapper div OUTSIDE this boundary, so arming a
 * shift redraws no grid at all and a commit draws only the month arriving for
 * the first time.
 */
const Pane = memo(function Pane({ cells, copy, onPickDay }: PaneProps) {
  return (
    <MonthGrid
      cells={cells}
      copy={copy}
      hideLegend
      onPickDay={onPickDay}
      className="rounded-none border-0 bg-transparent shadow-none"
    />
  )
})

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
  /** 2 = open on the month chips (月 mode, §v11b) instead of the day grid. */
  defaultLevel?: 1 | 2
  onPickMonth?: (year: number, month: number) => void // §v11 point 1 — at level 2 a month chip LANDS that month
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
  defaultLevel = 1,
  onPickMonth,
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

  /** The two months either side of the one on screen. Up here because the
   *  deferred-draw set below needs them; the JSX reads the same two consts. */
  const prevKey = shiftMonthKey(state.visibleMonth, -1)
  const nextKey = shiftMonthKey(state.visibleMonth, 1)

  /**
   * THE MONTHS WHOSE GRID IS ALLOWED TO BE DRAWN — the panel's whole cost.
   *
   * MonthGrid is ~40 day buttons, and three months are on screen. Drawing all
   * three in the commit that OPENS the panel cost one 133-184 ms task on the
   * production build under a 4x CPU throttle: the open animation's first frames
   * paying for two months nobody can see yet. Drawing the month that arrives
   * BEHIND a commit (the new far month) put the same kind of work into the one
   * frame where a slide lands — the single frame of a shift over 32 ms.
   *
   * So a FAR month is drawn one animation frame AFTER the commit that put it
   * there, and the set only grows while the panel is open — which is what keeps
   * the month a commit hands over from `next` to `current` from blinking out
   * and back: it was already drawn. Nothing about the springs, the curves, the
   * `inert` rule or the reduced-motion branch changes; only WHEN a month's day
   * buttons are created.
   *
   * ONE MONTH PER FRAME, and never two in the same one. Both in a single frame
   * after the first paint just moved the task into the middle of the fade (the
   * longest gap between two frames of an open went 38.8-51.3 ms → 77.3-83.6 ms),
   * and waiting for the open spring to arrive left an early › tap paying for
   * both months itself (a 78 ms task, 81.7 ms gap, on a gesture that cost
   * nothing before). Split across two frames, each month is a third of that and
   * both are on screen ~32 ms after the panel is, long before a finger arrives.
   *
   * A gesture that needs a far pane before those frames arrive draws it
   * synchronously — `ensureDrawn` runs inside the ‹ / › handler and inside
   * pointerdown, in the same React batch as the state that starts the travel,
   * so the pane is in the DOM before the layout effect measures its height.
   */
  const [drawn, setDrawn] = useState<ReadonlySet<MonthKey>>(() => new Set([openMonth]))
  /** Draw these months now — the neighbours by default, or just the one a
   *  gesture is about to travel toward. */
  const ensureDrawn = useCallback(
    (...keys: MonthKey[]) => {
      const want = keys.length ? keys : [prevKey, nextKey]
      setDrawn((s) => (want.every((k) => s.has(k)) ? s : new Set([...s, ...want])))
    },
    [prevKey, nextKey],
  )

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
    if (open) {
      dispatch({ type: 'open', month: openMonth, seed: seedCells })
      // Every open pays for ONE month, not three (see `drawn`).
      setDrawn(new Set([openMonth]))
      // §v11b — the 月 door opens straight on the month chips.
      if (defaultLevel === 2) dispatch({ type: 'setLevel', level: 'months' })
    }
  }

  // One missing month per animation frame — the frames after the panel's first
  // paint, and the frame after every commit. Declared here because it reads
  // `rendered`, which is the mount the first paint belongs to. The month being
  // travelled toward goes first: it is the one a gesture can want.
  useEffect(() => {
    if (!open || !rendered) return
    const missing = [nextKey, prevKey].find((key) => !drawn.has(key))
    if (!missing) return
    const id = requestAnimationFrame(() => ensureDrawn(missing))
    return () => cancelAnimationFrame(id)
  }, [open, rendered, drawn, prevKey, nextKey, ensureDrawn])

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
  /** The skeleton cells of a month that has never answered, built ONCE per
   *  month. They depend on nothing but the month and `today`, so a fresh array
   *  on every call was pure waste — and, since `memo` compares props by
   *  identity, it redrew every pending pane on every render of the panel. */
  const skeletonCells = useRef<Map<MonthKey, MonthGridCell[]>>(new Map())
  const cellsFor = useCallback(
    (key: MonthKey): MonthGridCell[] => {
      // Whatever this month last answered with, even while it is being
      // re-read: a refresh must not blink real dots back to bare numbers.
      const entry = state.cache.get(key)
      if (entry?.cells) return entry.cells
      // PENDING ≠ EMPTY: the day numbers (and today's circle) with no counts —
      // built by the SAME builder, from no appointments.
      const built = skeletonCells.current.get(key)
      if (built) return built
      const { monthStart, monthEnd } = computeMonthRange(firstDayOfMonthKey(key))
      const cells = appointmentsToMonthCells([], monthStart, monthEnd, today)
      skeletonCells.current.set(key, cells)
      return cells
    },
    [state.cache, today],
  )

  /** The two props every pane hands MonthGrid that are not its cells. Memoized
   *  for the panes' `memo`: a fresh object or closure per render compares
   *  unequal and redraws all three months (see `Pane`). */
  const gridCopy = useMemo(() => ({ weekdayLabels }), [weekdayLabels])
  const pickDay = useCallback(
    (date: Date) => {
      onPickDay(date)
      onClose()
    },
    [onPickDay, onClose],
  )

  // ── month slide + swipe: THE SHARED GESTURE ──────────────────────────────
  // The pointer tracking, the axis lock, the "distance OR speed" commit rule,
  // the flick's velocity handed into the spring and the interruption/re-seat
  // rules moved OUT of this file, unchanged, into
  // src/lib/motion/use-horizontal-slide.ts — so the 予約 page's own 日/週/月
  // swipe is THE SAME gesture rather than a second one that feels almost like
  // it. What stays here is what is the PANEL's: what a commit MEANS (a month),
  // the two grid heights the travel interpolates, and the keyboard's way home.
  /** Set by a commit that happened while the keyboard was inside the panel;
   *  read (and cleared) by the layout effect that runs on the re-keyed panes. */
  const refocusRef = useRef(false)
  const hFromRef = useRef<number | null>(null)
  const hToRef = useRef<number | null>(null)

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

  const slide = useHorizontalSlide({
    width: paneW,
    reduced,
    // A finger can drag either way, so both neighbours have to be drawn before
    // the first move — the same batch, one frame ahead of any measurement.
    onGestureStart: () => ensureDrawn(),
    onSwipeUp: onClose,
    onArm: armHeights,
    onCommit: (k) => {
      // The commit re-keys all three panes, so a focused day button is either
      // unmounted or left inside a pane that has just gone inert — both blur to
      // <body>, and the keyboard user is then outside the dialog with the next
      // Tab starting at the top of the page. Remember the keyboard was in here.
      refocusRef.current = !!panelRef.current?.contains(document.activeElement)
      hFromRef.current = null
      hToRef.current = null
      dispatch({ type: 'shiftMonth', delta: k })
    },
    // The wrapping grid's height, interpolated in the SAME frame as the track's
    // transform. React sets neither and no CSS transition is declared for them:
    // a transition fighting a per-frame write is a second motion language on one
    // element, and a transition cannot be handed a flick's velocity.
    onFrame: (x) => {
      const wrap = gridRef.current
      const from = hFromRef.current
      const to = hToRef.current
      if (wrap && from !== null && to !== null) {
        const t = Math.min(1, Math.abs(x) / Math.max(1, wrap.clientWidth || 377))
        wrap.style.height = `${(from + (to - from) * t).toFixed(1)}px`
      }
    },
  })
  const { commitPending, reseat, reset, go } = slide

  // Every pane re-key and every new slide request lands here, BEFORE paint:
  // re-seat the track, arm the heights of the months now on screen, and start
  // the travel that is waiting.
  useLayoutEffect(() => {
    if (refocusRef.current) {
      refocusRef.current = false
      const active = document.activeElement as HTMLElement | null
      // A browser blurs to <body> when the node holding focus is unmounted or
      // its pane goes inert; jsdom enforces neither, so both are checked.
      if (!active || active === document.body || active.closest?.('[inert]')) {
        panelRef.current?.focus()
      }
    }
    reseat()
  }, [slide.travel, state.visibleMonth, reseat])

  const goMonth = useCallback(
    (delta: -1 | 1) => {
      // The pane this travel moves toward has to EXIST before the layout
      // effect measures it — same batch, same commit, so it does. ONLY that
      // one: the month behind can wait for its own frame.
      ensureDrawn(delta > 0 ? nextKey : prevKey)
      go(delta)
    },
    [ensureDrawn, nextKey, prevKey, go],
  )

  /** MOCK 1143-1149. */
  const jumpToMonth = useCallback(
    (key: MonthKey) => {
      if (onPickMonth && defaultLevel === 2) {
        onPickMonth(...splitMonthKey(key))
        return onClose()
      }
      // Land nothing: a month chip abandons the travel in flight rather than
      // committing it, and `reset` re-seats the track in the same tick.
      reset()
      dispatch({ type: 'setMonth', month: key })
      dispatch({ type: 'setLevel', level: 'grid' })
    },
    [reset, onPickMonth, defaultLevel, onClose],
  )

  // Opening or closing starts the slide over: land nothing, arm nothing. A
  // travel left in flight across a close walked the panel off the month it had
  // just reopened on.
  useLayoutEffect(() => {
    reset()
  }, [open, reset])

  if (!rendered) return null

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
  // LIVE is: the CURRENT pane (paneDir 0 — the month the panel is ON) always,
  // armed or not, PLUS — while a shift is armed — the pane `slide.dir` is
  // travelling TOWARD. Only the one pane left over (behind the direction of
  // travel) is inert. The slide spring rests on 0.4 px, so it keeps creeping
  // for ~350 ms after the track has visually stopped, and the commit only
  // happens at rest: measured on the production build, the track is 98.7 % of
  // the way across at 301 ms with the new month filling the screen, and
  // `state.visibleMonth` does not change until ~611 ms. Leaving either the
  // incoming pane OR the current pane inert through that window swallows a
  // tap on a month that looks finished (or still mostly there) — the exact
  // miss this panel exists to remove; an earlier round made the current pane
  // inert the moment a shift armed, which cost exactly this on the departing
  // month. `onPickDay` carries the cell's own Date, so an early tap on either
  // live pane goes to the day that was tapped, never to the same square of
  // another month.
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
    <div
      key={key}
      ref={ref}
      className={cn('w-full', className)}
      inert={(paneDir !== 0 && paneDir !== slide.dir) || undefined}
    >
      {drawn.has(key) ? (
        <Pane cells={cellsFor(key)} copy={gridCopy} onPickDay={pickDay} />
      ) : null}
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
        className={cn(
          'absolute -left-4 -right-4 top-full z-30 h-screen bg-foreground/20 will-change-[opacity] md:-left-6 md:-right-6',
          // The scrim outlives its own fade for the same ~480 ms as the dialog
          // (see the `inert` note below) and an element at opacity 0.004 is
          // still fully hit-testable — it would swallow the first tap the
          // staff member makes on the page behind it.
          !open && 'pointer-events-none',
        )}
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
        // CLOSING IS INSTANTLY UNTOUCHABLE. Unmount waits for the open
        // spring's REST (≈483 ms) while the fade is visually over by ≈367 ms,
        // and an element at opacity 0.004 still takes every tap: the
        // invisible calendar sat over the top of the 予約 list and a day
        // cell's handler NAVIGATES — the same wrong-date miss this panel
        // exists to remove. `inert` is the 8/25 deferred-unmount pattern the
        // recording dialogs already ship: one attribute takes the subtree out
        // of hit-testing, out of the tab order (~110 controls, while the chip
        // already says aria-expanded="false") and out of the a11y tree.
        inert={!open || undefined}
        // The opacity and transform are the open spring's, written every
        // frame through panelRef — React must not set them here.
        //
        // `will-change` is what makes those per-frame writes cheap on the
        // phone: without it the panel has no standing compositor layer, so
        // every frame repaints the card — border, shadow, ~40 day buttons and
        // all. Measured on the production build under a 4× CPU throttle, an
        // OPEN went from 51 real Paint records to 19. Both this element and
        // the scrim are mounted only while `rendered`, so the layers are
        // handed back the moment the panel unmounts — never a standing one.
        className="absolute inset-x-0 top-full z-40 mt-2 origin-top overflow-hidden rounded-xl border border-border bg-card shadow-lg outline-none will-change-[transform,opacity]"
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
            className={cn(
              // `ease` is the mock's own curve for this crossfade (MOCK 250);
              // without the utility it is Tailwind's default.
              'transition-[opacity,filter] ease-[ease]',
              atMonths && 'pointer-events-none absolute inset-x-0 top-0',
            )}
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
              {...slide.bind}
            >
              <div ref={slide.trackRef} className="relative w-full">
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
              'p-3 transition-[opacity,filter] ease-[ease]',
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

'use client'

// 売上分析 — the accepted desktop mock (ANALYTICS-MOCK-v1.html), rendered from
// props the server already resolved. Every number arrives as a formatted
// string, so this component holds no arithmetic, no clock and no data access.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: which tab is showing, which
// ranking 指標 is pressed, which table row is opened, whether the 計算式 / the
// 12か月の説明 / the 設定元 panel is open, which chart month the pointer is on,
// which mix segment is highlighted, and which step of the 画面の説明 tour the
// reader is on. Every one of them is a browsing choice.
//
// ⚖ ONE SELECTION CONCEPT ON THIS PAGE (⚖-ADJ C): the MONTH BEING VIEWED, and
// it is a URL, not state. A click on a month in the chart is a real link with
// `scroll={false}` — the same `?month=` mechanism the ◀ ▶ nav uses — so the
// tiles, the 内訳, the table's wash, ランキング and 日報 all move together and
// there is never a second, client-side "focused month" disagreeing with them.
//
// THE BOUNDARY is not a state here. A denied viewer is handed `denied` and the
// workspace is never rendered — the server decided, and there is nothing on the
// client to un-hide.

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CHART,
  clampTooltipLeft,
  clampTooltipTop,
  LEDGER_MONTHS,
  type ChartModel,
  type CompSegment,
  type RankMetric,
} from '@/business/lib/analytics'
import type { DeltaKind, NumberId } from '@/business/lib/dictionary'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import { makeSpring } from '@/business/lib/spring'

/** The hover card's box, FIXED so its clamp is arithmetic rather than a
 *  measurement pass — and so the popup law can be asserted without a browser.
 *  Kept in step with `.an-tip { width / height }` in analytics.css; that pair is
 *  the one place these two files have to agree. */
const TOOLTIP_W = 210
const TOOLTIP_H = 96

/** THE ROUTE WRAPPER. App Router keeps a segment's stylesheet in the document
 *  after a client-side navigation, so a route sheet that states a bare
 *  family-shared selector (`.panel`, `.page`) keeps restyling the room the
 *  reader walked into next. Every rule in analytics.css is scoped under this
 *  class, and this is the only node that carries it. */
const ROOT = 'page pg-analytics'

/** One ranking table per 指標, all five resolved on the server. */
export type RankingByMetric = Record<
  RankMetric,
  {
    aggregateLabel: string
    rows: Array<{
      staffId: string
      name: string
      rank: number
      aggregate: string
      gap: string | null
      months: Array<{ value: string; rank: number }>
    }>
  }
>

/** A column of the 月次内訳 table. `shed` says WHEN it leaves the grid for the
 *  row's own detail line — never whether it exists (⚖-ADJ D). */
export interface TableMetric {
  id: NumberId
  shed: 'sh1' | 'sh2' | 'always' | null
  head?: string
}

export interface TileProps {
  id: NumberId
  /** 今月の / 9月の / '' — the period, never part of the dictionary label. */
  prefix: string
  /** === `numberEntry(id).label`. A literal here would be a second home for a
   *  word the dictionary already owns. */
  label: string
  suffix: string
  scope: string
  value: string
  small: boolean
  /** `neutral` is the grey a FLAT comparison wears — a month exactly level
   *  with its comparand did not go up (L2 B2-7). */
  chip: { text: string; tone: 'up' | 'down' | 'gap' | 'neutral' } | null
  foot: string | null
  link: { href: string; label: string } | null
  /** 0–100 for the goal bar, `null` when the tile has no bar. */
  bar: number | null
  /** ⚖ Liam 8/23 — a tile that deserves its OWN step of the 画面の説明 walk
   *  declares it here, so the declaration is server-composed like every other
   *  word on the tile and the census can be read off one place. */
  guide: { title: string; text: string } | null
  calc: {
    title: string
    lines: Array<{ k: string; v: string; result: boolean }>
    notes: string[]
  } | null
}

export interface ProvRow {
  id: string
  key: string
  value: string
}

/**
 * THE SERIALIZED PAYLOAD, AND NOTHING BESIDE IT (L1 B1-4 · L2 B2-6). Every key
 * below is READ by the render — the suite pins that both ways. A prop the
 * screen does not read still crosses the wire, still carries words (the
 * retired 「目標は設定で店舗・スタッフ別に変更」 trace shipped beside its own
 * replacement), and still invites a surface to start rendering a figure the
 * page refuses to state — the target-0 world's dead payload said 「目標進捗 0%」
 * while tile 4 correctly said 目標が未設定です.
 */
export interface AnalyticsProps {
  denied: { title: string; message: string; backLabel: string; backHref: string } | null
  dateline?: string
  period?: {
    label: string
    prevHref: string | null
    prevTitle: string
    nextHref: string | null
    nextTitle: string
  }
  scopes?: Array<{ key: string; label: string; pressed: boolean; disabled: boolean; title: string }>
  exportLabel?: string
  exportRefusal?: string
  tiles?: TileProps[]
  trend?: {
    chartSub: string
    chart: ChartModel
    chartMonths: Array<{
      label: string
      partial: boolean
      asOf: string
      total: string
      nw: string
      href: string
      note: string
    }>
    gridLabels: string[]
    targetLabel: string | null
    /** ⚖ THE TWO SERIES' OWN DICTIONARY WORDS. The legend and the hover card
     *  spelled them as literals, which is the second home for a word that
     *  `dictionary.ts` exists to prevent (L1 B1-5 · L2 B2-5) — and the screen
     *  may not import the registry, so the words arrive as props like every
     *  other word on the page. */
    seriesLabels: { total: string; nw: string }
    barLabels: string[]
    labelValues: string[]
    reading: string
    decide: string
    tableSub: string
    tableLegend: string
    emptyBefore: string
    metrics: TableMetric[]
    rows: Array<{
      monthsAgo: number
      label: string
      tag: string | null
      selected: boolean
      partial: boolean
      href: string
      cells: string[]
      ticks: Array<{ kind: DeltaKind; text: string }>
    }>
    statLabel: string
    stats: Array<{ kicker: string; value: string }>
    compositionSub: string
    menuSegments: CompSegment[]
    sourceSegments: CompSegment[]
    compositionEmpty: string
    tickets: Array<{ key: string; value: string; unit: string | null }>
  }
  ranking?: {
    permission: string
    sub: string
    metrics: Array<{ key: RankMetric; label: string }>
    byMetric: RankingByMetric
    monthHeads: Array<{ short: string; tag: string | null }>
    storeNote: string
    empty: string
    ownLane: {
      title: string
      sub: string
      stats: Array<{ label: string; value: string; chip: string | null }>
      note: string
    } | null
  }
  daily?: {
    sub: string
    heads: string[]
    rows: Array<{ label: string; closed: boolean; fromBoard: boolean; cells: string[] }>
    trailing: string | null
    foot: string
    boardNote: string | null
  }
  provenance?: {
    barLabel: string
    title: string
    lead: string
    rows: ProvRow[]
    monthRow: { key: string; value: string }
    storeRow: { key: string; value: string }
    unconnectedTitle: string
    unconnected: ProvRow[]
    sample: string
  }
  guides?: Record<string, string>
}

const VIEWS = [
  { key: 'trend', label: '推移' },
  { key: 'rank', label: 'ランキング' },
  { key: 'daily', label: '日報' },
] as const
type ViewKey = (typeof VIEWS)[number]['key']

/** The four segment colours: two series colours, the third categorical slot,
 *  then a NEUTRAL その他 bucket — never a fourth hue, which would read as
 *  another named category. Data colours, not accents (R13 legal). */
const COMP_COLOR = [
  { bg: 'var(--an-blue)', fg: '#fff' },
  { bg: 'var(--an-pink)', fg: '#fff' },
  { bg: 'var(--an-amber-solid)', fg: 'var(--an-ink)' },
  { bg: 'var(--an-seg-rest)', fg: 'var(--an-ink-3)' },
]

interface TourStep {
  title: string
  text: string
  idx: number
  total: number
}

const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
})
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total

/** ⚖ THE COLLAPSE, AND IT IS THE MOCK'S OWN (`makeCollapse`). A height spring
 *  to the panel's measured `scrollHeight`, then `height: auto` AT REST so the
 *  open panel keeps growing with its own content. The FIRST run jumps rather
 *  than animating: a page that plays its collapses on load looks broken while
 *  it settles.
 *
 *  ⚠ MODULE LEVEL, AND `reduced` IS AN ARGUMENT. A hook written inside the
 *  component closes over component state that its dependency array cannot name,
 *  which is a stale closure the linter is right to refuse. */
function useCollapse(ref: React.RefObject<HTMLDivElement | null>, open: boolean, reduced: boolean) {
  const first = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (first.current) {
      first.current = false
      el.style.height = open ? 'auto' : '0px'
      return
    }
    const sp = makeSpring((v) => { el.style.height = `${v}px` }, {
      response: 0.34,
      reduced,
      onRest: () => { if (open) el.style.height = 'auto' },
    })
    sp.jump(el.getBoundingClientRect().height)
    sp.set(open ? el.scrollHeight : 0)
    return () => sp.stop()
  }, [ref, open, reduced])
}

/** THE SLIDING TAB UNDERLINE AND THE RANGE THUMB — one integrator, two users,
 *  the mock's own `response .30`. Both `jump` on layout, resize and
 *  `fonts.ready`, because a spring that animates from 0 on first paint is a page
 *  that looks like it is still loading. */
function useSlider(
  trackRef: React.RefObject<HTMLElement | null>,
  markRef: React.RefObject<HTMLElement | null>,
  selector: string,
  inset: number,
  reduced: boolean,
) {
  const state = useRef({ x: 0, w: 100 })
  const springs = useRef<{ x: ReturnType<typeof makeSpring>; w: ReturnType<typeof makeSpring> } | null>(null)
  useEffect(() => {
    const mark = markRef.current
    if (!mark) return
    const paint = () => {
      mark.style.transform = `translateX(${state.current.x}px) scaleX(${state.current.w / 100})`
    }
    const sx = makeSpring((v) => { state.current.x = v; paint() }, { response: 0.3, reduced })
    const sw = makeSpring((v) => { state.current.w = v; paint() }, { response: 0.3, reduced })
    springs.current = { x: sx, w: sw }
    const place = () => {
      const btn = trackRef.current?.querySelector<HTMLElement>(selector)
      if (!btn) return
      sx.jump(btn.offsetLeft - inset)
      sw.jump(btn.offsetWidth)
    }
    place()
    window.addEventListener('resize', place)
    if (document.fonts?.ready) void document.fonts.ready.then(place)
    return () => {
      window.removeEventListener('resize', place)
      sx.stop()
      sw.stop()
      springs.current = null
    }
  }, [trackRef, markRef, selector, inset, reduced])
  return useCallback((btn: HTMLElement) => {
    const s = springs.current
    if (!s) return
    s.x.set(btn.offsetLeft - inset)
    s.w.set(btn.offsetWidth)
  }, [inset])
}

/**
 * ONE INTERACTIVE MIX BLOCK — the stacked bar, its legend chips, and the one
 * highlight they share.
 *
 * ⚠ THE CHIP AND THE SEGMENT ARE THE SAME CONTROL. Pressing either highlights
 * the one slice and dims the rest; pressing it again clears. Two independent
 * selections would be two homes for one verdict (§A8).
 */
function MixBlock({
  label,
  segments,
  empty,
}: {
  label: string
  segments: CompSegment[]
  empty: string
}) {
  const [on, setOn] = useState<number | null>(null)
  const [tip, setTip] = useState<{ i: number; left: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const showTip = useCallback((i: number, clientX: number) => {
    const box = boxRef.current
    if (!box) return
    const r = box.getBoundingClientRect()
    setTip({ i, left: clampTooltipLeft(clientX - r.left, TOOLTIP_W, r.width) })
  }, [])

  useEffect(() => {
    if (tip === null) return
    const away = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setTip(null)
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [tip])

  if (segments.length === 0) {
    return (
      <div className="an-mixblock">
        <span className="an-mix-k">{label}</span>
        <p className="an-mix-empty">{empty}</p>
      </div>
    )
  }
  const hit = tip === null ? null : segments[tip.i]
  return (
    <div className={`an-mixblock${on === null ? '' : ' is-dim'}`} ref={boxRef} onMouseLeave={() => setTip(null)}>
      <span className="an-mix-k">{label}</span>
      <div className="an-stack">
        {segments.map((s, i) => {
          const color = COMP_COLOR[Math.min(i, COMP_COLOR.length - 1)]
          const pct = Math.round(s.share * 100)
          return (
            <button
              key={s.label}
              type="button"
              className={`an-seg-p${on === i ? ' is-on' : ''}`}
              style={{ flex: `${Math.round(s.share * 1000)} 0 0`, background: color.bg, color: color.fg }}
              aria-pressed={on === i}
              aria-label={`${s.label} ${s.amount.toLocaleString('ja-JP')}円（${pct}%）`}
              onMouseMove={(e) => showTip(i, e.clientX)}
              onPointerDown={(e) => showTip(i, e.clientX)}
              onClick={() => setOn((was) => (was === i ? null : i))}
            >
              {/* selective direct label — only where it fits without clipping */}
              {s.share >= 0.12 ? `${pct}%` : ''}
            </button>
          )
        })}
      </div>
      <div className="an-chips">
        {segments.map((s, i) => (
          <button
            key={s.label}
            type="button"
            data-press
            className={`an-chip-l${on === i ? ' is-on' : ''}`}
            aria-pressed={on === i}
            onClick={() => setOn((was) => (was === i ? null : i))}
          >
            <span className="an-sw" style={{ background: COMP_COLOR[Math.min(i, COMP_COLOR.length - 1)].bg }} />
            <span>{`${s.label} ¥${s.amount.toLocaleString('ja-JP')}（${Math.round(s.share * 100)}%）`}</span>
          </button>
        ))}
      </div>
      <div
        className={`an-tip an-tip-mix${hit ? ' is-on' : ''}`}
        role="status"
        aria-live="polite"
        style={tip ? { left: `${tip.left}px` } : undefined}
      >
        {hit && (
          <>
            <div className="an-tip-m">{hit.label}</div>
            <div className="an-tip-r">
              <span className="an-tip-k" style={{ background: COMP_COLOR[Math.min(tip!.i, COMP_COLOR.length - 1)].bg }} />
              <span className="an-tip-n">売上</span>
              <span className="an-tip-v">{`¥${hit.amount.toLocaleString('ja-JP')}`}</span>
            </div>
            <div className="an-tip-r">
              <span className="an-tip-k" style={{ background: 'transparent' }} />
              <span className="an-tip-n">構成比</span>
              <span className="an-tip-v">{`${Math.round(hit.share * 100)}%`}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function AnalyticsScreen(props: AnalyticsProps) {
  const [view, setView] = useState<ViewKey>('trend')
  const [metric, setMetric] = useState<RankMetric>('total')
  const [openRow, setOpenRow] = useState<number | null>(null)
  const [pulseFor, setPulseFor] = useState<number | null>(null)
  const [calcOpen, setCalcOpen] = useState(false)
  const [proseOpen, setProseOpen] = useState(false)
  const [fnOpen, setFnOpen] = useState(false)
  const [tip, setTip] = useState<{ index: number; left: number; top: number } | null>(null)
  const [reduced, setReduced] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const mixRef = useRef<HTMLElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLSpanElement>(null)
  const segRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const prosePanelRef = useRef<HTMLDivElement>(null)
  const fnPanelRef = useRef<HTMLDivElement>(null)
  const landRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>())
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)

  // ── 画面の説明 ────────────────────────────────────────────────────────────
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)
  const tourRectsRef = useRef<SpotRect[]>([])
  const tourOpen = tourIdx >= 0

  const hideTip = useCallback(() => setTip(null), [])

  /** Whether the reader asked for less motion. Read ONCE into state so every
   *  spring is constructed with the same answer and the server render (which
   *  has no `matchMedia` at all) never disagrees with the first client frame. */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const read = () => setReduced(mq.matches)
    read()
    mq.addEventListener('change', read)
    return () => mq.removeEventListener('change', read)
  }, [])

  // A gesture that ENDS tears its own surface down — and so does a tab change
  // that takes the chart off screen while a card is still up (leaked gesture
  // state, the class the board was corrected for).
  useEffect(() => {
    if (view !== 'trend') setTip(null)
  }, [view])

  const showTip = useCallback((index: number, target: HTMLElement) => {
    const plot = plotRef.current
    if (!plot) return
    const plotBox = plot.getBoundingClientRect()
    const hitBox = target.getBoundingClientRect()
    const center = hitBox.left - plotBox.left + hitBox.width / 2
    setTip({
      index,
      left: clampTooltipLeft(center, TOOLTIP_W, plotBox.width),
      top: clampTooltipTop(hitBox.top - plotBox.top, TOOLTIP_H, plotBox.height),
    })
  }, [])

  /** PRESS STATES ON POINTER-DOWN, one document listener for the whole room
   *  (the mock's `[data-press]`). Pointer-DOWN, not click: the feedback has to
   *  arrive while the finger is still down or it is not feedback. */
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest?.('[data-press]')
      if (t) t.classList.add('is-pressed')
    }
    const clear = () => {
      for (const el of document.querySelectorAll('[data-press].is-pressed')) el.classList.remove('is-pressed')
    }
    document.addEventListener('pointerdown', down, true)
    for (const ev of ['pointerup', 'pointercancel', 'blur', 'dragend']) window.addEventListener(ev, clear, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      for (const ev of ['pointerup', 'pointercancel', 'blur', 'dragend']) window.removeEventListener(ev, clear, true)
    }
  }, [])

  useCollapse(prosePanelRef, proseOpen, reduced)
  useCollapse(fnPanelRef, fnOpen, reduced)

  const moveLine = useSlider(tabsRef, lineRef, '.an-tab.is-on', 0, reduced)
  // ⚠ THE THUMB NEVER TRAVELS TO A REFUSED OPTION (registry ③, D-2). 月間 is the
  // only scope this world can serve, so the thumb has exactly one home and the
  // slider exists to place it correctly at every width, not to animate a lie.
  useSlider(segRef, thumbRef, '.an-seg-btn.is-on', 3, reduced)

  /** THE BARS GROW IN ONCE, staggered, from the baseline — the mock's own
   *  entrance. `useLayoutEffect` so the starting transform is written BEFORE
   *  paint: an effect that runs after paint would flash the full-height chart
   *  and then collapse it. Reduced motion skips the whole thing. */
  const grown = useRef(false)
  useLayoutEffect(() => {
    if (grown.current) return
    const svg = svgRef.current
    if (!svg) return
    grown.current = true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const bars = [...svg.querySelectorAll<SVGRectElement>('.an-bar')]
    for (const [i, r] of bars.entries()) {
      r.style.transformBox = 'fill-box'
      r.style.transformOrigin = 'bottom'
      r.style.transform = 'scaleY(0)'
      r.style.transition = `transform 520ms cubic-bezier(.22,.9,.24,1) ${Math.floor(i / 2) * 32}ms`
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const r of bars) r.style.transform = 'scaleY(1)'
      })
    })
    return () => cancelAnimationFrame(id)
  }, [])

  /** ⚖-ADJ C — AFTER THE NAVIGATION, THE ROW ANSWERS. The click set the month
   *  it asked for; when the server's new props actually carry that month, its
   *  row is brought into view and pulsed once. Nothing pulses on an ordinary
   *  page load, because nothing asked for it. */
  useEffect(() => {
    if (pulseFor === null) return
    const row = props.trend?.rows.find((r) => r.selected)
    if (!row || row.monthsAgo !== pulseFor) return
    rowRefs.current.get(pulseFor)?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
    const id = window.setTimeout(() => setPulseFor(null), 780)
    return () => window.clearTimeout(id)
  }, [pulseFor, props.trend, reduced])

  /** The 計算式 popover closes on an outside press, like every popover in the
   *  family. Hover opens it on a mouse (CSS `(hover:hover)`); this is the touch
   *  and keyboard path. */
  useEffect(() => {
    if (!calcOpen) return
    const away = (e: PointerEvent) => {
      if (!landRef.current?.contains(e.target as Node)) setCalcOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [calcOpen])

  // ── the guided tour's placement, walk and teardown ────────────────────────
  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 170 }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const at = spotCardAt(boxOf(r), size, viewport)
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) =>
      was && was.top === next.top && was.left === next.left && was.hole.top === next.hole.top && was.hole.left === next.hole.left && was.hole.width === next.hole.width && was.hole.height === next.hole.height
        ? was
        : next,
    )
  }, [tourIdx, tourTick, tourStep])

  useEffect(() => {
    if (!tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTourIdx(-1)
      if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
      if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
    }
    const bump = () => setTourTick((t) => t + 1)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', bump)
      window.removeEventListener('scroll', bump, true)
    }
  }, [tourOpen])

  const wasTourOpen = useRef(false)
  useEffect(() => {
    if (tourOpen) {
      wasTourOpen.current = true
      tourNextRef.current?.focus()
      return
    }
    if (!wasTourOpen.current) return
    wasTourOpen.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  if (props.denied) {
    return (
      <div className={ROOT}>
        <section id="boundaryPanel">
          <h1 tabIndex={-1}>{props.denied.title}</h1>
          <p className="an-denied">{props.denied.message}</p>
          <Link href={props.denied.backHref} className="an-boundary-link">
            {props.denied.backLabel}
          </Link>
        </section>
      </div>
    )
  }

  const { dateline, period, scopes, tiles, trend, ranking, daily, provenance, guides } = props
  if (!period || !scopes || !tiles || !trend || !ranking || !daily || !provenance || !guides) return null

  const rank = ranking.byMetric[metric]
  const hovered = tip === null ? null : trend.chartMonths[tip.index]
  const chart = trend.chart
  const pct = (n: number) => `${(n / CHART.w) * 100}%`

  const jumpToMix = () => {
    setView('trend')
    requestAnimationFrame(() => {
      mixRef.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    })
  }

  return (
    <div className={ROOT} ref={rootRef}>
      <div className="an-view">
        {/* ⚖ ONE COMPACT TITLE ROW (Liam F-1: 「kill the dead space」). Identity
            left, the time controls right, and the page's own sentence folded
            into the ? tour rather than spending a third line on it. */}
        <header className="an-head" data-guide-title="売上分析" data-guide={guides.head}>
          <div className="an-titlerow">
            <span className="an-eyebrow">{dateline}</span>
            <h1>売上分析</h1>
            {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, never a popover. A
                hairline circle, never a filled one (⚖ R13). */}
            <button
              className="an-help"
              type="button"
              ref={helpRef}
              title="画面の説明"
              aria-label="画面の説明"
              aria-haspopup="dialog"
              aria-expanded={tourOpen}
              aria-controls="anTour"
              onClick={() => setTourIdx(0)}
            >
              ?
            </button>
            <span className="an-sp" />
            <div className="an-mnav" role="group" aria-label="対象月">
              {/* The step that cannot act stays a FOCUSABLE control carrying its
                  reason, not a `disabled` one — a refusal nobody can reach with
                  a keyboard is a refusal that does not explain itself. */}
              {period.prevHref ? (
                <Link href={period.prevHref} className="an-arw" data-press aria-label="前の月" title={period.prevTitle}>
                  ◀
                </Link>
              ) : (
                <button type="button" className="an-arw" aria-disabled="true" aria-label="前の月" title={period.prevTitle}>
                  ◀
                </button>
              )}
              <span className="an-mv">{period.label}</span>
              {period.nextHref ? (
                <Link href={period.nextHref} className="an-arw" data-press aria-label="次の月" title={period.nextTitle}>
                  ▶
                </Link>
              ) : (
                <button type="button" className="an-arw" aria-disabled="true" aria-label="次の月" title={period.nextTitle}>
                  ▶
                </button>
              )}
            </div>
            {/* Same rule as the month step: a scope this world cannot serve is
                aria-disabled with its reason and stays reachable, rather than a
                pressable control that flips a state and renders nothing. */}
            <div className="an-seg" ref={segRef} role="group" aria-label="表示範囲">
              <span className="an-seg-thumb" ref={thumbRef} aria-hidden="true" />
              {scopes.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`an-seg-btn${s.pressed ? ' is-on' : ''}`}
                  data-press={s.disabled ? undefined : ''}
                  aria-pressed={s.pressed}
                  aria-disabled={s.disabled || undefined}
                  title={s.title}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button className="an-btn-out" type="button" disabled title={props.exportRefusal}>
              {props.exportLabel}
            </button>
          </div>
        </header>

        {/* ═══ ROW 1 — THE DECISION HEADER ═════════════════════════════════════
            ⚠ F-4 LAYER FIX, PORTED AS A RULE, NOT AS A MAGIC NUMBER. `.an-tile`
            lifts on hover, and a transform makes each tile its OWN stacking
            context — which traps the 計算式 popover inside the tile, where the
            tabs and the chart (both later in the DOM) paint straight over it.
            Raising the WHOLE ROW fixes every tile popover at once. */}
        <section className="an-kpirow" data-guide-title="いちばん上の5つの数字" data-guide={guides.kpis}>
          {tiles.map((t) => {
            const isLand = t.calc !== null || t.id === 'landing' || t.id === 'landingFinal'
            return (
              <div
                key={t.id}
                className={`an-tile${t.bar !== null || t.id === 'targetProgress' ? ' an-tile-goal' : ''}${isLand ? ' an-tile-land' : ''}${isLand && calcOpen ? ' is-open' : ''}`}
                ref={isLand ? landRef : undefined}
                data-guide-title={t.guide?.title}
                data-guide={t.guide?.text}
              >
                <div className="an-tl">
                  {t.prefix}
                  {t.label}
                  {t.suffix}
                  {t.scope && <span className="an-scope">{t.scope}</span>}
                </div>
                <div className={`an-tv${t.small ? ' is-sm' : ''}`}>{t.value}</div>
                {t.bar !== null && (
                  <div className="an-goalbar">
                    <i style={{ width: `${t.bar}%` }} />
                  </div>
                )}
                <div className="an-tf">
                  {t.chip && <span className={`an-cmp is-${t.chip.tone}`}>{t.chip.text}</span>}
                  {t.calc && (
                    <button
                      className="an-whybtn"
                      type="button"
                      data-press
                      aria-expanded={calcOpen}
                      aria-controls="anCalc"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCalcOpen((was) => !was)
                      }}
                    >
                      計算式
                    </button>
                  )}
                  {t.foot && <span>{t.foot}</span>}
                  {t.link && (
                    <Link className="an-tlink" href={t.link.href}>
                      {t.link.label}
                    </Link>
                  )}
                </div>
                {t.calc && (
                  <div className="an-calcpop" id="anCalc">
                    <h5>{t.calc.title}</h5>
                    {t.calc.lines.map((l) => (
                      <div className={`an-ln${l.result ? ' is-res' : ''}`} key={l.k}>
                        <span className="an-lk">{l.k}</span>
                        <span className="an-lv">{l.v}</span>
                      </div>
                    ))}
                    {t.calc.notes.map((n) => (
                      <p className="an-nb" key={n}>{n}</p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </section>

        <div
          className="an-tabs"
          ref={tabsRef}
          role="tablist"
          aria-label="表示の切り替え"
          data-guide-title="表示の切り替え"
          data-guide={guides.tabs}
        >
          <span className="an-tab-line" ref={lineRef} aria-hidden="true" />
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className={`an-tab${view === v.key ? ' is-on' : ''}`}
              type="button"
              role="tab"
              data-press
              id={`tab-${v.key}`}
              aria-selected={view === v.key}
              aria-controls={`view-${v.key}`}
              onClick={(e) => {
                setView(v.key)
                moveLine(e.currentTarget)
              }}
            >
              {v.label}
            </button>
          ))}
          <span className="an-sp" />
          <button className="an-brk" type="button" data-press onClick={jumpToMix}>
            内訳を見る
          </button>
        </div>

        {/* All three panels stay in the DOM and the unselected ones are
            `hidden` — a tab whose aria-controls points at a node that is not
            there announces a panel the reader cannot reach. A hidden panel also
            drops out of the tour's walk on its own (the engine's property). */}
        <section id="view-trend" role="tabpanel" aria-labelledby="tab-trend" hidden={view !== 'trend'}>
          {/* ── the chart that answers ───────────────────────────────────── */}
          <section className="an-card" data-guide-title="月次推移" data-guide={guides.chart}>
            <div className="an-chart-hd">
              <span className="an-ttl">月次推移</span>
              <span className="an-sub">{trend.chartSub}</span>
              <span className="an-scrollhint">← 横にスクロールで{LEDGER_MONTHS}か月ぶん →</span>
              <span className="an-sp" />
              <span className="an-lg"><span className="an-sw is-b" />{trend.seriesLabels.total}</span>
              <span className="an-lg"><span className="an-sw is-p" />{trend.seriesLabels.nw}</span>
              {trend.targetLabel && <span className="an-lg"><span className="an-sw is-g" />{trend.targetLabel}</span>}
              <span className="an-lg"><span className="an-sw is-h" />月の途中</span>
            </div>
            <div className="an-chart-body">
              <div className="an-chart-plot" ref={plotRef}>
                {/* ⚖-ADJ C — THE MONTH BEING VIEWED IS MARKED HERE TOO. The
                    table's row wears the selected wash and the tiles follow the
                    URL, but the chart — the surface a reader looks at FIRST —
                    showed no sign of which of the twelve columns the rest of the
                    page is about. `is-viewed` derives from the server's own
                    `selected` row and from nothing else, so this is the ONE
                    selection concept, not a second one; the dim is the mock's
                    own HOVER grammar and clears with the pointer. */}
                <svg
                  ref={svgRef}
                  className={`an-chart${tip !== null ? ' is-dim' : ''}`}
                  viewBox={`0 0 ${CHART.w} ${CHART.h}`}
                  role="img"
                  aria-label={`月次の${trend.seriesLabels.total}と${trend.seriesLabels.nw}の推移（棒グラフ、${trend.chartMonths.length}か月ぶん）`}
                >
                  <defs>
                    {/* the month in progress is HATCHED, never solid — one look
                        says「this month is not finished」without reading a word */}
                    <pattern id="anHatchB" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="6" height="6" fill="var(--an-hatch-b)" />
                      <line x1="0" y1="0" x2="0" y2="6" stroke="var(--an-blue)" strokeWidth="2.8" />
                    </pattern>
                    <pattern id="anHatchP" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="6" height="6" fill="var(--an-hatch-p)" />
                      <line x1="0" y1="0" x2="0" y2="6" stroke="var(--an-pink)" strokeWidth="2.8" />
                    </pattern>
                  </defs>
                  {chart.gridLines.map((g, i) => (
                    <g key={`grid-${g.value}`}>
                      <line
                        x1={CHART.ml}
                        x2={CHART.w - CHART.mr}
                        y1={g.y}
                        y2={g.y}
                        stroke={g.value === 0 ? 'var(--an-axis)' : 'var(--an-grid)'}
                        strokeWidth={1}
                      />
                      <text x={CHART.ml - 9} y={g.y + 4} textAnchor="end" fontSize={11} fill="var(--an-ink-4)">
                        {trend.gridLabels[i]}
                      </text>
                    </g>
                  ))}
                  {chart.targetY !== null && trend.targetLabel && (
                    <g>
                      <line
                        x1={CHART.ml}
                        x2={CHART.w - CHART.mr}
                        y1={chart.targetY}
                        y2={chart.targetY}
                        stroke="var(--an-ink-4)"
                        strokeWidth={1.6}
                        strokeDasharray="7 5"
                      />
                      <text x={CHART.w - CHART.mr} y={chart.targetY - 6} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--an-ink-3)">
                        {trend.targetLabel}
                      </text>
                    </g>
                  )}
                  {chart.bars.map((b, i) => (
                    <rect
                      key={`bar-${b.monthIndex}-${b.series}`}
                      className={`an-bar${b.partial ? ' is-part' : ''}${tip?.index === b.monthIndex ? ' is-sel' : ''}`}
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={Math.max(b.h, 0)}
                      rx={3}
                      fill={
                        b.partial
                          ? b.series === 'total' ? 'url(#anHatchB)' : 'url(#anHatchP)'
                          : b.series === 'total' ? 'var(--an-blue)' : 'var(--an-pink)'
                      }
                      stroke={b.partial ? (b.series === 'total' ? 'var(--an-blue)' : 'var(--an-pink)') : undefined}
                      strokeWidth={b.partial ? 1 : undefined}
                    >
                      <title>{trend.barLabels[i]}</title>
                    </rect>
                  ))}
                  {chart.labels.map((l, i) => (
                    <text key={`lbl-${l.monthIndex}-${l.series}`} x={l.x} y={l.y} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="var(--an-ink-2)">
                      {trend.labelValues[i]}
                    </text>
                  ))}
                  {chart.axis.map((a) => (
                    <g key={`axis-${a.short}`}>
                      <text x={a.partial ? a.x - 13 : a.x} y={chart.baselineY + 21} textAnchor="middle" fontSize={11.5} fill="var(--an-ink-3)">
                        {a.short}
                      </text>
                      {a.partial && (
                        <>
                          <rect x={a.x + 2} y={chart.baselineY + 10} width={34} height={15} rx={7.5} fill="var(--an-amber-wash)" stroke="var(--an-amber-line)" strokeWidth={1} />
                          <text x={a.x + 19} y={chart.baselineY + 21} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="var(--an-amber)">途中</text>
                        </>
                      )}
                    </g>
                  ))}
                  {/* the crosshair is drawn LAST so it rides above the bars, and
                      it never eats a pointer event */}
                  {tip !== null && (
                    <line
                      className="an-cross"
                      x1={chart.groups[tip.index].center}
                      x2={chart.groups[tip.index].center}
                      y1={chart.plotTop}
                      y2={chart.baselineY}
                      stroke="var(--an-blue)"
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                  )}
                </svg>
                {/* ⚖-ADJ C — ONE REAL LINK PER MONTH, over the whole column. A
                    month is one thing to point at, and a link is what the
                    family navigates with (D-7's own mechanism): keyboard
                    reachable, right-clickable, and `scroll={false}` so the page
                    does not jump out from under the reader. */}
                <div className="an-chart-hits">
                  {chart.groups.map((g) => {
                    const m = trend.chartMonths[g.monthIndex]
                    const viewed = trend.rows[g.monthIndex]?.selected === true
                    return (
                      <Link
                        key={`hit-${g.monthIndex}`}
                        href={m.href}
                        scroll={false}
                        className={`an-hit${viewed ? ' is-viewed' : ''}${tip?.index === g.monthIndex ? ' is-on' : ''}`}
                        aria-current={viewed ? 'true' : undefined}
                        style={{ left: pct(g.x), width: pct(g.w), height: `${(chart.baselineY / CHART.h) * 100}%` }}
                        aria-label={`${m.label} 総合売上 ${m.total}・新規売上 ${m.nw} を表示`}
                        onMouseEnter={(e) => showTip(g.monthIndex, e.currentTarget)}
                        onFocus={(e) => showTip(g.monthIndex, e.currentTarget)}
                        onPointerDown={(e) => showTip(g.monthIndex, e.currentTarget)}
                        onMouseLeave={hideTip}
                        onBlur={hideTip}
                        onClick={() => setPulseFor(trend.rows[g.monthIndex]?.monthsAgo ?? null)}
                      />
                    )
                  })}
                </div>
                <div
                  className={`an-tip${hovered ? ' is-on' : ''}`}
                  role="status"
                  aria-live="polite"
                  style={tip ? { left: `${tip.left}px`, top: `${tip.top}px` } : undefined}
                >
                  {hovered && (
                    <>
                      <div className="an-tip-m">{`${hovered.label}${hovered.asOf}`}</div>
                      <div className="an-tip-r">
                        <span className="an-tip-k" style={{ background: 'var(--an-blue)' }} />
                        <span className="an-tip-n">{trend.seriesLabels.total}</span>
                        <span className="an-tip-v">{hovered.total}</span>
                      </div>
                      <div className="an-tip-r">
                        <span className="an-tip-k" style={{ background: 'var(--an-pink)' }} />
                        <span className="an-tip-n">{trend.seriesLabels.nw}</span>
                        <span className="an-tip-v">{hovered.nw}</span>
                      </div>
                      <div className={hovered.partial ? 'an-tip-note' : 'an-tip-go'}>{hovered.note}</div>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="an-decide" data-guide-title="グラフの読み取り" data-guide={guides.decide}>
              <span>{trend.decide}</span>
              <span className="an-sp" />
              <button
                className={`an-readmore${proseOpen ? ' is-open' : ''}`}
                type="button"
                data-press
                aria-expanded={proseOpen}
                aria-controls="anProse"
                onClick={() => setProseOpen((was) => !was)}
              >
                {LEDGER_MONTHS}か月の説明を読む
                <span className="an-cv" aria-hidden="true">▾</span>
              </button>
            </div>
            <div className="an-collapse" id="anProse" ref={prosePanelRef}>
              <div className={`an-collapse-in${proseOpen ? ' is-in' : ''}`}>
                <p className="an-longprose">{trend.reading}</p>
              </div>
            </div>
          </section>

          {/* ── the table, tightened ─────────────────────────────────────── */}
          <section className="an-card" data-guide-title="店舗の月次内訳" data-guide={guides.table}>
            <div className="an-tb-hd">
              <span className="an-ttl">店舗の月次内訳</span>
              <span className="an-sub">{trend.tableSub}</span>
              <span className="an-sp" />
              <span className="an-leg">
                {trend.tableLegend}
                {/* ⚠ shown ONLY at ≤799, where every row IS a card — the mock's
                    own word for it, and the accurate one for this band. */}
                <span className="an-tapmore">・カードをタップすると全項目が開きます</span>
              </span>
            </div>
            <div className="an-tbl">
              <table className="an-table" role="table">
                <thead role="rowgroup" className="an-thead">
                  <tr className="an-trow an-trow-head" role="row">
                    <th role="columnheader" scope="col">対象月</th>
                    {trend.metrics.map((c) => (
                      <th
                        key={c.id}
                        role="columnheader"
                        scope="col"
                        className={`an-rt${c.shed ? ` an-${c.shed}` : ''}`}
                      >
                        {c.head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  <tr className="an-tnote" role="row">
                    <td role="cell" colSpan={trend.metrics.length + 1}>{trend.emptyBefore}</td>
                  </tr>
                  {trend.rows.map((r) => (
                    <tr
                      key={r.monthsAgo}
                      role="row"
                      ref={(el) => {
                        if (el) rowRefs.current.set(r.monthsAgo, el)
                        else rowRefs.current.delete(r.monthsAgo)
                      }}
                      className={`an-trow an-trow-body${r.partial ? ' is-partial' : ''}${r.selected ? ' is-sel' : ''}${openRow === r.monthsAgo ? ' is-open' : ''}${pulseFor === r.monthsAgo && r.selected ? ' is-pulse' : ''}`}
                      onClick={() => setOpenRow((was) => (was === r.monthsAgo ? null : r.monthsAgo))}
                    >
                      <td role="cell" className="an-mo">
                        {r.label}
                        {r.partial && <span className="an-pill-part">途中</span>}
                        {r.tag && <span className="an-asof">{r.tag}</span>}
                      </td>
                      {trend.metrics.map((c, i) => (
                        <td
                          key={c.id}
                          role="cell"
                          data-k={c.head}
                          className={`an-cell${c.shed ? ` an-${c.shed}` : ''}`}
                        >
                          <span className="an-v">{r.cells[i]}</span>
                          <span className={`an-d is-${r.ticks[i].kind}`}>{r.ticks[i].text}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {/* ⚖ THE TOTALS STICK TO THE VIEWPORT, not to an inner scroller
                    — there is none (⚖ PAGE-SCROLL). A sticky `<tfoot>` is the
                    honest shape: the row belongs to the table it totals. */}
                <tfoot role="rowgroup" className="an-ttot">
                  <tr role="row">
                    <td role="cell" colSpan={trend.metrics.length + 1} className="an-lb">{trend.statLabel}</td>
                  </tr>
                  <tr className="an-trow an-trow-tot" role="row">
                    <td role="cell" aria-hidden="true" />
                    {trend.metrics.map((c, i) => (
                      <td key={c.id} role="cell" data-k={c.head} className={`an-cell${c.shed ? ` an-${c.shed}` : ''}`}>
                        <span className="an-v">
                          <span className="an-k">{trend.stats[i].kicker}</span>
                          {trend.stats[i].value}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── 売上の内訳 ───────────────────────────────────────────────── */}
          <section className="an-card" ref={mixRef} data-guide-title="売上の内訳" data-guide={guides.mix}>
            <div className="an-mix-hd">
              <span className="an-ttl">売上の内訳</span>
              <span className="an-sub">{trend.compositionSub}</span>
            </div>
            <MixBlock label="メニュー別（上位3 + その他）" segments={trend.menuSegments} empty={trend.compositionEmpty} />
            <MixBlock label="予約経路別" segments={trend.sourceSegments} empty={trend.compositionEmpty} />
            {/* ⚖ TYPE TIER 1 — the 回数券 chips render only where the world
                shows a ticket signal. A shop that does not sell them gets
                nothing here, never a 「回数券なし」 chip (registry ⑦). */}
            {trend.tickets.length > 0 && (
              <div className="an-tickets" data-guide-title="回数券" data-guide={guides.tickets}>
                {/* THE GROUP'S NAME, not a metric's — so the second chip's own
                    dictionary word (消化売上) still says what the money is.
                    A group heading is the one literal allowed here. */}
                <span className="an-mix-k">回数券</span>
                {trend.tickets.map((t) => (
                  <div className="an-stat-chip" key={t.key}>
                    <span className="an-k">{t.key}</span>
                    <span className="an-v">{t.value}</span>
                    {t.unit && <span className="an-u">{t.unit}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>

        <section id="view-rank" role="tabpanel" aria-labelledby="tab-rank" hidden={view !== 'rank'}>
          <div className="an-card" data-guide-title="スタッフランキング" data-guide={guides.ranking}>
            <div className="an-permission"><strong>表示範囲</strong> — {ranking.permission}</div>
            <div className="an-panel-head">
              <div>
                <strong>スタッフランキング</strong>
                <span>{ranking.sub}</span>
              </div>
              <div className="an-metric-seg" role="group" aria-label="ランキング指標">
                {ranking.metrics.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    data-press
                    aria-pressed={metric === m.key}
                    onClick={() => setMetric(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {rank.rows.length === 0 ? (
              <p className="an-rank-empty">{ranking.empty}</p>
            ) : (
              <div className="an-table-scroll">
                <table className="an-rank-table">
                  <thead>
                    <tr>
                      <th>順位</th>
                      <th>スタッフ</th>
                      <th>{rank.aggregateLabel}</th>
                      <th>上位との差</th>
                      {ranking.monthHeads.map((h) => (
                        <th key={h.short}>
                          {h.short}
                          {h.tag && <span className="an-month-tag">{h.tag}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rank.rows.map((r) => (
                      <tr key={r.staffId}>
                        <td><span className={`an-rank-cell${r.rank === 1 ? ' is-r1' : ''}`}>{r.rank}</span></td>
                        <td>{r.name}</td>
                        <td>{r.aggregate}</td>
                        <td>{r.gap === null ? <span className="an-gap-leader">首位</span> : r.gap}</td>
                        {r.months.map((c, i) => (
                          <td key={ranking.monthHeads[i].short}>
                            {c.rank <= 3 && <span className={`an-month-badge is-b${c.rank}`}>{c.rank}</span>}
                            {c.value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="an-store-rank-note">{ranking.storeNote}</div>
            {ranking.ownLane && (
              <div className="an-own-lane">
                <strong>{ranking.ownLane.title}</strong>
                <p className="an-own-lane-sub">{ranking.ownLane.sub}</p>
                <div className="an-own-lane-stats">
                  {ranking.ownLane.stats.map((s) => (
                    <div className="an-own-lane-stat" key={s.label}>
                      <span>{s.label}</span>
                      <b>
                        {s.value}
                        {s.chip && <i>{s.chip}</i>}
                      </b>
                    </div>
                  ))}
                </div>
                <p className="an-own-lane-note">{ranking.ownLane.note}</p>
              </div>
            )}
          </div>
        </section>

        <section id="view-daily" role="tabpanel" aria-labelledby="tab-daily" hidden={view !== 'daily'}>
          <div className="an-card" data-guide-title="日報" data-guide={guides.daily}>
            <div className="an-panel-head">
              <div>
                <strong>日報</strong>
                <span>{daily.sub}</span>
              </div>
            </div>
            <div className="an-table-scroll">
              <table className="an-daily-table">
                <thead>
                  <tr>
                    {daily.heads.map((h) => (<th key={h}>{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {daily.rows.map((r) => (
                    r.closed ? (
                      <tr className="an-quiet-row" key={r.label}>
                        <td>{r.label}</td>
                        <td colSpan={daily.heads.length - 1}>定休日</td>
                      </tr>
                    ) : (
                      <tr key={r.label} className={r.fromBoard ? 'an-board-row' : undefined}>
                        <td>
                          {r.label}
                          {r.fromBoard && <span className="an-month-tag">本日</span>}
                        </td>
                        {r.cells.map((c, i) => (<td key={daily.heads[i + 1]}>{c}</td>))}
                      </tr>
                    )
                  ))}
                  {daily.trailing && (
                    <tr className="an-quiet-row"><td colSpan={daily.heads.length}>{daily.trailing}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="an-panel-foot">
              {daily.foot}
              {daily.boardNote && (
                <>
                  <br />
                  {daily.boardNote}
                </>
              )}
            </div>
          </div>
        </section>

        {/* ── the provenance disclosure ────────────────────────────────────
            ⚖-ADJ F — IT OPENS DOWNWARD, IN FLOW. The mock's absolute upward
            sheet is an overlay in a page-scroll world: one more floating layer
            to keep above everything else (the F-4 class), and a panel that
            covers the content it is explaining. A height spring, in flow, costs
            neither. */}
        <div className={`an-footnote${fnOpen ? ' is-open' : ''}`} data-guide-title="値の設定元" data-guide={guides.footnote}>
          <button
            className="an-fn-bar"
            type="button"
            data-press
            aria-expanded={fnOpen}
            aria-controls="anFn"
            onClick={() => setFnOpen((was) => !was)}
          >
            <span className="an-fn-i" aria-hidden="true">i</span>
            {provenance.barLabel}
            <span className="an-sp" />
            <span className="an-cv" aria-hidden="true">▾</span>
          </button>
          <div className="an-collapse" id="anFn" ref={fnPanelRef}>
            <div className={`an-collapse-in${fnOpen ? ' is-in' : ''}`}>
              <div className="an-fn-body">
                <h4>{provenance.title}</h4>
                <p className="an-lead">{provenance.lead}</p>
                {/* ⚖ §3 — EVERY ROW IS GENERATED. The 「すべての金額」 pair was
                    hand-written JSX sitting first in this grid, which is the one
                    shape the pin forbids and the one neither the suite nor the
                    mutant could see (L2 B2-3). Its sentence is the panel's lead
                    now; the grid is entries, then the month and store the render
                    was scoped to, both of them props. */}
                <div className="an-prov">
                  {provenance.rows.map((r) => (
                    <Fragment key={r.id}>
                      <div className="an-prov-k">{r.key}</div>
                      <div className="an-prov-v">{r.value}</div>
                    </Fragment>
                  ))}
                  <div className="an-prov-k">{provenance.monthRow.key}</div>
                  <div className="an-prov-v">{provenance.monthRow.value}</div>
                  <div className="an-prov-k">{provenance.storeRow.key}</div>
                  <div className="an-prov-v">{provenance.storeRow.value}</div>
                </div>
                <h5 className="an-unconn-t">{provenance.unconnectedTitle}</h5>
                <div className="an-prov an-prov-unconn">
                  {provenance.unconnected.map((r) => (
                    <Fragment key={r.id}>
                      <div className="an-prov-k">{r.key}</div>
                      <div className="an-prov-v">{r.value}</div>
                    </Fragment>
                  ))}
                </div>
                <div className="an-samplenote">{provenance.sample}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the family's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. The hole is one big
          box-shadow rather than a moved element, so the region stays fully lit
          and nothing is re-laid-out to explain it — and no layer owns a
          scroller, so the ⚖ page-scroll ruling is untouched. They are siblings
          of `.an-view` on purpose: that wrapper is a container query root, whose
          `contain: layout` would otherwise make it the containing block for
          every `position: fixed` layer here. */}
      {tourOpen && (
        <>
          <div
            className="an-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourIdx(hit >= 0 ? hit : -1)
            }}
            onMouseMove={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourHover(hit >= 0 && hit !== tourStep?.idx ? tourRectsRef.current[hit] : null)
            }}
          />
          {tourHover && (
            <div
              className="an-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="an-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="an-spot-card"
            id="anTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="an-spot-text">{tourStep?.text ?? ''}</span>
            <div className="an-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="an-spot-foot">
              <button type="button" className="an-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="an-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="an-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="an-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

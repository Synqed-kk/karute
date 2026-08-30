'use client'

// カルテ — the computer door onto the phone app's records, rendered from props
// the server already resolved. ⚖ Liam 8/30 D2: THE LIST IS A FULL-PAGE SEARCH
// TABLE, canon's own (MOCK-karute-list.html) — never squeezed into a 380px queue
// column beside a detail, which is the one shape that ruling names. So the room
// shows ONE SCREEN AT A TIME at every width, exactly as canon's two pages do: the
// table, or the record, with ← カルテ一覧 between them. The 受信トレイ template's
// grammar applies to everything else — the head, the quiet filters,
// counters-as-filters, facts left / evidence right inside the record, full-width
// history beneath, the designed empty states, the ? tour and the full ladder.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: the search box, which staff scope
// and which state filter are pressed, how many windows back the walk has gone,
// which record is open, whether the reassign warning is disclosed, and which step
// of the 画面の説明 tour the reader is on. Every one is pure browsing — none of
// them writes anything. Every control canon has that WOULD write ships refused
// with its own reason, so there is no staged state for a provider to hold above
// this component. Stated rather than assumed: if any of them is ever connected,
// its staged result belongs above this component, not inside it (flag 30's class).
//
// CLASS NAMES ARE PREFIXED `kr-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and 今日の
// 運営 / 顧客 / 予約一覧 / 売上分析 / スタッフ・シフト / 受信トレイ / 売上・レジ all
// state BARE `.biz .<name>` rules on names canon's カルテ pages use (`.panel`,
// `.fact`, `.empty`, `.filters`, `.summary`, `.identity`, `.history-row`,
// `.spot-card`…). A fence that has to enumerate sixty shared names rots as the
// neighbours grow; not colliding at all cannot. `page` / `h1` / `btn` are the
// SHELL's and restated here, so those three are fenced in karute.css at four
// levels; `pill` is also the shell's, but this sheet never restates a property
// on it, so there is nothing here to collide.

import Link from 'next/link'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import {
  keepCardOffHeading,
  matchesFilter,
  matchesReveal,
  matchesSearch,
  windowRows,
  type RecordFilter,
  type RecordState,
} from '@/business/lib/karute'

/** THE ROUTE WRAPPER. Every rule in karute.css is scoped under this class, so
 *  nothing this sheet says can reach another room; `.page.pg-karute` (four
 *  levels) rather than `.pg-karute` (three) so a sibling's own three-level rule
 *  (`.biz .page .btn`, customers.css:23) cannot win the room back on insertion
 *  order. */
const ROOT = 'page pg-karute'

export interface KaruteEntryProps {
  label: string
  text: string
  handwritten: boolean
}

export interface KaruteRowProps {
  id: string
  customerId: string
  customerName: string
  furigana: string | null
  memberNumber: string
  mark: string
  staffId: string | null
  staffName: string
  service: string
  bookingNo: string
  /** jstDayKey — the window walk's axis, compared and never formatted here. */
  dayKey: number
  thisWeek: boolean
  state: RecordState
  stateLabel: string
  statePill: string
  dateLabel: string
  dateLongLabel: string
  timeLabel: string
  preview: string | null
  previewFallback: string
  entries: KaruteEntryProps[]
  summaryBullets: string[]
  summaryEdited: boolean
  history: Array<{ when: string; what: string; detail: string }>
  photos: Array<{ category: string; caption: string }>
  /** `null` when the reader's own permission emptied the photo array — a count
   *  they made zero is omitted, never printed as 0 (F-K14). */
  photoCountLabel: string | null
  aiMessage: string | null
  recordingLine: string
  consentLabel: string | null
  outcomeLabel: string
  outcomePill: string
  outcomeNote: string | null
  ticketLine: string | null
  discard: { whenLabel: string; by: string; reason: string | null; ticketNote: string | null } | null
  visitLabel: string
  lastVisitLabel: string | null
  customersHref: string
}

export interface KaruteRevealProps {
  customerId: string
  name: string
  furigana: string | null
  memberNumber: string
  mark: string
  customersHref: string
}

export interface KaruteProps {
  dateline: string
  lensLabel: string
  subtitle: string
  filters: Array<{ key: RecordFilter; label: string }>
  selfStaffId: string | null
  selfLabel: string
  rows: KaruteRowProps[]
  reveals: KaruteRevealProps[]
  monthLabel: string
  noticeLines: string[]
  canReassign: boolean
  actionFootnote: string
  refusals: {
    entry: string
    summary: string
    regenerate: string
    message: string
    send: string
    outcome: string
    reassign: string
    photo: string
  }
}

/** ⚖ Liam 8/23 — 画面の説明. The board's own tour helpers, carried at the same
 *  shape: a rect literal the engine understands, and two identity guards that
 *  keep the measuring effect from re-rendering itself forever. */
const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total

const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

/** ⚖ 顧客一覧 — ONE label and ONE href source, read by every place this room
 *  points at the person: the record's name, and the reveal row. Two spellings
 *  would let one of them describe a different destination from the other (A8). */
const CUSTOMERS_LABEL = '顧客一覧で確認'

/** カルテの顧客変更's warning, in the phone app's OWN words (messages/ja.json
 *  karuteDetail.reassign.disclaimerBody1 / Body2 / auditNote). The flow is one
 *  flow across two doors, so the sentence a staffer reads before re-pointing a
 *  record must not be two different sentences on two screens. */
const REASSIGN_WARNING = [
  'このカルテ（施術記録）を、別のお客様に付け替えます。',
  '誤って別のお客様に保存してしまった場合の修正専用です。',
  'この操作は監査ログに記録されます。',
]

export function KaruteScreen(props: KaruteProps) {
  const [scope, setScope] = useState<'all' | 'self'>('all')
  const [filter, setFilter] = useState<RecordFilter>('all')
  const [query, setQuery] = useState('')
  // ⚖ CHUNK-LOADING (packet §7b-1). How many 14-day windows back the walk has
  // gone. View state: it changes what is on screen and writes nothing.
  const [steps, setSteps] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [reassignOpen, setReassignOpen] = useState(false)
  // ⚖ Liam 8/23 — 画面の説明. The step the tour is on, `-1` when it is closed.
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  // The record view's focus handover. `openedFrom` is the row the reader
  // pressed, so ← can put focus back exactly where it came from.
  const backRef = useRef<HTMLButtonElement>(null)
  const openedFrom = useRef<string | null>(null)

  // The tour's own nodes: the room root it walks, the ? it came from and goes
  // back to, the card it measures, and the 次へ it hands the keyboard.
  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)

  // ── the narrowing, in the order the reader thinks about it ────────────────
  // 担当 → 検索 → 状態 → how far back. Every step uses the SAME predicate the
  // counts below are computed with, which is what makes ⚖ the pill/count law
  // true by construction rather than by discipline.
  const scoped = useMemo(
    () => (scope === 'self' ? props.rows.filter((r) => r.staffId === props.selfStaffId) : props.rows),
    [props.rows, props.selfStaffId, scope],
  )
  const searched = useMemo(() => scoped.filter((r) => matchesSearch(r, query)), [scoped, query])
  const matched = useMemo(() => searched.filter((r) => matchesFilter(r, filter)), [searched, filter])
  /** ⚠ A SEARCH OPENS THE WALK (F-K10). The window is a recent-stretch read —
   *  the right shape for browsing, and the wrong one for a lookup: typing a
   *  customer's name showed their newest record and hid the rest behind
   *  さらに表示 (「見本 いつき」 matched 2, showed 1). Canon's pager never hid a
   *  search result. Filters and scope alone keep the windowed walk, because
   *  those ARE browsing. */
  const searching = query.trim() !== ''
  const walk = useMemo(
    () => (searching ? { visible: matched, hidden: 0, cutoff: null } : windowRows(matched, steps)),
    [matched, steps, searching],
  )
  const visible = walk.visible

  /** ⚖ THE PILL/COUNT LAW (packet §7b-3): a count beside a tappable filter shows
   *  EXACTLY what the tap reveals. Each count is the row set with THIS axis
   *  changed and every other axis left where the reader has it, which is what
   *  pressing the chip actually does — so a counter can never name a number its
   *  own press does not produce. What the walk is still holding back is named
   *  separately, in the head's 表示中 line, never hidden inside these figures. */
  const filterCounts = useMemo(
    () => new Map(props.filters.map((f) => [f.key, searched.filter((r) => matchesFilter(r, f.key)).length])),
    [props.filters, searched],
  )
  const scopeCounts = useMemo(() => {
    const pass = (r: KaruteRowProps) => matchesSearch(r, query) && matchesFilter(r, filter)
    return {
      all: props.rows.filter(pass).length,
      self: props.rows.filter((r) => r.staffId === props.selfStaffId && pass(r)).length,
    }
  }, [props.rows, props.selfStaffId, query, filter])

  /** The quiet reveal — ONE row, and only while the reader is searching. A
   *  records page shows records (⚖ §7a), so a customer with none is not a row
   *  in the table; the one case the standing section was really for is somebody
   *  typing a name and needing to know whether the person exists at all. */
  const revealed = useMemo(
    () => props.reveals.filter((c) => matchesReveal(c, query)),
    [props.reveals, query],
  )

  const current = props.rows.find((r) => r.id === selected) ?? null
  const detailOpen = current !== null

  // ⚖ THE SWAP MUST NOT STRAND THE READER. Opening a record hides the table —
  // including the row that was focused — and going back hides the record, so in
  // both directions the browser would drop focus to <body> and a keyboard reader
  // would restart from the top of the document. Focus is therefore MOVED with
  // the screen: into the ← control on open, back onto the row that opened it on
  // close. This room swaps at EVERY width (D2's one-screen-at-a-time), so unlike
  // the 受信トレイ there is no band to test for — the swap is always in effect.
  useEffect(() => {
    if (detailOpen) {
      backRef.current?.focus()
      return
    }
    const row = openedFrom.current
    openedFrom.current = null
    if (row) document.getElementById(row)?.focus()
  }, [detailOpen])

  // A record that the current narrowing no longer shows must not stay open
  // behind it: going back would land the reader on a table that does not
  // contain what they were just reading (⚖ A10 — a surface lying about state).
  useEffect(() => {
    if (selected !== null && !matched.some((r) => r.id === selected)) setSelected(null)
  }, [matched, selected])

  // The warning belongs to the record it was opened on. Opening another record
  // with a disclosed warning still up would show one record's warning over
  // another record's identity.
  useEffect(() => { setReassignOpen(false) }, [selected])

  /** Narrowing the list starts the walk again. A reader who filters to 下書き
   *  and finds three windows already open is being shown a span they asked
   *  nothing about; every press of a filter is a fresh question. */
  const narrow = (next: () => void) => { next(); setSteps(1) }

  const clearFilters = () => {
    setScope('all')
    setFilter('all')
    setQuery('')
    setSteps(1)
  }

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────

  /** THE ROOM'S TOUR, on the family's shared engine (`@/business/lib/guide`).
   *  A section joins the walk by DECLARING `data-guide-title` + `data-guide` ON
   *  ITSELF, so there is no list to keep in sync: a section that renders is a
   *  section that is explained, and one that is not on screen — the whole table
   *  while a record is open, the record while the table is, the reveal row when
   *  nobody is searching, the 破棄 banner on an ordinary record — drops out of
   *  the walk and out of the N/M count by itself. That is Liam's "when I add a
   *  function it should automatically pick it up", and it is why the room's gate
   *  is a census of what the DOM declares rather than a table anyone maintains.
   *
   *  The walk is scoped to the ROOM's own root rather than the document: the
   *  shell's rail and topbar are not this page. */
  const tourRectsRef = useRef<SpotRect[]>([])
  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    // A step off screen is scrolled to before it is measured, or the spotlight
    // would cut its hole in empty space. The PAGE scrolls, which is the room's
    // ruling — the overlay adds no scroller of its own (⚖ page-scroll).
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    // BOTH writes are identity-guarded, and `tourStep` is its own dependency:
    // the effect runs a second time ONLY so the card can be measured carrying
    // this step's real text, and a fresh object every pass would be an infinite
    // render loop.
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 160 }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    // The engine's answer, then this room's correction for the one shape it
    // cannot place: a full-width section taller than the viewport, where the
    // last-resort clamp puts the card over its own heading (F-K5).
    const at = keepCardOffHeading(spotCardAt(boxOf(r), size, viewport), size, boxOf(r), viewport)
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  // ONE keyboard listener for the two things that can be open, innermost first:
  // while the tour is up it owns Escape (and the arrows walk the ring), and only
  // once it is closed does Escape reach the open record. Two listeners would
  // both fire on one Escape and close both at once. Bound only while something
  // IS open, and removed with it.
  useEffect(() => {
    if (!detailOpen && !tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (tourOpen) {
        if (e.key === 'Escape') setTourIdx(-1)
        if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
        if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
        return
      }
      if (e.key === 'Escape') setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [detailOpen, tourOpen])

  // The hole is drawn in viewport coordinates, so anything that moves the page
  // under it — a scroll, a resize, the ≤743 band arriving — has to re-measure.
  useEffect(() => {
    if (!tourOpen) return
    const bump = () => setTourTick((t) => t + 1)
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    return () => {
      window.removeEventListener('resize', bump)
      window.removeEventListener('scroll', bump, true)
    }
  }, [tourOpen])

  // ⚖ THE KEYBOARD MUST NOT BE STRANDED BY THE TOUR. Opening it puts focus on
  // 次へ, so Enter walks the ring exactly as the arrows do; closing it puts
  // focus back on the ? it came from, rather than dropping the reader at the top
  // of the document. `wasOpen` is what keeps the close half from firing on the
  // first render, when nothing was open and nothing should move.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (tourOpen) {
      wasOpen.current = true
      tourNextRef.current?.focus()
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  const footnoteId = current ? `krFootnote-${current.id}` : undefined

  /** A refused control, spelled ONCE. `aria-disabled` rather than `disabled`:
   *  the control stays focusable so its reason is reachable by keyboard and
   *  screen reader — the shell's own standing-hint treatment, one step better.
   *  The reason rides the ACCESSIBLE NAME as well as the title, because a
   *  screen reader drops `title` once `aria-describedby` is present.
   *
   *  ⚠ THE CLASSES ARE MERGED HERE, and a call site must never write `className`
   *  after this spread. It used to: both ✎ pencils wrote `className="kr-pencil"`
   *  after `{...refused(...)}`, the later JSX prop won, and `.btn` never reached
   *  the DOM — so the room's most-repeated refusal was the ONLY one that did not
   *  look refused (measured: `cursor: pointer` on a refused control, no dim, no
   *  border, UA `ButtonFace`, and the amber "a person rewrote this" pencil
   *  painting a border-color onto a border that did not exist). Fixed at the
   *  helper so it cannot recur (F-K1). */
  const refused = (
    label: string,
    reason: string,
    extra?: { className?: string; 'aria-describedby'?: string },
  ) => {
    const { className, ...rest } = extra ?? {}
    return {
      type: 'button' as const,
      'aria-disabled': 'true' as const,
      title: reason,
      'aria-label': `${label} — ${reason}`,
      ...rest,
      // LAST, and after the spread: a caller passes its classes IN, and cannot
      // write `className` over the merge afterwards.
      className: ['btn', className].filter(Boolean).join(' '),
    }
  }

  return (
    <div className={`${ROOT}${detailOpen ? ' is-detail' : ''}`} ref={rootRef}>
      {/* STEP 0. The head declares itself like every other section, so the walk
          opens on what this page is FOR before it starts pointing at parts of
          it — which is where the standing explainer paragraph went. */}
      <header
        className="kr-head"
        data-guide-title="カルテ"
        data-guide="この店舗で行った施術の記録が、新しい順に並ぶ画面です。カルテはスマホのアプリで施術中に作られ、この画面はそれを読み返すためのものです。行を選ぶと1件の中身が開きます。"
      >
        <div className="kr-eyebrow">{props.dateline}</div>
        <div className="kr-titleline">
          <h1>カルテ</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one 今日の運営
              has: a spotlight walk of everything on this screen, and during the
              walk you can tap any part of the page to jump straight to what it
              is. A hairline circle, never a filled one (⚖ R13). */}
          <button
            className="kr-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="krTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
        </div>
        <p className="kr-subtitle">{props.subtitle}</p>
        {/* ⚖ THE HONEST STATUS LINE (§7a) + ⚖ self-explaining numbers: three
            labelled facts, each saying WHAT it counts — the store's real month
            census, how many records the current narrowing matches, and how many
            of those the walk has actually put on screen.
            ⚠ 条件に一致 IS THERE BECAUSE TWO NUMBERS WERE NOT ENOUGH. 「今月 30件・
            表示中 200件」 is what the 200-record world printed on the first probe
            run: both figures were true, and side by side they read as a
            contradiction, because 今月 is a MONTH and 表示中 is a LIST. The
            middle number is what 表示中 is a fraction OF, so the pair stops
            inviting a comparison it was never making.
            It is `matched.length` — the SAME call the pressed chip's own count
            reads, rendered twice rather than counted twice (⚖ A8). */}
        <p className="kr-status" role="status" aria-live="polite">
          {props.monthLabel}・条件に一致 {matched.length}件・表示中 {visible.length}件
        </p>
      </header>

      {props.noticeLines.length > 0 && (
        <section
          className="kr-notice"
          aria-label="この画面の見え方"
          data-guide-title="この画面の見え方"
          data-guide="この画面で見えるもの・見えないものの説明です。文字起こしの扱いは店舗の設定で決まり、破棄されたカルテの中身は店舗管理者だけが確認できます。"
        >
          {props.noticeLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      )}

      {/* ═══ THE TABLE — one screen at a time (⚖ D2) ═══ */}
      <div className="kr-list-view">
        <section
          className="kr-scope"
          aria-label="担当でしぼる"
          data-guide-title="担当でしぼる"
          data-guide="自分が担当したカルテだけに絞り込めます。数字はそのまま件数で、押すと表がその件数ぶんに切り替わります。"
        >
          <span className="kr-label">担当</span>
          <div className="kr-chips" role="group" aria-label="担当でしぼる">
            <button
              className="kr-chip"
              type="button"
              aria-pressed={scope === 'all'}
              onClick={() => narrow(() => setScope('all'))}
            >
              全スタッフ <b>{scopeCounts.all}</b>件
            </button>
            <button
              className="kr-chip"
              type="button"
              aria-pressed={scope === 'self'}
              onClick={() => narrow(() => setScope('self'))}
            >
              {props.selfLabel} <b>{scopeCounts.self}</b>件
            </button>
          </div>
        </section>

        <section
          className="kr-search"
          aria-label="カルテを探す"
          data-guide-title="カルテを探す"
          data-guide="顧客名・かな・顧客番号・カルテ番号・サービス・スタッフの6つで探せます。ひらがなでもカタカナでも、番号のハイフンがあってもなくても同じように見つかります。記録の中身は検索の対象ではありません。"
        >
          <input
            type="search"
            className="kr-input"
            value={query}
            placeholder="顧客名・かな・顧客番号・カルテ番号・サービス・スタッフで検索"
            aria-label="顧客名・かな・顧客番号・カルテ番号・サービス・スタッフで検索"
            onChange={(e) => narrow(() => setQuery(e.target.value))}
          />
          <button className="btn" type="button" onClick={clearFilters}>
            条件をクリア
          </button>
        </section>

        {/* QUIET TEXT, not buttons: a filter narrows a view, it does not act, so
            it gets no border and no fill — selected is an accent label plus a
            2px accent underline. The strip wraps rather than panning, so no
            container here owns an axis at all (⚖ page-scroll). */}
        <section
          className="kr-filters"
          aria-label="状態でしぼる"
          data-guide-title="状態でしぼる"
          data-guide="カルテの状態で絞り込む行です。件数はそのまま、押したときに表に出る件数と同じです。今週は月曜はじまりの今週ぶんを指します。"
        >
          <span className="kr-label">状態</span>
          <div className="kr-chips" role="group" aria-label="状態でしぼる">
            {props.filters.map((f) => (
              <button
                key={f.key}
                className="kr-filter"
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => narrow(() => setFilter(f.key))}
              >
                {f.label} <b>{filterCounts.get(f.key) ?? 0}</b>件
              </button>
            ))}
          </div>
        </section>

        {props.rows.length === 0 ? (
          <section
            className="kr-zero"
            aria-label="カルテがありません"
            data-guide-title="カルテがありません"
            data-guide="この店舗にはまだ1件もカルテがありません。カルテはスマホのアプリで施術中に作られ、保存されるとこの一覧に並びます。"
          >
            <div className="kr-zero-card">
              <strong>この店舗のカルテはまだありません</strong>
              <p>カルテはスマホのアプリで施術中に作られます。保存されると、新しい順にここへ並びます。</p>
            </div>
          </section>
        ) : (
          <section
            className="kr-table-sec"
            aria-labelledby="krTableTitle"
            data-guide-title="カルテの一覧"
            data-guide="施術の記録が新しい順に並びます。日付・お客様・状態・サービス・担当の5列で、行を押すとその1件が開きます。破棄されたカルテも灰色のまま残ります — 記録を消さないことが、この一覧の役目です。"
          >
            <h2 className="kr-sec-title" id="krTableTitle">
              カルテの一覧
            </h2>
            {/* ⚖ THE PAGE OWNS EVERY AXIS (page-scroll law). No height cap and no
                overflow of any kind anywhere in this room — the five columns are
                minmax()-based and WRAP rather than pan, which is what the room's
                own ladder measured (deviation K-9: the pan the packet asked for
                engaged by 4px in the tightest reachable state, so it is gone
                rather than shipped as a lever nobody can operate). */}
            <div className="kr-table">
                {/* Column names for a sighted reader. `aria-hidden` because the
                    rows are BUTTONS rather than table cells: a screen reader
                    reads each row as one item, and each row's accessible name
                    spells these same five facts in this same order — so the
                    header would be read twice, once as a promise the row
                    structure does not keep. */}
                <div className="kr-thead" aria-hidden="true">
                  <span>日付</span>
                  <span>お客様</span>
                  <span>状態</span>
                  <span>サービス</span>
                  <span>担当</span>
                </div>
                {visible.length === 0 ? (
                  <div className="kr-empty">
                    <strong>条件に一致するカルテがありません</strong>
                    <span>検索語や絞り込みを見直してください。</span>
                    <button className="btn" type="button" onClick={clearFilters}>
                      条件をクリア
                    </button>
                  </div>
                ) : (
                  visible.map((r) => (
                    <button
                      key={r.id}
                      // The row's id is how ← finds its way back to it: the row
                      // is gone from the screen by the time focus has to return,
                      // so the reference has to survive the swap.
                      id={`krRow-${r.id}`}
                      type="button"
                      className={`kr-row${r.state === 'discarded' ? ' is-discarded' : ''}`}
                      aria-label={`${r.dateLabel} ${r.customerName}様 ${r.stateLabel} ${r.service} 担当 ${r.staffName} — カルテを開く`}
                      onClick={() => {
                        openedFrom.current = `krRow-${r.id}`
                        setSelected(r.id)
                      }}
                    >
                      <span className="kr-c-date">{r.dateLabel}</span>
                      <span className="kr-c-cust">
                        <span className={`kr-mark${r.mark.length > 2 ? ' long' : ''}`} aria-hidden="true">{r.mark}</span>
                        <span className="kr-cust-text">
                          <span className="kr-name">{r.customerName}様</span>
                          <span className="kr-ids">
                            {r.id} ／ {r.memberNumber}
                            {r.furigana ? ` ／ ${r.furigana}` : ''}
                          </span>
                          {/* ⚖ SILENT FAILURE IS A BUG: an empty preview says
                              WHICH of the four reasons it is, never a blank. */}
                          <span className={`kr-preview${r.preview ? '' : ' is-none'}`}>
                            {r.preview ?? r.previewFallback}
                          </span>
                        </span>
                      </span>
                      <span className="kr-c-state">
                        <span className={r.statePill}>{r.stateLabel}</span>
                      </span>
                      <span className="kr-c-service">{r.service}</span>
                      <span className="kr-c-staff">{r.staffName}</span>
                    </button>
                  ))
                )}
            </div>

            {walk.hidden > 0 && (
              <div
                className="kr-more"
                data-guide-title="さらに表示"
                data-guide="この一覧は新しい日付から順に、2週間ぶんずつさかのぼって読み込みます。押すと、さらに前の期間のカルテが下に追加されます。"
              >
                <button className="btn" type="button" onClick={() => setSteps((s) => s + 1)}>
                  さらに表示（あと{walk.hidden}件）
                </button>
              </div>
            )}
          </section>
        )}

        {/* ⚖ §7a — ONE QUIET REVEAL ROW, and only while searching. A records
            page shows records; a person with none is not a row in the table. */}
        {searching && revealed.length > 0 && (
          <section
            className="kr-reveal"
            aria-label="カルテのないお客様"
            data-guide-title="カルテのないお客様"
            data-guide="検索した名前に、この店舗のカルテがまだないお客様がいるときだけ出る行です。まだ施術の記録がない、という意味で、一覧そのものには並びません。"
          >
            <span className={`kr-mark${revealed[0].mark.length > 2 ? ' long' : ''}`} aria-hidden="true">{revealed[0].mark}</span>
            <span className="kr-reveal-text">
              <strong>{revealed[0].name}様</strong>
              <span>
                {revealed[0].memberNumber}
                {revealed[0].furigana ? ` ／ ${revealed[0].furigana}` : ''} — この店舗のカルテはまだありません
                {revealed.length > 1 ? `（ほか${revealed.length - 1}名）` : ''}
              </span>
            </span>
            <Link className="btn" href={revealed[0].customersHref}>
              {CUSTOMERS_LABEL}
            </Link>
          </section>
        )}
      </div>

      {/* ═══ THE RECORD ═══ */}
      {current && (
        <div className="kr-detail">
          <button className="kr-back" type="button" ref={backRef} onClick={() => setSelected(null)}>
            ← カルテ一覧
          </button>

          {/* ⚖ THE PERSON HEADER IS THE CUSTOMER-PROFILE IDENTITY HEADER, one
              structure for the family (Liam 8/23 final): avatar, name with the
              カルテ番号 beside it, a wrapping meta row, the contact row, the
              担当 line, and a top-right action slot — the same skeleton as the
              phone's `CustomerHeaderCard`, which is itself the exact clone of
              `CustomerIdentityCard`. Business has no customer-profile header
              yet; this is the one the 顧客 room adopts in the sweep (K-6). */}
          <section
            className="kr-identity"
            aria-labelledby="krIdentityName"
            data-guide-title="お客様とカルテ"
            data-guide="このカルテのお客様と、記録そのものの情報です。名前の横がカルテ番号、その下が来店回数・前回のご来店・この施術日です。"
          >
            <div className="kr-id-row">
              <span className={`kr-avatar${current.mark.length > 2 ? ' long' : ''}`} aria-hidden="true">{current.mark}</span>
              <div className="kr-id-main">
                <div className="kr-id-nameline">
                  <h2 id="krIdentityName">{current.customerName}様</h2>
                  <span className="kr-id-no">{current.id}</span>
                </div>
                <div className="kr-id-meta">
                  <span>{current.visitLabel}</span>
                  {current.lastVisitLabel && <span>前回 {current.lastVisitLabel}</span>}
                  <span>施術日 {current.dateLongLabel} {current.timeLabel}</span>
                </div>
                <div className="kr-id-meta">
                  <span>顧客番号 {current.memberNumber}</span>
                  {current.furigana && <span>{current.furigana}</span>}
                </div>
                <div className="kr-id-staff">
                  担当 <b>{current.staffName}</b> ・ {current.service} ・ 予約 {current.bookingNo}
                </div>
              </div>
              <div className="kr-id-actions">
                <Link className="btn" href={current.customersHref}>
                  {CUSTOMERS_LABEL}
                </Link>
                {/* ⚖ カルテの顧客変更 (registry ②). RIGHTS-GATED AND HIDDEN, never
                    shown-and-refused: a staff member without the capability does
                    not see it at all, exactly as the phone hides
                    `ReassignCustomerAction`. Canon's quiet ⇆ glyph — no pill, no
                    border, no fill (Liam 8/23: "just the blue arrow thing"). */}
                {props.canReassign && (
                  <button
                    className="kr-swap"
                    type="button"
                    aria-label="顧客を変更"
                    title="顧客を変更"
                    aria-expanded={reassignOpen}
                    aria-controls="krReassign"
                    onClick={() => setReassignOpen((o) => !o)}
                  >
                    ⇆
                  </button>
                )}
              </div>
            </div>
            {/* THE WARNING STEP, disclosed in place — no dialog, nothing to
                outrun (⚖ 47). The flow's next step is a store-scoped picker and
                an honest confirm that writes an audit row from→to; both land at
                RECONNECT, so the walk stops HERE and says so. */}
            {props.canReassign && reassignOpen && (
              <div className="kr-warn" id="krReassign" role="group" aria-label="カルテを別の顧客へ変更">
                <strong>カルテを別の顧客へ変更</strong>
                {REASSIGN_WARNING.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <div className="kr-warn-foot">
                  <button {...refused('続ける', props.refusals.reassign)}>続ける</button>
                  <button className="btn" type="button" onClick={() => setReassignOpen(false)}>
                    戻る
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ⚖ 破棄 (Liam 8/20). The row is kept, in full, for everyone — and
              what a reader may READ of it is the only thing that changes. */}
          {current.discard && (
            <section
              className="kr-discarded"
              aria-label="破棄されたカルテ"
              data-guide-title="破棄されたカルテ"
              data-guide="このカルテは破棄されています。破棄しても記録は消えず、一覧にも灰色のまま残ります。破棄した人・日時と、その理由は店舗管理者が確認できます。"
            >
              <strong>このカルテは破棄されています</strong>
              <p>
                {current.discard.whenLabel} ・ {current.discard.by}
              </p>
              {current.discard.reason ? (
                <p className="kr-discard-reason">理由: {current.discard.reason}</p>
              ) : (
                <p className="kr-discard-reason">破棄の理由と記録の内容は、店舗管理者のみが確認できます。</p>
              )}
              <p className="kr-discard-note">
                破棄されたカルテは、成約率・回数券の消化・AIの学習には使われません。記録として残るだけです。
              </p>
              {/* ⚖ 8/20 build requirement (b) — R2 keeps this record out of every
                  number, and money never auto-reverses, so the manager who owns
                  the correction has to be told it is owed. Manager-gated above
                  the serializer (F-K6). */}
              {current.discard.ticketNote && (
                <p className="kr-discard-ticket">{current.discard.ticketNote}</p>
              )}
            </section>
          )}

          {/* 破棄済み records carry no outcome for ANY reader (⚖ R2 — a
              discarded record feeds no number), so the section is not there to
              be explained and drops out of the walk by itself. */}
          {!current.discard && (
            <section
              className="kr-outcome"
              aria-labelledby="krOutcomeTitle"
              data-guide-title="セッションの結果"
              data-guide="この施術がどう終わったかの記録です。成約と不成約は成約率に入り、通常ご来店は入りません。仮カルテのままだと14日後に自動で不成約になります。"
            >
              <div className="kr-sec-head">
                <h2 className="kr-sec-title" id="krOutcomeTitle">セッションの結果</h2>
                <button {...refused('結果を変更', props.refusals.outcome, { 'aria-describedby': footnoteId! })}>
                  結果を変更
                </button>
              </div>
              <div className="kr-outcome-body">
                <span className={current.outcomePill}>{current.outcomeLabel}</span>
                {current.outcomeNote && <p className="kr-note">{current.outcomeNote}</p>}
                {current.ticketLine && <p className="kr-note">{current.ticketLine}</p>}
              </div>
            </section>
          )}

          {/* FACTS LEFT, EVIDENCE RIGHT — the template's grammar, and also the
              phone's own two-column split, so a staff member reading one record
              through two doors finds the same things in the same places. */}
          <div className="kr-grid">
            <div className="kr-col">
              <section
                className="kr-session"
                aria-labelledby="krSessionTitle"
                data-guide-title="本日のセッション"
                data-guide="施術中に記録された内容が、決まった8つの引き出しに分かれて並びます。「手書き」がついているものはスタッフが自分で書いた内容で、AIの再生成では上書きされません。"
              >
                <div className="kr-sec-head">
                  <h2 className="kr-sec-title" id="krSessionTitle">本日のセッション</h2>
                  <button {...refused('AIで再生成', props.refusals.regenerate, { 'aria-describedby': footnoteId! })}>
                    AIで再生成
                  </button>
                </div>
                {current.entries.length === 0 ? (
                  <p className="kr-none">
                    {current.discard
                      ? '記入内容は店舗管理者のみが確認できます。'
                      : 'このカルテにはまだ何も記入されていません。'}
                  </p>
                ) : (
                  <ul className="kr-entries">
                    {current.entries.map((e, i) => (
                      <li key={`${e.label}-${i}`}>
                        <div className="kr-entry-head">
                          <span className="kr-entry-label">{e.label}</span>
                          {e.handwritten && <span className="pill">手書き</span>}
                          <button
                            {...refused(`${e.label}を編集`, props.refusals.entry, {
                              'aria-describedby': footnoteId!,
                              className: 'kr-pencil',
                            })}
                          >
                            ✎
                          </button>
                        </div>
                        <p>{e.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div className="kr-col">
              <section
                className="kr-summary"
                aria-labelledby="krSummaryTitle"
                data-guide-title="詳細記録"
                data-guide="記入内容からAIがまとめた要約です。スタッフが書き直した場合はえんぴつの色が変わり、下の履歴に誰がいつ直したかが残ります。"
              >
                <div className="kr-sec-head">
                  <h2 className="kr-sec-title" id="krSummaryTitle">詳細記録</h2>
                  <button
                    {...refused('詳細記録を編集', props.refusals.summary, {
                      'aria-describedby': footnoteId!,
                      className: `kr-pencil${current.summaryEdited ? ' is-edited' : ''}`,
                    })}
                  >
                    ✎
                  </button>
                </div>
                {current.summaryBullets.length === 0 ? (
                  <p className="kr-none">{current.previewFallback}</p>
                ) : (
                  <ul className="kr-bullets">
                    {current.summaryBullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
              </section>

              {/* 写真記録 — captions and counts, from the record's own facts. The
                  viewer and the before/after comparison are registry ③, so the
                  tile refuses with its reason rather than opening nothing. */}
              {current.photos.length > 0 && (
                <section
                  className="kr-photos"
                  aria-labelledby="krPhotosTitle"
                  data-guide-title="写真記録"
                  data-guide="このセッションで撮影した写真の記録です。いまは枚数と説明だけを表示しています。全期間の写真は顧客のページにまとまります。"
                >
                  <div className="kr-sec-head">
                    <h2 className="kr-sec-title" id="krPhotosTitle">写真記録</h2>
                    <span className="kr-count">{current.photoCountLabel}</span>
                  </div>
                  <ul className="kr-photo-list">
                    {current.photos.map((p, i) => (
                      <li key={i}>
                        <button {...refused(`${p.category} ${p.caption}`, props.refusals.photo, { className: 'kr-photo' })}>
                          <span className="kr-photo-cat">{p.category}</span>
                          <span className="kr-photo-cap">{p.caption}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {current.aiMessage && (
                <section
                  className="kr-message"
                  aria-labelledby="krMessageTitle"
                  data-guide-title="AI提案メッセージ"
                  data-guide="施術のあとにお送りする文面の下書きです。送信は止めてありますが、何が送られる予定だったのかは隠さずに出します。"
                >
                  <div className="kr-sec-head">
                    <h2 className="kr-sec-title" id="krMessageTitle">AI提案メッセージ</h2>
                    <span className="pill indigo">LINE</span>
                  </div>
                  {/* Shown, then refused. Hiding what the room WOULD send would
                      make the refusal unreadable — ⚖ 47 asks the opposite. */}
                  <p className="kr-draft">
                    {current.customerName}様、{current.aiMessage}
                  </p>
                  <div className="kr-act-row">
                    <button {...refused('編集', props.refusals.message, { 'aria-describedby': footnoteId! })}>編集</button>
                    <button {...refused('承認して送信', props.refusals.send, { 'aria-describedby': footnoteId! })}>
                      承認して送信
                    </button>
                  </div>
                </section>
              )}

              <section
                className="kr-recording"
                aria-labelledby="krRecordingTitle"
                data-guide-title="録音・文字起こし"
                data-guide="この施術に録音があるかどうかと、録音の同意が確認できているかどうかです。文字起こしそのものの閲覧は店舗の設定で決まる仕組みで、この画面にはまだつないでいません。"
              >
                <div className="kr-sec-head">
                  <h2 className="kr-sec-title" id="krRecordingTitle">録音・文字起こし</h2>
                  {current.consentLabel && <span className="pill good">{current.consentLabel}</span>}
                </div>
                <p className="kr-note">{current.recordingLine}</p>
                {/* ⚖ Liam 8/30 D3 — the honest line, and never a hardcoded rule
                    about who may read a transcript. The room opens no transcript
                    door in either mode of the setting (registry ⑤). */}
                <p className="kr-note">文字起こしの閲覧は店舗の設定に従います（未接続）。</p>
              </section>
            </div>
          </div>

          {/* THE STANDING REFUSAL, in ONE line, on screen before anyone reaches
              for a control. It changes nothing and it stays — no toast, no
              flash, nothing to outrun (⚖ 47). Each control also carries its own
              specific reason and points here with aria-describedby. */}
          <p className="kr-footnote" id={footnoteId}>
            {props.actionFootnote}
          </p>

          {/* 記録の履歴 — full width beneath the pair, newest first, and the
              direction stated. A record's own history: what was edited, and — on
              a discarded record — the discard itself, which is the entry a
              manager is looking for when they open one. */}
          <section
            className="kr-history"
            aria-labelledby="krHistoryTitle"
            data-guide-title="記録の履歴"
            data-guide="このカルテに対して行われたことの記録です。新しいものが上で、要約を直した記録や破棄した記録が残ります。"
          >
            <div className="kr-sec-head">
              <h2 className="kr-sec-title" id="krHistoryTitle">記録の履歴</h2>
              <span className="kr-order">新しい順</span>
            </div>
            {current.history.length === 0 ? (
              <p className="kr-none">このカルテの操作履歴はまだ記録されていません。</p>
            ) : (
              <div className="kr-hist-rows">
                {current.history.map((h, i) => (
                  <div className="kr-hist-row" key={i}>
                    <time>{h.when}</time>
                    <span>
                      <strong>{h.what}</strong>
                      <span>{h.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the board's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. The hole is one big
          box-shadow rather than a moved element, so the region stays fully lit
          and nothing on the page is re-laid-out to explain it — and no layer
          owns a scroller, so the ⚖ page-scroll ruling is untouched. */}
      {tourOpen && (
        <>
          <div
            className="kr-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              // A tap on nothing declared ends the tour — the dim layer behaves
              // like the scrim it looks like.
              if (hit >= 0) setTourIdx(hit)
              else setTourIdx(-1)
            }}
            onMouseMove={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourHover(hit >= 0 && hit !== tourStep?.idx ? tourRectsRef.current[hit] : null)
            }}
          />
          {tourHover && (
            <div
              className="kr-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="kr-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="kr-spot-card"
            id="krTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="kr-spot-text">{tourStep?.text ?? ''}</span>
            <div className="kr-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="kr-spot-foot">
              <button type="button" className="kr-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="kr-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="kr-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="kr-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

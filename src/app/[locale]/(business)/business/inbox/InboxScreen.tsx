'use client'

// 受信トレイ — the room's approved LAYOUT (mock 2026-08-23, Liam's three-pass
// GO), rendered from props the server already resolved. The room's TRUTHS are
// unchanged: every fact still arrives as a formatted string, so this component
// holds no arithmetic, no clock and no data access. What moved is the shape —
// the queue is a 380px column, the actions are pinned to the top of the
// workspace band, 事実/同意 and 証跡/下書き sit side by side with 履歴 full width
// beneath them, and the 対応状況 counters are the filter row.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: which filter is pressed, which
// thread is open, which step of the 画面の説明 tour the reader is on, and —
// ≤743 only — whether the reader is looking at the list or at the thread. All
// four are pure browsing: none of them writes anything. The two things canon keeps
// that would need to SURVIVE a real navigation (a sent reply, a completed
// thread) are writes, and writes ship refused, so there is no staged state for
// a provider to hold above the screen. That is stated rather than assumed: if
// either action is ever connected, its staged result belongs above this
// component, not inside it (flag 30's class).
//
// CLASS NAMES ARE PREFIXED `ib-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and 今日の
// 運営 / 顧客 / 予約一覧 all state BARE `.biz .<name>` rules on the exact names
// canon's inbox uses (`.panel`, `.inspector`, `.summary`, `.filters`, `.fact`,
// `.history`, `.empty`, `.toast`…). Fencing sixty shared names one property at
// a time is a list that rots; not colliding at all cannot. `btn` is genuinely
// the SHELL's AND restated here, so it is fenced in inbox.css (page, h1, btn —
// a list of three). `pill` is also the shell's, but this room never restates a
// property on it — there is nothing here to fence, because there is nothing
// here to collide.

import Link from 'next/link'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import {
  COUNTER_FILTER,
  matchesFilter,
  SUMMARY_STATS,
  type ChannelState,
  type InboxSummary,
  type ThreadCategory,
  type ThreadFilter,
  type ThreadHistoryRow,
  type ThreadStatus,
} from '@/business/lib/inbox'

/** THE ROUTE WRAPPER. Every rule in inbox.css is scoped under this class, so
 *  nothing this sheet says can reach another room; `.page.pg-inbox` (four
 *  levels) rather than `.pg-inbox` (three) so a sibling's own three-level rule
 *  cannot win the room back on insertion order. */
const ROOT = 'page pg-inbox'

export interface InboxThreadProps {
  id: string
  category: ThreadCategory
  categoryLabel: string
  mark: string
  markTone: 'indigo' | 'red' | 'amber'
  status: ThreadStatus
  statusLabel: string
  overdue: boolean
  customerName: string
  memberNumber: string
  subject: string
  preview: string
  receivedLabel: string
  dueLabel: string
  source: string
  proofTitle: string
  proofLines: string[]
  bookingLabel: string
  bookingNo: string | null
  /** Carried so the 配信失敗 filter and the 配信失敗 counter answer the same
   *  question on the client too — `matchesFilter` reads it. */
  deliveryState: 'sent' | 'undelivered' | 'unsent' | null
  deliveryLabel: string
  next: string
  reply: string
  channels: ChannelState[]
  recommendedReason: string
  history: ThreadHistoryRow[]
  bookingHref: string | null
  primaryLabel: string
  primaryRefusal: string
  resolveLabel: string
  resolveRefusal: string
}

export interface InboxProps {
  dateline: string
  lensLabel: string
  filters: Array<{ key: ThreadFilter; label: string }>
  threads: InboxThreadProps[]
  summary: InboxSummary
  subtitle: string
  actionFootnote: string
  refreshRefusal: string
}

/** 予約一覧で事実を確認 — ONE label and ONE refusal reason, read by both the
 *  link shape and the refused shape, so a thread with no booking cannot end up
 *  describing itself differently from the one that has one (A8). */
const BOOKING_LABEL = '予約一覧で事実を確認'
const NO_BOOKING_REFUSAL = 'この空き待ちにはまだ予約がないため、予約一覧では確認できません。'

/** Status → its pill. The shell's four pills are the family's own vocabulary,
 *  and the colours here are SEMANTIC (⚖ accent law): red says a deadline has
 *  run out, amber says somebody is waiting on us, green says finished. Those
 *  are states of the work, not decoration, so they KEEP their colour. The
 *  informational chips elsewhere in this room stay neutral. */
const PILL: Record<ThreadStatus, string> = {
  new: 'pill indigo',
  attention: 'pill alert',
  waiting: 'pill warn',
  resolved: 'pill good',
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

export function InboxScreen(props: InboxProps) {
  const [filter, setFilter] = useState<ThreadFilter>('open')
  const [selected, setSelected] = useState<string | null>(null)
  // ≤743 ONLY, and view state rather than staged work: on a phone the list IS
  // the page and the thread is its own screen, so the room has to know which
  // of the two the reader is on. Nothing is written, nothing is meant to
  // survive a navigation, and above 743 both panels are on screen and this
  // flag styles nothing at all (inbox.css keeps its rules inside the band).
  const [detailOpen, setDetailOpen] = useState(false)
  // ⚖ Liam 8/23 — 画面の説明. The step the tour is on, `-1` when it is closed.
  // Also view state: the walk explains the page and writes nothing.
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  // ≤743's focus handover. `openedFrom` is the row the reader tapped, so ← can
  // put focus back exactly where it came from; `phoneSwap` records whether the
  // one-screen swap was actually in effect when the thread opened.
  const backRef = useRef<HTMLButtonElement>(null)
  const openedFrom = useRef<string | null>(null)
  const phoneSwap = useRef(false)

  // The tour's own nodes: the room root it walks, the ? it came from and goes
  // back to, the card it measures, and the 次へ it hands the keyboard.
  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)

  const visible = useMemo(() => props.threads.filter((t) => matchesFilter(t, filter)), [props.threads, filter])
  // The open thread follows the list: a selection the current filter no longer
  // shows falls back to the first row rather than leaving the panel describing
  // something the reader cannot see (⚖ A10 — a surface lying about state).
  const current = visible.find((t) => t.id === selected) ?? visible[0] ?? null

  // ⚖ THE SWAP MUST NOT STRAND THE READER. At ≤743 opening a thread hides the
  // queue — including the row that was focused — and going back hides the
  // detail, so in both directions the browser drops focus to <body> and a
  // keyboard reader restarts from the top of the document. Focus is therefore
  // MOVED with the screen: into the ← control on open, back onto the row that
  // opened it on close.
  //
  // The band test is the DOM's, not a restated 743: the ← control is rendered
  // at every width and hidden by the sheet above the phone band, so
  // "is ← on screen" IS "is the swap in effect" — and above 743 this effect
  // does nothing at all, which is why pressing a filter there cannot yank
  // focus out of the filter row.
  useEffect(() => {
    if (detailOpen) {
      phoneSwap.current = backRef.current !== null && backRef.current.offsetParent !== null
      if (phoneSwap.current) backRef.current!.focus()
      return
    }
    if (!phoneSwap.current) return
    phoneSwap.current = false
    const row = openedFrom.current
    openedFrom.current = null
    if (row) document.getElementById(row)?.focus()
  }, [detailOpen])

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────

  /** THE ROOM'S TOUR, on the family's shared engine (`@/business/lib/guide`).
   *  Two properties are the whole reason it is an engine and not a steps array:
   *
   *  THE REGISTRY. A section joins the walk by declaring `data-guide-title` +
   *  `data-guide` ON ITSELF, so there is no list to keep in sync: a section that
   *  renders is a section that is explained, and one that is not on screen — the
   *  workspace on a phone showing the list, the queue on a phone showing a
   *  thread, the all-clear card on every other morning — drops out of the walk
   *  and out of the N/M count by itself. That is Liam's "when I add a function
   *  it should automatically pick it up", and it is why the room's own gate is a
   *  census of what the DOM declares rather than a table anyone maintains.
   *
   *  POINT-TO-ASK. The dim layer is a click surface: tapping any declared region
   *  jumps to its explanation, and nested regions resolve smallest-first, so the
   *  queue panel can never swallow the filter row that lives inside it.
   *
   *  The walk is scoped to the ROOM's own root rather than the document: the
   *  shell's rail and topbar are not this page, and the room is rendered on its
   *  own in the evidence harness. */
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
    const at = spotCardAt(boxOf(r), size, { width: window.innerWidth, height: window.innerHeight })
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  // ONE keyboard listener for the two things that can be open, innermost first:
  // while the tour is up it owns Escape (and the arrows walk the ring), and only
  // once it is closed does Escape reach the phone's detail view. Two listeners
  // would both fire on one Escape and close both at once. Bound only while
  // something IS open, and removed with it.
  useEffect(() => {
    if (!detailOpen && !tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (tourOpen) {
        if (e.key === 'Escape') setTourIdx(-1)
        if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
        if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
        return
      }
      if (e.key === 'Escape') setDetailOpen(false)
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

  /** Pressing a counter or a filter narrows the list — so on a phone it also
   *  puts the reader back on the list it just narrowed. */
  const choose = (next: ThreadFilter) => {
    setFilter(next)
    setDetailOpen(false)
  }

  // 未完了 0 is the NORMAL morning for a solo shop, not an error state, so it
  // gets its own designed screen instead of an empty workspace. Derived from
  // the counts the strip prints — no flag, no fixture.
  //
  // …and only in the DEFAULT view. The card replaces the whole workspace, filter
  // row included, so showing it under 本日解決 would print 「本日解決 5件」 over a
  // screen that refuses to list those five and offers no way back — the exact
  // poster-not-a-tool failure the strip was rebuilt to end. Every other filter
  // keeps the workspace, which is what carries the way out.
  const allClear = props.summary.open === 0 && filter === COUNTER_FILTER.open
  const footnoteId = current ? `ibFootnote-${current.id}` : undefined

  return (
    // `is-detail` needs a detail to show: a filter that matches nothing renders
    // no thread panel, and hiding the list for a panel that is not there would
    // leave a phone reader on a blank screen.
    <div className={`${ROOT}${detailOpen && current ? ' is-detail' : ''}`} ref={rootRef}>
      {/* STEP 0, and the two removed explainer paragraphs' whole content. The
          head declares itself like every other section, so the walk opens on
          what this page is FOR before it starts pointing at parts of it. */}
      <header
        className="ib-head"
        data-guide-title="受信トレイ"
        data-guide="メッセージの数ではなく、店舗が次に行う対応を並べる画面です。顧客カルテの施術内容はここには表示しません。期限、予約への影響、同意済みの連絡先、配信の証跡を確認してから送信します。"
      >
        <div className="ib-eyebrow">{props.dateline}</div>
        <div className="ib-titleline">
          <h1>受信トレイ</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one 今日の運営
              has: a spotlight walk of everything on this screen, and during the
              walk you can tap any part of the page to jump straight to what it
              is. A hairline circle, never a filled one (⚖ R13). This replaces
              the disclosure block that used to open two paragraphs here — the
              paragraphs said what the page was, the tour SHOWS it, and a new
              section joins it by declaring itself rather than by anyone
              remembering to rewrite a paragraph. */}
          <button
            className="ib-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="ibTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
        </div>
        <p className="ib-subtitle">{props.subtitle}</p>
      </header>

      {/* 対応状況 — the numbers ARE the filters. Every counter presses the
          filter that shows exactly the rows it counted (COUNTER_FILTER, and
          `summarize` counts through the same predicate). */}
      <section
        className="ib-summary"
        aria-label="対応状況"
        data-guide-title="対応状況"
        data-guide="いま店舗が抱えている対応の件数です。数字はそのまま絞り込みボタンで、押すと下のキューがその件数ぶんだけに切り替わります。要対応と配信失敗は0件でなければ赤で出ます。"
      >
        <button
          className="ib-summary-main"
          type="button"
          aria-pressed={filter === COUNTER_FILTER.open}
          onClick={() => choose(COUNTER_FILTER.open)}
        >
          <strong>未完了の対応 {props.summary.open}件</strong>
        </button>
        {SUMMARY_STATS.map((s) => (
          <button
            key={s.key}
            className="ib-stat"
            type="button"
            aria-pressed={filter === COUNTER_FILTER[s.key]}
            onClick={() => choose(COUNTER_FILTER[s.key])}
          >
            <span>{s.label}</span>
            <b className={s.alarm && props.summary[s.key] > 0 ? 'attention' : undefined}>{props.summary[s.key]}</b>
          </button>
        ))}
      </section>

      {allClear ? (
        <section
          className="ib-zero"
          aria-label="すべて対応済み"
          data-guide-title="すべて対応済み"
          data-guide="未完了の対応が0件の朝に出る画面です。新しいメッセージが届くと、ここに対応キューが戻ります。"
        >
          <div className="ib-zero-card">
            <span className="ib-zero-check" aria-hidden="true">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12.5l5.2 5.2L20 6.9" />
              </svg>
            </span>
            <strong>すべて対応済みです</strong>
            <p>本日解決 {props.summary.resolved}件 · 新しいメッセージが届くとここに並びます</p>
          </div>
        </section>
      ) : (
        <div className="ib-workspace">
          <section
            className="ib-panel ib-queue"
            aria-labelledby="ibQueueTitle"
            data-guide-title="店舗の対応キュー"
            data-guide="店舗が対応する順に並んだ一覧です。並び順は期限と予約への影響順で、店舗が決め直す必要はありません。1件を押すと右側にその対応の中身が開きます。"
          >
            <div className="ib-panel-head">
              <div>
                <strong id="ibQueueTitle">店舗の対応キュー</strong>
                <span>
                  {visible.length}件を表示 / 期限と影響順 · {props.lensLabel}
                </span>
              </div>
              {/* Canon refreshes with a toast that says nothing changed. A control
                  whose only effect is a message about its own uselessness is the
                  dead-lever class, so it refuses with the reason instead. */}
              {/* aria-disabled, not `disabled`: the control stays focusable so the
                  reason is reachable by keyboard and screen reader — the shell's
                  own standing-hint treatment, one step better. */}
              <button
                className="btn"
                type="button"
                aria-disabled="true"
                title={props.refreshRefusal}
                aria-label={`最新状態を確認 — ${props.refreshRefusal}`}
                data-guide-title="最新状態を確認"
                data-guide="Reserveと配信状態を取り直すボタンです。いまは見本データのため押しても取得しません。実データにつないだあとに有効になります。"
              >
                最新状態を確認
              </button>
            </div>

            {/* QUIET TEXT, not buttons: a filter narrows a view, it does not act,
                so it gets no border and no fill — selected is an accent label
                plus a 2px accent underline. The strip wraps rather than panning,
                so no container in this room owns an axis at all (⚖ page-scroll). */}
            <div
              className="ib-filters"
              role="group"
              aria-label="対応キューの絞り込み"
              data-guide-title="対応キューの絞り込み"
              data-guide="キューに出す対応を種類でしぼる行です。選んだものだけが下に並びます。押しても内容は変わらず、見えている範囲が変わるだけです。"
            >
              {props.filters.map((f) => (
                <button
                  key={f.key}
                  className="ib-filter"
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => choose(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {visible.length === 0 ? (
              <div className="ib-empty">
                <strong>この条件の対応はありません</strong>
                <span>別の絞り込みを選んでください。</span>
              </div>
            ) : (
              <div className="ib-list">
                {visible.map((t) => (
                  <button
                    key={t.id}
                    // The row's id is how ← finds its way back to it: at ≤743
                    // the row is gone from the screen by the time focus has to
                    // return, so the reference has to survive the swap.
                    id={`ibRow-${t.id}`}
                    type="button"
                    className={`ib-row${t.id === current?.id ? ' selected' : ''}`}
                    aria-pressed={t.id === current?.id}
                    onClick={() => {
                      openedFrom.current = `ibRow-${t.id}`
                      setSelected(t.id)
                      setDetailOpen(true)
                    }}
                  >
                    <span className={`ib-mark ${t.markTone}`} aria-hidden="true">
                      {t.mark}
                    </span>
                    <span className="ib-copy">
                      <span className="ib-line1">
                        <strong>{t.customerName}</strong>
                        <span className="ib-no">{t.memberNumber}</span>
                        <time>{t.receivedLabel}</time>
                      </span>
                      <span className="ib-line2">
                        <span className="ib-subject">{t.subject}</span>
                        <span className={PILL[t.status]}>{t.statusLabel}</span>
                      </span>
                      <span className="ib-preview">{t.preview}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {current && (
            <section className="ib-panel ib-detail" aria-labelledby="ibDetailTitle">
              <div className="ib-band">
                <div className="ib-band-id">
                  {/* ≤743's way back to the list. Hidden at every wider width by
                      the sheet, because there the list never left. */}
                  <button className="ib-back" type="button" ref={backRef} onClick={() => setDetailOpen(false)}>
                    ← 一覧へ戻る
                  </button>
                  <div className="ib-kicker">
                    {current.categoryLabel} / {current.statusLabel}
                  </div>
                  <h2 id="ibDetailTitle">{current.customerName}</h2>
                  <p>{current.subject}</p>
                </div>
                <div
                  className="ib-act"
                  data-guide-title="この対応でできること"
                  data-guide="開いている対応に対する操作です。返信と完了の記録は実際に世界を変える操作のため、見本データのあいだは理由を出して止めてあります。予約一覧を開いて確かめる操作は読むだけなので、いまも動きます。"
                >
                  <div className="ib-act-row">
                    {/* A resolved thread's 次の対応 fact below already states the
                        outcome — 返信する behind an empty draft, or 今回は請求
                        しない on a closed case, are WORK levers naming work the
                        record says is done (⚖ FIX-3, adjudicated: only these two
                        are work — 予約一覧で事実を確認 is a read/navigation lever
                        and stays, resolved or not). */}
                    {current.status !== 'resolved' && (
                      <>
                        {/* The SPECIFIC reason rides the control's own
                            accessible name, the way 最新状態を確認 already does
                            in this room: with an aria-describedby present a
                            screen reader drops `title`, so the standing
                            footnote alone would lose the two reasons apart. */}
                        <button
                          className="btn"
                          type="button"
                          aria-disabled="true"
                          title={current.primaryRefusal}
                          aria-label={`${current.primaryLabel} — ${current.primaryRefusal}`}
                          aria-describedby={footnoteId}
                        >
                          {current.primaryLabel}
                        </button>
                        <button
                          className="btn"
                          type="button"
                          aria-disabled="true"
                          title={current.resolveRefusal}
                          aria-label={`${current.resolveLabel} — ${current.resolveRefusal}`}
                          aria-describedby={footnoteId}
                        >
                          {current.resolveLabel}
                        </button>
                      </>
                    )}
                    {current.bookingHref ? (
                      <Link className="btn" href={current.bookingHref}>
                        {BOOKING_LABEL}
                      </Link>
                    ) : (
                      // The FOURTH refused control, and it gets the same
                      // treatment as the other three: the reason rides its own
                      // accessible name, not `title` alone. A title-only
                      // refusal is invisible to exactly the reader who cannot
                      // see the button is dead.
                      <button
                        className="btn"
                        type="button"
                        aria-disabled="true"
                        title={NO_BOOKING_REFUSAL}
                        aria-label={`${BOOKING_LABEL} — ${NO_BOOKING_REFUSAL}`}
                      >
                        {BOOKING_LABEL}
                      </button>
                    )}
                  </div>
                  {/* THE REFUSAL, in ONE line where the restructure used to carry
                      two paragraphs. It is on screen before anyone reaches for a
                      control, it changes nothing, and it stays — no toast, no
                      flash, nothing to outrun (⚖ 47). Each control also carries
                      its OWN specific reason in its title and points here with
                      aria-describedby. Gated with the WORK buttons above, not
                      with the panel: a resolved thread's footnote would explain
                      controls that are no longer there. */}
                  {current.status !== 'resolved' && (
                    <p className="ib-footnote" id={footnoteId}>
                      {props.actionFootnote}
                    </p>
                  )}
                </div>
              </div>

              <div className="ib-body">
                <div className="ib-grid">
                  <div>
                    {/* ⚖ THE HEADING IS PART OF THE SECTION (found live on the
                        deployed page, 1280, 8/23). A reader taps the WORD 対応の
                        事実 — it is the thing they are asking about — and the
                        declaration used to sit on the box alone, a few pixels
                        below the word, so the tap landed on the scrim and CLOSED
                        the walk. The pair therefore rides a wrapper that holds
                        the 見出し AND the box. The wrapper paints nothing: it
                        carries only the between-sections margin that `.ib-title`
                        gives up the moment it becomes a first child. */}
                    <div
                      className="ib-sec"
                      data-guide-title="対応の事実"
                      data-guide="この対応について記録に残っている事実です。期限、対象の予約、どこから届いたか、送信できたかどうか、次に店舗が行うこと。ここに出るのは記録された内容だけで、推測は入りません。"
                    >
                      <div className="ib-title">対応の事実</div>
                      <div className="ib-facts">
                        <div className="ib-fact">
                          <span>期限</span>
                          <b className={current.overdue ? 'overdue' : undefined}>{current.dueLabel}</b>
                        </div>
                        <div className="ib-fact">
                          <span>予約・候補</span>
                          <b>
                            {current.bookingNo ? `${current.bookingNo} · ` : ''}
                            {current.bookingLabel}
                          </b>
                        </div>
                        <div className="ib-fact">
                          <span>受信元</span>
                          <b>{current.source}</b>
                        </div>
                        <div className="ib-fact">
                          <span>配信状態</span>
                          <b>{current.deliveryLabel}</b>
                        </div>
                        <div className="ib-fact">
                          <span>次の対応</span>
                          <b>{current.next}</b>
                        </div>
                      </div>
                    </div>

                    <div
                      className="ib-sec"
                      data-guide-title="連絡同意"
                      data-guide="この方に連絡してよい方法です。顧客台帳に記録された内容をそのまま出しています。緑は同意あり、赤は同意なし、グレーの「—」はまだ聞いていないという意味で、同意なしとは別です。"
                    >
                      <div className="ib-title">連絡同意</div>
                      {/* The 顧客台帳's own record, in the 顧客 screen's own words —
                          one person's consent cannot read two ways in two rooms.
                          「—」 is 「まだ記録していない」 and is NOT 「同意なし」. */}
                      <div className="ib-consent">
                        {current.channels.map((c) => (
                          <div className="ib-channel" key={c.key}>
                            <span>{c.key}</span>
                            <b className={c.verdict}>{c.label}</b>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="ib-recommend">{current.recommendedReason}</p>
                  </div>

                  <div>
                    <div
                      className="ib-sec"
                      data-guide-title="証跡"
                      data-guide="この対応の根拠になった記録です。いつ、どの経路で、何が起きたかが残ります。同意のない方法へは送信しません。"
                    >
                      <div className="ib-title">証跡</div>
                      <div className="ib-proof">
                        <strong>{current.proofTitle}</strong>
                        {current.proofLines.length === 0 ? (
                          <span>この対応には記録された根拠がまだありません。</span>
                        ) : (
                          <ul>
                            {current.proofLines.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        )}
                        <span>同意のない方法へは送信しません。</span>
                      </div>
                    </div>

                    {current.reply !== '' && (
                      <div
                        className="ib-sec"
                        data-guide-title="返信の下書き"
                        data-guide="この対応で送ることになる文面です。送信は止めてありますが、何が送られるはずだったのかは隠さずに出します。"
                      >
                        <div className="ib-title">返信の下書き</div>
                        {/* Shown, then refused. Hiding what the room WOULD send
                            would make the refusal unreadable — ⚖ 47 asks the
                            opposite. */}
                        <p className="ib-draft">
                          {current.customerName}様、{current.reply}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 履歴 — full width beneath the pair, two fixed columns, with the
                    direction stated (新しい順) and a hairline connector across the
                    gap so two entries side by side read as one sequence rather
                    than as a two-column table. */}
                <div
                  className="ib-hist"
                  data-guide-title="履歴"
                  data-guide="この対応に対して行われた操作の記録です。新しいものが先頭で、左から右へ時間をさかのぼります。"
                >
                  <div className="ib-title-row">
                    <div className="ib-title">履歴</div>
                    <span className="ib-order">新しい順</span>
                  </div>
                  {current.history.length === 0 ? (
                    <p className="ib-none">この対応の操作履歴はまだ記録されていません。</p>
                  ) : (
                    <div className="ib-hist-rows">
                      {current.history.map((h, i) => (
                        <div className="ib-history-row" key={i}>
                          <time>{h.time}</time>
                          <span>
                            <strong>{h.what}</strong>
                            <span>{h.detail}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
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
            className="ib-spot-catch"
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
              className="ib-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="ib-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="ib-spot-card"
            id="ibTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="ib-spot-text">{tourStep?.text ?? ''}</span>
            <div className="ib-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="ib-spot-foot">
              <button type="button" className="ib-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="ib-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="ib-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="ib-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

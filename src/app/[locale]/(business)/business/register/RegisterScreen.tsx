'use client'

// 売上・レジ — the day's money desk, built to the 受信トレイ TEMPLATE from day
// one (mock 2026-08-23, Liam's three-pass GO) and carrying canon's BEHAVIOUR
// (fable-store-sales-register.html, 1,823 lines, read whole before a line of
// this was written).
//
// THE LAYOUT IS THE TEMPLATE'S: a quiet counter strip whose numbers ARE the
// filter row, a compact ledger column beside a wide workspace, the actions
// pinned to the top of that workspace's band, facts+決済手段 beside
// 証跡+閉店への影響, 履歴 full width beneath, a designed zero state, and the full
// responsive ladder down to a phone where the list IS the page.
//
// THE BEHAVIOUR IS CANON'S: what a transaction's state means, what a refund
// would reverse, what the terminal holding a record does to the day, what a
// close needs before it may be signed. Where the two disagree the template wins
// on SHAPE and canon wins on WHAT IS TRUE — every such choice is a numbered
// deviation in the build report, never a silent one.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: which filter is pressed, which
// transaction is open, which step of the 画面の説明 tour the reader is on, and —
// ≤743 only — whether the reader is looking at the list or at the transaction.
// All of it is browsing. Every control that would CHANGE MONEY ships refused
// with its reason, so there is no staged write for a provider to hold above this
// component; if one is ever connected, its staged result belongs above this
// screen and not inside it (flag 30's class).
//
// CLASS NAMES ARE PREFIXED `rg-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and the
// neighbours state BARE `.biz .<name>` rules on names canon's register page uses
// (`.summary`, `.summary-main`, `.filters`, `.panel`, `.panel-head`,
// `.inspector`, `.fact`, `.price`, `.history-row`, `.empty`, `.status`,
// `.check-row`, `.spot-card`…). 今日の運営 even owns `.register-cell`. Fencing
// sixty shared names one property at a time is a list that rots; not colliding
// at all cannot. `page` / `h1` / `btn` are genuinely the shell's AND restated
// here, so those three are fenced in register.css — a list of three.

import Link from 'next/link'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import {
  COUNTER_FILTER,
  COUNTER_STATS,
  matchesFilter,
  type ClosingCheckRow,
  type RegisterCounts,
  type RegisterFilter,
  type TransactionState,
} from '@/business/lib/register'

/** THE ROUTE WRAPPER. Every rule in register.css is scoped under this class, and
 *  `.page.pg-register` (four levels) rather than `.pg-register` (three) so a
 *  sibling's own three-level rule cannot win the room back on insertion order. */
const ROOT = 'page pg-register'

export interface RegisterFactProps {
  label: string
  value: string
  tone?: 'warn' | 'bad'
}

export interface RegisterRowProps {
  id: string
  state: TransactionState
  stateLabel: string
  /** Carried so the client narrows the ledger through the SAME predicate the
   *  server counted the strip with — `matchesFilter`, one home. A counter and
   *  the rows it opens cannot answer two different questions. */
  filter: RegisterFilter
  pill: string
  who: string
  memberNumber: string | null
  what: string
  bookingNo: string | null
  atLabel: string
  totalLabel: string
  receivedLabel: string
  /** 未収 or 返金, under the row's total — the KIND is part of the value. */
  subAmount: { label: string; value: string; tone: 'warn' | 'bad' } | null
  tenderSummary: string
  facts: RegisterFactProps[]
  priceProof: string
  tenders: Array<{ label: string; amount: string; tone?: 'refund' | 'unpaid' }>
  refundPreview: string | null
  refundNote: string
  closingImpact: string
  history: Array<{ time: string; what: string; detail: string }>
  bookingHref: string | null
  refundRefusal: string
  outstandingRefusal: string
  bookingRefusal: string
  canRefund: boolean
  showRefund: boolean
  /** canon gates 未収として記録 on the CLOSE capability (:1305), like its four
   *  siblings — a role without it gets no control at all. */
  canOutstanding: boolean
  showOutstanding: boolean
}

export interface RegisterProps {
  dateline: string
  lensLabel: string
  subtitle: string
  permissionNotice: string | null
  money: Array<{ key: string; label: string; value: string; tone?: 'warn' | 'bad'; redacted?: boolean }>
  moneyScope: string
  counts: RegisterCounts
  filters: Array<{ key: RegisterFilter; label: string }>
  rows: RegisterRowProps[]
  terminal: {
    ok: boolean
    title: string
    copy: string
    stats: Array<{ label: string; value: string; tone?: 'warn' }>
    recheckLabel: string
    recheckRefusal: string
    canRecheck: boolean
  }
  /** ⚖ A CLOSE BELONGS TO ONE STORE. `null` under the storeless
   *  `{viewAll:true}` lens, where there is no drawer to count and no day to
   *  close — the room says so rather than merging two stores' closes into a
   *  figure no shop could act on. */
  close: RegisterCloseProps | null
  closeUnavailable: string
  actionFootnote: string
  emptyDay: boolean
}

export interface RegisterCloseProps {
  cash: {
    expected: string
    counted: string
    variance: string
    varianceBad: boolean
    /** F12 — this role may not see the day's cash figures, so the three stats
     *  wear the strip's own quiet-sentence treatment instead of 18px bold. */
    redacted: boolean
    reason: string
    status: string
    statusDone: boolean
    tolerance: string
    saveLabel: string
    saveRefusal: string
    canSave: boolean
  }
  checks: ClosingCheckRow[]
  openCount: number
  headline: string
  closeLabel: string
  closeRefusal: string
  canClose: boolean
  signoffLabel: string
  signoffRefusal: string
  recordLabel: string
  record: Array<{ label: string; value: string }>
  reconciliation: Array<{ label: string; received: string; reversed: string; net: string }>
  reconciliationNote: string
  reconciliationBalanced: boolean
}

/** 予約一覧で事実を確認 — ONE label read by both the link shape and the refused
 *  shape, so a sale with no booking cannot end up describing itself differently
 *  from one that has one (⚖ A8). */
const BOOKING_LABEL = '予約一覧で事実を確認'

/** ⚖ Liam 8/23 — 画面の説明. The board's own tour helpers at the same shape: a
 *  rect literal the engine understands, and two identity guards that keep the
 *  measuring effect from re-rendering itself forever. */
const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total

const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

export function RegisterScreen(props: RegisterProps) {
  const [filter, setFilter] = useState<RegisterFilter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  // ≤743 ONLY, and view state rather than staged work: on a phone the ledger IS
  // the page and a transaction is its own screen, so the room has to know which
  // of the two the reader is on. Above 743 both panels are on screen and this
  // flag styles nothing at all (register.css keeps its rules inside the band).
  const [detailOpen, setDetailOpen] = useState(false)
  // ⚖ Liam 8/23 — 画面の説明. The step the tour is on, `-1` when it is closed.
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  // ≤743's focus handover. `openedFrom` is the row the reader tapped, so ← can
  // put focus back exactly where it came from; `phoneSwap` records whether the
  // one-screen swap was actually in effect when the transaction opened.
  const backRef = useRef<HTMLButtonElement>(null)
  const openedFrom = useRef<string | null>(null)
  const phoneSwap = useRef(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)

  const visible = useMemo(() => props.rows.filter((r) => matchesFilter(r, filter)), [props.rows, filter])
  // The open transaction follows the list: a selection the current filter no
  // longer shows falls back to the first row rather than leaving the workspace
  // describing something the reader cannot see (⚖ A10).
  const current = visible.find((r) => r.id === selected) ?? visible[0] ?? null

  // ⚖ THE SWAP MUST NOT STRAND THE READER (the room-3 F5 lesson, inherited). At
  // ≤743 opening a transaction hides the ledger — including the row that was
  // focused — so focus is MOVED with the screen: into the ← control on open,
  // back onto the row that opened it on close. The band test is the DOM's, not a
  // restated 743: the ← is rendered at every width and hidden by the sheet above
  // the phone band, so "is ← on screen" IS "is the swap in effect".
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
  //
  // THE REGISTRY. A section joins the walk by declaring `data-guide-title` +
  // `data-guide` ON ITSELF, so there is no list to keep in sync: a section that
  // renders is a section that is explained, and one that is not on screen — the
  // workspace on a phone showing the list, the ledger on a phone showing a
  // transaction, the zero-day card on any day with takings — drops out of the
  // walk and out of the N/M count by itself.
  //
  // EVERY DECLARATION HOLDS ITS OWN HEADING (the room-3 tap-target finding): the
  // thing a reader points at is the WORD, so a `data-guide` on the box alone
  // leaves the 見出し outside the rect and a tap on it hits the scrim and CLOSES
  // the walk. Sections here wrap heading AND box in one declared element.
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
    // would cut its hole in empty space. The PAGE scrolls — the overlay adds no
    // scroller of its own (⚖ page-scroll).
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
  // would both fire on one Escape and close both at once.
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
  // 次へ, so Enter walks the ring exactly as the arrows do; closing it puts focus
  // back on the ? it came from. `wasOpen` is what keeps the close half from
  // firing on the first render, when nothing was open and nothing should move.
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

  /** Pressing a counter or a filter narrows the ledger — so on a phone it also
   *  puts the reader back on the list it just narrowed. */
  const choose = (next: RegisterFilter) => {
    setFilter(next)
    setDetailOpen(false)
  }

  const footnoteId = current ? `rgFootnote-${current.id}` : undefined
  const close = props.close

  return (
    // `is-detail` needs a detail to show: a filter that matches nothing renders
    // no transaction panel, and hiding the list for a panel that is not there
    // would leave a phone reader on a blank screen.
    <div className={`${ROOT}${detailOpen && current ? ' is-detail' : ''}`} ref={rootRef}>
      <header
        className="rg-head"
        data-guide-title="売上・レジ"
        data-guide="その日のお金をひとつの台帳で照合する画面です。取引ごとの決済手段、未収、返金、現金の差異、そして閉店に必要な確認がすべてここに出ます。金額はすべて記録された取引から計算していて、この画面が独自に持っている数字はありません。"
      >
        <div className="rg-eyebrow">{props.dateline}</div>
        <div className="rg-titleline">
          <h1>売上・レジ</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one 今日の運営
              and 受信トレイ have: a spotlight walk of everything on this screen,
              and during the walk you can tap any part of the page to jump
              straight to what it is. A hairline circle, never a filled one
              (⚖ R13). */}
          <button
            className="rg-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="rgTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
        </div>
        <p className="rg-subtitle">{props.subtitle}</p>
      </header>

      {/* canon `renderPermissionNotice` — what this role cannot do, in one
          sentence, before anyone reaches for a control that is not there. */}
      {props.permissionNotice && (
        <div
          className="rg-permission"
          role="status"
          data-guide-title="この役割でできること"
          data-guide="いま開いている人の権限では実行できない操作があるときに出る案内です。表示できない金額と、実行できない操作の両方をここに書きます。"
        >
          {props.permissionNotice}
        </div>
      )}

      {/* 決済端末の状態 — A RECORDED FACT WITH ITS CONSEQUENCE (⚖ A10/A11). The
          band never claims the terminal is unusable over a ledger that shows a
          card going through: it names the moment records started being held. */}
      <section
        className={`rg-terminal${props.terminal.ok ? ' ok' : ''}`}
        aria-label="決済端末の状態"
        data-guide-title="決済端末の状態"
        data-guide="カード決済の端末がいま送信できているかどうかです。端末内に保持されている取引があるあいだは、その件数と金額、そして重複して請求されていないことを出します。保持が1件でもあると閉店できません。"
      >
        <div className="rg-terminal-main">
          <span className="rg-terminal-icon" aria-hidden="true">{props.terminal.ok ? '✓' : '!'}</span>
          <span>
            <strong>{props.terminal.title}</strong>
            <span>{props.terminal.copy}</span>
          </span>
        </div>
        {props.terminal.stats.map((s) => (
          <div className="rg-terminal-stat" key={s.label}>
            <span>{s.label}</span>
            <b className={s.tone}>{s.value}</b>
          </div>
        ))}
        <div className="rg-terminal-action">
          {/* A WRITE — it talks to a real device. Refused, with its reason on its
              own accessible name. A role without the capability gets no control
              at all, which is canon's own gating shape. */}
          {props.terminal.canRecheck && (
            <button
              className="btn"
              type="button"
              aria-disabled="true"
              title={props.terminal.recheckRefusal}
              aria-label={`${props.terminal.recheckLabel} — ${props.terminal.recheckRefusal}`}
            >
              {props.terminal.recheckLabel}
            </button>
          )}
        </div>
      </section>

      {/* 本日の売上集計 — FACTS, not filters. Every figure is a sum over the rows
          the ledger below prints; none of them is pressable, and the aria says
          so rather than leaving the reader to guess from the shape. */}
      <section
        className="rg-money"
        aria-label="本日の売上集計"
        data-guide-title="本日の売上集計"
        data-guide="その日のお金の合計です。総売上から返金を引いたものが純売上で、そのうち実際に受け取った分が受領済み、まだいただいていない分が未収です。すべて下の台帳の取引を足したもので、押しても絞り込みは変わりません。"
      >
        <div className="rg-money-main">
          <strong>本日のレジ</strong>
          <span>{props.moneyScope}</span>
        </div>
        {props.money.map((m) => (
          <div className="rg-money-cell" key={m.key}>
            <span>{m.label}</span>
            <b className={[m.tone, m.redacted ? 'redacted' : ''].filter(Boolean).join(' ') || undefined}>{m.value}</b>
          </div>
        ))}
      </section>

      {/* 取引の件数 — the numbers ARE the filters. Every counter presses the
          filter that shows exactly the rows it counted (COUNTER_FILTER, and
          `countBy` counts through the same `matchesFilter`). */}
      <section
        className="rg-counts"
        aria-label="取引の件数"
        data-guide-title="取引の件数"
        data-guide="状態ごとの取引の件数です。数字はそのまま絞り込みボタンで、押すと下の台帳がその件数ぶんだけに切り替わります。一部入金と要確認は0件でなければ色がつきます。"
      >
        <button
          className="rg-count-main"
          type="button"
          aria-pressed={filter === COUNTER_FILTER.all}
          onClick={() => choose(COUNTER_FILTER.all)}
        >
          <strong>本日の取引 {props.counts.all}件</strong>
        </button>
        {COUNTER_STATS.map((s) => (
          <button
            key={s.key}
            className="rg-count"
            type="button"
            aria-pressed={filter === COUNTER_FILTER[s.key]}
            onClick={() => choose(COUNTER_FILTER[s.key])}
          >
            <span>{s.label}</span>
            <b className={s.alarm && props.counts[s.key] > 0 ? 'attention' : undefined}>{props.counts[s.key]}</b>
          </button>
        ))}
      </section>

      {props.emptyDay ? (
        // 本日まだ取引なし is the NORMAL state of a morning, not an error state,
        // so it gets a designed moment instead of an empty panel. The workspace
        // is not mounted at all behind it.
        <section
          className="rg-zero"
          aria-label="本日の取引はまだありません"
          data-guide-title="本日の取引はまだありません"
          data-guide="まだ会計が1件も記録されていない状態です。最初の会計が入るとここに台帳が出ます。閉店チェックはこの状態でも使えます。"
        >
          <div className="rg-zero-card">
            <span className="rg-zero-mark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12h16" />
              </svg>
            </span>
            <strong>本日の取引はまだありません</strong>
            <p>会計を記録するとここに並びます · {props.lensLabel}</p>
          </div>
        </section>
      ) : (
        <div className="rg-workspace">
          <section
            className="rg-panel rg-ledger"
            aria-labelledby="rgLedgerTitle"
            data-guide-title="取引・決済台帳"
            data-guide="その日の取引が新しい順に並びます。1件を押すと右側にその取引の中身が開きます。金額は売上と受領を分けて出していて、未収があるときは受領の下に赤で出ます。"
          >
            <div className="rg-panel-head">
              <div>
                <strong id="rgLedgerTitle">取引・決済台帳</strong>
                <span>
                  {visible.length}件を表示 / 新しい順 · {props.lensLabel}
                </span>
              </div>
            </div>

            {/* QUIET TEXT, not buttons: a filter narrows a view, it does not act,
                so it gets no border and no fill — selected is an accent label
                plus a 2px accent underline. The row wraps rather than panning,
                so no container in this room owns an axis (⚖ page-scroll). */}
            <div
              className="rg-filters"
              role="group"
              aria-label="台帳の絞り込み"
              data-guide-title="台帳の絞り込み"
              data-guide="台帳に出す取引を状態でしぼる行です。上の件数と同じ区分で、どちらから押しても同じ結果になります。押しても取引の内容は変わらず、見えている範囲が変わるだけです。"
            >
              {props.filters.map((f) => (
                <button
                  key={f.key}
                  className="rg-filter"
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => choose(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <div className="rg-empty">
                <strong>この条件の取引はありません</strong>
                <span>別の絞り込みを選んでください。</span>
              </div>
            ) : (
              <div className="rg-list">
                {visible.map((r) => (
                  <button
                    key={r.id}
                    id={`rgRow-${r.id}`}
                    type="button"
                    className={`rg-row${r.id === current?.id ? ' selected' : ''}`}
                    aria-pressed={r.id === current?.id}
                    onClick={() => {
                      openedFrom.current = `rgRow-${r.id}`
                      setSelected(r.id)
                      setDetailOpen(true)
                    }}
                  >
                    <span className="rg-copy">
                      <span className="rg-line1">
                        <strong>{r.who}</strong>
                        <span className="rg-no">{r.id}</span>
                        <time>{r.atLabel}</time>
                      </span>
                      <span className="rg-line2">
                        <span className="rg-what">{r.what}</span>
                        <span className={r.pill}>{r.stateLabel}</span>
                      </span>
                      <span className="rg-line3">
                        <span className="rg-tender">{r.tenderSummary}</span>
                        <span className="rg-amounts">
                          <b>{r.totalLabel}</b>
                          {r.subAmount && (
                            <em className={r.subAmount.tone}>
                              {r.subAmount.label} {r.subAmount.value}
                            </em>
                          )}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="rg-foot">
              返金・取消をしても、予約時の確定価格と元の決済行は書き換えません。反対仕訳と理由、承認者を新しい監査行として追加します。
            </p>
          </section>

          {current && (
            <section
              className="rg-panel rg-detail"
              aria-labelledby="rgDetailTitle"
              data-guide-title="開いている取引"
              data-guide="台帳で選んだ1件の中身です。上に取引の見出しとできること、下に事実、決済手段、予約時価格、閉店への影響、そして操作の履歴が並びます。ここに出るのはこの取引のことだけで、台帳の他の行には影響しません。"
            >
              <div className="rg-band">
                <div className="rg-band-id">
                  {/* ≤743's way back to the ledger. Hidden at every wider width
                      by the sheet, because there the ledger never left. */}
                  <button className="rg-back" type="button" ref={backRef} onClick={() => setDetailOpen(false)}>
                    ← 台帳へ戻る
                  </button>
                  <div className="rg-kicker">
                    {current.stateLabel} / 決済 {current.tenders.length}行
                  </div>
                  <h2 id="rgDetailTitle">{current.who}</h2>
                  <p>
                    {current.id} / {current.atLabel} / {current.what}
                  </p>
                </div>
                <div
                  className="rg-act"
                  data-guide-title="この取引でできること"
                  data-guide="開いている取引に対する操作です。返金・取消と未収の記録は実際にお金と記録を動かす操作のため、見本データのあいだは理由を出して止めてあります。予約一覧を開いて確かめる操作は読むだけなので、いまも動きます。"
                >
                  <div className="rg-act-row">
                    {/* A WRITE, and the most consequential one on the page: it
                        moves real money back to a real person. Refused, with its
                        own reason on its own accessible name — and what it WOULD
                        reverse is printed below, because refusing to act is
                        honest and hiding what the action would have done is not.
                        A role without the capability gets no control at all. */}
                    {current.canRefund && current.showRefund && (
                      <button
                        className="btn danger"
                        type="button"
                        aria-disabled="true"
                        title={current.refundRefusal}
                        aria-label={`返金・取消 — ${current.refundRefusal}`}
                        aria-describedby={footnoteId}
                      >
                        返金・取消
                      </button>
                    )}
                    {current.canOutstanding && current.showOutstanding && (
                      <button
                        className="btn"
                        type="button"
                        aria-disabled="true"
                        title={current.outstandingRefusal}
                        aria-label={`未収として記録 — ${current.outstandingRefusal}`}
                        aria-describedby={footnoteId}
                      >
                        未収として記録
                      </button>
                    )}
                    {current.bookingHref ? (
                      <Link className="btn" href={current.bookingHref}>
                        {BOOKING_LABEL}
                      </Link>
                    ) : (
                      // The refused shape of the SAME control, and it gets the
                      // same treatment: the reason rides its accessible name,
                      // never `title` alone. A title-only refusal is invisible
                      // to exactly the reader who cannot see the button is dead.
                      <button
                        className="btn"
                        type="button"
                        aria-disabled="true"
                        title={current.bookingRefusal}
                        aria-label={`${BOOKING_LABEL} — ${current.bookingRefusal}`}
                      >
                        {BOOKING_LABEL}
                      </button>
                    )}
                  </div>
                  {/* THE REFUSAL, in ONE line. It is on screen before anyone
                      reaches for a control, it changes nothing, and it stays —
                      no toast, no flash, nothing to outrun (⚖ 47). */}
                  <p className="rg-footnote" id={footnoteId}>
                    {props.actionFootnote}
                  </p>
                </div>
              </div>

              <div className="rg-body">
                <div className="rg-grid">
                  <div>
                    <div
                      className="rg-sec"
                      data-guide-title="取引の事実"
                      data-guide="この取引について記録されている事実です。どの予約の会計か、どこから受け付けたか、売上はいくらで、そのうちいくら受け取り、いくら残っているか。ここに出るのは記録された内容だけで、推測は入りません。"
                    >
                      <div className="rg-title">取引の事実</div>
                      <div className="rg-facts">
                        {current.facts.map((f) => (
                          <div className="rg-fact" key={f.label}>
                            <span>{f.label}</span>
                            <b className={f.tone}>{f.value}</b>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div
                      className="rg-sec"
                      data-guide-title="決済手段の台帳"
                      data-guide="お金がどの手段で動いたかを1行ずつ残したものです。返金は元の行を書き換えず、マイナスの行を足して残します。未収の行はお金が入っていないので、受領済みには数えません。"
                    >
                      <div className="rg-title">決済手段の台帳</div>
                      <div className="rg-tenders">
                        {current.tenders.map((t, i) => (
                          <div className={`rg-tender-row ${t.tone ?? ''}`} key={`${t.label}-${i}`}>
                            <span>{t.label}</span>
                            <b>{t.amount}</b>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div
                      className="rg-sec"
                      data-guide-title="予約時価格のスナップショット"
                      data-guide="予約を受けたときに確定した金額です。売上も返金もこの金額を正本にしていて、いまの公開価格が変わっても計算しなおしません。予約のない店頭販売にはスナップショットがないので、そう書きます。"
                    >
                      <div className="rg-title">予約時価格のスナップショット</div>
                      <p className="rg-proof">{current.priceProof}</p>
                    </div>

                    <div
                      className="rg-sec"
                      data-guide-title="返金・取消の内容"
                      data-guide="返金を実行したときに何が記録されるかを、実行する前に出しています。元の決済行はそのまま残り、同じ手段にマイナスの行が足されます。いまは見本データのため実行できませんが、何が起きるかは隠しません。"
                    >
                      <div className="rg-title">返金・取消の内容</div>
                      <div className="rg-preview">
                        {current.refundPreview && <b>{current.refundPreview}</b>}
                        <span>{current.refundNote}</span>
                      </div>
                    </div>

                    <div
                      className="rg-sec"
                      data-guide-title="閉店への影響"
                      data-guide="この取引が閉店を妨げているかどうかです。下の閉店チェックとまったく同じ判定を読んでいるので、ここと下で違うことを言うことはありません。"
                    >
                      <div className="rg-title">閉店への影響</div>
                      <p className="rg-impact">{current.closingImpact}</p>
                    </div>
                  </div>
                </div>

                <div
                  className="rg-hist"
                  data-guide-title="監査履歴"
                  data-guide="この取引に対して行われた操作の記録です。新しいものが先頭で、左から右へ時間をさかのぼります。会計、返金、端末の保持など、予約側に残った記録もここに合流します。"
                >
                  <div className="rg-title-row">
                    <div className="rg-title">監査履歴</div>
                    <span className="rg-order">新しい順</span>
                  </div>
                  {current.history.length === 0 ? (
                    <p className="rg-none">この取引の操作履歴はまだ記録されていません。</p>
                  ) : (
                    <div className="rg-hist-rows">
                      {current.history.map((h, i) => (
                        <div className="rg-history-row" key={i}>
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

      {/* 閉店 — the day's own end, full width under the workspace. A close
          belongs to ONE store, so under the storeless lens the room says that
          rather than merging two stores' drawers into a figure nobody can act
          on. The section still declares itself, so the tour explains why the
          panels are not there. */}
      {close ? (
        <>
        {/* 閉店 — the day's own end, full width under the workspace. */}
        <div className="rg-closing">
          <section
            className="rg-panel rg-cash"
            aria-labelledby="rgCashTitle"
            data-guide-title="現金ドロア"
            data-guide="現金の期待額は台帳の現金の行を足したもので、実査額は実際に数えた金額です。差異はその引き算で、記録されているのは数えた金額だけです。許容額を超える差異があるときは、理由と店舗管理者の承認がないと閉店できません。"
          >
            <div className="rg-panel-head">
              <div>
                <strong id="rgCashTitle">現金ドロア</strong>
                <span>期待額、実査額、差異理由を同じ計数記録へ保存します</span>
              </div>
              <span className={`pill ${close.cash.statusDone ? 'good' : 'warn'}`}>{close.cash.status}</span>
            </div>
            <div className="rg-cash-body">
              <div className="rg-cash-stats">
                <div className="rg-cash-stat">
                  <span>期待額</span>
                  <b className={close.cash.redacted ? 'redacted' : undefined}>{close.cash.expected}</b>
                </div>
                <div className="rg-cash-stat">
                  <span>実査額</span>
                  <b className={close.cash.redacted ? 'redacted' : undefined}>{close.cash.counted}</b>
                </div>
                <div className="rg-cash-stat">
                  <span>差異</span>
                  <b className={[close.cash.varianceBad ? 'bad' : '', close.cash.redacted ? 'redacted' : ''].filter(Boolean).join(' ') || undefined}>
                    {close.cash.variance}
                  </b>
                </div>
              </div>
              <div className="rg-facts rg-cash-facts">
                <div className="rg-fact">
                  <span>差異理由</span>
                  <b>{close.cash.reason}</b>
                </div>
                <div className="rg-fact">
                  <span>しきい値</span>
                  <b>{close.cash.tolerance}</b>
                </div>
              </div>
              {close.cash.canSave && (
                <div className="rg-cash-action">
                  {/* A WRITE — it records a count and a reason against the day. */}
                  <button
                    className="btn"
                    type="button"
                    aria-disabled="true"
                    title={close.cash.saveRefusal}
                    aria-label={`${close.cash.saveLabel} — ${close.cash.saveRefusal}`}
                    aria-describedby="rgClosingFootnote"
                  >
                    {close.cash.saveLabel}
                  </button>
                </div>
              )}
            </div>
          </section>

          <section
            className="rg-panel rg-close"
            aria-labelledby="rgCloseTitle"
            data-guide-title="閉店チェック"
            data-guide="その日を閉じる前に終わっていなければならないことの一覧です。どれか1つでも未完了なら閉店できず、その理由は閉店ボタンにもそのまま出ます。この判定は画面のどこで出しても同じひとつの計算です。"
          >
            <div className="rg-panel-head">
              <div>
                <strong id="rgCloseTitle">閉店チェック</strong>
                <span>店舗管理者の確認後に、その時点の台帳を閉じます</span>
              </div>
              <span className={`pill ${close.openCount === 0 ? 'good' : 'warn'}`}>{close.headline}</span>
            </div>
            <div className="rg-close-body">
              <div className="rg-checks">
                {close.checks.map((c) => (
                  <div className="rg-check" key={c.key}>
                    <span>
                      <strong>{c.label}</strong>
                      <span>{c.detail}</span>
                    </span>
                    <span className={`pill ${c.done ? 'good' : 'warn'}`}>{c.status}</span>
                  </div>
                ))}
              </div>

              <div className="rg-act-row rg-close-actions">
                {/* ⚑ R-1 — the 店舗管理者確認 page is SLICE B. The control says so
                    rather than pointing at a route that does not exist yet: an
                    honest refusal naming the next slice, never a dead href. */}
                {close.canClose && (
                  <>
                    <button
                      className="btn"
                      type="button"
                      aria-disabled="true"
                      title={close.signoffRefusal}
                      aria-label={`${close.signoffLabel} — ${close.signoffRefusal}`}
                      aria-describedby="rgClosingFootnote"
                    >
                      {close.signoffLabel}
                    </button>
                    {/* A WRITE, and the reason it refuses carries the checklist's
                        OWN blocker list — one verdict, rendered again. */}
                    <button
                      className="btn primary"
                      type="button"
                      aria-disabled="true"
                      title={close.closeRefusal}
                      aria-label={`${close.closeLabel} — ${close.closeRefusal}`}
                      aria-describedby="rgClosingFootnote"
                    >
                      {close.closeLabel}
                    </button>
                  </>
                )}
              </div>
              <p className="rg-footnote" id="rgClosingFootnote">
                {props.actionFootnote}
              </p>
            </div>
          </section>
        </div>

          {/* A PRESENTATIONAL BAND, and a `div` on purpose. It holds TWO
              declared sections — 閉店で記録される内容 and 決済手段の内訳 — so a
              `section aria-label="閉店で記録される内容"` around both was a landmark
              named after one of its two halves. The halves carry their own
              headings and their own tour declarations; the band carries the
              layout. */}
          <div className="rg-panel rg-record">
            <div className="rg-record-body">
            <div className="rg-grid rg-close-grid">
                <div
                  className="rg-sec"
                  data-guide-title="閉店で記録される内容"
                  data-guide="閉店を確定したときに、その時点の台帳から固定して残る内容です。実行できるようになる前に、何が記録されるのかを先に出しています。"
                >
                  <div className="rg-title">{close.recordLabel}</div>
                  <div className="rg-facts">
                    {close.record.map((r) => (
                      <div className="rg-fact" key={r.label}>
                        <span>{r.label}</span>
                        <b>{r.value}</b>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className="rg-sec"
                  data-guide-title="決済手段の内訳"
                  data-guide="受け取ったお金を決済手段ごとにまとめたものです。入った金額と戻した金額の合計が受領済みと一致していることを、閉店の前に確認します。"
                >
                  <div className="rg-title">決済手段の内訳</div>
                  <div className="rg-recon">
                    {close.reconciliation.map((r) => (
                      <div className="rg-recon-row" key={r.label}>
                        <span className="rg-recon-ch">{r.label}</span>
                        {/* Each figure carries its own word. Three bare numbers
                            in a row are unreadable without a header, and a
                            header row disappears the moment the band stacks on
                            a phone. */}
                        <span className="rg-recon-cell">
                          <em>受領</em>
                          <b>{r.received}</b>
                        </span>
                        <span className="rg-recon-cell">
                          <em>返金</em>
                          <b className="rg-recon-rev">{r.reversed}</b>
                        </span>
                        <span className="rg-recon-cell">
                          <em>差引</em>
                          <b>{r.net}</b>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className={`rg-impact${close.reconciliationBalanced ? '' : ' bad'}`}>
                    {close.reconciliationNote}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <section
          className="rg-panel rg-noclose"
          aria-label="閉店処理"
          data-guide-title="閉店処理"
          data-guide="閉店は店舗ごとに行います。いまは店舗を選んでいないため、現金ドロアと閉店チェックは表示していません。サイドバーで店舗を選ぶと、その店舗の閉店処理が出ます。"
        >
          <div className="rg-panel-head">
            <div>
              <strong>閉店処理</strong>
              <span>店舗を選ぶと表示されます</span>
            </div>
          </div>
          <p className="rg-noclose-note">{props.closeUnavailable}</p>
        </section>
      )}

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the board's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. The hole is one big
          box-shadow rather than a moved element, so the region stays fully lit
          and nothing on the page is re-laid-out to explain it — and no layer
          owns a scroller, so ⚖ page-scroll is untouched. */}
      {tourOpen && (
        <>
          <div
            className="rg-spot-catch"
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
              className="rg-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="rg-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="rg-spot-card"
            id="rgTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="rg-spot-text">{tourStep?.text ?? ''}</span>
            <div className="rg-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="rg-spot-foot">
              <button type="button" className="rg-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="rg-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="rg-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="rg-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

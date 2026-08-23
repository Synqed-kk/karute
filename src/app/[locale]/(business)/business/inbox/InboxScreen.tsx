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
// thread is open, and — ≤743 only — whether the reader is looking at the list
// or at the thread. All three are pure browsing. The two things canon keeps
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
import { useEffect, useMemo, useState } from 'react'
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
  /** The two standing explainer paragraphs, folded into the ? affordance. They
   *  were permanent furniture every reader re-read every morning to learn
   *  nothing new; on demand they are still the same words. */
  helpText: string
  actionFootnote: string
  refreshRefusal: string
}

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

export function InboxScreen(props: InboxProps) {
  const [filter, setFilter] = useState<ThreadFilter>('open')
  const [selected, setSelected] = useState<string | null>(null)
  // ≤743 ONLY, and view state rather than staged work: on a phone the list IS
  // the page and the thread is its own screen, so the room has to know which
  // of the two the reader is on. Nothing is written, nothing is meant to
  // survive a navigation, and above 743 both panels are on screen and this
  // flag styles nothing at all (inbox.css keeps its rules inside the band).
  const [detailOpen, setDetailOpen] = useState(false)

  const visible = useMemo(() => props.threads.filter((t) => matchesFilter(t, filter)), [props.threads, filter])
  // The open thread follows the list: a selection the current filter no longer
  // shows falls back to the first row rather than leaving the panel describing
  // something the reader cannot see (⚖ A10 — a surface lying about state).
  const current = visible.find((t) => t.id === selected) ?? visible[0] ?? null

  // The keyboard's own way back out of the phone detail view, alongside the
  // ← control. Bound only while that view is open, and removed with it.
  useEffect(() => {
    if (!detailOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [detailOpen])

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
    <div className={`${ROOT}${detailOpen && current ? ' is-detail' : ''}`}>
      <header className="ib-head">
        <div className="ib-eyebrow">{props.dateline}</div>
        <div className="ib-titleline">
          <h1>受信トレイ</h1>
          {/* The tour affordance. A hairline circle, never a filled one (⚖ R13),
              and its text is in the control's own accessible name as well as
              its title — the room's own standing-hint treatment, so a keyboard
              or a screen reader gets the same words a hover does. */}
          <button
            className="ib-help"
            type="button"
            title={props.helpText}
            aria-label={`このページの使い方 — ${props.helpText}`}
          >
            ?
          </button>
        </div>
        <p className="ib-subtitle">{props.subtitle}</p>
      </header>

      {/* 対応状況 — the numbers ARE the filters. Every counter presses the
          filter that shows exactly the rows it counted (COUNTER_FILTER, and
          `summarize` counts through the same predicate). */}
      <section className="ib-summary" aria-label="対応状況">
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
        <section className="ib-zero" aria-label="すべて対応済み">
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
          <section className="ib-panel ib-queue" aria-labelledby="ibQueueTitle">
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
              >
                最新状態を確認
              </button>
            </div>

            {/* QUIET TEXT, not buttons: a filter narrows a view, it does not act,
                so it gets no border and no fill — selected is an accent label
                plus a 2px accent underline. The strip wraps rather than panning,
                so no container in this room owns an axis at all (⚖ page-scroll). */}
            <div className="ib-filters" role="group" aria-label="対応キューの絞り込み">
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
                    type="button"
                    className={`ib-row${t.id === current?.id ? ' selected' : ''}`}
                    aria-pressed={t.id === current?.id}
                    onClick={() => {
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
                  <button className="ib-back" type="button" onClick={() => setDetailOpen(false)}>
                    ← 一覧へ戻る
                  </button>
                  <div className="ib-kicker">
                    {current.categoryLabel} / {current.statusLabel}
                  </div>
                  <h2 id="ibDetailTitle">{current.customerName}</h2>
                  <p>{current.subject}</p>
                </div>
                <div className="ib-act">
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
                        予約一覧で事実を確認
                      </Link>
                    ) : (
                      <button
                        className="btn"
                        type="button"
                        aria-disabled="true"
                        title="この空き待ちにはまだ予約がないため、予約一覧では確認できません。"
                      >
                        予約一覧で事実を確認
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
                    <p className="ib-recommend">{current.recommendedReason}</p>
                  </div>

                  <div>
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

                    {current.reply !== '' && (
                      <>
                        <div className="ib-title">返信の下書き</div>
                        {/* Shown, then refused. Hiding what the room WOULD send
                            would make the refusal unreadable — ⚖ 47 asks the
                            opposite. */}
                        <p className="ib-draft">
                          {current.customerName}様、{current.reply}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* 履歴 — full width beneath the pair, two fixed columns, with the
                    direction stated (新しい順) and a hairline connector across the
                    gap so two entries side by side read as one sequence rather
                    than as a two-column table. */}
                <div className="ib-hist">
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
    </div>
  )
}

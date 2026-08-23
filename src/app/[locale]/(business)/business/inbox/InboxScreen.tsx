'use client'

// 受信トレイ — canon's markup (fable-store-inbox.html), rendered from props the
// server already resolved. Structure and wording are canon's; every fact
// arrives as a formatted string, so this component holds no arithmetic, no
// clock and no data access.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: which filter chip is pressed and
// which thread is open. Both are canon's own interactions and both are pure
// browsing — the two things canon keeps that would need to SURVIVE a real
// navigation (a sent reply, a completed thread) are writes, and writes ship
// refused, so there is no staged state for a provider to hold above the screen.
// That is stated rather than assumed: if either action is ever connected, its
// staged result belongs above this component, not inside it (flag 30's class).
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
import { useMemo, useState } from 'react'
import {
  matchesFilter,
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
  headNote: string
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

  const visible = useMemo(() => props.threads.filter((t) => matchesFilter(t, filter)), [props.threads, filter])
  // The open thread follows the list: a selection the current filter no longer
  // shows falls back to the first row rather than leaving the panel describing
  // something the reader cannot see (⚖ A10 — a surface lying about state).
  const current = visible.find((t) => t.id === selected) ?? visible[0] ?? null

  return (
    <div className={ROOT}>
      <header className="ib-head">
        <div>
          <div className="ib-eyebrow">{props.dateline}</div>
          <h1>受信トレイ</h1>
          <p className="ib-subtitle">{props.subtitle}</p>
        </div>
        <p className="ib-note">{props.headNote}</p>
      </header>

      <section className="ib-summary" aria-label="対応状況">
        <div className="ib-summary-main">
          <strong>未完了の対応 {props.summary.open}件</strong>
          <span>期限、予約への影響、同意済み連絡先、配信証跡を確認してから送信します。</span>
        </div>
        <div className="ib-stat">
          <span>要対応</span>
          <b className={props.summary.attention > 0 ? 'attention' : undefined}>{props.summary.attention}</b>
        </div>
        <div className="ib-stat">
          <span>返信待ち</span>
          <b>{props.summary.waiting}</b>
        </div>
        <div className="ib-stat">
          <span>本日解決</span>
          <b>{props.summary.resolved}</b>
        </div>
        <div className="ib-stat">
          <span>配信失敗</span>
          <b className={props.summary.failures > 0 ? 'attention' : undefined}>{props.summary.failures}</b>
        </div>
      </section>

      <div className="ib-workspace">
        <section className="ib-panel" aria-labelledby="ibQueueTitle">
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

          {/* HORIZONTAL pan only (⚖ the page-scroll ruling): the chip strip owns
              its own x-axis so the page body never scrolls sideways, and no
              wrapper in this room caps a height or owns a y-axis. */}
          <div className="ib-filters" role="group" aria-label="対応キューの絞り込み">
            {props.filters.map((f) => (
              <button
                key={f.key}
                className="ib-filter"
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
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
                  onClick={() => setSelected(t.id)}
                >
                  <span className={`ib-mark ${t.markTone}`} aria-hidden="true">
                    {t.mark}
                  </span>
                  <span className="ib-copy">
                    <strong>
                      {t.customerName}
                      <span className="ib-no">{t.memberNumber}</span>
                    </strong>
                    <span className="ib-subject">{t.subject}</span>
                    <span className="ib-preview">{t.preview}</span>
                  </span>
                  <span className="ib-meta">
                    <time>{t.receivedLabel}</time>
                    <span className={PILL[t.status]}>{t.statusLabel}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {current && (
          <aside className="ib-panel ib-inspector" aria-labelledby="ibDetailTitle">
            <div className="ib-inspector-head">
              <div className="ib-kicker">
                {current.categoryLabel} / {current.statusLabel}
              </div>
              <h2 id="ibDetailTitle">{current.customerName}</h2>
              <p>{current.subject}</p>
            </div>
            <div className="ib-inspector-body">
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
              {/* The 顧客台帳's own record, in the 顧客 screen's own words — one
                  person's consent cannot read two ways in two rooms. 「—」 is
                  「まだ記録していない」 and is NOT 「同意なし」. */}
              <div className="ib-consent">
                {current.channels.map((c) => (
                  <div className="ib-channel" key={c.key}>
                    <span>{c.key}</span>
                    <b className={c.verdict}>{c.label}</b>
                  </div>
                ))}
              </div>
              <p className="ib-recommend">{current.recommendedReason}</p>

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
                  {/* Shown, then refused. Hiding what the room WOULD send would
                      make the refusal unreadable — ⚖ 47 asks the opposite. */}
                  <p className="ib-draft">
                    {current.customerName}様、{current.reply}
                  </p>
                </>
              )}

              <div className="ib-title">履歴</div>
              <div className="ib-history">
                {current.history.length === 0 ? (
                  <p className="ib-none">この対応の操作履歴はまだ記録されていません。</p>
                ) : (
                  current.history.map((h, i) => (
                    <div className="ib-history-row" key={i}>
                      <time>{h.time}</time>
                      <span>
                        <strong>{h.what}</strong>
                        <span>{h.detail}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="ib-actions">
                {/* A resolved thread's 次の対応 fact above already states the
                    outcome — 返信する behind an empty draft, or 今回は請求しない
                    on a closed case, are WORK levers naming work the record
                    says is done. Omission over a disabled pair is the smaller
                    honest surface here (⚖ overturned in part on adjudication:
                    only these two are work — 予約一覧で事実を確認 is a
                    read/navigation lever and stays, resolved or not). */}
                {current.status !== 'resolved' && (
                  <>
                    <button
                      className="btn"
                      type="button"
                      aria-disabled="true"
                      title={current.primaryRefusal}
                      aria-describedby={`ibRefusal-${current.id}`}
                    >
                      {current.primaryLabel}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      aria-disabled="true"
                      title={current.resolveRefusal}
                      aria-describedby={`ibResolve-${current.id}`}
                    >
                      {current.resolveLabel}
                    </button>
                  </>
                )}
                {current.bookingHref ? (
                  <Link className="btn ib-wide" href={current.bookingHref}>
                    予約一覧で事実を確認
                  </Link>
                ) : (
                  <button
                    className="btn ib-wide"
                    type="button"
                    aria-disabled="true"
                    title="この空き待ちにはまだ予約がないため、予約一覧では確認できません。"
                  >
                    予約一覧で事実を確認
                  </button>
                )}
              </div>
              {/* THE REFUSALS. They change nothing, they are on screen before
                  anyone reaches for the control, and they stay there — no toast,
                  no flash, nothing to outrun (⚖ 47). Gated with the WORK
                  buttons above, not the panel — a resolved thread's refusal
                  text would explain controls that are no longer there. */}
              {current.status !== 'resolved' && (
                <>
                  <p className="ib-refusal" id={`ibRefusal-${current.id}`}>
                    {current.primaryRefusal}
                  </p>
                  <p className="ib-refusal" id={`ibResolve-${current.id}`}>
                    {current.resolveRefusal}
                  </p>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

'use client'

// 売上分析 — canon's markup (fable-store-sales-analytics.html), rendered from
// props the server already resolved. Class names, wording and structure are
// canon's; every number arrives as a formatted string, so this component holds
// no arithmetic, no clock and no data access.
//
// WHAT IS CLIENT STATE HERE, and nothing else: which tab is showing, which
// ranking 指標 is pressed, whether the 内訳 panel is open, and which bar the
// pointer is on. All four are canon's own interactions.
//
// THE BOUNDARY is not a state here. A denied viewer is handed `denied` and the
// workspace is never rendered — the server decided, and there is nothing on the
// client to un-hide.

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CHART,
  barPath,
  clampTooltipLeft,
  clampTooltipTop,
  type ChartModel,
  type CompSegment,
  type RankMetric,
} from '@/business/lib/analytics'

/** The hover card's box, FIXED so its clamp is arithmetic rather than a
 *  measurement pass — and so the popup law can be asserted without a browser.
 *  Kept in step with `.viz-tooltip { width / height }` in analytics.css; that
 *  pair is the one place these two files have to agree. */
const TOOLTIP_W = 210
const TOOLTIP_H = 84

/** THE ROUTE WRAPPER. App Router keeps a segment's stylesheet in the document
 *  after a client-side navigation, so a route sheet that states a bare
 *  family-shared selector (`.panel`, `.page`) keeps restyling the room the
 *  reader walked into next. Every rule in analytics.css is scoped under this
 *  class, and this is the only node that carries it — so nothing this sheet
 *  says can reach another room, and none of it depends on being the last sheet
 *  inserted. (The other direction — another room's sheet reaching THIS one —
 *  is the same defect in every route sheet in the family and is fixed by the
 *  family-wide scoping sweep, not from here.) */
const ROOT = 'page pg-analytics'

/** One ranking table per 指標, all five resolved on the server — the 指標
 *  switch is a display choice, never a second read. */
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

export interface AnalyticsProps {
  denied: { title: string; message: string; backLabel: string; backHref: string } | null
  lensLabel?: string
  dateline?: string
  subtitle?: string
  period?: {
    label: string
    prevHref: string | null
    prevTitle: string
    nextHref: string | null
    nextTitle: string
  }
  scopes?: Array<{ key: string; label: string; pressed: boolean; disabled: boolean; title: string }>
  target?: {
    periodWord: string
    actual: string
    goal: string
    pacePercent: number
    paceText: string
    trace: string
  }
  attention?: { tone: 'amber' | 'indigo'; headline: string; line: string; comparison: string; whyRows: string[] }
  trend?: {
    chartSub: string
    chart: ChartModel
    chartMonths: Array<{ label: string; partial: boolean; asOf: string; total: string; nw: string }>
    gridLabels: string[]
    barLabels: string[]
    labelValues: string[]
    reading: string
    tableSub: string
    emptyBefore: string
    rows: Array<{ monthsAgo: number; label: string; tag: string | null; selected: boolean; cells: string[] }>
    statLabel: string
    statCells: string[]
    compositionSub: string
    menuSegments: CompSegment[]
    sourceSegments: CompSegment[]
    compositionEmpty: string
    liability: string
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
    rows: Array<{ label: string; closed: boolean; fromBoard: boolean; cells: string[] }>
    trailing: string | null
    foot: string
    boardNote: string | null
  }
  footnote?: string
}

const METRIC_HEADS = ['総合売上', '新規売上', '回収売上', '消化売上', '新規数', '既存数', '次回予約率', 'リピート率', '稼働率', 'LTV', '新規LTV']
const VIEWS = [
  { key: 'trend', label: '推移' },
  { key: 'rank', label: 'ランキング' },
  { key: 'daily', label: '日報' },
] as const
type ViewKey = (typeof VIEWS)[number]['key']

/** Canon's four segment colours: two series colours, the third categorical
 *  slot, then a NEUTRAL その他 bucket — never a fourth hue, which would read as
 *  another named category. */
const COMP_COLOR = [
  { bg: 'var(--indigo)', fg: '#fff' },
  { bg: 'var(--viz-new)', fg: '#fff' },
  { bg: 'var(--comp-gold)', fg: 'var(--ink)' },
  { bg: 'var(--section)', fg: 'var(--ink-3)' },
]

function CompBar({ label, segments, empty }: { label: string; segments: CompSegment[]; empty: string }) {
  if (segments.length === 0) {
    return (
      <div className="comp-block">
        <div className="comp-label">{label}</div>
        <p className="comp-empty">{empty}</p>
      </div>
    )
  }
  return (
    <div className="comp-block">
      <div className="comp-label">{label}</div>
      <div className="comp-bar">
        {segments.map((s, i) => {
          const color = COMP_COLOR[Math.min(i, COMP_COLOR.length - 1)]
          const pct = Math.round(s.share * 100)
          return (
            <div
              key={s.label}
              className="comp-seg"
              style={{ flex: `${Math.round(s.share * 1000)} 0 0`, background: color.bg, color: color.fg }}
              title={`${s.label} ${s.amount.toLocaleString('ja-JP')}円（${pct}%）`}
            >
              {/* selective direct label — only where it fits without clipping */}
              {s.share >= 0.12 ? `${pct}%` : ''}
            </div>
          )
        })}
      </div>
      <div className="comp-legend">
        {segments.map((s, i) => (
          <span className="comp-legend-item" key={s.label}>
            <span className="comp-swatch" style={{ background: COMP_COLOR[Math.min(i, COMP_COLOR.length - 1)].bg }} />
            <span>{`${s.label} ¥${s.amount.toLocaleString('ja-JP')}（${Math.round(s.share * 100)}%）`}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function AnalyticsScreen(props: AnalyticsProps) {
  const [view, setView] = useState<ViewKey>('trend')
  const [metric, setMetric] = useState<RankMetric>('total')
  const [whyOpen, setWhyOpen] = useState(false)
  const [tip, setTip] = useState<{ index: number; left: number; top: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const hideTip = useCallback(() => setTip(null), [])

  // A gesture that ENDS tears its own surface down — and so does a tab change
  // that takes the chart off screen while a card is still up (leaked gesture
  // state, the class the board was corrected for).
  useEffect(() => {
    if (view !== 'trend') setTip(null)
  }, [view])

  const showTip = useCallback((index: number, target: SVGPathElement) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const wrapBox = wrap.getBoundingClientRect()
    const barBox = target.getBoundingClientRect()
    const center = barBox.left - wrapBox.left + barBox.width / 2
    setTip({
      index,
      left: clampTooltipLeft(center, TOOLTIP_W, wrapBox.width),
      top: clampTooltipTop(barBox.top - wrapBox.top, TOOLTIP_H, wrapBox.height),
    })
  }, [])

  if (props.denied) {
    return (
      <div className={ROOT}>
        <section id="boundaryPanel">
          <h1 tabIndex={-1}>{props.denied.title}</h1>
          <p className="subtitle">{props.denied.message}</p>
          <Link href={props.denied.backHref} className="boundary-link">
            {props.denied.backLabel}
          </Link>
        </section>
      </div>
    )
  }

  const { dateline, subtitle, period, scopes, target, attention, trend, ranking, daily, footnote } = props
  if (!period || !scopes || !target || !attention || !trend || !ranking || !daily) return null

  const rank = ranking.byMetric[metric]
  const hovered = tip === null ? null : trend.chartMonths[tip.index]

  return (
    <div className={ROOT}>
      <header className="page-head">
        <div>
          <p className="dateline-note">{dateline}</p>
          <h1>売上分析</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div className="head-controls">
          <div className="period-row">
            <div className="period-nav" role="group" aria-label="対象月">
              {/* The step that cannot act stays a FOCUSABLE button carrying its
                  reason (canon's own ▶ treatment), not a `disabled` one — a
                  refusal nobody can reach with a keyboard is a refusal that
                  does not explain itself. */}
              {period.prevHref ? (
                <Link href={period.prevHref} className="period-step" aria-label="前の月" title={period.prevTitle}>
                  ◀
                </Link>
              ) : (
                <button type="button" className="period-step" aria-disabled="true" aria-label="前の月" title={period.prevTitle}>
                  ◀
                </button>
              )}
              <span className="label">{period.label}</span>
              {period.nextHref ? (
                <Link href={period.nextHref} className="period-step" aria-label="次の月" title={period.nextTitle}>
                  ▶
                </Link>
              ) : (
                <button type="button" className="period-step" aria-disabled="true" aria-label="次の月" title={period.nextTitle}>
                  ▶
                </button>
              )}
            </div>
            {/* 月次パックの書き出しは 売上・レジ の精算記録が要るため、見本データ
                では実行できません（L-7: 押せるのに何も起きないボタンは置かない）。 */}
            <button className="btn" type="button" disabled title="見本データのため実行できません">
              月次パックを書き出す
            </button>
          </div>
          {/* Same rule as the month step: a scope this world cannot serve is
              aria-disabled with its reason and stays reachable, rather than a
              pressable control that flips a state and renders nothing. */}
          <div className="seg" role="group" aria-label="表示範囲">
            {scopes.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={s.pressed}
                aria-disabled={s.disabled || undefined}
                title={s.title}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="target-strip" aria-label="目標と目標進捗">
        <div className="target-row">
          <span className="target-figures">
            {target.periodWord} <b>{target.actual}</b> / 目標 <b>{target.goal}</b>
          </span>
          <span className="target-pace">{target.paceText}</span>
        </div>
        <div className="target-bar">
          <div className="target-bar-fill" style={{ width: `${Math.min(target.pacePercent, 100)}%` }} />
        </div>
        <p className="target-trace">{target.trace}</p>
      </section>

      {/* The tone is the month's STATE, resolved on the server: amber while the
          month is still running, indigo once it is finished (canon's own amber
          emphasis, which a single indigo strip had flattened away). */}
      <section className={`attn ${attention.tone} attention${whyOpen ? ' expanded' : ''}`} aria-label="対象月の状況">
        <span className="attn-icon" aria-hidden="true">i</span>
        <span className="attention-body">
          <strong>{attention.headline}</strong>
          <span>{attention.line}</span>
          <span className="attention-compare">{attention.comparison}</span>
        </span>
        <button
          className="btn-why"
          type="button"
          aria-expanded={whyOpen}
          aria-controls="whyPanel"
          onClick={() => setWhyOpen((was) => !was)}
        >
          {whyOpen ? '内訳を閉じる' : '内訳を見る'}
        </button>
      </section>
      {whyOpen && (
        <div className="why-panel" id="whyPanel">
          {attention.whyRows.map((row) => (
            <div className="why-row" key={row}>{row}</div>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="売上分析のビュー">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className="tab"
            role="tab"
            id={`tab-${v.key}`}
            aria-selected={view === v.key}
            aria-controls={`view-${v.key}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* All three panels stay in the DOM and the unselected ones are `hidden`,
          canon's own structure — a tab whose aria-controls points at a node
          that is not there announces a panel the reader cannot reach. */}
      <section id="view-trend" role="tabpanel" aria-labelledby="tab-trend" hidden={view !== 'trend'}>
          <div className="panel">
            <div className="panel-head">
              <div>
                <strong>月次推移</strong>
                <span>{trend.chartSub}</span>
              </div>
            </div>
            <div className="viz-legend" aria-hidden="true">
              <span className="viz-legend-item"><span className="viz-swatch" style={{ background: 'var(--indigo)' }} />総合売上</span>
              <span className="viz-legend-item"><span className="viz-swatch" style={{ background: 'var(--viz-new)' }} />新規売上</span>
            </div>
            <div className="chart-wrap" ref={wrapRef}>
              <svg
                viewBox={`0 0 ${CHART.w} ${CHART.h}`}
                role="img"
                aria-label={`月次の総合売上と新規売上の推移（棒グラフ、${trend.chartMonths.length}か月分）`}
              >
                {trend.chart.gridLines.map((g, i) => (
                  <g key={`grid-${g.value}`}>
                    <line x1={CHART.ml} x2={CHART.w - CHART.mr} y1={g.y} y2={g.y} stroke="var(--section)" strokeWidth={1} />
                    <text x={CHART.ml - 8} y={g.y + 4} textAnchor="end" fontSize={11} fill="var(--quiet)">
                      {trend.gridLabels[i]}
                    </text>
                  </g>
                ))}
                {trend.chart.bars.map((b, i) => (
                  <path
                    key={`bar-${b.monthIndex}-${b.series}`}
                    className="bar"
                    tabIndex={0}
                    role="img"
                    aria-label={trend.barLabels[i]}
                    d={barPath(b.x, b.y, b.w, b.h)}
                    fill={b.series === 'total' ? 'var(--indigo)' : 'var(--viz-new)'}
                    onPointerEnter={(e) => showTip(b.monthIndex, e.currentTarget)}
                    onPointerLeave={hideTip}
                    onFocus={(e) => showTip(b.monthIndex, e.currentTarget)}
                    onBlur={hideTip}
                  />
                ))}
                {trend.chart.labels.map((l, i) => (
                  <text key={`lbl-${l.x}`} x={l.x} y={l.y} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--ink-3)">
                    {trend.labelValues[i]}
                  </text>
                ))}
                {trend.chart.axis.map((a) => (
                  <text key={`axis-${a.short}`} x={a.x} y={trend.chart.baselineY + 20} textAnchor="middle" fontSize={11} fill="var(--quiet)">
                    {a.short}
                  </text>
                ))}
                <line
                  x1={CHART.ml}
                  x2={CHART.w - CHART.mr}
                  y1={trend.chart.baselineY}
                  y2={trend.chart.baselineY}
                  stroke="var(--control)"
                  strokeWidth={1}
                />
              </svg>
              <div
                className={`viz-tooltip${hovered ? ' show' : ''}`}
                role="status"
                aria-live="polite"
                style={tip ? { left: `${tip.left}px`, top: `${tip.top}px` } : undefined}
              >
                {hovered && (
                  <>
                    <div className="tt-month">{`${hovered.label}${hovered.asOf}`}</div>
                    <div className="tt-row">
                      <span className="tt-key" style={{ background: 'var(--indigo)' }} />
                      <span className="tt-name">総合売上</span>
                      <span className="tt-val">{hovered.total}</span>
                    </div>
                    <div className="tt-row">
                      <span className="tt-key" style={{ background: 'var(--viz-new)' }} />
                      <span className="tt-name">新規売上</span>
                      <span className="tt-val">{hovered.nw}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            <p className="reading">{trend.reading}</p>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <strong>店舗の月次内訳</strong>
                <span>{trend.tableSub}</span>
              </div>
            </div>
            <div className="table-scroll">
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>対象月</th>
                    {METRIC_HEADS.map((h) => (<th key={h}>{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="quiet-row"><td colSpan={12}>{trend.emptyBefore}</td></tr>
                  {trend.rows.map((r) => (
                    <tr key={r.monthsAgo} className={r.selected ? 'selected-row' : undefined}>
                      <td>
                        {r.label}
                        {r.tag && <span className="month-tag">{r.tag}</span>}
                      </td>
                      {r.cells.map((c, i) => (<td key={METRIC_HEADS[i]}>{c}</td>))}
                    </tr>
                  ))}
                  <tr className="stat-row">
                    <td>{trend.statLabel}</td>
                    {trend.statCells.map((c, i) => (<td key={METRIC_HEADS[i]}>{c}</td>))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <strong>売上の内訳</strong>
                <span>{trend.compositionSub}</span>
              </div>
            </div>
            <div className="comp-body">
              <CompBar label="メニュー別（上位3 + その他）" segments={trend.menuSegments} empty={trend.compositionEmpty} />
              <CompBar label="予約経路別" segments={trend.sourceSegments} empty={trend.compositionEmpty} />
            </div>
            <div className="comp-liability">{trend.liability}</div>
          </div>
      </section>

      <section id="view-rank" role="tabpanel" aria-labelledby="tab-rank" hidden={view !== 'rank'}>
          <div className="panel">
            <div className="permission"><strong>表示範囲</strong> — {ranking.permission}</div>
            <div className="panel-head" style={{ borderTop: 0 }}>
              <div>
                <strong>スタッフランキング</strong>
                <span>{ranking.sub}</span>
              </div>
              <div className="seg" role="group" aria-label="ランキング指標">
                {ranking.metrics.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={metric === m.key}
                    onClick={() => setMetric(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {rank.rows.length === 0 ? (
              <p className="rank-empty">{ranking.empty}</p>
            ) : (
              <div className="table-scroll">
                <table className="rank-table">
                  <thead>
                    <tr>
                      <th>順位</th>
                      <th>スタッフ</th>
                      <th>{rank.aggregateLabel}</th>
                      <th>上位との差</th>
                      {ranking.monthHeads.map((h) => (
                        <th key={h.short}>
                          {h.short}
                          {h.tag && <span className="month-tag">{h.tag}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rank.rows.map((r) => (
                      <tr key={r.staffId}>
                        <td><span className={`rank-cell${r.rank === 1 ? ' r1' : ''}`}>{r.rank}</span></td>
                        <td>{r.name}</td>
                        <td>{r.aggregate}</td>
                        <td>{r.gap === null ? <span className="gap-leader">首位</span> : r.gap}</td>
                        {r.months.map((c, i) => (
                          <td key={ranking.monthHeads[i].short}>
                            {c.rank <= 3 && <span className={`month-badge b${c.rank}`}>{c.rank}</span>}
                            {c.value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="store-rank-note">{ranking.storeNote}</div>
            {ranking.ownLane && (
              <div className="own-lane-card">
                <strong>{ranking.ownLane.title}</strong>
                <p className="own-lane-sub">{ranking.ownLane.sub}</p>
                <div className="own-lane-stats">
                  {ranking.ownLane.stats.map((s) => (
                    <div className="own-lane-stat" key={s.label}>
                      <span>{s.label}</span>
                      <b>
                        {s.value}
                        {s.chip && <i>{s.chip}</i>}
                      </b>
                    </div>
                  ))}
                </div>
                <p className="own-lane-note">{ranking.ownLane.note}</p>
              </div>
            )}
          </div>
      </section>

      <section id="view-daily" role="tabpanel" aria-labelledby="tab-daily" hidden={view !== 'daily'}>
          <div className="panel">
            <div className="panel-head">
              <div>
                <strong>日報</strong>
                <span>{daily.sub}</span>
              </div>
            </div>
            <div className="table-scroll">
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>日付</th>
                    {METRIC_HEADS.map((h) => (<th key={h}>{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {daily.rows.map((r) => (
                    r.closed ? (
                      <tr className="quiet-row" key={r.label}>
                        <td>{r.label}</td>
                        <td colSpan={11}>定休日</td>
                      </tr>
                    ) : (
                      <tr key={r.label} className={r.fromBoard ? 'board-row' : undefined}>
                        <td>
                          {r.label}
                          {r.fromBoard && <span className="month-tag">本日</span>}
                        </td>
                        {r.cells.map((c, i) => (<td key={METRIC_HEADS[i]}>{c}</td>))}
                      </tr>
                    )
                  ))}
                  {daily.trailing && (
                    <tr className="quiet-row"><td colSpan={12}>{daily.trailing}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="panel-foot">
              {daily.foot}
              {/* Only said on a month that HAS a 本日 row — a note about a row
                  that is not in the table is a check lying about state. */}
              {daily.boardNote && (
                <>
                  <br />
                  {daily.boardNote}
                </>
              )}
            </div>
          </div>
      </section>

      <p className="footnote">{footnote}</p>
    </div>
  )
}

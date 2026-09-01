'use client'

// コーチング — the computer door onto the coaching system the phone app already
// carries. One truth, two doors: the metric spine, the honest findings, the band
// vocabulary and the privacy wall are all the phone's own, and every shape this
// screen renders MIRRORS a real generator output or a `contract.ts` view type,
// field for field, with its cite in `coaching.ts` and `fixtures-coaching.ts`.
// Nothing here is a shape this room invented — at reconnect the real generation
// slots in with no reshaping.
//
// ⚖ TWO SCREENS, ONE AT A TIME, AND THE SWAP IS THE PRIVACY BOUNDARY. 自分の
// コーチング is one person's own mirror — honest, evidenced, with the receipt.
// 全スタッフ表示 is the roster as BANDS. Stacking them would put a manager's
// board under a staff member's private detail on one scroll, which reads as one
// page about people; tabbed, the reader is never in doubt about which side of
// the wall they are standing on. A reader without 全スタッフ表示's capability has
// no tab row at all — canon's own boundary-rights sentence takes its place.
//
// ⚠ THE WALL IS NOT DRAWN HERE. `coaching-props.ts` builds the team board only
// for a reader who may see it, and `coaching.ts`'s `TriageRow` has no field for
// a per-staff number to travel in. This file cannot leak what it was never
// handed — every sentence below about what is hidden describes the payload, not
// a promise this component keeps.
//
// ⚖ NOTHING ON THIS PAGE WRITES. Coaching's generation costs money, its consent
// is a legal record and its depth-share is a permission somebody else owns, so
// every one of those levers ships REFUSED with its own reason naming the seam it
// waits on — never half-built behind a control whose only outcome is a toast.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: which tab is open, and which step
// of the 画面の説明 tour the reader is on. Both are pure browsing.
//
// CLASS NAMES ARE PREFIXED `cg-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and the
// neighbours state BARE `.biz .<name>` rules on the exact names a coaching page
// would want (`.panel`, `.stat`, `.card`, `.chip`, `.row`, `.summary`, `.empty`,
// `.spot-card`…). A fence that enumerates sixty shared names rots as the
// neighbours grow; not colliding at all cannot. `page` / `h1` / `btn` are the
// SHELL's and restated here, so those three are fenced in coaching.css at four
// levels.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import { keepCardOffHeading, type PerformanceBand } from '@/business/lib/coaching'

/** THE ROUTE WRAPPER. Every rule in coaching.css is scoped under this class, so
 *  nothing this sheet says can reach another room; `.page.pg-coaching` (four
 *  levels) rather than `.pg-coaching` (three) so a sibling's own three-level
 *  rule (`.biz .page .btn`, customers.css:23) cannot win the room back on
 *  insertion order. */
const ROOT = 'page pg-coaching'

/** ⚖ R6-20, CARRIED (room 6's `Overlay`). A dismiss-by-backdrop surface that
 *  mounts under a pointer already resting where its opener was will eat the
 *  SECOND press of a double-click and close itself instantly — and neither
 *  「the press began on the backdrop」 nor 「the browser called it a
 *  double-click」 can separate that press from a decision, because both are true
 *  of it. The gate is the moment the surface appeared: 500ms is the platform's
 *  own double-click interval (macOS and Windows defaults), so the window in
 *  which a second press still belongs to the first gesture is covered by
 *  construction rather than by a number chosen to fit a test.
 *
 *  The tour is this room's only such surface — its dim layer closes it on a tap
 *  that lands on nothing declared, and its opener is the ? it mounts on top of. */
const SETTLE_MS = 500

type Severity = 'priority' | 'watch' | 'strength'
/** personal-findings.ts:222 — the run's own four statuses. */
type RunStatus = 'findings' | 'routine_excellence' | 'capture_gap' | 'insufficient_data'

export interface CoachingStat { key: string; label: string; value: string }

/** personal-findings.ts:202-207 — ONE verbatim moment per finding, or none. */
export interface CoachingMoment { date: string; quote: string; speakerLabel: string }

/** personal-findings.ts:231-244 + its EVIDENCE_SCHEMA (:188-209), resolved. */
export interface CoachingFinding {
  id: string
  severity: Severity
  severityLabel: string
  category: string
  headline: string
  impact: string
  countLabel: string
  recommendation: string
  moment: CoachingMoment | null
  checklistItemMatched: string | null
  countWarning: string | null
  confidenceNote: string | null
}

export interface CoachingSelfReady {
  kind: 'ready'
  status: RunStatus
  statusTitle: string
  statusBody: string | null
  runHeadline: string
  sessionsLabel: string
  maturityNote: string | null
  stats: CoachingStat[]
  trendTitle: string
  trend: Array<{ label: string; value: number; display: string }>
  findings: CoachingFinding[]
  /** staff-focus.ts:163-176 FOCUS_L1, resolved. */
  focus: Array<{ category: string; categoryLabel: string; label: string; description: string; confidenceNote: string | null }>
  outcomes: { title: string; reasons: Array<{ reason: string; label: string; count: number }>; pendingLine: string | null }
  categoriesTitle: string
  /** contract.ts:83-94 CategoryScore, resolved. */
  categories: Array<{ key: string; label: string; score: number; topBenchmark: number | null; confidenceNote: string | null }>
  /** contract.ts:176-183 TeamPattern. */
  learnFromTop: Array<{ id: string; behavior: string; adoptionNote: string }>
  /** ⚖ THE VIEWER'S OWN GRANT, RESOLVED. Three strings rather than a boolean,
   *  because the screen holds no copy table — the same reason every band tone
   *  and every trajectory line arrives as a prop. */
  share: { stateLine: string; body: string; buttonLabel: string }
}

export type CoachingSelf = CoachingSelfReady | { kind: 'none'; statusTitle: string; statusBody: string }

/** contract.ts:236-245 OwnerTriageRow + staff-focus.ts:184-193's layer2_summary. */
export interface CoachingTriageRowProps {
  staffLabel: string
  band: PerformanceBand | null
  bandLabel: string
  bandTone: string
  maturityNote: string | null
  focusAreas: Array<{ label: string; summaryText: string; priority: 'high' | 'medium' | 'low' }>
  /** staff-focus.ts:144-145's OMIT remedy, said out loud rather than swallowed. */
  summaryWarning: string | null
  trajectoryLine: string
  action: { kind: 'assign-module' | 'manager-coaching' | 'peer-pairing'; label: string } | null
}

export interface CoachingTeam {
  framingLine: string
  counts: CoachingStat[]
  rows: CoachingTriageRowProps[]
  adoptionLine: string
  adoptionNote: string
  limitNote: string
}

export interface CoachingProps {
  dateline: string
  lensLabel: string
  windowLabel: string
  subtitle: string
  moduleOn: boolean
  dormantTitle: string
  dormantBody: string
  noticeLines: string[]
  selfTabLabel: string
  teamTabLabel: string
  canViewTeam: boolean
  teamBoundaryLine: string
  self: CoachingSelf
  team: CoachingTeam | null
  actionFootnote: string
  refusals: { regenerate: string; share: string; depth: string; settings: string }
  helpRefusals: Record<'assign-module' | 'manager-coaching' | 'peer-pairing', string>
}

/** The tour helpers, at the family's shape: a rect literal the engine
 *  understands, and two identity guards that keep the measuring effect from
 *  re-rendering itself forever. */
const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total
const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

export function CoachingScreen(props: CoachingProps) {
  const [tab, setTab] = useState<'self' | 'team'>('self')
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)
  const tourRectsRef = useRef<SpotRect[]>([])
  /** ⚠ STARTS AT INFINITY so the dim layer FAILS CLOSED: it refuses every press
   *  until the tour has actually been laid out. `Date.now()` in a `useRef`
   *  initializer would be an impure render (`react-hooks/purity`). */
  const settledAt = useRef(Number.POSITIVE_INFINITY)

  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  // ⚖ Liam 8/23 — 画面の説明. A section joins the walk by DECLARING
  // `data-guide-title` + `data-guide` ON ITSELF, so there is no list to keep in
  // sync: a section that renders is a section that is explained, and one that is
  // not on screen — the whole team board while the self tab is open, the spine
  // while a run reported too little, every panel at once while the module is
  // off — drops out of the walk and out of the N/M count by itself.
  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    // A step off screen is scrolled to before it is measured, or the spotlight
    // would cut its hole in empty space. The PAGE scrolls (⚖ page-scroll) — the
    // overlay adds no scroller of its own.
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 160 }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const at = keepCardOffHeading(spotCardAt(boxOf(r), size, viewport), size, boxOf(r), viewport)
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  // The settle stamp is taken in a layout effect, once per opening: after the
  // overlay is laid out, before the browser can deliver the second press of a
  // double-click on the ? underneath it.
  useLayoutEffect(() => {
    settledAt.current = tourOpen ? Date.now() : Number.POSITIVE_INFINITY
  }, [tourOpen])

  useEffect(() => {
    if (!tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTourIdx(-1)
      if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
      if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tourOpen])

  // The hole is drawn in viewport coordinates, so anything that moves the page
  // under it — a scroll, a resize, a band arriving — has to re-measure.
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
  // back on the ? it came from. `wasOpen` keeps the close half from firing on
  // the first render, when nothing was open and nothing should move.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (tourOpen) { wasOpen.current = true; tourNextRef.current?.focus(); return }
    if (!wasOpen.current) return
    wasOpen.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  /** A refused control, spelled ONCE. `aria-disabled` rather than `disabled`:
   *  the control stays focusable so its reason is reachable by keyboard and
   *  screen reader. The reason rides the ACCESSIBLE NAME as well as the title,
   *  because a screen reader drops `title` once `aria-describedby` is present.
   *
   *  ⚠ THE CLASSES ARE MERGED HERE and a call site must never write `className`
   *  after the spread — the room-5 F-K1 defect, which is why the merge is last. */
  const refused = (label: string, reason: string, className?: string) => ({
    type: 'button' as const,
    'aria-disabled': 'true' as const,
    title: reason,
    'aria-label': `${label} — ${reason}`,
    className: ['btn', className].filter(Boolean).join(' '),
  })

  const self = props.self
  const team = props.team
  const ready = self.kind === 'ready' ? self : null
  // personal-findings.ts:146-155 — a run with a status other than 'findings' has
  // nothing ranked to show, and says why instead. The spine still renders: the
  // metrics are the door's own facts, not the run's.
  const hasFindings = ready !== null && ready.status === 'findings' && ready.findings.length > 0

  return (
    <div className={ROOT} ref={rootRef}>
      {/* STEP 0. The head declares itself like every other section, so the walk
          opens on what this page is FOR before it starts pointing at parts of
          it — and its sentence is true on BOTH tabs, which is the room-5 F5-1
          rule: anything that belongs to one screen is declared on that screen's
          own element and drops with it. */}
      <header
        className="cg-head"
        data-guide-title="コーチング"
        data-guide="接客を振り返るための画面です。数字も気づきも、セッションの記録から出しています。一人ひとりの詳しい内容と会話の引用は、本人だけが見られます。"
      >
        <div className="cg-eyebrow">{props.dateline}</div>
        <div className="cg-titleline">
          <h1>コーチング</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one 今日の運営
              has. A hairline circle, never a filled one (⚖ R13). */}
          <button
            className="cg-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="cgTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
        </div>
        <p className="cg-sub">{props.subtitle}</p>
        <p className="cg-window">{props.windowLabel}のセッションを見ています</p>
        {/* ⚠ THE HEAD'S OWN ACTION IS THE LAST THING IN THE HEAD, and the sheet
            decides where it SITS. On a desk it rides the title line, right; at
            ≤743 it used to be pushed onto a full-width row BETWEEN the h1 and
            the sentence that explains the page, so the most prominent element
            under the title on a phone was a permanently refused control. Now
            the reading order is the same at every width: what this page is,
            what it covers, and only then the lever that is waiting on a seam. */}
        <button {...refused('コーチングの設定', props.refusals.settings, 'cg-settings')}>コーチングの設定</button>
      </header>

      {!props.moduleOn ? (
        /* ⚖ THE DORMANT STATE IS A DESIGNED STATE, not an empty page. It names
           the real reason — somebody has not switched this on for this store —
           and never a fake 「読み込み中」. */
        <section className="cg-dormant" data-guide-title="この店舗の状態" data-guide="この店舗でコーチングが使われていない、という表示です。分析もAIの処理も動いていないので、成績も気づきもここには出ません。">
          <span className="cg-kicker">未導入</span>
          <h2>{props.dormantTitle}</h2>
          <p>{props.dormantBody}</p>
        </section>
      ) : (
        <>
          {props.canViewTeam ? (
            <div
              className="cg-tabs"
              role="tablist"
              aria-label="表示の切り替え"
              data-guide-title="表示の切り替え"
              data-guide="自分の記録だけを見る画面と、店舗のスタッフ全体を見る画面を切り替えます。全スタッフ表示では、一人ひとりの数字は出ません。"
            >
              <button
                type="button"
                role="tab"
                id="cgTabSelf"
                aria-selected={tab === 'self'}
                aria-controls="cgPanelSelf"
                className={`cg-tab${tab === 'self' ? ' is-on' : ''}`}
                onClick={() => setTab('self')}
              >
                {props.selfTabLabel}
              </button>
              <button
                type="button"
                role="tab"
                id="cgTabTeam"
                aria-selected={tab === 'team'}
                aria-controls="cgPanelTeam"
                className={`cg-tab${tab === 'team' ? ' is-on' : ''}`}
                onClick={() => setTab('team')}
              >
                {props.teamTabLabel}
              </button>
            </div>
          ) : (
            /* canon's boundary-rights variant (fable-coaching.html:360-364), and
               it RENDERS rather than sitting `[hidden]`: for a staff member this
               is the true state of the page, so it is the state they get. */
            <p className="cg-boundary" data-guide-title="全スタッフ表示について" data-guide="店舗全体を見る画面は、権限のあるアカウントだけに表示されます。この画面では自分の記録だけを見ています。">
              {props.teamBoundaryLine}
            </p>
          )}

          {tab === 'self' ? (
            <div id="cgPanelSelf" role="tabpanel" aria-labelledby="cgTabSelf" className="cg-panel">
              {ready ? (
                <>
                  <section
                    className="cg-spine"
                    data-guide-title="あなたの成績"
                    data-guide="あなたのセッションから出した成績です。何回ぶんの分析なのかを必ず添えています。回数が少ないうちは荒削りで、増えるほど正確になります。"
                  >
                    <div className="cg-sec-head">
                      <h2 className="cg-sec-title">あなたの成績</h2>
                      <button {...refused('気づきを作り直す', props.refusals.regenerate, 'cg-regen')}>気づきを作り直す</button>
                    </div>
                    <div className="cg-stats">
                      {ready.stats.map((s) => (
                        <div className="cg-stat" key={s.key}>
                          <div className="cg-stat-label">{s.label}</div>
                          <div className="cg-stat-value">{s.value}</div>
                        </div>
                      ))}
                    </div>
                    <p className="cg-basis">
                      {ready.sessionsLabel}
                      {ready.maturityNote ? ` ・ ${ready.maturityNote}` : ''}
                    </p>
                  </section>

                  {ready.focus[0] && (
                    <section
                      className="cg-focus"
                      data-guide-title="次の一手"
                      data-guide="いま一番効く一つだけを出しています。あれもこれもではなく、次のセッションで試すことを一つに絞っています。"
                    >
                      <div className="cg-focus-head">
                        <span className="cg-kicker">次の一手</span>
                        <span className="cg-cat">{ready.focus[0].categoryLabel}</span>
                        {ready.focus[0].confidenceNote && <span className="cg-note-chip">{ready.focus[0].confidenceNote}</span>}
                      </div>
                      <h2 className="cg-sec-title">{ready.focus[0].label}</h2>
                      <p>{ready.focus[0].description}</p>
                    </section>
                  )}

                  <div className="cg-cols">
                    <section
                      className="cg-findings"
                      data-guide-title="気づき"
                      data-guide="良かった点も、直したほうがいい点も、そのまま出しています。それぞれに「何回中何回」という実際の回数と、そのときの会話の引用がついています。引用はあなただけが見られます。"
                    >
                      <h2 className="cg-sec-title">{ready.statusTitle}</h2>
                      {hasFindings ? (
                        <div className="cg-find-list">
                          {ready.findings.map((f) => (
                            <article className={`cg-find is-${f.severity}`} key={f.id}>
                              <div className="cg-find-head">
                                <span className={`cg-sev is-${f.severity}`}>{f.severityLabel}</span>
                                <span className="cg-cat">{f.category}</span>
                              </div>
                              <h3>{f.headline}</h3>
                              <p className="cg-find-impact">{f.impact}</p>
                              {f.checklistItemMatched && (
                                <p className="cg-find-check">
                                  <b>該当した確認項目</b>
                                  {f.checklistItemMatched}
                                </p>
                              )}
                              <p className="cg-find-fix">
                                <b>次にやること</b>
                                {f.recommendation}
                              </p>
                              {/* ⚠ THE COUNT IS THE RECEIPT, NOT A SECOND
                                  SENTENCE. `impact` and `comparison` are two
                                  generator fields with the same job — 「the
                                  quantified cost in plain words」 and 「the
                                  quantified impact in words」 — and rendered as
                                  adjacent paragraphs every card said its own
                                  numbers twice, back to back, which is the
                                  first thing a reader at the desk bar sees.
                                  Neither field is dropped (the room composes no
                                  sentence a generator owns): the count moves
                                  into the EVIDENCE group beside the quoted
                                  moment and takes a label, so it reads as the
                                  arithmetic behind the claim instead of a
                                  restatement of it. */}
                              <p className="cg-find-count">
                                <b>該当した回数</b>
                                {f.countLabel}
                              </p>
                              {f.countWarning && <p className="cg-find-warn">{f.countWarning}</p>}
                              {f.moment && (
                                <blockquote className="cg-quote">
                                  <span className="cg-quote-meta">
                                    そのときの会話（あなただけが見られます） ・ {f.moment.date} ・ {f.moment.speakerLabel}
                                  </span>
                                  <span className="cg-quote-text">{f.moment.quote}</span>
                                </blockquote>
                              )}
                              {f.confidenceNote && <p className="cg-find-caveat">{f.confidenceNote}</p>}
                            </article>
                          ))}
                        </div>
                      ) : (
                        /* ⚖ THE THREE NON-FINDING STATUSES ARE DESIGNED STATES.
                           A quiet window, a recorder gap and a too-short run are
                           three different facts, and the run itself says which
                           one it is — so the page never stretches a nitpick into
                           a finding to avoid an empty card. */
                        <div className="cg-status">
                          <p className="cg-status-head">{ready.runHeadline}</p>
                          {ready.statusBody && <p className="cg-status-body">{ready.statusBody}</p>}
                        </div>
                      )}
                    </section>

                    <div className="cg-side">
                      {ready.trend.length > 1 && (
                        <section
                          className="cg-trend"
                          data-guide-title="成約率の推移"
                          data-guide="月ごとの成約率です。他の人と比べるものではなく、自分のこれまでと比べるためのものです。"
                        >
                          <h2 className="cg-sec-title">{ready.trendTitle}</h2>
                          <ul className="cg-bars">
                            {ready.trend.map((p, i) => (
                              <li className="cg-bar" key={`${p.label}-${i}`}>
                                <span className="cg-bar-track">
                                  <span className="cg-bar-fill" style={{ height: `${Math.round(p.value * 100)}%` }} />
                                </span>
                                <span className="cg-bar-value">{p.display}</span>
                                <span className="cg-bar-label">{p.label}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}

                      <section
                        className="cg-outcomes"
                        data-guide-title="不成約の理由"
                        data-guide="決まらなかったときに記録した理由の内訳です。「後で決める」のまま終わった件数も、成約を逃しているポイントとして一緒に出しています。"
                      >
                        <h2 className="cg-sec-title">{ready.outcomes.title}</h2>
                        <ul className="cg-reasons">
                          {ready.outcomes.reasons.map((r) => (
                            <li className="cg-reason" key={r.reason}>
                              <span className="cg-reason-label">{r.label}</span>
                              <span className="cg-reason-count">{r.count}件</span>
                            </li>
                          ))}
                        </ul>
                        {ready.outcomes.pendingLine && <p className="cg-pending">{ready.outcomes.pendingLine}</p>}
                      </section>

                      {ready.categories.length > 0 && (
                        <section
                          className="cg-skills"
                          data-guide-title="会話スキル"
                          data-guide="会話の場面ごとの点数と、上位層の目安です。上位層が誰かは表示されません。項目の名前は業種ごとの言葉に合わせて変わります。"
                        >
                          <h2 className="cg-sec-title">{ready.categoriesTitle}</h2>
                          <ul className="cg-skill-list">
                            {ready.categories.map((c) => (
                              <li className="cg-skill" key={c.key}>
                                <span className="cg-skill-head">
                                  <span className="cg-skill-label">{c.label}</span>
                                  <span className="cg-skill-value">
                                    {c.score}
                                    {c.topBenchmark != null && <em> / 上位 {c.topBenchmark}</em>}
                                  </span>
                                </span>
                                <span className="cg-skill-track">
                                  <span className="cg-skill-fill" style={{ width: `${Math.min(c.score, 100)}%` }} />
                                  {c.topBenchmark != null && (
                                    <span className="cg-skill-mark" style={{ left: `${Math.min(c.topBenchmark, 100)}%` }} aria-hidden="true" />
                                  )}
                                </span>
                                {c.confidenceNote && <span className="cg-skill-note">{c.confidenceNote}</span>}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}

                      {/* ⚠ THE TOUR SENTENCE DESCRIBES THE PAYLOAD, and the
                          payload only. It used to add 「本人が許可したものだけが
                          並びます」 — a consent gate `TeamPattern`
                          (contract.ts:176-183) carries no field for and nothing
                          in this room applies, which broke this file's own
                          header rule three lines into it. What is left is what
                          the shape really guarantees: no name rides with a
                          technique. (VISIBILITY_MODEL §5's double consent
                          governs ATTRIBUTION, and these patterns are anonymous
                          by construction — so the promise was not merely
                          unbacked, it was a promise about a gate the design
                          does not need.) */}
                      {ready.learnFromTop.length > 0 && (
                        <section
                          className="cg-learn"
                          data-guide-title="上位層から学ぶ"
                          data-guide="成績の良いスタッフがやっていることを、名前を伏せた形で共有しています。誰のやり方かは分かりません。"
                        >
                          <h2 className="cg-sec-title">上位層から学ぶ</h2>
                          <ul className="cg-learn-list">
                            {ready.learnFromTop.map((p) => (
                              <li className="cg-learn-item" key={p.id}>
                                <span className="cg-learn-behavior">{p.behavior}</span>
                                <span className="cg-learn-note">{p.adoptionNote}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}

                      {/* ⚖ THE GRANT IS THE STAFF MEMBER'S OWN, AND IT IS READ
                          — the state sentence, the body and the button label
                          all come from `SelfView.grant`, the viewer's own plane
                          row. It used to be a hardcoded 「現在オフ」, which told
                          a staff member whose row says `granted` that nothing
                          was shared while the same payload counted them among
                          the staff who had allowed it.
                          Default OFF for everyone, always; a manager can only
                          ask a person face to face — there is deliberately no
                          request button on this page, because an in-app nag is
                          the coercion the visibility model rules out. */}
                      <section
                        className="cg-share"
                        data-guide-title="マネージャーへの共有"
                        data-guide="自分から許可したときだけ、店長が「どの場面を伸ばすとよいか」を見られるようになります。会話の引用は許可しても渡りません。断っても勤務には影響せず、断ったことは誰にも表示されません。"
                      >
                        <h2 className="cg-sec-title">マネージャーへの共有</h2>
                        <p className="cg-share-state">{ready.share.stateLine}</p>
                        <p className="cg-share-body">{ready.share.body}</p>
                        <button {...refused(ready.share.buttonLabel, props.refusals.share, 'cg-share-btn')}>
                          {ready.share.buttonLabel}
                        </button>
                      </section>
                    </div>
                  </div>
                </>
              ) : (
                <section
                  className="cg-state"
                  data-guide-title="まだ表示できないもの"
                  data-guide="分析されたセッションがまだない状態です。記録がたまると、成績と気づきがここに出ます。"
                >
                  <h2 className="cg-sec-title">{self.statusTitle}</h2>
                  <p>{self.statusBody}</p>
                </section>
              )}
            </div>
          ) : (
            team && (
              <div id="cgPanelTeam" role="tabpanel" aria-labelledby="cgTabTeam" className="cg-panel">
                <section
                  className="cg-framing"
                  data-guide-title="全スタッフ表示の見かた"
                  data-guide="一人ひとりの成約率や回数は表示しません。本人のこれまでと比べてどうかという区分だけを出し、サポートが必要な人には必ずできることを一つ添えています。"
                >
                  <p className="cg-framing-line">{team.framingLine}</p>
                  <div className="cg-stats">
                    {team.counts.map((c) => (
                      <div className="cg-stat" key={c.key}>
                        <div className="cg-stat-label">{c.label}</div>
                        <div className="cg-stat-value">{c.value}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section
                  className="cg-board"
                  data-guide-title="スタッフの状況"
                  data-guide="スタッフごとの区分です。順位はつけません。数字も出しません。サポートが必要と出ている人には、その場でできることが並びます。"
                >
                  <h2 className="cg-sec-title">スタッフの状況</h2>
                  {/* ⚠ ONE CALL, RENDERED TWICE (⚖ A8). A row's support state is
                      the PRESENCE of its paired action and nothing else — a
                      second boolean read alongside it is exactly the 「chip said
                      ✓, drop refused」 disease, and it would be the one place on
                      screen where the 1:1 pairing could come apart. */}
                  <ul className="cg-rows">
                    {team.rows.map((r, i) => (
                      <li className={`cg-row${r.action ? ' is-support' : ''}`} key={`${r.staffLabel}-${i}`}>
                        <span className="cg-row-name">{r.staffLabel}</span>
                        <span className="cg-row-band">
                          <span className={`cg-chip ${r.bandTone}`}>{r.bandLabel}</span>
                          {r.maturityNote && <span className="cg-note-chip">{r.maturityNote}</span>}
                        </span>
                        <span className="cg-row-body">
                          <span className="cg-row-line">{r.trajectoryLine}</span>
                          {/* staff-focus.ts:159 — categorical only, no number,
                              no name. This is the ONE per-staff sentence an
                              owner may read, and it is the generator's own. */}
                          {r.focusAreas.map((f) => (
                            <span className="cg-row-focus" key={f.label}>
                              <span className="cg-cat">{f.label}</span>
                              <span>{f.summaryText}</span>
                            </span>
                          ))}
                          {/* ⚠ AN OMITTED SENTENCE IS SAID, NOT SWALLOWED —
                              the L2 leak guard's own honesty half. */}
                          {r.summaryWarning && <span className="cg-row-warn">{r.summaryWarning}</span>}
                        </span>
                        {r.action && (
                          <button {...refused(r.action.label, props.helpRefusals[r.action.kind], 'cg-row-act')}>{r.action.label}</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>

                <section
                  className="cg-adoption"
                  data-guide-title="共有の状況"
                  data-guide="深い共有を許可しているスタッフの人数だけを表示します。誰が許可していないかは出しません。許可された内容を開く画面は、権限の仕組みができてから使えるようになります。"
                >
                  <h2 className="cg-sec-title">共有の状況</h2>
                  <p className="cg-adoption-line">{team.adoptionLine}</p>
                  <p className="cg-adoption-note">{team.adoptionNote}</p>
                  <button {...refused('共有された内容を見る', props.refusals.depth, 'cg-depth')}>共有された内容を見る</button>
                  <p className="cg-limit">{team.limitNote}</p>
                </section>
              </div>
            )
          )}

          <p className="cg-foot">{props.actionFootnote}</p>
        </>
      )}

      <section className="cg-notice" data-guide-title="この画面の見え方" data-guide="この画面で見えるもの・見えないものの説明です。会話の録音と文字起こしは、誰の画面にも表示されません。">
        {props.noticeLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>

      {tourOpen && (
        <>
          <div
            className="cg-spot-catch"
            onClick={(e) => {
              // ⚖ R6-20 — a press that arrives inside the settle window belongs
              // to the gesture that OPENED the tour, not to a decision to close
              // it. Ignored entirely, so the tour survives a double-click on ?.
              if (Date.now() - settledAt.current < SETTLE_MS) return
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
              className="cg-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="cg-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="cg-spot-card"
            id="cgTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="cg-spot-text">{tourStep?.text ?? ''}</span>
            <div className="cg-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="cg-spot-foot">
              <button type="button" className="cg-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="cg-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="cg-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="cg-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

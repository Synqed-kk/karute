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
  /** personal-findings.ts:242-243, RESOLVED — never an id at a reader. */
  moduleTitle: string | null
  patternBehavior: string | null
}

/** top-performer-patterns.ts:145-164, resolved. ⚠ NO SOURCE NAME — the shape
 *  has no field for one (COACHING_VISIBILITY_MODEL:123). */
export interface CoachingPatternEntry {
  title: string
  behavior: string
  example: string
  transferability: string
  adoptionNote: string
  confidenceNote: string | null
}

/** learning-module.ts:154-172, resolved. ⚠ NO ASSIGNMENT STATE — that is a
 *  write, and it stays the board's refused help action. */
export interface CoachingModuleCard {
  moduleId: string
  title: string
  description: string
  durationLabel: string
  basisLabel: string
  steps: Array<{ step: number; title: string; detail: string }>
  isMine: boolean
}

/** contract.ts:273-279 StoreMetricLift, resolved — every display pre-formatted
 *  by the props file, so this screen holds no formatter and no currency. */
export interface CoachingRoiLift {
  key: string
  label: string
  liftDisplay: string
  beforeDisplay: string
  afterDisplay: string
  confidence: 'none' | 'early' | 'building' | 'mature'
  confidenceLabel: string
  horizonNote: string
}

export interface CoachingSelfReady {
  kind: 'ready'
  /** coaching-consent/types.ts:7-16, resolved to the sentences the reader gets.
   *  ⚖ COACHING IS OPT-IN AND THE PAGE SAYS SO. */
  consent: { status: 'unset' | 'granted' | 'declined'; title: string; body: string; cta: string }
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
  /** staff-focus.ts:163-176 FOCUS_L1, resolved — the WHOLE list (≤3), not just
   *  the hero. The room still leads with one; #2 and #3 ride as a quiet list. */
  focus: Array<{ category: string; categoryLabel: string; label: string; description: string; confidenceNote: string | null; moduleTitle: string | null }>
  /** staff-focus.ts:200-204 — strengths, each citing its evidencing metric. */
  strengths: Array<{ label: string; detail: string }>
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
  /** ⚖ PLAIN LABELLED COUNTS OF STAFF, no rank grammar anywhere. */
  focusRanking: { title: string; note: string; rows: CoachingStat[]; emptyLine: string }
  adoptionLine: string
  adoptionNote: string
  limitNote: string
}

/** contract.ts:281-296 StoreCoachingRoi, resolved. STORE AGGREGATE ONLY — there
 *  is no staff field anywhere in this shape. */
export interface CoachingRoi {
  heroLabel: string
  hero: CoachingRoiLift
  heroSub: string
  confidenceLead: string
  trendTitle: string
  trendSub: string
  treatedLabel: string
  controlLabel: string
  trend: { treated: number[]; control: number[]; labels: string[]; startFraction: number }
  liftsTitle: string
  liftsSub: string
  lifts: CoachingRoiLift[]
  /** ⚖ THE ARITHMETIC, IN WORDS. Rendered whenever a lift is — a claimed lift
   *  without its method is the overclaim this whole screen exists not to make. */
  honestyNote: string
  pitchTitle: string
  pitchSub: string | null
  pitchWithheld: string | null
}

export interface CoachingProps {
  dateline: string
  lensLabel: string
  windowLabel: string
  subtitle: string
  /** ⚖ WHOSE EYES — one quiet always-visible line naming the reading role. */
  viewerLine: string
  /** ⚖ THE THREE-WAY ROLE PREVIEW. `null` in production: absent from the DOM,
   *  not hidden — `coaching-dev-preview` guard rail 4. */
  preview: {
    label: string
    note: string
    realLabel: string
    realHref: string
    current: string
    isOverridden: boolean
    roles: Array<{ role: string; href: string }>
  } | null
  moduleOn: boolean
  dormantTitle: string
  dormantBody: string
  noticeLines: string[]
  privacyBadge: string
  selfTabLabel: string
  teamTabLabel: string
  roiTabLabel: string
  canViewTeam: boolean
  canViewRoi: boolean
  teamBoundaryLine: string
  self: CoachingSelf
  team: CoachingTeam | null
  roi: CoachingRoi | null
  transparency: {
    title: string
    subtitle: string
    missionTitle: string
    missionBody: string
    staffOnlyTitle: string
    staffOnlyLead: string
    staffOnly: readonly string[]
    ownerVisibleTitle: string
    ownerVisibleLead: string
    ownerVisible: readonly string[]
    synqedTitle: string
    synqedIntro: string
    synqed: readonly string[]
    retentionLabel: string
    retentionBody: string
    deletionTitle: string
    deletionBody: string
    deletionCta: string
    reviewCta: string
  }
  patterns: { title: string; subtitle: string; note: string | null; emptyLine: string; shelves: Array<{ key: string; title: string; description: string; entries: CoachingPatternEntry[] }> } | null
  modules: { title: string; subtitle: string; calloutTitle: string; calloutBody: string; mineLabel: string; cards: CoachingModuleCard[] } | null
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

/** ⚖ THE TREATED-VS-CONTROL CHART (audit #18) — the picture that makes the
 *  honesty claim LEGIBLE. `DataDrivenOwnerRoi.tsx:46-78`'s TrendChart, carried
 *  with its own audit fix intact: each series is guarded for ≥2 points
 *  INDEPENDENTLY (`:48-50`), because a single-point series divides by
 *  `length - 1` and produces NaN coordinates that render as nothing while
 *  claiming to render a line.
 *
 *  ⚠ THE ACCENT IS NOT SPENT HERE. Both series are DATA colours — CLAUDE.md's
 *  one-way accent law carves out 「chart/data colours」 — and the sheet gives
 *  the treated line the ink weight rather than the brand blue, so nothing on
 *  this chart reads as pressable. */
function RoiChart({
  treated,
  control,
  labels,
  startFraction,
}: {
  treated: number[]
  control: number[]
  labels: string[]
  startFraction: number
}) {
  if (treated.length < 2 || control.length < 2) return null
  const all = [...treated, ...control]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = max - min || 1
  const W = 320
  const line = (pts: number[]) =>
    pts
      .map((v, i) => {
        const x = 6 + (i / (pts.length - 1)) * (W - 12)
        const y = 10 + (1 - (v - min) / range) * 60
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  return (
    <div className="cg-chart">
      <svg
        viewBox="0 0 320 84"
        width="100%"
        height="84"
        preserveAspectRatio="none"
        role="img"
        aria-label={`この店舗と他店舗平均の推移。${labels[0] ?? ''}から${labels[labels.length - 1] ?? ''}まで。`}
      >
        <line x1="0" y1="72" x2="320" y2="72" className="cg-chart-axis" />
        <polyline points={line(control)} className="cg-chart-control" fill="none" />
        <polyline points={line(treated)} className="cg-chart-treated" fill="none" />
      </svg>
      {/* The coaching-start marker, positioned by the fraction the plane states
          rather than by an index this component would have to keep in sync. */}
      <span className="cg-chart-mark" style={{ left: `${Math.round(startFraction * 100)}%` }} aria-hidden="true" />
      <div className="cg-chart-axis-labels">
        <span>{labels[0] ?? ''}</span>
        <span>{labels[labels.length - 1] ?? ''}</span>
      </div>
    </div>
  )
}

export function CoachingScreen(props: CoachingProps) {
  const [tab, setTab] = useState<'self' | 'team' | 'roi'>('self')
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

  /** ⚖ THE OPEN TAB IS CLAMPED TO WHAT THIS READER MAY SEE, AND IT FAILS
   *  CLOSED. The role preview re-renders the page AS another persona without
   *  remounting it, so a reader standing on 全スタッフ表示 who switches to
   *  スタッフ would otherwise keep a tab open that their payload has no panel
   *  for — a blank screen where a refusal belongs. Clamping to 自分の
   *  コーチング is the same answer the capability itself gives: the board was
   *  never built, so there is nothing to fall back to but your own screen.
   *  ⚠ IT READS THE CAPABILITY, NOT THE PAYLOAD'S NULLNESS — `canViewTeam` is
   *  the fact; `team === null` is one of its consequences. */
  const activeTab = tab === 'team' && !props.canViewTeam ? 'self' : tab === 'roi' && !props.canViewRoi ? 'self' : tab

  /** ⚖ THE PRIVACY MARKER, ON EVERY SECTION THAT IS L1 (audit #10). The phone
   *  repeats 「あなただけが見ることができます」 on ten cards; this room said it
   *  twice in prose and marked no section at all, so a reader scanning the desk
   *  could not tell which panels are theirs alone. ONE element, from ONE prop,
   *  so the promise cannot come apart card by card — and it goes ONLY on the
   *  sections the payload really keeps private: not on 上位層から学ぶ (anonymous
   *  team content), not on the pattern library, not on the catalog. */
  const lock = <span className="cg-lock">{props.privacyBadge}</span>
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
        {/* ⚖ WHOSE EYES IS THIS? — the audit's §3 found no viewer-identity
            label anywhere in either system. Quiet, in the family's grammar,
            beside the window it already states: two facts about the READING
            rather than about the data, on one line each. It is true in
            production, where there is no preview and the role is the reader's
            own — orientation, not a dev affordance. */}
        <p className="cg-viewer">{props.viewerLine}</p>
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

      {/* ⚖ THE ROLE PREVIEW — `coaching-dev-preview/*` mirrored, three ways.
          ABSENT in production, never hidden: `props.preview` is null when the
          build-time gate is off, so there is no DOM node to find (guard rail 4).

          ⚠ LINKS, NOT A CLIENT STORE, and that is deviation C8L-3. On the phone
          the override is a client render-shell swap over data RLS has already
          scoped. Here the visibility wall is built ABOVE the serializer — the
          board is never CONSTRUCTED for a reader without the capability — so a
          client-side swap would have to ship every persona's payload to every
          reader, which is the one thing this room is built not to do. A link
          re-runs the server assembly as that persona, and each persona's
          payload still holds only what that persona may see.

          ⚠ AND IT IS HONEST ABOUT ITSELF: 開発用 in the pill, the real role
          always first and always labelled 実（…）, and a sentence saying it
          changes the DISPLAY and not the permissions. */}
      {props.preview && (
        <nav className={`cg-preview${props.preview.isOverridden ? ' is-on' : ''}`} aria-label="コーチング表示ロールの切り替え（開発用）">
          <span className="cg-preview-tag">{props.preview.label}</span>
          <a className={`cg-preview-chip${props.preview.isOverridden ? '' : ' is-on'}`} href={props.preview.realHref}>
            {props.preview.realLabel}
          </a>
          {props.preview.roles.map((r) => (
            <a
              key={r.role}
              className={`cg-preview-chip${props.preview!.isOverridden && props.preview!.current === r.role ? ' is-on' : ''}`}
              href={r.href}
              aria-current={props.preview!.isOverridden && props.preview!.current === r.role ? 'true' : undefined}
            >
              {r.role}
            </a>
          ))}
          <span className="cg-preview-note">{props.preview.note}</span>
        </nav>
      )}

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
                aria-selected={activeTab === 'self'}
                aria-controls="cgPanelSelf"
                className={`cg-tab${activeTab === 'self' ? ' is-on' : ''}`}
                onClick={() => setTab('self')}
              >
                {props.selfTabLabel}
              </button>
              <button
                type="button"
                role="tab"
                id="cgTabTeam"
                aria-selected={activeTab === 'team'}
                aria-controls="cgPanelTeam"
                className={`cg-tab${activeTab === 'team' ? ' is-on' : ''}`}
                onClick={() => setTab('team')}
              >
                {props.teamTabLabel}
              </button>
              {/* ⚖ THE THIRD SCREEN IS THE OWNER'S OWN, AND IT IS A SEPARATE
                  CAPABILITY. 「Does this pay for itself」 is the question of the
                  person who pays; a 店舗管理者 has no tab here, so the tab row
                  itself is the difference between the two manager personas the
                  preview walks. */}
              {props.canViewRoi && (
                <button
                  type="button"
                  role="tab"
                  id="cgTabRoi"
                  aria-selected={activeTab === 'roi'}
                  aria-controls="cgPanelRoi"
                  className={`cg-tab${activeTab === 'roi' ? ' is-on' : ''}`}
                  onClick={() => setTab('roi')}
                >
                  {props.roiTabLabel}
                </button>
              )}
            </div>
          ) : (
            /* canon's boundary-rights variant (fable-coaching.html:360-364), and
               it RENDERS rather than sitting `[hidden]`: for a staff member this
               is the true state of the page, so it is the state they get. */
            <p className="cg-boundary" data-guide-title="全スタッフ表示について" data-guide="店舗全体を見る画面は、権限のあるアカウントだけに表示されます。この画面では自分の記録だけを見ています。">
              {props.teamBoundaryLine}
            </p>
          )}

          {activeTab === 'self' ? (
            <div id="cgPanelSelf" role="tabpanel" aria-labelledby="cgTabSelf" className="cg-panel">
              {ready ? (
                <>
                  {/* ⚖ COACHING IS OPT-IN, AND THE PAGE SAYS SO — first thing
                      on your own screen, because it is the question that comes
                      before every number under it. The room already refused the
                      DEPTH-SHARE; it never said the ANALYSIS ITSELF is yours to
                      allow, so the page read as if coaching simply happens to
                      you. The DECISION is read from the viewer's own record;
                      the CONTROL stays refused, because writing a consent
                      record is a legal act. */}
                  <section
                    className={`cg-consent is-${ready.consent.status}`}
                    data-guide-title="コーチングを受けることへの同意"
                    data-guide="あなたのセッションをAIが分析してよいかどうかは、あなたが決めます。断っても勤務には影響しませんし、断ったことは誰にも表示されません。"
                  >
                    <h2 className="cg-sec-title">{ready.consent.title}</h2>
                    <p className="cg-consent-body">{ready.consent.body}</p>
                    <button {...refused(ready.consent.cta, props.refusals.share, 'cg-consent-btn')}>{ready.consent.cta}</button>
                  </section>

                  <section
                    className="cg-spine"
                    data-guide-title="あなたの成績"
                    data-guide="あなたのセッションから出した成績です。何回ぶんの分析なのかを必ず添えています。回数が少ないうちは荒削りで、増えるほど正確になります。"
                  >
                    <div className="cg-sec-head">
                      <h2 className="cg-sec-title">あなたの成績</h2>
                      {lock}
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
                        {lock}
                      </div>
                      <h2 className="cg-sec-title">{ready.focus[0].label}</h2>
                      <p>{ready.focus[0].description}</p>
                      {/* staff-focus.ts:173 — the module this focus points at,
                          by NAME. Before this round `module_id` was a reference
                          into nothing; the catalog below is where it lands. */}
                      {ready.focus[0].moduleTitle && (
                        <p className="cg-focus-mod">
                          <b>練習するもの</b>
                          {ready.focus[0].moduleTitle}
                        </p>
                      )}
                      {/* ⚖ ONE THING AT A TIME STAYS THE RULE — the hero is
                          still one. But staff-focus.ts:199 allows three and the
                          room RESOLVED all three and rendered one, throwing the
                          rest away (audit #31). They ride here, quiet and
                          secondary, so nothing the run produced is discarded
                          and nothing competes with the one move. */}
                      {ready.focus.length > 1 && (
                        <div className="cg-focus-next">
                          <b>そのあとに効くもの</b>
                          <ul>
                            {ready.focus.slice(1).map((f) => (
                              <li key={f.label}>
                                <span className="cg-cat">{f.categoryLabel}</span>
                                <span>{f.label}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  )}

                  {/* ⚖ あなたの強み (audit §5 rank 4) — the shape is in
                      staff-focus.ts:200-204 and the data has been sitting in
                      this room's own plane since the build round, resolved and
                      thrown away. Honest-not-sweet: 「detail MUST cite the
                      evidencing metric/pattern」 is the module's own rule, so
                      every strength here arrives with its receipt. It is NOT a
                      consolation list — the ranked findings already carry
                      severity 'strength' — it is what the focus run separately
                      concluded you are good at. */}
                  {ready.strengths.length > 0 && (
                    <section
                      className="cg-strengths"
                      data-guide-title="あなたの強み"
                      data-guide="うまくいっている点です。ほめるためではなく、何が効いているのかを続けられるように、根拠になった数字を必ず添えています。"
                    >
                      <div className="cg-sec-head">
                        <h2 className="cg-sec-title">あなたの強み</h2>
                        {lock}
                      </div>
                      <ul className="cg-strength-list">
                        {ready.strengths.map((s) => (
                          <li className="cg-strength" key={s.label}>
                            <span className="cg-strength-label">{s.label}</span>
                            <span className="cg-strength-detail">{s.detail}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <div className="cg-cols">
                    <section
                      className="cg-findings"
                      data-guide-title="気づき"
                      data-guide="良かった点も、直したほうがいい点も、そのまま出しています。それぞれに「何回中何回」という実際の回数と、そのときの会話の引用がついています。引用はあなただけが見られます。"
                    >
                      <div className="cg-sec-head">
                        <h2 className="cg-sec-title">{ready.statusTitle}</h2>
                        {lock}
                      </div>
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
                              {/* personal-findings.ts:242-243 — THE LOOP,
                                  CLOSED. The run links each finding to the
                                  module and the top-performer pattern that fix
                                  it; both fields rode in this room's plane and
                                  reached no screen (audit #81). Resolved to
                                  names, never ids. */}
                              {f.patternBehavior && (
                                <p className="cg-find-pattern">
                                  <b>上位層がやっていること</b>
                                  {f.patternBehavior}
                                </p>
                              )}
                              {f.moduleTitle && (
                                <p className="cg-find-mod">
                                  <b>練習するもの</b>
                                  {f.moduleTitle}
                                </p>
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
                          <div className="cg-sec-head"><h2 className="cg-sec-title">{ready.trendTitle}</h2>{lock}</div>
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
                        <div className="cg-sec-head"><h2 className="cg-sec-title">{ready.outcomes.title}</h2>{lock}</div>
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
                          <div className="cg-sec-head"><h2 className="cg-sec-title">{ready.categoriesTitle}</h2>{lock}</div>
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
                        <div className="cg-sec-head"><h2 className="cg-sec-title">マネージャーへの共有</h2>{lock}</div>
                        <p className="cg-share-state">{ready.share.stateLine}</p>
                        <p className="cg-share-body">{ready.share.body}</p>
                        <button {...refused(ready.share.buttonLabel, props.refusals.share, 'cg-share-btn')}>
                          {ready.share.buttonLabel}
                        </button>
                      </section>
                    </div>
                  </div>

                  {/* ⚖ THE PATTERN LIBRARY (audit §5 rank 5) — FIVE NAMED
                      SHELVES with the actual line a top performer says, where
                      the room showed two loose anonymous sentences. Full width
                      beneath the two columns, because a quoted line needs the
                      line: this is reading, not scanning.

                      ⚠ EVERY SHELF RENDERS, EMPTY OR NOT — the phone's own
                      deliberate choice (`PatternCategorySection.tsx:9-18`), so
                      the reader sees the SHAPE of the library and a quiet month
                      reads as 「nothing new here」 rather than as a library that
                      changed size.

                      ⚠ AND NO SOURCE NAME, ANYWHERE. The shape has no field for
                      one: `COACHING_VISIBILITY_MODEL.md:123` flags the phone's
                      hardcoded `showSource = role === 'owner'` as ungated by
                      the source's own consent, and §5 requires DOUBLE consent
                      for attribution. Not hidden by a role check — absent. */}
                  {props.patterns && (
                    <section
                      className="cg-patterns"
                      data-guide-title="トップパフォーマーのパターン"
                      data-guide="成績の良いスタッフが実際に使っている言い回しを、場面ごとにまとめています。誰のやり方かは表示されません。まだ見つかっていない場面も、棚だけは出しています。"
                    >
                      <h2 className="cg-sec-title">{props.patterns.title}</h2>
                      <p className="cg-patterns-sub">{props.patterns.subtitle}</p>
                      <div className="cg-shelves">
                        {props.patterns.shelves.map((shelf) => (
                          <div className="cg-shelf" key={shelf.key}>
                            <h3 className="cg-shelf-title">{shelf.title}</h3>
                            <p className="cg-shelf-desc">{shelf.description}</p>
                            {shelf.entries.length > 0 ? (
                              <ul className="cg-pattern-list">
                                {shelf.entries.map((e) => (
                                  <li className="cg-pattern" key={e.title}>
                                    <span className="cg-pattern-title">{e.title}</span>
                                    <span className="cg-pattern-behavior">{e.behavior}</span>
                                    {/* top-performer-patterns.ts:157 — the
                                        actual LINE, paraphrased, ≤15 chars
                                        verbatim. This is what a shelf has that
                                        a summary sentence does not. */}
                                    <blockquote className="cg-pattern-example">{e.example}</blockquote>
                                    <span className="cg-pattern-note">{e.adoptionNote}</span>
                                    <span className="cg-pattern-transfer">{e.transferability}</span>
                                    {e.confidenceNote && <span className="cg-pattern-caveat">{e.confidenceNote}</span>}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="cg-shelf-empty">{props.patterns!.emptyLine}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      {props.patterns.note && <p className="cg-patterns-note">{props.patterns.note}</p>}
                    </section>
                  )}

                  {/* ⚖ THE LEARNING-MODULE CATALOG (audit §5 rank 8). The room
                      diagnosed and then refused into NOTHING: 学習モジュールを
                      割り当てる pointed at a library that did not exist, and a
                      finding's `linked_module_id` was a reference nobody could
                      follow. The catalog is a READ surface — assignment stays
                      the board's refused action, because it is a write that
                      sends a person a notification.

                      ⚠ NO PROGRESS BAR AND NO ASSIGNMENT CHIPS. No generator
                      produces that data, and the phone's own assign card
                      filters by consent — which
                      `COACHING_VISIBILITY_MODEL.md:119-122` calls backwards,
                      because it excludes the people who most need help. */}
                  {props.modules && (
                    <section
                      className="cg-modules"
                      data-guide-title="学習モジュール"
                      data-guide="気づきに対して、何をどう練習するかをまとめたものです。手順まで書いてあるので、次のセッションでそのまま試せます。割り当ては実データの接続後に使えるようになります。"
                    >
                      <h2 className="cg-sec-title">{props.modules.title}</h2>
                      <p className="cg-modules-sub">{props.modules.subtitle}</p>
                      <div className="cg-callout">
                        <b>{props.modules.calloutTitle}</b>
                        <span>{props.modules.calloutBody}</span>
                      </div>
                      <ul className="cg-module-list">
                        {props.modules.cards.map((mod) => (
                          <li className={`cg-module${mod.isMine ? ' is-mine' : ''}`} key={mod.moduleId}>
                            <div className="cg-module-head">
                              <span className="cg-module-title">{mod.title}</span>
                              {mod.isMine && <span className="cg-kicker">{props.modules!.mineLabel}</span>}
                              <span className="cg-note-chip">{mod.durationLabel}</span>
                            </div>
                            <p className="cg-module-desc">{mod.description}</p>
                            {/* learning-module.ts:163-166 evidenceBasis — WHY
                                this module is believed to work. A catalog
                                without it is a list, not a recommendation. */}
                            <p className="cg-module-basis">{mod.basisLabel}</p>
                            <ol className="cg-module-steps">
                              {mod.steps.map((st) => (
                                <li key={st.step}>
                                  <b>{st.title}</b>
                                  <span>{st.detail}</span>
                                </li>
                              ))}
                            </ol>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
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
          ) : activeTab === 'team' ? (
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

                {/* ⚖ サポートエリア頻度 (audit §5 rank 7) — the ONE owner-
                    facing 「what does the whole store need」 answer, and the
                    only surface here that aggregates across people.
                    ⚠ PLAIN LABELLED COUNTS OF STAFF, and the label says what it
                    counts (⚖ 8/25). No 1位, no medal, no arrow, no rank number:
                    this is where support is needed, not who is winning. */}
                <section
                  className="cg-ranking"
                  data-guide-title="店舗全体のサポートエリア"
                  data-guide="いま支援が必要な場面ごとに、何名がそこに当たっているかを出しています。誰のことかは表示しません。順位ではありません。"
                >
                  <h2 className="cg-sec-title">{team.focusRanking.title}</h2>
                  <p className="cg-ranking-note">{team.focusRanking.note}</p>
                  {team.focusRanking.rows.length > 0 ? (
                    <ul className="cg-reasons">
                      {team.focusRanking.rows.map((r) => (
                        <li className="cg-reason" key={r.key}>
                          <span className="cg-reason-label">{r.label}</span>
                          <span className="cg-reason-count">{r.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cg-ranking-empty">{team.focusRanking.emptyLine}</p>
                  )}
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
          ) : (
            /* ⚖ THE OWNER ROI SCREEN (audit §5 rank 1) — the surface that
               answers 「これ、払う価値ある？」, which this room had NO answer
               for at all. STORE AGGREGATE ONLY: read the payload's field list —
               there is no staff id and no per-person number anywhere in
               `CoachingRoi`, so the selling screen cannot become a league table
               by a mis-wiring, the same construction `TriageRow` uses.

               ⚠ EVERY NUMBER HERE IS A SUBTRACTION, and the honesty note that
               says so renders WITH them rather than beside them. */
            props.roi && (
              <div id="cgPanelRoi" role="tabpanel" aria-labelledby="cgTabRoi" className="cg-panel">
                <section
                  className="cg-roi-hero"
                  data-guide-title="コーチングの効果"
                  data-guide="コーチングを始めてから、この店舗の数字がどれだけ押し上がったかです。季節や景気で全店が動いた分は、コーチングを使っていない他店舗の変化を引いて取り除いています。"
                >
                  <span className="cg-roi-eyebrow">{props.roi.heroLabel}</span>
                  <p className="cg-roi-value">
                    {props.roi.hero.label} {props.roi.hero.liftDisplay}
                  </p>
                  <p className="cg-roi-sub">{props.roi.heroSub}</p>
                  <span className={`cg-conf is-${props.roi.hero.confidence}`}>
                    {props.roi.confidenceLead}：{props.roi.hero.confidenceLabel}
                  </span>
                </section>

                <section
                  className="cg-roi-trend"
                  data-guide-title="他店舗との比較"
                  data-guide="濃い線がこの店舗、点線がコーチングを使っていない他店舗の平均です。縦の線から右がコーチングを始めたあとで、そこから差が開いていれば、それがコーチングの効果です。"
                >
                  <h2 className="cg-sec-title">{props.roi.trendTitle}</h2>
                  <p className="cg-roi-note">{props.roi.trendSub}</p>
                  <RoiChart
                    treated={props.roi.trend.treated}
                    control={props.roi.trend.control}
                    labels={props.roi.trend.labels}
                    startFraction={props.roi.trend.startFraction}
                  />
                  <ul className="cg-roi-legend">
                    <li><span className="cg-roi-key is-treated" aria-hidden="true" />{props.roi.treatedLabel}</li>
                    <li><span className="cg-roi-key is-control" aria-hidden="true" />{props.roi.controlLabel}</li>
                  </ul>
                </section>

                <section
                  className="cg-roi-lifts"
                  data-guide-title="指標ごとの押し上げ"
                  data-guide="指標ごとに、他の要因を引いたあとの押し上げ分です。判断できる期間がまだ短いものは「初期」「構築中」と正直に出しています。"
                >
                  <h2 className="cg-sec-title">{props.roi.liftsTitle}</h2>
                  <p className="cg-roi-note">{props.roi.liftsSub}</p>
                  <ul className="cg-lift-list">
                    {props.roi.lifts.map((l) => (
                      <li className="cg-lift" key={l.key}>
                        <span className="cg-lift-label">{l.label}</span>
                        <span className="cg-lift-value">{l.liftDisplay}</span>
                        <span className="cg-lift-levels">{l.afterDisplay} ← {l.beforeDisplay}</span>
                        <span className={`cg-conf is-${l.confidence}`}>{l.confidenceLabel}</span>
                        <span className="cg-lift-basis">{l.horizonNote}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* ⚖ THE METHOD, IN PLAIN WORDS, AND IT IS NOT OPTIONAL. A lift
                    printed without the sentence that says what was subtracted
                    from it is exactly the overclaim this screen exists not to
                    make — so it renders inside the same panel as the numbers,
                    unconditionally, and the suite pins that it cannot be
                    separated from them. */}
                <section className="cg-honesty" data-guide-title="この数字の出し方" data-guide="コーチングを受けたこの店舗の変化から、使っていない他店舗の自然な変化を引いた残りだけを出しています。データが少ないうちは自動的に抑えめに補正します。">
                  <p>{props.roi.honestyNote}</p>
                </section>

                {props.roi.pitchSub && (
                  <section className="cg-pitch" data-guide-title="費用との比較" data-guide="押し上がった分を、この規模の店舗の売上に置き換えた目安です。確からしさが十分なときだけ表示します。">
                    <h2 className="cg-sec-title">{props.roi.pitchTitle}</h2>
                    <p>{props.roi.pitchSub}</p>
                  </section>
                )}
                {/* ⚠ THE WITHHELD MONEY LINE IS SAID OUT LOUD, like every other
                    short receipt in this room. Silence would read as 「there is
                    no value」 rather than 「we will not claim one yet」. */}
                {props.roi.pitchWithheld && <p className="cg-roi-withheld">{props.roi.pitchWithheld}</p>}
              </div>
            )
          )}

          <p className="cg-foot">{props.actionFootnote}</p>
        </>
      )}

      {/* ⚖ あなたのデータについて (audit §5 rank 3) — the NINE ITEMISED FACTS,
          the Synqed-as-processor disclosure and the mission line, in the
          phone's own legally-reviewed words. Two of the nine already stood here
          as `noticeLines`; the other seven had no home in Business at all,
          which is the largest copy gap the audit found.

          ⚠ IT IS A SECTION, NOT A ROUTE. This room is ONE page — a reader
          should not have to leave the screen a promise is about in order to
          read the promise. It stands outside the tab row for the same reason:
          the wall it describes does not change when the tab does. */}
      <section
        className="cg-notice"
        data-guide-title="あなたのデータについて"
        data-guide="コーチングで何が記録され、店長・オーナーに何が見えて何が見えないかの一覧です。会話の録音と文字起こしは、誰の画面にも表示されません。"
      >
        <h2 className="cg-sec-title">{props.transparency.title}</h2>
        <p className="cg-notice-sub">{props.transparency.subtitle}</p>
        {props.noticeLines.map((line) => (
          <p className="cg-notice-line" key={line}>{line}</p>
        ))}

        <div className="cg-mission">
          <b>{props.transparency.missionTitle}</b>
          <p>{props.transparency.missionBody}</p>
        </div>

        {/* ⚖ THE WALL, ITEMISED, SIDE BY SIDE. Two columns is the composition,
            because the whole point is that a reader can see BOTH lists at once
            and check that nothing appears on both. */}
        <div className="cg-wall">
          <div className="cg-wall-col is-mine">
            <b>{props.transparency.staffOnlyTitle}</b>
            <p className="cg-wall-lead">{props.transparency.staffOnlyLead}</p>
            <ul>
              {props.transparency.staffOnly.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className="cg-wall-col is-theirs">
            <b>{props.transparency.ownerVisibleTitle}</b>
            <p className="cg-wall-lead">{props.transparency.ownerVisibleLead}</p>
            <ul>
              {props.transparency.ownerVisible.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* ⚖ THE LEGALLY-PRECISE HALF, WHICH EXISTS NOWHERE ELSE IN BUSINESS:
            who else touches this data, for what, and through which
            sub-processors. */}
        <div className="cg-synqed">
          <b>{props.transparency.synqedTitle}</b>
          <p>{props.transparency.synqedIntro}</p>
          <ul>
            {props.transparency.synqed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="cg-retention">
            <b>{props.transparency.retentionLabel}</b>
            {props.transparency.retentionBody}
          </p>
        </div>

        {/* ⚖ A DELETION REQUEST IS A LEGAL RECORD — the same class this room
            already refuses everywhere else, so it ships refused with its own
            reason rather than half-built behind a button that only toasts. */}
        <div className="cg-data-actions">
          <button {...refused(props.transparency.reviewCta, props.refusals.share, 'cg-review-btn')}>
            {props.transparency.reviewCta}
          </button>
          <button {...refused(props.transparency.deletionCta, props.refusals.share, 'cg-delete-btn')}>
            {props.transparency.deletionCta}
          </button>
          <p className="cg-delete-body">
            <b>{props.transparency.deletionTitle}</b>
            {props.transparency.deletionBody}
          </p>
        </div>
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

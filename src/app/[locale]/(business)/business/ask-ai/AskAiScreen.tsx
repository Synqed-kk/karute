'use client'

// AI相談 — the computer door onto the same AI the phone app already ships, and
// onto the suggestion feed canon designed for the desk. ⚖ Liam 8/31 ordered this
// room REDESIGNED: "the phone one hasn't been touched properly and it's crap" —
// so the phone is the CONTRACT source (what a question is, what an answer knows,
// who may ask, what is kept) and never the design bar.
//
// ⚖ AND ⚖ Liam 9/2, at the preview: 「text-heavy」. THE ACCEPTED MOCK IS THIS
// PAGE'S SPEC NOW (ASK-AI-MOCK-v1.html, the de-text round + the ultra-wide sweep
// + the label sync). What changed is COMPOSITION, HIERARCHY, COPY AND MOTION —
// not one derivation, not one contract, not one refusal:
//   · the head is ONE compact title row and its sentence moved, verbatim, into
//     the trust row's pop-down (dead prose FOLDS, it is never cut);
//   · 接続済みデータ became ONE slim line of chips instead of a block;
//   · the conversation reads in a real transcript panel, and an answer has a
//     SHAPE — a lead sentence, who it is about, the advice, then its 出典;
//   · 今日のヒント and じっくり相談 became ONE 質問のヒント row of chips, sitting
//     where they are used: immediately above the composer;
//   · every rail card LEADS WITH THE TO-DO and one grey line, with the paragraph
//     and its 根拠 behind a press;
//   · この画面の値の設定元 folded into a bar at the foot of the page.
//
// ⚖ WHAT THE DESK DOES THAT THE PHONE CANNOT (desktop-superior, 8/30):
//   (a) BOTH PLANES AT ONCE. The phone stacks header → hints → templates →
//       conversation → input in one column, so the conversation — the thing the
//       page is FOR — is the last thing you reach. Here the consultation is the
//       left workspace and the suggestion feed is the right rail, visible
//       together at desk widths (⚖ D-1).
//   (b) HONEST FAILURE GRAMMAR. The phone collapses every failure into one
//       bubble reading 「エラーが発生しました。」. Here the refusal, the permission
//       state and the failed turn each carry their own reason, and the failed
//       turn is a designed card with its own 「もう一度送る」 (⚖ D-3).
//   (c) ONE EVIDENCE GRAMMAR. The phone's citations path is dead code ("until
//       RAG lands"). Here an answer's 出典 pills and a suggestion's 根拠 line are
//       the SAME resolver's line, rendered two ways, so the two can never tell
//       one customer's story two ways (⚖ D-4).
// ⚖ AND WHAT IT KEEPS (the recognition floor): where the desk shows the same
// meaning it uses the phone's own words — AI相談, 接続済みデータ, 会話, 出典,
// 送信, and the composer's two hint lines.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: what is typed in the composer,
// which refusal is currently being shown, which suggestions have been dismissed
// for this visit, which cards are expanded, which disclosures are open, which
// toast is up, and which step of the 画面の説明 tour the reader is on. Every one
// is pure browsing — none of them writes anything, and the one control that
// would (送信) refuses immediately and honestly.
//
// ⚠ NO GENERATION THEATRE, ANYWHERE (⚖ D-2, and ⚖ Liam's D-2 on the mock). This
// screen never renders the phone's 「お店のデータを確認しています…」, never
// fabricates a reply, never pretends latency and never calls anything: there is
// no fetch, no typing indicator, no entrance stagger, no `dots` element, no
// `@keyframes` for state, and no timer that resolves into content. The turns are
// all present at first paint. 送信 refuses in the same tick and the typed text is
// untouched.
//
// CLASS NAMES ARE PREFIXED `ak-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and 今日の
// 運営 / 顧客 / 予約一覧 / 売上分析 / スタッフ・シフト / 受信トレイ / 売上・レジ /
// カルテ / 録音 / 設定 state BARE `.biz .<name>` rules on names this room would
// otherwise want (`.panel`, `.empty`, `.chip`, `.toast`, `.spot-card`…). A fence
// that has to enumerate sixty shared names rots as the neighbours grow; not
// colliding at all cannot. `page` / `h1` / `btn` are the SHELL's and restated
// here, so those three are fenced in ask-ai.css at four levels.

import Link from 'next/link'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import { makeSpring } from '@/business/lib/spring'
import {
  keepCardOffHeading,
  precedingQuestion,
  splitAtName,
  splitEvidence,
  splitLead,
  windowFeed,
  type ConversationTurn,
  type FeedCard,
  type ScopeFact,
  type SignalChip,
  type TemplatePill,
} from '@/business/lib/ask-ai'

/** THE ROUTE WRAPPER. Every rule in ask-ai.css is scoped under this class, so
 *  nothing this sheet says can reach another room; `.page.pg-ask-ai` (four
 *  levels) rather than `.pg-ask-ai` (three) so a sibling's own three-level rule
 *  (`.biz .page .btn`, customers.css:23) cannot win the room back on insertion
 *  order. */
const ROOT = 'page pg-ask-ai'

/** ⚖ THE PHONE BAND, MEASURED ON THE PAGE (§2.8, ⚖-ADJ J). The ladder is a
 *  `@container` ladder because the shell hands this room a page 76px or 264px
 *  narrower than the window; the ONE thing the sheet cannot do from CSS alone is
 *  tell the SCREEN that the 提案 rail became a collapsible bar, so the screen
 *  measures the same box the container queries are asked against. 600 is the
 *  sheet's own threshold, stated once here and once there. */
const PHONE_PAGE = 600

/** ⚖ Liam 8/23 — 画面の説明. The family's own tour helpers, at the same shape:
 *  a rect literal the shared engine understands, and two identity guards that
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

/** The composer's auto-grow ceiling. The phone caps at 160px
 *  (`AIInputBar.tsx:21`); the desk has more room and a longer question is what a
 *  desk is FOR, so the ceiling is higher — and it is a ceiling on a TEXT CONTROL,
 *  not on a wrapper (R7-7, kept). */
const COMPOSER_MAX = 260

/** …and its FLOOR. ⚠ MEASURED DEFECT (probe E6): a two-row box at 13px/1.65 is
 *  43px tall, which is one pixel under the ≥44px touch law at ≤743 — and the
 *  height is the SCREEN's to set, so a `min-height` in the sheet would be a
 *  second home for one number that the inline style then overrules anyway. */
const COMPOSER_MIN = 46

/**
 * ⚖ THE COLLAPSE, COPIED FROM THE 録音 ROOM WITH ITS CITE
 * (`src/app/[locale]/(business)/business/recording/RecordingScreen.tsx:816-841`,
 * itself the accepted mock's `makeCollapse`). A height spring to the panel's
 * measured `scrollHeight`, then `height: auto` AT REST so an open panel keeps
 * growing with its own content.
 *
 * ⚠ IT IS COPIED RATHER THAN IMPORTED, and that is the R7-6 precedent: a room
 * importing a SIBLING ROOM's screen is a cross-room dependency the territory
 * fence exists to prevent, and the shared home for a hook like this is a
 * family-sweep item rather than something one room invents on its way past
 * (numbered as a deviation in this round's report). What IS shared is the
 * integrator underneath it — `makeSpring` lives in `@/business/lib/spring` and
 * both rooms drive the same one.
 *
 * ⚠ AND THE FIRST RUN JUMPS. A page that plays five collapse animations on load
 * is a page that looks broken while it settles.
 */
function useCollapse(ref: RefObject<HTMLDivElement | null>, open: boolean, reduced: boolean, ready = true) {
  const first = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (!el || !ready) return
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
  }, [ref, open, reduced, ready])
}

// ── the room's glyphs, one place ────────────────────────────────────────────
const Chevron = () => (
  <svg className="ak-cv" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
)
const InfoMark = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.6v.6" /></svg>
)
const PersonMark = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><circle cx="12" cy="8" r="3.3" /><path d="M5 20c1.2-3.5 4-5.3 7-5.3s5.8 1.8 7 5.3" /></svg>
)
const CATEGORY_MARK: Record<string, ReactNode> = {
  booking: (<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="6" width="16" height="14" rx="2.5" /><path d="M8 3v5M16 3v5" /></svg>),
  customer_follow: (<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5 20c1.2-3.5 4-5.3 7-5.3s5.8 1.8 7 5.3" /></svg>),
  staffing: (<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 19c1-3 3.4-4.6 6-4.6S14 16 15 19" /><path d="M17 8.4a2.8 2.8 0 1 1 0 5.4" /></svg>),
  vip: (<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.9z" /></svg>),
}
/** A category the plane grows LATER has no mark and no tone — it arrives
 *  neutral rather than wearing another category's colour (the existing pin). */
const NeutralMark = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="7.5" /></svg>
)

/** A suggestion card as the SERVER hands it over: the derivation's own verdicts
 *  plus the one thing only the route knows — where the card's action goes, with
 *  the current store lens already on it. The screen builds no URL (⚖ registry ⑥:
 *  a record-level param would be a contract this room invented). */
export interface AskAiCardProps extends FeedCard {
  href: string
}

export interface AskAiProps {
  dateline: string
  lensLabel: string
  /** The phone's headerSubtitle. It LEFT the head in the S15 rebuild and reads
   *  inside the trust row's pop-down instead — same words, new home. */
  subtitle: string
  /** Non-empty ⇒ this reader may not consult, and every field below is empty by
   *  construction rather than by a screen being trusted to hide it. */
  noticeLines: string[]
  scopeTitle: string
  scope: ScopeFact[]
  privacyLines: string[]
  /** The trust row's disclosure: its button's words, and the lines it opens. */
  why: { label: string; lines: string[] }
  signals: SignalChip[]
  templates: TemplatePill[]
  /** 「最適化対象：美容整体」 — present only when a business type is set. */
  tunedLabel: string | null
  /** …and its opposite: present only when one is NOT (⚖ never both). */
  profileHint: { title: string; body: string; cta: string } | null
  /** The dashed chip that stands in the tuned chip's slot when no type is set. */
  unsetTypeLabel: string
  turns: ConversationTurn[]
  startHint: string
  feed: AskAiCardProps[]
  /** The store has nothing to suggest. */
  feedEmpty: { title: string; body: string }
  /** …and the OTHER empty: the feed arrived with rows and this visit dismissed
   *  every one of them (⚖ F2-1 — derived from what the props carry versus what
   *  the reader can still see, never guessed). */
  feedDismissedEmpty: { title: string; body: string }
  trace: Array<{ label: string; value: string; unconnected: boolean }>
  traceTitle: string
  traceLead: string
  footnoteBarLabel: string
  boundary: { kicker: string; title: string; body: string; backLabel: string; backHref: string }
  composer: { placeholder: string; hint: string; sendLabel: string }
  refusals: { send: string; settings: string }
  dismissToast: string
  undoLabel: string
  footnote: string
}

// ═══════════════════════════════════════════════════════════════════════════
/** ONE SUGGESTION, and it leads with the to-do (§2.5). Collapsed it is a
 *  category word, the job, one grey line and the two actions; the paragraph and
 *  its 根拠 open in place. It is a component of its own because each card owns a
 *  collapse spring and a dismissal spring, and a hook cannot live in a loop —
 *  which is also what lets TWO cards be leaving at the same time (F-A1). */
function SugCard({
  card, reduced, collapsing, onDismiss, onCollapsed,
}: {
  card: AskAiCardProps
  reduced: boolean
  collapsing: boolean
  onDismiss: (id: string) => void
  onCollapsed: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  useCollapse(moreRef, open, reduced)

  /** ⚖ 却下 IS A SPRING COLLAPSE, AND THE CARD LEAVES BEFORE THE LIST DOES
   *  (§2.5). The wrapper springs its own axis to zero with an opacity fade and
   *  the id enters `dismissed` at REST, so the row does not vanish under the
   *  finger that pressed it.
   *
   *  ⚠ WHICH AXIS IS ASKED OF THE LAYOUT, not of a media query. Below the
   *  two-column band the rail is a horizontal strip and a card occupies WIDTH;
   *  reading the list's own computed direction means the ladder and this
   *  animation can never disagree about which one the card is standing in.
   *
   *  ⚠ AND THE FLAG IS THIS CARD'S OWN (F-A1). While `collapsing` was ONE id, a
   *  second 却下 mid-flight re-rendered the FIRST card with `collapsing=false`:
   *  its cleanup stopped the spring before `onRest` could fire and the effect
   *  body stripped its inline height, so the card snapped back to full size and
   *  never entered `dismissed` — a gesture ENDING that tore nothing down (⚖ §A-9).
   *  The parent now keeps a LIST, so each card's spring runs to its own rest. */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (!collapsing) {
      el.style.removeProperty('height')
      el.style.removeProperty('width')
      el.style.removeProperty('opacity')
      // ⚖ F-A3 — THE CLIP IS BORROWED, NOT OWNED. `overflow: hidden` exists only
      // so a size can animate to zero; left on permanently it cut the card's own
      // hover shadow on three sides at the desk. It is put on for the collapse
      // and taken off with the inline styles.
      el.classList.remove('ak-leaving')
      return
    }
    el.classList.add('ak-leaving')
    const list = el.parentElement
    const row = list !== null && getComputedStyle(list).flexDirection === 'row'
    const prop = row ? 'width' : 'height'
    const rect = el.getBoundingClientRect()
    const size = row ? rect.width : rect.height
    const sp = makeSpring((v) => {
      el.style.setProperty(prop, `${v}px`)
      el.style.opacity = String(size > 0 ? Math.max(0, v / size) : 0)
    }, {
      response: 0.28,
      reduced,
      onRest: (v) => { if (v <= 0.5) onCollapsed(card.id) },
    })
    sp.jump(size)
    sp.set(0)
    return () => sp.stop()
  }, [collapsing, reduced, card.id, onCollapsed])

  const ev = splitAtName(card.evidence, card.evidenceName)
  const head = splitAtName(card.headline, card.evidenceName)

  return (
    <div className="ak-sug" ref={wrapRef}>
      <div className={`ak-sug-in${card.badge ? ' ak-attn' : ''}`} data-cat={card.category}>
        <div className="ak-sug-cat">
          <span className="ak-sug-ic">{CATEGORY_MARK[card.category] ?? <NeutralMark />}</span>
          <span className="ak-sug-w">{card.categoryLabel}</span>
          <span className="ak-sp" />
          {card.badge && <span className="ak-attnchip">{card.badge}</span>}
        </div>
        <button
          className="ak-sug-open"
          type="button"
          data-press
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          <span className="ak-sug-tx">
            {/* The customer's name reads as a chip INSIDE the sentence, cut at
                the resolver's own string rather than pattern-matched out of
                free prose. */}
            <span className="ak-sug-h">{head.before}{head.name && <span className="ak-nm">{head.name}</span>}{head.after}</span>
            <span className="ak-sug-r">{card.reason}</span>
          </span>
          <span className={`ak-sug-cv${open ? ' ak-on' : ''}`}><Chevron /></span>
        </button>
        <div className="ak-sug-more" ref={moreRef}>
          <div>
            <p className="ak-sug-full">{card.text}</p>
            {/* ⚖ D-4 — ONE EVIDENCE GRAMMAR. This is the same resolver's line the
                answer's 出典 pills carry: a person's name and what the record
                says, never an id. */}
            <div className="ak-ev">
              <span className="ak-ev-k">根拠</span>
              <span className="ak-ev-t">{ev.before}{ev.name && <span className="ak-nm">{ev.name}</span>}{ev.after}</span>
            </div>
          </div>
        </div>
        <div className="ak-sug-act">
          <Link className="ak-door" href={card.href} data-press>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14 4h4v16h-4" /><path d="M3 12h9M9 8.5 12.5 12 9 15.5" /></svg>
            {card.linkLabel}
          </Link>
          <span className="ak-sp" />
          <button className="ak-dismiss" type="button" data-press onClick={() => onDismiss(card.id)}>却下</button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
export function AskAiScreen(props: AskAiProps) {
  const [draft, setDraft] = useState('')
  /** ⚖ D-2 — WHAT THE LAST PRESS REFUSED, AND WHY. `contextLabel` is the
   *  `context_label` the shipped request would have come back with when the
   *  press came from a 今日 hint chip or from 「もう一度送る」, shown so the refusal
   *  says which slice of data the answer would have been built from rather than
   *  only that it did not happen. */
  const [refusal, setRefusal] = useState<{ reason: string; contextLabel: string | null; intended: string | null } | null>(null)
  /** ⚖ F2-5 — 設定する ANSWERS IN ITS OWN SECTION, beside the button that was
   *  pressed, rather than in the composer's slot a screen away. */
  const [settingsRefused, setSettingsRefused] = useState(false)
  /** ⚖ DEMO-LOCAL BY DESIGN (canon's own contract): in memory, this visit only.
   *  A remount brings every card back, the toast says so out loud, and a store
   *  switch resets it with the rest of the screen because `page.tsx` keys this
   *  component by the lens. */
  const [dismissed, setDismissed] = useState<string[]>([])
  /** …and the card whose collapse is still RUNNING. It is not dismissed yet — an
   *  undo pressed mid-flight has to be able to catch it. */
  const [collapsing, setCollapsing] = useState<string[]>([])
  /** ⚖ HOW MUCH OF THE FEED IS OPEN — browsing state, exactly like the dismissed
   *  list, and it resets with the store for the same reason. The カルテ room's own
   *  さらに表示 walk: a step count, never a page number. */
  const [feedSteps, setFeedSteps] = useState(1)
  const [toast, setToast] = useState<{ text: string; undoId: string | null } | null>(null)
  const [whyOpen, setWhyOpen] = useState(false)
  const [footOpen, setFootOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [pageWidth, setPageWidth] = useState(0)
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  const rootRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const whyRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const visible = props.feed.filter((c) => !dismissed.includes(c.id))
  /** ⚖ F2-1 — TWO EMPTIES, AND WHICH ONE IS A FACT ABOUT THIS SCREEN rather than
   *  a guess: the feed that ARRIVED with rows and is empty now was emptied here,
   *  by this reader, and 「提案はまだありません」 would be the one sentence that is
   *  false about it. */
  const emptyState = props.feed.length > 0 ? props.feedDismissedEmpty : props.feedEmpty
  /** ⚠ THE WINDOW IS TAKEN OFF `visible`, NOT OFF THE PROPS. A dismissal leaves
   *  the total the head counts AND the arithmetic the footer names in one pass,
   *  so 「提案 N件」 and 「あと M件」 can never describe two different lists. */
  const walk = windowFeed(visible, feedSteps)

  // ── ⚖ MOTION (the Studio standard: transform/opacity, springs for state) ──
  /** Whether the reader asked for less motion. Read ONCE into state so every
   *  spring is constructed with the same answer and the SSR render (which has no
   *  `matchMedia` at all) never disagrees with the first client frame. */
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const read = () => setReduced(mq.matches)
    read()
    mq.addEventListener('change', read)
    return () => mq.removeEventListener('change', read)
  }, [])

  /** PRESS STATES ON POINTER-DOWN, one document listener for the whole room —
   *  copied from the 録音 room with its cite (`RecordingScreen.tsx:842-859`,
   *  itself the accepted mock's `[data-press]`). Pointer-DOWN, not click: the
   *  feedback has to arrive while the finger is still down or it is not
   *  feedback. */
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

  useCollapse(whyRef, whyOpen, reduced)
  useCollapse(footRef, footOpen, reduced)

  /** ⚖ THE PAGE IS THE RULER (§2.8). The sheet's bands are `@container` queries
   *  against this same box; the screen reads it because the phone band is the one
   *  where the rail becomes a COLLAPSIBLE BAR, which is behaviour and not paint.
   *  Measured in a LAYOUT effect so the first painted frame is already right. */
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const read = () => setPageWidth(el.getBoundingClientRect().width)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const railCollapsible = pageWidth > 0 && pageWidth < PHONE_PAGE
  const railBodyOpen = !railCollapsible || railOpen
  /** ⚠ NOTHING ANIMATES ON FIRST PAINT, AND THE RAIL IS THE ONE THAT COULD
   *  (measured defect, probe D12). The page's width is not known until the
   *  observer has run, so the rail's first committed value would be 「open」 on a
   *  phone and the hook would then play a 340ms close as the reader arrives.
   *  The SHEET owns the resting state per band — the phone band states
   *  `height: 0` — and the hook is held until the page has actually been
   *  measured, at which point its FIRST run jumps rather than animating. */
  useCollapse(railRef, railBodyOpen, reduced, pageWidth > 0)

  /** THE COMPOSER'S OWN MECHANIC, kept from the phone (`AIInputBar.tsx:18-23`):
   *  the box grows with what is typed. `height: auto` first, or the box can only
   *  ever get taller — a deleted line would leave the hole it made. */
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(COMPOSER_MIN, Math.min(el.scrollHeight, COMPOSER_MAX))}px`
  }, [draft])

  /** ⚖ THE TRANSCRIPT OPENS ON ITS NEWEST ENTRY (§2.4). A reading panel that
   *  opened at the top of a long conversation would hide the answer the reader
   *  came back for. */
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [props.turns])

  const hideToast = useCallback(() => {
    setToast(null)
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  /** The toast window is longer when there is something to undo — a 5-second
   *  offer is the mock's own, and 2.8 is this room's for a toast that only
   *  reports. */
  const showToast = useCallback((text: string, undoId: string | null) => {
    setToast({ text, undoId })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), undoId ? 5000 : 2800)
  }, [])

  // A timer that outlives its component sets state on nothing. One cleanup, at
  // the one place the timer is owned.
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  /** ⚖ SEND REFUSES, IMMEDIATELY AND HONESTLY, AND CHANGES NOTHING ELSE (⚖ §A-7).
   *  The typed text is not read, not trimmed into the box, not cleared and not
   *  moved: a refusal that ate the question would make the reader retype it to
   *  find out what the refusal said. */
  const refuseSend = (contextLabel: string | null = null, intended: string | null = null) => {
    setRefusal({ reason: props.refusals.send, contextLabel, intended })
  }

  /** TEMPLATE SEMANTICS, IN ONE HELPER (⚖-ADJ D). じっくり chips and an answer's
   *  name chips both FILL and do not send — one mechanism, so the day a lens
   *  argues the F2-3 guard belongs on the fill path too, it moves in one place
   *  rather than in two that drifted. */
  const fill = (text: string) => {
    setDraft(text)
    setRefusal(null)
    inputRef.current?.focus()
  }

  /** THE SEND PATH, FROM A CONTROL THAT CARRIES ITS OWN QUESTION. 今日 hint chips
   *  and 「もう一度送る」 both walk it: the question lands in the composer where the
   *  reader can see and edit it, and the send it would have made is refused with
   *  the context label the request would have carried.
   *
   *  ⚖ AND IT NEVER DESTROYS A TYPED QUESTION (F2-3). Filling is only honest into
   *  an EMPTY box: over a half-written question the fill was a silent,
   *  unrecoverable delete of the reader's own words — the exact thing the refusal
   *  path is designed never to do (⚖ §A-7). So when something else is already
   *  typed the draft is left exactly as it is and the question goes INSIDE the
   *  refusal, where the reader can see what the press would have asked. */
  const walkSend = (text: string, contextLabel: string | null) => {
    const typed = draft.trim() !== '' && draft !== text
    if (!typed) setDraft(text)
    refuseSend(contextLabel, typed ? text : null)
    inputRef.current?.focus()
  }

  /** 今日 — the phone SENDS on a chip tap, with the chip's context hint
   *  (`AIAssistantView.tsx:147`). The desk walks the same path to its honest end. */
  const takeSignal = (chip: SignalChip) => walkSend(chip.prompt, chip.contextLabel)

  /** じっくり — the phone FILLS ONLY (`AIAssistantView.tsx:162` / `:181` —
   *  `setInput(example)`, no send). The two behaviours are different on purpose
   *  and stay different here: a template is a starting point somebody edits. */
  const takeTemplate = (pill: TemplatePill) => fill(pill.example)

  /** ⚖ 「もう一度送る」 = THE SEND PATH (⚖-ADJ F, superseding R7-10's waiver). It
   *  re-sends the question the failed turn was answering, so a press ends at the
   *  honest refusal naming the seam — with the typed text untouched. */
  const takeRetry = (q: { text: string; contextLabel: string | null }) => walkSend(q.text, q.contextLabel)

  /** Enter sends, Shift+Enter is a newline — the contract the composer's own
   *  hint line documents (`messages/ja.json` askAi.inputHint). */
  const onComposerKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return
    e.preventDefault()
    if (draft.trim()) refuseSend()
  }

  /** 却下 — the spring starts, the toast offers the undo, and the id joins
   *  `dismissed` only when the card has actually left.
   *
   *  ⚠ A LIST, NOT ONE ID (F-A1). Two cards can be mid-flight at once, and each
   *  runs to its own rest. The TOAST still carries only the latest undo, which
   *  is the accepted mock's own behaviour — one bar, one 元に戻す — so a reader
   *  who dismisses two in a row can undo the second and re-open the page for the
   *  first (which is what 「保存されません」 already promises them). */
  const dismiss = (id: string) => {
    setCollapsing((was) => (was.includes(id) ? was : [...was, id]))
    showToast(props.dismissToast, id)
  }
  const onCollapsed = useCallback((id: string) => {
    setDismissed((was) => (was.includes(id) ? was : [...was, id]))
    setCollapsing((was) => was.filter((x) => x !== id))
  }, [])
  /** 元に戻す — it catches the card whether the collapse is still running or the
   *  id has already landed in `dismissed`, because both are the same request. */
  const undo = (id: string) => {
    setCollapsing((was) => was.filter((x) => x !== id))
    setDismissed((was) => was.filter((x) => x !== id))
    hideToast()
  }

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────

  /** THE ROOM'S TOUR, on the family's shared engine (`@/business/lib/guide`, and
   *  that engine is FROZEN — this room wires a trigger and an overlay to it and
   *  nothing else). A section joins the walk by DECLARING `data-guide-title` +
   *  `data-guide` ON ITSELF, so there is no list to keep in sync: a section that
   *  renders is a section that is explained, and one that is not on screen — the
   *  質問のヒント row in a store with no chips at all, the 業種の設定 strip in a
   *  shop that has chosen one, the permission note for a reader who has the
   *  permission — drops out of the walk and out of the N/M count by itself.
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
    // The engine's answer, then the correction for the one shape it cannot place
    // — a section taller than the viewport, which this room's rail becomes the
    // moment a store has twenty-five suggestions.
    const at = keepCardOffHeading(spotCardAt(boxOf(r), size, viewport), size, boxOf(r), viewport)
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  // ONE keyboard listener, bound only while the tour IS open and removed with
  // it: while the walk is up it owns Escape and the arrows walk the ring. The
  // composer's own Enter is a LOCAL handler on the textarea rather than a second
  // document listener, so the two can never fire on one press.
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
  // back on the ? it came from, rather than dropping the reader at the top of the
  // document. `wasOpen` is what keeps the close half from firing on the first
  // render, when nothing was open and nothing should move.
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

  const denied = props.noticeLines.length > 0

  return (
    <div className={ROOT} ref={rootRef}>
      {/* ⚖ THE PAGE'S OWN CONTENT BOX (§2.3, the ULTRA-WIDE law). It carries the
          1416px cap AND it is the CONTAINER every column decision in the sheet is
          asked against, so a layout can never be chosen from a width the layout
          does not have. The four fixed layers below — the toast and the tour —
          are SIBLINGS of it on purpose: `container-type: inline-size` implies
          `contain: layout`, which would make this box the containing block for
          every `position: fixed` descendant. */}
      <div className="ak-page" ref={pageRef}>
        {/* STEP 0. ONE COMPACT TITLE ROW (§2.1): the dateline, the name of the
            page and the ?. The head declares itself like every other section, so
            the walk opens on what this page is FOR before it starts pointing at
            parts of it — and its sentence is true whether or not the reader may
            consult. */}
        <header
          className="ak-head"
          data-guide-title="AI相談"
          data-guide="この店舗の記録をもとに、AIに質問したり、AIからの提案を受け取ったりする画面です。左側で質問し、右側にAIからの提案が並びます。相談の内容は保存されません。"
        >
          <div className="ak-titlerow">
            <span className="ak-eyebrow">{props.dateline}</span>
            <h1>AI相談</h1>
            {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one every other
                Business page has: a spotlight walk of everything on this screen,
                and during the walk you can tap any part of the page to jump
                straight to what it is. A hairline circle, never a filled one
                (⚖ R13). */}
            <button
              className="ak-help"
              type="button"
              ref={helpRef}
              data-press
              title="画面の説明"
              aria-label="画面の説明"
              aria-haspopup="dialog"
              aria-expanded={tourOpen}
              aria-controls="akTour"
              onClick={() => setTourIdx(0)}
            >
              ?
            </button>
          </div>
        </header>

        {denied && (
          <section
            className="ak-notice"
            aria-label="この画面の見え方"
            data-guide-title="この画面の見え方"
            data-guide="AI相談を使うには顧客を閲覧できる権限が必要です。権限がない場合、この画面には提案も相談の内容も読み込まれません。"
          >
            {props.noticeLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </section>
        )}

        {!denied && (
          <>
            {/* ⚖ 接続済みデータ AS ONE SLIM LINE (§2.2). The phone's own four
                facts, in the phone's own words, EXACT rather than approximate,
                and every chip says WHAT it counts (⚖ 8/25). The two privacy
                sentences and the head's old subtitle read in the pop-down under
                it — one press, in flow, no floating panel. */}
            <section
              className="ak-trust"
              aria-label={props.scopeTitle}
              data-guide-title="接続済みデータ"
              data-guide="AIがこの店舗で読み取れる記録の件数です。カルテ・顧客・予約・録音の4つを、それぞれ何の件数かを書いて並べています。右の「回答が読み取るもの・相談の保存について」を押すと、答えのもとになる範囲と、相談が保存されないことの説明が下に開きます。"
            >
              <div className="ak-trust-row">
                <span className="ak-label">{props.scopeTitle}</span>
                {props.scope.map((f) => (
                  <span className="ak-dchip" key={f.key}>
                    {f.label} <b>{f.value}</b>
                  </span>
                ))}
                {/* ⚖ NEVER BOTH (the existing pin): a shop has chosen a 業種 or
                    it has not, and the same slot says which. */}
                <span className="ak-dchip ak-opt">{props.tunedLabel ?? props.unsetTypeLabel}</span>
                <span className="ak-sp" />
                <button
                  className="ak-why"
                  type="button"
                  data-press
                  aria-expanded={whyOpen}
                  onClick={() => setWhyOpen((was) => !was)}
                >
                  <InfoMark />
                  {props.why.label}
                  <span className={`ak-why-cv${whyOpen ? ' ak-on' : ''}`}><Chevron /></span>
                </button>
              </div>
              <div className="ak-why-panel" ref={whyRef}>
                <div className="ak-why-in">
                  {props.why.lines.map((line) => (
                    <p className="ak-why-line" key={line}>{line}</p>
                  ))}
                </div>
              </div>
            </section>

            {props.profileHint && (
              <section
                className="ak-profile"
                aria-label={props.profileHint.title}
                data-guide-title="業種の設定"
                data-guide="業種を選ぶと、お店の言葉に合わせてAIが調整され、業種別のおすすめの質問が表示されます。設定画面にこの項目はまだありません。"
              >
                <div className="ak-profile-row">
                  <strong>{props.profileHint.title}</strong>
                  <span className="ak-profile-body">{props.profileHint.body}</span>
                  <span className="ak-sp" />
                  <button
                    className="btn ak-profile-cta"
                    type="button"
                    data-press
                    aria-disabled="true"
                    title={props.refusals.settings}
                    aria-label={`${props.profileHint.cta} — ${props.refusals.settings}`}
                    onClick={() => setSettingsRefused(true)}
                  >
                    {props.profileHint.cta}
                  </button>
                </div>
                {/* ⚖ F2-5 — THE ANSWER LANDS WHERE THE PRESS HAPPENED. Same
                    `.ak-refusal` treatment as the composer's, because it is the
                    same family recipe; a different SLOT, because a reason a
                    reader has to scroll to find is a reason they never read. */}
                {settingsRefused && (
                  <div className="ak-refusal ak-profile-refusal" role="status" aria-live="polite">
                    <p className="ak-refusal-reason">{props.refusals.settings}</p>
                  </div>
                )}
              </section>
            )}

            <div className="ak-workspace">
              {/* ═══ 会話 — the chat card, and the workspace's own subject ═══ */}
              <section
                className="ak-chat"
                aria-label="会話"
                data-guide-title="会話"
                data-guide="質問と回答が並ぶところです。読みやすいように、この枠の中だけを上下に動かして過去のやりとりを見られます。回答には出典がつき、どのカルテ・どのお客様の記録から答えたのかを確認できます。うまく回答できなかったときは、その理由と「もう一度送る」がその場に出ます。"
              >
                <div className="ak-chat-hd">
                  <span className="ak-chat-ic">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
                  </span>
                  会話
                </div>

                {/* ⚖ THE ONE BOUNDED BOX IN THE ROOM (⚖-ADJ A). A transcript
                    READING panel of the same class as 破棄の記録's `.rc-tscroll`
                    (recording.css:1443) — the ⚖ 8/22 page-scroll law targets board
                    and list wrappers, a reader hunting a row inside a box, and
                    this is a panel of words being read. It carries NO
                    `overscroll-behavior`, so a wheel that reaches the end of the
                    transcript keeps scrolling the PAGE: the page still owns the
                    document's axis. Nothing else in this room caps a height. */}
                <div className="ak-chat-scroll" ref={chatRef}>
                  {props.turns.length === 0 ? (
                    <p className="ak-start">{props.startHint}</p>
                  ) : (
                    props.turns.map((t) => {
                      if (t.role === 'error') {
                        const q = precedingQuestion(props.turns, t.id)
                        return (
                          <div className="ak-msg" key={t.id}>
                            <div className="ak-errbox">
                              <div className="ak-err-h">回答できませんでした</div>
                              <p className="ak-err-b">{t.text}</p>
                              {/* A failure with no question before it has nothing
                                  to re-send, so no button is offered. */}
                              {q && (
                                <button className="ak-retry" type="button" data-press onClick={() => takeRetry(q)}>
                                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 3.5V8h-4.5" /></svg>
                                  もう一度送る
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      }
                      if (t.role === 'user') {
                        return (
                          <div className="ak-msg" key={t.id}>
                            <div className="ak-msg-q">
                              <div className="ak-msg-lb">
                                質問
                                {t.contextLabel && <span className="ak-msg-ctx">{t.contextLabel}</span>}
                              </div>
                              <p className="ak-msg-tx">{t.text}</p>
                            </div>
                          </div>
                        )
                      }
                      // ⚖ THE ANSWER HAS A SHAPE, AND IT IS DERIVED (⚖-ADJ D).
                      // The contract returns ONE string; the lead is its first
                      // sentence and the advice is the rest, cut in `ask-ai.ts`.
                      const { lead, advice } = splitLead(t.text)
                      return (
                        <div className="ak-msg" key={t.id}>
                          <div className="ak-msg-a">
                            <div className="ak-msg-lb">AIの回答</div>
                            <p className="ak-lead">{lead}</p>
                            {t.people.length > 0 && (
                              <div className="ak-namerow">
                                {t.people.map((p) => (
                                  <button className="ak-namechip" type="button" data-press key={p.name} onClick={() => fill(p.prompt)}>
                                    <PersonMark />
                                    {p.name}様
                                  </button>
                                ))}
                              </div>
                            )}
                            {advice !== '' && <p className="ak-advice">{advice}</p>}
                            {t.sources.length > 0 && (
                              <div className="ak-cites">
                                {/* ⚖ F2-2 — 出典 HAS ONE HOME: the derived label
                                    already carries the word (⚖ 8/25), so it
                                    renders ALONE. */}
                                <div className="ak-cites-k">{t.sourceCountLabel}</div>
                                <div className="ak-citerow">
                                  {t.sources.map((s) => {
                                    // ⚖-ADJ E — A CITE PILL IS NOT PRESSABLE. No
                                    // room accepts a record-level param at this
                                    // tip (registry ⑥) and this room invents
                                    // none, so the pill is a `<span>` with no
                                    // handler and no pointer: a door that does
                                    // not open must not look like a door.
                                    const { tag, rest } = splitEvidence(s.line)
                                    return (
                                      <span className="ak-cite" key={s.ref}>
                                        {tag !== '' && <span className="ak-cite-tag">{tag}</span>}
                                        <span className="ak-cite-t">{rest}</span>
                                      </span>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* ⚖ ONE 質問のヒント ROW (§2.4). The phone's two prompt systems
                    are both contract and they behave differently, so they keep
                    their two behaviours and lose their two headings: a group word,
                    then chips. 今日 chips walk the send path with their context
                    label; じっくり chips fill only. */}
                {(props.signals.length > 0 || props.templates.length > 0) && (
                  <section
                    className="ak-hints"
                    aria-label="質問のヒント"
                    data-guide-title="質問のヒント"
                    data-guide="質問の下書きです。「今日」は今日の予約とカルテから自動で作られた質問で、押すと入力欄に入り、どの記録を読んで答えるつもりだったのかが表示されます。「じっくり」は業種に合わせたおすすめの質問で、押すと入力欄に入るだけなので、そのまま送らずに書き換えられます。"
                  >
                    <div className="ak-hintrow">
                      <span className="ak-hint-k">質問のヒント</span>
                      {props.signals.length > 0 && (
                        <>
                          <span className="ak-hint-g">今日</span>
                          {props.signals.map((s) => (
                            <button className="ak-hchip" type="button" data-press key={s.id} title={s.title} onClick={() => takeSignal(s)}>
                              {s.tag}
                            </button>
                          ))}
                          <span className="ak-gsep" />
                        </>
                      )}
                      <span className="ak-hint-g">じっくり</span>
                      {props.templates.map((t) => (
                        <button className="ak-hchip" type="button" data-press key={t.id} title={t.preview} onClick={() => takeTemplate(t)}>
                          {t.title}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <section
                  className="ak-composer"
                  aria-label="質問を入力"
                  data-guide-title="質問を入力"
                  data-guide="質問を書いて送るところです。Enterで送信、Shift+Enterで改行します。いまは見本データのため送信はできず、押すと理由がこの上に表示されます。書いた文章はそのまま残ります。"
                >
                  {/* ⚖ D-2 · ⚖ §A-7 — the refusal appears HERE, beside the control
                      that was pressed, and it changes nothing: the question stays
                      in the box, the box stays usable, and the reason names the
                      seam it is waiting on. */}
                  {refusal && (
                    <div className="ak-refusal" role="status" aria-live="polite">
                      <p className="ak-refusal-reason">{refusal.reason}</p>
                      {/* ⚖ F2-3 — the question the press WOULD have sent, when the
                          box already held one: kept where the reader can read and
                          copy it, instead of written over what they were typing. */}
                      {refusal.intended && (
                        <p className="ak-refusal-kept">この質問を送る予定でした：{refusal.intended}</p>
                      )}
                      {refusal.contextLabel && (
                        <p className="ak-refusal-ctx">読み取る予定だったデータ：{refusal.contextLabel}</p>
                      )}
                    </div>
                  )}
                  <div className="ak-inputbox">
                    <textarea
                      ref={inputRef}
                      className="ak-input"
                      rows={2}
                      value={draft}
                      placeholder={props.composer.placeholder}
                      aria-label="お店について質問を入力"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onComposerKey}
                    />
                    {/* ⚖ A CONTROL'S LOOK TELLS ITS STATE (⚖ A10). The mock draws
                        送信 permanently dimmed because it has nothing to send; this
                        room genuinely can be pressed, and refuses honestly, so it
                        is the solid accent whenever there is a question in the box
                        and a wash when there is not. */}
                    <button
                      className="ak-send"
                      type="button"
                      data-press
                      disabled={draft.trim() === ''}
                      onClick={() => refuseSend()}
                    >
                      {props.composer.sendLabel}
                    </button>
                  </div>
                  <div className="ak-inputnotes">
                    <span className="ak-note-a">{props.composer.hint}</span>
                    <span className="ak-sp" />
                    <span className="ak-note-b">{props.footnote}</span>
                  </div>
                </section>
              </section>

              {/* ═══ canon's feed, whole: the count, the badge that comes only
                  from a hard fact, the 根拠 line, the deep link and 却下 ═══
                  ⚖ F2-1 — ITS TOUR SENTENCE IS TRUE IN BOTH STATES: it describes
                  what a 提案 IS instead of promising cards, so the step reads
                  correctly whether the rail is full, empty, or emptied by this
                  reader. */}
              <section
                className="ak-rail"
                aria-label="AIが提案する次のアクション"
                data-guide-title="AIが提案する次のアクション"
                data-guide="記録や予約の変化からAIが提案した、次にやることが並ぶところです。1件ずつ「何をするか」が見出しになっていて、押すと詳しい理由と根拠が開きます。ボタンを押すとその作業をする画面へ移動します。急ぎの目印は、記録そのものに期限や未対応があるときだけ付きます。却下はこの画面の中だけの操作で、保存はされません。"
              >
                {/* ⚖ F-A2 — A PRESSABLE ONLY WHERE IT PRESSES SOMETHING (⚖ §A-2).
                    This head used to be a `<button data-press>` at every width:
                    at the desk its handler was a no-op, the sheet said
                    `cursor: default`, and the press scale fired anyway — a
                    control that answers a finger with nothing. It is a plain
                    row at the desk and the 提案 bar's own toggle at phone.
                    ⚠ SSR AND THE FIRST CLIENT RENDER BOTH SEE `pageWidth === 0`,
                    so both produce the row and there is no hydration mismatch;
                    the swap happens after the layout measurement. */}
                {railCollapsible ? (
                  <button
                    className="ak-rail-hd"
                    type="button"
                    data-press
                    aria-expanded={railOpen}
                    onClick={() => setRailOpen((was) => !was)}
                  >
                    <span className="ak-rail-ttl">AIが提案する次のアクション</span>
                    <span className="ak-sp" />
                    <span className="ak-rail-cnt">提案 <b>{visible.length}</b>件</span>
                    <span className={`ak-rail-cv${railOpen ? ' ak-on' : ''}`}><Chevron /></span>
                  </button>
                ) : (
                  <div className="ak-rail-hd">
                    <span className="ak-rail-ttl">AIが提案する次のアクション</span>
                    <span className="ak-sp" />
                    <span className="ak-rail-cnt">提案 <b>{visible.length}</b>件</span>
                  </div>
                )}
                <div className="ak-rail-body" ref={railRef}>
                  <div>
                    {visible.length === 0 ? (
                      <div className="ak-empty">
                        <strong>{emptyState.title}</strong>
                        <span>{emptyState.body}</span>
                      </div>
                    ) : (
                      <div className="ak-rail-list">
                        {walk.shown.map((c) => (
                          <SugCard
                            key={c.id}
                            card={c}
                            reduced={reduced}
                            collapsing={collapsing.includes(c.id)}
                            onDismiss={dismiss}
                            onCollapsed={onCollapsed}
                          />
                        ))}
                        {/* ⚖ さらに表示 — it rides the list it extends, and it
                            declares itself so the walk explains it the round it
                            lands. It renders ONLY when there is genuinely more,
                            so a store whose whole feed fits shows no control and
                            loses no tour step (⚖ self-registration, both ways). */}
                        {walk.moreLabel && (
                          <div
                            className="ak-more"
                            data-guide-title="さらに表示"
                            data-guide="提案は6件ずつ表示しています。押すと続きの提案が追加され、ボタンには残りの件数が出ます。却下した提案は残りの件数からも外れます。"
                          >
                            <button className="btn ak-btn-out" type="button" data-press onClick={() => setFeedSteps((s) => s + 1)}>
                              {walk.moreLabel}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            {/* ⚖ この画面の値の設定元, FOLDED (§2.6, ⚖-ADJ I). Nothing from the
                trace card is deleted — it moved into a bar at the foot of the
                page and opens DOWNWARD, in flow, which is the family's own shape
                (the 録音 room's footnote and 売上分析's ⚖-ADJ F). */}
            <section
              className="ak-footnote"
              aria-label={props.traceTitle}
              data-guide-title="この画面の値の設定元"
              data-guide="この画面の内容がどこで決まるかの一覧です。下のバーを押すと開きます。「未接続」と書かれている行は、まだ決める画面がつながっていないという意味で、いまは見本の値で表示しています。"
            >
              <button
                className="ak-fn-bar"
                type="button"
                data-press
                aria-expanded={footOpen}
                onClick={() => setFootOpen((was) => !was)}
              >
                <InfoMark />
                {props.footnoteBarLabel}
                <span className="ak-sp" />
                <span className={`ak-fn-cv${footOpen ? ' ak-on' : ''}`}><Chevron /></span>
              </button>
              <div className="ak-fn-panel" ref={footRef}>
                <div className="ak-fn-in">
                  <h2 className="ak-fn-title">{props.traceTitle}</h2>
                  <p className="ak-fn-lead">{props.traceLead}</p>
                  <dl className="ak-prov">
                    {props.trace.map((row) => (
                      <div className="ak-prov-row" key={row.label}>
                        <dt>{row.label}</dt>
                        <dd className={row.unconnected ? 'ak-unconnected' : undefined}>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="ak-samplenote">{props.footnote}</p>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Boundary markup — PRESENT-BUT-INERT, one mount. The matrix row
          `nav.record_ai.ai_consult` defines only a boundary-ENTITLEMENT state
          (no `by_rights` variant), so there is one panel and one copy, canon's.
          `hidden` keeps it out of the layout AND out of the tour: the engine's
          registry drops a node with no box by itself. */}
      <div className="ak-boundary" id="akBoundary" hidden aria-hidden="true">
        <div className="ak-eyebrow">{props.boundary.kicker}</div>
        <h2>{props.boundary.title}</h2>
        <p>{props.boundary.body}</p>
        <Link className="btn primary" href={props.boundary.backHref}>{props.boundary.backLabel}</Link>
      </div>

      {toast && (
        <div className="ak-toast" role="status" aria-live="polite" aria-atomic="true">
          <span className="ak-toast-tx">{toast.text}</span>
          {toast.undoId && (
            <button className="ak-undo" type="button" data-press onClick={() => undo(toast.undoId!)}>
              {props.undoLabel}
            </button>
          )}
        </div>
      )}

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the family's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. The hole is one big
          box-shadow rather than a moved element, so the region stays fully lit
          and nothing on the page is re-laid-out to explain it — and no layer
          owns a scroller, so the ⚖ page-scroll ruling is untouched. */}
      {tourOpen && (
        <>
          <div
            className="ak-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              // A tap on nothing declared ends the tour — the dim layer behaves
              // like the scrim it looks like.
              setTourIdx(hit >= 0 ? hit : -1)
            }}
            onMouseMove={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourHover(hit >= 0 && hit !== tourStep?.idx ? tourRectsRef.current[hit] : null)
            }}
          />
          {tourHover && (
            <div
              className="ak-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="ak-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="ak-spot-card"
            id="akTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="ak-spot-text">{tourStep?.text ?? ''}</span>
            <div className="ak-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="ak-spot-foot">
              <button type="button" className="ak-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="ak-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="ak-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="ak-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

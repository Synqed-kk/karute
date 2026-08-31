'use client'

// 録音 — the computer door onto the SAME recording sessions the phone app mints.
// One truth, two doors: the states, the words, the chips, the consent contract,
// the written-reason discard and the accidental-tap floor all come from the
// phone's own shipped stack, and this room invents none of them.
//
// ⚖ ONE SCREEN AT A TIME (the F5-1 composition law). The page is EITHER the
// recorder — its 対象の予約 card, the 録音セッション panel beside 同意状況, the
// 録音履歴 under them and the trace card — OR the manager's 破棄の記録 review,
// with ← 録音 between them. A detail screen never wears the list's head
// furniture, so the head's own sentence has to be true on both.
//
// ⚖ THE DESIGN SOURCE IS THE PHONE, NOT AN APPROXIMATION OF IT (packet §2f).
// The record button is `RecordButtonCard.tsx`'s: ONE persistent element that
// MORPHS across the three phases, the red-500 family, the 0.34,1.56 overshoot
// curve reserved for the press and the glyph swap and NOTHING else, a live ring,
// a 録音中 flag with its own dot, a tabular-nums timer, and waveform bars that
// move on `transform: scaleY` alone — composite-only, so the bars never lay out.
// The 破棄済み chip is the quietest chip on the card, the recovery banner is the
// amber card with ONE commit button, and every animation trigger is
// motion-safe-gated.
//
// ⚖ DESIGNED AS A COMPUTER PROGRAM (the desk's half). The recorder and the
// consent panel sit side by side because a desk has the width for both at once;
// the 対象の予約 picker is a real select rather than a sheet; the 録音履歴 is a
// full-width table-shaped list rather than a stack of cards; and the manager's
// review opens its rows in place with the transcript beside the reason. The
// RECOGNITION FLOOR holds through all of it: a phone-daily staffer meets the
// same six states, the same words and the same chips.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: which booking the picker is on,
// the demo machine's phase and its elapsed seconds, which dialog is open and
// what has been typed into the discard reason, which demo-local consents have
// been taken, which take's receipt is showing, which review row is expanded, how
// many windows back the 録音履歴 walk has gone, which screen is open, and which
// step of the 画面の説明 tour the reader is on. Every one is browsing or a
// self-contained demo — none of them writes anything. Every control that WOULD
// write ships refused with its own reason.
//
// CLASS NAMES ARE PREFIXED `rc-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and eight
// neighbours state BARE `.biz .<name>` rules on names canon's 録音 page uses
// (`.panel`, `.timer`, `.tag`, `.receipt`, `.toast`, `.spot-card`…). A fence
// that has to enumerate sixty shared names rots as the neighbours grow; not
// colliding at all cannot. `page` / `h1` / `btn` are the SHELL's and restated
// here, so those three are fenced in recording.css at four levels.

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import {
  fmtElapsed,
  keepCardOffHeading,
  waveformBars,
  windowTakes,
  RECORDER_LABEL,
  RECORDER_TONE,
  type RecorderState,
} from '@/business/lib/recording'

/** THE ROUTE WRAPPER. Every rule in recording.css is scoped under this class, so
 *  nothing this sheet says can reach another room; `.page.pg-recording` (four
 *  levels) rather than `.pg-recording` (three) so a sibling's own three-level
 *  rule (`.biz .page .btn`, customers.css:23) cannot win the room back on
 *  insertion order. */
const ROOT = 'page pg-recording'

/** THE PHONE'S OWN ICONS (lucide-react — the app's icon library), inlined as
 *  geometry so this room adds no dependency, no bundle and no request. Every one
 *  is DECORATIVE: the word beside it is what a screen reader reads. Names are
 *  the lucide names, so the phone file each one came from can be checked against
 *  the same word. */
const ICONS = {
  mic: <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" /></>,
  history: <><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>,
  alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>,
  trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
  check: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  ticket: <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />,
} as const

function Icon({ name, size = 13, weight = 2 }: { name: keyof typeof ICONS; size?: number; weight?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}

export interface RecordingContextProps {
  appointmentId: string
  customerId: string
  customerName: string
  staffName: string
  menuName: string
  optionLabel: string
  timeLabel: string
  dateLabel: string
  metaLabel: string
  consentState: 'current' | 'stale' | 'absent'
  consentLabel: string
  consentTone: string
  consentProof: string
  /** ⚖ W7-1 — the gate's ONE answer, decided in `recording.ts` and serialized.
   *  The screen renders it; it never re-decides it, so there is no second home
   *  for a mode or a flag to be read in. */
  canStart: boolean
  gateNote: string | null
  contactTags: string[]
  script: string
  targetRecordId: string | null
  targetOutcomeLabel: string
  targetSummaryLabel: string
  useProof: string
}

export interface RecordingTakeProps {
  id: string
  dayKey: number
  dateLabel: string
  timeLabel: string
  customerLabel: string
  byName: string
  durationLabel: string
  stateLabel: string
  stateChip: string
  reasonLine: string | null
  /** ⚖ A2-3 — carried as its OWN boolean rather than sniffed out of a class
   *  string: the row's gray treatment and the suppressed affordance are two
   *  renderings of ONE verdict (`takeStateOf`), and a screen that re-derived it
   *  from a chip name would be a second home for it. */
  isDiscarded: boolean
  /** `null` = this row offers NOTHING, which is what 破棄済み always is. */
  action: { kind: 'karute' | 'save'; label: string; href: string | null } | null
  karuteRecordLabel: string | null
}

export interface DiscardRowProps {
  takeId: string
  whenLabel: string
  byName: string
  reason: string
  transcript: string[] | null
  absenceLine: string
  durationLabel: string
  ticketNote: string | null
}

export interface RecordingProps {
  dateline: string
  lensLabel: string
  /** The signed-in operator — the 担当者 a demo receipt names. The store's name
   *  is not a person, and the receipt's own field says 担当者. */
  operatorName: string
  subtitle: string
  contexts: RecordingContextProps[]
  defaultAppointmentId: string | null
  takes: RecordingTakeProps[]
  ownDiscardLine: string | null
  historyCaption: string
  counts: {
    thisMonthLine: string
    totalLine: string
    byStaff: Array<{ name: string; line: string }>
    truncatedLine: string | null
    listTruncatedLine: string | null
  }
  discardRows: DiscardRowProps[]
  canReviewDiscards: boolean
  recovery: {
    title: string
    customerLabel: string
    recordedAtLabel: string
    lengthLabel: string | null
    recordedByLabel: string
    belowFloor: boolean
    caption: string
    stopNote: string
  } | null
  noticeLines: string[]
  trace: Array<{ label: string; value: string; href: string | null }>
  traceNote: string
  consentInstructions: string
  contactDisclaimer: string
  transcriptFailedLine: string
  actionFootnote: string
  refusals: {
    use: string
    save: string
    checked: string
    transcript: string
    policy: string
    enroll: string
  }
  karuteHref: string
}

/** ⚖ Liam 8/23 — 画面の説明. The family's own tour helpers, at the same shape:
 *  a rect literal the engine understands, and two identity guards that keep the
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

/** How many bars the waveform draws. The desk gets more of them than a thumb
 *  does — the phone's `DEFAULT_BARS` is 24 — because the width is there and a
 *  wider trace reads as a steadier signal. Same bar, same 3px, same gap. */
const BARS = 40

export function RecordingScreen(props: RecordingProps) {
  // ── which booking, and which screen ───────────────────────────────────────
  const [pickedId, setPickedId] = useState<string | null>(props.defaultAppointmentId)
  const [screen, setScreen] = useState<'record' | 'discards'>('record')

  // ── the demo machine ──────────────────────────────────────────────────────
  const [phase, setPhase] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [tick, setTick] = useState(0)

  // ── the dialogs, and the ONE piece of typed text in the room ──────────────
  const [dialog, setDialog] = useState<'none' | 'consent' | 'discard' | 'use'>('none')
  const [reason, setReason] = useState('')
  const [receipt, setReceipt] = useState<{ target: string; when: string; by: string; reason: string } | null>(null)
  /** Consents taken through the read-aloud flow IN THIS BROWSER. Demo-local and
   *  said so, canon's own honesty (:747) — a real grant is registry ⑥. */
  const [demoConsent, setDemoConsent] = useState<Record<string, true>>({})

  // ── the 録音履歴 walk + the review's open row ──────────────────────────────
  const [steps, setSteps] = useState(1)
  const [openRow, setOpenRow] = useState<string | null>(null)

  // ── 画面の説明 ────────────────────────────────────────────────────────────
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const reviewRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const discardBtnRef = useRef<HTMLButtonElement>(null)

  const current = props.contexts.find((c) => c.appointmentId === pickedId) ?? props.contexts[0] ?? null

  /** ⚖ W7-1 — THE GATE, AND THE ONE PLACE THIS SCREEN ASKS ABOUT IT.
   *
   *  `canStart` is the server's single answer; the ONLY thing that can widen it
   *  here is a consent taken through the read-aloud flow in this browser, which
   *  is the demo standing in for a real grant of the SAME kind (registry ⑥) —
   *  never a mode, never a flag and never an optional field. Written as an `||`
   *  over two consent facts rather than an `&&` over a permission, so nothing
   *  that is not a consent can ever appear in it. */
  const consentOk = current !== null && (current.canStart || demoConsent[current.appointmentId] === true)

  const bars = useMemo(() => waveformBars(BARS, tick), [tick])
  /** The bars a stopped take keeps — frozen at the last live frame and dimmed,
   *  the phone's own ended state (RecordButtonCard.tsx:150). STATE, not a ref:
   *  they are RENDERED, so they are render data, and a ref read during render is
   *  a value React was never told to re-render for. */
  const [frozen, setFrozen] = useState<number[]>([])

  // The demo clock. ONE interval, owned by the phase, torn down with it — a
  // leaked interval is what canon's own `loadContext` had to clear by hand
  // (:763), and an effect that owns its own cleanup cannot leak one.
  useEffect(() => {
    if (phase !== 'recording') return
    const id = window.setInterval(() => {
      setElapsed((s) => s + 1)
      setTick((t) => t + 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase])

  /** Changing the booking resets the machine — canon's own rule (:763), and the
   *  reason it exists is the honest one: a take belongs to the session it was
   *  started on, so carrying elapsed seconds across a picker change would be the
   *  page attributing audio to the wrong customer. The picker is disabled while
   *  the machine is not idle, so this is the belt to that brace. */
  useEffect(() => {
    setPhase('idle')
    setElapsed(0)
    setTick(0)
    setReceipt(null)
    setFrozen([])
  }, [pickedId])

  const reset = () => {
    setPhase('idle')
    setElapsed(0)
    setTick(0)
    setFrozen([])
  }

  const stop = () => {
    setFrozen(bars)
    setPhase('stopped')
  }

  /** ⚠ EVERY WAY OUT OF THE DISCARD DIALOG IS THIS ONE FUNCTION (the F5-2/F5-3
   *  lesson, and canon's own `close` handler :864). Cancel, Escape and the
   *  backdrop all land here, so the reason field is cleared EXACTLY ONCE however
   *  the box was left, and focus returns to the 破棄 button that opened it
   *  rather than dropping to `<body>`. The focus is taken BEFORE the state
   *  change lands, while the dialog is still on screen. */
  const closeDiscard = useCallback(() => {
    discardBtnRef.current?.focus()
    setDialog('none')
    setReason('')
  }, [])

  const closeDialog = useCallback(() => {
    if (dialog === 'discard') {
      closeDiscard()
      return
    }
    setDialog('none')
  }, [dialog, closeDiscard])

  /** ⚖ W7-2 — THE DISCARD SETTLES ONLY WITH A NON-EMPTY WRITTEN REASON, and
   *  there is no other route to this function. Below-floor, above-floor, from
   *  the recorder or from the recovery banner: one dialog, one required free
   *  text, no menu and no pre-select. The guard is here as well as on the
   *  button's `disabled`, so a battery that removes the disabled attribute still
   *  cannot land a reason-free discard. */
  const settleDiscard = () => {
    const text = reason.trim()
    if (text === '' || current === null) return
    setReceipt({
      target: `${current.customerName}様の録音（${current.timeLabel}）`,
      when: `${current.dateLabel} ${current.timeLabel}`,
      by: props.operatorName,
      reason: text,
    })
    setDialog('none')
    setReason('')
    reset()
  }

  // ── the 録音履歴 walk ─────────────────────────────────────────────────────
  const walk = useMemo(() => windowTakes(props.takes, steps), [props.takes, steps])

  // ── screen swap: focus moves with it, in both directions ──────────────────
  const onDiscardScreen = screen === 'discards' && props.canReviewDiscards
  /** ⚖ THE SWAP MUST NOT STRAND THE READER, and it must not STEAL the page
   *  either. Opening the review hides the button that opened it and going back
   *  hides the review, so in both directions the browser would drop focus to
   *  `<body>`; focus is therefore MOVED with the screen. The mount guard is what
   *  keeps the second half from firing on the FIRST render, when nothing was
   *  swapped and nothing should move — a page that grabs focus on load scrolls
   *  a reader somewhere they did not ask to be. */
  const swapped = useRef(false)
  useEffect(() => {
    if (onDiscardScreen) {
      swapped.current = true
      backRef.current?.focus()
      return
    }
    if (!swapped.current) return
    swapped.current = false
    reviewRef.current?.focus()
  }, [onDiscardScreen])

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────
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

  // ONE keyboard listener for the two things that can be open, innermost first:
  // while the tour is up it owns Escape (and the arrows walk the ring); once it
  // is closed Escape reaches whichever dialog is open. Two listeners would both
  // fire on one Escape and close two layers at once (the F5-2 defect).
  useEffect(() => {
    if (dialog === 'none' && !tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (tourOpen) {
        if (e.key === 'Escape') setTourIdx(-1)
        if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
        if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
        return
      }
      if (e.key === 'Escape') closeDialog()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dialog, tourOpen, closeDialog])

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

  // The reason field takes focus on open — two jobs at once, the phone's own
  // (RecordingDiscardReasonDialog): the just-pressed 破棄 button loses keyboard
  // focus so a stray Enter cannot re-fire it behind the backdrop, and the
  // staffer can start typing.
  useEffect(() => {
    if (dialog === 'discard') reasonRef.current?.focus()
  }, [dialog])

  /** A refused control, spelled ONCE. `aria-disabled` rather than `disabled`:
   *  the control stays focusable so its reason is reachable by keyboard and
   *  screen reader. The reason rides the ACCESSIBLE NAME as well as the title,
   *  because a screen reader drops `title` once `aria-describedby` is present.
   *  ⚠ THE CLASSES ARE MERGED HERE and a call site must never write `className`
   *  after this spread (the room-5 F-K1 defect, fixed at the helper so it cannot
   *  recur). */
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
      className: ['btn', className].filter(Boolean).join(' '),
    }
  }

  const live = phase === 'recording'
  const ended = phase === 'stopped' || phase === 'committed'

  return (
    <div className={`${ROOT}${onDiscardScreen ? ' is-review' : ''}`} ref={rootRef}>
      {/* STEP 0. The head declares itself like every other section, so the walk
          opens on what this page is FOR before it starts pointing at parts of
          it. ⚠ ITS SENTENCE IS TRUE ON BOTH SCREENS (F5-1): what stays here is
          what never stops being true — what the page is, where the recordings
          come from, and how the two screens swap. Everything that belongs to ONE
          screen is declared on that screen's own element and drops with it. */}
      <header
        className="rc-head"
        data-guide-title="録音"
        data-guide="施術中の会話を録音して、その録音からカルテを作る画面です。録音そのものはスマホのアプリでも行えます。この画面では、録音を始める前の同意の確認、録音の履歴、そして破棄された録音の記録をまとめて見られます。"
      >
        <div className="rc-eyebrow">{props.dateline}</div>
        <div className="rc-titleline">
          <h1>録音</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR: a spotlight walk of
              everything on this screen, and during the walk you can tap any part
              of the page to jump straight to what it is. A hairline circle,
              never a filled one (⚖ R13). */}
          <button
            className="rc-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="rcTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
        </div>
        {!onDiscardScreen && <p className="rc-subtitle">{props.subtitle}</p>}
      </header>

      {props.noticeLines.length > 0 && (
        <section
          className="rc-notice"
          aria-label="この画面の見え方"
          data-guide-title="この画面の見え方"
          data-guide="この画面で見えるもの・見えないものの説明です。文字起こしを誰が見られるかは店舗の設定で決まる仕組みで、この画面にはまだつないでいません。"
        >
          {props.noticeLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      )}

      {/* ═══ THE RECORDER SCREEN ═══ */}
      <div className="rc-record-view">
        {/* ⚖ W7-3 — THE RECOVERY RESIDUE. ONE slot: the props carry a single
            object or none, so a draft-shaped offer and a take-shaped offer
            cannot both render. ONE action (保存する) and no ✕ — a recording that
            reached this banner is a SYSTEM failure and the staffer's only job is
            to land it (⚖ 8/20 ⑦). The discard exit below it exists ONLY for a
            take under the accidental-tap floor (⚖ 8/26 (b)). */}
        {props.recovery && (
          <section
            className="rc-recovery"
            aria-labelledby="rcRecoveryTitle"
            data-guide-title="保存されなかった録音"
            data-guide="アプリが途中で終わってしまったなどの理由で、保存まで届かなかった録音があるときだけ出る案内です。録音そのものは消えていないので、保存すれば元どおりカルテになります。ごく短い録音のときだけ、理由を書いて破棄することもできます。"
          >
            <strong id="rcRecoveryTitle"><Icon name="alert" size={15} />{props.recovery.title}</strong>
            <dl className="rc-recovery-facts">
              <div><dt>お客様</dt><dd>{props.recovery.customerLabel}</dd></div>
              <div><dt>録音日時</dt><dd className="rc-num">{props.recovery.recordedAtLabel}</dd></div>
              {props.recovery.lengthLabel && (
                <div><dt>長さ</dt><dd className="rc-num">{props.recovery.lengthLabel}</dd></div>
              )}
              <div><dt>録音者</dt><dd>{props.recovery.recordedByLabel}</dd></div>
            </dl>
            <button {...refused('保存する', props.refusals.save, { className: 'rc-recovery-save' })}>
              <Icon name="save" size={16} />保存する
            </button>
            <p className="rc-recovery-caption">{props.recovery.caption}</p>
            <p className="rc-recovery-caption">{props.recovery.stopNote}</p>
            {props.recovery.belowFloor && (
              <button
                className="rc-recovery-discard"
                type="button"
                onClick={() => setDialog('discard')}
              >
                録音を破棄する
              </button>
            )}
          </section>
        )}

        {current === null ? (
          <section
            className="rc-zero"
            aria-label="本日の予約がありません"
            data-guide-title="本日の予約がありません"
            data-guide="この店舗には本日の予約がないため、録音の対象を選べません。予約が入ると、ここに本日の予約が時間順で並びます。"
          >
            <div className="rc-zero-card">
              <strong>本日の予約がありません</strong>
              <p>録音は予約を選んでから始めます。本日の予約が入ると、時間の早い順にここへ並びます。</p>
            </div>
          </section>
        ) : (
          <>
            <section
              className="rc-ctx"
              aria-labelledby="rcCtxTitle"
              data-guide-title="対象の予約"
              data-guide="どの予約の録音をするかを選ぶところです。本日の予約のうち、担当が決まっていて来店なしではないものが時間順に並びます。録音中は取り違えを防ぐため選び直せません。"
            >
              <div className="rc-ctx-head">
                <div className="rc-ctx-who">
                  <div className="rc-kicker">対象の予約</div>
                  <h2 id="rcCtxTitle">{current.customerName}様</h2>
                  <p className="rc-ctx-meta">{current.metaLabel}</p>
                </div>
                <label className="rc-picker">
                  本日の予約から選ぶ
                  <select
                    value={current.appointmentId}
                    aria-label="対象の予約を選ぶ"
                    disabled={phase !== 'idle'}
                    onChange={(e) => setPickedId(e.target.value)}
                  >
                    {props.contexts.map((c) => (
                      <option key={c.appointmentId} value={c.appointmentId}>
                        {c.optionLabel}
                      </option>
                    ))}
                  </select>
                  {phase !== 'idle' && <span className="rc-picker-lock">録音中は選び直せません</span>}
                </label>
              </div>
            </section>

            <div className="rc-two">
              {/* ═══ 録音セッション ═══ */}
              <section
                className="rc-panel rc-session"
                aria-labelledby="rcSessionTitle"
                data-guide-title="録音セッション"
                data-guide="録音の本体です。まん中の赤いボタンで録音を始め、もう一度押すと止まります。録音中は経過時間と音の波が出ます。止めたあとは、その録音をカルテに使うか、理由を書いて破棄するかを選びます。止めただけでは保存されません。"
              >
                <div className="rc-panel-head">
                  <h2 className="rc-sec-title" id="rcSessionTitle">録音セッション</h2>
                  <span className={`rc-state ${RECORDER_TONE[phase]}`}>{RECORDER_LABEL[phase]}</span>
                </div>
                <div className="rc-panel-body">
                  <span className="rc-demo">デモ: 実際の録音は行いません</span>

                  {/* ⚖ THE PHONE'S RECORD BUTTON — ONE PERSISTENT ELEMENT THAT
                      MORPHS. The mic and the stop square cross-fade inside the
                      same button, so the control a staffer presses to stop is
                      literally the control they pressed to start. The 0.34,1.56
                      overshoot is spent on the press and on that glyph swap and
                      nowhere else in this room. */}
                  <div className="rc-btn-wrap">
                    <button
                      type="button"
                      className={`rc-rec${ended ? ' is-ended' : ''}`}
                      disabled={ended || (phase === 'idle' && !consentOk)}
                      aria-label={ended ? '録音終了' : live ? '録音停止' : '録音開始'}
                      onClick={() => {
                        if (ended) return
                        if (live) { stop(); return }
                        if (phase === 'paused') { setPhase('recording'); return }
                        if (!consentOk) return
                        setElapsed(0)
                        setTick(0)
                        setPhase('recording')
                      }}
                    >
                      <span aria-hidden className={`rc-glyph${live ? ' is-hidden' : ''}`}>
                        <Icon name="mic" size={26} weight={2.2} />
                      </span>
                      <span aria-hidden className={`rc-glyph${live ? '' : ' is-hidden'}`}>
                        <span className="rc-stop-square" />
                      </span>
                    </button>
                    {live && <span className="rc-ring" aria-hidden="true" />}
                  </div>

                  {live && (
                    <>
                      {/* ⚖ THE BREATHE KEYFRAME — the house style for
                          「quietly live」. Reduced motion gets a static solid
                          dot: the dot still SAYS live, it simply stops moving. */}
                      <div className="rc-flag">
                        <span className="rc-dot" aria-hidden="true" />
                        録音中
                      </div>
                      <div className="rc-timer" aria-live="polite">{fmtElapsed(elapsed)}</div>
                      {/* scaleY, NOT height: a composite-only property, so the
                          bars never lay out. No transition — the samples are
                          already smoothed. */}
                      <div className="rc-wave" aria-hidden="true">
                        {bars.map((v, i) => (
                          <span key={i} className="rc-bar" style={{ transform: `scaleY(${v})` }} />
                        ))}
                      </div>
                    </>
                  )}

                  {phase === 'paused' && (
                    <>
                      <div className="rc-flag is-paused">
                        <span className="rc-dot is-static" aria-hidden="true" />
                        一時停止中
                      </div>
                      <div className="rc-timer">{fmtElapsed(elapsed)}</div>
                    </>
                  )}

                  {ended && (
                    <>
                      <div className="rc-flag is-ended">録音終了</div>
                      <div className="rc-timer">{fmtElapsed(elapsed)}</div>
                      <div className="rc-wave is-frozen" aria-hidden="true">
                        {frozen.map((v, i) => (
                          <span key={i} className="rc-bar" style={{ transform: `scaleY(${v})` }} />
                        ))}
                      </div>
                    </>
                  )}

                  {phase === 'idle' && (
                    <>
                      <div className="rc-idle-title">録音開始</div>
                      <div className="rc-idle-sub">{current.customerName}様のセッションを録音します。</div>
                    </>
                  )}

                  <div className="rc-controls">
                    {phase === 'recording' && (
                      <>
                        <button className="btn" type="button" onClick={() => setPhase('paused')}>一時停止</button>
                        <button className="btn" type="button" onClick={stop}>停止</button>
                      </>
                    )}
                    {phase === 'paused' && (
                      <>
                        <button className="btn primary" type="button" onClick={() => setPhase('recording')}>再開</button>
                        <button className="btn" type="button" onClick={stop}>停止</button>
                      </>
                    )}
                    {ended && (
                      <button className="btn" type="button" onClick={reset}>やり直す</button>
                    )}
                  </div>

                  {/* ⚖ W7-1 — the closed gate says WHICH of the two reasons it
                      is, in the customer's own case, and it is the same note
                      whether the grant is missing or merely old. */}
                  {phase === 'idle' && !consentOk && current.gateNote && (
                    <p className="rc-gate">{current.gateNote}</p>
                  )}

                  {phase === 'stopped' && (
                    <div className="rc-use">
                      <p className="rc-proof">{current.useProof}</p>
                      <div className="rc-use-row">
                        <button
                          className="btn rc-discard"
                          type="button"
                          ref={discardBtnRef}
                          onClick={() => setDialog('discard')}
                        >
                          <Icon name="trash" size={14} />破棄
                        </button>
                        {/* ⚖ R6-D3 / §2a — THE CONFIRM RENDERS, THE COMMIT
                            REFUSES. This button is a REAL lever: it opens the
                            designed confirm and shows the カルテ record a commit
                            would touch. What refuses is the commit inside it,
                            with the reason that says why THIS one refuses while
                            the 破棄 beside it runs to the end. */}
                        <button className="btn rc-commit" type="button" onClick={() => setDialog('use')}>
                          この録音を使う
                        </button>
                      </div>
                    </div>
                  )}

                  {/* THE RECEIPT — ephemeral, self-contained, and only ever
                      inside the discard flow that just ran (canon :842). */}
                  {receipt && (
                    <section
                      className="rc-receipt"
                      aria-label="破棄の確認"
                      data-guide-title="破棄の確認"
                      data-guide="いま破棄した録音の控えです。何を・いつ・誰が・どんな理由で破棄したかを、その場で読み返せます。この控えはこの流れの中だけのもので、閉じると消えます。破棄そのものの記録は「破棄の記録」に残ります。"
                    >
                      <h3>録音を破棄しました（デモ）</h3>
                      <p>この確認は、いま行った破棄の流れの中だけに表示されます。</p>
                      <dl>
                        <div><dt>対象</dt><dd>{receipt.target}</dd></div>
                        <div><dt>日時</dt><dd className="rc-num">{receipt.when}</dd></div>
                        <div><dt>担当者</dt><dd>{receipt.by}</dd></div>
                        <div><dt>理由</dt><dd>{receipt.reason}</dd></div>
                      </dl>
                      <button className="btn" type="button" onClick={() => setReceipt(null)}>閉じる</button>
                    </section>
                  )}
                </div>
              </section>

              {/* ═══ 同意状況 ═══ */}
              <section
                className="rc-panel rc-consent"
                aria-labelledby="rcConsentTitle"
                data-guide-title="同意状況"
                data-guide="録音を始めてよいかどうかの確認です。いまの説明文で同意をいただけている予約だけ録音を始められます。同意が古いときも新しく取り直しが必要です。下のタグは連絡してよい手段の記録で、録音の同意とは別のものです。"
              >
                <div className="rc-panel-head">
                  <div>
                    <h2 className="rc-sec-title" id="rcConsentTitle">同意状況</h2>
                    <span className="rc-panel-sub">録音に必要な同意の確認</span>
                  </div>
                  <span className={`rc-consent-pill ${consentOk ? 'is-true' : current.consentTone}`}>
                    <Icon name="shield" size={12} />
                    {consentOk && !current.canStart ? '同意あり（デモ）' : current.consentLabel}
                  </span>
                </div>
                <div className="rc-panel-body">
                  <div className="rc-tags">
                    {current.contactTags.length > 0 ? (
                      current.contactTags.map((t) => (
                        <span className="rc-tag" key={t}>{t}</span>
                      ))
                    ) : (
                      <span className="rc-tag is-muted">許可された連絡手段なし</span>
                    )}
                  </div>
                  <p className="rc-note">{props.contactDisclaimer}</p>
                  <p className="rc-proof">
                    {demoConsent[current.appointmentId]
                      ? 'この録音セッションの同意は、読み上げによる確認で取得しました（デモ・この端末のみ）。'
                      : current.consentProof}
                  </p>
                  {!consentOk && (
                    <button className="btn primary rc-consent-open" type="button" onClick={() => setDialog('consent')}>
                      同意取得フローを開始
                    </button>
                  )}
                  <p className="rc-note rc-policy">
                    録音の同意は、この製品の決まりとして必ず取得します。店舗ごとの切り替えはありません。
                  </p>
                </div>
              </section>
            </div>
          </>
        )}

        {/* ═══ 録音履歴 ═══ */}
        <section
          className="rc-history"
          aria-labelledby="rcHistoryTitle"
          data-guide-title="録音履歴"
          data-guide="この画面から見える録音の一覧です。新しい順に並び、それぞれの録音がいまどうなっているか（保存済み・確認待ち・処理中・失敗・復元可能・破棄済み）が右側に出ます。破棄済みの録音には操作ボタンが出ません — 決着がついた録音だからです。"
        >
          <div className="rc-history-head">
            <span className="rc-history-icon" aria-hidden="true"><Icon name="history" size={15} /></span>
            <h2 className="rc-sec-title" id="rcHistoryTitle">録音履歴</h2>
            <span className="rc-history-cap">{props.historyCaption}</span>
            {props.canReviewDiscards && (
              <button
                className="btn rc-review-open"
                type="button"
                ref={reviewRef}
                onClick={() => setScreen('discards')}
              >
                破棄の記録<Icon name="chevron" size={13} />
              </button>
            )}
          </div>
          {/* ⚖ 8/25 ruling B, staff half — 自分が今月破棄した録音 {n}件, a
              LABELLED PLAIN FACT in muted type. `null` renders NOTHING, never 0:
              a zero we cannot stand behind is a claim. */}
          {props.ownDiscardLine && <p className="rc-own-count">{props.ownDiscardLine}</p>}

          {props.takes.length === 0 ? (
            <div className="rc-empty">
              <strong>この画面から見える録音はまだありません</strong>
              <span>録音を始めると、新しい順にここへ並びます。</span>
            </div>
          ) : (
            <div className="rc-rows">
              <div className="rc-rowhead" aria-hidden="true">
                <span>日付</span>
                <span>お客様</span>
                <span>録音者</span>
                <span>長さ</span>
                <span>状態</span>
                <span />
              </div>
              {walk.visible.map((t) => (
                <div className={`rc-row${t.isDiscarded ? ' is-discarded' : ''}`} key={t.id} data-state={t.stateLabel}>
                  <span className="rc-c-date rc-num">{t.dateLabel} {t.timeLabel}</span>
                  <span className="rc-c-cust">
                    {t.customerLabel}
                    {t.karuteRecordLabel && <span className="rc-c-rec">カルテ {t.karuteRecordLabel}</span>}
                  </span>
                  <span className="rc-c-by">{t.byName}</span>
                  <span className="rc-c-dur rc-num">{t.durationLabel}</span>
                  <span className="rc-c-state">
                    <span className={t.stateChip}>{t.stateLabel}</span>
                  </span>
                  <span className="rc-c-act">
                    {/* ⚖ R2 + A2-3 — a 破棄済み row offers NOTHING: no 開く, no
                        保存, no 再試行. The evidence is kept internally; the
                        affordance is suppressed, decided from the state alone. */}
                    {t.action === null ? null : t.action.kind === 'karute' && t.action.href ? (
                      <Link className="btn rc-quiet" href={t.action.href}>{t.action.label}</Link>
                    ) : (
                      <button {...refused(t.action.label, props.refusals.save, { className: 'rc-row-save' })}>
                        <Icon name="save" size={13} />{t.action.label}
                      </button>
                    )}
                  </span>
                  {/* ⚠ THE REASON IS THE ROW'S OWN SUB-LINE, spanning it, which
                      is also the phone's own shape (RecordingsInboxCard renders
                      it as a `<p>` under the row). It used to live INSIDE the
                      state cell, where its sentence sized that cell's track: at
                      390 the two rows carrying a long reason squeezed 顧客未設定
                      to one character per line. Caught in my own read of the
                      390 shot. */}
                  {t.reasonLine && <span className="rc-c-reason">{t.reasonLine}</span>}
                </div>
              ))}
              {walk.hidden > 0 && (
                <div
                  className="rc-more"
                  data-guide-title="さらに表示"
                  data-guide="この一覧は新しい日付から順に、1週間ぶんずつさかのぼって読み込みます。押すと、さらに前の期間の録音が下に追加されます。"
                >
                  <button className="btn" type="button" onClick={() => setSteps((s) => s + 1)}>
                    さらに表示（あと{walk.hidden}件）
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ═══ この画面の値の設定元 ═══ */}
        <section
          className="rc-trace"
          aria-labelledby="rcTraceTitle"
          data-guide-title="この画面の値の設定元"
          data-guide="この画面が出している値が、どこで決まっているかの一覧です。まだつないでいないものは「未接続」と書いてあります。担当者の名簿だけは、いまも開けるスタッフ・シフトの画面につながっています。"
        >
          <h2 className="rc-sec-title" id="rcTraceTitle">この画面の値の設定元</h2>
          <p className="rc-note">{props.traceNote}</p>
          <dl className="rc-trace-rows">
            {props.trace.map((row) => (
              <div className="rc-trace-row" key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  {row.href ? <Link href={row.href}>{row.value}</Link> : row.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="rc-trace-acts">
            <button {...refused('録音の設定を開く', props.refusals.policy)}>録音の設定を開く</button>
            <button {...refused('自分の音声を登録', props.refusals.enroll)}>自分の音声を登録</button>
          </div>
        </section>

        <p className="rc-footnote" id="rcFootnote">{props.actionFootnote}</p>
      </div>

      {/* ═══ THE MANAGER'S 破棄の記録 REVIEW — ITS OWN SCREEN (F5-1) ═══ */}
      {props.canReviewDiscards && (
        <div className="rc-review-view">
          {/* ⚠ ONE NAME, ONE PLACE (⚖ A8). The screen used to print 「破棄の記録」
              twice — once as a breadcrumb line and again as the heading right
              under it — which is a page saying the same thing to itself. The
              back control moves onto the heading's own row instead, which is
              where a reader looks for the way out anyway. */}
          <section
            className="rc-review-head"
            aria-labelledby="rcReviewTitle"
            data-guide-title="破棄の記録"
            data-guide="破棄された録音の記録です。スタッフが書いた理由と、その録音の文字起こしを並べて確認できます。文字起こしがない場合は、なぜないのかを書いています。承認や確認の操作はありません — 読むための画面です。右上の「録音」から録音の画面に戻れます。"
          >
            <div className="rc-review-title">
              <h2 className="rc-sec-title" id="rcReviewTitle">破棄の記録</h2>
              <button className="rc-back" type="button" ref={backRef} onClick={() => setScreen('record')}>
                ← 録音
              </button>
            </div>
            <p className="rc-note">
              録音を破棄したときの理由と、その録音の文字起こしです。破棄した録音は一覧から消えず、記録として残ります。
            </p>
          </section>

          {/* ⚖ 8/25 RULING B — LABELLED PLAIN FACTS, both ways, in neutral type.
              No red, no threshold, no grade, no ranking control: a discard count
              must never be the thing that makes a staff member hesitate to
              discard a recording they should discard. */}
          <section
            className="rc-counts"
            aria-label="破棄の件数"
            data-guide-title="破棄の件数"
            data-guide="破棄された録音の件数です。今月の件数と、記録に残っている全部の件数の両方を出しています。スタッフごとの件数も今月ぶんだけ出しますが、順位をつけるためのものではありません。"
          >
            <p className="rc-count">{props.counts.thisMonthLine}</p>
            <p className="rc-count">{props.counts.totalLine}</p>
            {props.counts.truncatedLine && <p className="rc-count is-note">{props.counts.truncatedLine}</p>}
          </section>

          {props.counts.byStaff.length > 0 && (
            <section
              className="rc-bystaff"
              aria-labelledby="rcByStaffTitle"
              data-guide-title="スタッフ別（今月）"
              data-guide="今月、誰が何件破棄したかです。多い順に並んでいますが、評価のための順位ではありません。件数そのものが問題なのではなく、理由を読むためのきっかけです。"
            >
              <h3 className="rc-sec-title" id="rcByStaffTitle">スタッフ別（今月）</h3>
              <ul>
                {props.counts.byStaff.map((s) => (
                  <li key={s.name}>
                    <span>{s.name}</span>
                    <span className="rc-num">{s.line}</span>
                  </li>
                ))}
              </ul>
              {props.counts.truncatedLine && <p className="rc-count is-note">{props.counts.truncatedLine}</p>}
            </section>
          )}

          {props.discardRows.length === 0 ? (
            <div className="rc-empty">
              <strong>破棄の記録はまだありません</strong>
              <span>録音を破棄すると、その理由がここに残ります。</span>
            </div>
          ) : (
            <ul className="rc-review-rows">
              {props.discardRows.map((r) => (
                <li key={r.takeId}>
                  {/* THE ROW IS THE CONTROL, and it is deliberately quiet — the
                      one-way accent law lets a pressable be quieter than accent,
                      and nothing on this screen should read as an alarm. */}
                  <button
                    className="rc-review-row"
                    type="button"
                    aria-expanded={openRow === r.takeId}
                    onClick={() => setOpenRow((was) => (was === r.takeId ? null : r.takeId))}
                  >
                    <span className="rc-review-when">
                      <span className="rc-num">{r.whenLabel}</span>
                      <span className="rc-review-by">{r.byName}</span>
                      <span className="rc-num rc-review-dur">{r.durationLabel}</span>
                    </span>
                    {/* ⚖ 8/25 RULING A — BOTH HALVES ARE LABELLED. The manager
                        reads the staffer's CLAIM against the EVIDENCE, and an
                        opened row is two runs of Japanese prose: leaving the
                        upper one unnamed lets a skimming reader take the
                        staffer's words for the system's record. */}
                    <span className="rc-review-label">スタッフの記入した理由</span>
                    <span className="rc-review-reason">{r.reason}</span>
                    <span className="rc-review-toggle">
                      {openRow === r.takeId ? '閉じる' : '文字起こしを見る'}
                    </span>
                  </button>
                  {openRow === r.takeId && (
                    <div className="rc-review-body">
                      {r.transcript && r.transcript.length > 0 ? (
                        <>
                          <p className="rc-review-label">文字起こし（全文）</p>
                          <p className="rc-review-text">{r.transcript.join('\n\n')}</p>
                        </>
                      ) : (
                        /* ⚖ ABSENCE IS NEVER A PLACEHOLDER — and never says the
                           words were LOST. Under the floor nothing was ever
                           transcribed (the spend gate); everything else is a
                           plain 「ありません」. */
                        <p className="rc-review-absent">{r.absenceLine}</p>
                      )}
                      {r.ticketNote && <p className="rc-review-ticket"><Icon name="ticket" size={13} />{r.ticketNote}</p>}
                      {/* ⚖ ✓確認済み DOES NOT EXIST — registry ⑩. The lever is
                          shown REFUSED with the honest note rather than omitted,
                          because a manager who expects it should learn WHY it is
                          not there. */}
                      <div className="rc-review-acts">
                        <button {...refused('確認済みにする', props.refusals.checked)}>
                          <Icon name="check" size={13} />確認済みにする
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {props.counts.listTruncatedLine && <p className="rc-count is-note">{props.counts.listTruncatedLine}</p>}

          <p className="rc-footnote">
            {props.refusals.transcript}
          </p>
        </div>
      )}

      {/* ═══ THE READ-ALOUD CONSENT FLOW ═══ */}
      {dialog === 'consent' && current && (
        <Overlay label="録音の同意を取得" onClose={closeDialog}>
          <h2>録音の同意を取得</h2>
          <p className="rc-dlg-sub">{props.consentInstructions}</p>
          <div className="rc-script">{current.script}</div>
          <div className="rc-dlg-foot">
            <button className="btn" type="button" onClick={closeDialog}>キャンセル</button>
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                setDemoConsent((was) => ({ ...was, [current.appointmentId]: true }))
                setDialog('none')
              }}
            >
              同意を取得しました
            </button>
          </div>
          {/* Canon's own honesty (:783): the grant lands in this browser and
              nowhere else. Registry ⑥ is where it becomes real. */}
          <p className="rc-dlg-note">この同意はデモとしてこの端末にだけ残ります。実際の記録にはまだ保存されません。</p>
        </Overlay>
      )}

      {/* ═══ ⚖ W7-2 — THE WRITTEN-REASON DISCARD, THE ONLY DISCARD ROUTE ═══ */}
      {dialog === 'discard' && (
        <Overlay label="録音を破棄する理由" onClose={closeDiscard}>
          <h2>録音を破棄する理由</h2>
          <p className="rc-dlg-sub">破棄は通常とは異なる操作です</p>
          <label className="rc-reason" htmlFor="rcReason">理由（必須）</label>
          <textarea
            id="rcReason"
            ref={reasonRef}
            value={reason}
            rows={4}
            maxLength={2000}
            aria-label="破棄する理由"
            placeholder="破棄する理由を入力してください（必須）"
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="rc-disclosure">破棄の記録（日時・担当者・理由）が残ります。</p>
          <div className="rc-dlg-foot">
            <button className="btn" type="button" onClick={closeDiscard}>キャンセル</button>
            <button
              className="btn rc-danger"
              type="button"
              disabled={reason.trim() === ''}
              onClick={settleDiscard}
            >
              破棄する
            </button>
          </div>
        </Overlay>
      )}

      {/* ═══ THE USE CONFIRM — the designed shape, and its commit REFUSES ═══ */}
      {dialog === 'use' && current && (
        <Overlay label="この録音を使いますか？" onClose={closeDialog}>
          <h2>{current.customerName}様の録音を使いますか？</h2>
          <p className="rc-dlg-sub">反映されるカルテ記録を確認してください</p>
          <dl className="rc-target">
            <div><dt>対象カルテ記録</dt><dd>{current.targetRecordId ?? '新規作成'}</dd></div>
            <div><dt>顧客</dt><dd>{current.customerName}</dd></div>
            <div><dt>現在の結果</dt><dd>{current.targetOutcomeLabel}</dd></div>
            <div><dt>AI要約の状態</dt><dd>{current.targetSummaryLabel}</dd></div>
          </dl>
          <p className="rc-proof">{props.refusals.use}</p>
          <div className="rc-dlg-foot">
            <button className="btn" type="button" onClick={closeDialog}>戻る</button>
            <button {...refused('この録音を使う', props.refusals.use, { className: 'rc-commit' })}>
              この録音を使う
            </button>
            <Link className="btn" href={props.karuteHref}>カルテ一覧を開く</Link>
          </div>
        </Overlay>
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
            className="rc-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
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
              className="rc-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="rc-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="rc-spot-card"
            id="rcTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="rc-spot-text">{tourStep?.text ?? ''}</span>
            <div className="rc-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="rc-spot-foot">
              <button type="button" className="rc-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="rc-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="rc-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="rc-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The room's dialog shell — a HAND-ROLLED overlay, matching the phone's own
 * record-screen dialogs (RecordingConsentDialog, RecordingDiscardReasonDialog)
 * rather than a native `<dialog>`.
 *
 * ⚠ THAT IS THE §A-5 LESSON, NOT A PREFERENCE: Tailwind's preflight killed
 * native dialog centering on the today board and pinned dialogs to the viewport
 * corner. A fixed panel centred by transform cannot have that defect, and it is
 * the shape the phone already ships, so the recognition floor gets it for free.
 *
 * ⚠ AND IT DOES NOT ANIMATE ITS EXIT, deliberately (§2c's B3+B4 rider). The exit
 * is an instant unmount — the phone's own behaviour — so the closing-disable /
 * inert / exit-keyframe / timeout-belt pattern has nothing to guard: there is no
 * window in which a closing dialog is still hit-testable. An animated exit would
 * owe all four; this one owes none, which is why it does not have them.
 *
 * Keyboard containment is the phone's: Tab and Shift+Tab wrap inside the panel
 * rather than escaping to the page underneath, and Escape is the parent's ONE
 * listener so it cannot close two layers at once.
 */
function Overlay({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]',
      ) ?? [],
    )
    if (focusable.length === 0) { e.preventDefault(); return }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <>
      <div className="rc-scrim" onClick={onClose} />
      <div
        className="rc-dlg"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </>
  )
}

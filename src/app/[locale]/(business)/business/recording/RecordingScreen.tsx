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
  TAKE_STATE_LABEL,
  type RecorderState,
  type TranscriptEntry,
} from '@/business/lib/recording'

/**
 * ⚠ THE ONE CLOCK IN THIS SCREEN, AND IT EXISTS FOR EXACTLY ONE FIELD.
 *
 * Every other date on this page is formatted on the SERVER and crosses as a
 * string, because a render-time date must be the same on both sides of
 * hydration. The discard receipt's 日時 is a different kind of fact: it is the
 * moment the staffer pressed 破棄する, which no server render can know and which
 * only exists AFTER an interaction — so there is no first render for it to
 * disagree with. Canon stamps it with `new Date()` at settle (:843) for the same
 * reason, and the dialog one line above has just PROMISED it
 * (「破棄の記録（日時・担当者・理由）が残ります。」).
 *
 * JST is stated explicitly rather than left to the browser: the record it stands
 * in for is a JST record, and a staffer travelling is not a reason for a receipt
 * to name a different hour than the ledger will.
 */
const JST_STAMP = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
})

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
  /** The row's identity anchor — the customer's own first character, or 「？」 for
   *  an unbound take. Decorative: the name is printed beside it. */
  customerInitial: string
  hasCustomer: boolean
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

/** ⚖ THE APPROVED 8/31 MOCK'S ROW — CUSTOMER-LED. A manager scanning a month of
 *  discards is looking for a session, and a session is a person at a time. */
export interface DiscardRowProps {
  takeId: string
  customerLabel: string
  hasCustomer: boolean
  initial: string
  recordedAtLabel: string
  /** The same moment without the year — the master list's own line. */
  recordedShortLabel: string
  discardedAtLabel: string
  /** 「47分18秒」 / 「8秒」 / 「記録なし」 — the length ALONE, so the row's pill, the
   *  detail's 録音時間 and the reading panel's header cannot disagree. */
  lengthText: string
  byName: string
  reason: string
  /** ⚖ Liam 8/31 — the transcript arrives ALREADY laid out for the bounded
   *  reading panel: its lines with the moment each was said, and the 5分 markers
   *  derived from those moments. `null` = no words were ever kept. */
  transcript: TranscriptEntry[] | null
  absenceLine: string
  ticketNote: string | null
}

export interface RecordingProps {
  dateline: string
  lensLabel: string
  /** The signed-in operator — the 担当者 a demo receipt names. The store's name
   *  is not a person, and the receipt's own field says 担当者. */
  operatorName: string
  subtitle: string
  /** ⚠ THE HEAD'S 画面の説明 SENTENCE, ASSEMBLED FROM ACCESS like
   *  `historyCaption`, `noticeLines` and `ownDiscardLine` (B1-9). It used to be
   *  hardcoded and promised 破棄の記録 to a スタッフ reader, for whom that screen
   *  does not exist. */
  headGuide: string
  contexts: RecordingContextProps[]
  defaultAppointmentId: string | null
  takes: RecordingTakeProps[]
  ownDiscardLine: string | null
  historyCaption: string
  /** ⚠ `null` FOR A READER WHO MAY NOT REVIEW DISCARDS, and that is the point:
   *  the counts are gated where the rows are gated, above the serializer, so a
   *  staff persona's props carry no per-staff count row for a screen to hide. */
  counts: {
    thisMonthLine: string
    totalLine: string
    byStaffLabel: string
    byStaff: Array<{ cardId: string; name: string; line: string }>
    truncatedLine: string | null
    listTruncatedLine: string | null
  } | null
  discardRows: DiscardRowProps[]
  canReviewDiscards: boolean
  recovery: {
    title: string
    customerLabel: string
    recordedAtLabel: string
    lengthLabel: string | null
    recordedByLabel: string
    belowFloor: boolean
    /** ⚠ 保存する FOR A BOUND TAKE, 「お客様を選んで保存する」 FOR AN UNBOUND ONE —
     *  the phone's own branch (`RecoveryBanner.tsx:181-187`). An unbound take has
     *  no destination yet, so the next step is not the same step. */
    saveLabel: string
    caption: string
    stopNote: string
  } | null
  noticeLines: string[]
  trace: Array<{ label: string; value: string; href: string | null }>
  traceNote: string
  consentInstructions: string
  contactDisclaimer: string
  /** ⚖ W7-2 — THE REFUSED WRITE'S OWN RENDERING, behind `?discardFail=`. `null`
   *  on every ordinary render: a dialog that always fails would be claiming a
   *  failure that did not happen. When it is set, the confirm goes 破棄中... and
   *  then this sentence renders inline with the typed reason still in the field,
   *  the dialog still open and nothing discarded. */
  discardFail: { submitLabel: string; errorLine: string } | null
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

/** How long the `?discardFail=` demo spends in 破棄中... before the refusal
 *  arrives. Long enough that the waiting state is a state a reader (and the
 *  probe) can actually see, short enough that nobody wonders. */
const WRITE_MS = 500

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
  /** ⚖ W7-2 — THE REFUSED WRITE, WHICH IS A DESIGNED STATE AND NOT AN ACCIDENT.
   *  Only reachable behind `?discardFail=` (`props.discardFail`), because a
   *  dialog that always failed would claim a failure that did not happen. While
   *  `submitting` the confirm reads 破棄中... and every exit is shut, exactly as
   *  the phone's own dialog does it; `submitError` then renders inline and the
   *  typed reason is STILL THERE — the confirm is the final commitment gate, so
   *  a write that did not land must leave the staffer where they were. */
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  /** ⚠ WHO OPENED THE DISCARD DIALOG, AND ABOUT WHAT.
   *
   *  The dialog used to be parameterless while TWO different controls opened it
   *  — the recorder's 破棄 and the recovery banner's — and the settle then read
   *  the RECORDER's context whichever one had been pressed. Throwing away the
   *  6-second residue from yesterday printed a receipt naming today's 10:00
   *  booking: a different customer, a different session, a different day. The
   *  phone parameterizes its own dialog by entry point for exactly this reason
   *  (§2b-2), so this room does too. */
  const [discardOf, setDiscardOf] = useState<'recorder' | 'recovery'>('recorder')
  const [receipt, setReceipt] = useState<
    { of: 'recorder' | 'recovery'; target: string; when: string; by: string; reason: string } | null
  >(null)
  /** ⚖ 8/26 (b) — THE EXIT HAS TO ACTUALLY EXIT. `props.recovery` is
   *  server-derived, so nothing on the client can clear it; without this flag the
   *  banner stood there after its own discard settled, still offering to save the
   *  take the receipt had just said was thrown away. Demo-local, exactly like
   *  `demoConsent`, and the receipt takes its place so the slot resolves rather
   *  than merely emptying. */
  const [recoveryDismissed, setRecoveryDismissed] = useState(false)
  /** Consents taken through the read-aloud flow IN THIS BROWSER. Demo-local and
   *  said so, canon's own honesty (:747) — a real grant is registry ⑥. */
  const [demoConsent, setDemoConsent] = useState<Record<string, true>>({})

  // ── the 録音履歴 walk + the review's open row ──────────────────────────────
  const [steps, setSteps] = useState(1)
  const [openRow, setOpenRow] = useState<string | null>(null)
  /** ⚖ the pill/count law — one state at a time, and the chip's number is
   *  exactly what its press reveals. `null` = すべて. */
  const [stateFilter, setStateFilter] = useState<string | null>(null)

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
  /** ⚖ LA-4 / F5-3 — EVERY DIALOG RETURNS FOCUS TO THE CONTROL THAT OPENED IT.
   *  Only the recorder's 破棄 used to; the banner's discard link, the consent
   *  flow and the use confirm all dropped the reader to `<body>` on cancel. */
  const recoveryDiscardRef = useRef<HTMLButtonElement>(null)
  const consentOpenRef = useRef<HTMLButtonElement>(null)
  const useOpenRef = useRef<HTMLButtonElement>(null)
  const receiptCloseRef = useRef<HTMLButtonElement>(null)

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
    // …the RECORDER's receipt belongs to the booking that was just left; the
    // recovery residue's receipt belongs to no booking at all and survives.
    setReceipt((r) => (r?.of === 'recovery' ? r : null))
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
    // ⚠ AND AN IN-FLIGHT WRITE IS NOT A MOMENT TO LEAVE, whichever exit is
    // taken. The guard is HERE rather than on the button, because cancel, the
    // backdrop and Escape all land in this one function — the phone puts the
    // same `if (!submitting)` on all three of its own exits.
    if (submitting) return
    // …and it returns focus to WHICHEVER control opened it — the recorder's 破棄
    // or the banner's discard link.
    ;(discardOf === 'recovery' ? recoveryDiscardRef : discardBtnRef).current?.focus()
    setDialog('none')
    setReason('')
    // the refusal belongs to the attempt that was made, not to the next one
    setSubmitError(null)
  }, [discardOf, submitting])

  const closeDialog = useCallback(() => {
    if (dialog === 'discard') {
      closeDiscard()
      return
    }
    if (dialog === 'consent') consentOpenRef.current?.focus()
    if (dialog === 'use') useOpenRef.current?.focus()
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
    if (text === '') return
    // ⚠ THE REFUSED WRITE, AND IT REFUSES BEFORE ANYTHING SETTLES. Nothing is
    // discarded until the trace has landed, so this returns above every line
    // that mints a receipt, resolves the banner or resets the machine — a
    // failure that had already changed one of those would be the exact defect
    // the phone's own dialog comment names (:20-23).
    if (props.discardFail !== null) {
      setSubmitError(null)
      setSubmitting(true)
      return
    }
    // ⚠ 日時 IS THE DISCARD'S OWN MOMENT, not the booking's start time. The two
    // used to be the same string, so the receipt stated the session's hour twice
    // and never stated the one the dialog had just promised to keep.
    const when = JST_STAMP.format(new Date())
    if (discardOf === 'recovery') {
      const r = props.recovery
      // The banner is what opened this dialog, so if it is gone the settle has
      // nothing to be about — and it never silently no-ops with a filled field.
      if (r === null) return
      setReceipt({
        of: 'recovery',
        target: `${r.customerLabel}の録音（${r.recordedAtLabel}${r.lengthLabel === null ? '' : ` ・ ${r.lengthLabel}`}）`,
        when,
        by: props.operatorName,
        reason: text,
      })
      // the ⚖ 8/26 (b) exit ACTUALLY EXITS — the slot resolves into the receipt
      setRecoveryDismissed(true)
    } else {
      // ⚠ AND THE RECORDER PATH STILL NEEDS A BOOKING: it is the picked
      // session's take that is being thrown away. `reset()` fires HERE and only
      // here — the recovery banner is not the machine, and resetting a recorder
      // that was never recording is a lever pretending to do something.
      if (current === null) return
      setReceipt({
        of: 'recorder',
        target: `${current.customerName}様の録音（${current.timeLabel}）`,
        when,
        by: props.operatorName,
        reason: text,
      })
      reset()
    }
    setDialog('none')
    setReason('')
  }

  // ── the 録音履歴 walk ─────────────────────────────────────────────────────
  const walk = useMemo(() => windowTakes(props.takes, steps), [props.takes, steps])

  /** ⚖ THE PILL/COUNT LAW — each chip's number is EXACTLY what its press
   *  reveals, so both are taken over the SAME set: the window the walk has
   *  opened. Pressing さらに表示 widens the window and every number moves with
   *  it. States with nothing in the window get no chip: a 0 that reveals
   *  nothing is a claim, not a count. 破棄済み is always among them when there
   *  is one — existence is never hidden (⚖ 8/20 ①) — and no chip carries a
   *  colour, so the discard chip cannot be the loud one. */
  const filters = useMemo(() => {
    const n = new Map<string, number>()
    for (const t of walk.visible) n.set(t.stateLabel, (n.get(t.stateLabel) ?? 0) + 1)
    return Object.values(TAKE_STATE_LABEL)
      .filter((label) => n.has(label))
      .map((label) => ({ label, n: n.get(label)! }))
  }, [walk])
  const rows = stateFilter === null ? walk.visible : walk.visible.filter((t) => t.stateLabel === stateFilter)

  /** The recovery residue, as the SCREEN sees it: the server's slot until its
   *  own discard resolves it. */
  const recovery = recoveryDismissed ? null : props.recovery

  /** The receipt is the thing that just happened, so it takes the keyboard —
   *  the dialog that owned focus has unmounted and `<body>` is not an answer. */
  useEffect(() => {
    if (receipt) receiptCloseRef.current?.focus()
  }, [receipt])

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

  /** The pretend round trip the `?discardFail=` demo stands in for. ONE timer,
   *  owned by the state that started it and torn down with it — the demo clock's
   *  own shape, for the same reason. It exists because 破棄中... is a state a
   *  reader has to be able to SEE: a refusal that arrived in the same frame as
   *  the press would show the error and never the wait. */
  useEffect(() => {
    if (!submitting || props.discardFail === null) return
    const id = window.setTimeout(() => {
      setSubmitting(false)
      setSubmitError(props.discardFail!.errorLine)
    }, WRITE_MS)
    return () => window.clearTimeout(id)
  }, [submitting, props.discardFail])

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
  /** ⚠ FOUR STATES, AND 停止 IS THE LAST ONE (R6-18). ⚖ R6-D3's commit refuses,
   *  so nothing can put this machine into canon's 反映済み — the branch used to
   *  read `phase === 'stopped' || phase === 'committed'`, where the second term
   *  was unreachable by construction. The fifth returns with registry ⑦. */
  const ended = phase === 'stopped'

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
        data-guide={props.headGuide}
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
        {recovery && (
          <section
            className="rc-recovery"
            aria-labelledby="rcRecoveryTitle"
            data-guide-title="保存されなかった録音"
            data-guide="アプリが途中で終わってしまったなどの理由で、保存まで届かなかった録音があるときだけ出る案内です。録音そのものは消えていないので、保存すれば元どおりカルテになります。ごく短い録音のときだけ、理由を書いて破棄することもできます。"
          >
            <strong id="rcRecoveryTitle"><Icon name="alert" size={15} />{recovery.title}</strong>
            <dl className="rc-recovery-facts">
              <div><dt>お客様</dt><dd>{recovery.customerLabel}</dd></div>
              <div><dt>録音日時</dt><dd className="rc-num">{recovery.recordedAtLabel}</dd></div>
              {recovery.lengthLabel && (
                <div><dt>長さ</dt><dd className="rc-num">{recovery.lengthLabel}</dd></div>
              )}
              <div><dt>録音者</dt><dd>{recovery.recordedByLabel}</dd></div>
            </dl>
            {/* ⚠ THE LABEL BRANCHES ON WHETHER THE TAKE HAS A DESTINATION and
                the REFUSAL does not — an unbound residue's next step is picking
                the customer, and telling a staffer 保存する for a take with
                nowhere to save it is the wrong instruction rather than a
                shorter one (B1-11, the phone's own branch). */}
            <button {...refused(recovery.saveLabel, props.refusals.save, { className: 'rc-recovery-save' })}>
              <Icon name="save" size={16} />{recovery.saveLabel}
            </button>
            <p className="rc-recovery-caption">{recovery.caption}</p>
            <p className="rc-recovery-caption">{recovery.stopNote}</p>
            {recovery.belowFloor && (
              <button
                className="rc-recovery-discard"
                type="button"
                ref={recoveryDiscardRef}
                onClick={() => { setDiscardOf('recovery'); setDialog('discard') }}
              >
                録音を破棄する
              </button>
            )}
          </section>
        )}

        {/* ⚖ 8/26 (b) — THE RESIDUE RESOLVES INTO ITS OWN RECEIPT. The banner
            slot is where the take was, so it is where the record of throwing it
            away belongs; and because it lives OUTSIDE the recorder panel it is
            reachable on a lens with no bookings at all, which is the world the
            old settle returned silently from. */}
        {receipt?.of === 'recovery' && (
          <Receipt receipt={receipt} closeRef={receiptCloseRef} onClose={() => setReceipt(null)} />
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
                  {/* ⚖ the family's tinted section head (the カルテ room's own
                      generation): a washed icon chip beside the name, never a
                      solid fill and never on a pressable. */}
                  <h2 className="rc-sec-title" id="rcSessionTitle">
                    <span className="rc-sec-icon" aria-hidden="true"><Icon name="mic" size={14} /></span>
                    録音セッション
                  </h2>
                  <span className={`rc-state ${RECORDER_TONE[phase]}`}>{RECORDER_LABEL[phase]}</span>
                </div>
                <div className={`rc-panel-body${phase === 'idle' ? ' is-idle' : ''}`}>
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

                  {/* ⚠ THE IDLE COPY IS ONE BLOCK so the stacked band can set it
                      BESIDE the button instead of under it — a 72px circle
                      alone in a 900px panel was the emptiest state on the
                      ladder. */}
                  {phase === 'idle' && (
                    <div className="rc-idle-copy">
                      <div className="rc-idle-title">録音開始</div>
                      <div className="rc-idle-sub">{current.customerName}様のセッションを録音します。</div>
                    </div>
                  )}

                  {/* ⚠ NO SIDE CONTROL EVER REPEATS THE BIG BUTTON'S CURRENT
                      VERB (B4-4). §2f's whole argument is that the control a
                      staffer presses to stop IS the control they pressed to
                      start — and a labelled 停止 forty pixels under a morphing
                      record button that is ALSO a stop dilutes exactly that: two
                      stops, and no way to tell which one is canonical.
                      ONE VERDICT, ONE HOME, so the row carries whatever the big
                      button does NOT:
                        · recording — the big button stops, so the row offers
                          一時停止 alone (canon's genuine extra state, which the
                          phone has no room for and a desk does);
                        · paused    — the big button resumes, so the row offers
                          停止 alone, the take's real ending.
                      The phone's hierarchy survives it: there is still exactly
                      ONE way to end a take, and it is the loudest thing on the
                      panel. Neither side control is solid accent — this room's
                      commit-shaped fill is reserved for a commit. */}
                  <div className="rc-controls">
                    {phase === 'recording' && (
                      <button className="btn" type="button" onClick={() => setPhase('paused')}>一時停止</button>
                    )}
                    {phase === 'paused' && (
                      <button className="btn rc-stop" type="button" onClick={stop}>停止</button>
                    )}
                    {/* ⚖ B4-3 — THERE IS NO 「やり直す」 OVER AN UNRESOLVED TAKE.
                        The phone refuses exactly this path in words
                        (RecordButtonCard.tsx:83-85: wiring a restart here would
                        「invent a supersede path over an unsaved take」), and the
                        ⚖ 8/20 integrity doctrine has no reason-free route out of
                        a take. From 停止 the two resolutions are 使う and 破棄,
                        and nothing else. After a discard settles the machine is
                        already back at 待機中 — the reset is the RESOLUTION's,
                        never a lever beside it. */}
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
                          onClick={() => { setDiscardOf('recorder'); setDialog('discard') }}
                        >
                          <Icon name="trash" size={14} />破棄
                        </button>
                        {/* ⚖ R6-D3 / §2a — THE CONFIRM RENDERS, THE COMMIT
                            REFUSES. This button is a REAL lever: it opens the
                            designed confirm and shows the カルテ record a commit
                            would touch. What refuses is the commit inside it,
                            with the reason that says why THIS one refuses while
                            the 破棄 beside it runs to the end. */}
                        <button
                          className="btn rc-commit"
                          type="button"
                          ref={useOpenRef}
                          onClick={() => setDialog('use')}
                        >
                          この録音を使う
                        </button>
                      </div>
                    </div>
                  )}

                  {/* THE RECEIPT — ephemeral, self-contained, and only ever
                      inside the discard flow that just ran (canon :842). */}
                  {receipt?.of === 'recorder' && (
                    <Receipt receipt={receipt} closeRef={receiptCloseRef} onClose={() => setReceipt(null)} />
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
                    <h2 className="rc-sec-title" id="rcConsentTitle">
                      <span className="rc-sec-icon is-consent" aria-hidden="true"><Icon name="shield" size={14} /></span>
                      同意状況
                    </h2>
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
                    <button className="btn primary rc-consent-open" type="button" ref={consentOpenRef} onClick={() => setDialog('consent')}>
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
            <h2 className="rc-sec-title" id="rcHistoryTitle">
              <span className="rc-sec-icon is-history" aria-hidden="true"><Icon name="history" size={14} /></span>
              録音履歴
            </h2>
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
            <>
              {/* ⚖ COUNTERS AS FILTERS (the カルテ room's own segment row).
                  ONE state at a time; every chip is the same quiet neutral, so
                  the 破棄済み chip cannot be the loud one; and the number on a
                  chip IS the number of rows its press leaves standing. */}
              <div
                className="rc-filters"
                role="group"
                aria-label="状態でしぼりこむ"
                data-guide-title="状態でしぼりこむ"
                data-guide="録音の状態で一覧をしぼりこめます。それぞれの数字は、押したときに残る件数そのものです。破棄済みもここに出ます — 破棄した録音を隠すことはありません。"
              >
                <button
                  className={`rc-filter${stateFilter === null ? ' is-on' : ''}`}
                  type="button"
                  aria-pressed={stateFilter === null}
                  onClick={() => setStateFilter(null)}
                >
                  すべて<span className="rc-filter-n rc-num">{walk.visible.length}</span>
                </button>
                {filters.map((f) => (
                  <button
                    key={f.label}
                    className={`rc-filter${stateFilter === f.label ? ' is-on' : ''}`}
                    type="button"
                    aria-pressed={stateFilter === f.label}
                    onClick={() => setStateFilter((was) => (was === f.label ? null : f.label))}
                  >
                    {f.label}<span className="rc-filter-n rc-num">{f.n}</span>
                  </button>
                ))}
              </div>

            <div className="rc-rows">
              <div className="rc-rowhead" aria-hidden="true">
                <span>日付</span>
                <span>お客様</span>
                <span>録音者</span>
                <span>長さ</span>
                <span>状態</span>
                <span />
              </div>
              {rows.map((t) => (
                <div className={`rc-row${t.isDiscarded ? ' is-discarded' : ''}`} key={t.id} data-state={t.stateLabel}>
                  <span className="rc-c-date rc-num">{t.dateLabel} {t.timeLabel}</span>
                  <span className="rc-c-cust">
                    <span className={`rc-avatar${t.hasCustomer ? '' : ' is-none'}`} aria-hidden="true">{t.customerInitial}</span>
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
            </>
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

      {/* ═══ CANON'S BOUNDARY MARKUP — PRESENT, AND INERT ═══════════════════
          (fable-record-session.html:470-485; the ⚖ 8/24 TYPE-TIER doctrine line
          asks for both variants on ONE mount.)

          TWO REAL PRODUCT STATES this room will one day stand in, and neither
          has a plane to read from yet:
            · ENTITLEMENT — the business is on Reserve only, so 録音 is not part
              of what it bought;
            · RIGHTS — the person is signed in but has no recording capability.
          Canon renders one panel and swaps the copy in place, so that is what
          this is: ONE mount, both sentences, `hidden` + `aria-hidden` so it
          paints nothing, takes no space, joins no tour step and reaches no
          keyboard. Registry ⑨ owns the switch that will choose between them.

          ⚖ 8/17 (the disconnected-depth overturn) is why it is INERT rather than
          wired to a flag this room could invent: a speculative surface ships off
          and reconnects on Liam's word. It is here rather than absent because
          the shape a reconnect lands on should be designed once, not guessed
          twice — and because a reader of this file should be able to see what
          the two states say without opening canon. */}
      <div className="rc-boundary" hidden aria-hidden="true" data-boundary="entitlement-and-rights">
        <p data-variant="entitlement">
          録音は Karute プランでご利用いただけます。いまの事業（Reserveのみ）には含まれていません。
        </p>
        <p data-variant="rights">
          この操作には録音の記録権限が必要です。店舗の管理者にご相談ください。
        </p>
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
              <h2 className="rc-sec-title" id="rcReviewTitle">
                <span className="rc-sec-icon" aria-hidden="true"><Icon name="trash" size={14} /></span>
                破棄の記録
              </h2>
              <button className="rc-back" type="button" ref={backRef} onClick={() => setScreen('record')}>
                ← 録音
              </button>
            </div>
            <p className="rc-note">
              録音を破棄したときの理由と、その録音の文字起こしです。破棄した録音は一覧から消えず、記録として残ります。
            </p>
          </section>

          {/* ⚖ 8/25 RULING B — ONE QUIET LABELLED BAND (the approved 8/31 mock's
              shape), and every number is the SHIPPED screen's own sentence. It
              used to be two cards of the same weight as the list itself, which
              is how a plain fact starts reading like a scoreboard. No red, no
              threshold, no grade, no ranking control: a discard count must never
              be the thing that makes a staff member hesitate to discard a
              recording they should discard. */}
          {props.counts && (
            <section
              className="rc-summary"
              aria-label="破棄の件数"
              data-guide-title="破棄の件数"
              data-guide="破棄された録音の件数です。今月の件数と、記録に残っている全部の件数の両方を出しています。スタッフごとの件数も今月ぶんだけ出しますが、順位をつけるためのものではありません。"
            >
              <p className="rc-summary-main">
                <span className="rc-num">{props.counts.thisMonthLine}</span>
                <span className="rc-summary-sep" aria-hidden="true">・</span>
                <span className="rc-num">{props.counts.totalLine}</span>
              </p>
              {props.counts.byStaff.length > 0 && (
                <p className="rc-summary-staff">
                  <span className="rc-summary-k">{props.counts.byStaffLabel}</span>
                  {props.counts.byStaff.map((s, i) => (
                    <span className="rc-summary-one" key={s.cardId}>
                      {i > 0 && <span className="rc-summary-sep" aria-hidden="true">・</span>}
                      {s.name} <span className="rc-num">{s.line}</span>
                    </span>
                  ))}
                </p>
              )}
              {props.counts.truncatedLine && <p className="rc-summary-note">{props.counts.truncatedLine}</p>}
            </section>
          )}

          {props.discardRows.length === 0 ? (
            <div className="rc-empty">
              {/* `settings.discardReasons.empty`, verbatim — trailing 。 and all
                  (B1-13). A shipped sentence quoted 「almost」 is a second
                  wording for one state. */}
              <strong>破棄の記録はまだありません。</strong>
              <span>録音を破棄すると、その理由がここに残ります。</span>
            </div>
          ) : (
            /* ⚖ MASTER–DETAIL, THE APPROVED 8/31 MOCK'S COMPUTER COLUMN. The
               desk's width buys STRUCTURE rather than longer lines: the month's
               discards on the left, the one being read on the right, and the
               list never moves when a row opens.
               ⚠ ONE DOM, TWO SHAPES. The detail is a SIBLING of the rows, and
               at phone widths the list wrapper becomes `display: contents` so
               the rows and the detail share one column — `order` then puts the
               detail directly under the row it belongs to, which is the mock's
               own phone column. Rendering it twice would be two copies of one
               heading, two tour steps for one thing, and two places to fix. */
            <section
              className="rc-panes"
              aria-label="破棄された録音"
              data-guide-title="破棄された録音"
              data-guide="破棄された録音の一覧です。左（スマホでは上）の行を押すと、その録音のスタッフが書いた理由と文字起こしが読めます。文字起こしは枠の中でスクロールするので、長い録音でも画面は伸びません。"
            >
              <div className="rc-pane-list">
                {props.discardRows.map((r, i) => (
                  /* THE ROW IS THE CONTROL, and it is deliberately quiet — the
                     one-way accent law lets a pressable be quieter than accent,
                     and nothing on this screen should read as an alarm. */
                  <button
                    key={r.takeId}
                    className={`rc-review-row${openRow === r.takeId ? ' is-open' : ''}`}
                    style={{ order: i * 2 }}
                    type="button"
                    aria-expanded={openRow === r.takeId}
                    aria-controls="rcDiscardDetail"
                    onClick={() => setOpenRow((was) => (was === r.takeId ? null : r.takeId))}
                  >
                    <span className="rc-review-top">
                      <span className={`rc-avatar${r.hasCustomer ? '' : ' is-none'}`} aria-hidden="true">{r.initial}</span>
                      <span className={`rc-review-cust${r.hasCustomer ? '' : ' is-none'}`}>{r.customerLabel}</span>
                      <span className="rc-dur rc-num">録音 {r.lengthText}</span>
                    </span>
                    <span className="rc-review-when">
                      <span className="rc-num">録音 {r.recordedShortLabel}</span>
                      <span className="rc-review-sep" aria-hidden="true">・</span>
                      <span>破棄 <span className="rc-review-by">{r.byName}</span></span>
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
                ))}
              </div>

              {(() => {
                const i = props.discardRows.findIndex((r) => r.takeId === openRow)
                const r = i < 0 ? null : props.discardRows[i]
                return (
                  <div
                    className={`rc-pane-detail${r === null ? ' is-empty' : ''}`}
                    id="rcDiscardDetail"
                    style={{ order: i * 2 + 1 }}
                  >
                    {r === null ? (
                      <p className="rc-pane-hint">一覧から1件選ぶと、スタッフの記入した理由と、その録音の文字起こしがここに出ます。</p>
                    ) : (
                      <>
                        <div className="rc-detail-head">
                          <span className={`rc-avatar is-lg${r.hasCustomer ? '' : ' is-none'}`} aria-hidden="true">{r.initial}</span>
                          <span className={`rc-detail-name${r.hasCustomer ? '' : ' is-none'}`}>{r.customerLabel}</span>
                        </div>
                        <dl className="rc-defs">
                          <div><dt>録音日時</dt><dd className="rc-num">{r.recordedAtLabel}</dd></div>
                          <div><dt>録音時間</dt><dd className="rc-num">{r.lengthText}</dd></div>
                          <div><dt>破棄</dt><dd><span className="rc-num">{r.discardedAtLabel}</span>（{r.byName}）</dd></div>
                        </dl>
                        <div className="rc-detail-cols">
                          <div className="rc-card">
                            <p className="rc-review-label">スタッフの記入した理由</p>
                            <p className="rc-review-reason-full">{r.reason}</p>
                          </div>
                          {r.transcript && r.transcript.length > 0 ? (
                            /* ⚖ THE LONG-RECORDING LAW (Liam 8/31) — the words
                               read inside a BOUNDED panel: a sticky header that
                               names what this is and how long the take was, 5分
                               markers derived from the segments' own start
                               times, a fade at each edge and a visible bar. A
                               47-minute transcript therefore costs the page no
                               height at all. This ONE panel is the named
                               exception to the ⚖ page-scroll ruling, which
                               governs board and list wrappers; nothing else in
                               this room owns an axis. */
                            <div className="rc-tpanel">
                              <div
                                className="rc-tscroll"
                                tabIndex={0}
                                role="region"
                                aria-label="文字起こし（全文）"
                              >
                                <div className="rc-tpanel-head">
                                  <span className="rc-review-label">文字起こし（全文）</span>
                                  <span className="rc-tlen rc-num">録音 {r.lengthText}</span>
                                </div>
                                <div className="rc-tbody">
                                  {r.transcript.map((e) =>
                                    e.kind === 'divider' ? (
                                      <p className="rc-tdiv" key={e.key}><span>{e.label}</span></p>
                                    ) : (
                                      <p className="rc-tline" key={e.key}>
                                        <span className="rc-ttime rc-num">{e.at}</span>
                                        {e.text}
                                      </p>
                                    ),
                                  )}
                                </div>
                              </div>
                              <span className="rc-tfade is-top" aria-hidden="true" />
                              <span className="rc-tfade is-bottom" aria-hidden="true" />
                            </div>
                          ) : (
                            /* ⚖ ABSENCE IS NEVER A PLACEHOLDER — and never says
                               the words were LOST. Under the floor nothing was
                               ever transcribed (the spend gate); everything else
                               is a plain 「ありません」. */
                            <div className="rc-card">
                              <p className="rc-review-label">文字起こし（全文）</p>
                              <p className="rc-review-absent">{r.absenceLine}</p>
                            </div>
                          )}
                        </div>
                        {r.ticketNote && <p className="rc-review-ticket"><Icon name="ticket" size={13} />{r.ticketNote}</p>}
                        {/* ⚖ ✓確認済み DOES NOT EXIST — registry ⑩. The lever is
                            shown REFUSED with the honest note rather than
                            omitted, because a manager who expects it should
                            learn WHY it is not there. */}
                        <div className="rc-review-acts">
                          <button {...refused('確認済みにする', props.refusals.checked)}>
                            <Icon name="check" size={13} />確認済みにする
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })()}
            </section>
          )}
          {props.counts?.listTruncatedLine && <p className="rc-summary-note">{props.counts.listTruncatedLine}</p>}

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
          {/* ⚠ THE FIELD STAYS LIVE THROUGH A REFUSED WRITE — the phone disables
              it while a real request is in flight; nothing is in flight here,
              and what this state exists to prove is that the typed reason
              SURVIVES. Disabling it would drop the keyboard to `<body>` for the
              wait, which is a worse answer to a smaller question. */}
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
          {/* ⚖ W7-2 — THE REFUSAL RENDERS INLINE, where the staffer is already
              looking, and the dialog stays open behind it (the phone's own
              `role="alert"` line). Retry and cancel both still work. */}
          {submitError && <p className="rc-dlg-error" role="alert">{submitError}</p>}
          <div className="rc-dlg-foot">
            <button className="btn" type="button" disabled={submitting} onClick={closeDiscard}>キャンセル</button>
            <button
              className="btn rc-danger"
              type="button"
              disabled={reason.trim() === '' || submitting}
              onClick={settleDiscard}
            >
              {submitting && props.discardFail ? props.discardFail.submitLabel : '破棄する'}
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
 * THE DISCARD RECEIPT — ephemeral, self-contained, and only ever inside the
 * discard flow that just ran (canon :842).
 *
 * ⚠ ONE COMPONENT, TWO PLACES, and that is deliberate. The recorder's discard
 * resolves inside the 録音セッション panel where it happened; the recovery
 * banner's resolves in the banner's own slot, which is also the only place a
 * lens with no bookings at all can show it. Writing the markup twice would be
 * two copies of one heading, two 画面の説明 declarations for one thing, and two
 * places for the four fields to drift apart.
 */
function Receipt({
  receipt,
  closeRef,
  onClose,
}: {
  receipt: { target: string; when: string; by: string; reason: string }
  closeRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  return (
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
      <button className="btn" type="button" ref={closeRef} onClick={onClose}>閉じる</button>
    </section>
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

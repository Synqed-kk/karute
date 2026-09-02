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
import { makeSpring } from '@/business/lib/spring'
import {
  fmtElapsed,
  keepCardOffHeading,
  waveformBars,
  windowTakes,
  RECORDER_LABEL,
  RECORDER_TONE,
  SCRIM_SETTLE_MS,
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
  tick: <path d="M4.5 12.5 9.5 17.5 19.5 7" />,
  chevdown: <path d="m6 9 6 6 6-6" />,
  chevup: <path d="m18 15-6-6-6 6" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  file: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h4" /></>,
  chat: <path d="M4 6h16v12H8l-4 3z" />,
  spark: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></>,
  pencil: <><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" /><path d="M14.5 6.5l3 3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.6v.6" /></>,
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
  /** The HERO's own meta — the time RANGE, the menu and the staffer. The full
   *  date stays on the picker's label: a hero repeating 「本日」 to a reader who
   *  is looking at today's list is noise. */
  heroMetaLabel: string
  /** ⚖ DERIVED FROM THE RENDER'S ONE CLOCK READ — the same read the default
   *  selection and every take date came from. いま施術中 / このあと HH:MM 開始 /
   *  終了 HH:MM, and the screen never re-decides it. */
  heroChipLabel: string
  heroChipTone: 'now' | 'upcoming' | 'past'
  /** The picker row's own status hint: いま施術中 / 初めてのご来店 / ご来店 N回目. */
  slotHint: string
  consentState: 'current' | 'stale' | 'absent'
  consentLabel: string
  consentTone: string
  consentProof: string
  /** The thin consent line's SHORT evidence; `consentProof` is the pop-down's. */
  consentShort: string
  /** What the closed gate offers — 同意を取り直す / 同意を取得. `null` while the
   *  gate is open: offering to re-take a consent nobody needs is noise. */
  consentAction: string | null
  /** ⚖ 前回までの流れ — the phone's before-session brief, fuller. Every field is
   *  a JOIN over the lens's own bookings and the カルテ plane; the room states
   *  none of it, and the fields the phone generates with a MODEL (hooks, opener,
   *  recommended focus, the reservation memo) are absent here on purpose —
   *  registry ⑪, named on the card rather than invented. */
  brief: {
    lastLine: string | null
    visitsTag: string
    lastKaruteLabel: string | null
    records: Array<{ id: string; dateLabel: string; title: string }>
    doorLabel: string | null
    summary: string | null
    memo: Array<{ label: string; text: string }>
  }
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
  /** ⚖ LIAM F-1 R1-3 — 「あなたの担当の予約 N件（{operator}・本日）」. The label
   *  says whose list this is, because the history below it is the STORE's. */
  pickerLabel: string
  /** The own-scope empty state's own words. `null` whenever there is a booking. */
  emptyOwnScope: { title: string; body: string } | null
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
    /** ⚠ `rowKey`, NOT `cardId`: one entry of this band can stand for SEVERAL
     *  cards — the grouped 担当者不明（N名） — so a field named after a card id
     *  would be a quiet lie the next reader has to discover. */
    byStaff: Array<{ rowKey: string; name: string; line: string }>
    truncatedLine: string | null
    listTruncatedLine: string | null
  } | null
  /** ⚖ 要対応 — ONE slim strip, and `null` when nothing needs a hand. Every
   *  pill's count is EXACTLY what its filter reveals (the pill/count law), and
   *  a strip that rendered at zero would be the page inventing a warning. */
  attention: {
    title: string
    countLine: string
    hint: string
    pills: Array<{
      key: string
      chip: string
      stateLabel: string
      countLabel: string
      note: string | null
      action: { kind: 'save' | 'filter'; label: string }
      tone: 'amber' | 'red' | 'blue'
    }>
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
  /** The footnote disclosure's own two strings. Nothing from the old standing
   *  trace card is deleted — it FOLDS behind this bar (§2.6). */
  footnoteBar: string
  footnoteTitle: string
  refusals: {
    use: string
    save: string
    checked: string
    transcript: string
    policy: string
    enroll: string
    /** ⚖ B1-2 — the briefing's three カルテ levers, which have no destination
     *  that honours their labels until the カルテ room gains a record-level
     *  door. ONE reason for all three. */
    karuteOpen: string
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
  /** ⚠ THE ROWS ANIMATE ON A SWAP, NEVER ON ARRIVAL — the mock's own `.swap`
   *  class, which it adds on a filter press and not on load. The list is keyed
   *  by the filter so React remounts it, and a CSS animation on a remounted
   *  element replays; without this flag it also played on FIRST paint, which is
   *  a page that looks like it is still loading (and a measurement a harness
   *  catches mid-flight, which is how it was found). */
  const [filterSwapped, setFilterSwapped] = useState(false)
  const pickFilter = (next: string | null) => { setFilterSwapped(true); setStateFilter(next) }

  // ── the four disclosures (all height-sprung, all open-by-default-or-not) ──
  /** ⚠ OPEN AT A DESK, and it stays open: the briefing is what a staffer came to
   *  this page to read before walking into a room. The header is a real toggle
   *  because a manager who already knows the customer wants the space back. */
  const [briefOpen, setBriefOpen] = useState(true)
  const [consentOpen, setConsentOpen] = useState(false)
  const [tagNoteOpen, setTagNoteOpen] = useState(false)
  const [footOpen, setFootOpen] = useState(false)
  /** The two briefing expanders. `sumOverflows` is MEASURED, never guessed: an
   *  expander offered on text that already fits is a lever that does nothing. */
  const [sumOpen, setSumOpen] = useState(false)
  const [memoOpen, setMemoOpen] = useState(false)
  const [sumOverflows, setSumOverflows] = useState(false)

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
  const recBtnRef = useRef<HTMLButtonElement>(null)
  const historyRef = useRef<HTMLElement>(null)
  const briefPanelRef = useRef<HTMLDivElement>(null)
  const consentPanelRef = useRef<HTMLDivElement>(null)
  const tagNotePanelRef = useRef<HTMLDivElement>(null)
  const footPanelRef = useRef<HTMLDivElement>(null)
  const sumRef = useRef<HTMLDivElement>(null)
  const segRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)

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
   *  recur).
   *  ⚠ `base` IS THE ROOM'S DEFAULT LEVER SKIN, AND IT IS NOT ALWAYS THE RIGHT
   *  ONE. The refusal grammar is `aria-disabled` + the reason on the accessible
   *  name — it is not a repaint. A lever that already carries a skin Liam
   *  accepted (the briefing's カルテ rows and its door) passes `base: null` so
   *  becoming honest does not also make it a 42px bordered button. */
  const refused = (
    label: string,
    reason: string,
    extra?: { className?: string; base?: string | null; 'aria-describedby'?: string },
  ) => {
    const { className, base = 'btn', ...rest } = extra ?? {}
    return {
      type: 'button' as const,
      'aria-disabled': 'true' as const,
      title: reason,
      'aria-label': `${label} — ${reason}`,
      ...rest,
      className: [base, className].filter(Boolean).join(' '),
    }
  }

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

  /**
   * ⚖ THE COLLAPSE, AND IT IS THE MOCK'S OWN (`makeCollapse`). A height spring
   * to the panel's measured `scrollHeight`, then `height: auto` AT REST so the
   * open panel keeps growing with its own content — a panel frozen at the height
   * it was measured at clips the moment anything inside it expands (which is
   * exactly what the briefing's own もっと見る does).
   *
   * ⚠ ONE EFFECT PER PANEL, KEYED ON ITS OWN OPEN FLAG, and the FIRST run jumps
   * rather than animating: a page that plays four collapse animations on load is
   * a page that looks broken while it settles.
   */
  const useCollapse = (ref: React.RefObject<HTMLDivElement | null>, open: boolean) => {
    const first = useRef(true)
    useEffect(() => {
      const el = ref.current
      if (!el) return
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
    }, [ref, open])
  }
  useCollapse(briefPanelRef, briefOpen)
  useCollapse(consentPanelRef, consentOpen)
  useCollapse(tagNotePanelRef, tagNoteOpen)
  useCollapse(footPanelRef, footOpen)

  /** PRESS STATES ON POINTER-DOWN, one document listener for the whole room
   *  (the mock's `[data-press]`). Pointer-DOWN, not click: the feedback has to
   *  arrive while the finger is still down or it is not feedback. */
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

  /** THE RECORD BUTTON'S PRESS SCALE — the mock's own .93 at response .26, on
   *  pointer-DOWN. A spring rather than a transition because it has to be
   *  interruptible: a press released mid-travel returns from where it IS.
   *
   *  ⚠ THE DEPENDENCY IS A NAMED BOOLEAN, not `current === null` written into
   *  the array. The lint rule is right about why: an expression there cannot be
   *  statically checked, so the day someone changes what `current` is, nothing
   *  tells them this effect was reading it. The effect re-runs when the BUTTON
   *  mounts or unmounts — which is what「is there a booking at all」decides. */
  const hasBooking = current !== null
  useEffect(() => {
    const el = recBtnRef.current
    if (!el) return
    const sp = makeSpring((v) => { el.style.transform = `scale(${v})` }, { response: 0.26, eps: 0.002, reduced })
    sp.jump(1)
    const down = () => sp.set(0.93)
    const up = () => sp.set(1)
    el.addEventListener('pointerdown', down)
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, up)
    return () => {
      sp.stop()
      el.removeEventListener('pointerdown', down)
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.removeEventListener(ev, up)
    }
  }, [reduced, hasBooking])

  /** THE SEGMENTED THUMB — X and W on their own springs (.30), driven by the
   *  SELECTED button's own offset box, so the thumb cannot drift from the chip
   *  it is under when the counts change width. */
  useEffect(() => {
    const seg = segRef.current
    const thumb = thumbRef.current
    if (!seg || !thumb) return
    const state = { x: 0, w: 100 }
    const paint = () => { thumb.style.transform = `translateX(${state.x}px) scaleX(${state.w / 100})` }
    const sx = makeSpring((v) => { state.x = v; paint() }, { response: 0.3, reduced })
    const sw = makeSpring((v) => { state.w = v; paint() }, { response: 0.3, reduced })
    let placed = false
    const move = () => {
      const on = seg.querySelector<HTMLElement>('.rc-seg-btn.is-on')
      if (!on) { thumb.style.opacity = '0'; return }
      thumb.style.opacity = ''
      const x = on.offsetLeft - 3
      const w = on.offsetWidth
      if (placed) { sx.set(x); sw.set(w) } else { sx.jump(x); sw.jump(w); placed = true }
    }
    move()
    window.addEventListener('resize', move)
    return () => { sx.stop(); sw.stop(); window.removeEventListener('resize', move) }
  }, [reduced, stateFilter, walk.visible.length, filters.length])

  /** ⚠ THE EXPANDER APPEARS ONLY WHEN THE TEXT ACTUALLY OVERFLOWS ITS CLAMP,
   *  measured on the element itself. Offering もっと見る on a two-line summary is
   *  a dead lever (lessons §A-2), and the clamp height depends on the column
   *  width, so it is re-measured when the customer or the layout changes. */
  useLayoutEffect(() => {
    const el = sumRef.current
    if (!el) { setSumOverflows(false); return }
    if (sumOpen) return
    setSumOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [current?.appointmentId, sumOpen, briefOpen, current?.brief.summary])

  const live = phase === 'recording'
  /** ⚠ FOUR STATES, AND 停止 IS THE LAST ONE (R6-18). ⚖ R6-D3's commit refuses,
   *  so nothing can put this machine into canon's 反映済み — the branch used to
   *  read `phase === 'stopped' || phase === 'committed'`, where the second term
   *  was unreachable by construction. The fifth returns with registry ⑦. */
  const ended = phase === 'stopped'

  return (
    <div className={`${ROOT}${onDiscardScreen ? ' is-review' : ''}`} ref={rootRef}>
      {/* ⚖ ONE COMPACT TITLE ROW (Liam F-1: 「kill the dead space」). Eyebrow,
          name, the ?, and the sentence — one line at a desk, wrapping at phone
          widths. The head declares itself like every other section, so the walk
          opens on what this page is FOR before it starts pointing at parts of
          it. ⚠ ITS SENTENCE IS TRUE ON BOTH SCREENS (F5-1). */}
      <header
        className="rc-head"
        data-guide-title="録音"
        data-guide={props.headGuide}
      >
        <div className="rc-titlerow">
          <span className="rc-eyebrow">{props.dateline}</span>
          <h1>録音</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR (never the mock's
              popover: the mock's own head text IS this page's head guide, and
              it is already access-derived). A hairline circle, never a filled
              one (⚖ R13). */}
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
          {!onDiscardScreen && <span className="rc-subtitle">{props.subtitle}</span>}
        </div>
      </header>

      {/* ═══ THE RECORDER SCREEN ═══ */}
      <div className="rc-record-view">
        {/* ⚖ W7-3 — THE RECOVERY RESIDUE, FULL WIDTH ABOVE THE GRID (R6-25).
            ONE slot: the props carry a single object or none, so a draft-shaped
            offer and a take-shaped offer cannot both render. ONE action
            (保存する) and no ✕ — a recording that reached this banner is a SYSTEM
            failure and the staffer's only job is to land it (⚖ 8/20 ⑦). The
            discard exit below it exists ONLY for a take under the accidental-tap
            floor (⚖ 8/26 (b)). */}
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
            <button {...refused(recovery.saveLabel, props.refusals.save, { className: 'rc-recovery-save' })} data-press>
              <Icon name="save" size={16} />{recovery.saveLabel}
            </button>
            <p className="rc-recovery-caption">{recovery.caption}</p>
            <p className="rc-recovery-caption">{recovery.stopNote}</p>
            {recovery.belowFloor && (
              <button
                className="rc-recovery-discard"
                type="button"
                data-press
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
            away belongs; and because it lives OUTSIDE the cockpit it is
            reachable on a lens with no bookings at all, which is the world the
            old settle returned silently from. */}
        {receipt?.of === 'recovery' && (
          <Receipt receipt={receipt} closeRef={receiptCloseRef} onClose={() => setReceipt(null)} />
        )}

        {/* ═══ ROW 1 — cockpit (left) + briefing (right) ═══
            `align-items:start` in the sheet: the briefing is CONTENT-HEIGHT, so
            the space under a shallow one is honest page background rather than
            empty card (v5-4). */}
        <div className="rc-grid">

          {/* ═══ THE SESSION COCKPIT — the #1 object is WHO you are recording ═══ */}
          <section
            className="rc-card rc-cockpit"
            aria-labelledby="rcSessionTitle"
            data-guide-title="録音セッション"
            data-guide="録音の本体です。いちばん上に、いま録音しようとしている予約が出ます。その下で予約を選び、まん中のボタンで録音し、いちばん下の行で同意を確かめます。"
          >
            <div className="rc-cap">
              <span className="rc-cap-ic" aria-hidden="true"><Icon name="mic" size={16} /></span>
              <h2 className="rc-sec-title" id="rcSessionTitle">録音セッション</h2>
              <span className="rc-cap-sp" />
              <span className={`rc-state ${RECORDER_TONE[phase]}`}>{RECORDER_LABEL[phase]}</span>
            </div>

            {current === null ? (
              /* ⚠ THE OWN-SCOPE EMPTY STATE. A manager with no bookings of her
                 OWN today is the ordinary evening case, not a broken page — and
                 the copy has to say whose list is empty, or she reads it as
                 「the store has no bookings」, which is a different claim. */
              <div className="rc-zero-card">
                <strong>{props.emptyOwnScope?.title ?? '本日、あなたの担当の予約はありません'}</strong>
                <p>{props.emptyOwnScope?.body ?? '予約が入ると、ここに時間順で並びます。録音は予約を選んでから始めます。'}</p>
              </div>
            ) : (
              <>
                {/* ⚖ THE HERO — the #1 object. WHO is in the room, WHEN, for
                    what, with whom. The chip is derived from the render's ONE
                    clock read; the name and meta ellipsize with the whole
                    string on `title`, so a long name shortens rather than
                    breaking the card. */}
                <div className="rc-hero">
                  <span className={`rc-nowchip is-${current.heroChipTone}`}>
                    <span className="rc-nowdot" aria-hidden="true" />
                    {current.heroChipLabel}
                  </span>
                  <div className="rc-hero-name" title={`${current.customerName}様`}>{current.customerName}様</div>
                  <div className="rc-hero-meta" title={current.heroMetaLabel}>{current.heroMetaLabel}</div>
                </div>

                {/* ⚖ LIAM F-1 R1-3 — BOOKINGS UNDER YOUR OWN NAME. The label
                    says whose list this is and how long it is; the store-wide
                    view a manager is entitled to is the HISTORY below. */}
                <div className="rc-pick-lb" id="rcPickLb">{props.pickerLabel}</div>
                <div
                  className="rc-picker"
                  role="radiogroup"
                  aria-labelledby="rcPickLb"
                  data-guide-title="あなたの担当の予約"
                  data-guide="どの予約の録音をするかを選ぶところです。自分が担当する本日の予約が、時間の早い順に並びます。ほかのスタッフの予約はここには出ません。録音中は取り違えを防ぐため選び直せません。"
                >
                  {props.contexts.map((c) => (
                    <button
                      key={c.appointmentId}
                      type="button"
                      role="radio"
                      data-press
                      aria-checked={c.appointmentId === current.appointmentId}
                      className={`rc-slot${c.appointmentId === current.appointmentId ? ' is-sel' : ''}`}
                      disabled={phase !== 'idle'}
                      onClick={() => setPickedId(c.appointmentId)}
                    >
                      <span className="rc-tm rc-num">{c.timeLabel}</span>
                      <span className="rc-b1">{c.customerName}様</span>
                      <span className="rc-b2">{c.menuName} ・ {c.slotHint}</span>
                      <span className="rc-tick" aria-hidden="true">
                        <Icon name="tick" size={14} weight={2.6} />
                      </span>
                    </button>
                  ))}
                </div>
                {phase !== 'idle' && <p className="rc-picker-lock">録音中は選び直せません</p>}

                {/* ⚖ THE RECORD GROUP — ONE balanced, horizontally-centred
                    stack (Liam F-1 R1-1: the left-hugging row felt lopsided).
                    The INTERNALS stay the phone's: one persistent element that
                    MORPHS mic ⇄ stop, the live ring, the 録音中 flag with its
                    dot, a tabular timer and waveform bars on `transform:scaleY`
                    alone. */}
                <div
                  className={`rc-recwrap${live ? ' is-recording' : ''}`}
                  data-guide-title="録音ボタン"
                  data-guide="録音を始めるところです。まん中の赤いボタンを押すと録音が始まり、もう一度押すと止まります。録音中は経過時間と音の波が出ます。止めただけでは保存されません。止めたあとに、その録音をカルテに使うか、理由を書いて破棄するかを選びます。"
                >
                  <div className="rc-btn-wrap">
                    {/* ⚖ B1-3 = B2-6 — THE CLOSED GATE STAYS REACHABLE. A native
                        `disabled` drops the one control the consent floor
                        actually closes out of the keyboard path, and the gate
                        note beside it is a sibling with nothing tying the two
                        together — so a reader on a keyboard or a screen reader
                        met a button that could not be focused and never heard
                        why. The room's own refusal grammar is `aria-disabled` +
                        the reason (`refused()` argues it at :757); this button
                        cannot use that helper because it is a REAL lever in
                        every other state, so it spells the same grammar itself.
                        ⚠ THE MACHINE STILL DOES NOT START: the handler's own
                        `if (!consentOk) return` is the gate, and it always was —
                        `disabled` was never what stopped it. */}
                    <button
                      type="button"
                      ref={recBtnRef}
                      className={`rc-rec${ended ? ' is-ended' : ''}`}
                      aria-disabled={ended || (phase === 'idle' && !consentOk) ? 'true' : undefined}
                      title={phase === 'idle' && !consentOk ? (current.gateNote ?? undefined) : undefined}
                      aria-label={
                        ended
                          ? '録音終了'
                          : live
                            ? '録音停止'
                            : phase === 'idle' && !consentOk && current.gateNote
                              ? `録音開始 — ${current.gateNote}`
                              : '録音開始'
                      }
                      onClick={() => {
                        if (ended) return
                        if (live) { stop(); return }
                        if (phase === 'paused') { setPhase('recording'); return }
                        if (!consentOk) return
                        setElapsed(0)
                        setTick(0)
                        // ⚠ AND THE RECEIPT DOES NOT SURVIVE INTO A LIVE TAKE
                        // (F6-3): its own body says 「この確認は、いま行った破棄の
                        // 流れの中だけに表示されます。」, which a live take makes
                        // false. The recovery residue's receipt belongs to no
                        // take at all and survives, as on a picker change.
                        setReceipt((r) => (r?.of === 'recovery' ? r : null))
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

                  <div className="rc-recmeta">
                    <span className="rc-demo">デモ: 実際の録音は行いません</span>

                    <div className="rc-rec-line">
                      <span className="rc-rec-label">
                        {live ? '録音中' : phase === 'paused' ? '一時停止中' : ended ? '録音終了' : '録音開始'}
                      </span>
                      {phase !== 'idle' && (
                        <span className="rc-timer rc-num" aria-live={live ? 'polite' : 'off'}>{fmtElapsed(elapsed)}</span>
                      )}
                    </div>

                    {live && (
                      /* ⚖ THE BREATHE KEYFRAME — the house style for
                         「quietly live」. Reduced motion gets a static solid dot:
                         it still SAYS live, it simply stops moving. */
                      <div className="rc-flag">
                        <span className="rc-dot" aria-hidden="true" />
                        録音中
                      </div>
                    )}
                    {phase === 'paused' && (
                      <div className="rc-flag is-paused">
                        <span className="rc-dot is-static" aria-hidden="true" />
                        一時停止中
                      </div>
                    )}

                    {phase === 'idle' && (
                      <div className="rc-rec-sub">{current.customerName}様のセッションを録音します。</div>
                    )}

                    {/* ⚠ THE WAVEFORM IS NOT IN THE MOCK AND IT STAYS (R6-22 —
                        Liam: 「keep everything the phone app has」). Compact
                        inside the group while live or paused, frozen and dimmed
                        once stopped. `scaleY`, never height: a composite-only
                        property never lays out. */}
                    {(live || phase === 'paused') && (
                      <div className="rc-wave" aria-hidden="true">
                        {bars.map((v, i) => (
                          <span key={i} className="rc-bar" style={{ transform: `scaleY(${v})` }} />
                        ))}
                      </div>
                    )}
                    {ended && frozen.length > 0 && (
                      <div className="rc-wave is-frozen" aria-hidden="true">
                        {frozen.map((v, i) => (
                          <span key={i} className="rc-bar" style={{ transform: `scaleY(${v})` }} />
                        ))}
                      </div>
                    )}

                    {/* ⚠ NO SIDE CONTROL EVER REPEATS THE BIG BUTTON'S CURRENT
                        VERB (⚖ B4-4). Recording ⇒ the big button stops, so the
                        row offers 一時停止 alone; paused ⇒ the big button
                        resumes, so the row offers 停止 alone. There is still
                        exactly ONE way to end a take, and it is the loudest
                        thing on the panel. */}
                    <div className="rc-controls">
                      {phase === 'recording' && (
                        <button className="rc-mini" type="button" data-press onClick={() => setPhase('paused')}>一時停止</button>
                      )}
                      {phase === 'paused' && (
                        <button className="rc-mini" type="button" data-press onClick={stop}>停止</button>
                      )}
                      {/* ⚖ B4-3 — THERE IS NO 「やり直す」 OVER AN UNRESOLVED
                          TAKE. From 停止 the two resolutions are 使う and 破棄,
                          and nothing else. */}
                    </div>
                  </div>

                  {/* ⚖ W7-1 — the closed gate says WHICH of the two reasons it
                      is, in the customer's own case. */}
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
                          data-press
                          ref={discardBtnRef}
                          onClick={() => { setDiscardOf('recorder'); setDialog('discard') }}
                        >
                          <Icon name="trash" size={14} />破棄
                        </button>
                        {/* ⚖ R6-D3 — THE CONFIRM RENDERS, THE COMMIT REFUSES.
                            This button is a REAL lever: it opens the designed
                            confirm and shows the カルテ record a commit would
                            touch. What refuses is the commit inside it. */}
                        <button
                          className="btn rc-commit"
                          type="button"
                          data-press
                          ref={useOpenRef}
                          onClick={() => setDialog('use')}
                        >
                          この録音を使う
                        </button>
                      </div>
                    </div>
                  )}

                  {receipt?.of === 'recorder' && (
                    <Receipt receipt={receipt} closeRef={receiptCloseRef} onClose={() => setReceipt(null)} />
                  )}
                </div>

                {/* ⚖ CONSENT — ONE THIN LINE UNDER THE RECORD GROUP (Liam F-1
                    R2-1), ALWAYS VISIBLE because it GATES recording (the consent
                    floor). Three states are designed: current wears a green
                    badge and the evidence, stale and absent wear their tone, the
                    gate note and the button that opens the read-aloud flow. The
                    full proof text and the policy floor live one press away in
                    the pop-down, so nothing is cut. */}
                <div
                  className={`rc-consentline is-${consentOk ? 'current' : current.consentState}${consentOpen ? ' is-open' : ''}`}
                  data-guide-title="録音の同意"
                  data-guide="録音を始めてよいかどうかの確認です。いまの説明文で同意をいただけている予約だけ録音を始められます。同意が古いときも、新しく取り直しが必要です。"
                >
                  <div className="rc-cl-row">
                    <span className={`rc-cl-badge ${consentOk ? 'is-true' : current.consentTone}`}>
                      <Icon name="shield" size={11} />
                      {consentOk && !current.canStart ? '同意あり（デモ）' : current.consentLabel}
                    </span>
                    <span className="rc-cl-ev" title={current.consentProof}>
                      {demoConsent[current.appointmentId]
                        ? '読み上げによる確認で取得しました（デモ・この端末のみ）'
                        : current.consentShort}
                    </span>
                    {!consentOk && current.consentAction && (
                      <button
                        /* ⚠ `btn`, NOT `btn primary`. This room PAINTS its own
                           commits (⚖ R13's recipe, and `rc-commit` beside it
                           does the same), and `.biz .btn.primary` ties with
                           `.biz .pg-recording .rc-cl-take` on specificity — a
                           tie App Router decides by whichever sheet it inserted
                           last, which is not a thing to leave a colour to. */
                        className="btn rc-cl-take"
                        type="button"
                        data-press
                        ref={consentOpenRef}
                        onClick={() => setDialog('consent')}
                      >
                        {current.consentAction}
                      </button>
                    )}
                    <button
                      className="rc-cl-more"
                      type="button"
                      data-press
                      aria-expanded={consentOpen}
                      aria-controls="rcConsentDetail"
                      onClick={() => setConsentOpen((v) => !v)}
                    >
                      同意の記録をくわしく見る
                      <span className="rc-cv" aria-hidden="true"><Icon name="chevdown" size={11} weight={2.4} /></span>
                    </button>
                  </div>
                  <div className="rc-collapse" id="rcConsentDetail" ref={consentPanelRef}>
                    <div className={`rc-collapse-in${consentOpen ? ' is-in' : ''}`}>
                      <div className="rc-cl-detail">
                        <b>同意状況</b><br />
                        {demoConsent[current.appointmentId]
                          ? 'この録音セッションの同意は、読み上げによる確認で取得しました（デモ・この端末のみ）。'
                          : current.consentProof}<br />
                        {'録音に必要な同意の確認です。録音の同意は、この製品の決まりとして必ず取得します。店舗ごとの切り替えはありません。'}
                        {!consentOk && current.gateNote ? <><br />{current.gateNote}</> : null}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* ═══ 前回までの流れ — the phone's before-session brief, fuller ═══ */}
          {current !== null && (
            <section
              className={`rc-card rc-brief${briefOpen ? ' is-open' : ''}`}
              data-guide-title="前回までの流れ"
              data-guide="施術に入る前に目を通す情報です。前回いつ来られて何をしたか、過去のカルテ、前回のAI要約と施術メモが並びます。見出しを押すと閉じたり開いたりできます。"
            >
              <button className="rc-brief-hd" type="button" data-press aria-expanded={briefOpen} aria-controls="rcBriefPanel" onClick={() => setBriefOpen((v) => !v)}>
                <span className="rc-brief-ttl">前回までの流れ</span>
                <span className="rc-brief-who" title={`${current.customerName}様`}>{current.customerName}様</span>
                <span className="rc-brief-hint">施術に入る前に目を通す情報です</span>
                <span className="rc-brief-sp" />
                <span className="rc-cv" aria-hidden="true"><Icon name="chevdown" size={14} weight={2.2} /></span>
              </button>
              <div className="rc-collapse" id="rcBriefPanel" ref={briefPanelRef}>
                <div className={`rc-collapse-in${briefOpen ? ' is-in' : ''}`}>
                  <div className="rc-brief-body">
                    {/* v4-1: two PACKED vertical stacks, never a row-aligned
                        grid — grid rows align to the tallest card and tore
                        holes between the tinted boxes at wide windows. */}
                    <div className="rc-bcols">
                      <div className="rc-bcol">
                        <div className="rc-bsec is-blue">
                          <span className="rc-bk"><Icon name="calendar" size={12} />前回のご来店</span>
                          {current.brief.lastLine === null ? (
                            <div className="rc-bempty">まだご来店の記録がありません。<br />この店舗では初めてのご来店です。</div>
                          ) : (
                            <div className="rc-bv rc-clamp-2" title={current.brief.lastLine}>{current.brief.lastLine}</div>
                          )}
                          <div className="rc-brow">
                            <span className="rc-tag is-grey">{current.brief.visitsTag}</span>
                            {/* ⚖ B1-2 — A LEVER LABELLED WITH A RECORD CANNOT
                                LAND ON THE WHOLE LIST. The カルテ route takes
                                `?store=` alone, so this one, every past-record
                                row and the door below REFUSE in the room's own
                                grammar rather than navigating somewhere their
                                labels do not promise. */}
                            {current.brief.lastKaruteLabel && (
                              <button {...refused(`カルテ ${current.brief.lastKaruteLabel} を開く`, props.refusals.karuteOpen, { base: null, className: 'rc-klink' })} data-press>
                                カルテ {current.brief.lastKaruteLabel} を開く<Icon name="chevron" size={12} weight={2.4} />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="rc-bsec">
                          <span className="rc-bk"><Icon name="file" size={12} />過去のカルテ</span>
                          {current.brief.records.length === 0 ? (
                            <div className="rc-bempty">まだカルテはありません。<br />初めてのご来店です。今回の録音からつくるカルテが、はじめの1件になります。</div>
                          ) : (
                            <div className="rc-klist">
                              {current.brief.records.map((r) => (
                                <button {...refused(`${r.dateLabel} ${r.title}`, props.refusals.karuteOpen, { base: null, className: 'rc-krow' })} key={r.id} data-press>
                                  <span className="rc-kd rc-num">{r.dateLabel}</span>
                                  <span className="rc-kt">{r.title}</span>
                                  <span className="rc-cv" aria-hidden="true"><Icon name="chevron" size={12} weight={2.4} /></span>
                                </button>
                              ))}
                              {/* v5-3 — the depth goes behind ONE door, and the
                                  door counts what is behind it. */}
                              {current.brief.doorLabel && (
                                <button {...refused(current.brief.doorLabel, props.refusals.karuteOpen, { base: null, className: 'rc-krow is-door' })} data-press>
                                  <span className="rc-kt">{current.brief.doorLabel}</span>
                                  <span className="rc-cv" aria-hidden="true"><Icon name="chevron" size={12} weight={2.4} /></span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="rc-bsec">
                          <span className="rc-bk"><Icon name="chat" size={12} />同意・連絡</span>
                          <div className="rc-brow">
                            {current.contactTags.length > 0 ? (
                              current.contactTags.map((t) => <span className="rc-tag" key={t}>{t}</span>)
                            ) : (
                              <span className="rc-tag is-grey">許可された連絡手段なし</span>
                            )}
                            <button className="rc-note-toggle" type="button" data-press aria-expanded={tagNoteOpen} aria-controls="rcTagNote" onClick={() => setTagNoteOpen((v) => !v)}>
                              これは何？
                              <span className="rc-cv" aria-hidden="true"><Icon name="chevdown" size={11} weight={2.4} /></span>
                            </button>
                          </div>
                          <div className="rc-collapse" id="rcTagNote" ref={tagNotePanelRef}>
                            <div className={`rc-collapse-in${tagNoteOpen ? ' is-in' : ''}`}>
                              <div className="rc-note-body">{props.contactDisclaimer}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rc-bcol">
                        <div className="rc-bsec is-indigo">
                          {/* ⚖ THE LABEL SAYS WHAT IT IS. 「AIのまとめ」 alone
                              would read as a summary of TODAY; this is the last
                              カルテ's, and a staffer about to walk into a room
                              has to know which. */}
                          <span className="rc-bk"><Icon name="spark" size={12} />前回のカルテのAI要約</span>
                          {current.brief.summary === null ? (
                            <div className="rc-bempty">前回のまとめはまだありません。</div>
                          ) : (
                            <>
                              <div className={`rc-bv${sumOpen ? '' : ' rc-clamp-6'}`} ref={sumRef}>{current.brief.summary}</div>
                              {sumOverflows && (
                                <button className={`rc-moretog${sumOpen ? ' is-on' : ''}`} type="button" data-press onClick={() => setSumOpen((v) => !v)}>
                                  {sumOpen ? '閉じる' : 'もっと見る'}
                                  <span className="rc-cv" aria-hidden="true"><Icon name="chevdown" size={11} weight={2.4} /></span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                        <div className="rc-bsec is-amber">
                          <span className="rc-bk"><Icon name="pencil" size={12} />前回の施術メモ</span>
                          {current.brief.memo.length === 0 ? (
                            <div className="rc-bempty">前回の施術メモはまだありません。今回の施術内容が、はじめの記録になります。</div>
                          ) : (
                            <>
                              <ul className={`rc-memo${memoOpen ? '' : ' is-clamped'}`}>
                                {current.brief.memo.map((m, i) => (
                                  <li key={`${m.label}-${i}`}><span className="rc-memo-k">{m.label}</span>{m.text}</li>
                                ))}
                              </ul>
                              {current.brief.memo.length > 3 && (
                                <button className={`rc-moretog${memoOpen ? ' is-on' : ''}`} type="button" data-press onClick={() => setMemoOpen((v) => !v)}>
                                  {memoOpen ? '閉じる' : 'もっと見る'}
                                  <span className="rc-cv" aria-hidden="true"><Icon name="chevdown" size={11} weight={2.4} /></span>
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ⚠ PHONE PARITY, HONESTLY (registry ⑪). The phone's
                        `PreSessionBrief` also carries AI-GENERATED hooks, an
                        opener, a recommended focus, a memo reading and the
                        customer's reservation memo. This plane holds none of
                        them — no model call, no memo field — so the room renders
                        NOTHING for them and says so in one quiet line. Inventing
                        the text would be this page writing content a staffer
                        would take for the AI's. */}
                    <p className="rc-bai">会話のきっかけ・今日のおすすめ（AIの事前ブリーフ）は、実データ接続後に表示されます。</p>
                    <div className="rc-bnote">この内容は、前回までのカルテと施術メモからまとめています（見本データ）。</div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* ═══ ROW 2 — 要対応 strip + 録音履歴, full content width ═══ */}

        {/* ⚖ ONE SLIM STRIP (Liam F-1 R2-4: the old row read stretched — label
            left, a huge blank, pills far right). The pills flow immediately
            beside the label, each one's count is EXACTLY what its filter
            reveals, and the strip renders ONLY when something actually needs a
            hand — a 「要対応 0件」 header is a page inventing a warning. */}
        {props.attention && (
          <section
            className="rc-card rc-attn"
            aria-label="要対応"
            data-guide-title="要対応"
            data-guide="いま手を動かす必要がある録音だけをまとめた行です。件数はそれぞれ、押したときに一覧へ残る件数そのものです。手を動かすものが何もないときは、この行そのものが出ません。"
          >
            <div className="rc-attnstrip">
              <span className="rc-attn-ttl">{props.attention.title}</span>
              <span className="rc-attn-cnt rc-num">{props.attention.countLine}</span>
              <span className="rc-attn-hint">{props.attention.hint}</span>
              {props.attention.pills.map((p) =>
                p.action.kind === 'save' ? (
                  <span className={`rc-aspill is-${p.tone}`} key={p.key}>
                    <span className={p.chip}>{p.stateLabel}</span>
                    <span className="rc-aspill-n rc-num">{p.countLabel}</span>
                    {p.note && <span className="rc-aspill-m">{p.note}</span>}
                    <button {...refused(p.action.label, props.refusals.save, { className: 'rc-aspill-go' })} data-press>
                      {p.action.label}
                    </button>
                  </span>
                ) : (
                  <button
                    className={`rc-aspill is-${p.tone}`}
                    type="button"
                    data-press
                    key={p.key}
                    onClick={() => { pickFilter(p.stateLabel); historyRef.current?.scrollIntoView({ block: 'start' }) }}
                  >
                    <span className={p.chip}>{p.stateLabel}</span>
                    <span className="rc-aspill-n rc-num">{p.countLabel}</span>
                    {p.note && <span className="rc-aspill-m">{p.note}</span>}
                    <span className="rc-aspill-go">{p.action.label}</span>
                  </button>
                ),
              )}
            </div>
          </section>
        )}

        {/* ═══ 録音履歴 ═══ */}
        <section
          className="rc-card rc-history"
          aria-labelledby="rcHistoryTitle"
          ref={historyRef}
          data-guide-title="録音履歴"
          data-guide="この画面から見える録音の一覧です。新しい順に並びます。どの録音がいまどうなっているかを、ここでまとめて確かめられます。"
        >
          <div className="rc-history-head">
            <h2 className="rc-sec-title" id="rcHistoryTitle">
              <span className="rc-sec-icon is-history" aria-hidden="true"><Icon name="history" size={14} /></span>
              録音履歴
            </h2>
            {/* ⚖ 8/25 ruling B, staff half — the caption and the own-count are
                ONE line: both are plain labelled facts about this list, and two
                stacked lines cost the fold 20px for no meaning. `null` renders
                NOTHING, never 0. */}
            <span className="rc-history-cap">
              {props.historyCaption}
              {props.ownDiscardLine && <> ・ {props.ownDiscardLine}</>}
            </span>
            <span className="rc-history-sp" />
            {props.canReviewDiscards && (
              <button
                className="btn rc-review-open"
                type="button"
                data-press
                ref={reviewRef}
                onClick={() => setScreen('discards')}
              >
                破棄の記録<Icon name="chevron" size={13} />
              </button>
            )}
          </div>

          {props.takes.length === 0 ? (
            <div className="rc-empty">
              <strong>この画面から見える録音はまだありません</strong>
              <span>録音を始めると、新しい順にここへ並びます。</span>
            </div>
          ) : (
            <>
              {/* ⚖ COUNTERS AS FILTERS, with the mock's sliding thumb. ONE state
                  at a time; every chip is the same quiet neutral, so the 破棄済み
                  chip cannot be the loud one; and the number on a chip IS the
                  number of rows its press leaves standing. */}
              <div className="rc-segwrap">
                <div
                  className="rc-seg"
                  role="group"
                  aria-label="状態でしぼりこむ"
                  ref={segRef}
                  data-guide-title="状態でしぼりこむ"
                  data-guide="録音の状態で一覧をしぼりこめます。それぞれの数字は、押したときに残る件数そのものです。破棄済みもここに出ます。破棄した録音を隠すことはありません。"
                >
                  <span className="rc-seg-thumb" aria-hidden="true" ref={thumbRef} />
                  <button
                    className={`rc-seg-btn${stateFilter === null ? ' is-on' : ''}`}
                    type="button"
                    data-press
                    aria-pressed={stateFilter === null}
                    onClick={() => pickFilter(null)}
                  >
                    すべて<span className="rc-seg-n rc-num">{walk.visible.length}</span>
                  </button>
                  {filters.map((f) => (
                    <button
                      key={f.label}
                      className={`rc-seg-btn${stateFilter === f.label ? ' is-on' : ''}`}
                      type="button"
                      data-press
                      aria-pressed={stateFilter === f.label}
                      onClick={() => pickFilter(stateFilter === f.label ? null : f.label)}
                    >
                      {f.label}<span className="rc-seg-n rc-num">{f.n}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="rc-tablewrap"
                data-guide-title="録音の一覧"
                data-guide="録音が1件ずつ並びます。1行に、日付と時刻、お客様、録音した人、長さ、いまの状態が出ます。カルテになった録音は、お客様の下にそのカルテの番号が出ます。破棄済みの録音は決着がついた録音のため、操作のボタンは出ません。"
              >
                {/* ⚠ FIVE COLUMNS, AND 状態・操作 IS ONE CELL (v5-1). A separate
                    操作 column was blank in four rows of seven — a labelled cell
                    with nothing in it reads as broken — and its cap pushed the
                    button to the card's far right with ~96px of white after the
                    chip. Chip and action now sit together, and only お客様 is
                    elastic, CARRYING the sub-message, so surplus width becomes
                    readable text instead of a dead middle. */}
                <div className="rc-rowhead" aria-hidden="true">
                  <span>日付</span>
                  <span>お客様</span>
                  <span>録音者</span>
                  <span>長さ</span>
                  <span>状態・操作</span>
                </div>
                <div className={`rc-rows${filterSwapped ? ' is-swap' : ''}`} key={stateFilter ?? 'all'}>
                  {rows.map((t) => (
                    <div className={`rc-row${t.isDiscarded ? ' is-discarded' : ''}`} key={t.id} data-state={t.stateLabel}>
                      <span className="rc-c-date rc-num">{t.dateLabel} {t.timeLabel}</span>
                      <span className="rc-c-cust">
                        <span className={`rc-avatar${t.hasCustomer ? '' : ' is-none'}`} aria-hidden="true">{t.customerInitial}</span>
                        <span className="rc-custtxt">
                          <span className="rc-nm">{t.customerLabel}</span>
                          {/* ⚠ THE SUB-MESSAGE LIVES INSIDE THE お客様 TRACK (v5
                              D2): it cannot overlap a neighbouring column by
                              construction, and it is what earns that column its
                              width on a wide desk. */}
                          {(t.karuteRecordLabel || t.reasonLine) && (
                            <span className="rc-sub">
                              {t.karuteRecordLabel && <span className="rc-kchip">カルテ {t.karuteRecordLabel}</span>}
                              {t.reasonLine}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="rc-c-by">{t.byName}</span>
                      <span className="rc-c-dur rc-num">{t.durationLabel}</span>
                      <span className="rc-c-state">
                        <span className={t.stateChip}>{t.stateLabel}</span>
                        {/* ⚖ R2 + A2-3 — a 破棄済み row offers NOTHING: no 開く,
                            no 保存, no 再試行. The evidence is kept internally;
                            the affordance is suppressed, decided from the state
                            alone. */}
                        {t.action === null ? null : t.action.kind === 'karute' && t.action.href ? (
                          <Link className="rc-linkbtn" href={t.action.href}>{t.action.label}</Link>
                        ) : (
                          <button {...refused(t.action.label, props.refusals.save, { className: 'rc-row-save' })} data-press>
                            <Icon name="save" size={13} />{t.action.label}
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {walk.hidden > 0 && (
                  <div
                    className="rc-more"
                    data-guide-title="さらに表示"
                    data-guide="この一覧は新しい日付から順に、1週間ぶんずつさかのぼって読み込みます。押すと、さらに前の期間の録音が下に追加されます。"
                  >
                    {/* ⚠ THE COUNTER STORES THE STEP THE WALK LANDED ON, not the
                        one this screen asked for. Counting `s + 1` from local
                        state re-derived a step the walk had already passed, so
                        on a quiet fortnight the button did nothing for four
                        presses in a row (F6-1). */}
                    <button className="btn" type="button" data-press onClick={() => setSteps(walk.step + 1)}>
                      さらに表示（あと{walk.hidden}件）
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* ═══ THE FOOTNOTE DISCLOSURE — the trace card FOLDS, nothing is cut ═══
            Everything the standing trace card said is here: the この画面の見え方
            lines VERBATIM, the provenance rows, the two refused actions and the
            sample notice. It sits behind one bar because none of it is what a
            receptionist came to this page to read — and all of it is what a
            manager asking 「where does this number come from?」 came for. */}
        <section
          className={`rc-footnote${footOpen ? ' is-open' : ''}`}
          aria-label="この画面の値の設定元 ・ 見本データについて"
          data-guide-title="この画面の値の設定元"
          data-guide="この画面で見えるもの・見えないものと、それぞれの値がどこで決まっているかの一覧です。まだつないでいないものは「未接続」と書いてあります。担当者の名簿だけは、いまも開けるスタッフ・シフトの画面につながっています。"
        >
          <div className="rc-fn-panel" id="rcFootnotePanel" ref={footPanelRef}>
            <div className={`rc-collapse-in${footOpen ? ' is-in' : ''}`}>
              <div className="rc-fn-scroll">
                {/* ⚠ PROSE INSIDE THE DISCLOSURE, so a plain `<div>`: the panel
                    it sits in is the declared region, and a second `<section>`
                    here would be a tour step for two paragraphs that already
                    have one. The words are the same words. */}
                {props.noticeLines.length > 0 && (
                  <div className="rc-notice">
                    {props.noticeLines.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                )}
                <h2 className="rc-sec-title">{props.footnoteTitle}</h2>
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
                  <button {...refused('録音の設定を開く', props.refusals.policy)} data-press>録音の設定を開く</button>
                  <button {...refused('自分の音声を登録', props.refusals.enroll)} data-press>自分の音声を登録</button>
                </div>
                <p className="rc-samplenote" id="rcFootnote">{props.actionFootnote}</p>
              </div>
            </div>
          </div>
          <button className="rc-fn-bar" type="button" data-press aria-expanded={footOpen} aria-controls="rcFootnotePanel" onClick={() => setFootOpen((v) => !v)}>
            <Icon name="info" size={13} weight={1.9} />
            {props.footnoteBar}
            <span className="rc-fn-sp" />
            <span className="rc-cv" aria-hidden="true"><Icon name="chevup" size={13} weight={2.2} /></span>
          </button>
        </section>
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
            data-guide="破棄された録音の記録です。スタッフが書いた理由と、その録音の文字起こしを並べて確認できます。文字起こしがない場合は、なぜないのかを書いています。承認や確認の操作はありません。読むための画面です。右上の「録音」から録音の画面に戻れます。"
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
                    <span className="rc-summary-one" key={s.rowKey}>
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
                          <div className="rc-detail-card">
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
                            <div className="rc-detail-card">
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

          {/* ⚠ RENAMED FROM `rc-footnote` THIS ROUND. The recorder screen's own
              FOOTNOTE DISCLOSURE now owns that name, and one class meaning two
              different things inside one room is a collision waiting for the
              next reader — even when the two never render together. */}
          <p className="rc-review-foot">
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
          <p className="rc-dlg-sub">破棄は取り消せない操作のため、理由の記入が必要です。</p>
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
  /** ⚠ THE MOMENT THIS DIALOG APPEARED — the one fact that separates a
   *  DECISION to dismiss from the leftover second press of a double-tap.
   *  `SCRIM_SETTLE_MS` carries the whole argument and the measurement; this is
   *  the ONE home for all three dialogs, which is why the fix is here and not
   *  on any opener. Every dialog unmounts on close, so each opening gets its
   *  own clock.
   *
   *  ⚠ IT STARTS FAIL-CLOSED, AND IN A LAYOUT EFFECT. `Date.now()` in the
   *  `useRef` initializer is an impure render (react-hooks/purity, and the rule
   *  is right — a re-render would re-read the clock). `Infinity` means the
   *  backdrop refuses everything until the panel has actually been laid out,
   *  and the effect below stamps the moment it was: no window exists in which
   *  an unstamped scrim would dismiss. */
  const openedAt = useRef(Number.POSITIVE_INFINITY)
  useLayoutEffect(() => { openedAt.current = Date.now() }, [])

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
      {/* ⚠ THE BACKDROP IGNORES A PRESS THAT LANDS BEFORE THE READER COULD HAVE
          SEEN THE PANEL. A double-tap on any opener used to close the dialog it
          had just opened, on all three dialogs at every realistic gap: the
          scrim mounts under a pointer already resting where the opener was, so
          the second press's own pointerdown lands here and its click dismisses.
          `SCRIM_SETTLE_MS` names the window and carries the measurement (F6-2).
          Escape and cancel are untouched — this delays the one exit that can be
          taken by accident. */}
      <div
        className="rc-scrim"
        onClick={() => { if (Date.now() - openedAt.current >= SCRIM_SETTLE_MS) onClose() }}
      />
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

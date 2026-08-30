'use client'

// カルテ — the computer door onto the phone app's records, rendered from props
// the server already resolved. ⚖ Liam 8/30 D2: THE LIST IS A FULL-PAGE SEARCH
// TABLE, canon's own (MOCK-karute-list.html) — never squeezed into a 380px queue
// column beside a detail, which is the one shape that ruling names. So the room
// shows ONE SCREEN AT A TIME at every width, exactly as canon's two pages do: the
// table, or the record, with ← カルテ一覧 between them.
//
// ⚖ THE DESIGN ROUND (Liam 8/30 evening, MOCK-KARUTE-DESIGN-2026-08-30.html).
// The body below is the proven one; the CLOTHES are the approved mock's, and the
// mock's own two laws decide what changed and what could not:
//   (a) THE RECOGNITION FLOOR — a staff member who writes a line on the phone
//       must READ it here in the same words, the same colours and the same
//       order. The eight category chips carry `CurrentSessionCard.tsx:46-61`'s
//       palette VERBATIM, each line's bullet is that chip's own ink, the section
//       names are unchanged, the band icons are the phone's, and 手書き / the
//       amber pencil / 同意確認済 mean exactly what they mean on the phone.
//   (b) DESIGNED AS A COMPUTER PROGRAM — a sticky context strip carrying an
//       in-record 目次 that lists ONLY the sections this record actually has,
//       the drawers flowing in two columns instead of one tall stack, and ↑↓
//       walking the table's rows. Those are the desk's idioms, not the phone's.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: the search box, which staff scope
// and which state filter are pressed, how many windows back the walk has gone,
// which record is open, whether the reassign warning is disclosed, which section
// the 目次 is pointing at, and which step of the 画面の説明 tour the reader is
// on. Every one is pure browsing — none of them writes anything. Every control
// canon has that WOULD write ships refused with its own reason, so there is no
// staged state for a provider to hold above this component. Stated rather than
// assumed: if any of them is ever connected, its staged result belongs above
// this component, not inside it (flag 30's class).
//
// CLASS NAMES ARE PREFIXED `kr-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and 今日の
// 運営 / 顧客 / 予約一覧 / 売上分析 / スタッフ・シフト / 受信トレイ / 売上・レジ all
// state BARE `.biz .<name>` rules on names canon's カルテ pages use (`.panel`,
// `.fact`, `.empty`, `.filters`, `.summary`, `.identity`, `.history-row`,
// `.spot-card`…). A fence that has to enumerate sixty shared names rots as the
// neighbours grow; not colliding at all cannot. `page` / `h1` / `btn` are the
// SHELL's and restated here, so those three are fenced in karute.css at four
// levels. ⚖ THE DESIGN ROUND SHRANK THIS SURFACE rather than growing it: the
// three chips this room used to borrow from the shell (`pill` for 手書き,
// `pill good` for 同意確認済, `pill indigo` for LINE) are now the room's own
// `kr-hand` / `kr-consent` / `kr-line`, spelled to the phone's values. `btn` is
// the ONLY shell class the markup still names; the state and outcome pill tones
// still arrive as PROPS, decided once in `karute.ts`.

import Link from 'next/link'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import {
  keepCardOffHeading,
  matchesFilter,
  matchesReveal,
  matchesSearch,
  windowRows,
  type RecordFilter,
  type RecordState,
} from '@/business/lib/karute'

/** THE ROUTE WRAPPER. Every rule in karute.css is scoped under this class, so
 *  nothing this sheet says can reach another room; `.page.pg-karute` (four
 *  levels) rather than `.pg-karute` (three) so a sibling's own three-level rule
 *  (`.biz .page .btn`, customers.css:23) cannot win the room back on insertion
 *  order. */
const ROOT = 'page pg-karute'

/** THE PHONE'S OWN ICONS (lucide-react — the app's icon library), inlined as
 *  geometry so this room adds no dependency, no bundle and no request. Every one
 *  is DECORATIVE: the word beside it is what a screen reader reads, which is why
 *  they are all `aria-hidden`. Names are the lucide names, so the phone file
 *  each one came from can be checked against the same word. */
const ICONS = {
  chevron: <path d="m9 18 6-6-6-6" />,
  visits: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>,
  heart: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  swap: <path d="M8 3 4 7l4 4M4 7h16m-4 14 4-4-4-4M20 17H4" />,
  redo: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>,
  pencil: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>,
  message: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  mic: <><rect x="9" y="2" width="6" height="11" rx="3" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  check: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  ticket: <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />,
  trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></>,
} as const

function Icon({ name, size = 12, weight = 2 }: { name: keyof typeof ICONS; size?: number; weight?: number }) {
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

export interface KaruteEntryProps {
  /** ⚖ THE RECOGNITION FLOOR's own key. The line's drawer, carried as the
   *  phone's own category id so the chip and its bullet can read ONE tone from
   *  the sheet (`[data-cat="…"]`) rather than the screen carrying a second copy
   *  of `CATEGORY_TONE`. The eight ids are `CATEGORY_ORDER`'s, and the room's
   *  suite derives the tone census FROM that list. */
  category: string
  label: string
  text: string
  handwritten: boolean
}

export interface KaruteRowProps {
  id: string
  customerId: string
  customerName: string
  furigana: string | null
  memberNumber: string
  mark: string
  /** The person header's contact row — the phone's own `CustomerHeaderCard`
   *  links, and `null` when the customer has none rather than an empty link. */
  phone: string | null
  email: string | null
  staffId: string | null
  staffName: string
  service: string
  bookingNo: string
  /** jstDayKey — the window walk's axis, compared and never formatted here. */
  dayKey: number
  thisWeek: boolean
  state: RecordState
  stateLabel: string
  statePill: string
  dateLabel: string
  dateLongLabel: string
  timeLabel: string
  preview: string | null
  previewFallback: string
  entries: KaruteEntryProps[]
  summaryBullets: string[]
  summaryEdited: boolean
  history: Array<{ when: string; what: string; detail: string }>
  photos: Array<{ category: string; caption: string }>
  /** `null` when the reader's own permission emptied the photo array — a count
   *  they made zero is omitted, never printed as 0 (F-K14). */
  photoCountLabel: string | null
  aiMessage: string | null
  recordingLine: string
  consentLabel: string | null
  outcomeLabel: string
  outcomePill: string
  outcomeNote: string | null
  ticketLine: string | null
  discard: { whenLabel: string; by: string; reason: string | null; ticketNote: string | null } | null
  visitLabel: string
  lastVisitLabel: string | null
  customersHref: string
}

export interface KaruteRevealProps {
  customerId: string
  name: string
  furigana: string | null
  memberNumber: string
  mark: string
  customersHref: string
}

export interface KaruteProps {
  dateline: string
  lensLabel: string
  subtitle: string
  filters: Array<{ key: RecordFilter; label: string }>
  selfStaffId: string | null
  selfLabel: string
  rows: KaruteRowProps[]
  reveals: KaruteRevealProps[]
  monthLabel: string
  noticeLines: string[]
  canReassign: boolean
  actionFootnote: string
  refusals: {
    entry: string
    summary: string
    regenerate: string
    message: string
    send: string
    outcome: string
    reassign: string
    photo: string
  }
}

/** ⚖ Liam 8/23 — 画面の説明. The board's own tour helpers, carried at the same
 *  shape: a rect literal the engine understands, and two identity guards that
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

/** ⚖ 顧客一覧 — ONE label and ONE href source, read by every place this room
 *  points at the person: the record's name, the breadcrumb, and the reveal row.
 *  Two spellings would let one of them describe a different destination from the
 *  other (A8). */
const CUSTOMERS_LABEL = '顧客一覧で確認'

/** カルテの顧客変更's warning, in the phone app's OWN words (messages/ja.json
 *  karuteDetail.reassign.disclaimerBody1 / Body2 / auditNote). The flow is one
 *  flow across two doors, so the sentence a staffer reads before re-pointing a
 *  record must not be two different sentences on two screens. */
const REASSIGN_WARNING = [
  'このカルテ（施術記録）を、別のお客様に付け替えます。',
  '誤って別のお客様に保存してしまった場合の修正専用です。',
  'この操作は監査ログに記録されます。',
]

export function KaruteScreen(props: KaruteProps) {
  const [scope, setScope] = useState<'all' | 'self'>('all')
  const [filter, setFilter] = useState<RecordFilter>('all')
  const [query, setQuery] = useState('')
  // ⚖ CHUNK-LOADING (packet §7b-1). How many 14-day windows back the walk has
  // gone. View state: it changes what is on screen and writes nothing.
  const [steps, setSteps] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [reassignOpen, setReassignOpen] = useState(false)
  /** ⚖ THE DESIGN ROUND — WHICH 目次 ENTRY THE READER TOOK. Browsing, like every
   *  other piece of state here: it lights a control and writes nothing.
   *
   *  ⚠ AND IT IS THE JUMP, NOT A SCROLL POSITION — measured, not assumed. The
   *  first cut was an IntersectionObserver picking "the first section still
   *  below the strip", the ordinary scroll-spy. It CANNOT work in this record,
   *  and the probe proved it: the record is a TWO-COLUMN grid, so 本日のセッション
   *  and 詳細記録 begin at the same y — jumping to the right column's first card
   *  leaves both sections straddling the line, and every jump after the first
   *  read as 本日のセッション. Geometry has no answer to give here, because the
   *  question 「which one am I on」 genuinely has two answers when two cards are
   *  side by side. What DOES have one answer is which entry the reader pressed,
   *  which is also what the pressed-state on a nav control means everywhere
   *  else. So the highlight is the jump, it says so, and there is no observer,
   *  no scroll listener and no clearance constant to keep in sync with a sheet. */
  const [here, setHere] = useState<string | null>(null)
  // ⚖ Liam 8/23 — 画面の説明. The step the tour is on, `-1` when it is closed.
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  // The record view's focus handover. `openedFrom` is the row the reader
  // pressed, so ← can put focus back exactly where it came from.
  const backRef = useRef<HTMLButtonElement>(null)
  const openedFrom = useRef<string | null>(null)

  // The tour's own nodes: the room root it walks, the ? it came from and goes
  // back to, the card it measures, and the 次へ it hands the keyboard.
  const rootRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)

  // ── the narrowing, in the order the reader thinks about it ────────────────
  // 担当 → 検索 → 状態 → how far back. Every step uses the SAME predicate the
  // counts below are computed with, which is what makes ⚖ the pill/count law
  // true by construction rather than by discipline.
  const scoped = useMemo(
    () => (scope === 'self' ? props.rows.filter((r) => r.staffId === props.selfStaffId) : props.rows),
    [props.rows, props.selfStaffId, scope],
  )
  const searched = useMemo(() => scoped.filter((r) => matchesSearch(r, query)), [scoped, query])
  const matched = useMemo(() => searched.filter((r) => matchesFilter(r, filter)), [searched, filter])
  /** ⚠ A SEARCH OPENS THE WALK (F-K10). The window is a recent-stretch read —
   *  the right shape for browsing, and the wrong one for a lookup: typing a
   *  customer's name showed their newest record and hid the rest behind
   *  さらに表示 (「見本 いつき」 matched 2, showed 1). Canon's pager never hid a
   *  search result. Filters and scope alone keep the windowed walk, because
   *  those ARE browsing. */
  const searching = query.trim() !== ''
  const walk = useMemo(
    () => (searching ? { visible: matched, hidden: 0, cutoff: null } : windowRows(matched, steps)),
    [matched, steps, searching],
  )
  const visible = walk.visible

  /** ⚖ THE PILL/COUNT LAW (packet §7b-3): a count beside a tappable filter shows
   *  EXACTLY what the tap reveals. Each count is the row set with THIS axis
   *  changed and every other axis left where the reader has it, which is what
   *  pressing the chip actually does — so a counter can never name a number its
   *  own press does not produce. What the walk is still holding back is named
   *  separately, in the head's 表示中 line, never hidden inside these figures. */
  const filterCounts = useMemo(
    () => new Map(props.filters.map((f) => [f.key, searched.filter((r) => matchesFilter(r, f.key)).length])),
    [props.filters, searched],
  )
  const scopeCounts = useMemo(() => {
    const pass = (r: KaruteRowProps) => matchesSearch(r, query) && matchesFilter(r, filter)
    return {
      all: props.rows.filter(pass).length,
      self: props.rows.filter((r) => r.staffId === props.selfStaffId && pass(r)).length,
    }
  }, [props.rows, props.selfStaffId, query, filter])

  /** The quiet reveal — ONE row, and only while the reader is searching. A
   *  records page shows records (⚖ §7a), so a customer with none is not a row
   *  in the table; the one case the standing section was really for is somebody
   *  typing a name and needing to know whether the person exists at all. */
  const revealed = useMemo(
    () => props.reveals.filter((c) => matchesReveal(c, query)),
    [props.reveals, query],
  )

  const current = props.rows.find((r) => r.id === selected) ?? null
  const detailOpen = current !== null

  /** ⚖ THE 目次 IS THE RECORD'S OWN SHAPE, not a menu anybody maintains. Exactly
   *  the data-presence rule the SECTIONS already obey, applied one level up: a
   *  record with no photos has no 写真記録 card AND no 写真記録 entry, so a
   *  sparse record gets a short 目次 rather than six links, two of which go
   *  nowhere. The mock's own second example is this case ("項目が4つなので目次も
   *  4つ"). */
  const toc = useMemo(() => {
    if (current === null) return []
    const out: Array<{ id: string; label: string }> = []
    if (current.discard) out.push({ id: 'krSecDiscard', label: '破棄されたカルテ' })
    out.push({ id: 'krSecSession', label: '本日のセッション' })
    out.push({ id: 'krSecSummary', label: '詳細記録' })
    if (current.aiMessage) out.push({ id: 'krSecMessage', label: 'AI提案メッセージ' })
    if (current.photos.length > 0) out.push({ id: 'krSecPhotos', label: '写真記録' })
    /* ⚠ 「録音 ・ 文字起こし」 — SPACED, AND SPACED IN ALL THREE PLACES (DL-6).
       The room used to print it closed up. The PHONE spells it with the spaces
       (`karuteDetail.transcript.title`, messages/ja.json) and so does the mock's
       own band, which makes the closed-up form a divergence from the recognition
       floor itself. The mock writes its 目次 entry closed up — that one space is
       argued as a deviation, because ⚖ A8 wants ONE name for one section and the
       phone's is the name the floor asks the room to carry. */
    out.push({ id: 'krSecRecording', label: '録音 ・ 文字起こし' })
    out.push({ id: 'krSecHistory', label: '記録の履歴' })
    return out
  }, [current])

  /** ⚖ THE DRAWERS, GROUPED. `buildRecords` already emits the entries in
   *  `CATEGORY_ORDER` and every line carries its own category, so grouping is a
   *  RUN-LENGTH pass over a list that is already sorted — no second ordering
   *  opinion, and no way for this screen to disagree with the phone about which
   *  drawer a line lives in. The count rides the chip only from two lines up:
   *  「気になる点 1」 on a drawer with one line is noise (the mock's rule). */
  const drawers = useMemo(() => {
    const out: Array<{ category: string; label: string; lines: KaruteEntryProps[] }> = []
    for (const e of current?.entries ?? []) {
      const last = out[out.length - 1]
      if (last && last.category === e.category) last.lines.push(e)
      else out.push({ category: e.category, label: e.label, lines: [e] })
    }
    return out
  }, [current])

  // ⚖ THE SWAP MUST NOT STRAND THE READER. Opening a record hides the table —
  // including the row that was focused — and going back hides the record, so in
  // both directions the browser would drop focus to <body> and a keyboard reader
  // would restart from the top of the document. Focus is therefore MOVED with
  // the screen: into the ← control on open, back onto the row that opened it on
  // close. This room swaps at EVERY width (D2's one-screen-at-a-time), so unlike
  // the 受信トレイ there is no band to test for — the swap is always in effect.
  useEffect(() => {
    if (detailOpen) {
      backRef.current?.focus()
      return
    }
    const row = openedFrom.current
    openedFrom.current = null
    if (row) document.getElementById(row)?.focus()
  }, [detailOpen])

  // A record that the current narrowing no longer shows must not stay open
  // behind it: going back would land the reader on a table that does not
  // contain what they were just reading (⚖ A10 — a surface lying about state).
  useEffect(() => {
    if (selected !== null && !matched.some((r) => r.id === selected)) setSelected(null)
  }, [matched, selected])

  // The warning belongs to the record it was opened on, and so does the 目次's
  // own highlight: opening another record with either still set would show one
  // record's state over another record's identity.
  useEffect(() => {
    setReassignOpen(false)
    setHere(null)
  }, [selected])

  /** ⚖ DL-1 — THE JUMP'S CLEARANCE IS MEASURED FROM THE STRIP, NEVER TUNED TO IT.
   *
   *  The sheet used to hold the clearance as a flat `124px`, which is the strip
   *  at ≥1280 (one row, 48px, under a 62px topbar) plus 14px of air. The strip
   *  WRAPS to two rows — 73px — from 1180 all the way down to 744, because the
   *  context, the label and the 目次 stop fitting on one line; at those widths
   *  the strip's bottom is 135 and the constant put the card at 124. Every
   *  jumped-to section landed ELEVEN PIXELS UNDER the bar that was supposed to
   *  help the reader find it, at seven of the room's own approved widths.
   *
   *  ⚠ AND THE FIX IS NOT A SECOND CONSTANT. There is no CSS way to read one
   *  element's height from another's rule, so the height is measured here and
   *  written onto the room root as `--kr-strip-h`; the sheet spends it beside
   *  the strip's own sticky offset, which it already owns. A ResizeObserver on
   *  the strip catches BOTH things that change it — the viewport crossing a
   *  wrap point, and a record whose 目次 is a different length — with one
   *  listener and no width table for anyone to keep in sync. */
  useLayoutEffect(() => {
    const strip = stripRef.current
    const root = rootRef.current
    if (!strip || !root) return
    const measure = () => root.style.setProperty('--kr-strip-h', `${strip.getBoundingClientRect().height}px`)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(strip)
    return () => ro.disconnect()
  }, [detailOpen])

  /** Narrowing the list starts the walk again. A reader who filters to 下書き
   *  and finds three windows already open is being shown a span they asked
   *  nothing about; every press of a filter is a fresh question. */
  const narrow = (next: () => void) => { next(); setSteps(1) }

  const clearFilters = () => {
    setScope('all')
    setFilter('all')
    setQuery('')
    setSteps(1)
  }

  /** ⚖ THE DESK'S OWN GESTURE (the mock's labelled proposal). ↑↓ walk the rows
   *  and Enter opens — reading a table row by row is what a computer is faster
   *  at, and a reader who has both hands on a keyboard should not have to reach
   *  for a mouse to do it. PURE VIEW: it moves FOCUS and writes nothing, and it
   *  is an ADDITION to the existing contract rather than a replacement — every
   *  row keeps its natural tab stop, so Tab still walks them exactly as before
   *  and the row that ← returns to is still the row that was pressed. */
  const walkRows = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.kr-row')]
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    const next = rows[e.key === 'ArrowDown' ? at + 1 : at - 1]
    if (!next) return
    // Only once a row really moves: at the ends the arrow keeps its ordinary
    // meaning and the page scrolls, which is what a reader expects.
    e.preventDefault()
    next.focus()
  }

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────

  /** THE ROOM'S TOUR, on the family's shared engine (`@/business/lib/guide`).
   *  A section joins the walk by DECLARING `data-guide-title` + `data-guide` ON
   *  ITSELF, so there is no list to keep in sync: a section that renders is a
   *  section that is explained, and one that is not on screen — the whole table
   *  while a record is open, the record while the table is, the reveal row when
   *  nobody is searching, the 破棄 banner on an ordinary record — drops out of
   *  the walk and out of the N/M count by itself. That is Liam's "when I add a
   *  function it should automatically pick it up", and it is why the room's gate
   *  is a census of what the DOM declares rather than a table anyone maintains.
   *  The design round's two new functions — the breadcrumb and the sticky strip
   *  with its 目次 — join by the same rule, on the same day they land.
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
    // The engine's answer, then this room's correction for the one shape it
    // cannot place: a full-width section taller than the viewport, where the
    // last-resort clamp puts the card over its own heading (F-K5).
    const at = keepCardOffHeading(spotCardAt(boxOf(r), size, viewport), size, boxOf(r), viewport)
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  // ONE keyboard listener for the two things that can be open, innermost first:
  // while the tour is up it owns Escape (and the arrows walk the ring), and only
  // once it is closed does Escape reach the open record. Two listeners would
  // both fire on one Escape and close both at once.  Bound only while something
  // IS open, and removed with it. The table's own ↑↓ is a LOCAL handler on the
  // table rather than a third document listener, so it cannot reach either.
  useEffect(() => {
    if (!detailOpen && !tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (tourOpen) {
        if (e.key === 'Escape') setTourIdx(-1)
        if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
        if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
        return
      }
      if (e.key === 'Escape') setSelected(null)
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
  // 次へ, so Enter walks the ring exactly as the arrows do; closing it puts
  // focus back on the ? it came from, rather than dropping the reader at the top
  // of the document. `wasOpen` is what keeps the close half from firing on the
  // first render, when nothing was open and nothing should move.
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

  const footnoteId = current ? `krFootnote-${current.id}` : undefined

  /** A refused control, spelled ONCE. `aria-disabled` rather than `disabled`:
   *  the control stays focusable so its reason is reachable by keyboard and
   *  screen reader — the shell's own standing-hint treatment, one step better.
   *  The reason rides the ACCESSIBLE NAME as well as the title, because a
   *  screen reader drops `title` once `aria-describedby` is present.
   *
   *  ⚠ THE CLASSES ARE MERGED HERE, and a call site must never write `className`
   *  after this spread. It used to: both ✎ pencils wrote `className="kr-pencil"`
   *  after `{...refused(...)}`, the later JSX prop won, and `.btn` never reached
   *  the DOM — so the room's most-repeated refusal was the ONLY one that did not
   *  look refused (measured: `cursor: pointer` on a refused control, no dim, no
   *  border, UA `ButtonFace`, and the amber "a person rewrote this" pencil
   *  painting a border-color onto a border that did not exist). Fixed at the
   *  helper so it cannot recur (F-K1). */
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
      // LAST, and after the spread: a caller passes its classes IN, and cannot
      // write `className` over the merge afterwards.
      className: ['btn', className].filter(Boolean).join(' '),
    }
  }

  return (
    <div className={`${ROOT}${detailOpen ? ' is-detail' : ''}`} ref={rootRef}>
      {/* STEP 0. The head declares itself like every other section, so the walk
          opens on what this page is FOR before it starts pointing at parts of
          it — which is where the standing explainer paragraph went. */}
      <header
        className="kr-head"
        data-guide-title="カルテ"
        data-guide="この店舗で行った施術の記録が、新しい順に並ぶ画面です。カルテはスマホのアプリで施術中に作られ、この画面はそれを読み返すためのものです。行を選ぶと1件の中身が開きます。"
      >
        <div className="kr-eyebrow">{props.dateline}</div>
        <div className="kr-titleline">
          <h1>カルテ</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one 今日の運営
              has: a spotlight walk of everything on this screen, and during the
              walk you can tap any part of the page to jump straight to what it
              is. A hairline circle, never a filled one (⚖ R13). */}
          <button
            className="kr-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="krTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
        </div>
        <p className="kr-subtitle">{props.subtitle}</p>
        {/* ⚖ THE HONEST STATUS LINE (§7a) + ⚖ self-explaining numbers: three
            labelled facts, each saying WHAT it counts — the store's real month
            census, how many records the current narrowing matches, and how many
            of those the walk has actually put on screen.
            ⚠ 条件に一致 IS THERE BECAUSE TWO NUMBERS WERE NOT ENOUGH. 「今月 30件・
            表示中 200件」 is what the 200-record world printed on the first probe
            run: both figures were true, and side by side they read as a
            contradiction, because 今月 is a MONTH and 表示中 is a LIST. The
            middle number is what 表示中 is a fraction OF, so the pair stops
            inviting a comparison it was never making.
            It is `matched.length` — the SAME call the pressed chip's own count
            reads, rendered twice rather than counted twice (⚖ A8). */}
        <p className="kr-status" role="status" aria-live="polite">
          {props.monthLabel}・条件に一致 {matched.length}件・表示中 {visible.length}件
        </p>
      </header>

      {props.noticeLines.length > 0 && (
        <section
          className="kr-notice"
          aria-label="この画面の見え方"
          data-guide-title="この画面の見え方"
          data-guide="この画面で見えるもの・見えないものの説明です。文字起こしの扱いは店舗の設定で決まり、破棄されたカルテの中身は店舗管理者だけが確認できます。"
        >
          {props.noticeLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      )}

      {/* ═══ THE TABLE — one screen at a time (⚖ D2) ═══ */}
      <div className="kr-list-view">
        <section
          className="kr-scope"
          aria-label="担当でしぼる"
          data-guide-title="担当でしぼる"
          data-guide="自分が担当したカルテだけに絞り込めます。数字はそのまま件数で、押すと表がその件数ぶんに切り替わります。"
        >
          <span className="kr-label">担当</span>
          <div className="kr-chips" role="group" aria-label="担当でしぼる">
            <button
              className="kr-chip"
              type="button"
              aria-pressed={scope === 'all'}
              onClick={() => narrow(() => setScope('all'))}
            >
              全スタッフ <b>{scopeCounts.all}</b>件
            </button>
            <button
              className="kr-chip"
              type="button"
              aria-pressed={scope === 'self'}
              onClick={() => narrow(() => setScope('self'))}
            >
              {props.selfLabel} <b>{scopeCounts.self}</b>件
            </button>
          </div>
        </section>

        <section
          className="kr-search"
          aria-label="カルテを探す"
          data-guide-title="カルテを探す"
          data-guide="顧客名・かな・顧客番号・カルテ番号・サービス・スタッフの6つで探せます。ひらがなでもカタカナでも、番号のハイフンがあってもなくても同じように見つかります。記録の中身は検索の対象ではありません。"
        >
          <input
            type="search"
            className="kr-input"
            value={query}
            placeholder="顧客名・かな・顧客番号・カルテ番号・サービス・スタッフで検索"
            aria-label="顧客名・かな・顧客番号・カルテ番号・サービス・スタッフで検索"
            onChange={(e) => narrow(() => setQuery(e.target.value))}
          />
          <button className="btn" type="button" onClick={clearFilters}>
            条件をクリア
          </button>
        </section>

        {/* QUIET TEXT, not buttons: a filter narrows a view, it does not act, so
            it gets no border and no fill — selected is an accent label plus a
            2px accent underline. The strip wraps rather than panning, so no
            container here owns an axis (⚖ page-scroll). */}
        <section
          className="kr-filters"
          aria-label="状態でしぼる"
          data-guide-title="状態でしぼる"
          data-guide="カルテの状態で絞り込む行です。件数はそのまま、押したときに表に出る件数と同じです。今週は月曜はじまりの今週ぶんを指します。"
        >
          <span className="kr-label">状態</span>
          <div className="kr-chips" role="group" aria-label="状態でしぼる">
            {props.filters.map((f) => (
              <button
                key={f.key}
                className="kr-filter"
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => narrow(() => setFilter(f.key))}
              >
                {f.label} <b>{filterCounts.get(f.key) ?? 0}</b>件
              </button>
            ))}
          </div>
        </section>

        {props.rows.length === 0 ? (
          <section
            className="kr-zero"
            aria-label="カルテがありません"
            data-guide-title="カルテがありません"
            data-guide="この店舗にはまだ1件もカルテがありません。カルテはスマホのアプリで施術中に作られ、保存されるとこの一覧に並びます。"
          >
            <div className="kr-zero-card">
              <strong>この店舗のカルテはまだありません</strong>
              <p>カルテはスマホのアプリで施術中に作られます。保存されると、新しい順にここへ並びます。</p>
            </div>
          </section>
        ) : (
          <section
            className="kr-table-sec"
            aria-labelledby="krTableTitle"
            data-guide-title="カルテの一覧"
            data-guide="施術の記録が新しい順に並びます。日付・お客様・状態・サービス・担当の5列で、行を押すとその1件が開きます。上下の矢印キーでも行を移動でき、Enterでその1件が開きます。破棄されたカルテも灰色のまま残ります。"
          >
            <h2 className="kr-sec-title" id="krTableTitle">
              カルテの一覧
            </h2>
            {/* ⚖ THE PAGE OWNS EVERY AXIS (page-scroll law). No height cap and no
                overflow of any kind anywhere in this room — the five columns are
                minmax()-based and WRAP rather than pan, which is what the room's
                own ladder measured (deviation K-9: the pan the packet asked for
                engaged by 4px in the tightest reachable state, so it is gone
                rather than shipped as a lever nobody can operate). */}
            <div className="kr-table" onKeyDown={walkRows}>
                {/* Column names for a sighted reader. `aria-hidden` because the
                    rows are BUTTONS rather than table cells: a screen reader
                    reads each row as one item, and each row's accessible name
                    spells these same five facts in this same order — so the
                    header would be read twice, once as a promise the row
                    structure does not keep. */}
                <div className="kr-thead" aria-hidden="true">
                  <span>日付</span>
                  <span>お客様</span>
                  <span>状態</span>
                  <span>サービス</span>
                  <span>担当</span>
                </div>
                {visible.length === 0 ? (
                  <div className="kr-empty">
                    <strong>条件に一致するカルテがありません</strong>
                    <span>検索語や絞り込みを見直してください。</span>
                    <button className="btn" type="button" onClick={clearFilters}>
                      条件をクリア
                    </button>
                  </div>
                ) : (
                  visible.map((r) => (
                    <button
                      key={r.id}
                      // The row's id is how ← finds its way back to it: the row
                      // is gone from the screen by the time focus has to return,
                      // so the reference has to survive the swap.
                      id={`krRow-${r.id}`}
                      type="button"
                      className={`kr-row${r.state === 'discarded' ? ' is-discarded' : ''}`}
                      aria-label={`${r.dateLabel} ${r.customerName}様 ${r.stateLabel} ${r.service} 担当 ${r.staffName} — カルテを開く`}
                      onClick={() => {
                        openedFrom.current = `krRow-${r.id}`
                        setSelected(r.id)
                      }}
                    >
                      <span className="kr-c-date">{r.dateLabel}</span>
                      <span className="kr-c-cust">
                        <span className={`kr-mark${r.mark.length > 2 ? ' long' : ''}`} aria-hidden="true">{r.mark}</span>
                        <span className="kr-cust-text">
                          <span className="kr-name">{r.customerName}様</span>
                          <span className="kr-ids">
                            {r.id} ／ {r.memberNumber}
                            {r.furigana ? ` ／ ${r.furigana}` : ''}
                          </span>
                          {/* ⚖ SILENT FAILURE IS A BUG: an empty preview says
                              WHICH of the four reasons it is, never a blank. */}
                          <span className={`kr-preview${r.preview ? '' : ' is-none'}`}>
                            {r.preview ?? r.previewFallback}
                          </span>
                        </span>
                      </span>
                      <span className="kr-c-state">
                        <span className={r.statePill}>{r.stateLabel}</span>
                      </span>
                      <span className="kr-c-service">{r.service}</span>
                      <span className="kr-c-staff">{r.staffName}</span>
                    </button>
                  ))
                )}
                {walk.hidden > 0 && (
                  <div
                    className="kr-more"
                    data-guide-title="さらに表示"
                    data-guide="この一覧は新しい日付から順に、2週間ぶんずつさかのぼって読み込みます。押すと、さらに前の期間のカルテが下に追加されます。"
                  >
                    <button className="btn" type="button" onClick={() => setSteps((s) => s + 1)}>
                      さらに表示（あと{walk.hidden}件）
                    </button>
                  </div>
                )}
            </div>
          </section>
        )}

        {/* ⚖ §7a — ONE QUIET REVEAL ROW, and only while searching. A records
            page shows records; a person with none is not a row in the table. */}
        {searching && revealed.length > 0 && (
          <section
            className="kr-reveal"
            aria-label="カルテのないお客様"
            data-guide-title="カルテのないお客様"
            data-guide="検索した名前に、この店舗のカルテがまだないお客様がいるときだけ出る行です。まだ施術の記録がない、という意味で、一覧そのものには並びません。"
          >
            <span className={`kr-mark${revealed[0].mark.length > 2 ? ' long' : ''}`} aria-hidden="true">{revealed[0].mark}</span>
            <span className="kr-reveal-text">
              <strong>{revealed[0].name}様</strong>
              <span>
                {revealed[0].memberNumber}
                {revealed[0].furigana ? ` ／ ${revealed[0].furigana}` : ''} — この店舗のカルテはまだありません
                {revealed.length > 1 ? `（ほか${revealed.length - 1}名）` : ''}
              </span>
            </span>
            <Link className="btn" href={revealed[0].customersHref}>
              {CUSTOMERS_LABEL}
            </Link>
          </section>
        )}
      </div>

      {/* ═══ THE RECORD ═══ */}
      {current && (
        <div className="kr-detail">
          {/* ⚖ THE DESIGN ROUND — the phone's own `DetailBreadcrumb` shape: where
              this record sits, said in words, with ← カルテ一覧 on the far side.
              ⚠ THE MIDDLE CRUMB IS TEXT, NOT A LINK, and deliberately (K-22).
              The mock draws it as a link to the person's own page; Business has
              no customer-profile page yet, so a link would either go somewhere
              that does not exist or quietly land on the 顧客 LIST while naming
              one person — a crumb that lies about its own destination. The one
              link here is 顧客, which really is the list, and it spends the same
              href every other 顧客 pointer in this room spends (⚖ A8). */}
          <nav
            className="kr-crumb"
            aria-label="いまいる場所"
            data-guide-title="いまいる場所"
            data-guide="いま開いているカルテが、どのお客様のどの日の記録かを示す行です。左の「顧客」から顧客一覧へ戻れます。右の「カルテ一覧」を押すと、さっきの表に戻ります。"
          >
            <Link href={current.customersHref}>顧客</Link>
            <Icon name="chevron" size={14} />
            {/* ⚠ NO 様 IN THE CRUMB, and the mock is deliberate about it (DL-6):
                a breadcrumb NAMES the thing you are inside, it does not address
                the person. The heading below, which is where the room speaks to
                the customer, keeps 様 — as the mock does on the very same
                screen. */}
            <span className="kr-crumb-who">
              {current.customerName} <span className="kr-crumb-no">{current.memberNumber}</span>
            </span>
            <Icon name="chevron" size={14} />
            <span className="kr-crumb-cur">カルテ {current.dateLongLabel}</span>
            <button className="kr-back" type="button" ref={backRef} onClick={() => setSelected(null)}>
              ← カルテ一覧
            </button>
          </nav>

          <div className="kr-topband">
            {/* ⚖ THE PERSON HEADER IS THE CUSTOMER-PROFILE IDENTITY HEADER, one
                structure for the family (Liam 8/23 final): avatar, name with the
                カルテ番号 beside it, a wrapping meta row, the contact row, the
                担当 line, and a top-right action slot — the same skeleton as the
                phone's `CustomerHeaderCard`, which is itself the exact clone of
                `CustomerIdentityCard`. Business has no customer-profile header
                yet; this is the one the 顧客 room adopts in the sweep (K-6). */}
            <section
              className="kr-identity"
              aria-labelledby="krIdentityName"
              data-guide-title="お客様とカルテ"
              data-guide="このカルテのお客様と、記録そのものの情報です。名前の横がカルテ番号と状態、その下が来店回数・前回のご来店・この施術日、さらに下が連絡先です。"
            >
              <div className="kr-id-row">
                <span className={`kr-avatar${current.mark.length > 2 ? ' long' : ''}`} aria-hidden="true">{current.mark}</span>
                <div className="kr-id-main">
                  <div className="kr-id-nameline">
                    <h2 id="krIdentityName">{current.customerName}様</h2>
                    <Icon name="chevron" size={14} />
                    <span className="kr-id-no">{current.id}</span>
                    <span className={current.statePill}>{current.stateLabel}</span>
                  </div>
                  <div className="kr-id-meta">
                    <span><Icon name="visits" />{current.visitLabel}</span>
                    {current.lastVisitLabel && <span><Icon name="heart" />前回 {current.lastVisitLabel}</span>}
                    <span><Icon name="calendar" />施術日 {current.dateLongLabel} {current.timeLabel}</span>
                  </div>
                  <div className="kr-id-meta kr-contact">
                    {current.phone && (
                      <span><Icon name="phone" /><a href={`tel:${current.phone}`}>{current.phone}</a></span>
                    )}
                    {current.email && (
                      <span><Icon name="mail" /><a href={`mailto:${current.email}`}>{current.email}</a></span>
                    )}
                    <span><Icon name="user" />顧客番号 {current.memberNumber}</span>
                    {current.furigana && <span>{current.furigana}</span>}
                  </div>
                  <div className="kr-id-staff">
                    担当 <b>{current.staffName}</b> ・ {current.service} ・ 予約 {current.bookingNo}
                  </div>
                </div>
                <div className="kr-id-actions">
                  <Link className="btn" href={current.customersHref}>
                    {CUSTOMERS_LABEL}
                  </Link>
                  {/* ⚖ カルテの顧客変更 (registry ②). RIGHTS-GATED AND HIDDEN, never
                      shown-and-refused: a staff member without the capability does
                      not see it at all, exactly as the phone hides
                      `ReassignCustomerAction`. Canon's quiet ⇆ glyph — no pill, no
                      border, no fill (Liam 8/23: "just the blue arrow thing"). */}
                  {props.canReassign && (
                    <button
                      className="kr-swap"
                      type="button"
                      aria-label="顧客を変更"
                      title="顧客を変更"
                      aria-expanded={reassignOpen}
                      aria-controls="krReassign"
                      onClick={() => setReassignOpen((o) => !o)}
                    >
                      <Icon name="swap" size={18} />
                    </button>
                  )}
                </div>
              </div>
              {/* THE WARNING STEP, disclosed in place — no dialog, nothing to
                  outrun (⚖ 47). The flow's next step is a store-scoped picker and
                  an honest confirm that writes an audit row from→to; both land at
                  RECONNECT, so the walk stops HERE and says so. */}
              {props.canReassign && reassignOpen && (
                <div className="kr-warn" id="krReassign" role="group" aria-label="カルテを別の顧客へ変更">
                  <strong>カルテを別の顧客へ変更</strong>
                  {REASSIGN_WARNING.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  <div className="kr-warn-foot">
                    <button {...refused('続ける', props.refusals.reassign)}>続ける</button>
                    <button className="btn" type="button" onClick={() => setReassignOpen(false)}>
                      戻る
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* ⚖ THE DESIGN ROUND — 結果 IS THE HEADER'S RIGHT SHOULDER. A person
                reading records at a desk checks three things first: whose, when,
                and how it ended. The mock puts all three at one height, so the
                third stops being a card the reader has to scroll to.
                破棄済み records carry no outcome for ANY reader (⚖ R2 — a
                discarded record feeds no number), so the section is not there to
                be explained and drops out of the walk by itself. */}
            {!current.discard && (
              <section
                className="kr-outcome"
                aria-labelledby="krOutcomeTitle"
                data-guide-title="セッションの結果"
                data-guide="この施術がどう終わったかの記録です。成約と不成約は成約率に入り、通常ご来店は入りません。仮カルテのままだと14日後に自動で不成約になります。"
              >
                <h2 className="kr-sec-title" id="krOutcomeTitle">セッションの結果</h2>
                <div className="kr-outcome-body">
                  <span className={current.outcomePill}>{current.outcomeLabel}</span>
                  <button {...refused('結果を変更', props.refusals.outcome, { 'aria-describedby': footnoteId! })}>
                    <Icon name="pencil" />結果を変更
                  </button>
                </div>
                {current.outcomeNote && <p className="kr-note">{current.outcomeNote}</p>}
                {current.ticketLine && (
                  <p className="kr-note kr-ticket"><Icon name="ticket" />{current.ticketLine}</p>
                )}
              </section>
            )}
          </div>

          {/* ⚖ THE DESIGN ROUND — THE STICKY CONTEXT STRIP. Reading one record on
              a computer means scrolling past a person's name and then reading
              four cards without it; the strip keeps 「誰の・どの日か」 on screen
              the whole way down, and carries the record's own 目次 beside it.
              It parks under the shell's 62px topbar rather than at the viewport
              top (business-shell.css:146-149), and it owns NO scroller of its own
              — the page still owns every axis (⚖ page-scroll). */}
          <section
            className="kr-strip"
            ref={stripRef}
            aria-label="この記録の中を移動"
            data-guide-title="この記録の中を移動"
            data-guide="下へ読み進んでも上に残る帯です。左が「誰のどの日のカルテか」、右がこの1件の目次で、押すとその場所へ飛びます。目次にはこの記録にある項目だけが出るので、記録が少ないカルテでは目次も短くなります。"
          >
            <span className="kr-strip-ctx">
              {current.customerName}様 <span className="kr-strip-no">{current.id}</span>
              <span className="kr-strip-d">・ {current.dateLongLabel}</span>
            </span>
            <span className="kr-strip-label">この中を移動</span>
            <span className="kr-jumps">
              {toc.map((t) => (
                <a
                  key={t.id}
                  className="kr-jump"
                  href={`#${t.id}`}
                  aria-current={here === t.id ? 'location' : undefined}
                  onClick={() => setHere(t.id)}
                >
                  {t.label}
                </a>
              ))}
            </span>
          </section>

          {/* ⚖ 破棄 (Liam 8/20). The row is kept, in full, for everyone — and
              what a reader may READ of it is the only thing that changes.
              ⚠ AND IT STAYS GRAY (K-23). The mock draws a gold-bordered banner
              here; the mock never had a discarded record to draw, and ⚖ Liam
              8/25 ruling B is explicit that 破棄済み is a plain fact and never a
              warning colour — a staffer must never hesitate to throw away a
              genuinely bad take to protect a row's colour. The ruling wins. */}
          {current.discard && (
            <section
              className="kr-discarded"
              id="krSecDiscard"
              aria-label="破棄されたカルテ"
              data-guide-title="破棄されたカルテ"
              data-guide="このカルテは破棄されています。破棄しても記録は消えず、一覧にも灰色のまま残ります。破棄した人・日時と、その理由は店舗管理者が確認できます。"
            >
              <strong><Icon name="trash" size={13} />このカルテは破棄されています</strong>
              <p>
                {current.discard.whenLabel} ・ {current.discard.by}
              </p>
              {current.discard.reason ? (
                <p className="kr-discard-reason">理由: {current.discard.reason}</p>
              ) : (
                <p className="kr-discard-reason">破棄の理由と記録の内容は、店舗管理者のみが確認できます。</p>
              )}
              <p className="kr-discard-note">
                破棄されたカルテは、成約率・回数券の消化・AIの学習には使われません。記録として残るだけです。
              </p>
              {/* ⚖ 8/20 build requirement (b) — R2 keeps this record out of every
                  number, and money never auto-reverses, so the manager who owns
                  the correction has to be told it is owed. Manager-gated above
                  the serializer (F-K6). */}
              {current.discard.ticketNote && (
                <p className="kr-discard-ticket">{current.discard.ticketNote}</p>
              )}
            </section>
          )}

          {/* FACTS LEFT, EVIDENCE RIGHT — the template's grammar, and also the
              phone's own two-column split, so a staff member reading one record
              through two doors finds the same things in the same places. */}
          <div className="kr-grid">
            <div className="kr-col">
              <section
                className="kr-card kr-session"
                id="krSecSession"
                aria-labelledby="krSessionTitle"
                data-guide-title="本日のセッション"
                data-guide="施術中に記録された内容が、決まった8つの引き出しに分かれて並びます。引き出しごとに決まった色がつき、行頭の点も同じ色です。「手書き」がついているものはスタッフが自分で書いた内容で、AIの再生成では上書きされません。"
              >
                <div className="kr-cardhead">
                  <h2 className="kr-sec-title" id="krSessionTitle">本日のセッション</h2>
                  <button {...refused('AIで再生成', props.refusals.regenerate, { 'aria-describedby': footnoteId! })}>
                    <Icon name="redo" />AIで再生成
                  </button>
                  <span className="kr-tail">{current.dateLongLabel}</span>
                </div>
                {drawers.length === 0 ? (
                  <p className="kr-none">
                    {current.discard
                      ? '記入内容は店舗管理者のみが確認できます。'
                      : 'このカルテにはまだ何も記入されていません。'}
                  </p>
                ) : (
                  /* ⚖ TWO COLUMNS, FLOWED (the desk's call). The drawers hold
                     wildly different amounts, so one tall stack leaves a column
                     of white after every short one. `column-count` FLOWS them —
                     each drawer stays whole (`break-inside: avoid`) and the eye
                     sweeps left-right instead of scrolling past gaps. The colour
                     is what makes two columns readable rather than confusing. */
                  <div className="kr-cats">
                    {drawers.map((d) => (
                      <div className="kr-cat" key={d.category} data-cat={d.category}>
                        <div className="kr-cat-head">
                          <span className="kr-cat-chip">{d.label}</span>
                          {/* ⚖ SELF-EXPLAINING, AND ONLY WHEN IT SAYS SOMETHING.
                              「気になる点 1」 is noise on a drawer holding one
                              line; from two up, the number is the reader's cue
                              that there is more than the first line. */}
                          {d.lines.length > 1 && <span className="kr-cat-count">{d.lines.length}件</span>}
                        </div>
                        <ul className="kr-lines">
                          {d.lines.map((e, i) => (
                            <li key={`${e.category}-${i}`}>
                              <span className="kr-dot" aria-hidden="true" />
                              <span className="kr-line-text">{e.text}</span>
                              {e.handwritten && <span className="kr-hand">手書き</span>}
                              <button
                                {...refused(`${e.label}を編集`, props.refusals.entry, {
                                  'aria-describedby': footnoteId!,
                                  className: 'kr-pencil',
                                })}
                              >
                                <Icon name="pencil" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="kr-col">
              <section
                className="kr-card kr-summary"
                id="krSecSummary"
                aria-labelledby="krSummaryTitle"
                data-guide-title="詳細記録"
                data-guide="記入内容からAIがまとめた要約です。カードの頭の水色の帯と書類のしるしは、スマホと同じ目印です。スタッフが書き直した場合はえんぴつが琥珀色になり、下の履歴に誰がいつ直したかが残ります。"
              >
                <div className="kr-band">
                  <Icon name="file" size={14} />
                  <h2 className="kr-sec-title" id="krSummaryTitle">詳細記録</h2>
                  <span className="kr-tail">{current.dateLongLabel}</span>
                  <button
                    {...refused('詳細記録を編集', props.refusals.summary, {
                      'aria-describedby': footnoteId!,
                      className: `kr-pencil${current.summaryEdited ? ' is-edited' : ''}`,
                    })}
                  >
                    <Icon name="pencil" />
                  </button>
                </div>
                {current.summaryBullets.length === 0 ? (
                  <p className="kr-none">{current.previewFallback}</p>
                ) : (
                  <ul className="kr-bullets">
                    {current.summaryBullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
              </section>

              {current.aiMessage && (
                <section
                  className="kr-card kr-message"
                  id="krSecMessage"
                  aria-labelledby="krMessageTitle"
                  data-guide-title="AI提案メッセージ"
                  data-guide="施術のあとにお送りする文面の下書きです。帯の右に、誰にどの手段で送る予定かが出ます。送信は止めてありますが、何が送られる予定だったのかは隠さずに出します。"
                >
                  <div className="kr-band">
                    <Icon name="message" size={14} />
                    <h2 className="kr-sec-title" id="krMessageTitle">AI提案メッセージ</h2>
                    <span className="kr-tail">
                      {current.customerName} ・ 送信予定 <span className="kr-channel">LINE</span>
                    </span>
                  </div>
                  {/* Shown, then refused. Hiding what the room WOULD send would
                      make the refusal unreadable — ⚖ 47 asks the opposite. */}
                  <p className="kr-draft">
                    {current.customerName}様、{current.aiMessage}
                  </p>
                  <div className="kr-act-row">
                    <button {...refused('編集', props.refusals.message, { 'aria-describedby': footnoteId! })}>
                      <Icon name="pencil" size={13} />編集
                    </button>
                    <button {...refused('承認して送信', props.refusals.send, { 'aria-describedby': footnoteId!, className: 'kr-commit' })}>
                      <Icon name="send" size={14} />承認して送信
                    </button>
                  </div>
                </section>
              )}

              {/* 写真記録 — captions and counts, from the record's own facts. The
                  viewer and the before/after comparison are registry ③, so the
                  tile refuses with its reason rather than opening nothing. */}
              {current.photos.length > 0 && (
                <section
                  className="kr-card kr-photos"
                  id="krSecPhotos"
                  aria-labelledby="krPhotosTitle"
                  data-guide-title="写真記録"
                  data-guide="このセッションで撮影した写真の記録です。いまは枚数と説明だけを表示しています。全期間の写真は顧客のページにまとまります。"
                >
                  <div className="kr-band">
                    <Icon name="image" size={14} />
                    <h2 className="kr-sec-title" id="krPhotosTitle">写真記録</h2>
                    <span className="kr-tail">{current.photoCountLabel}</span>
                  </div>
                  <ul className="kr-photo-list">
                    {current.photos.map((p, i) => (
                      <li key={i}>
                        <button {...refused(`${p.category} ${p.caption}`, props.refusals.photo, { className: 'kr-photo' })}>
                          <span className="kr-photo-cat">{p.category}</span>
                          <span className="kr-photo-cap">{p.caption}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ⚖ OPEN, NOT FOLDED (the desk's call, approved with the mock).
                  The phone collapses this card because a phone is narrow; the
                  content is two sentences, and asking a reader at a desk to
                  press something to see two sentences buys nothing. */}
              <section
                className="kr-card kr-recording"
                id="krSecRecording"
                aria-labelledby="krRecordingTitle"
                data-guide-title="録音 ・ 文字起こし"
                data-guide="この施術に録音があるかどうかと、録音の同意が確認できているかどうかです。文字起こしそのものの閲覧は店舗の設定で決まる仕組みで、この画面にはまだつないでいません。"
              >
                <div className="kr-band">
                  <Icon name="mic" size={14} />
                  <h2 className="kr-sec-title" id="krRecordingTitle">録音 ・ 文字起こし</h2>
                  {current.consentLabel && (
                    <span className="kr-consent"><Icon name="check" size={11} weight={2.5} />{current.consentLabel}</span>
                  )}
                </div>
                <div className="kr-card-body">
                  <p className="kr-note">{current.recordingLine}</p>
                  {/* ⚖ Liam 8/30 D3 — the honest line, and never a hardcoded rule
                      about who may read a transcript. The room opens no transcript
                      door in either mode of the setting (registry ⑤). */}
                  <p className="kr-note">文字起こしの閲覧は店舗の設定に従います（未接続）。</p>
                </div>
              </section>
            </div>
          </div>

          {/* THE STANDING REFUSAL, in ONE line, on screen before anyone reaches
              for a control. It changes nothing and it stays — no toast, no
              flash, nothing to outrun (⚖ 47). Each control also carries its own
              specific reason and points here with aria-describedby. */}
          <p className="kr-footnote" id={footnoteId}>
            {props.actionFootnote}
          </p>

          {/* 記録の履歴 — full width beneath the pair, newest first, and the
              direction stated. A record's own history: what was edited, and — on
              a discarded record — the discard itself, which is the entry a
              manager is looking for when they open one. */}
          <section
            className="kr-card kr-history"
            id="krSecHistory"
            aria-labelledby="krHistoryTitle"
            data-guide-title="記録の履歴"
            data-guide="このカルテに対して行われたことの記録です。新しいものが上で、要約を直した記録や破棄した記録が残ります。"
          >
            <div className="kr-band">
              <Icon name="clock" size={14} />
              <h2 className="kr-sec-title" id="krHistoryTitle">記録の履歴</h2>
              <span className="kr-tail">新しい順</span>
            </div>
            {current.history.length === 0 ? (
              <p className="kr-none">このカルテの操作履歴はまだ記録されていません。</p>
            ) : (
              <div className="kr-hist-rows">
                {current.history.map((h, i) => (
                  <div className="kr-hist-row" key={i}>
                    <time>{h.when}</time>
                    <span>
                      <strong>{h.what}</strong>
                      <span>{h.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the board's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. The hole is one big
          box-shadow rather than a moved element, so the region stays fully lit
          and nothing on the page is re-laid-out to explain it — and no layer
          owns a scroller, so the ⚖ page-scroll ruling is untouched. */}
      {tourOpen && (
        <>
          <div
            className="kr-spot-catch"
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
              className="kr-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="kr-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="kr-spot-card"
            id="krTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="kr-spot-text">{tourStep?.text ?? ''}</span>
            <div className="kr-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="kr-spot-foot">
              <button type="button" className="kr-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="kr-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="kr-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="kr-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

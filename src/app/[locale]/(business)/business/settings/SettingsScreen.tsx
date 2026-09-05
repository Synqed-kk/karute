'use client'

// 設定 — the room every other room's dial was promised to.
//
// ⚖ ONE PAGE, ONE SECTION AT A TIME. canon's settings family is nineteen pages
// behind a category rail; this is that rail with the panel beside it, so a reader
// never scrolls past a setting they did not come for. The rail carries canon's
// own five groups and canon's own labels, because canon's IA is the product's IA
// and a rail that changes shape between releases is a rail nobody learns.
//
// ⚖ EVERYTHING MOVES (Liam 2026-09-01). Every control on this page is LIVE: it
// changes when it is pressed, the section it belongs to goes dirty, 保存 commits
// it, and a preview sentence beside it is rewritten from the new value. The
// honesty is ONE footnote per store section — 「保存はこの画面の中だけに反映され
// ます」 — plus the page's own サンプルデータ dateline, instead of a refusal
// paragraph under every row.
//
// ══ WHAT THE S17 STUDIO ROUND CHANGED, AND THE ONE JOB EACH CHANGE DOES ═════
//
// The room worked and read badly: a 「設定カテゴリー」 card head over a rail that
// was already obviously a rail, twenty-two rows and 300-odd controls with no way
// to find one by name, four guardrail lines under every dial so the dial itself
// was the smallest thing on its row, and a trace card holding the whole right
// column to say where five numbers came from. Five changes, each aimed at one of
// those (the Studio mock `SETTINGS-MOCK-v1.html` is the spec for all five):
//
//   1. ONE compact head, and FIND BY TYPING. The eyebrow, 設定, the ? and the
//      one-line subtitle share one row; the rail starts under it with a 設定を検索
//      field that filters rail rows AND the block titles inside them. The index
//      is `props.sections`' own data (`searchTextOf`), so there is no second list
//      to keep in step.
//   2. A ROW READS AS ONE SENTENCE. Label + scope + a one-line description are
//      always visible with the control beside them; the 初期値 · guardrail · 業種
//      · 出どころ lines fold VERBATIM behind a per-row 詳しく. Nothing was cut —
//      the guardrail a manager needs when they are changing the dial is one press
//      away instead of standing between two dials the rest of the time.
//   3. THE RIGHT COLUMN EARNS ITS WIDTH. The trace card leaves it; what stands
//      there is このページの中身 (this section's blocks, the one in view
//      highlighted, a dot on any block holding an unsaved change) and the save
//      state. 色・テーマ's 67 controls and スタッフ管理's 57 are navigable for the
//      first time. Every receipt that named a ROW moved into that row's 詳しく.
//   4. 予約と確保 IS A NATIVE SECTION. #812's presets, its live スタッフが見るカード
//      and its eight dials render in this room's own grammar, with its card in the
//      sticky stack and its own 保存 block in the save slot (⚖ A3).
//   5. EVERY SCREEN SIZE, AND APPLE-GRADE MOTION. Three compositions (side column
//      · strip · list-is-the-page) and ONE spring (`makeSpring`) driving every
//      thumb, height and rise — never a second easing.
//
// WHAT IS CLIENT STATE HERE: every control's value, what was last saved, which
// section is open, the search query, which 詳しく are open, whether the phone is
// showing the list or the section, the result line of a block's action, and which
// step of the 画面の説明 tour the reader is on. 自分の表示設定 is the one section
// whose values ALSO persist — to this browser's own storage, for this reader,
// because a personal preference is nobody else's permission.
//
// CLASS NAMES ARE PREFIXED `st-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and the
// neighbours state BARE `.biz .<name>` rules on the exact names a settings page
// would want (`.panel`, `.card`, `.row`, `.chip`, `.seg`, `.switch`…). A fence
// that enumerates shared names rots as the neighbours grow; not colliding at all
// cannot. `page` / `h1` / `btn` are the SHELL's and restated here, so those three
// are fenced in settings.css at four levels.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import { makeSpring } from '@/business/lib/spring'
import { Collapse, DetailToggle } from './Collapse'
import { StorePolicySection, STORE_POLICY_ANCHORS, STORE_POLICY_HEADINGS, type StorePolicyProps } from './StorePolicySection'
import {
  addToCollection,
  blockDirty,
  hitOf,
  blockingError,
  changedCount,
  commitNumber,
  controlIdsOf,
  fillTemplate,
  keepCardOffHeading,
  labelOfValue,
  matchesQuery,
  PREFS_DEFAULT,
  readPrefs,
  rowsOfBlock,
  searchTextOf,
  sectionDirty,
  type CollectionRows,
  type ControlKind,
  type RailRow,
  type RowControl,
  type RowValue,
  type SettingsBlock,
  type SettingsProps,
  type SettingsRow,
  type SettingsSection,
} from '@/business/lib/settings'

/** THE ROUTE WRAPPER. Every rule in settings.css is scoped under this class, and
 *  `.page.pg-settings` (four levels) rather than `.pg-settings` (three) so a
 *  sibling's own three-level rule (`.biz .page .btn`, customers.css) cannot win
 *  the room back on insertion order. */
const ROOT = 'page pg-settings'

/** ⚖ R6-20, CARRIED (room 6's `Overlay`, room 8's tour). A dismiss-by-backdrop
 *  surface that mounts under a pointer already resting where its opener was will
 *  eat the SECOND press of a double-click and close itself instantly — and
 *  neither 「the press began on the backdrop」 nor 「the browser called it a
 *  double-click」 can separate that press from a decision, because both are true
 *  of it. 500ms is the platform's own double-click interval (macOS and Windows
 *  defaults), so the window in which a second press still belongs to the first
 *  gesture is covered by construction rather than by a number chosen to fit a
 *  test. The tour is this room's only such surface. */
const SETTLE_MS = 500

/** ⚖ S17 — the ONE section whose panel is not built from this file's block
 *  vocabulary: #812's 予約と確保 renders itself (A1) and brings its own 保存 bar
 *  (A3). Named once so the three places that ask are asking the same question,
 *  and `settings.ts`'s RAIL is where the id itself is declared. */
const BOOKING_GUARD_ID = 'booking-guard'

/** ⚖ S17 · F13 — the search terms of the ONE section that renders itself. Asked
 *  exactly the way the scroll-spy asks for its anchors, so 予約と確保 is one
 *  special case in this file rather than two. */
const termsFor = (id: string): readonly string[] | undefined =>
  (id === BOOKING_GUARD_ID ? STORE_POLICY_HEADINGS : undefined)

/** 自分の表示設定's home. Versioned in the name so a later shape change cannot
 *  read an older one's value. */
const PREF_KEY = 'synqedBizDisplayPrefs.v1'
const DENSITY_ID = 'my-display.density'
const EMPHASIS_ID = 'my-display.emphasis'

/** ⚖ THE STUDIO MOTION STANDARD, ONE RESPONSE PER JOB (apple-design §2). The
 *  house default is 0.30s critically damped — thumbs and the save card's rise;
 *  a height panel gets 0.34 because it travels further and a fast height reads
 *  as a jump rather than as an opening. No third number, and no second easing:
 *  `makeSpring` is the room's only integrator (`spring.ts` is FROZEN, reused). */
const SPRING_THUMB = 0.3
/** ⚖ S17 fix round 1 · F16 — the panel's arrival. Slower than a thumb because
 *  it is the whole reading column moving, still well under a beat: ⚖ apple-
 *  design's 「response is how quickly the value reaches the target, not a
 *  duration」, damping 1.0 like everything else in this room. */
const SPRING_PANEL = 0.32

/** See `blocks` in the screen: one empty array, so a section with nothing to
 *  jump to does not re-subscribe the scroll listener on every render. */
const NO_BLOCKS: SettingsBlock[] = []

const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total
const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

/** The seed every control starts from, taken once from the payload. */
function seedOf(props: SettingsProps): Record<string, RowValue> {
  const out: Record<string, RowValue> = {}
  for (const section of props.sections) {
    for (const b of section.blocks) for (const r of b.rows) for (const c of r.controls) out[c.id] = c.value
  }
  return out
}

function kindsOf(props: SettingsProps): Record<string, ControlKind> {
  const out: Record<string, ControlKind> = {}
  for (const section of props.sections) {
    for (const b of section.blocks) for (const r of b.rows) for (const c of r.controls) out[c.id] = c.control
  }
  return out
}

/** ⚠ REDUCED MOTION IS READ ONCE AND HANDED DOWN, never asked per spring. Every
 *  spring on the page must agree about it, and a component that re-queried
 *  `matchMedia` on each mount would disagree with one that cached it. It is
 *  false during SSR and on the first paint by construction — the value the
 *  server can know — and the effect corrects it before anything moves. */
function useReducedMotion(): boolean {
  /** ⚠ READ IN THE INITIALISER, NOT IN AN EFFECT, AND THAT IS THE WHOLE BUG THE
   *  FIRST CUT HAD. An effect runs AFTER mount — after every `useLayoutEffect`
   *  that builds a spring — so a reader whose OS preference was set BEFORE the
   *  page loaded got `false` at the one moment it mattered, and the springs were
   *  built to move. Read here, the client's very FIRST render already has the
   *  true answer. There is no hydration mismatch to fear: this value reaches no
   *  markup, only springs, so the server's `false` and the client's `true`
   *  render byte-identical DOM. */
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return reduced
}

/** ⚖ S17 fix round 1 · F19 — IS THE ROOM ON A PHONE?
 *
 *  ≤899 is the room's ①: the rail IS the page and a section is its own screen.
 *  There, このページの中身 is a DISCLOSURE under the head (packet §2.4) rather
 *  than an open list — rendered open it is four items plus a two-line note,
 *  ~248px between the section head and the first block, and at 390×844 the whole
 *  first screen held ZERO settings: a reader opened a section to change one rule
 *  and had to scroll past a table of contents and a save bar to reach anything.
 *  ⚖ apple-design §16.6 — show the common path first, the rest one level deeper.
 *
 *  ⚠ SAME SHAPE AS `useReducedMotion`, for the same reason: read in the
 *  INITIALISER so the client's first render already knows, and subscribed so a
 *  rotation or a resized window is obeyed without a reload. It reaches only the
 *  disclosure's OPEN state, which a layout effect applies — never markup — so
 *  the server's `false` and a phone's `true` still render byte-identical DOM. */
function useNarrow(): boolean {
  /** ⚠ READ IN AN EFFECT, AND THAT IS THE OPPOSITE OF `useReducedMotion` ON
   *  PURPOSE. That flag reaches only SPRINGS, so reading it in the initialiser
   *  costs nothing and buys a correct first frame. THIS one reaches MARKUP — a
   *  disclosure button instead of a heading, `aria-expanded`, a wrapper — so a
   *  client that knew the answer during hydration would render a different tree
   *  than the server sent. Known after mount, the swap is an ordinary re-render:
   *  the collapse MOUNTS closed rather than animating shut, so the list does not
   *  fold itself in front of the reader on load. */
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)')
    const apply = () => setNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return narrow
}

/** ⚖ S17 / A1 — WHAT THE ROOM RENDERS WITH. The rail's own payload, plus
 *  予約と確保's — #812's room arrived as one section of this rail, and its
 *  assembly is `storePolicyProps()`'s rather than this file's vocabulary. It
 *  rides beside `SettingsProps` because `@/business/lib/settings` is the room's
 *  PURE rules file (empty import inventory, pinned), so a props type from
 *  another module may not enter it. */
export type SettingsScreenProps = SettingsProps & { storePolicy: StorePolicyProps }

export function SettingsScreen(props: SettingsScreenProps) {
  // ⚠ `null` IS THE PHONE'S LIST STATE, not「nothing chosen」. On a desk the
  // panel always shows something (the opening section); on a phone the rail IS
  // the page until a reader picks a row, which is ⚖ list-is-the-page.
  const [picked, setPicked] = useState<string | null>(null)
  // ⚠ THE SEED IS TAKEN ONCE. `page.tsx` keys this screen by the resolved store,
  // so a lens switch remounts it and re-seeds from the new store's payload —
  // which is the ⚖ 8/17 isolation law at the frame as well as at the read.
  const [values, setValues] = useState<Record<string, RowValue>>(() => seedOf(props))
  const [saved, setSaved] = useState<Record<string, RowValue>>(() => seedOf(props))
  /** Which sections have been saved in this session — the 保存しました stamp's
   *  own fact.
   *
   *  ⚠ A `Record` RATHER THAN A `Set`, AND THE REASON THIS COMMENT USED TO GIVE
   *  WAS FALSE (⚖ F11). It said the data-access guard 「forbids `.set(` /
   *  `.delete(` tokens outright」. The guard's write patterns are `.insert(`
   *  `.update(` `.upsert(` `.delete(` `.rpc(`
   *  (`scripts/business/check-business-data-access.mjs:118-122`, `ALLOW` empty)
   *  — `.set(` is NOT among them, and this file calls it five times on spring
   *  handles. A reader who trusted the old sentence would have read those five
   *  lines as violations.
   *
   *  The CHOICE stands on its own: a plain object edited by spread is the same
   *  shape every other piece of this room's state has, so one reading rule
   *  covers all of it — and it keeps `.delete(`, which the guard really does
   *  ban, out of the room without an exception being argued for. */
  const [committed, setCommitted] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, string>>({})
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0
  const reduced = useReducedMotion()
  const narrow = useNarrow()
  /** ⚖ F19 — このページの中身 is closed on a phone until a reader asks for it,
   *  and always open where the column has room for it. */
  const [jumpOpen, setJumpOpen] = useState(false)

  /** ⚖ IMPROVEMENT 1 — FIND BY TYPING. Twenty-two rows is past the size a rail
   *  can be scanned, so the rail gets the settings grammar every phone and desk
   *  OS already uses. The query filters rail rows by their own label AND by the
   *  block titles inside their section. */
  const [query, setQuery] = useState('')
  /** Which rows have their 詳しく open, by row id. Open state is per ROW rather
   *  than one-at-a-time: a manager comparing two guardrails should not have the
   *  first one close under them. */
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  /** ⚖ S17 · C2 — the rows of every block that is a COLLECTION, keyed by block
   *  id. Seeded from the payload on first touch and edited in this browser, like
   *  every other value on this page; what the reconnect PR will send is
   *  `addClosedDay` / `removeClosedDay` per difference. */
  const [listRows, setListRows] = useState<CollectionRows>({})
  /** ⚖ S17 fix round 4 · B2 — WHAT 保存 LAST COMMITTED, for the rows. The values
   *  map had `saved` from the first cut and the rows had nothing, so a day a
   *  reader added was invisible to 変更 n件, to the block's dot and to 保存する —
   *  and 保存 never committed it. Same shape as `saved`, asked by the same three
   *  functions: an entry exists only where this browser has changed something,
   *  and a block with no entry means 「still the payload's own rows」. */
  const [savedRows, setSavedRows] = useState<CollectionRows>({})
  const [listErrors, setListErrors] = useState<Record<string, string>>({})
  /** ⚖ IMPROVEMENT 3 — which block the jump list highlights. `null` = follow the
   *  scroll; a string = the reader ASKED for that one, and the list says so even
   *  when the page has run out of scroll and cannot put it at the top. */
  const [jumpPin, setJumpPin] = useState<string | null>(null)
  const [inView, setInView] = useState<string | null>(null)

  const kinds = useMemo(() => kindsOf(props), [props])

  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)
  const tourRectsRef = useRef<SpotRect[]>([])
  /** ⚠ STARTS AT INFINITY so the dim layer FAILS CLOSED: it refuses every press
   *  until the tour has actually been laid out. */
  const settledAt = useRef(Number.POSITIVE_INFINITY)
  /** The rail row a phone reader opened a section FROM, so 「‹ 設定」 puts focus
   *  back on it rather than at the top of a list they have to re-find. */
  const cameFromRef = useRef<string | null>(null)
  const railListRef = useRef<HTMLDivElement>(null)

  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  // 自分の表示設定 — read once after mount. A refusal (private mode, storage
  // disabled) is not a reason to break the page: the seeded defaults stand.
  useEffect(() => {
    let stored = PREFS_DEFAULT
    try {
      stored = readPrefs(window.localStorage.getItem(PREF_KEY))
    } catch {
      stored = PREFS_DEFAULT
    }
    setValues((v) => ({ ...v, [DENSITY_ID]: stored.density, [EMPHASIS_ID]: stored.emphasis }))
    setSaved((v) => ({ ...v, [DENSITY_ID]: stored.density, [EMPHASIS_ID]: stored.emphasis }))
  }, [])

  /** ⚖ HARNESS-GEOMETRY, IN THE PRODUCT (the ② room's own rule). The sticky
   *  stack and every block's `scroll-margin-top` hang off the SHELL's real
   *  topbar, which is 62px at a desk and wraps to ~87px on a narrow window — so
   *  the offset is MEASURED, once on mount and again whenever the bar changes
   *  height. The sheet's own 62px is the pre-measurement default, not the
   *  answer. */
  useLayoutEffect(() => {
    const root = rootRef.current
    const bar = root?.closest('.main')?.querySelector('.topbar')
    if (!root || !bar) return
    const apply = () => root.style.setProperty('--st-topbar', `${Math.round(bar.getBoundingClientRect().height)}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  /** ⚠ THE ONE SECTION THAT SAVES OUTSIDE THIS SCREEN WRITES ON THE PRESS, not
   *  on a 保存 button: canon's own 自分の表示設定 has no save step either, and a
   *  personal preference that needed committing would be the page asking
   *  permission for something nobody else can see. */
  const setValue = useCallback((id: string, next: RowValue) => {
    setValues((prev) => {
      const merged = { ...prev, [id]: next }
      if (id === DENSITY_ID || id === EMPHASIS_ID) {
        try {
          window.localStorage.setItem(
            PREF_KEY,
            JSON.stringify({ density: merged[DENSITY_ID], emphasis: merged[EMPHASIS_ID] }),
          )
        } catch {
          // see above — the choice still applies to this render.
        }
        setSaved((s) => ({ ...s, [id]: next }))
        setCommitted((c) => ({ ...c, 'my-display': true }))
      }
      return merged
    })
  }, [])

  const shownId = picked ?? props.openingSectionId
  const section = props.sections.find((s) => s.id === shownId) ?? null
  const isDetail = picked !== null

  const labelFor = useCallback(
    (id: string): string | null => {
      const kind = kinds[id]
      if (!kind) return null
      return labelOfValue(kind, values[id])
    },
    [kinds, values],
  )

  /** ⚖ C2 — ADD, and refuse a duplicate date in the wire's own words BEFORE the
   *  wire would (`addClosedDay` answers 409). The refusal is spoken at the press,
   *  which is the ⚖ mistake-proofing layer this room is built on: the operator
   *  never gets to a state the store cannot save. */
  const addRow = useCallback((block: SettingsBlock) => {
    const coll = block.collection
    if (!coll) return
    const rows = rowsOfBlock(block, listRows)
    const next = addToCollection(coll, rows, String(values[coll.dateControlId] ?? ''), String(values[coll.reasonControlId] ?? ''))
    setListErrors((prev) => ({ ...prev, [block.id]: next.error ?? '' }))
    if (next.error !== null) return
    setListRows((prev) => ({ ...prev, [block.id]: next.rows }))
    // The two fields empty on success only — a refused attempt keeps what the
    // operator typed, so they can correct the date instead of retyping both.
    setValues((prev) => ({ ...prev, [coll.dateControlId]: '', [coll.reasonControlId]: '' }))
  }, [values, listRows])

  const removeFromCollection = useCallback((block: SettingsBlock, rowId: string) => {
    const coll = block.collection
    if (!coll) return
    const rows = rowsOfBlock(block, listRows)
    setListErrors((prev) => ({ ...prev, [block.id]: '' }))
    setListRows((prev) => ({ ...prev, [block.id]: rows.filter((r) => r.id !== rowId) }))
  }, [listRows])

  const commitSection = useCallback((target: SettingsSection) => {
    const ids = controlIdsOf(target)
    setSaved((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = values[id]
      return next
    })
    /** ⚖ S17 fix round 4 · B2 — AND THE ROWS, because they are the section's
     *  state too. A save that copied only the control values left the block's
     *  dot standing after 保存 and the count still counting a day the reader had
     *  just committed. The baseline takes what the block is HOLDING (the edit if
     *  there is one, else the payload's own items), so a block nobody touched
     *  keeps reading 「unchanged」 rather than being frozen to a copy. */
    setSavedRows((prev) => {
      const next = { ...prev }
      for (const b of target.blocks) if (b.collection !== null) next[b.id] = rowsOfBlock(b, listRows)
      return next
    })
    setCommitted((prev) => ({ ...prev, [target.id]: true }))
  }, [values, listRows])

  /** ⚖ list-is-the-page — opening a section from the rail remembers the row, so
   *  the way back lands the keyboard where it left. */
  const openSection = useCallback((id: string, fromRail: boolean) => {
    if (fromRail) cameFromRef.current = id
    setPicked(id)
    setJumpPin(null)
    setInView(null)
  }, [])

  const backToList = useCallback(() => {
    const id = cameFromRef.current
    setPicked(null)
    if (!id) return
    // The rail is only mounted again once `picked` is null, so the focus move
    // waits a frame for it rather than reaching for a node that is not there.
    requestAnimationFrame(() => {
      railListRef.current?.querySelector<HTMLButtonElement>(`[data-rail-id="${id}"]`)?.focus()
    })
  }, [])

  // ⚖ Liam 8/23 — 画面の説明. A section joins the walk by DECLARING
  // `data-guide-title` + `data-guide` ON ITSELF, so there is no list to keep in
  // sync: what renders is what is explained, and what the band or the open
  // section hides drops out of the walk and out of the N/M count by itself.
  //
  // ⚠ THE WALK IS DECLARED ON ROWS AND BLOCK HEADS, NOT ON THE WHOLE PANEL, and
  // that is a placement decision as much as a teaching one: a target taller than
  // the viewport leaves the engine's card nowhere to go but on top of the thing
  // it is explaining (the room-5 F5 defect). Rows are short, so every step has a
  // free side — and 「what does THIS control do」 is the question a settings page
  // is actually asked.
  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 160 }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > viewport.height - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    /** ⚖ S17 fix round 1 · F17 — A TALL TARGET IS READ FROM ITS TOP.
     *
     *  Centring a block taller than the screen puts its heading ABOVE the
     *  viewport and leaves no room for the card on either side, so the engine's
     *  last resort dropped it on the block's first controls — measured at 390
     *  and 440 on five steps, holes 515 to 1097px. Scrolling the HEADING to the
     *  top instead gives the engine back a real place to stand for anything up
     *  to about a screen tall, and for the ones taller than that
     *  `keepCardOffHeading` pins the card to the far edge.
     *
     *  ⚠ THE TEST IS THE ENGINE'S OWN: 「is there room for the card above or
     *  below the target」, asked with the card's real measured height rather
     *  than with a guess about heights. */
    const need = size.height + 28
    const hasFreeSide = () => r.top >= need || viewport.height - r.bottom >= need
    if (!hasFreeSide()) {
      el.scrollIntoView({ block: 'start' })
      r = el.getBoundingClientRect()
      // …clear of the head row, so the heading is READ rather than tucked under
      // whatever is pinned above it.
      if (r.top < 60) {
        window.scrollBy(0, r.top - 60)
        r = el.getBoundingClientRect()
      }
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    // ⚠ AND THE ENGINE'S LAST RESORT IS CORRECTED (see `keepCardOffHeading`).
    // On a desk every row has a free side and this is a pass-through; at 390 a
    // stacked row is full width and taller than half the viewport, so the engine
    // had nowhere to put the card but on top of the row — measured, and then
    // fixed, rather than argued away.
    const at = keepCardOffHeading(spotCardAt(boxOf(r), size, viewport), size, boxOf(r), viewport)
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  useLayoutEffect(() => {
    settledAt.current = tourOpen ? Date.now() : Number.POSITIVE_INFINITY
  }, [tourOpen])

  /** ⚖ S17 · F12 — ONE ESCAPE KEY, TWO LAYERS, IN THAT ORDER.
   *
   *  The tour is the outer layer: while it is open Escape closes IT and nothing
   *  else, which is the ④ room's own precedent. Underneath it, Escape closes the
   *  詳しく disclosure the reader is standing in and puts focus back on its
   *  button — the half of 「Escape closes the tour and 詳しく」 that was never
   *  built (`.st-det-btn` carried no key handler at all, so a reader who opened
   *  a disclosure by keyboard had no way to close it by keyboard).
   *
   *  ⚠ ONE DOCUMENT-LEVEL HANDLER RATHER THAN A HANDLER PER ROW, because the
   *  layering is the point: two independent handlers would both fire, and the
   *  React root sees a bubbling key before `document` does, so a row-level
   *  `onKeyDown` would beat the tour to it. Written here, the priority is a
   *  `return` a reader can see.
   *
   *  ⚠ IT PRESSES THE ROW'S OWN BUTTON, and does not reach for any state.
   *  The first cut set `openRows` directly, which is the shell room's own store
   *  — so it closed the twenty-two sections' disclosures and silently did
   *  NOTHING for 予約と確保's eight, whose state lives inside that section.
   *  `.st-det-btn`'s own `onClick` is the one place that knows which store owns
   *  it, whichever file rendered it, so the key does what a press does. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tourOpen) {
        if (e.key === 'Escape') setTourIdx(-1)
        if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
        if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
        return
      }
      if (e.key !== 'Escape') return
      const here = document.activeElement
      const dial = here instanceof Element ? here.closest('.st-dial') : null
      if (!(dial instanceof HTMLElement)) return
      const btn = dial.querySelector('.st-det-btn')
      if (!(btn instanceof HTMLElement) || btn.getAttribute('aria-expanded') !== 'true') return
      btn.click()
      btn.focus()
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
  // 次へ; closing it puts focus back on the ? it came from.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (tourOpen) { wasOpen.current = true; tourNextRef.current?.focus(); return }
    if (!wasOpen.current) return
    wasOpen.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  /** ⚠ A STABLE REFERENCE, and the empty case is why it is a module constant:
   *  `? section.blocks : []` hands the scroll-spy effect a fresh array on every
   *  render, so it tears down and re-subscribes its listener each pass. */
  const blocks = section && section.gate === 'open' ? section.blocks : NO_BLOCKS
  /** ⚖ S17 fix round 1 · F16 — THE PANEL ARRIVES, IT DOES NOT BLINK.
   *
   *  Section change is this room's most frequent transition — twenty-two rail
   *  rows, and the purpose sentence has a manager landing on the right one
   *  between two bookings — and it had no motion at all: the old panel was
   *  replaced on the frame. The packet asks for a cross-fade plus a 6px rise on
   *  the room's ONE spring (⚖ Studio: no second easing, no `@keyframes` for
   *  state).
   *
   *  ⚠ UNDER `prefers-reduced-motion` THE PANEL SWAPS IN PLACE — it does not
   *  cross-fade, and saying otherwise would be a claim this code does not make.
   *  The FROZEN `spring.ts` applies every `set` instantly when `reduced` is on
   *  (`spring.ts:107-112`), so the seat at 0 and the target at 1 land in the
   *  same synchronous block and the browser never paints the 0. The transform
   *  is not written at all there, so nothing travels either. That IS the
   *  gentler equivalent ⚖ apple-design §14 asks for — the state changes, it
   *  simply does not move — and the room's colour transitions still carry the
   *  feedback.
   *
   *  ⚠ IT STARTS FROM THE PRESENTATION VALUE, not from zero (⚖ apple-design §3).
   *  A manager clicking down the rail faster than the spring settles would
   *  otherwise see each panel restart from invisible — a strobe. Read live, the
   *  next panel continues from wherever the last one had got to.
   *
   *  ⚠ SAME PATH BOTH WAYS: the only axis is opacity plus a 6px rise, so the
   *  outbound of one panel and the inbound of the next are the same line. The
   *  room mounts ONE section at a time (the panel swaps rather than stacking
   *  22), so there is no separate exit tween to mirror — the honest ceiling, and
   *  it is why the continuity above is the thing that carries the feeling. */
  const panelRef = useRef<HTMLDivElement>(null)
  const panelSpring = useRef<ReturnType<typeof makeSpring> | null>(null)
  const panelBuiltWith = useRef<boolean | null>(null)
  const panelFirst = useRef(true)
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    if (!panelSpring.current || panelBuiltWith.current !== reduced) {
      panelSpring.current?.stop()
      panelBuiltWith.current = reduced
      panelSpring.current = makeSpring(
        (v) => {
          const n = panelRef.current
          if (!n) return
          const t = Math.min(1, Math.max(0, v))
          n.style.opacity = String(t)
          n.style.transform = reduced ? '' : `translateY(${((1 - t) * 6).toFixed(2)}px)`
        },
        { response: SPRING_PANEL, reduced, eps: 0.004 },
      )
    }
    const spring = panelSpring.current
    if (panelFirst.current) {
      panelFirst.current = false
      spring.jump(1)
      return
    }
    const live = Number(el.style.opacity)
    spring.jump(Number.isFinite(live) && live < 1 ? live : 0)
    spring.set(1)
  }, [picked, section?.id, reduced])
  useEffect(() => () => panelSpring.current?.stop(), [])

  /** The ids the scroll-spy measures. 予約と確保 renders itself and its anchors
   *  are the section's own (`STORE_POLICY_ANCHORS`), so the spy asks the same
   *  list the jump list offers rather than a second one that could drift. */
  const anchorIds = useMemo(
    () => (section?.id === BOOKING_GUARD_ID ? STORE_POLICY_ANCHORS.map((a) => a.id) : blocks.map((b) => b.id)),
    [section?.id, blocks],
  )

  /** ⚖ IMPROVEMENT 3 — SCROLL-SPY, MEASURED ON THE PAGE. This room has no
   *  scroller of its own (⚖ PAGE-SCROLL): the window is what moves, so the
   *  highlight is the block filling most of the space BELOW the sticky topbar.
   *  A rAF gate keeps the listener to one measurement per frame. */
  useEffect(() => {
    if (anchorIds.length === 0) return
    let frame = 0
    const measure = () => {
      frame = 0
      const top = rootRef.current
        ? parseFloat(getComputedStyle(rootRef.current).getPropertyValue('--st-topbar')) || 62
        : 62
      let best: string | null = null
      let bestSeen = -1
      for (const id of anchorIds) {
        const el = document.getElementById(`st-blk-${id}`)
        if (!el) continue
        const r = el.getBoundingClientRect()
        const seen = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, top)
        if (seen > bestSeen) { bestSeen = seen; best = id }
      }
      setInView(best)
    }
    const onScroll = () => { if (frame === 0) frame = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [anchorIds])

  /** A jump press scrolls the block to the top of the reading area AND moves
   *  focus to its heading — ⚖ keyboard reach: a control that only scrolls leaves
   *  a keyboard reader's caret behind in the list. */
  const jumpTo = useCallback((blockId: string) => {
    setJumpPin(blockId)
    setInView(blockId)
    /** The heading a jump lands the caret on. Every block renders one; 予約と確保's
     *  two anchors render their own (its プリセット label and its 詳細設定
     *  summary), so one lookup serves both. */
    const head = document.getElementById(`st-blkh-${blockId}`)
    const el = document.getElementById(`st-blk-${blockId}`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    head?.focus({ preventScroll: true })
  }, [])

  const groups: string[] = []
  for (const row of props.rail) if (!groups.includes(row.group)) groups.push(row.group)

  const sectionById = useMemo(() => {
    const out: Record<string, SettingsSection> = {}
    for (const s of props.sections) out[s.id] = s
    return out
  }, [props.sections])

  /** The rail after the query. Every row keeps its group so the list never
   *  reshuffles under a reader mid-type. */
  const shownRail = useMemo(
    () => props.rail.filter((row) => matchesQuery(searchTextOf(row, sectionById[row.id] ?? null, termsFor(row.id)), query)),
    [props.rail, sectionById, query],
  )

  const dirty = section !== null && section.gate === 'open' ? sectionDirty(section, values, saved, listRows, savedRows) : false
  const blocked = section !== null && section.gate === 'open' ? blockingError(section, values) : null
  const changed = section !== null && section.gate === 'open' ? changedCount(section, values, saved, listRows, savedRows) : 0
  const isBookingGuard = section?.id === BOOKING_GUARD_ID
  const highlighted = jumpPin ?? inView

  /* ⚖ list-is-the-page: at ≤899 the rail is the page and a section is its own
     screen, so the way back has to be ON that screen. It is rendered ALWAYS and
     hidden by the band, never conditionally mounted — a button that appears and
     disappears with a resize is a target that moves under a thumb. It is lifted
     out of the branches because every one of them carries it. */
  const backNode = (
    <button
      className="st-back"
      type="button"
      data-guide-title="設定の一覧に戻る"
      data-guide="スマートフォンでは、設定の一覧と中身がそれぞれ1つの画面です。ここを押すと一覧に戻ります。"
      aria-label="設定の一覧に戻る"
      onClick={backToList}
    >
      {/* ⚠ 「設定」, NOT `railHeading`. The rail's heading is 設定カテゴリー — the
          right words for the list's own accessible name, and three syllables too
          many on a back control, which is read as 「back to WHERE」 and wants the
          page's name. The fuller sentence rides the accessible name. */}
      ‹ 設定
    </button>
  )

  /* ⚠ THIS BRANCH IS UNREACHABLE BY CONSTRUCTION TODAY, AND IT IS KEPT
     DELIBERATELY. 自分の表示設定 is `scope: 'self'`, so `gateOf` answers `open`
     for every role — including one this world has never heard of — and
     `firstOpenSection` therefore never returns null. It stays as DEFENCE for a
     rail whose every row could one day be gated: this room's rule is that a
     panel is never a blank rectangle, and that rule needs somewhere to land. The
     suite pins the CLAIM (every role opens on something) rather than the
     presence of this string. */
  const boundaryFallbackNode = (
    <section className="st-boundary" data-guide-title="表示できる設定がありません" data-guide="いまのアカウントの権限では、開ける設定がありません。">
      <p>{props.boundaryFallback}</p>
    </section>
  )

  const boundaryNode = section === null ? null : (
    <section
      className="st-boundary"
      data-guide-title="権限について"
      data-guide="この設定は、権限のあるアカウントでのみ表示されます。ここでは中身を出していません。"
    >
      <p>{section.boundaryLine}</p>
    </section>
  )

  const headNode = section === null ? null : (
    <div
      className="st-sec-head"
      data-guide-title={section.title}
      // ⚖ A2 — ONE TOUR ENGINE. A section that arrived carrying its own page-head
      // declaration (予約と確保, from #812) states it in the payload; every other
      // section is explained by its lead, exactly as before.
      data-guide={section.guide || section.lead || `${section.title}の画面です。`}
    >
      <span className="st-kicker">{section.kicker}</span>
      <h2>{section.title}</h2>
      {section.lead && (
        <p className="st-lead">
          {section.leadNarrow ? (
            <>
              {/* ⚖ mock D4 — both forms ship and the SHEET picks; see
                  `SettingsSection.leadNarrow`. Nothing is chosen in JS, so the
                  server and the browser cannot disagree. */}
              <span className="st-lead-wide">{section.lead}</span>
              <span className="st-lead-narrow">{section.leadNarrow}</span>
            </>
          ) : (
            section.lead
          )}
        </p>
      )}
    </div>
  )

  /** The reading column and the stack beside it, for whichever branch is
   *  rendering. Written once so the two callers cannot drift into two different
   *  panels — and so 予約と確保, whose three slots arrive inside a render prop,
   *  can build the same pair from inside it. */
  const columnAnd = (main: ReactNode, side: ReactNode) => (
    <>
      {/* ⚠ ONE BOX FOR THE READING COLUMN, and it is structural rather than
          cosmetic. The sticky stack stands beside the WHOLE column, and saying
          that with `grid-row: 1 / -1` does NOT work: with no EXPLICIT rows
          declared, `-1` names the last line of the explicit grid — which is line
          1 — so the stack spanned exactly ONE row, forced that row to its own
          ~800px height, and left an 800px hole between the section head and its
          first block. MEASURED on the 予約と確保 shot at 1280. With the column as
          one box there is nothing to span, and at ①/② the box dissolves
          (`display: contents`) so its children take their own places in the
          panel's single column. */}
      <div className="st-col">
        {backNode}
        {headNode}
        {main}
      </div>
      {side}
    </>
  )

  const sideNode = (
    jump: ReadonlyArray<{ id: string; title: string }>,
    card: ReactNode,
    save: ReactNode,
    dirtyOf: (id: string) => boolean,
    raised: boolean,
  ) => (
    <Side
      jump={jump}
      card={card}
      save={save}
      highlighted={highlighted}
      dirtyOf={dirtyOf}
      onJump={jumpTo}
      raised={raised}
      reduced={reduced}
      narrow={narrow}
      jumpOpen={jumpOpen}
      onToggleJump={() => setJumpOpen((was) => !was)}
    />
  )

  return (
    <div className={`${ROOT}${isDetail ? ' is-detail' : ''}`} ref={rootRef}>
      {/* ⚖ IMPROVEMENT 1 — ONE COMPACT ROW. The dateline, the title, the ? and
          the one-line subtitle sit on one band; the old two-line lead folds into
          the head's own tour text, where a reader asks for it. */}
      <header
        className="st-head"
        data-guide-title="設定"
        data-guide="お店の決まりごとと、自分の見え方を変える画面です。左の一覧から見たい設定を選ぶと、右にその中身が出ます。上の検索は、一覧の名前とページの中の見出しの両方をしぼりこみます。"
      >
        <div className="st-eyebrow">{props.dateline}</div>
        <div className="st-titleline">
          <h1>設定</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one 今日の運営
              has. A hairline circle, never a filled one (⚖ R13). */}
          <button
            className="st-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="stTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
          <p className="st-sub">{props.subtitle}</p>
        </div>
      </header>

      <div className="st-body">
        <div className="st-grid">
        <aside
          className="st-rail"
          aria-label={props.railHeading}
          data-guide-title="設定カテゴリー"
          data-guide="設定の一覧です。「権限がありません」はいまのアカウントでは開けないところです。行を押すと、右にその設定が出ます。"
        >
          <div
            className="st-search"
            data-guide-title="設定を検索"
            data-guide="設定の名前でも、ページの中の見出しでもしぼりこめます。「休憩」と入れると、その言葉を持つページが残ります。"
          >
            <input
              className="st-search-field"
              type="search"
              value={query}
              aria-label="設定を検索"
              placeholder="設定を検索"
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query !== '' && (
              <button className="st-search-clear" type="button" aria-label="検索をクリア" onClick={() => setQuery('')}>
                ✕
              </button>
            )}
          </div>

          <div className="st-rail-list" ref={railListRef}>
            {shownRail.length === 0 ? (
              <p className="st-rail-empty">
                「{query.trim()}」に当てはまる設定は見つかりませんでした。
                <br />
                別の言葉でお試しください。
              </p>
            ) : (
              groups
                .filter((group) => shownRail.some((row) => row.group === group))
                .map((group) => (
                  <div className="st-rail-group" key={group}>
                    <div className="st-rail-label">{group}</div>
                    {shownRail
                      .filter((row) => row.group === group)
                      .map((row) => (
                        <RailItem
                          key={row.id}
                          row={row}
                          hit={hitOf(row, sectionById[row.id] ?? null, query, termsFor(row.id))}
                          on={row.id === shownId}
                          onOpen={openSection}
                        />
                      ))}
                  </div>
                ))
            )}
          </div>

          {/* ⚠ THE COUNT IS DERIVED, NEVER TYPED (⚖ numbers explain themselves):
              「全22件」 is `props.rail.length`, so a twenty-third section cannot
              ship beside a rail still claiming twenty-two. */}
          <p className="st-rail-foot">
            {query.trim() === ''
              ? `全${props.rail.length}件の設定 ・ 名前とページの中の見出しから探せます`
              : `${shownRail.length}件 / 全${props.rail.length}件の設定`}
          </p>
        </aside>

        <div className="st-panel" ref={panelRef}>
          {section === null ? (
            columnAnd(boundaryFallbackNode, null)
          ) : section.gate === 'no-rights' ? (
            columnAnd(boundaryNode, null)
          ) : isBookingGuard ? (
            // ⚖ S17 / A1 + A3 — #812's room, rendered whole: its presets, its
            // live card, its eight dials and its OWN 保存 block. It hands the
            // three back as SLOTS so this room can put each where the design puts
            // it — the dials in the reading column, the live card at the top of
            // the sticky stack, the 保存 block in the save slot — while every
            // dial's state stays inside the section that owns it (⚖ A12). ONE
            // call: the render prop builds the same column-and-stack pair every
            // other section gets, from inside itself, so nothing has to be
            // carried across the render.
            <StorePolicySection
              tourOpen={tourOpen}
              reduced={reduced}
              {...props.storePolicy}
              render={(slots) =>
                columnAnd(
                  <div className="st-main">{slots.main}</div>,
                  sideNode(
                    slots.jump,
                    slots.card,
                    slots.save,
                    // ⚖ A3 — this section keeps #812's own 保存, which is a
                    // refusal rather than a commit, so it has no unsaved state
                    // for a dot or a rise to be about.
                    () => false,
                    false,
                  ),
                )
              }
            />
          ) : (
            columnAnd(
              <div className="st-main">
                {section.blocks.map((b) => (
                  <Block
                    key={b.id}
                    block={b}
                    values={values}
                    onChange={setValue}
                    labelFor={labelFor}
                    result={results[b.id] ?? null}
                    error={actionErrors[b.id] ?? null}
                    onAction={() => runAction(b, values, setResults, setActionErrors, labelFor)}
                    onLink={(id) => openSection(id, false)}
                    openRows={openRows}
                    onToggleRow={(id) => setOpenRows((prev) => ({ ...prev, [id]: !prev[id] }))}
                    listRows={b.collection ? rowsOfBlock(b, listRows) : null}
                    listError={listErrors[b.id] ?? null}
                    onListAdd={() => addRow(b)}
                    onListRemove={(rowId) => removeFromCollection(b, rowId)}
                    reduced={reduced}
                  />
                ))}
                {/* ⚖ S17 fix round 3 · R3-1 — THE STANDING FOOTNOTE IS IN FLOW,
                    NOT IN THE STICKY CARD. At ① the save card is stuck to the
                    bottom of the phone's own screen, so every sentence inside it
                    is charged against the reader's screen FOR EVER: 予約と確保's
                    card carried three of them and stood ~185–220px tall on a
                    390×844 phone, which left its first setting a sliver between
                    the head and the card. The card keeps what belongs to the ACT
                    — the button and, when the seam refuses, the one reason — and
                    the sentence that is true of the whole section reads at the
                    end of the section, where a reader arrives after the last
                    dial. ⚠ AND ② GAINS IT: the strip's card is a one-line
                    toolbar and used to hide this line outright
                    (`.st-save-card .st-foot { display: none }`), so between 900
                    and 959 the sentence was not merely low — it was gone. */}
                {section.persist === 'local'
                  ? <p className="st-foot">{props.selfSaveLine}</p>
                  : <p className="st-foot">{props.demoSaveLine}</p>}
              </div>,
              sideNode(
                section.blocks.map((b) => ({ id: b.id, title: b.title })),
                null,
                /* ⚠ 自分の表示設定 HAS NO SAVE BUTTON, AND THAT IS THE POINT: it is
                   already saved, in this browser, the moment it is pressed.
                   Printing 保存する under it would ask a reader to commit
                   something nobody else can see. */
                section.persist === 'local' ? (
                  <p className="st-save-state" role="status">
                    {committed[section.id]
                      ? `✓ この端末に保存しました ${props.saveStampTime}`
                      : '押すとすぐ保存されます'}
                  </p>
                ) : (
                  <>
                    <div className="st-save-line">
                      <span className={`st-save-count${changed === 0 ? ' is-none' : ''}`} role="status">
                        {blocked ??
                          (changed > 0
                            ? `変更した設定 ${changed}件`
                            : committed[section.id]
                              ? `✓ 保存しました ${props.saveStampTime}`
                              : '変更はありません')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="st-save"
                      disabled={!dirty || blocked !== null}
                      onClick={() => commitSection(section)}
                    >
                      保存する
                    </button>
                  </>
                ),
                (id) => {
                  const b = section.blocks.find((x) => x.id === id)
                  return b !== undefined && blockDirty(b, values, saved, listRows, savedRows)
                },
                changed > 0,
              ),
            )
          )}
        </div>
        </div>
      </div>

      {tourOpen && (
        <>
          <div
            className="st-spot-catch"
            onClick={(e) => {
              // ⚖ R6-20 — a press inside the settle window belongs to the gesture
              // that OPENED the tour, not to a decision to close it.
              if (Date.now() - settledAt.current < SETTLE_MS) return
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
              className="st-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="st-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="st-spot-card"
            id="stTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="st-spot-text">{tourStep?.text ?? ''}</span>
            <div className="st-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="st-spot-foot">
              <button type="button" className="st-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="st-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="st-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="st-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── the rail's row ─────────────────────────────────────────────────────────

function RailItem({
  row,
  hit,
  on,
  onOpen,
}: {
  row: RailRow
  hit: string | null
  on: boolean
  onOpen: (id: string, fromRail: boolean) => void
}) {
  return (
    <button
      type="button"
      className={`st-rail-item${on ? ' is-on' : ''}`}
      aria-current={on ? 'page' : undefined}
      data-rail-id={row.id}
      onClick={() => onOpen(row.id, true)}
    >
      <span className="st-rail-name">
        {row.label}
        {/* ⚠ THE HIT SAYS WHY THE ROW SURVIVED THE FILTER. Without it 「休憩」
            leaving 店舗情報・営業時間 on screen reads as a bug rather than as an
            answer — the block that matched is named under the row. */}
        {hit && <span className="st-rail-hit">{hit}</span>}
      </span>
      {row.state === 'no-rights' && <span className="st-flag is-rights">権限がありません</span>}
      {row.scope === 'self' && <span className="st-flag is-self">自分だけ</span>}
    </button>
  )
}

// ── the sticky stack: the live card, このページの中身, and the save state ────
//
// ⚖ IMPROVEMENT 3. One element carries all three, so one grid placement moves
// all three between the room's three compositions: a sticky right column on a
// desk, a strip above the panel on a narrow one, and — at ≤899, where
// `display: contents` dissolves this wrapper — the jump list under the head and
// the save bar stuck to the bottom of the phone's own screen.

function Side({
  jump,
  card,
  save,
  highlighted,
  dirtyOf,
  onJump,
  raised,
  reduced,
  narrow,
  jumpOpen,
  onToggleJump,
}: {
  /** The anchors this section actually renders, in page order. It is a LIST
   *  rather than `section.blocks` because 予約と確保 has no blocks in this file's
   *  vocabulary — it renders itself (⚖ A1) — and hands its own two anchors back
   *  through its slots. One list, whoever supplied it. */
  jump: ReadonlyArray<{ id: string; title: string }>
  card: ReactNode
  save: ReactNode
  highlighted: string | null
  dirtyOf: (blockId: string) => boolean
  onJump: (blockId: string) => void
  /** ⚖ the save card MOVES only when it has something to say — see `SaveCard`. */
  raised: boolean
  reduced: boolean
  /** ⚖ F19 — ≤899 is the room's ①, where このページの中身 is a disclosure. */
  narrow: boolean
  jumpOpen: boolean
  onToggleJump: () => void
}) {
  /** ⚖ S17 fix round 1 · F19 — ONE COPY OF THE LIST, two wrappers. At ① it
   *  lives inside the room's own disclosure and at every other band it stands
   *  open; writing it twice would be two places to change one list. */
  const jumpList = (
    <>
          <div className="st-jump-list">
            {jump.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`st-jump-item${b.id === highlighted ? ' is-on' : ''}${dirtyOf(b.id) ? ' is-dirty' : ''}`}
                aria-current={b.id === highlighted ? 'true' : undefined}
                onClick={() => onJump(b.id)}
              >
                <span className="st-jump-name">{b.title}</span>
                <span className="st-jump-dot" aria-hidden="true" />
                {dirtyOf(b.id) && <span className="st-sr">未保存の変更があります</span>}
              </button>
            ))}
          </div>
          <p className="st-jump-note">見出しを押すとその場所へ移動します。●は未保存の変更です。</p>
    </>
  )

  return (
    /* ⚠ A `<div>`, NOT AN `<aside>`. This element is a LAYOUT wrapper — one box
       so one grid placement moves all three pieces between the room's three
       compositions — and the semantics live on its children (a `<nav>` for the
       jump list, a `<section>` for the save state). An `<aside>` here would be a
       landmark announcing a container that has nothing of its own to say, and
       the ?-walk's census would ask it to declare itself as a teaching subject
       when the three things inside it are the subjects. */
    <div className="st-side">
      {card && <div className="st-side-card">{card}</div>}
      {jump.length > 0 && (
        <nav
          className="st-jump"
          aria-label="このページの中身"
          data-guide-title="このページの中身"
          data-guide="いま開いている設定の中身の一覧です。見出しを押すとその場所へ移動します。●は、まだ保存していない変更があるまとまりです。"
        >
          {/* ⚖ S17 fix round 1 · F19 — A HEADING ON A DESK, A DISCLOSURE ON A
              PHONE. Rendered open at ① the list is four items plus a two-line
              note between the section head and the first block — ~248px — and at
              390×844 the whole first screen held ZERO settings: a reader opened a
              section to change one rule and had to scroll past a table of
              contents and a save bar to reach anything they could change.
              ⚠ A HEADING, NOT A DEAD BUTTON, where the column has room for the
              list: a control that cannot change anything is a lever with a
              promise on it. */}
          {narrow ? (
            <button
              type="button"
              className="st-jump-head"
              aria-expanded={jumpOpen}
              aria-controls="stJumpList"
              onClick={onToggleJump}
            >
              このページの中身
              <span className="st-det-caret" aria-hidden="true">⌄</span>
            </button>
          ) : (
            <div className="st-jump-head">このページの中身</div>
          )}
          {narrow
            ? <Collapse open={jumpOpen} id="stJumpList" reduced={reduced}>{jumpList}</Collapse>
            : <div id="stJumpList">{jumpList}</div>}
        </nav>
      )}
      <SaveCard raised={raised} reduced={reduced}>{save}</SaveCard>
    </div>
  )
}

/** The save state, and the ONE piece of chrome that moves on its own: it rises
 *  when there is something to save and sits back down after 保存, on the room's
 *  own spring. */
function SaveCard({ children, raised, reduced }: { children: ReactNode; raised: boolean; reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const spring = useRef<ReturnType<typeof makeSpring> | null>(null)
  useEffect(() => {
    spring.current = makeSpring((v) => {
      const el = ref.current
      if (el) el.style.transform = v === 0 ? '' : `translateY(${v.toFixed(2)}px)`
    }, { response: SPRING_THUMB, reduced })
    const s = spring.current
    return () => s.stop()
  }, [reduced])
  /** ⚠ IT RISES WHEN THERE IS SOMETHING TO SAVE, AND SINKS AFTER 保存 — not once
   *  on mount. The movement is the card SAYING something ("you have unsaved
   *  work"), so tying it to anything but that fact makes it decoration, and
   *  decoration that moves is the kind of motion the Studio standard removes. */
  useEffect(() => {
    spring.current?.set(raised ? -6 : 0)
  }, [raised])
  return (
    <section
      className="st-save-card"
      ref={ref}
      data-guide-title="保存"
      data-guide="このページで変えた内容の数と、保存の操作です。保存すると、変えた印が消えます。"
    >
      {children}
    </section>
  )
}

// ── a block ────────────────────────────────────────────────────────────────

function Block({
  block,
  values,
  onChange,
  labelFor,
  result,
  error,
  onAction,
  onLink,
  openRows,
  onToggleRow,
  listRows,
  listError,
  onListAdd,
  onListRemove,
  reduced,
}: {
  block: SettingsBlock
  values: Record<string, RowValue>
  onChange: (id: string, v: RowValue) => void
  labelFor: (id: string) => string | null
  result: string | null
  error: string | null
  onAction: () => void
  onLink: (sectionId: string) => void
  openRows: Record<string, boolean>
  onToggleRow: (rowId: string) => void
  /** ⚖ C2 — the live rows of a block that is a collection, `null` for every
   *  other block. */
  listRows: ReadonlyArray<{ id: string; title: string; note: string }> | null
  listError: string | null
  onListAdd: () => void
  onListRemove: (rowId: string) => void
  reduced: boolean
}) {
  const rows = block.table === null ? block.table : filterTable(block, values)
  return (
    <section
      className="st-block"
      id={`st-blk-${block.id}`}
      data-guide-title={block.title}
      data-guide={block.note || `${block.title}の設定です。`}
    >
      <div className="st-block-head">
        {/* ⚠ `tabIndex={-1}` IS THE JUMP LIST'S LANDING PAD, not a tab stop: a
            jump has to move the caret as well as the page, or a keyboard reader
            presses 「営業時間」 and is still standing in the list. */}
        <h3 id={`st-blkh-${block.id}`} tabIndex={-1}>{block.title}</h3>
        {block.flag && <span className="st-flag is-soon">{block.flag}</span>}
      </div>
      {block.note && <p className="st-block-note">{block.note}</p>}
      {block.rightsNote && <p className="st-rights">{block.rightsNote}</p>}

      {block.layout === 'week' ? (
        <WeekTable block={block} values={values} onChange={onChange} reduced={reduced} />
      ) : (
        block.rows.map((r) => (
          <Row
            key={r.id}
            row={r}
            values={values}
            onChange={onChange}
            onLink={onLink}
            open={openRows[r.id] === true}
            onToggle={() => onToggleRow(r.id)}
            reduced={reduced}
          />
        ))
      )}

      {block.collection && listRows !== null && (
        <Collection
          block={block}
          coll={block.collection}
          rows={listRows}
          error={listError}
          values={values}
          onChange={onChange}
          onAdd={onListAdd}
          onRemove={onListRemove}
        />
      )}

      {block.list && (
        <div className="st-list">
          <b>{block.list.title}</b>
          <ul>
            {block.list.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {rows && (
        <div
          className="st-table"
          role="table"
          aria-label={block.title}
          // The column count is the TABLE's own fact, so the sheet never has to
          // guess it: a four-column record and a two-column one share one rule.
          style={{ ['--st-cols' as string]: String(block.table!.head.length) } as CSSProperties}
        >
          <div className="st-tr is-head" role="row">
            {block.table!.head.map((h) => (
              <span className="st-th" role="columnheader" key={h}>{h}</span>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="st-empty">この条件に一致する記録はありません。期間や種類を変えてお試しください。</p>
          ) : (
            rows.map((tr) => (
              <div className="st-tr" role="row" key={tr.cells.join('|')}>
                {tr.cells.map((cell, i) => (
                  <span className="st-td" role="cell" key={`${i}-${cell}`}>{cell}</span>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* ⚠ THE PREVIEW IS THE DEAD-LEVER LAW, GENERALISED. It is written from
          the LIVE values, so pressing any control in this block really rewrites
          a sentence the reader is looking at. */}
      {block.preview && (
        <div
          className="st-preview"
          aria-live="polite"
          {...Object.fromEntries(
            Object.entries(block.preview.attrs ?? {}).map(([attr, id]) => [attr, String(values[id] ?? '')]),
          )}
        >
          <div className="st-pv-note">いまの設定での見え方</div>
          <p className="st-pv-text">{fillTemplate(block.preview.template, labelFor)}</p>
          {block.preview.attrs && (
            <div className="st-pv-board">
              <div className="st-pv-row"><span>10:00 見本 あかり 様</span><span>テスト整体 60分</span></div>
              <div className="st-pv-row"><span>11:30 見本 かえで 様</span><span>テスト骨盤ケア 90分</span></div>
              <div className="st-pv-row"><span>13:00 見本 さくら 様</span><span>テストストレッチ 30分</span></div>
            </div>
          )}
        </div>
      )}

      {block.facts.map((f) => (
        <p className="st-fact" key={f}>{f}</p>
      ))}

      {block.links.length > 0 && (
        <div className="st-links">
          {block.links.map((l) => (
            <button type="button" className="st-link" key={l.sectionId + l.label} onClick={() => onLink(l.sectionId)}>
              {l.label} →
            </button>
          ))}
        </div>
      )}

      {block.action && (
        <div className="st-action">
          <button type="button" className="st-act" onClick={onAction}>{block.action.label}</button>
          {error && <span className="st-act-error">{error}</span>}
          {!error && result && <span className="st-act-result" role="status">{result}</span>}
        </div>
      )}

      {block.audit && <p className="st-audit">{block.audit}</p>}
    </section>
  )
}

/** ⚖ S17 · C2 — a block that ADDS AND REMOVES ROWS, because its wire does.
 *
 *  Every control here is real and reachable by keyboard: the two fields are
 *  labelled `<input>`s, 追加 and 取り消す are real `<button>`s, and the refusal is
 *  a live region so a screen reader hears it at the press rather than finding it
 *  later. The empty state is a sentence, never a blank box. */
function Collection({
  block,
  coll,
  rows,
  error,
  values,
  onChange,
  onAdd,
  onRemove,
}: {
  block: SettingsBlock
  coll: NonNullable<SettingsBlock['collection']>
  rows: ReadonlyArray<{ id: string; title: string; note: string }>
  error: string | null
  values: Record<string, RowValue>
  onChange: (id: string, v: RowValue) => void
  onAdd: () => void
  onRemove: (rowId: string) => void
}) {
  const dateId = `${block.id}-date`
  const reasonId = `${block.id}-reason`
  return (
    <div className="st-coll">
      {rows.length === 0 ? (
        <p className="st-coll-empty">{coll.emptyLine}</p>
      ) : (
        rows.map((r) => (
          <div className="st-coll-row" key={r.id}>
            <div className="st-coll-what">
              <div className="st-coll-title">{r.title}</div>
              {r.note && <div className="st-coll-note">{r.note}</div>}
            </div>
            <button
              type="button"
              className="st-coll-del"
              /* ⚠ THE ROW'S SUBJECT RIDES THE BUTTON'S OWN NAME. A column of
                 buttons all called 「取り消す」 is a screen reader hearing the
                 same word six times with no way to tell which day it removes. */
              aria-label={`${r.title}の臨時休業を${coll.removeLabel}`}
              onClick={() => onRemove(r.id)}
            >
              {coll.removeLabel}
            </button>
          </div>
        ))
      )}
      <div className="st-coll-add">
        <label className="st-coll-field" htmlFor={dateId}>
          <span>日付</span>
          <input
            id={dateId}
            className="st-input is-date"
            type="date"
            value={String(values[coll.dateControlId] ?? '')}
            onChange={(e) => onChange(coll.dateControlId, e.target.value)}
          />
        </label>
        <label className="st-coll-field" htmlFor={reasonId}>
          <span>理由</span>
          <input
            id={reasonId}
            className="st-input"
            type="text"
            maxLength={40}
            placeholder="設備メンテナンスのため"
            value={String(values[coll.reasonControlId] ?? '')}
            onChange={(e) => onChange(coll.reasonControlId, e.target.value)}
          />
        </label>
        <button type="button" className="st-act" onClick={onAdd}>{coll.addLabel}</button>
        {error && <p className="st-coll-error" role="status">{error}</p>}
      </div>
    </div>
  )
}

/** The one filtered table in the room (監査ログ). A filter whose value is `all`
 *  matches every row, which is how canon's own 全て option behaves. */
function filterTable(block: SettingsBlock, values: Record<string, RowValue>) {
  const table = block.table!
  if (block.filterBy.length === 0) return table.rows
  return table.rows.filter((r) =>
    block.filterBy.every((id) => {
      const v = values[id]
      if (typeof v !== 'string' || v === 'all') return true
      return r.tags.includes(v)
    }),
  )
}

function runAction(
  block: SettingsBlock,
  values: Record<string, RowValue>,
  setResults: (fn: (prev: Record<string, string>) => Record<string, string>) => void,
  setErrors: (fn: (prev: Record<string, string>) => Record<string, string>) => void,
  labelFor: (id: string) => string | null,
) {
  const action = block.action
  if (!action) return
  // ⚠ AN EMPTY REQUIRED INPUT GETS AN EXPLICIT MESSAGE, NEVER A SILENT NO-OP
  // (canon's own raw-string / explicit-empty law on the 書き出し page).
  if (action.requires) {
    const v = values[action.requires]
    const empty = Array.isArray(v) ? v.length === 0 : typeof v === 'string' ? v.trim() === '' : !v
    if (empty) {
      setErrors((prev) => ({ ...prev, [block.id]: action.requireError ?? '入力してください。' }))
      return
    }
  }
  setErrors((prev) => ({ ...prev, [block.id]: '' }))
  setResults((prev) => ({ ...prev, [block.id]: fillTemplate(action.template, labelFor) }))
}

// ── 営業時間 as a week, not as twenty-one stacked controls ──────────────────

/** ⚖ IMPROVEMENT 2. The seven rows are unchanged in the payload — same ids, same
 *  controls, same order — and only their SHAPE differs: 曜日 · 営業 · 開始 · 終了
 *  as four columns, so 「which days are we closed」 is one column to read down
 *  instead of seven rows to compare. The column heads are the table's own; a
 *  screen reader gets each control's day from its `aria` (「月曜に営業する」),
 *  because a reader in a table does not hear the column header. */
function WeekTable({
  block,
  values,
  onChange,
  reduced,
}: {
  block: SettingsBlock
  values: Record<string, RowValue>
  onChange: (id: string, v: RowValue) => void
  reduced: boolean
}) {
  return (
    <div className="st-week" role="table" aria-label={block.title}>
      <div className="st-week-head" role="row">
        <span className="st-week-h" role="columnheader">曜日</span>
        <span className="st-week-h" role="columnheader">営業</span>
        <span className="st-week-h" role="columnheader">開始</span>
        <span className="st-week-h" role="columnheader">終了</span>
      </div>
      {block.rows.map((r) => {
        const openCtl = r.controls.find((c) => c.control.kind === 'switch')
        const times = r.controls.filter((c) => c.control.kind === 'time')
        const on = openCtl ? values[openCtl.id] === true : true
        return (
          <div className={`st-week-row${on ? '' : ' is-off'}`} role="row" key={r.id}>
            <span className="st-week-day" role="cell">{r.label}</span>
            <span className="st-week-cell" role="cell">
              {openCtl && <Control row={r} c={openCtl} value={values[openCtl.id]} onChange={onChange} reduced={reduced} />}
            </span>
            {times.map((c) => (
              <span className="st-week-cell" role="cell" key={c.id}>
                <Control row={r} c={c} value={values[c.id]} onChange={onChange} reduced={reduced} />
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── a row ──────────────────────────────────────────────────────────────────

function Row({
  row,
  values,
  onChange,
  onLink,
  open,
  onToggle,
  reduced,
}: {
  row: SettingsRow
  values: Record<string, RowValue>
  onChange: (id: string, v: RowValue) => void
  onLink: (sectionId: string) => void
  open: boolean
  onToggle: () => void
  reduced: boolean
}) {
  /** ⚖ IMPROVEMENT 2 — WHAT FOLDS, AND WHAT NEVER DOES. The label, the scope,
   *  the meta and the ONE-LINE description stay visible on every row (⚖ 8/31);
   *  the 初期値 · guardrail · 業種の初期値 · 出どころ lines go behind 詳しく,
   *  VERBATIM. A row with none of those grows no button. */
  const detail: Array<{ cls: string; text: string }> = []
  if (row.trio) {
    detail.push({ cls: 'st-det-base', text: row.trio.base })
    detail.push({ cls: 'st-det-rail', text: row.trio.guardrail })
    if (row.trio.businessType) detail.push({ cls: 'st-det-type', text: row.trio.businessType })
  }
  if (row.source) detail.push({ cls: 'st-det-src', text: `出どころ: ${row.source}` })
  /** ⚠ A LOCKED CONTROL'S REASON DOES NOT FOLD, and that is `RowControl.locked`'s
   *  own law restated: 「the reason is VISIBLE, never a tooltip」. Everything else
   *  in 詳しく is context a manager opens WHEN they are changing the dial; a lock
   *  reason is the answer to 「why can I not change this at all」, which they need
   *  before they press it. It rode into the disclosure with the trio on the first
   *  cut of this round and comes back out here. */
  /** ⚖ S17 · F8 — and a chip a reader may not take AWAY is the same kind of
   *  answer as a locked control's, so it is said in the same place and folds
   *  the same way (which is to say: it does not fold). 「why can I not change
   *  this」 is read before the press, not after it. */
  const lockReasons = [
    ...row.controls.map((c) => c.locked),
    ...row.controls.map((c) => (c.control.kind === 'chips' ? c.control.keep?.reason : undefined)),
  ].filter((r): r is string => r !== undefined)
  const detailId = `st-det-${row.id}`

  return (
    <section
      className={`st-dial${row.link ? ' is-door' : ''}`}
      data-guide-title={row.label}
      data-guide={`${row.description || row.label + 'の設定です。'} ${row.trio?.guardrail ?? ''}${detail.length > 0 ? ' 初期値や決まりは「詳しく」で開けます。' : ''}`.trim()}
    >
      <div className="st-dial-what">
        <div className="st-dial-label">
          <b>{row.label}</b>
          {row.scopeLabel && <span className="st-scope">{row.scopeLabel}</span>}
        </div>
        {row.meta.length > 0 && (
          <div className="st-dial-meta">
            {row.meta.map((m) => (
              <span className="st-meta" key={m}>{m}</span>
            ))}
          </div>
        )}
        {/* ⚠ THE DESCRIPTION IS A SIBLING OF THE LABEL, NOT A CHILD OF IT: as its
            own line it wraps against the label track rather than against the
            label's own text box. */}
        {row.description && <p className="st-dial-desc">{row.description}</p>}
        {detail.length > 0 && <DetailToggle open={open} controls={detailId} onToggle={onToggle} />}
      </div>

      <div className="st-dial-ctl">
        {/* ⚖ S17 — ONE RULE ONE HOME. A row whose control moved keeps its place
            and offers the way there: a REAL button, so it is reachable by
            keyboard exactly like every other control in this room, and its label
            promises only what the destination can do (⚖ label truth). */}
        {row.link && (
          <button type="button" className="st-link" onClick={() => onLink(row.link!.sectionId)}>
            {row.link.label} →
          </button>
        )}
        {groupTimes(row.controls).map((group) =>
          group.length === 1 ? (
            <Control key={group[0].id} row={row} c={group[0]} value={values[group[0].id]} onChange={onChange} reduced={reduced} />
          ) : (
            // ⚠ A TIME RANGE IS ONE THING, SO IT WRAPS AS ONE THING. Two `time`
            // fields side by side in a narrow column left the switch beside them
            // and pushed the second time onto its own line — 「10:00」 above
            // 「19:00」 with nothing saying they were a range. Grouped, the pair is
            // a single flex item that carries its own 〜 and moves together, so a
            // forced wrap puts the switch above the range instead of splitting it.
            <span className="st-timepair" key={group[0].id}>
              {group.map((c, i) => (
                <span className="st-timepart" key={c.id}>
                  {i > 0 && <span className="st-tilde" aria-hidden="true">〜</span>}
                  <Control row={row} c={c} value={values[c.id]} onChange={onChange} reduced={reduced} />
                </span>
              ))}
            </span>
          ),
        )}
      </div>

      {lockReasons.map((r) => (
        <p className="st-why" key={r}>{r}</p>
      ))}

      {detail.length > 0 && (
        <Collapse open={open} id={detailId} reduced={reduced}>
          <ul className="st-det">
            {detail.map((d) => (
              <li className={d.cls} key={d.text}>{d.text}</li>
            ))}
          </ul>
        </Collapse>
      )}
    </section>
  )
}


/** Consecutive `time` controls belong to one range and travel together. Every
 *  other control is its own group of one, so the shape of the row is unchanged
 *  everywhere but the three places that hold a range. */
function groupTimes(controls: RowControl[]): RowControl[][] {
  const out: RowControl[][] = []
  for (const c of controls) {
    const last = out[out.length - 1]
    if (last && c.control.kind === 'time' && last[last.length - 1].control.kind === 'time') last.push(c)
    else out.push([c])
  }
  return out
}

// ── a control ──────────────────────────────────────────────────────────────

function Control({
  row,
  c,
  value,
  onChange,
  reduced,
}: {
  row: SettingsRow
  c: RowControl
  value: RowValue
  onChange: (id: string, v: RowValue) => void
  /** ⚠ THE TWO CONTROLS WHOSE STATE TRAVELS NEED IT. A spring is JS, so the
   *  sheet's `prefers-reduced-motion` block cannot reach it — the thumbs would
   *  have gone on sliding for a reader who asked the platform for stillness,
   *  with the room's own CSS reset sitting right there looking like it covered
   *  them. `makeSpring`'s `reduced` lands every `set` instantly: the state still
   *  changes, it simply stops moving, which is this family's own rule. */
  reduced: boolean
}) {
  const k = c.control
  const locked = c.locked !== undefined
  /** A locked control stays FOCUSABLE (`aria-disabled`, never `disabled`) so its
   *  reason is reachable by keyboard and screen reader; the reason rides the
   *  accessible name as well, because a screen reader drops `title` once a
   *  description is present. */
  const inert = locked
    ? { 'aria-disabled': 'true' as const, title: c.locked, 'aria-label': `${c.aria} — ${c.locked}` }
    : {}
  /** ⚠ A CONTROLLED FIELD ALWAYS GETS AN `onChange`, EVEN WHEN IT IS LOCKED.
   *  React treats `value` without one as a read-only field and warns on every
   *  render — the probe's console sweep caught exactly that. `readOnly` would
   *  silence it too, but a no-op handler keeps the shape of every other control
   *  and leaves `aria-disabled` (never `disabled`) to carry the meaning, so the
   *  reason stays reachable by keyboard. */
  const noop = () => {}

  if (k.kind === 'segment') {
    return (
      <Segment
        options={k.options}
        aria={c.aria}
        value={String(value ?? '')}
        inert={inert}
        reduced={reduced}
        onPick={locked ? undefined : (v) => onChange(c.id, v)}
      />
    )
  }

  if (k.kind === 'chips') {
    const picked = Array.isArray(value) ? value : []
    return (
      <div className={`st-chips${k.grid ? ' is-grid' : ''}`} role="group" aria-label={c.aria}>
        {k.options.map((opt) => {
          const on = picked.includes(opt.value)
          /** ⚖ S17 · F8 — THE ONE CHIP A READER MAY ADD BUT NOT TAKE AWAY.
           *  `keep` is the reader's own 役職 on a list that is also 予約と確保's
           *  save gate: unticking it is a manager removing their own ability to
           *  save that section. Only the REMOVE direction is refused, so a
           *  manager whose role is out of the list can still put it back, and
           *  the chip stays focusable with `aria-disabled` (never `disabled`)
           *  like every other refusal in this room. */
          const held = on && k.keep !== undefined && k.keep.value === opt.value
          const guard = held
            ? { 'aria-disabled': 'true' as const, title: k.keep!.reason, 'aria-label': `${opt.label} — ${k.keep!.reason}` }
            : {}
          return (
            <button
              key={opt.value}
              type="button"
              className={`st-pick${on ? ' is-on' : ''}`}
              aria-pressed={on}
              {...inert}
              {...guard}
              onClick={locked || held ? undefined : () => onChange(c.id, on ? picked.filter((v) => v !== opt.value) : [...picked, opt.value])}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    )
  }

  if (k.kind === 'swatch') {
    return (
      <div className="st-swatches" role="group" aria-label={c.aria}>
        {k.options.map((opt) => {
          const on = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              className={`st-swatch${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={opt.label}
              title={opt.label}
              style={{ background: opt.hex ?? opt.value }}
              {...inert}
              onClick={locked ? undefined : () => onChange(c.id, opt.value)}
            />
          )
        })}
      </div>
    )
  }

  if (k.kind === 'switch') {
    return (
      <Switch
        on={value === true}
        aria={c.aria}
        onLabel={k.onLabel}
        offLabel={k.offLabel}
        inert={inert}
        reduced={reduced}
        onToggle={locked ? undefined : () => onChange(c.id, value !== true)}
      />
    )
  }

  if (k.kind === 'select') {
    return (
      <select
        className="st-select"
        aria-label={c.aria}
        value={String(value ?? '')}
        {...inert}
        onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}
      >
        {k.options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  }

  if (k.kind === 'number') {
    return (
      <span className="st-numline">
        <input
          className="st-input is-num"
          type="number"
          inputMode="numeric"
          min={k.min}
          max={k.max}
          step={k.step}
          aria-label={c.aria}
          value={String(value ?? '')}
          {...inert}
          onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}
          // ⚠ THE CLAMP FIRES ON COMMIT, NOT PER KEYSTROKE. A clamp that ran on
          // every character makes 「1」 unreachable on the way to 「14」 — the
          // guardrail would be fighting the reader instead of protecting them.
          onBlur={locked ? undefined : (e) => onChange(c.id, String(commitNumber(e.target.value, k.min, k.max)))}
        />
        {k.unit && <span className="st-unit">{k.unit}</span>}
      </span>
    )
  }

  if (k.kind === 'time') {
    return (
      <input
        className="st-input is-time"
        type="time"
        aria-label={c.aria}
        value={String(value ?? '')}
        {...inert}
        onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}
      />
    )
  }

  if (k.kind === 'date') {
    return (
      <input
        className="st-input is-date"
        type="date"
        min={k.min}
        aria-label={c.aria}
        value={String(value ?? '')}
        {...inert}
        onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}
      />
    )
  }

  if (k.kind === 'text') {
    const empty = k.required && String(value ?? '').trim() === ''
    return (
      <span className="st-textline">
        <input
          className={`st-input${empty ? ' is-empty' : ''}`}
          type="text"
          aria-label={c.aria}
          placeholder={k.placeholder}
          maxLength={k.maxLength}
          value={String(value ?? '')}
          {...inert}
          onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}
        />
        {empty && <span className="st-field-msg">{row.label}を入力してください（空欄では保存できません）</span>}
      </span>
    )
  }

  return (
    <div className={`st-readout${k.numeric ? '' : ' is-phrase'}`}>
      <b>{String(value ?? '')}</b>
      {k.unit && <span>{k.unit}</span>}
    </div>
  )
}

// ── the two controls whose STATE travels ───────────────────────────────────
//
// ⚖ apple-design §2 — a segmented control's selection and a switch's thumb are
// the two places in this room where a value MOVES from one place to another, and
// both ride the same critically-damped spring (`makeSpring`, response .30). The
// selection is still an `aria-pressed` button and an `aria-checked` switch; the
// thumb is decoration behind it, `pointer-events: none`, so nothing about the
// keyboard or a screen reader depends on the motion.

/** What a LOCKED control wears instead of `disabled` — the reason, reachable by
 *  keyboard and by a screen reader. Spelled as a type rather than inline so the
 *  two controls whose thumb travels take exactly what `Control` hands them. */
type InertProps = { 'aria-disabled'?: 'true'; title?: string; 'aria-label'?: string }

function Segment({
  options,
  aria,
  value,
  inert,
  reduced,
  onPick,
}: {
  options: Array<{ value: string; label: string }>
  aria: string
  value: string
  inert: InertProps
  reduced: boolean
  onPick?: (value: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const xRef = useRef<ReturnType<typeof makeSpring> | null>(null)
  const wRef = useRef<ReturnType<typeof makeSpring> | null>(null)
  const geom = useRef({ x: 0, w: 0 })
  const seated = useRef(false)

  /** ⚠ NO `if (!ref.current)` GUARD, AND THAT IS THE FIX RATHER THAN A STYLE
   *  CHOICE. `makeSpring` captures `reduced` at construction, so a guard that
   *  builds once pins the FIRST value forever — putting `reduced` in a deps
   *  array re-runs the effect and the guard then refuses to rebuild, which is
   *  the shape that shipped and lied. Built unconditionally in an effect keyed
   *  on `reduced` (the shape `SaveCard` already had right), the springs are
   *  replaced when the answer changes and the old pair is stopped first. */
  useLayoutEffect(() => {
    const paint = () => {
      const thumb = thumbRef.current
      if (!thumb) return
      thumb.style.transform = `translateX(${geom.current.x.toFixed(2)}px)`
      thumb.style.width = `${Math.max(0, geom.current.w).toFixed(2)}px`
    }
    xRef.current?.stop()
    wRef.current?.stop()
    xRef.current = makeSpring((v) => { geom.current.x = v; paint() }, { response: SPRING_THUMB, eps: 0.4, reduced })
    wRef.current = makeSpring((v) => { geom.current.w = v; paint() }, { response: SPRING_THUMB, eps: 0.4, reduced })
    // A rebuilt spring starts at 0, so the thumb is re-SEATED at its place
    // rather than travelling there from the left edge.
    seated.current = false
  }, [reduced])

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const thumb = thumbRef.current
    if (!wrap || !thumb) return
    const on = wrap.querySelector<HTMLButtonElement>('.st-opt[aria-pressed="true"]')
    if (!on) { thumb.style.opacity = '0'; return }
    thumb.style.opacity = ''
    const x = on.offsetLeft
    const w = on.offsetWidth
    if (!seated.current) {
      seated.current = true
      xRef.current!.jump(x)
      wRef.current!.jump(w)
      return
    }
    xRef.current!.set(x)
    wRef.current!.set(w)
  }, [value, options, reduced])

  useEffect(() => () => { xRef.current?.stop(); wRef.current?.stop() }, [])

  return (
    <div className="st-seg" role="group" aria-label={aria} ref={wrapRef}>
      <span className="st-seg-thumb" aria-hidden="true" ref={thumbRef} />
      {options.map((opt) => {
        const on = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            className="st-opt"
            aria-pressed={on}
            {...inert}
            onClick={onPick ? () => onPick(opt.value) : undefined}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function Switch({
  on,
  aria,
  onLabel,
  offLabel,
  inert,
  reduced,
  onToggle,
}: {
  on: boolean
  aria: string
  onLabel: string
  offLabel: string
  inert: InertProps
  reduced: boolean
  onToggle?: () => void
}) {
  const thumbRef = useRef<HTMLSpanElement>(null)
  const springRef = useRef<ReturnType<typeof makeSpring> | null>(null)
  const seated = useRef(false)

  /** Same shape, same reason as `Segment` above: built unconditionally, keyed on
   *  `reduced`, so the flag can never be pinned at its first value. */
  useLayoutEffect(() => {
    springRef.current?.stop()
    springRef.current = makeSpring(
      (v) => { if (thumbRef.current) thumbRef.current.style.transform = `translateX(${v.toFixed(2)}px)` },
      { response: SPRING_THUMB, eps: 0.3, reduced },
    )
    seated.current = false
  }, [reduced])

  useLayoutEffect(() => {
    const thumb = thumbRef.current
    if (!thumb || !springRef.current) return
    /** The travel is the track's own arithmetic, read from the element rather
     *  than typed: the touch band widens the track to 44px and a hard-coded
     *  20px would leave the thumb short of its own end there. */
    const track = thumb.parentElement
    const travel = track ? Math.max(0, track.clientWidth - thumb.offsetWidth - 4) : 18
    if (!seated.current) { seated.current = true; springRef.current.jump(on ? travel : 0); return }
    springRef.current.set(on ? travel : 0)
  }, [on, reduced])

  useEffect(() => () => springRef.current?.stop(), [])

  return (
    <div className="st-switchline">
      <span className={`st-state${on ? ' is-on' : ''}`}>{on ? onLabel : offLabel}</span>
      <button
        type="button"
        className="st-switch"
        role="switch"
        aria-checked={on}
        aria-label={aria}
        {...inert}
        onClick={onToggle}
      >
        <span className="st-switch-thumb" aria-hidden="true" ref={thumbRef} />
      </button>
    </div>
  )
}

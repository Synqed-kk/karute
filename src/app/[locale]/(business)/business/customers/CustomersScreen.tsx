'use client'

// 顧客 — the ACCEPTED MOCK, become the room (CUSTOMERS-MOCK-v1.html).
//
// THE SHAPE, IN THE ORDER THE PAGE READS:
//   · one compact title row (Liam F-1「kill the dead space」), with the ? that
//     opens the 画面の説明 tour;
//   · the five stat tiles, which ARE the filters — one predicate per tile, so a
//     tile's number and the rows it reveals are the same computation;
//   · the duplicate triage strip, only when there is something to triage;
//   · the dense 52px list, page-scrolled, beside the sectioned inspector;
//   · the provenance footnote, which opens downward in flow;
//   · and the compare drawer, where a duplicate pair is really put side by side.
//
// EVERY TRUTH THE TRANSPLANTED ROOM PROVED IS KEPT. Derived money, the lens
// clamp, no other store's name, 「—」 for a null, ⚖ cut #7's collapsed 本人関係,
// the six WO-1b behaviour closures, the working create dialog and the working
// 表示する列 popover all survive the redesign. The mock is a spec for layout,
// hierarchy, copy and motion; it is not a licence to drop a behaviour.
//
// VALUES ARRIVE PRE-FORMATTED from `customers-props.ts`: no dates, no data
// access and no store lens logic live here.
//
// ⚖-ADJ A — THE TWO DUPLICATE ACTIONS ARE WRITES, AND IN THE SEALED WORLD THEY
// REFUSE. 別人として確認 and 統合する both change a customer's 重複判断, which
// this page's own footnote says 顧客プロフィール owns and is 未接続. They render
// with the family's refusal grammar and the reason is ALSO printed in the
// drawer's footer, so it is readable without hover. The mock's local undoable
// flip is design intent for the reconnect era (registry ③) and is mock-only
// here: a flipped 別人確認 changes what a manager would ACT on — the strip and
// the tile both lose a candidate — so a 「見本 triage state」 would demo a
// judgment being recorded that no record holds.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toggleColumn, wireColumnsPopover } from '@/business/lib/column-config'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import { makeSpring, type Spring } from '@/business/lib/spring'
import { winBackLine, type CustomerRow, type CustomersProps } from './customers-props'

export type { CustomerRow }

type FilterKey = 'all' | 'future' | 'ticket' | 'wallet' | 'merge'

/**
 * ⚖ §2.2 — ONE PREDICATE PER TILE, AND THE TILE'S NUMBER IS ITS OWN FILTER RUN.
 * The count and the row set are the SAME function over the SAME array, so
 * `tileCount === rowsRevealed` holds by construction rather than by review. A
 * count computed from a second predicate is a mutant the battery kills.
 *
 * ⚠ ¥0 IS NOT 預かり残高あり. A wallet of zero is a wallet with nothing in it;
 * counting it would put cus-04 in a tile whose own label promises money.
 */
export const TILE_PREDICATE: Record<FilterKey, (r: CustomerRow) => boolean> = {
  all: () => true,
  future: (r) => r.hasNext,
  ticket: (r) => r.ticket != null && r.ticket > 0,
  wallet: (r) => r.wallet != null && r.wallet > 0,
  merge: (r) => r.merge !== 'none',
}

const TILES: Array<{ k: FilterKey; label: string; dupe?: true }> = [
  { k: 'all', label: '全顧客' },
  { k: 'future', label: '次回予約あり' },
  { k: 'ticket', label: '回数券あり' },
  { k: 'wallet', label: '預かり残高あり' },
  { k: 'merge', label: '重複候補', dupe: true },
]

/** The four core columns plus canon's three optional ones. Both track lists ride
 *  as custom properties and the sheet's own container query picks between them,
 *  so 表示設定 still changes the tracks (the mechanism is unchanged; only the
 *  numbers are the mock's). */
const COLUMNS = [
  { k: 'person', label: '顧客', w: 'minmax(264px, 1.3fr)', nw: 'minmax(196px, 1.3fr)', optional: false },
  { k: 'next', label: '次回予約', w: 'minmax(120px, 1fr)', nw: 'minmax(104px, 1fr)', optional: false },
  { k: 'ticket', label: '回数券・残高', w: '96px', nw: '92px', optional: false },
  { k: 'confirm', label: '確認', w: '92px', nw: '86px', optional: false },
  { k: 'lastVisit', label: '最終来店', w: '96px', nw: '96px', optional: true },
  { k: 'totalSpent', label: '累計支払', w: '104px', nw: '104px', optional: true },
  { k: 'consent', label: '連絡同意', w: '108px', nw: '108px', optional: true },
] as const

const MERGE_LABEL: Record<CustomerRow['merge'], string> = {
  open: '重複候補',
  pending: '統合確認中',
  none: '確認済み',
}

/** Every refusal this room speaks, spelled once. A refusal changes NOTHING and
 *  its reason stays readable (lessons §A-7). */
const REFUSAL = {
  csv: '見本データのため実行できません',
  profile: '顧客プロフィールは準備中です',
  merge: '見本データのため、統合・別人確認の記録はできません。実データ接続後に有効になります。',
} as const

/** Canon's own default: the four core columns on, the three optional ones off. */
const DEFAULT_COLUMNS = COLUMNS.filter((c) => !c.optional).map((c) => c.k as string)

// Exported for the suites: "a missing value says 「—」" is the rule the canon
// crash and the ¥0 misread both came from, so it gets asserted directly.
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
export const ticketLabel = (n: number | null) => (n == null || n === 0 ? 'なし' : `残 ${n}回`)
/** null is stated as 「—」, never rendered as ¥0 (⚖ L-6 null-guard). */
export const walletLabel = (n: number | null) => (n == null ? '—' : yen(n))
export const spentLabel = (n: number | null) => (n == null ? '—' : yen(n))
export function consentLabel(c: CustomerRow['consent']): string {
  if (!c) return '—'
  const on = [c.line && 'LINE', c.sms && 'SMS', c.email && 'メール'].filter(Boolean)
  return on.length ? on.join('・') : '同意なし'
}

/** Canon searches 顧客番号 / 氏名 / フリガナ / 携帯番号 / メール
 *  (fable-store-customers.html:685-687, full-rights view). An empty query
 *  matches everything. */
export function matchesCustomerSearch(r: CustomerRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [r.name, r.furigana, r.no, r.phone, r.email].some((v) => v?.toLowerCase().includes(q))
}

/** 検索をクリア: canon puts the caret back in the box after clearing
 *  (fable-store-customers.html:887) — clearing is a step in typing the next
 *  search, not the end of one. */
export function clearSearch(input: HTMLInputElement | null, setSearch: (v: string) => void): void {
  setSearch('')
  input?.focus()
}

/** Canon reopens the dialog EMPTY with the caret in 氏名
 *  (fable-store-customers.html:846-857); a native <dialog> keeps whatever was
 *  typed last time, so the form is reset on the way in. */
export function openCreateDialog(dialog: HTMLDialogElement): void {
  dialog.querySelector('form')?.reset()
  dialog.showModal()
  dialog.querySelector('input')?.focus()
}

/** Escape is native to showModal(); a backdrop click is not, and canon wires
 *  it (fable-store-customers.html:879-881). */
export function closeOnBackdropClick(target: EventTarget | null, dialog: HTMLDialogElement): void {
  if (target === dialog) dialog.close()
}

/**
 * ⚖ §2.6 — THE COMPARE TABLE NEVER RE-DERIVES. Every value is the row's OWN
 * already-formatted string, produced by the same label functions the list and
 * the inspector use, so two rows cannot disagree with the page that lists them.
 *
 * `raw` is `null` when the underlying datum is genuinely absent, and the cell
 * then shows THE FIELD'S OWN null word rather than a new 「未収録」 vocabulary the
 * rest of the room does not speak. A null on either side means NO TAG: two
 * unknowns are not a match, and a row that can only ever read 一致 (the mock's
 * 本人ID, a constant) is off the table entirely — ⚖-ADJ F, because it inflates
 * the match count and teaches nothing.
 */
export function compareFields(r: CustomerRow): Array<{ label: string; raw: string | null; nullWord: string }> {
  return [
    { label: '名前', raw: r.name, nullWord: '—' },
    { label: '顧客番号', raw: r.no, nullWord: '—' },
    { label: '携帯番号', raw: r.phone, nullWord: '未登録' },
    { label: 'メール', raw: r.email, nullWord: '未登録' },
    { label: '登録元', raw: r.source, nullWord: '—' },
    { label: '本人確認', raw: r.identityCheck, nullWord: '未確認' },
    { label: '最終来店', raw: r.lastVisitFull, nullWord: '記録なし' },
    { label: '次回予約', raw: r.hasNext ? `${r.nextLabel} / ${r.nextMenu}` : null, nullWord: 'なし' },
    { label: '回数券', raw: r.ticket == null ? null : ticketLabel(r.ticket), nullWord: 'なし' },
    { label: '預かり残高', raw: r.wallet == null ? null : walletLabel(r.wallet), nullWord: '—' },
    { label: '累計支払', raw: r.totalSpent == null ? null : spentLabel(r.totalSpent), nullWord: '—' },
    { label: '連絡同意', raw: r.consent == null ? null : consentLabel(r.consent), nullWord: '—' },
    {
      label: '来店履歴',
      raw: r.history.length ? r.history.map((h) => `${h.date} ${h.service} ${h.amount}`).join(' / ') : null,
      nullWord: '来店記録なし',
    },
  ]
}

/** The strip's and the dupe box's reason, in the row's own words. The pair's
 *  shared key is the phone number, so the number itself is named where there is
 *  one — a manager who can see WHY two records were paired can judge faster. */
export function dupeReason(r: CustomerRow): string {
  if (r.merge === 'pending') return '統合確認中の候補です'
  return r.phone ? `同じ電話番号 ${r.phone} で候補になりました` : '同じ電話番号で候補になりました'
}

/**
 * ⚠ THE CARD MUST NEVER COVER THE REGION IT IS EXPLAINING, and `spotCardAt`
 * alone cannot promise that: a section TALLER than the viewport (this room's
 * list card at a phone width) leaves no room below it, none above it and none
 * beside it, so the engine's last resort lands the card on top of its own
 * target. MEASURED at 440: the card sat over 顧客一覧 and over the inspector.
 *
 * The rule is the recording room's own (`keepCardOffHeading`, recording.ts:1133)
 * and this is a second copy of it, deliberately: the room's fence forbids
 * reaching into a sibling room's lib, and `guide.ts` is frozen this round. Its
 * right home is `guide.ts` beside `spotCardAt` — a one-function move, named in
 * the report so it is a decision rather than a duplicate nobody logged.
 *
 * A section's heading lives in its first rows, so 64px is the zone that must
 * stay clear; when the card would sit over it, the card goes to whichever
 * viewport edge has more room.
 */
const HEADING_ZONE = 64
function keepCardOffTarget(
  at: { top: number; left: number },
  card: { width: number; height: number },
  target: SpotRect,
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const zoneTop = target.top
  const zoneBottom = target.top + Math.min(HEADING_ZONE, target.height)
  const overlapsX = at.left < target.left + target.width && at.left + card.width > target.left
  const overlapsHeading = at.top < zoneBottom && at.top + card.height > zoneTop
  if (!overlapsX || !overlapsHeading) return at
  const zoneMid = (zoneTop + zoneBottom) / 2
  const room = { top: zoneMid, bottom: viewport.height - zoneMid }
  const top = room.bottom >= room.top ? viewport.height - card.height - 10 : 10
  return { top: Math.max(10, top), left: at.left }
}

const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
})
type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total
const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top &&
  a.left === b.left &&
  a.hole.left === b.hole.left &&
  a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width &&
  a.hole.height === b.hole.height

/** ⚖ §2.10 — the phone band, on the VIEWPORT and honestly so. The shell forces
 *  its 76px rail below 1024, so a page of 635 or less happens at exactly one
 *  viewport width and the two rail states cannot diverge there; every band that
 *  CAN be reached in both rail states is a container query in the sheet. */
const PHONE_QUERY = '(max-width: 711px)'

export function CustomersScreen({ rows, lensLabel, grouped, inboxHref, karuteHref }: CustomersProps) {
  const [added, setAdded] = useState<CustomerRow[]>([])
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(rows[0]?.id ?? null)
  const [shown, setShown] = useState<string[]>(DEFAULT_COLUMNS)
  const [colsOpen, setColsOpen] = useState(false)
  const [openParty, setOpenParty] = useState<string | null>(null)
  /** ⚠ KEYED TO THE ROW, not a bare boolean (the 本人関係 block's own shape, two
   *  lines up). `.cu-insp-body` remounts on a selection change, so a bare flag
   *  left the NEW panel closed by CSS while `aria-expanded` still said open and
   *  the chevron was still rotated — a control describing a state the page was
   *  not in (lessons §A-10). Keyed, the flag is false the moment another row is
   *  selected, in the same render, which is also what the mock does: it rebuilds
   *  the inspector with the collapse closed every time. */
  const [ownOpenFor, setOwnOpenFor] = useState<string | null>(null)
  const [footOpen, setFootOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [compareOf, setCompareOf] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tourIdx, setTourIdx] = useState(-1)

  const dialogRef = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const colsBtnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  const drawerOpenerRef = useRef<HTMLElement | null>(null)
  const inspRef = useRef<HTMLElement>(null)
  const sheetCloseRef = useRef<HTMLButtonElement>(null)
  const sheetOpenerRef = useRef<HTMLElement | null>(null)
  const ownPanelRef = useRef<HTMLDivElement>(null)
  const footPanelRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)

  const all = useMemo(() => [...rows, ...added], [rows, added])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(t)
  }, [toast])

  // 表示する列 popover — wiring lives in wireColumnsPopover (unit-tested
  // directly on real DOM nodes; territory's import fence keeps this file off any
  // renderer, so the effect below is deliberately a thin caller of it).
  useEffect(() => {
    if (!colsOpen || !popRef.current || !colsBtnRef.current) return
    return wireColumnsPopover(popRef.current, colsBtnRef.current, () => setColsOpen(false))
  }, [colsOpen])

  const columns = useMemo(() => COLUMNS.filter((c) => shown.includes(c.k)), [shown])
  const trackStyle = {
    '--fx-wide': columns.map((c) => c.w).join(' '),
    '--fx-narrow': columns.map((c) => c.nw).join(' '),
  } as React.CSSProperties

  /** ⚖ §2.2 — the counts and the rows, from the same predicate over the same
   *  array. `all` includes the client-added rows, so a customer added in this
   *  session is counted by the tile that would reveal them. */
  const counts = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(TILE_PREDICATE) as FilterKey[]).map((k) => [k, all.filter(TILE_PREDICATE[k]).length]),
      ) as Record<FilterKey, number>,
    [all],
  )

  const visible = useMemo(() => {
    // The filter first, the search after it — the sub-line reads
    // 「filtered-and-searched を表示 / この店舗範囲 all」, which is what it says.
    const matched = all.filter((r) => TILE_PREDICATE[filter](r) && matchesCustomerSearch(r, search))
    if (!grouped) return matched
    // Stores in order, then the CM-9 unassigned bucket LAST — it is the
    // exception, not the headline.
    const key = (r: CustomerRow) => r.groupKey || '￿'
    return [...matched].sort((a, b) => key(a).localeCompare(key(b)) || a.no.localeCompare(b.no))
  }, [all, filter, search, grouped])

  const current = all.find((r) => r.id === selected) ?? visible[0] ?? all[0] ?? null
  const offList = current != null && !visible.some((r) => r.id === current.id)

  const candidates = useMemo(() => all.filter((r) => r.merge !== 'none'), [all])
  const byNo = useMemo(() => new Map(all.map((r) => [r.no, r])), [all])

  const comparing = compareOf === null ? null : (all.find((r) => r.id === compareOf) ?? null)
  const partner = comparing?.duplicateOf ? (byNo.get(comparing.duplicateOf) ?? null) : null
  const drawerOpen = comparing !== null
  const tourOpen = tourIdx >= 0

  // ── ⚖ MOTION (the Studio standard: transform/opacity, springs for state) ──
  /** Whether the reader asked for less motion, and whether this is the phone
   *  band. Both read ONCE into state so every spring is constructed with the
   *  same answer and the SSR render (which has no `matchMedia` at all) never
   *  disagrees with the first client frame. */
  const [reduced, setReduced] = useState(false)
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const band = window.matchMedia(PHONE_QUERY)
    const read = () => {
      setReduced(motion.matches)
      setPhone(band.matches)
    }
    read()
    motion.addEventListener('change', read)
    band.addEventListener('change', read)
    return () => {
      motion.removeEventListener('change', read)
      band.removeEventListener('change', read)
    }
  }, [])

  // A band change closes the sheet: leaving the phone band with a sheet "open"
  // would strand its state on a layout that has no sheet in it.
  useEffect(() => {
    if (!phone) setSheetOpen(false)
  }, [phone])

  /** THE SLIDING THUMB — X and W on their own springs, driven by the PRESSED
   *  tile's own offset box, so the wash cannot drift from the tile it is under
   *  when the counts change width. It jumps on first layout, on resize and once
   *  the web fonts land (a thumb measured against fallback metrics is measured
   *  against the wrong tile). */
  const thumbMoveRef = useRef<((jump?: boolean) => void) | null>(null)
  useEffect(() => {
    const tiles = tilesRef.current
    const thumb = thumbRef.current
    if (!tiles || !thumb) return
    const state = { x: 0, w: 100 }
    const paint = () => {
      thumb.style.transform = `translateX(${state.x}px) scaleX(${state.w / 100})`
    }
    const sx = makeSpring((v) => {
      state.x = v
      paint()
    }, { response: 0.3, reduced })
    const sw = makeSpring((v) => {
      state.w = v
      paint()
    }, { response: 0.3, reduced })
    let placed = false
    const move = (jump = false) => {
      const on = tiles.querySelector<HTMLElement>('.cu-tile[aria-pressed="true"]')
      if (!on) {
        thumb.style.opacity = '0'
        return
      }
      thumb.style.opacity = ''
      const x = on.offsetLeft - tiles.scrollLeft
      const w = on.offsetWidth
      if (placed && !jump) {
        sx.set(x)
        sw.set(w)
      } else {
        sx.jump(x)
        sw.jump(w)
        placed = true
      }
    }
    thumbMoveRef.current = move
    move(true)
    // A relayout is not a state change: the thumb belongs under the SAME tile at
    // its new size, so it is re-seated rather than animated there.
    const relayout = () => move(true)
    window.addEventListener('resize', relayout)
    tiles.addEventListener('scroll', relayout)
    if (document.fonts?.ready) void document.fonts.ready.then(() => move(true))
    return () => {
      thumbMoveRef.current = null
      sx.stop()
      sw.stop()
      window.removeEventListener('resize', relayout)
      tiles.removeEventListener('scroll', relayout)
    }
  }, [reduced])

  /** ⚠ THE PRESSED TILE CHANGING IS THE ONE THING THE THUMB TRAVELS FOR, and it
   *  needs its own effect. The spring pair above lives for the whole mount: when
   *  it was re-created on every `filter` change it also re-created `placed =
   *  false`, so the only path that ever ran was the JUMP one — `move(false)` was
   *  unreachable and the wash TELEPORTED between tiles, springs and all. The
   *  effect below is the only caller that animates, and the counts are in its
   *  deps because a tile that changes width moves the tile after it. */
  useLayoutEffect(() => {
    thumbMoveRef.current?.(false)
  }, [filter, counts])

  /** THE COMPARE DRAWER — ONE translateX spring for the whole mount, and it
   *  leaves by the same path it arrived on. It is SEATED closed on creation (a
   *  `jump`, never a travel: a panel that slid out on load would be an overlay
   *  opening in front of a reader who never touched it), and every open and
   *  close after that is a `set` — so a close pressed mid-open REVERSES FROM
   *  WHERE IT IS instead of snapping to the far end first (the Studio standard's
   *  interruptibility, which a spring re-created per state change cannot keep). */
  const drawerSpringRef = useRef<Spring | null>(null)
  useEffect(() => {
    const el = drawerRef.current
    if (!el) return
    const sp = makeSpring((v) => {
      el.style.transform = `translateX(${v}%)`
    }, { response: 0.34, eps: 0.05, reduced })
    sp.jump(100)
    drawerSpringRef.current = sp
    return () => {
      drawerSpringRef.current = null
      sp.stop()
    }
  }, [reduced])
  useEffect(() => {
    // `reduced` rides along so a re-created spring is told the state again; the
    // creation effect above is declared first, so it has already re-seated.
    drawerSpringRef.current?.set(drawerOpen ? 0 : 100)
  }, [drawerOpen, reduced])

  /** THE PHONE SHEET — the same spring shape on translateY.
   *  ⚠ A FRAME STILL RUNNING WHEN THE BAND CHANGES MUST NOT LEAVE A TRANSFORM
   *  BEHIND ON THE DESK LAYOUT (the responsive round's own fix, kept at source):
   *  the apply itself clears the inline transform the moment it is not the phone
   *  band any more. */
  /** THE PHONE SHEET — the same shape on translateY, for the same reasons.
   *  ⚠ A FRAME STILL RUNNING WHEN THE BAND CHANGES MUST NOT LEAVE A TRANSFORM
   *  BEHIND ON THE DESK LAYOUT (the responsive round's own fix, kept at source):
   *  the apply clears the inline transform the moment this is not the phone band
   *  any more, and leaving the band clears it outright. */
  const sheetSpringRef = useRef<Spring | null>(null)
  useEffect(() => {
    const el = inspRef.current
    if (!el) return
    if (!phone) {
      el.style.transform = ''
      return
    }
    const sp = makeSpring((v) => {
      if (!window.matchMedia(PHONE_QUERY).matches) {
        el.style.transform = ''
        return
      }
      el.style.transform = `translateY(${v}%)`
    }, { response: 0.34, eps: 0.05, reduced })
    sp.jump(100)
    sheetSpringRef.current = sp
    return () => {
      sheetSpringRef.current = null
      sp.stop()
    }
  }, [phone, reduced])
  useEffect(() => {
    sheetSpringRef.current?.set(sheetOpen ? 0 : 100)
  }, [sheetOpen, phone, reduced])

  /**
   * ⚖ THE COLLAPSE, AND IT IS THE MOCK'S OWN (`makeCollapse`). A height spring
   * to the panel's measured `scrollHeight`, then `height: auto` AT REST so the
   * open panel keeps growing with its own content. ONE EFFECT PER PANEL, keyed
   * on its own open flag, and the FIRST run jumps rather than animating.
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
      const sp = makeSpring((v) => {
        el.style.height = `${v}px`
      }, {
        response: 0.34,
        reduced,
        onRest: () => {
          if (open) el.style.height = 'auto'
        },
      })
      sp.jump(el.getBoundingClientRect().height)
      sp.set(open ? el.scrollHeight : 0)
      return () => sp.stop()
    }, [ref, open])
  }
  useCollapse(ownPanelRef, ownOpenFor !== null && ownOpenFor === current?.id)
  useCollapse(footPanelRef, footOpen)

  /** PRESS STATES ON POINTER-DOWN, one document listener for the whole room (the
   *  mock's `[data-press]`). Pointer-DOWN, not click: the feedback has to arrive
   *  while the finger is still down or it is not feedback. */
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest?.('[data-press]')
      // ⚠ A REFUSED CONTROL DOES NOT PRESS (⚖ B1-2b). Press feedback says「that
      // worked」, and a control that refuses has nothing to acknowledge — the
      // scale made a dead lever feel live. The sheet states the same refusal so
      // the two cannot drift.
      if (t && t.getAttribute('aria-disabled') !== 'true') t.classList.add('is-pressed')
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

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────
  const tourRectsRef = useRef<SpotRect[]>([])
  const [tourTick, setTourTick] = useState(0)
  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  useLayoutEffect(() => {
    if (tourIdx < 0) {
      setTourStep(null)
      setTourPos(null)
      setTourHover(null)
      return
    }
    // ⚠ SCOPED BY THE ROOM'S OWN CLASS RATHER THAN BY A REF ON THE ROOT: three
    // neighbour pins read the room's root element as an EXACT STRING out of this
    // file, and an attribute written after the class would break the spelling
    // they name. `page-customers` is a class no sibling states, so this lookup
    // finds this room and only this room.
    // ⚠⚠ AND THIS COMMENT DELIBERATELY DOES NOT QUOTE THAT STRING. It used to,
    // and the battery caught what that cost: the neighbour's `toContain` found
    // the literal HERE, in prose, and went on passing while the real root had
    // been renamed. A comment that quotes the thing a pin greps for IS the
    // failure mode those pins are written to prevent.
    const targets = spotTargets(document.querySelector('.page-customers'))
    if (targets.length === 0) {
      setTourIdx(-1)
      return
    }
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
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 170 }
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const at = keepCardOffTarget(spotCardAt(boxOf(r), size, viewport), size, boxOf(r), viewport)
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

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

  const wasTour = useRef(false)
  useEffect(() => {
    if (tourOpen) {
      wasTour.current = true
      tourNextRef.current?.focus()
      return
    }
    if (!wasTour.current) return
    wasTour.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  /** ONE KEYBOARD LISTENER for everything that can be open, INNERMOST FIRST:
   *  the tour owns Escape while it is up (and the arrows walk its ring), then
   *  the compare drawer, then the phone sheet. Two listeners would both fire on
   *  one Escape and close two layers at once (the F5-2 defect). */
  useEffect(() => {
    if (!tourOpen && !drawerOpen && !sheetOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (tourOpen) {
        if (e.key === 'Escape') setTourIdx(-1)
        if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
        if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
        return
      }
      if (e.key !== 'Escape') return
      if (drawerOpen) {
        closeCompare()
        return
      }
      if (sheetOpen) closeSheet()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tourOpen, drawerOpen, sheetOpen])

  // Focus moves INTO the drawer when it opens and back to whatever opened it
  // when it closes — a reader tabbing after a close must not land at <body>.
  useEffect(() => {
    if (drawerOpen) drawerCloseRef.current?.focus()
  }, [drawerOpen])
  useEffect(() => {
    if (sheetOpen) sheetCloseRef.current?.focus()
  }, [sheetOpen])

  function openCompare(id: string, opener: HTMLElement | null) {
    drawerOpenerRef.current = opener
    setSelected(id)
    setCompareOf(id)
  }
  function closeCompare() {
    setCompareOf(null)
    drawerOpenerRef.current?.focus()
    drawerOpenerRef.current = null
  }
  function closeSheet() {
    setSheetOpen(false)
    sheetOpenerRef.current?.focus()
    sheetOpenerRef.current = null
  }

  /** A refused control, spelled ONCE. `aria-disabled` rather than `disabled`:
   *  the control stays focusable so its reason is reachable by keyboard and
   *  screen reader, and the reason rides the ACCESSIBLE NAME as well as the
   *  title. ⚠ THE CLASSES ARE MERGED HERE and a call site must never write
   *  `className` after this spread (the room-5 F-K1 defect, fixed at the helper
   *  so it cannot recur). */
  const refused = (label: string, reason: string, extra?: { className?: string; base?: string | null }) => {
    const { className, base = 'cu-btn' } = extra ?? {}
    return {
      type: 'button' as const,
      'aria-disabled': 'true' as const,
      title: reason,
      'aria-label': `${label} — ${reason}`,
      className: [base, className].filter(Boolean).join(' '),
    }
  }

  function openCreate() {
    if (dialogRef.current) openCreateDialog(dialogRef.current)
  }

  function submitCreate(form: HTMLFormElement) {
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    const phoneValue = String(data.get('phone') ?? '').trim()
    if (!name || !phoneValue) return false
    const seq = 90001 + added.length
    const row: CustomerRow = {
      id: `local-${seq}`,
      no: `C-${seq}`,
      name,
      furigana: String(data.get('kana') ?? '').trim() || null,
      mark: name.split(/\s+/)[0].slice(0, 3),
      phone: phoneValue,
      email: String(data.get('email') ?? '').trim() || null,
      source: String(data.get('source') ?? '店頭登録'),
      identityCheck: null,
      storeLabel: grouped ? '店舗未設定' : null,
      groupKey: '',
      hasNext: false,
      nextLabel: 'なし',
      nextMenu: '予約なし',
      nextDetail: '次回予約なし',
      nextPrice: '予約確定後に記録',
      ticket: null,
      wallet: null,
      lastVisitShort: null,
      lastVisitFull: null,
      totalSpent: 0,
      consent: { line: false, sms: false, email: false },
      lineLinked: false,
      merge: 'none',
      duplicateOf: null,
      party: [],
      thin: false,
      externalOwner: false,
      note: null,
      history: [],
      bookings: [],
      daysSinceLastVisit: null,
      winBack: winBackLine(null),
      lastVisitMeta: '最終来店 記録なし',
      category: 'new',
      categoryChip: null,
      ticketEnding: false,
    }
    setAdded((was) => [...was, row])
    setSelected(row.id)
    setToast(`${name}さんをこの画面の中だけに追加しました。再読み込みすると消えます`)
    return true
  }

  const inspector = current && (
    <InspectorBody
      row={current}
      offList={offList}
      openParty={openParty === current.id}
      onToggleParty={() => setOpenParty((v) => (v === current.id ? null : current.id))}
      ownOpen={ownOpenFor === current.id}
      onToggleOwn={() => setOwnOpenFor((v) => (v === current.id ? null : current.id))}
      ownPanelRef={ownPanelRef}
      onCompare={(e) => openCompare(current.id, e.currentTarget)}
      karuteHref={karuteHref}
      inboxHref={inboxHref}
      refused={refused}
      closeRef={sheetCloseRef}
      onCloseSheet={closeSheet}
    />
  )

  return (
    <div className="page page-customers">
      {/* ⚠ TWO WRAPPERS, AND THE SPLIT IS LOAD-BEARING (⚖-ADJ H). `cu-view` is
          the ROOM'S CONTAINER and carries no padding and no cap, so its inline
          size IS the page width the ladder is written against — a container that
          measured its own padded content box would answer every threshold ~40px
          early, which is exactly the class of defect HARNESS-GEOMETRY exists to
          catch. `cu-inner` holds the 1416 cap and the page's own side padding. */}
      <div className="cu-view">
        <div className="cu-inner">
        {/* ⚖ ONE COMPACT TITLE ROW (Liam F-1「kill the dead space」). The head
            declares itself like every other section, so the walk opens on what
            this page is FOR before it starts pointing at parts of it. */}
        <header
          className="cu-head"
          data-guide-title="顧客"
          data-guide="顧客の本人情報・予約・回数券・残高を確認します。上の数字のタイルはそのまま絞り込みになっていて、押すと一覧がその条件だけになります。"
        >
          <div className="cu-titlerow">
            <span className="cu-eyebrow">{lensLabel} / 運営情報</span>
            <h1>顧客</h1>
            {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR (never the mock's
                popover: the mock's own popover prose IS this page's head guide
                and its provenance rows). A hairline circle, never a filled one
                (⚖ R13). */}
            <button
              className="cu-help"
              type="button"
              ref={helpRef}
              title="画面の説明"
              aria-label="画面の説明"
              aria-haspopup="dialog"
              aria-expanded={tourOpen}
              aria-controls="cuTour"
              onClick={() => setTourIdx(0)}
              data-press
            >
              ?
            </button>
            <span className="cu-subtitle">顧客の本人情報・予約・回数券・残高を確認します。</span>
            <span className="cu-sp" />
            {/* ⚖-ADJ B — the 受信トレイ room exists on main, so this stops being
                a greyed 準備中 and becomes the door it always described. */}
            <Link className="cu-btn" href={inboxHref} data-press>
              受信トレイで連絡
            </Link>
            <button className="cu-btn cu-btn-solid" type="button" onClick={openCreate} data-press>
              顧客を追加
            </button>
          </div>
        </header>

        {/* ⚖ §2.2 — THE STAT TILES ARE THE FILTERS. */}
        <div
          className="cu-tiles"
          ref={tilesRef}
          role="group"
          aria-label="顧客一覧の絞り込み"
          data-guide-title="数字のタイル"
          data-guide="5つのタイルは、この店舗で見えている顧客の数です。押すと、その条件にあてはまる人だけが下の一覧に残ります。タイルの数字と一覧の行数はいつも同じです。"
        >
          <span className={`cu-tile-thumb${filter === 'merge' ? ' is-red' : ''}`} ref={thumbRef} aria-hidden="true" />
          {TILES.map((t) => (
            <button
              key={t.k}
              className={`cu-tile${t.dupe ? ' is-dupe' : ''}`}
              type="button"
              aria-pressed={filter === t.k}
              onClick={(e) => {
                setFilter(t.k)
                if (phone) e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              }}
              data-press
            >
              <span className="cu-tile-k">{t.label}</span>
              <span className="cu-tile-v">
                {counts[t.k]}
                <span className="cu-u">名</span>
              </span>
            </button>
          ))}
        </div>

        {/* ⚖-ADJ C — the strip is NOT rendered at zero candidates. A red-bordered
            card announcing 「重複候補はすべて確認済みです」 is noise on a page
            whose 重複候補 tile already reads 0名. */}
        {candidates.length > 0 && (
          <section
            className="cu-triage"
            aria-labelledby="cuTriageTitle"
            data-guide-title="重複候補"
            data-guide="同じ電話番号などで、同じ方が二重に登録されている可能性のある顧客です。名前を押すと2件を並べて比べられます。自動で統合することはありません。"
          >
            <div className="cu-tstrip">
              <strong className="cu-ttl" id="cuTriageTitle">
                {candidates.length}件の重複候補を先に確認
              </strong>
              <span className="cu-hint">自動統合はしません。並べて見てから判断します。</span>
              <span className="cu-sp" />
              <div className="cu-dpills">
                {candidates.map((r) => (
                  <button
                    key={r.id}
                    className={`cu-dpill${r.merge === 'pending' ? ' is-amber' : ''}`}
                    type="button"
                    onClick={(e) => openCompare(r.id, e.currentTarget)}
                    data-press
                  >
                    <span className="cu-dpill-n">{r.name}</span>
                    <span className="cu-dpill-id">{r.no}</span>
                    <span className="cu-dpill-m">・ {dupeReason(r)}</span>
                    <span className="cu-go">並べて見る</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="workspace">
          <section
            className="cu-list"
            style={trackStyle}
            aria-labelledby="customerListTitle"
            data-guide-title="顧客一覧"
            data-guide="顧客の一覧です。名前・電話・顧客番号で検索でき、表示設定で出す列を増やせます。行を押すと、その方の詳しい内容が開きます。"
          >
            <div className="cu-list-hd">
              <div className="cu-r1">
                <strong className="cu-list-ttl" id="customerListTitle">
                  顧客一覧
                </strong>
                <span className="cu-list-sub" aria-live="polite">
                  {visible.length}名を表示 / この店舗範囲 {all.length}名
                </span>
                <span className="cu-sp" />
                {/* CSV writes a file, which the play phase cannot do. */}
                <button {...refused('表示中をCSV', REFUSAL.csv, { base: null, className: 'cu-linklike' })} data-press>
                  表示中をCSV
                </button>
                <div className="cu-cols">
                  <button
                    className="cu-btn"
                    type="button"
                    ref={colsBtnRef}
                    aria-expanded={colsOpen}
                    aria-haspopup="dialog"
                    onClick={() => setColsOpen((v) => !v)}
                    data-press
                  >
                    表示設定
                  </button>
                  {colsOpen && (
                    <div className="cu-cols-pop" role="dialog" aria-label="表示する列" ref={popRef}>
                      <h3>表示する列</h3>
                      {COLUMNS.map((c) => (
                        <label className="cu-cols-opt" key={c.k}>
                          <input
                            type="checkbox"
                            checked={shown.includes(c.k)}
                            onChange={() => setShown((was) => toggleColumn(was, c.k))}
                          />
                          <span>{c.label}</span>
                        </label>
                      ))}
                      <p className="cu-cols-note">列の表示はこの画面の中だけの設定です。再読み込みすると既定に戻ります。</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="cu-r2">
                <div className="cu-searchbox">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="M16 16l4.5 4.5" />
                  </svg>
                  <input
                    type="search"
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="名前・電話・顧客番号で検索"
                    aria-label="顧客を検索"
                  />
                </div>
                <button className="cu-btn" type="button" onClick={() => clearSearch(searchRef.current, setSearch)} data-press>
                  検索をクリア
                </button>
              </div>
            </div>

            <div className="cu-thead" aria-hidden="true">
              {columns.map((c) => (
                <span key={c.k} className={c.k === 'confirm' ? 'cu-r' : undefined}>
                  {c.label}
                </span>
              ))}
            </div>

            {/* Canon hides the list itself when nothing matches
                (fable-store-customers.html:760), and the empty card takes its
                place rather than sitting under a blank slab. */}
            <div className={`cu-rows${visible.length ? ' is-swap' : ''}`} key={`${filter}`} hidden={visible.length === 0}>
              {visible.map((r, i) => {
                const newGroup = grouped && (i === 0 || visible[i - 1].groupKey !== r.groupKey)
                return (
                  <div key={r.id}>
                    {newGroup && (
                      <div className="cu-group">{r.storeLabel ?? '店舗未設定'} — 顧客IDを共通キーとして店舗別事実を表示</div>
                    )}
                    <button
                      type="button"
                      className={`cu-row${r.id === current?.id ? ' is-sel' : ''}`}
                      aria-pressed={r.id === current?.id}
                      onClick={(e) => {
                        setSelected(r.id)
                        if (phone) {
                          sheetOpenerRef.current = e.currentTarget
                          setSheetOpen(true)
                        }
                      }}
                      data-press
                    >
                      {columns.map((c) => {
                        if (c.k === 'person') {
                          return (
                            <span className="cu-cname" key={c.k}>
                              <span className={`cu-ava${r.mark.length > 2 ? ' is-long' : ''}`}>{r.mark}</span>
                              <span className="cu-cname-t">
                                <span className="cu-nm">
                                  {r.name}
                                  {r.categoryChip && <span className="cu-chip">{r.categoryChip}</span>}
                                </span>
                                <span className="cu-id">
                                  {r.no} / {r.phone ?? '電話未登録'}
                                </span>
                              </span>
                            </span>
                          )
                        }
                        if (c.k === 'next') {
                          return (
                            <span className={`cu-cnext${r.hasNext ? '' : ' is-none'}`} key={c.k}>
                              <span className="cu-a">{r.nextLabel}</span>
                              <span className="cu-b">{r.hasNext ? r.nextMenu : r.winBack}</span>
                            </span>
                          )
                        }
                        if (c.k === 'ticket') {
                          return (
                            <span className="cu-chold" key={c.k}>
                              <span className={`cu-a${r.thin || r.ticket == null || r.ticket === 0 ? ' is-dim' : ''}`}>
                                {r.thin ? '—' : `回数券 ${ticketLabel(r.ticket)}`}
                              </span>
                              <span className={`cu-b${r.thin || r.wallet == null ? ' is-dim' : ''}`}>
                                {r.thin ? '簡易表示のみ' : `残高 ${walletLabel(r.wallet)}`}
                              </span>
                              {r.ticketEnding && <span className="cu-endsoon">次回で使い切り</span>}
                            </span>
                          )
                        }
                        if (c.k === 'confirm') {
                          return (
                            <span className="cu-cstate" key={c.k}>
                              <span
                                className={`cu-pill${
                                  r.thin ? ' is-simple' : r.merge === 'open' ? ' is-dupe' : r.merge === 'pending' ? ' is-merging' : ' is-ok'
                                }`}
                              >
                                {r.thin ? 'サンプル簡易表示' : MERGE_LABEL[r.merge]}
                              </span>
                            </span>
                          )
                        }
                        if (c.k === 'lastVisit') {
                          return (
                            <span className="cu-cnum" key={c.k}>
                              <span className="cu-a">{r.lastVisitShort ?? '—'}</span>
                            </span>
                          )
                        }
                        if (c.k === 'totalSpent') {
                          return (
                            <span className="cu-cnum" key={c.k}>
                              <span className="cu-a">{spentLabel(r.totalSpent)}</span>
                            </span>
                          )
                        }
                        return (
                          <span className="cu-ccons" key={c.k}>
                            <span className="cu-a">{consentLabel(r.consent)}</span>
                          </span>
                        )
                      })}
                    </button>
                  </div>
                )
              })}
            </div>

            {visible.length === 0 && (
              <div className="cu-empty">条件に合う顧客はいません。検索条件かタイルの絞り込みを変えてください。</div>
            )}
          </section>

          {/* ⚖-ADJ E — STICKY AND UNCAPPED. The page scrolls and the inspector
              rides with it; the mock's `.insp-body{overflow-y:auto}` and this
              room's old `.detail{max-height…}` are both retired, which is the
              family's own answer in 受信トレイ / 売上・レジ / カルテ. */}
          {current && (
            <aside
              className={`cu-insp${sheetOpen ? ' is-sheet-on' : ''}`}
              ref={inspRef}
              aria-labelledby="detailTitle"
              data-guide-title="選んだ顧客の内容"
              data-guide="選んだ顧客の詳しい内容です。回数券・預かり残高・累計支払は、この店舗の記録だけを集めた数字です。本人情報や同意のもとになる記録は顧客プロフィールが持っています。"
            >
              {inspector}
            </aside>
          )}
        </div>

        {/* ⚖-ADJ G — the footnote opens DOWNWARD, in flow, on the height spring.
            The mock's absolute upward sheet is an overlay, and this page
            scrolls. */}
        <div
          className={`cu-footnote${footOpen ? ' is-open' : ''}`}
          data-guide-title="値の設定元"
          data-guide="この画面に出ている数字が、どこから来ているかをまとめています。まだつないでいないものは未接続と書いています。"
        >
          <button className="cu-fn-bar" type="button" aria-expanded={footOpen} onClick={() => setFootOpen((v) => !v)} data-press>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6M12 7.6v.6" />
            </svg>
            この画面の値の設定元 ・ 見本データについて
            <span className="cu-sp" />
            <span className="cu-cv" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </button>
          <div className="cu-fn-panel" ref={footPanelRef}>
            <div className="cu-fn-inner">
              <h4>この画面の値の設定元</h4>
              <p className="cu-fn-lead">この画面が出している値の出どころです。まだつないでいないものは「未接続」と書いています。</p>
              <div className="cu-prov">
                <div className="cu-prov-k">顧客の件数・検索・CSV</div>
                <div className="cu-prov-v">検索と一覧には予約・レジの記録だけの方も含みます。件数・検索・CSVは表示できる店舗と項目から導出します。</div>
                <div className="cu-prov-k">本人情報・同意・連絡</div>
                <div className="cu-prov-v">顧客プロフィールが一つに所有します。この一覧は参照と新規顧客追加だけを所有します。</div>
                <div className="cu-prov-k">重複候補の判断</div>
                <div className="cu-prov-v">顧客プロフィールが所有します。自動統合はしません。統合・別人確認の実行は未接続です。</div>
                {/* ⚠ THE OLD WORDING CLAIMED A STORE DIMENSION (⚖ B1-5a) and is
                    not quoted here for the same reason. It was a new-mock string,
                    wrong against the contract: 回数券 has no store column and
                    預かり残高 has no data path at all. */}
                <div className="cu-prov-k">回数券・預かり残高</div>
                <div className="cu-prov-v">回数券はお客様ごとの記録で、店舗ごとには分かれていません。預かり残高は未接続で、ここでは見本の数です。</div>
                {/* The one row the mock lacks, because the product renders the
                    number: D6's lens-scoped sum, explained on the surface. */}
                <div className="cu-prov-k">累計支払</div>
                <div className="cu-prov-v">この店舗の完了した予約の受付価格を合計した額です。他店舗の分は含みません。</div>
                <div className="cu-prov-k">サンプル簡易表示の行</div>
                <div className="cu-prov-v">回数券・残高を含まない見本行です。この一覧では「簡易表示のみ」と出しています。</div>
              </div>
              <div className="cu-samplenote">
                見本データのため、統合・別人確認の記録、連絡、CSV出力、設定の変更はできません。実データ接続後に有効になります。
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* ═══ the compare drawer — the duplicate surface, WORKING ═══ */}
      <div className={`cu-scrim${drawerOpen ? ' is-on' : ''}`} onClick={closeCompare} aria-hidden="true" />
      <section
        className="cu-drawer"
        ref={drawerRef}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
        aria-labelledby="cuDrawerTitle"
        {...(drawerOpen
          ? {
              'data-guide-title': '重複候補の比較',
              'data-guide':
                '2件を項目ごとに並べています。一致と相違のしるしで違いを見つけて、統合するかどうかは人が決めます。ここでの統合と別人確認は、実データにつないだあとで使えるようになります。',
            }
          : {})}
      >
        <div className="cu-dw-hd">
          <div className="cu-dw-t">
            <h2 id="cuDrawerTitle">重複候補の比較</h2>
            <div className="cu-why">
              {comparing
                ? `${comparing.name}（${comparing.no}）${partner ? ` ↔ ${partner.name}（${partner.no}）` : ''} ・ ${dupeReason(comparing)}`
                : ''}
            </div>
          </div>
          <span className="cu-sp" />
          <button className="cu-dw-close" type="button" ref={drawerCloseRef} aria-label="閉じる" onClick={closeCompare} data-press>
            ✕
          </button>
        </div>
        <div className="cu-dw-warn">
          <b>統合する前に必ず確認してください</b>
          本人情報を誤って統合すると、予約・回数券・預かり残高の所有先が変わります。自動統合はしません。
        </div>
        <div className="cu-dw-body">
          {comparing && <CompareTable a={comparing} b={partner} />}
          {comparing && !partner && (
            <div className="cu-nodata cu-dw-nopartner">
              相手のレコードは、この見本データには含まれていません。実データ接続後に相手側の本人情報・予約・回数券・残高・履歴が並びます。
            </div>
          )}
        </div>
        <div className="cu-dw-ft">
          <span className="cu-note">
            共通本人情報と店舗別の予約・回数券・残高・履歴を分けて比較します。{REFUSAL.merge}
          </span>
          <button {...refused('別人として確認', REFUSAL.merge)} data-press>
            別人として確認
          </button>
          <button {...refused('統合する', REFUSAL.merge, { className: 'cu-btn-solid' })} data-press>
            統合する
          </button>
        </div>
      </section>

      <dialog
        ref={dialogRef}
        aria-labelledby="createCustomerTitle"
        onClick={(e) => {
          if (dialogRef.current) closeOnBackdropClick(e.target, dialogRef.current)
        }}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            if (!submitCreate(e.currentTarget)) e.preventDefault()
          }}
        >
          <div className="dialog-head">
            <div>
              <h2 id="createCustomerTitle">新規顧客を追加</h2>
              <p>顧客はサービスを受ける人です。ペットなどの対象は顧客として追加しません</p>
            </div>
            <button className="close" type="button" aria-label="閉じる" onClick={() => dialogRef.current?.close()}>
              ×
            </button>
          </div>
          <div className="dialog-body consent-form">
            <label className="consent-field">
              氏名
              <input name="name" required placeholder="例: 見本 はなこ" />
            </label>
            <label className="consent-field">
              フリガナ
              <input name="kana" placeholder="例: ミホン ハナコ" />
            </label>
            <label className="consent-field">
              携帯番号
              <input name="phone" required placeholder="例: 090-0000-0000" />
            </label>
            <label className="consent-field">
              メール
              <input name="email" placeholder="例: hanako@sample.invalid" />
            </label>
            <label className="consent-field">
              登録元
              <select name="source" defaultValue="店頭登録">
                <option>店頭登録</option>
                <option>電話予約</option>
                <option>Reserve本人登録</option>
                <option>旧CSV移行</option>
              </select>
            </label>
            <div className="merge-proof">
              氏名と携帯番号は必須です。連絡同意は未確認のまま登録し、確認後に別途「同意を更新」から記録します。
            </div>
          </div>
          <div className="dialog-foot">
            <button className="btn" type="button" onClick={() => dialogRef.current?.close()}>
              戻る
            </button>
            <button className="btn primary" type="submit">
              この画面内に顧客を追加
            </button>
          </div>
        </form>
      </dialog>

      <div className={`cu-toast${toast ? ' is-on' : ''}`} role="status" aria-live="polite" aria-atomic="true">
        {toast}
      </div>

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the family's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. */}
      {tourOpen && (
        <>
          <div
            className="cu-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourIdx(hit >= 0 ? hit : -1)
            }}
            onMouseMove={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourHover(hit >= 0 && hit !== tourStep?.idx ? tourRectsRef.current[hit] : null)
            }}
          />
          {tourHover && (
            <div
              className="cu-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div
              className="cu-spot-hole"
              aria-hidden="true"
              style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }}
            />
          )}
          <div
            className="cu-spot-card"
            id="cuTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="cu-spot-text">{tourStep?.text ?? ''}</span>
            <div className="cu-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="cu-spot-foot">
              <button type="button" className="cu-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>
                前へ
              </button>
              <button type="button" className="cu-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="cu-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="cu-spot-done" onClick={() => setTourIdx(-1)}>
                終了 ✕
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** The compare grid. TWO ROWS, ONE FORMATTER: `compareFields` produces both
 *  sides, so a value here can never disagree with the value the list shows. */
function CompareTable({ a, b }: { a: CustomerRow; b: CustomerRow | null }) {
  const left = compareFields(a)
  const right = b ? compareFields(b) : null
  const whoA = `${a.name}（${a.no}）`
  const whoB = b ? `${b.name}（${b.no}）` : '相手のレコード'
  const head = (r: CustomerRow | null) =>
    r ? (
      <div className="cu-chead">
        <div className="cu-chead-id">顧客 {r.no}</div>
        <div className="cu-chead-nm">{r.name}</div>
        <div className="cu-chead-st">
          <span className={`cu-pill${r.thin ? ' is-simple' : r.merge === 'open' ? ' is-dupe' : r.merge === 'pending' ? ' is-merging' : ' is-ok'}`}>
            {r.thin ? 'サンプル簡易表示' : MERGE_LABEL[r.merge]}
          </span>
        </div>
      </div>
    ) : (
      <div className="cu-chead is-empty">
        <div className="cu-chead-id">相手のレコード</div>
        <div className="cu-chead-nm">この見本データには含まれていません</div>
      </div>
    )

  return (
    <>
      <div className="cu-cmp-heads">
        <div className="cu-cmp-spacer" />
        {head(a)}
        {head(b)}
      </div>
      <div className="cu-cmp">
        {left.map((f, i) => {
          const other = right?.[i] ?? null
          const known = f.raw !== null && other !== null && other.raw !== null
          const same = known && f.raw === other!.raw
          const diff = known && !same
          const cell = (v: { raw: string | null; nullWord: string }, who: string) => (
            <div className={`cu-cl${v.raw === null ? ' is-dim' : same ? ' is-same' : diff ? ' is-diff' : ''}`} data-who={who}>
              {v.raw ?? v.nullWord}
            </div>
          )
          return (
            <div className="cu-cmp-row" key={f.label}>
              <div className={`cu-lb${same ? ' is-same' : diff ? ' is-diff' : ''}`}>
                {f.label}
                {same && <span className="cu-tagd is-s">一致</span>}
                {diff && <span className="cu-tagd is-d">相違</span>}
              </div>
              {cell(f, whoA)}
              {other ? cell(other, whoB) : <div className="cu-cl is-dim" data-who={whoB}>—</div>}
            </div>
          )
        })}
      </div>
    </>
  )
}

/** The sectioned inspector's body. One component, one home: the desk column and
 *  the phone sheet are the SAME element in the SAME place in the DOM — only the
 *  sheet's own rules move it — so there is one tour declaration and one set of
 *  sections rather than two that can drift. */
function InspectorBody({
  row,
  offList,
  openParty,
  onToggleParty,
  ownOpen,
  onToggleOwn,
  ownPanelRef,
  onCompare,
  karuteHref,
  inboxHref,
  refused,
  closeRef,
  onCloseSheet,
}: {
  row: CustomerRow
  offList: boolean
  openParty: boolean
  onToggleParty: () => void
  ownOpen: boolean
  onToggleOwn: () => void
  ownPanelRef: React.RefObject<HTMLDivElement | null>
  onCompare: (e: React.MouseEvent<HTMLButtonElement>) => void
  karuteHref: string
  inboxHref: string
  refused: (
    label: string,
    reason: string,
    extra?: { className?: string; base?: string | null },
  ) => { type: 'button'; 'aria-disabled': 'true'; title: string; 'aria-label': string; className: string }
  closeRef: React.RefObject<HTMLButtonElement | null>
  onCloseSheet: () => void
}) {
  const kv = (k: string, v: string, dim = false) => (
    <div className="cu-kvrow" key={k}>
      <span className="cu-kvk">{k}</span>
      <span className={`cu-kvv${dim ? ' is-dim' : ''}`}>{v}</span>
    </div>
  )

  return (
    <>
      <div className="cu-insp-hd">
        <button className="cu-insp-close" type="button" ref={closeRef} aria-label="閉じる" onClick={onCloseSheet} data-press>
          ✕
        </button>
        <div className="cu-eyeb">
          顧客 {row.no}
          {row.thin ? ' ・ サンプル簡易表示' : ''}
        </div>
        <h2 id="detailTitle">{row.name}</h2>
        <div className="cu-meta">
          {row.categoryChip ? `${row.categoryChip} ・ ` : ''}
          {row.furigana ? `${row.furigana} / ` : ''}
          {row.lastVisitMeta}
        </div>
        <div className="cu-qacts">
          <button {...refused('顧客プロフィールを開く', REFUSAL.profile, { base: null, className: 'cu-qbtn' })} data-press>
            顧客プロフィールを開く
          </button>
          {/* ⚖-ADJ B — the カルテ room exists on main; the family's word for it
              is カルテ (the sidebar's own label). */}
          <Link className="cu-qbtn" href={karuteHref} data-press>
            カルテを開く
          </Link>
          <Link className="cu-qbtn" href={inboxHref} data-press>
            受信トレイで連絡
          </Link>
        </div>
      </div>

      <div className="cu-insp-body" key={row.id}>
        {offList && (
          <p className="cu-off-list">選択中の顧客は現在の検索・絞り込みには含まれていません。選択は保持しています。</p>
        )}

        <div className="cu-sec">
          {/* ⚠ THE HEADING CARRIES NO STORE QUALIFIER (⚖ B1-5a, a truth-fix, and
              this comment deliberately does not spell the old wording — a
              comment that quotes what a pin forbids answers for it). The contract says
              回数券 has NO store column and 預かり残高 has no data path at all —
              both are customer-wide, and the fixture carries them as business-wide
              scalars. Only 累計支払 is lens-scoped, so only its own kicker says so. */}
          <span className="cu-lb-k">保有状況</span>
          <div className="cu-holds">
            <div className="cu-hold">
              <span className="cu-hold-k">回数券</span>
              <span className={`cu-hold-v${row.thin || row.ticket == null || row.ticket === 0 ? ' is-dim' : ''}`}>
                {row.thin ? '—' : ticketLabel(row.ticket)}
              </span>
              {row.ticketEnding && <span className="cu-endsoon">次回で使い切り</span>}
            </div>
            <div className="cu-hold">
              <span className="cu-hold-k">預かり残高</span>
              <span className={`cu-hold-v${row.thin || row.wallet == null ? ' is-dim' : ''}`}>
                {row.thin ? '—' : walletLabel(row.wallet)}
              </span>
            </div>
            <div className="cu-hold">
              {/* ⚠ 累計支払 IS BOOKING-DERIVED, so it reads the same on this tile
                  and in the optional column — one truth, two surfaces (⚖ B1-1).
                  The thin mask above belongs to the two PROFILE facts only; it
                  was on this tile too, so なぎ showed 「—」 here and ¥6,600 in the
                  column. `spentLabel` already says 「—」 for the null an external
                  owner produces. */}
              <span className="cu-hold-k">累計支払（この店舗）</span>
              <span className={`cu-hold-v${row.totalSpent == null ? ' is-dim' : ''}`}>
                {spentLabel(row.totalSpent)}
              </span>
            </div>
          </div>
          {row.thin && <p className="cu-thin-note">簡易表示のみ</p>}
        </div>

        {!row.thin && row.merge !== 'none' && (
          <div
            className={`cu-dupebox${row.merge === 'pending' ? ' is-amber' : ''}`}
            data-guide-title="この顧客の重複候補"
            data-guide="この顧客には、同じ方かもしれない別のレコードがあります。並べて確認を押すと、2件を項目ごとに比べられます。"
          >
            <div className="cu-dupebox-t">
              {row.merge === 'pending' ? '統合確認中の重複候補です' : '同じ電話番号の重複候補があります'}
            </div>
            <div className="cu-dupebox-p">
              共通本人情報と店舗別の予約・回数券・残高・履歴を分けて比較します。自動統合はしません。
            </div>
            {row.merge === 'pending' && <div className="cu-dupebox-p">承認までは2つの顧客を別々に保持します。</div>}
            <button className="cu-dupebox-act" type="button" onClick={onCompare} data-press>
              重複候補を並べて確認
            </button>
          </div>
        )}

        <div className="cu-sec">
          <span className="cu-lb-k">本人情報</span>
          <div className="cu-kvbox">
            {kv('顧客番号', row.no)}
            {kv('携帯番号', row.phone ?? '未登録', row.phone == null)}
            {kv('メール', row.email ?? '未登録', row.email == null)}
            {kv('登録元', row.source)}
            {kv('本人確認', row.identityCheck ?? '未確認', row.identityCheck == null)}
            {kv('本人ID', '共通顧客ID')}
            <PartyRows row={row} open={openParty} onToggle={onToggleParty} />
          </div>
        </div>

        {row.thin ? (
          <>
            {row.note && (
              <div className="cu-sec">
                <span className="cu-lb-k">{row.externalOwner ? '編集できない理由' : 'メモ'}</span>
                <div className="cu-nodata">{row.note}</div>
              </div>
            )}
            <div className="cu-sec">
              <span className="cu-lb-k">関連する予約・レジ記録</span>
              {row.bookings.length === 0 ? (
                <div className="cu-nodata">関連する予約はありません</div>
              ) : (
                <div className="cu-hist">
                  {row.bookings.map((b, i) => (
                    <div className="cu-hrow" key={i}>
                      <span className="cu-hd">{b.date}</span>
                      <span className="cu-ht">{b.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <ConsentRows row={row} />
            <div className="cu-sec">
              <span className="cu-lb-k">サンプル簡易表示について</span>
              <div className="cu-nodata">
                {row.externalOwner
                  ? 'この方は予約・レジの運営記録にのみ登場する簡易表示です。本人情報の正本は外部予約元のため、SYNQEDからは編集できません。'
                  : 'この方は予約・レジの運営記録にのみ登場し、本人プロフィールはまだ登録されていません。プロフィール側が本人情報・同意・連絡の操作を一つに所有します。'}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="cu-sec">
              <span className="cu-lb-k">次回予約</span>
              {row.hasNext ? (
                <div className="cu-kvbox">
                  {kv('予約', row.nextDetail)}
                  {kv('受付価格', row.nextPrice)}
                </div>
              ) : (
                <>
                  <div className="cu-nodata">次回の予約はありません。</div>
                  <p className="cu-winback">{row.winBack}</p>
                </>
              )}
            </div>

            <ConsentRows row={row} />

            <div className="cu-sec">
              <span className="cu-lb-k">来店履歴</span>
              {row.history.length === 0 ? (
                <div className="cu-nodata">来店記録はありません。</div>
              ) : (
                <div className="cu-hist">
                  {row.history.map((h, i) => (
                    <div className="cu-hrow" key={i}>
                      <span className="cu-hd">{h.date}</span>
                      <span className="cu-ht">{h.service}</span>
                      <span className="cu-hp">{h.amount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className={`cu-own${ownOpen ? ' is-open' : ''}`}>
          <button className="cu-own-toggle" type="button" aria-expanded={ownOpen} onClick={onToggleOwn} data-press>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v6M12 7.6v.6" />
            </svg>
            正本と操作の所有
            <span className="cu-sp" />
            <span className="cu-cv" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </button>
          <div className="cu-own-panel" ref={ownPanelRef}>
            <div className="cu-own-inner">
              <div className="cu-own-body">
                <div className="cu-own-t">正本と操作の所有</div>
                <div className="cu-own-p">
                  この一覧は参照と新規顧客追加だけを所有します。本人情報・同意・連絡・重複判断は顧客プロフィールが一つに所有します。
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/** 連絡同意 — ONE spelling, rendered by BOTH branches (⚖ B1-1). The thin branch
 *  used to render no section at all while the optional 連絡同意 COLUMN showed
 *  thin-02's recorded SMS consent, so the two surfaces read one ledger two ways.
 *  A recorded consent is a recorded consent whether or not a profile exists.
 *  ⚠ THE THREE PHRASES ARE LITERAL HERE and the 受信トレイ suite greps this file
 *  for them — one home, so a change breaks that room loudly rather than quietly. */
function ConsentRows({ row }: { row: CustomerRow }) {
  // ⚠ TWO DIFFERENT ABSENCES, AND ONLY ONE OF THEM IS SILENT (⚖ V-1).
  //   · A THIN row has no profile, so it has no consent LEDGER to show: the
  //     section does not exist for it, which is the WO-1 shape.
  //   · A REAL customer with nothing recorded HAS a ledger, and the ledger is
  //     empty — 「—」 on all three channels, per §2.5. Returning null for both
  //     made おとは's whole 連絡同意 section vanish rather than say 「nothing has
  //     been recorded」, which is a silence a manager cannot tell from 同意なし.
  if (row.consent == null && row.thin) return null
  const c = row.consent
  return (
    <div className="cu-sec">
      <span className="cu-lb-k">連絡同意</span>
      <div className="cu-consents">
        <div className={`cu-crowc${c?.line ? ' is-yes' : ''}`}>
          <span className="cu-crowc-k">LINE</span>
          <span className="cu-sp" />
          <span className="cu-crowc-v">
            {c == null ? '—' : c.line ? (row.lineLinked ? '同意あり / 連携確認済み' : '同意あり / 連携未確認') : '同意なし'}
          </span>
        </div>
        <div className={`cu-crowc${c?.sms ? ' is-yes' : ''}`}>
          <span className="cu-crowc-k">SMS</span>
          <span className="cu-sp" />
          <span className="cu-crowc-v">{c == null ? '—' : c.sms ? (row.phone ?? '同意あり') : '同意なし'}</span>
        </div>
        <div className={`cu-crowc${c?.email ? ' is-yes' : ''}`}>
          <span className="cu-crowc-k">メール</span>
          <span className="cu-sp" />
          <span className="cu-crowc-v">{c == null ? '—' : c.email ? (row.email ?? '同意あり') : '同意なし'}</span>
        </div>
      </div>
    </div>
  )
}

/** 本人関係 (D8), collapsed per ⚖ cut #7 and restyled to the kv grammar. The
 *  顧客 line always renders; a サービス対象 / 保護者 / 支払者 line renders only
 *  where the fixture says that party is someone else, and carries a 別の方 chip
 *  so the deviation is the thing that catches the eye. Behaviour byte-identical
 *  to the block it replaces. */
function PartyRows({ row, open, onToggle }: { row: CustomerRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <button className="cu-kvrow cu-party-row" type="button" onClick={onToggle} aria-expanded={open}>
        <span className="cu-kvk">本人関係</span>
        <span className="cu-kvv">顧客 {row.name}</span>
      </button>
      {row.party.map((p) => (
        <button className="cu-kvrow cu-party-row" type="button" key={p.role} onClick={onToggle} aria-expanded={open}>
          <span className="cu-kvk">{p.role}</span>
          <span className="cu-kvv">
            {p.name}
            <span className="cu-pill is-warn">別の方</span>
          </span>
        </button>
      ))}
      {open && (
        <div className="cu-party-note">
          {row.party.length === 0
            ? 'サービス対象・保護者・支払者はすべてご本人です。'
            : row.party.map((p) => `${p.role}: ${p.name} — ${p.note}`).join(' / ')}
        </div>
      )}
    </>
  )
}

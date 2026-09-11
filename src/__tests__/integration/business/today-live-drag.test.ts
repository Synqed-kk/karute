/**
 * ⚖ LIVE-WHILE-DRAGGING (2026-09-11) — the layer pins for the four new pieces
 * that let the 60分配置 strip and the word at the cursor answer the PACKING
 * question on every pointer frame.
 *
 * Liam's bar, verbatim: 「every layer is speaking to another layer … each layer
 * needs to work without problems and bugs independently as well.」 So each piece
 * below is exercised ALONE, with hand-built inputs and no screen:
 *
 *   · `gestureAllocator` (M1)  — the gesture's own memo behind the allocator seam
 *   · `handRowStamp`     (M1b) — the repair for the invariance the design assumed
 *   · `packImpossible`   (M2)  — the pigeonhole pre-check at the head of the search
 *   · `cursorWord`       (M4)  — the badge on the card in hand
 *   · `liveChipFace`     (M3)  — the face a chip wears mid-drag
 *   · `bookFor`                — one capacity book per foreign board
 *
 * The cross-layer proofs live beside them: today-rail-halfhour.test.ts
 * §BEHAVIOURAL counts what the surface ASKS, and today-bed-packing.test.ts §B
 * fences which call sites may pack at all.
 */
import { cleanupBlocks, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'
import {
  allocateBed,
  cursorWord,
  gestureAllocator,
  handRowStamp,
  liveChipFace,
  packImpossible,
  sharesStore,
  VERDICT_WORD,
  type LandingVerdict,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { bookFor, type BookCache } from '@/app/[locale]/(business)/business/today/TodayScreen'
import type { DayFrame } from '@/app/[locale]/(business)/business/today/capacity-ledger'

const HOURS: Hours = { open: 540, close: 1200 }
const FRAME: DayFrame = { openMin: HOURS.open, closeMin: HOURS.close, nowMin: 540 }

function item(
  key: string,
  caseId: string | null,
  s: number,
  e: number,
  kind: BoardItem['kind'] = 'booking',
  requiresPrivateRoom = false,
): BoardItem {
  return {
    kind,
    state: kind === 'booking' ? 'confirmed' : null,
    category: kind === 'booking' ? 'repeat' : null,
    ...place(s, e, HOURS),
    title: kind === 'booking' ? '見本 はなこ' : kind === 'cleanup' ? '清掃' : '予定',
    tag: '',
    time: '',
    ticketCat: null,
    ticketCore: null,
    held: false,
    micro: false,
    label: '',
    key,
    caseId,
    ...(requiresPrivateRoom ? { requiresPrivateRoom: true } : {}),
  }
}

function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane {
  return {
    label: over.key,
    sub: '',
    absentNote: null,
    mine: false,
    items: [],
    window: over.group === 'staff' ? { from: HOURS.open, until: HOURS.close } : null,
    untilLabel: over.group === 'staff' ? '20:00' : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

/** `packSearch`'s own preamble, reproduced HERE and only here, so the pure
 *  predicate can be asked directly on a hand-built board. The product never uses
 *  this: it hands `packImpossible` the real `bookings`/`pinsOf` (which is the
 *  point of the signature). Every SOUNDNESS claim below is asserted through
 *  `allocateBed` itself, so a drift between this and the real preamble cannot
 *  hide a defect — it can only make a unit board stop meaning what it says. */
function claimsOf(lanes: BoardLane[], subjectId: string | null, stores: string[] | null) {
  const beds = lanes.filter((l) => l.group === 'beds' && sharesStore(stores, l.stores))
  const bookings: Array<{ room: string; start: number; end: number }> = []
  const pinsOf = new Map<string, Array<{ start: number; end: number }>>()
  for (const l of beds) {
    const rows: Array<{ start: number; end: number }> = []
    for (const i of l.items) {
      if (i.kind === 'cleanup') continue
      if (i.kind !== 'booking') {
        rows.push({ start: i.startMin, end: i.endMin })
        continue
      }
      if (i.caseId == null || i.caseId === subjectId) continue
      bookings.push({ room: l.key, start: i.startMin, end: i.endMin })
    }
    pinsOf.set(l.key, rows)
  }
  return { beds, bookings, pinsOf }
}

const minTailOf = (beds: readonly BoardLane[], cleanup: Record<string, number>) => {
  let m = Infinity
  for (const l of beds) m = Math.min(m, cleanup[l.key] ?? 0)
  return Number.isFinite(m) ? m : 0
}

/** 「would the pre-check prune this ask?」 — the predicate, on a hand-built board.
 *  `stores` is the asking STAFF LANE's own, exactly as `allocateBed` reads it —
 *  `null` means 「no store binding」 and reaches every room, so it can never be
 *  defaulted away or the two sides would be asked about different rooms. */
function pruned(
  lanes: BoardLane[],
  subject: { id: string | null; start: number; end: number },
  cleanup: Record<string, number> = {},
  stores: string[] | null = ['store-a'],
): boolean {
  const { beds, bookings, pinsOf } = claimsOf(lanes, subject.id, stores)
  return packImpossible(beds, bookings, pinsOf, subject, minTailOf(beds, cleanup))
}

// ══ M2 — THE PIGEONHOLE PRE-CHECK ═══════════════════════════════════════════

describe('M2 — `packImpossible`: a NECESSARY condition, never a sufficient one', () => {
  it('(1) every room claimed across the whole window → PRUNED', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-0', group: 'beds', items: [item('r-a', 'a', 600, 660)] }),
      lane({ key: 'bed-1', group: 'beds', items: [item('r-b', 'b', 600, 660)] }),
    ]
    expect(pruned(lanes, { id: 'HAND', start: 600, end: 660 })).toBe(true)
    // …and the implication the whole design rests on: a pruned ask is one the
    // search would have refused anyway.
    expect(
      allocateBed(lanes, {
        id: 'HAND', currentBed: null, stores: ['store-a'], requiresPrivate: false,
        start: 600, end: 660, pack: true, now: 540, cleanupMinutesByBed: {},
      }).laneKey,
    ).toBeNull()
  })

  it('(2) TWO SHORT CLAIMS can share one bed inside one window → NOT pruned', () => {
    // The counter-example that makes window-based fullness the wrong test: every
    // room is busy at SOME point inside [600, 660), and yet neither room is busy
    // across it. On the same 281,952 random asks the window form produced 202
    // real violations and this one produced zero.
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-0', group: 'beds', items: [item('r-a', 'a', 600, 630)] }),
      lane({ key: 'bed-1', group: 'beds', items: [item('r-b', 'b', 630, 660)] }),
    ]
    expect(pruned(lanes, { id: 'HAND', start: 600, end: 660 })).toBe(false)
  })

  it('(3) one free room → NOT pruned (and the search never needed to run)', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-0', group: 'beds', items: [item('r-a', 'a', 600, 660)] }),
      lane({ key: 'bed-1', group: 'beds' }),
    ]
    expect(pruned(lanes, { id: 'HAND', start: 600, end: 660 })).toBe(false)
  })

  it('(4) a DRAWN 清掃 row is the tail of its booking, never a second claim', () => {
    // `packSearch` skips drawn 清掃 and re-derives every claim from the ROOM's
    // own policy. Counting the drawn row as well would charge the turnaround
    // twice and could prune a packable ask.
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-0', group: 'beds', items: [item('r-a', 'a', 540, 600), item('a-cleanup', null, 600, 660, 'cleanup')] }),
      lane({ key: 'bed-1', group: 'beds', items: [item('r-b', 'b', 600, 660)] }),
    ]
    // With the 清掃 counted, bed-0 would be claimed across [600, 660) too and the
    // ask would be pruned. It is not counted, so the honest answer is 「maybe」.
    expect(pruned(lanes, { id: 'HAND', start: 600, end: 660 })).toBe(false)
  })

  it('(5) a `caseId == null` booking is INVISIBLE to the search, so it is invisible here', () => {
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-0', group: 'beds', items: [item('r-ghost', null, 600, 660)] }),
      lane({ key: 'bed-1', group: 'beds', items: [item('r-b', 'b', 600, 660)] }),
    ]
    expect(pruned(lanes, { id: 'HAND', start: 600, end: 660 })).toBe(false)
  })

  it('(6) THE SUBJECT’S OWN drawing on a bed row is not an obstacle to itself', () => {
    // The one in-flight state that would break a per-claim count: the hand drawn
    // onto a row it collides with. It is excluded by `subject.id`, exactly as
    // `blockersOn` excludes it.
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-0', group: 'beds', items: [item('r-a', 'a', 600, 660), item('r-hand', 'HAND', 600, 660)] }),
      lane({ key: 'bed-1', group: 'beds' }),
    ]
    expect(pruned(lanes, { id: 'HAND', start: 600, end: 660 })).toBe(false)
  })

  it('(7) `minTail` is the SMALLEST turnaround, so a claim can never be over-stated', () => {
    const cleanup = { 'bed-0': 0, 'bed-1': 30 }
    const lanes = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-0', group: 'beds', items: [item('r-a', 'a', 600, 660)] }),
      lane({ key: 'bed-1', group: 'beds', items: [item('r-b', 'b', 540, 600)] }),
    ]
    // bed-1's own tail would cover [600, 630) and make it 2-of-2. The bound is
    // the minimum over the rooms, which is 0, so nothing is over-claimed.
    expect(pruned(lanes, { id: 'HAND', start: 600, end: 660 }, cleanup)).toBe(false)
  })

  it('(8) ⚖ ADJUDICATION L1 M-1 — `minTail` spans ALL rooms, not the subject’s own candidates', () => {
    // Lens 1's breaker board. A 個室のみ subject may only use `bed-P`, but the
    // COMPANION relocating out of it is a standard booking and may land in
    // `bed-S` — so a bound taken over the subject's rooms (30) over-states that
    // companion's claim and prunes a board the search packs at k = 1.
    const cleanup = { 'bed-S': 0, 'bed-P': 30 }
    const lanes = [
      lane({ key: 'p-01', group: 'staff', items: [item('b-b1', 'b1', 600, 660), item('b-b2', 'b2', 540, 600)] }),
      lane({ key: 'bed-S', group: 'beds', items: [item('r-b2', 'b2', 540, 600)] }),
      lane({ key: 'bed-P', group: 'beds', roomClass: 'private', items: [item('r-b1', 'b1', 600, 660)] }),
    ]
    expect(pruned(lanes, { id: 'HAND', start: 600, end: 660 }, cleanup)).toBe(false)
    const solved = allocateBed(lanes, {
      id: 'HAND', currentBed: null, stores: ['store-a'], requiresPrivate: true,
      start: 600, end: 660, pack: true, now: 540, cleanupMinutesByBed: cleanup,
    })
    expect({ laneKey: solved.laneKey, moved: solved.reseats.map((r) => `${r.id}:${r.from}→${r.to}`) })
      .toEqual({ laneKey: 'bed-P', moved: ['b1:bed-P→bed-S'] })
  })

  it('(9) ⚖ ADJUDICATION L1 M-2 — a BLOCK over a booking on one room counts ONCE', () => {
    // Lens 1's second breaker board. `today-board` draws every 予約不可 block
    // whose `resource_id` matches onto the bed lane, and nothing stops one
    // overlapping a booking there — so a per-CLAIM count reads bed-0 as two
    // occupied rooms and prunes a board `packSearch` packs at k = 1. The count
    // is per-ROOM, which removes the precondition entirely.
    const lanes = [
      lane({ key: 'p', group: 'staff', stores: ['s'], items: [item('b-a', 'a', 600, 630), item('b-b', 'b', 630, 660)] }),
      lane({ key: 'bed-0', group: 'beds', stores: ['s'], items: [item('r-a', 'a', 600, 630), item('blk', null, 600, 630, 'block')] }),
      lane({ key: 'bed-1', group: 'beds', stores: ['s'], items: [item('r-b', 'b', 630, 660)] }),
    ]
    expect(pruned(lanes, { id: 'HAND', start: 600, end: 660 }, {}, ['s'])).toBe(false)
    const solved = allocateBed(lanes, {
      id: 'HAND', currentBed: null, stores: ['s'], requiresPrivate: false,
      start: 600, end: 660, pack: true, now: 540, cleanupMinutesByBed: {},
    })
    expect({ laneKey: solved.laneKey, moved: solved.reseats.map((r) => `${r.id}:${r.from}→${r.to}`) })
      .toEqual({ laneKey: 'bed-1', moved: ['b:bed-1→bed-0'] })
  })

  it('(10) a store with no rooms at all is impossible by definition, and a zero-length ask is not', () => {
    expect(packImpossible([], [], new Map(), { start: 600, end: 660 }, 0)).toBe(true)
    const beds = [lane({ key: 'bed-0', group: 'beds' })]
    expect(packImpossible(beds, [], new Map(), { start: 600, end: 600 }, 0)).toBe(false)
  })
})

// ══ M1 — THE GESTURE MEMO ═══════════════════════════════════════════════════

const memoAsk = (over: Partial<Parameters<typeof allocateBed>[1]> = {}) => ({
  id: 'HAND' as string | null,
  currentBed: null as string | null,
  stores: ['store-a'] as string[] | null,
  requiresPrivate: false,
  start: 600,
  end: 660,
  stagedId: null as string | null,
  pack: true,
  now: 540 as number | null,
  cleanupMinutesByBed: {} as Record<string, number>,
  ...over,
})

function memoBoard(): BoardLane[] {
  return [
    lane({ key: 'p-01', group: 'staff', items: [item('b-a', 'a', 600, 660)] }),
    lane({ key: 'bed-0', group: 'beds', items: [item('r-a', 'a', 600, 660)] }),
    lane({ key: 'bed-1', group: 'beds' }),
  ]
}

describe('M1 — `gestureAllocator`: the memo changes what an ask COSTS, never what it ANSWERS', () => {
  function rig(over: { board?: () => BoardLane[]; rowStamp?: () => string; stamp?: () => object } = {}) {
    const lanes = memoBoard()
    let calls = 0
    const base: typeof allocateBed = (l, o) => {
      calls += 1
      return allocateBed(l, o)
    }
    const stampObj = {}
    const memo = gestureAllocator({
      handId: 'HAND',
      stamp: over.stamp ?? (() => stampObj),
      board: over.board ?? (() => lanes),
      rowStamp: over.rowStamp ?? (() => 'row'),
      base,
    })
    return { lanes, memo, calls: () => calls }
  }

  it('GATE 1 — only the hand’s own PACKING question is memoised; everything else passes through', () => {
    const r = rig()
    // The hand's packing question: one search, then hits.
    r.memo.allocate(r.lanes, memoAsk())
    r.memo.allocate(r.lanes, memoAsk())
    expect({ calls: r.calls(), hits: r.memo.hits(), misses: r.memo.misses(), passes: r.memo.passes() })
      .toEqual({ calls: 1, hits: 1, misses: 1, passes: 0 })
    // The rail's own probes (`pack` absent), somebody else's question, and a
    // `pack: false` re-judge are all handed straight to the base allocator.
    r.memo.allocate(r.lanes, memoAsk({ pack: undefined }))
    r.memo.allocate(r.lanes, memoAsk({ pack: false }))
    r.memo.allocate(r.lanes, memoAsk({ id: 'SOMEBODY-ELSE' }))
    r.memo.allocate(r.lanes, memoAsk({ id: null }))
    expect({ calls: r.calls(), passes: r.memo.passes(), size: r.memo.size() })
      .toEqual({ calls: 5, passes: 4, size: 1 })
  })

  it('GATE 2 — another BOARD FAMILY is never served this family’s answer', () => {
    // `verdictAtLanding` re-judges on `applyBedMoves(base, companions…)` and a
    // staged re-drag solves on `lanesWithCompanionsRestored(...)`. Same question,
    // different board — so the identity compare is what keeps them apart.
    const r = rig()
    r.memo.allocate(r.lanes, memoAsk())
    const foreign = memoBoard()
    r.memo.allocate(foreign, memoAsk())
    expect({ calls: r.calls(), passes: r.memo.passes(), size: r.memo.size() })
      .toEqual({ calls: 2, passes: 1, size: 1 })
  })

  it('a HIT returns the very same frozen object — the promise is identity, not a re-derivation', () => {
    const r = rig()
    const first = r.memo.allocate(r.lanes, memoAsk())
    const again = r.memo.allocate(r.lanes, memoAsk())
    expect(again).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('the KEY separates every fact the allocator reads, `allowBusy` included', () => {
    const r = rig()
    const asks = [
      memoAsk(),
      memoAsk({ start: 630, end: 690 }),
      memoAsk({ currentBed: 'bed-1' }),
      memoAsk({ requiresPrivate: true }),
      memoAsk({ stores: ['store-b'] }),
      memoAsk({ stagedId: 'staged-1' }),
      memoAsk({ now: 900 }),
      memoAsk({ allowBusy: true }),
    ]
    for (const a of asks) r.memo.allocate(r.lanes, a)
    expect({ size: r.memo.size(), misses: r.memo.misses() }).toEqual({ size: asks.length, misses: asks.length })
  })

  it('the WORLD STAMP empties it — a change to anything but the hand restarts the gesture', () => {
    let stamp = {}
    const r = rig({ stamp: () => stamp })
    r.memo.allocate(r.lanes, memoAsk())
    expect(r.memo.size()).toBe(1)
    stamp = {}
    r.memo.allocate(r.lanes, memoAsk())
    expect({ size: r.memo.size(), calls: r.calls(), hits: r.memo.hits() }).toEqual({ size: 1, calls: 2, hits: 0 })
  })

  it('the HAND-ROW STAMP empties it, and says so on its own counter', () => {
    let row = 'row-1'
    const r = rig({ rowStamp: () => row })
    r.memo.allocate(r.lanes, memoAsk())
    expect(r.memo.rowClears()).toBe(0)
    row = 'row-2'
    r.memo.allocate(r.lanes, memoAsk())
    expect({ clears: r.memo.rowClears(), calls: r.calls(), hits: r.memo.hits() })
      .toEqual({ clears: 1, calls: 2, hits: 0 })
  })

  it('`free()` leaves nothing behind', () => {
    const r = rig()
    r.memo.allocate(r.lanes, memoAsk())
    r.memo.free()
    expect(r.memo.size()).toBe(0)
    // …and the next ask after a free is a genuine search, not a resurrected entry.
    r.memo.allocate(r.lanes, memoAsk())
    expect({ calls: r.calls(), size: r.memo.size() }).toEqual({ calls: 2, size: 1 })
  })
})

// ══ M1b — THE HAND-ROW STAMP ════════════════════════════════════════════════

describe('M1b — `handRowStamp`: the fingerprint of the one row a drag perturbs', () => {
  const rowBoard = (over: BoardItem[] = []) => [
    lane({ key: 'p-01', group: 'staff' }),
    lane({
      key: 'bed-0',
      group: 'beds',
      items: [item('r-hand', 'HAND', 600, 660), item('HAND-cleanup', null, 660, 675, 'cleanup'), ...over],
    }),
    lane({ key: 'bed-1', group: 'beds', items: [item('r-b', 'b', 600, 660)] }),
  ]

  it('the hand’s OWN two drawings are excluded, so sliding the card does not clear the memo', () => {
    const a = handRowStamp(rowBoard(), 'HAND', 'bed-0')
    const moved = [
      lane({ key: 'p-01', group: 'staff' }),
      lane({ key: 'bed-0', group: 'beds', items: [item('r-hand', 'HAND', 780, 840), item('HAND-cleanup', null, 840, 855, 'cleanup')] }),
      lane({ key: 'bed-1', group: 'beds', items: [item('r-b', 'b', 600, 660)] }),
    ]
    expect(handRowStamp(moved, 'HAND', 'bed-0')).toBe(a)
  })

  it('ANY OTHER item on the hand’s row changes it — which is the whole defect it repairs', () => {
    // `withTrailingCleanup` clips every tail against the next BOOKING on the row,
    // and the hand's own live drawing is one of those bookings. So as the hand
    // slides it shortens and re-grows OTHER customers' turnarounds, and
    // `allocateBed.blockersOn` counts drawn 清掃 rows: the same question gets
    // different answers on different frames of ONE gesture.
    const short = handRowStamp(rowBoard([item('r-c', 'c', 540, 570), item('c-cleanup', null, 570, 580, 'cleanup')]), 'HAND', 'bed-0')
    const grown = handRowStamp(rowBoard([item('r-c', 'c', 540, 570), item('c-cleanup', null, 570, 585, 'cleanup')]), 'HAND', 'bed-0')
    expect(short).not.toBe(grown)
    // …and a change on ANOTHER room's row does not: the perturbation is confined
    // to the one bed lane the hand is drawn on.
    const elsewhere = rowBoard()
    elsewhere[2] = lane({ key: 'bed-1', group: 'beds', items: [item('r-b', 'b', 630, 690)] })
    expect(handRowStamp(elsewhere, 'HAND', 'bed-0')).toBe(handRowStamp(rowBoard(), 'HAND', 'bed-0'))
  })

  it('no bed row, or a row that is not on this board, answers without reading items', () => {
    expect(handRowStamp(rowBoard(), 'HAND', null)).toBe('')
    expect(handRowStamp(rowBoard(), 'HAND', 'bed-99')).toBe('bed-99')
  })
})

// ══ M4 / M3 — THE TWO FACES ═════════════════════════════════════════════════

const verdictOf = (kind: LandingVerdict['kind'], reseats: LandingVerdict['reseats'] = []): LandingVerdict => ({
  kind,
  floor: null,
  label: VERDICT_WORD[kind],
  reason: null,
  cell: null,
  bedLane: null,
  checks: [],
  reseats,
})

const RESEAT = [{ id: 'other', from: 'bed-0', to: 'bed-1' }] as const

describe('M4 — `cursorWord`: the five rows of the badge table', () => {
  it('three answers are byte-unchanged and two are new', () => {
    expect(cursorWord(null)).toEqual({ text: '', kind: '' })
    expect(cursorWord(verdictOf('clean'))).toEqual({ text: '', kind: '' })
    expect(cursorWord(verdictOf('caution'))).toEqual({ text: '要確認', kind: 'caution' })
    expect(cursorWord(verdictOf('blocked'))).toEqual({ text: '置けない', kind: 'blocked' })
    // A landing that moves other customers' beds is not nothing.
    expect(cursorWord(verdictOf('clean', RESEAT))).toEqual({ text: '⇄ 入れ替え', kind: 'reseat' })
    // ⇄ says the COST; 要確認 keeps its RANK.
    expect(cursorWord(verdictOf('caution', RESEAT))).toEqual({ text: '⇄ 要確認', kind: 'reseat-caution' })
  })

  it('a REFUSED landing wears its own word even when it carries re-seats', () => {
    // `landingVerdict` carries `reseats` on a refused verdict too — the guard is
    // re-asked on the board WITH them applied, so the shuffle's own cost can be
    // what refuses the landing. 置けない outranks ⇄.
    expect(cursorWord(verdictOf('blocked', RESEAT))).toEqual({ text: '置けない', kind: 'blocked' })
  })

  it('nothing is coined — 入れ替え and 要確認 are both already on this board', () => {
    expect(cursorWord(verdictOf('caution', RESEAT)).text).toContain(VERDICT_WORD.caution)
    expect(cursorWord(verdictOf('clean', RESEAT)).text).toContain('入れ替え')
  })
})

describe('M3 — `liveChipFace`: the face composes from the DROP’s own verdict', () => {
  it('the whole table, with the mark narrowed to what the chip can actually wear', () => {
    const at = 780
    const rows = [
      ['clean, nobody moves', verdictOf('clean'), verdictOf('clean'), { mark: null, state: 'safe', face: '✓13:00' }],
      ['caution, nobody moves', verdictOf('caution'), verdictOf('caution'), { mark: null, state: 'degraded', face: '△13:00' }],
      ['refused', verdictOf('blocked'), verdictOf('blocked'), { mark: null, state: 'blocked', face: '×' }],
      ['fits by moving somebody, cleanly', verdictOf('clean', RESEAT), verdictOf('clean', RESEAT),
        { mark: { face: 'reseat', tone: 'safe' }, state: 'safe', face: '⇄13:00' }],
      ['fits by moving somebody, at a cost', verdictOf('clean', RESEAT), verdictOf('caution', RESEAT),
        { mark: { face: 'reseat', tone: 'degraded' }, state: 'degraded', face: '⇄13:00' }],
    ] as const
    for (const [name, v, final, want] of rows) {
      expect({ name, ...liveChipFace({ v, final, start: at }) }).toEqual({ name, ...want })
    }
  })

  it('⚖ RULING 3’s third arm holds BY CONSTRUCTION: a shuffle the drop refuses wears ×', () => {
    // `v` is judged on THIS frame's board, `final` on the board the shuffle would
    // leave. A chip whose shuffle the drop would refuse used to be able to show ✓
    // while the release said 置けない — the flag-54 disagreement this round exists
    // to remove. Passing the FINAL verdict makes it unsayable.
    expect(liveChipFace({ v: verdictOf('clean', RESEAT), final: verdictOf('blocked'), start: 780 }))
      .toEqual({ mark: null, state: 'blocked', face: '×' })
  })

  it('the mark is narrowed on the MEMO’s own verdict, so a staff-clashed chip never wears ⇄', () => {
    // A staff clash outranks the room, so the chip comes back `blocked` with its
    // `reseats` carried — no mark, and no re-judge is worth paying for it.
    expect(liveChipFace({ v: verdictOf('blocked', RESEAT), final: verdictOf('blocked', RESEAT), start: 780 }).mark).toBeNull()
  })
})

// ══ bookFor — ONE BOOK PER FOREIGN BOARD ════════════════════════════════════

describe('`bookFor` — one capacity book per lanes array, and it dies with the board', () => {
  const board = () => [
    lane({ key: 'p-01', group: 'staff', items: [item('b-a', 'a', 600, 660)] }),
    lane({ key: 'bed-0', group: 'beds', items: [item('r-a', 'a', 600, 660)] }),
  ]

  it('the SAME array with the same frame and the same lift is built once', () => {
    const cache: BookCache = new WeakMap()
    const lanes = board()
    expect(bookFor(lanes, FRAME, 'a', cache)).toBe(bookFor(lanes, FRAME, 'a', cache))
  })

  it('a DIFFERENT array is a different book', () => {
    const cache: BookCache = new WeakMap()
    expect(bookFor(board(), FRAME, 'a', cache)).not.toBe(bookFor(board(), FRAME, 'a', cache))
  })

  it('a different LIFT on the same array rebuilds — each door keeps its own', () => {
    // `bedDoorFor` asks with the frame's hand and `newClientDoorMinus` with the
    // id it was told to lift; one record per array, replaced rather than shared,
    // so a caller asking about nobody can never be handed somebody's lifted world.
    const cache: BookCache = new WeakMap()
    const lanes = board()
    const withHand = bookFor(lanes, FRAME, 'a', cache)
    const withNobody = bookFor(lanes, FRAME, null, cache)
    expect(withNobody).not.toBe(withHand)
    expect(withNobody.worldMinusHand).toBeNull()
    expect(withHand.worldMinusHand).not.toBeNull()
  })

  it('a different FRAME rebuilds', () => {
    const cache: BookCache = new WeakMap()
    const lanes = board()
    const a = bookFor(lanes, FRAME, 'a', cache)
    expect(bookFor(lanes, { ...FRAME, nowMin: 900 }, 'a', cache)).not.toBe(a)
  })
})

// ══ THE SOUNDNESS SWEEP — pruned ⇒ the allocator refuses ════════════════════

/** mulberry32 — the same scene twice, on demand. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Scene {
  lanes: BoardLane[]
  staffKeys: string[]
  bedKeys: string[]
  cleanup: Record<string, number>
  hand: { id: string; bed: string }
}

/** A small random day: 1-3 stores, 2-5 staff, 2-5 rooms, up to 9 bookings, some
 *  private rooms and private bookings, per-room turnarounds, and — ⚖
 *  ADJUDICATION L1 M-2 — an occasional 予約不可 block drawn WITHOUT checking
 *  whether it lands on top of a booking, because `today-board` draws them that
 *  way and that is exactly the state a per-claim count would over-prune. Bed
 *  rows are built through the product's own `cleanupBlocks`. */
function scene(seed: number): Scene | null {
  const r = rng(seed)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
  const stores = ['s-a', 's-b', 's-c'].slice(0, 1 + Math.floor(r() * 3))
  const nStaff = 2 + Math.floor(r() * 4)
  const nBeds = 2 + Math.floor(r() * 4)
  const staffKeys = Array.from({ length: nStaff }, (_, i) => `p-${i}`)
  const bedKeys = Array.from({ length: nBeds }, (_, i) => `bed-${i}`)
  const staffStores = staffKeys.map(() => (r() < 0.15 ? null : [pick(stores)]))
  const bedStores = bedKeys.map(() => [pick(stores)])
  const bedClass = bedKeys.map(() => (r() < 0.25 ? 'private' : 'standard') as BoardLane['roomClass'])
  const cleanup: Record<string, number> = {}
  for (const k of bedKeys) cleanup[k] = pick([0, 10, 15, 20])

  const staffItems: BoardItem[][] = staffKeys.map(() => [])
  const bedItems: BoardItem[][] = bedKeys.map(() => [])
  const bedRows: Array<Array<{ id: string; start: number; end: number }>> = bedKeys.map(() => [])
  const placed: Array<{ id: string; bed: number }> = []

  for (let n = 0; n < Math.floor(r() * 10); n += 1) {
    const dur = pick([30, 60, 90])
    const start = 540 + 30 * Math.floor(r() * 20)
    const end = start + dur
    if (end > HOURS.close) continue
    const bed = Math.floor(r() * nBeds)
    const staff = Math.floor(r() * nStaff)
    const priv = r() < 0.2
    if (priv && bedClass[bed] !== 'private') continue
    if (!sharesStore(staffStores[staff], bedStores[bed])) continue
    const tail = cleanup[bedKeys[bed]]
    // No BOOKING claim overlap on a room and no double-booked person: the two
    // things core really does enforce.
    if (bedRows[bed].some((x) => start < x.end + tail && x.start < end + tail)) continue
    if (staffItems[staff].some((x) => start < x.endMin && x.startMin < end)) continue
    const id = `c-${n}`
    staffItems[staff].push(item(`b-${id}`, id, start, end, 'booking', priv))
    bedItems[bed].push(item(`r-${id}`, id, start, end, 'booking', priv))
    bedRows[bed].push({ id, start, end })
    placed.push({ id, bed })
  }
  if (placed.length === 0) return null

  for (let b = 0; b < nBeds; b += 1) {
    if (r() > 0.25) continue
    const start = 540 + 30 * Math.floor(r() * 20)
    bedItems[b].push(item(`blk-${b}`, null, start, start + 30, 'block'))
  }
  for (let b = 0; b < nBeds; b += 1) {
    for (const c of cleanupBlocks(bedRows[b], cleanup[bedKeys[b]], HOURS)) {
      bedItems[b].push(item(c.id, null, c.start, c.end, 'cleanup'))
    }
  }

  const h = placed[Math.floor(r() * placed.length)]
  return {
    lanes: [
      ...staffKeys.map((k, i) => lane({ key: k, group: 'staff', items: staffItems[i], stores: staffStores[i] })),
      ...bedKeys.map((k, i) => lane({ key: k, group: 'beds', items: bedItems[i], stores: bedStores[i], roomClass: bedClass[i] })),
    ],
    staffKeys,
    bedKeys,
    cleanup,
    hand: { id: h.id, bed: bedKeys[h.bed] },
  }
}

describe('the pre-check is SOUND — a pruned ask is one the search would have refused', () => {
  it('random boards: 0 violations, and the pruning is real', () => {
    const N = Number(process.env.LIVEDRAG_PRECHECK ?? '10000')
    let boards = 0
    let asks = 0
    let prunedCount = 0
    let violations = 0
    let first: string | null = null

    for (let seed = 1; boards < N && seed < N * 8; seed += 1) {
      const sc = scene(seed)
      if (!sc) continue
      boards += 1
      const r = rng(seed ^ 0x5bf03635)
      for (const lk of sc.staffKeys) {
        const staff = sc.lanes.find((l) => l.key === lk && l.group === 'staff')!
        // ⚖ ADJUDICATION L1 M-4 — the 個室のみ axis and the clock are drawn, not
        // frozen: both change which rooms the search may use and which bookings
        // it may move.
        const requiresPrivate = r() < 0.3
        const now = r() < 0.5 ? HOURS.open : 540 + 30 * Math.floor(r() * 20)
        const start = 540 + 30 * Math.floor(r() * 20)
        const end = start + 60
        if (end > HOURS.close) continue
        asks += 1
        if (!pruned(sc.lanes, { id: sc.hand.id, start, end }, sc.cleanup, staff.stores)) continue
        prunedCount += 1
        const solved = allocateBed(sc.lanes, {
          id: sc.hand.id,
          currentBed: sc.hand.bed,
          stores: staff.stores,
          requiresPrivate,
          start,
          end,
          pack: true,
          now,
          cleanupMinutesByBed: sc.cleanup,
        })
        if (solved.laneKey !== null) {
          violations += 1
          if (first == null) {
            first = `seed=${seed} lane=${lk} start=${start} private=${requiresPrivate} now=${now} → ${solved.laneKey}`
          }
        }
      }
    }

    expect({ violations, first }).toEqual({ violations: 0, first: null })
    // …and the check is alive rather than trivially true.
    expect(boards).toBeGreaterThanOrEqual(N)
    expect(prunedCount).toBeGreaterThan(0)
    expect(asks).toBeGreaterThan(prunedCount)
  })
})

/**
 * @jest-environment jsdom
 *
 * ⚖ 9/8 PACKING — 今日の運営's bed allocator, second step.
 *
 * Liam's finding (2026-09-08): stretching きり to 14:00〜15:00 was refused
 * 満室 while moving さくら one bed over by hand and stretching again worked.
 * The board should have moved さくら itself. `allocateBed(…, { pack: true })`
 * is that search, and this file is its proof.
 *
 * TWO KINDS OF PROOF, deliberately:
 *   · NAMED SCENES — Liam's own board (built through the product's real data
 *     doors, never hand-typed) plus the counter-scenes the four design lenses
 *     found. Each one states a rule in the vocabulary the operator lives in.
 *   · A SEEDED BATTERY — 2,400 generated days answered against an exhaustive
 *     brute-force oracle written independently of the search. A search that
 *     refuses a packable day, seats somebody on top of somebody else, moves one
 *     person more than it had to, or touches a bystander fails here.
 *
 * The oracle is in this file on purpose: an oracle that imported the search's
 * own helpers could only ever agree with it.
 */
import { appointments, STORE_A } from '@/business/lib/fixtures'
import { jstDayKey } from '@/business/lib/clock'
import * as data from '@/business/lib/data'
import { buildLanes, dayBookings, minuteOf, place, type BoardItem, type BoardLane, type BuildInput } from '@/business/lib/today-board'
import {
  allocateBed,
  applyBedMoves,
  applyMoves,
  companionLines,
  companionRoomStillFree,
  companionsFor,
  isStagedCard,
  landingVerdict,
  lanesWithCompanionsRestored,
  vacateBeforeOccupy,
  type BedCompanion,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HOURS = { open: 600, close: 1140 } // 10:00–19:00

/** Every bed in these scenes turns around instantly unless the case says
 *  otherwise — the shipped fixture's own `cleanup_minutes: 0`. */
const NO_CLEANUP: Record<string, number> = {}

function booking(over: Partial<BoardItem> & Pick<BoardItem, 'key' | 'caseId'>, start: number, end: number): BoardItem {
  return {
    kind: 'booking', state: 'confirmed', category: 'repeat',
    ...place(start, end, HOURS),
    title: '見本 はなこ', tag: '', time: '',
    ticketCat: '単発', ticketCore: null, held: false, micro: false,
    label: '', ...over,
  }
}

function lane(over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane {
  return {
    label: over.key, sub: '', absentNote: null, mine: false, items: [],
    window: over.group === 'staff' ? { from: HOURS.open, until: HOURS.close } : null,
    untilLabel: over.group === 'staff' ? '19:00' : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: over.group === 'staff' ? ['store-a'] : ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }
}

/** One staff lane carrying every booking on the board, so the pack can read each
 *  one's store the way the real board carries it (a room hosts only its own
 *  store's bookings). Rooms are the lanes handed in. */
function boardOf(beds: BoardLane[], subjectId: string | null = null): BoardLane[] {
  const seen = new Set<string>()
  const staffItems: BoardItem[] = []
  for (const b of beds) {
    for (const i of b.items) {
      if (i.kind !== 'booking' || !i.caseId || seen.has(i.caseId)) continue
      seen.add(i.caseId)
      staffItems.push({ ...i, key: `${i.caseId}-staff` })
    }
  }
  if (subjectId && !seen.has(subjectId)) staffItems.push(booking({ key: `${subjectId}-staff`, caseId: subjectId }, 600, 630))
  return [lane({ key: 'p-01', group: 'staff', items: staffItems }), ...beds]
}

const packAsk = (over: Partial<Parameters<typeof allocateBed>[1]> = {}) => ({
  id: 'SUBJECT' as string | null,
  currentBed: null as string | null,
  stores: ['store-a'] as string[] | null,
  requiresPrivate: false,
  start: 780,
  end: 840,
  pack: true,
  now: null as number | null,
  cleanupMinutesByBed: NO_CLEANUP,
  ...over,
})

// ── R1 — LIAM'S OWN SCENE, ON THE PRODUCT'S OWN BOARD ──────────────────────

/** THE PRODUCT'S OWN BOARD, built exactly as page.tsx builds it — the data
 *  doors, the full appointments list, `buildLanes(input, dayBookings(input))`.
 *  Liam's shot is on this board, so the pin that answers for it is too. */
let DEMO: BoardLane[] | null = null
async function demoLanes(): Promise<BoardLane[]> {
  if (DEMO) return DEMO
  const lens = STORE_A
  const apts = appointments()
  const dayKey = jstDayKey(apts.find((a) => a.id === 'apt-29')!.starts_at)
  const [custs, menus, staffList, beds, planes, shell, storeOptions, staffStores] = await Promise.all([
    data.listCustomers(lens), data.listMenus(lens), data.listStaff(lens),
    data.listResources(lens), data.readDayPlanes(lens, dayKey), data.readShellIdentity(),
    data.listStoreOptions(), data.readStaffStores(lens),
  ])
  const input: BuildInput = {
    appointments: apts, customers: custs, menus, staff: staffList, resources: beds,
    shifts: planes.shifts, qualifications: planes.staffQualifications,
    staffListPrice: planes.staffListPrice, staffStores, absence: planes.absence,
    blocks: planes.blocks, sellSlots: planes.sellSlots, decisions: planes.decisions,
    hours: planes.operatingHours, dayKey,
    operatorStaffId: shell.operator.staff_id,
    storeNames: new Map(storeOptions.map((s) => [s.id, s.name])),
    crossStore: false,
  }
  DEMO = buildLanes(input, dayBookings(input))
  return DEMO
}

describe('R1 — きり’s stretch, on the real fixture board', () => {
  /** きり (apt-09) carries no bed in the fixture and runs 14:05〜14:25; the ask
   *  is the one the repro ran — `currentBed: 'bed-01'`, 14:00〜15:00 — because
   *  `allocateBed` self-excludes the card either way and the allocator's answer
   *  is identical. ベッド1 is さくら's hold 14:30〜15:30, ベッド2 is かえる until
   *  14:30, ベッド3 is なぎ 14:05〜15:05 (個室のみ). */
  const kiri = async (over: Partial<Parameters<typeof allocateBed>[1]> = {}) => {
    const lanes = await demoLanes()
    const staff = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === 'apt-09'))!
    return allocateBed(lanes, {
      id: 'apt-09', currentBed: 'bed-01', stores: staff.stores,
      requiresPrivate: false, start: 840, end: 900, ...over,
    })
  }

  it('today’s search still refuses, byte for byte — nothing changed for a caller that did not ask', async () => {
    const plain = await kiri()
    expect(plain.laneKey).toBeNull()
    expect(plain.reseats).toEqual([])
    expect(plain.refusal).toBe(
      '14:00〜15:00はベッドに空きがありません。ベッド1（見本 さくら様 14:30〜15:30）、ベッド2（見本 かえる様 13:00〜14:30）、ベッド3（テスト なぎ様 14:05〜15:05）が使用中です',
    )
  })

  it('with the pack asked for, さくら moves one bed over and きり keeps ベッド1 — one move, k = 1', async () => {
    const packed = await kiri({ pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP })
    expect(packed.laneKey).toBe('bed-01')
    expect(packed.refusal).toBeNull()
    expect(packed.reseats).toEqual([{ id: 'apt-26', from: 'bed-01', to: 'bed-02' }])
  })

  it('a hold is a real room claim, so the person the search moves may be a 仮押さえ', async () => {
    const lanes = await demoLanes()
    const sakura = lanes.flatMap((l) => l.items).find((i) => i.caseId === 'apt-26')!
    expect(sakura.state).toBe('hold')
  })
})

// ── R2 — WHAT HAS STARTED, OR IS ABOUT TO, NEVER MOVES ─────────────────────

describe('R2 — the lead floor', () => {
  /** A is on ベッド1 13:00〜13:10. ベッド2 carries a 予定ブロック 13:50〜14:00 —
   *  closed to the subject's 13:00〜14:00 window, open to A. So the day has
   *  exactly one answer (subject on ベッド1, A on ベッド2) and it costs one move,
   *  which makes 「did A move?」 a clean yes/no about the lead floor alone. */
  const scene = () =>
    boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'a', caseId: 'apt-a', title: 'A' }, 780, 790)] }),
      lane({
        key: 'bed-02', group: 'beds', label: 'ベッド2',
        items: [{ ...booking({ key: 'blk', caseId: null }, 830, 840), kind: 'block' as const, title: '設備点検' }],
      }),
    ], 'SUBJECT')

  it('moves the occupant when nothing has started (a future day, now = null)', () => {
    const r = allocateBed(scene(), packAsk({ currentBed: 'bed-01' }))
    expect(r.laneKey).toBe('bed-01')
    expect(r.reseats).toEqual([{ id: 'apt-a', from: 'bed-01', to: 'bed-02' }])
  })

  it('moves the occupant when it is comfortably later than the floor', () => {
    // A starts 13:00, now 12:00 → 12:00 + 15 = 12:15 < 13:00, so A is movable.
    const r = allocateBed(scene(), packAsk({ currentBed: 'bed-01', now: 720 }))
    expect(r.reseats).toEqual([{ id: 'apt-a', from: 'bed-01', to: 'bed-02' }])
  })

  it('refuses instead of moving a booking within 15 minutes of now, and never moves one already under way', () => {
    // now 12:45 → floor 13:00, and A starts at exactly 13:00: `<=` pins it.
    const atFloor = allocateBed(scene(), packAsk({ currentBed: 'bed-01', now: 765 }))
    expect(atFloor.laneKey).toBeNull()
    expect(atFloor.reseats).toEqual([])
    expect(atFloor.refusal).toContain('ベッドに空きがありません')
    // …and one minute the other side of the floor is movable again, so the pin
    // is the floor and not a blanket refusal.
    expect(allocateBed(scene(), packAsk({ currentBed: 'bed-01', now: 764 })).reseats).toEqual([
      { id: 'apt-a', from: 'bed-01', to: 'bed-02' },
    ])
    // Already lying on the bed: pinned, whatever else is free.
    expect(allocateBed(scene(), packAsk({ currentBed: 'bed-01', now: 800 })).laneKey).toBeNull()
  })
})

// ── R3 — A PIN FORCES TODAY'S SENTENCE, BYTE-IDENTICAL ─────────────────────

describe('R3 — 清掃 / 予定ブロック never move', () => {
  it('a block on the only escape room refuses with the sentence the operator reads today', () => {
    const withBlock = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'a', caseId: 'apt-a', title: '見本 かえる' }, 780, 840)] }),
      lane({
        key: 'bed-02', group: 'beds', label: 'ベッド2',
        items: [{ ...booking({ key: 'blk', caseId: null }, 780, 840), kind: 'block' as const, title: '設備点検' }],
      }),
    ], 'SUBJECT')
    const packed = allocateBed(withBlock, packAsk({ currentBed: 'bed-01' }))
    const plain = allocateBed(withBlock, { id: 'SUBJECT', currentBed: 'bed-01', stores: ['store-a'], requiresPrivate: false, start: 780, end: 840 })
    expect(packed.laneKey).toBeNull()
    expect(packed.reseats).toEqual([])
    // THE SAME SENTENCE. Not「similar」— the same string the board shipped with.
    expect(packed.refusal).toBe(plain.refusal)
    expect(packed.refusal).toBe('13:00〜14:00はベッドに空きがありません。ベッド1（見本 かえる様）、ベッド2（設備点検）が使用中です')
  })

  it('a 清掃 tail is the tail of its booking, not a pin — it travels with the card it belongs to', () => {
    // ベッド1: A 10:00〜11:00 with its drawn 15-minute turnaround 11:00〜11:15.
    // ベッド2 turns around instantly and carries a 予定ブロック 11:00〜11:40.
    // The subject wants 11:00〜11:40 — the span A's tail is sitting on.
    //
    // If the drawn 清掃 were treated as a thing on the board, ベッド1 would stay
    // blocked no matter where A went and the day would refuse. It is A's tail:
    // A moves to ベッド2 (whose turnaround is 0, so A's claim there ends at
    // 11:00 and clears the block) and ベッド1 opens at 11:00.
    const beds = [
      lane({
        key: 'bed-01', group: 'beds', label: 'ベッド1',
        items: [
          booking({ key: 'a', caseId: 'apt-a', title: 'A' }, 600, 660),
          { ...booking({ key: 'apt-a-cleanup', caseId: null }, 660, 675), kind: 'cleanup' as const, title: '清掃' },
        ],
      }),
      lane({
        key: 'bed-02', group: 'beds', label: 'ベッド2',
        items: [{ ...booking({ key: 'blk', caseId: null }, 660, 700), kind: 'block' as const, title: '設備点検' }],
      }),
    ]
    const r = allocateBed(boardOf(beds, 'SUBJECT'), packAsk({ currentBed: 'bed-01', start: 660, end: 700, cleanupMinutesByBed: { 'bed-01': 15, 'bed-02': 0 } }))
    expect(r.laneKey).toBe('bed-01')
    expect(r.reseats).toEqual([{ id: 'apt-a', from: 'bed-01', to: 'bed-02' }])
  })
})

// ── R4 — LENS-1'S STEALING SCENE: A PLAIN SUBJECT NEVER STRANDS A 個室のみ ──

/** ⚖ FIX ROUND 2 (F9), CODE-LENS-4's TWO SURVIVING MUTANTS — TURNED INTO PINS.
 *
 *  The breaker wrote fourteen fresh mutants; twelve died. These are the two that
 *  lived, each written up here as the named test it was missing rather than left
 *  as a bare survivor. */
describe('F9a — a future day pins nobody, whatever the clock would have said', () => {
  /** A day whose FIRST minutes are inside the lead floor, which is the only
   *  place `now: null` and `now: 0` can be told apart. Real store hours put
   *  every booking hundreds of minutes past `LEAD_FLOOR_MIN`, which is why the
   *  battery could not see the difference (mutant b2 ran green). */
  const EARLY = { open: 0, close: 540 }
  const at = (over: Partial<BoardItem> & Pick<BoardItem, 'key' | 'caseId'>, start: number, end: number): BoardItem =>
    ({ ...booking(over, 600, 660), ...place(start, end, EARLY) })

  /** ベッド1 carries a booking that STARTS at minute 10 — inside `now + 15` if
   *  the clock is 0, outside every floor if there is no clock at all. ベッド2 is
   *  blocked 00:00〜00:05, so the subject cannot have it and the escapee can. */
  const board = () => boardOf([
    lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [at({ key: 'e', caseId: 'apt-early', title: 'E' }, 10, 20)] }),
    lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [{ ...at({ key: 'blk', caseId: null }, 0, 5), kind: 'block' as const, title: '設備点検' }] }),
  ], 'SUBJECT')
  const ask = { id: 'SUBJECT', currentBed: 'bed-01', stores: ['store-a'], requiresPrivate: false, start: 0, end: 30, cleanupMinutesByBed: NO_CLEANUP }

  it('with no clock at all (a future day) the 00:10 booking is MOVABLE — nothing is time-pinned', () => {
    const r = allocateBed(board(), { ...ask, pack: true, now: null })
    expect(r.laneKey).toBe('bed-01')
    expect(r.reseats).toEqual([{ id: 'apt-early', from: 'bed-01', to: 'bed-02' }])
  })

  it('with the clock at minute 0 the same booking is PINNED, and the day refuses', () => {
    const r = allocateBed(board(), { ...ask, pack: true, now: 0 })
    expect(r.laneKey).toBeNull()
    expect(r.reseats).toEqual([])
    // Today's own sentence, unchanged — a refusal is a refusal.
    expect(r.refusal).toBe(allocateBed(board(), ask).refusal)
  })
})

describe('F9b — the queue’s start-time order is a determinism aid, and it is pinned as one', () => {
  /** Liam's own board, asked twice, and then asked again with ベッド1's cards
   *  drawn in the opposite order. The ANSWER may not depend on the order the
   *  board happened to draw them in — that is what the sort buys. It does NOT
   *  buy equivalence: `PACK_BUDGET` counts claim placements and visitation order
   *  decides which are spent (CODE-LENS-4 F3, mutant b4 survived). The ponytail
   *  comment beside the sort says both halves; this pins the half that is true. */
  const block = (key: string, start: number, end: number) =>
    ({ ...booking({ key, caseId: null }, start, end), kind: 'block' as const, title: '設備点検' })
  /** ベッド1 carries TWO cards inside the subject's hour, so the chain is two
   *  moves deep and the queue really is a queue. ベッド2 is blocked for the whole
   *  hour (nobody may have it); ベッド3 is blocked only from 13:40, so both
   *  escapees fit there and the subject does not. */
  const scene = (reversed: boolean) => {
    const on = [
      booking({ key: 'a', caseId: 'apt-a', title: 'A' }, 780, 800),
      booking({ key: 'b', caseId: 'apt-b', title: 'B' }, 800, 820),
    ]
    return boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: reversed ? [...on].reverse() : on }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [block('blk2', 780, 840)] }),
      lane({ key: 'bed-03', group: 'beds', label: 'ベッド3', items: [block('blk3', 820, 840)] }),
    ], 'SUBJECT')
  }
  const answer = (reversed: boolean) =>
    allocateBed(scene(reversed), packAsk({ currentBed: 'bed-01', start: 780, end: 840 })).reseats

  it('the same scene twice is the same answer', () => {
    expect(answer(false)).toEqual(answer(false))
    // A real two-move chain, so the queue this sort orders is genuinely a queue.
    expect(answer(false)).toHaveLength(2)
  })

  it('…and so is the same scene with the room’s cards drawn the other way round', () => {
    expect([...answer(true)].sort((x, y) => x.id.localeCompare(y.id)))
      .toEqual([...answer(false)].sort((x, y) => x.id.localeCompare(y.id)))
  })
})

describe('R4 — the 個室 is never stolen out from under the booking that needs it', () => {
  /** One standard room and one private room. The private room holds a 個室のみ
   *  booking; the subject is plain and wants the standard room's window. The
   *  only "solution" a tightest-fit search would find is to move the tagged
   *  booking onto the standard bed, which its own tag forbids. */
  const stealing = () =>
    boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', roomClass: 'standard', items: [booking({ key: 'a', caseId: 'apt-a', title: 'A' }, 780, 840)] }),
      lane({
        key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private',
        items: [booking({ key: 'v', caseId: 'apt-v', title: 'なぎ', requiresPrivateRoom: true }, 780, 840)],
      }),
    ], 'SUBJECT')

  it('refuses rather than putting a 個室のみ booking on a standard bed', () => {
    const r = allocateBed(stealing(), packAsk({ currentBed: 'bed-01' }))
    expect(r.laneKey).toBeNull()
    expect(r.reseats).toEqual([])
  })

  it('moves a 個室のみ booking only to ANOTHER private room, never onto a standard bed', () => {
    // ベッド1 standard (A 13:00〜14:00), ベッド3 個室 (なぎ, tagged, 13:00〜13:30),
    // ベッド6 個室 (B 13:30〜14:00). A plain subject wants 13:00〜14:00: every
    // room is busy, so step 0 refuses and the pack runs. The only one-move
    // answer is the subject taking ベッド3 and なぎ moving to ベッド6 — a private
    // room, because her tag says so.
    const scene = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', roomClass: 'standard', items: [booking({ key: 'a', caseId: 'apt-a', title: 'A' }, 780, 840)] }),
      lane({
        key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private',
        items: [booking({ key: 'v', caseId: 'apt-v', title: 'なぎ', requiresPrivateRoom: true }, 780, 810)],
      }),
      lane({ key: 'bed-06', group: 'beds', label: 'ベッド6', roomClass: 'private', items: [booking({ key: 'b', caseId: 'apt-b', title: 'B' }, 810, 840)] }),
    ], 'SUBJECT')
    const r = allocateBed(scene, packAsk({ currentBed: 'bed-01' }))
    expect(r.laneKey).toBe('bed-03')
    expect(r.reseats).toEqual([{ id: 'apt-v', from: 'bed-03', to: 'bed-06' }])
  })

  it('a 個室のみ subject is still only ever offered a private room', () => {
    // Two 個室, both busy; one standard room free. The subject is tagged, so the
    // standard room is not a candidate for HER — but it is for the untagged
    // booking sitting in the 個室 she needs.
    const scene = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', roomClass: 'standard' }),
      lane({
        key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private',
        items: [booking({ key: 'v', caseId: 'apt-v', title: 'なぎ', requiresPrivateRoom: true }, 780, 840)],
      }),
      lane({ key: 'bed-06', group: 'beds', label: 'ベッド6', roomClass: 'private', items: [booking({ key: 'x', caseId: 'apt-x', title: 'X' }, 780, 840)] }),
    ], 'SUBJECT')
    const r = allocateBed(scene, packAsk({ requiresPrivate: true, currentBed: 'bed-06' }))
    expect(r.laneKey).toBe('bed-06')
    // X is untagged, so ⚖ ROOM RULE clause 1 sends it to the STANDARD room.
    expect(r.reseats).toEqual([{ id: 'apt-x', from: 'bed-06', to: 'bed-01' }])
  })
})

// ── ⚖ ROOM RULE clause 1 — STANDARD ROOMS FIRST, FOR COMPANIONS TOO ────────

describe('room order — the person the board moves is sent to a 施術室 before a 個室', () => {
  it('sends the moved booking to the standard room even when a private one is nearer in board order', () => {
    // Board order deliberately puts the two 個室 FIRST, so 「first compatible
    // room」 and 「standard rooms first」 give different answers and the test can
    // tell which rule is running.
    //
    // The subject is 個室のみ and both 個室 are busy in its window, so today's
    // search refuses. X (untagged, 13:00〜13:20) is in the way on ベッド3; it
    // could go to ベッド5 (free until 13:40) or ベッド1 (free all day). ⚖ ROOM
    // RULE clause 1 says the 施術室: a private room spent on a booking that does
    // not need one is a private room the next 個室のみ booking cannot have.
    const scene = boardOf([
      lane({
        key: 'bed-03', group: 'beds', label: 'ベッド3', roomClass: 'private',
        items: [booking({ key: 'x', caseId: 'apt-x', title: 'X' }, 780, 800)],
      }),
      lane({
        key: 'bed-05', group: 'beds', label: 'ベッド5', roomClass: 'private',
        items: [booking({ key: 'z', caseId: 'apt-z', title: 'Z' }, 820, 840)],
      }),
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', roomClass: 'standard' }),
    ], 'SUBJECT')
    const r = allocateBed(scene, packAsk({ requiresPrivate: true, currentBed: 'bed-03' }))
    expect(r.laneKey).toBe('bed-03')
    expect(r.reseats).toEqual([{ id: 'apt-x', from: 'bed-03', to: 'bed-01' }])
  })
})

// ── R5 — LENS-4'S PIN COUNTER-SCENE PACKS ──────────────────────────────────

describe('R5 — the pin scene the start-ordered version refused', () => {
  /** LENS-4's counter-scene, on a board a store can actually reach: two standard
   *  rooms, a 予定ブロック pin on ベッド1 13:35〜13:50, A on ベッド1 13:00〜13:10,
   *  C on ベッド2 13:30〜13:55, and the subject B asking for 13:05〜13:35.
   *
   *  A start-ordered re-solve refuses this day (it locks A onto its own bed
   *  before it can see that A is the one who has to move). The conflict-directed
   *  search finds the one-move answer the lens proved exists. */
  const pinScene = () =>
    boardOf([
      lane({
        key: 'bed-01', group: 'beds', label: 'ベッド1',
        items: [
          booking({ key: 'a', caseId: 'apt-a', title: 'A' }, 780, 790),
          { ...booking({ key: 'pin', caseId: null }, 815, 830), kind: 'block' as const, title: '設備点検' },
        ],
      }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [booking({ key: 'c', caseId: 'apt-c', title: 'C' }, 810, 835)] }),
    ], 'SUBJECT')

  it('packs: A moves to ベッド2 and the subject takes ベッド1 up to the pin', () => {
    const r = allocateBed(pinScene(), packAsk({ currentBed: null, start: 785, end: 815 }))
    expect(r.refusal).toBeNull()
    expect(r.laneKey).toBe('bed-01')
    expect(r.reseats).toEqual([{ id: 'apt-a', from: 'bed-01', to: 'bed-02' }])
    expect(noOverlaps(pinScene(), { id: 'SUBJECT', start: 785, end: 815 }, r, NO_CLEANUP)).toBe(true)
  })

  it('an unpackable day refuses with today’s sentence, byte-identical', () => {
    const jammed = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'a', caseId: 'apt-a', title: '見本 かえる' }, 780, 840)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [booking({ key: 'b', caseId: 'apt-b', title: '見本 あかり' }, 780, 840)] }),
    ], 'SUBJECT')
    const packed = allocateBed(jammed, packAsk({ currentBed: 'bed-01' }))
    const plain = allocateBed(jammed, { id: 'SUBJECT', currentBed: 'bed-01', stores: ['store-a'], requiresPrivate: false, start: 780, end: 840 })
    expect(packed.laneKey).toBeNull()
    expect(packed.refusal).toBe(plain.refusal)
    expect(packed.blockers.map((i) => i.title)).toEqual(plain.blockers.map((i) => i.title))
  })
})

// ── R11 — LENS-2'S CLEANUP SCENE ───────────────────────────────────────────

describe('R11 — the turnaround is part of every claim', () => {
  /** A on bed-01 10:00〜11:00 with a 15-minute turnaround; C 11:00〜12:00 wants
   *  a room. Compared as WINDOWS, C sits happily beside A. Compared as CLAIMS,
   *  A holds bed-01 until 11:15 and C does not fit — which is the answer core's
   *  own `appointments_resource_no_overlap` EXCLUDE gives. */
  const beds = () => [
    lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'a', caseId: 'apt-a', title: 'A' }, 600, 660)] }),
    lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [booking({ key: 'b', caseId: 'apt-b', title: 'B' }, 600, 720)] }),
  ]
  const tails = { 'bed-01': 15, 'bed-02': 15 }

  it('never packs a booking into the turnaround of the one before it', () => {
    // The subject wants bed-02's window; the only escape for B is bed-01, where
    // A's claim runs to 11:15 — so nothing legal exists and the day refuses.
    const r = allocateBed(boardOf(beds(), 'SUBJECT'), packAsk({ currentBed: 'bed-02', start: 600, end: 720, cleanupMinutesByBed: tails }))
    expect(r.laneKey).toBeNull()
    expect(r.reseats).toEqual([])
  })

  it('and with a zero turnaround the same room is genuinely free — nobody moves at all', () => {
    // The identical board with `cleanup_minutes: 0`: A ends at 11:00 and holds
    // nothing after it, so today's own search answers 11:00〜12:00 on ベッド1
    // and step 1 never runs. The turnaround is the whole difference.
    const r = allocateBed(boardOf(beds(), 'SUBJECT'), packAsk({ currentBed: 'bed-02', start: 660, end: 720, cleanupMinutesByBed: NO_CLEANUP }))
    expect(r.laneKey).toBe('bed-01')
    expect(r.reseats).toEqual([])
  })
})

/** ⚖ FIX ROUND 2 (F4), CODE-LENS-2 F3 — THE TAIL BELONGS TO THE ROOM THE CARD
 *  IS IN NOW.
 *
 *  `packSearch` validates a reseat against the DESTINATION room's turnaround
 *  (`cleanupMinutesByBed[room]`), and the board redrew the tail at the length
 *  the SERVER drew on the ORIGIN room — drawing nothing at all when the origin
 *  turned around instantly. So the board could show ベッド2 free at 12:10 in
 *  minutes the search had already reserved, and every layer reading
 *  `committedLanes` (sell / gap / reserved) would sell them — minutes core's own
 *  `appointments_resource_no_overlap` EXCLUDE refuses. Unreachable on the
 *  shipped fixture (`cleanup_minutes: 0` everywhere); real the day one store
 *  sets a turnaround. */
describe('F4 — a moved card’s turnaround is the DESTINATION room’s, never the origin’s', () => {
  const A_SPAN = place(690, 730, HOURS) // 11:30〜12:10
  const movedToBed02: BedCompanion[] = [{ id: 'apt-A', bedOrigin: { laneKey: 'bed-01', x: A_SPAN.x, w: A_SPAN.w }, bedTo: 'bed-02' }]
  const rows = (board: BoardLane[], key: string) =>
    board.find((l) => l.key === key)!.items.map((i) => [i.key, i.kind, i.startMin, i.endMin])
  /** A turnaround the server DID draw, in today-board's own shape (:594-600). */
  const drawnTail = (caseId: string, start: number, end: number): BoardItem => ({
    key: `${caseId}-cleanup`, kind: 'cleanup', state: null, category: null,
    ...place(start, end, HOURS), title: '清掃', tag: '', time: '',
    ticketCat: null, ticketCore: null, held: false, micro: end - start <= 20, caseId: null,
    label: '',
  })
  /** 「could anybody have ベッド2 from 12:10?」 — the question the sell layer and
   *  the gap layer both end up asking of the board this draws. */
  const bed02FreeAt = (board: BoardLane[], start: number, end: number) =>
    allocateBed(board.filter((l) => l.group !== 'beds' || l.key === 'bed-02'), {
      id: null, currentBed: 'bed-02', stores: ['store-a'], requiresPrivate: false, start, end,
    }).laneKey

  it('origin 0 → destination 15: the tail is DRAWN in the new room, and the minutes stop being sellable', () => {
    const board = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'a', caseId: 'apt-A', title: '見本 さくら' }, 690, 730)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ])
    const withTails = applyBedMoves(board, movedToBed02, HOURS, { 'bed-01': 0, 'bed-02': 15 })
    expect(rows(withTails, 'bed-02')).toEqual([
      ['a', 'booking', 690, 730],
      ['apt-A-cleanup', 'cleanup', 730, 745],
    ])
    expect(bed02FreeAt(withTails, 730, 760)).toBeNull()

    // The same board WITHOUT the room policy is byte-for-byte what shipped: no
    // tail at all, and 12:10 on ベッド2 reads as free — the defect, pinned.
    const asShipped = applyBedMoves(board, movedToBed02, HOURS)
    expect(rows(asShipped, 'bed-02')).toEqual([['a', 'booking', 690, 730]])
    expect(bed02FreeAt(asShipped, 730, 760)).toBe('bed-02')
  })

  it('origin 15 → destination 0: the origin’s tail does NOT travel, so nothing is drawn', () => {
    const board = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [
        booking({ key: 'a', caseId: 'apt-A', title: '見本 さくら' }, 690, 730),
        drawnTail('apt-A', 730, 745),
      ] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ])
    expect(rows(applyBedMoves(board, movedToBed02, HOURS, { 'bed-01': 15, 'bed-02': 0 }), 'bed-02'))
      .toEqual([['a', 'booking', 690, 730]])
    // …and without the map the origin's 15 minutes travel to a room that needs
    // none, which is the same defect one size smaller.
    expect(rows(applyBedMoves(board, movedToBed02, HOURS), 'bed-02'))
      .toEqual([['a', 'booking', 690, 730], ['apt-A-cleanup', 'cleanup', 730, 745]])
  })

  it('a booking that did NOT change room keeps the length the server drew, map or no map', () => {
    // apt-B never moves. The server clipped its turnaround to 5 minutes; ベッド2's
    // policy says 15. The clip is the truth for a card standing still.
    const board = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'a', caseId: 'apt-A', title: '見本 さくら' }, 690, 730)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [
        booking({ key: 'b', caseId: 'apt-B', title: '見本 かえる' }, 780, 840),
        drawnTail('apt-B', 840, 845),
      ] }),
    ])
    const moved = applyMoves(board, {}, [], [], HOURS, { 'apt-A': { laneKey: 'bed-02', x: A_SPAN.x, w: A_SPAN.w } }, { 'bed-01': 0, 'bed-02': 15 })
    expect(rows(moved, 'bed-02')).toEqual([
      ['a', 'booking', 690, 730],
      ['apt-A-cleanup', 'cleanup', 730, 745],
      ['b', 'booking', 780, 840],
      ['apt-B-cleanup', 'cleanup', 840, 845],
    ])
  })

  it('and a caller that hands in no policy at all is byte-identical to the shipped board', () => {
    const board = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [
        booking({ key: 'a', caseId: 'apt-A', title: '見本 さくら' }, 690, 730),
        drawnTail('apt-A', 730, 745),
      ] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ])
    const bed: Record<string, { laneKey: string; x: number; w: number }> = { 'apt-A': { laneKey: 'bed-02', x: A_SPAN.x, w: A_SPAN.w } }
    expect(applyMoves(board, {}, [], [], HOURS, bed, undefined)).toEqual(applyMoves(board, {}, [], [], HOURS, bed))
  })
})

// ── R12 — THE CEILING ──────────────────────────────────────────────────────

describe('R12 — four moves pack, five refuse', () => {
  /** ベッド1 carries the whole conflict: N short bookings inside the subject's
   *  13:00〜14:00 window. Every OTHER room is closed to the subject by a
   *  予定ブロック — a pin, so those rooms are dead for the subject at every k —
   *  while still having room for the short bookings around the pin. So the
   *  subject can only take ベッド1, and taking it costs exactly N moves. */
  const spread = (n: number) => {
    const rows: BoardItem[] = []
    for (let i = 0; i < n; i += 1) rows.push(booking({ key: `k${i}`, caseId: `apt-${i}`, title: `A${i}` }, 780 + i * 11, 790 + i * 11))
    // 13:58〜14:00 on every other room: closed to the 13:00〜14:00 subject (so
    // ベッド1 is its only possible seat), open to every short card, which all
    // end by 13:44.
    const escape = (key: string, label: string) =>
      lane({ key, group: 'beds', label, items: [{ ...booking({ key: `p-${key}`, caseId: null }, 838, 840), kind: 'block' as const, title: '設備点検' }] })
    return boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: rows }),
      escape('bed-02', 'ベッド2'), escape('bed-03', 'ベッド3'),
      escape('bed-04', 'ベッド4'), escape('bed-05', 'ベッド5'), escape('bed-06', 'ベッド6'),
    ], 'SUBJECT')
  }
  const ask = packAsk({ currentBed: 'bed-01', start: 780, end: 840 })

  it('a four-move day packs, and moves exactly four', () => {
    const r = allocateBed(spread(4), ask)
    expect(r.laneKey).toBe('bed-01')
    expect(r.reseats).toHaveLength(4)
    expect(noOverlaps(spread(4), { id: 'SUBJECT', start: 780, end: 840 }, r, NO_CLEANUP)).toBe(true)
  })

  it('a five-move day refuses honestly rather than shuffling the board', () => {
    const r = allocateBed(spread(5), ask)
    expect(r.laneKey).toBeNull()
    expect(r.reseats).toEqual([])
    expect(r.refusal).toContain('ベッドに空きがありません')
  })
})

// ── R13 — MINIMALITY: A BYSTANDER IS NEVER MOVED ───────────────────────────

describe('R13 — the search touches only the conflict chain', () => {
  it('moves nobody when the subject already fits somewhere', () => {
    // LENS-4's scene: A 13:25〜13:50 on bed-01, subject B 13:10〜13:30. bed-02
    // is free, so step 0 answers and step 1 never runs.
    const scene = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'a', caseId: 'apt-a', title: 'A' }, 805, 830)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ], 'SUBJECT')
    const r = allocateBed(scene, packAsk({ currentBed: 'bed-01', start: 790, end: 810 }))
    expect(r.laneKey).toBe('bed-02')
    expect(r.reseats).toEqual([])
  })

  it('leaves the card in the SAME room alone when it is not in the way', () => {
    // ベッド1 carries A 13:00〜13:20 and B 13:30〜14:00; the subject wants
    // 13:00〜13:30. Only A overlaps, so only A moves — B is a bystander sitting
    // in the very room being packed and is never touched.
    const scene = boardOf([
      lane({
        key: 'bed-01', group: 'beds', label: 'ベッド1',
        items: [
          booking({ key: 'a', caseId: 'apt-a', title: 'A' }, 780, 800),
          booking({ key: 'b', caseId: 'apt-b', title: 'B' }, 810, 840),
        ],
      }),
      lane({
        key: 'bed-02', group: 'beds', label: 'ベッド2',
        items: [{ ...booking({ key: 'blk', caseId: null }, 800, 840), kind: 'block' as const, title: '設備点検' }],
      }),
    ], 'SUBJECT')
    const r = allocateBed(scene, packAsk({ currentBed: 'bed-01', start: 780, end: 810 }))
    expect(r.laneKey).toBe('bed-01')
    expect(r.reseats).toEqual([{ id: 'apt-a', from: 'bed-01', to: 'bed-02' }])
  })
})

// ── R9 — THE FENCE: THE CAPACITY BOOK NEVER PACKS ──────────────────────────

describe('R9 — the fence, in the source', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today', rel), 'utf8')

  it('the capacity book’s one search never receives `pack`', () => {
    const src = read('capacity-ledger.ts')
    expect(src).toContain('const search = (q: Query, start: number, end: number) => {')
    // The whole file. The book is the rail probes, `bedDoor` and `newClientMask`
    // — the surfaces `capacity-ledger-parity.test.ts` compares against the
    // legacy oracle — and a pack anywhere inside it would make that comparison
    // a comparison of two different questions.
    expect(src).not.toMatch(/pack\s*:/)
    expect(src).not.toContain('reseats')
  })

  it('nor does the sell layer, the reserved mask or the parity oracle — and the rest layer asks ONCE', () => {
    // The `allocateBed` callers inside today-interactions.ts are the sell offer
    // builder, the rail explain path and `bedFeasibility` (the parity oracle).
    // `landingVerdict` is the one call that CAN pack, and it only ever passes
    // the question through.
    //
    // ⚖ LIAM RULING 3 (2026-09-09) — AND `explainRails` NOW ASKS TOO, once, for
    // the 「moves someone」 mark: a start the rooms refused whose half hour still
    // has a bed free. That is a legitimate SECOND site and this pin says so out
    // loud rather than being grep-dodged — the literal is counted INSIDE that
    // one function and banned everywhere else in the file, so a packing ask
    // cannot appear on the sell layer, the mask, the parity oracle or any
    // per-frame path without turning this red.
    //
    // ⚠ AND THE COUNT IS NOT THE FENCE. A source count cannot tell a resting
    // ask from a per-frame one — the 9/8 round lost a positional `true` to
    // exactly that blindness. What actually holds the line is the BEHAVIOURAL
    // pin in today-rail-halfhour.test.ts §BEHAVIOURAL, which drives the surface
    // with a counting allocator and reads how many asks each state makes. This
    // is the cheap belt beside it.
    const interactions = read('today-interactions.ts')
    // Both anchors are asserted UNIQUE first: a slice taken on a repeated
    // anchor is a slice of the wrong thing, and it would pass quietly.
    const open = 'export function explainRails('
    const close = 'export function restCueStarts('
    expect(interactions.split(open)).toHaveLength(2)
    expect(interactions.split(close)).toHaveLength(2)
    const from = interactions.indexOf(open)
    const to = interactions.indexOf(close)
    expect(to).toBeGreaterThan(from)
    const explain = interactions.slice(from, to)
    expect([...explain.matchAll(/pack: true/g)]).toHaveLength(1)
    expect([...interactions.replace(explain, '').matchAll(/pack: true/g)]).toHaveLength(0)
    expect(read('reserved-mask.ts')).not.toMatch(/pack\s*:/)
    expect(read('fallback-cells.ts')).not.toMatch(/pack\s*:/)
  })

  it('`pack` is an option on the call, never a field on the asker’s shape', () => {
    // ⚖ LENS-2 F9 — `freeKeysFor` spreads `Subject` into three more doors, so a
    // `pack` living on that shape would ride into every one of them. `Subject`
    // is declared in capacity-ledger.ts, which the pin above reads whole.
    const book = read('capacity-ledger.ts')
    expect(book).toContain('export interface Subject')
    expect(book.slice(book.indexOf('export interface Subject'), book.indexOf('export interface Subject') + 1500)).not.toContain('pack')
  })

  it('throws rather than guessing when the pack is asked for without its two facts', () => {
    const scene = boardOf([lane({ key: 'bed-01', group: 'beds', items: [booking({ key: 'a', caseId: 'apt-a' }, 780, 840)] })], 'SUBJECT')
    const base = { id: 'SUBJECT', currentBed: 'bed-01', stores: ['store-a'], requiresPrivate: false, start: 780, end: 840 }
    expect(() => allocateBed(scene, { ...base, pack: true, cleanupMinutesByBed: NO_CLEANUP })).toThrow('allocateBed: pack requires now and cleanupMinutesByBed')
    expect(() => allocateBed(scene, { ...base, pack: true, now: null })).toThrow('allocateBed: pack requires now and cleanupMinutesByBed')
    // `now: null` is a real answer (a future day), not a missing one.
    expect(() => allocateBed(scene, { ...base, pack: true, now: null, cleanupMinutesByBed: NO_CLEANUP })).not.toThrow()
  })
})

// ── THE SEEDED BATTERY ─────────────────────────────────────────────────────

/** A deterministic generator, and an EXHAUSTIVE oracle written against the
 *  design's claim rule rather than against the search's code. */

interface GenRoom { key: string; roomClass: 'standard' | 'private'; cleanup: number }
interface GenBooking { id: string; room: string; requiresPrivate: boolean; start: number; end: number }
interface GenScene {
  rooms: GenRoom[]
  pins: Array<{ room: string; start: number; end: number }>
  bookings: GenBooking[]
  subject: { currentBed: string | null; requiresPrivate: boolean; start: number; end: number }
  now: number | null
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const olap = (a: { start: number; end: number }, b: { start: number; end: number }) => a.end > b.start && a.start < b.end
const DURATIONS = [10, 15, 20, 25, 30]
const CLEANUPS = [0, 0, 5, 10, 15]

/** The board a landing arrives at was itself built by landings, so it can never
 *  be self-conflicting: every pre-existing claim is placed by rejection sampling
 *  against the ones already committed. A generator that skips this makes boards
 *  no store can reach and turns every 「invalid solution」 reading into noise. */
function genScene(seed: number, mode: 'mixed' | 'all-standard', size = { rooms: 2, movables: 4 }): GenScene {
  const rnd = mulberry32(seed)
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
  const numRooms = 2 + Math.floor(rnd() * size.rooms)
  const rooms: GenRoom[] = []
  let hasPrivate = false
  for (let i = 0; i < numRooms; i += 1) {
    const isPrivate = mode === 'mixed' && (i === numRooms - 1 ? !hasPrivate : rnd() < 0.35)
    if (isPrivate) hasPrivate = true
    rooms.push({ key: `bed-0${i}`, roomClass: isPrivate ? 'private' : 'standard', cleanup: pick(CLEANUPS) })
  }
  const claims = new Map(rooms.map((r) => [r.key, [] as Array<{ start: number; end: number }>]))
  const fits = (room: GenRoom, start: number, end: number, tail: number) =>
    !claims.get(room.key)!.some((c) => olap(c, { start, end: end + tail }))
  const commit = (room: GenRoom, start: number, end: number, tail: number) => claims.get(room.key)!.push({ start, end: end + tail })

  const bookings: GenBooking[] = []
  const target = 2 + Math.floor(rnd() * size.movables)
  for (let i = 0; i < target; i += 1) {
    const requiresPrivate = hasPrivate && rnd() < 0.3
    const compat = rooms.filter((r) => !requiresPrivate || r.roomClass === 'private')
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const start = 600 + Math.floor(rnd() * 19) * 5
      const dur = pick(DURATIONS)
      const room = pick(compat.length ? compat : rooms)
      if (!fits(room, start, start + dur, room.cleanup)) continue
      commit(room, start, start + dur, room.cleanup)
      bookings.push({ id: `apt-${i}`, room: room.key, requiresPrivate, start, end: start + dur })
      break
    }
  }
  const pins: Array<{ room: string; start: number; end: number }> = []
  for (let i = 0; i < Math.floor(rnd() * 3); i += 1) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const room = pick(rooms)
      const start = 610 + Math.floor(rnd() * 15) * 5
      const dur = pick([5, 10, 15, 20])
      if (!fits({ ...room, cleanup: 0 }, start, start + dur, 0)) continue
      commit({ ...room, cleanup: 0 }, start, start + dur, 0)
      pins.push({ room: room.key, start, end: start + dur })
      break
    }
  }
  const now = rnd() < 0.3 ? null : 600 + Math.floor(rnd() * 19) * 5
  const sStart = 600 + Math.floor(rnd() * 19) * 5
  const sDur = pick(DURATIONS)
  const sPrivate = hasPrivate && rnd() < 0.25
  const sCompat = rooms.filter((r) => !sPrivate || r.roomClass === 'private')
  return {
    rooms, pins, bookings, now,
    subject: {
      currentBed: rnd() < 0.5 ? null : pick(sCompat.length ? sCompat : rooms).key,
      requiresPrivate: sPrivate,
      start: sStart,
      end: sStart + sDur,
    },
  }
}

function lanesOf(s: GenScene): BoardLane[] {
  const beds = s.rooms.map((r) =>
    lane({
      key: r.key, group: 'beds', label: r.key, roomClass: r.roomClass,
      items: [
        ...s.bookings.filter((b) => b.room === r.key).map((b) =>
          booking({ key: `${b.id}-bed`, caseId: b.id, title: b.id, requiresPrivateRoom: b.requiresPrivate }, b.start, b.end)),
        ...s.pins.filter((p) => p.room === r.key).map((p, i) =>
          ({ ...booking({ key: `pin-${r.key}-${i}`, caseId: null }, p.start, p.end), kind: 'block' as const, title: '設備点検' })),
      ],
    }),
  )
  return boardOf(beds, 'SUBJECT')
}

const tailsOf = (s: GenScene) => Object.fromEntries(s.rooms.map((r) => [r.key, r.cleanup]))

/** Does this assignment actually hold? Rebuilt from scratch, per room, per
 *  claim — deliberately independent of the search's own internals, because the
 *  bug class it exists to catch is a search that returns 「success」 on an
 *  assignment that does not hold. */
function noOverlaps(
  lanes: BoardLane[],
  subject: { id: string; start: number; end: number },
  result: { laneKey: string | null; reseats: readonly { id: string; from: string; to: string }[] },
  tails: Record<string, number>,
): boolean {
  if (result.laneKey == null) return true
  const to = new Map(result.reseats.map((r) => [r.id, r.to]))
  const byRoom = new Map<string, Array<{ start: number; end: number }>>()
  for (const l of lanes) {
    if (l.group !== 'beds') continue
    byRoom.set(l.key, [])
  }
  for (const l of lanes) {
    if (l.group !== 'beds') continue
    for (const i of l.items) {
      if (i.kind === 'cleanup') continue
      if (i.kind !== 'booking' || i.caseId == null) {
        byRoom.get(l.key)!.push({ start: i.startMin, end: i.endMin })
        continue
      }
      if (i.caseId === subject.id) continue
      const room = to.get(i.caseId) ?? l.key
      byRoom.get(room)!.push({ start: i.startMin, end: i.endMin + (tails[room] ?? 0) })
    }
  }
  byRoom.get(result.laneKey)!.push({ start: subject.start, end: subject.end + (tails[result.laneKey] ?? 0) })
  for (const claims of byRoom.values()) {
    claims.sort((a, b) => a.start - b.start)
    for (let i = 1; i < claims.length; i += 1) if (olap(claims[i - 1], claims[i])) return false
  }
  return true
}

/** Ground truth by exhaustive enumeration: every valid full assignment of the
 *  movable bookings over their compatible rooms, cheapest first. */
function bruteForce(s: GenScene, K: number): { packable: boolean; minCost: number | null } {
  const roomOf = new Map(s.rooms.map((r) => [r.key, r]))
  const timePinned = (b: GenBooking) => s.now != null && b.start <= s.now + 15
  const movable = s.bookings.filter((b) => !timePinned(b))
  const fixed = s.bookings.filter(timePinned)
  const base = new Map(s.rooms.map((r) => [r.key, [] as Array<{ start: number; end: number }>]))
  for (const p of s.pins) base.get(p.room)!.push({ start: p.start, end: p.end })
  for (const b of fixed) base.get(b.room)!.push({ start: b.start, end: b.end + roomOf.get(b.room)!.cleanup })

  const compatFor = (needsPrivate: boolean) => s.rooms.filter((r) => !needsPrivate || r.roomClass === 'private')
  const subjectRooms = compatFor(s.subject.requiresPrivate)
  const cands = movable.map((b) => compatFor(b.requiresPrivate))

  let best: number | null = null
  const feasible = (subjectRoom: string, assign: Map<string, string>) => {
    const byRoom = new Map([...base].map(([k, v]) => [k, [...v]]))
    byRoom.get(subjectRoom)!.push({ start: s.subject.start, end: s.subject.end + roomOf.get(subjectRoom)!.cleanup })
    for (const b of movable) {
      const k = assign.get(b.id)!
      byRoom.get(k)!.push({ start: b.start, end: b.end + roomOf.get(k)!.cleanup })
    }
    for (const claims of byRoom.values()) {
      claims.sort((a, b) => a.start - b.start)
      for (let i = 1; i < claims.length; i += 1) if (olap(claims[i - 1], claims[i])) return false
    }
    return true
  }
  const walk = (subjectRoom: string, idx: number, assign: Map<string, string>) => {
    if (idx === movable.length) {
      if (!feasible(subjectRoom, assign)) return
      let cost = 0
      for (const b of movable) if (assign.get(b.id) !== b.room) cost += 1
      if (cost <= K && (best === null || cost < best)) best = cost
      return
    }
    for (const room of cands[idx]) {
      assign.set(movable[idx].id, room.key)
      walk(subjectRoom, idx + 1, assign)
    }
    assign.delete(movable[idx].id)
  }
  for (const r of subjectRooms) walk(r.key, 0, new Map())
  return { packable: best !== null, minCost: best }
}

describe('the seeded battery — 2,400 generated days against a brute-force oracle', () => {
  for (const mode of ['mixed', 'all-standard'] as const) {
    it(`${mode}: no false refusal, no invalid seat, no extra move, no bystander`, () => {
      const stats = { total: 0, step0: 0, packed: 0, falseRefusals: 0, invalid: 0, nonMinimal: 0, belowTruth: 0, bystander: 0, stranded: 0 }
      const firstFailure: string[] = []
      for (let seed = 1; seed <= Number(process.env.FUZZ_N ?? 1200); seed += 1) {
        const s = genScene(seed, mode)
        const lanes = lanesOf(s)
        const tails = tailsOf(s)
        const ask = {
          id: 'SUBJECT', currentBed: s.subject.currentBed, stores: ['store-a'],
          requiresPrivate: s.subject.requiresPrivate, start: s.subject.start, end: s.subject.end,
        }
        stats.total += 1
        // Step 0 is pre-existing, trusted code with its own deliberate asymmetry
        // (the asker's side carries no turnaround). A room free under the pack's
        // stricter uniform rule is always free under it too, so gating here keeps
        // the oracle a faithful judge of step 1 with no semantic mismatch.
        if (allocateBed(lanes, ask).laneKey !== null) {
          stats.step0 += 1
          continue
        }
        stats.packed += 1
        const r = allocateBed(lanes, { ...ask, pack: true, now: s.now, cleanupMinutesByBed: tails })
        const truth = bruteForce(s, 4)
        const note = (what: string) => { if (firstFailure.length < 3) firstFailure.push(`${what} @ ${mode} seed ${seed}`) }

        if (r.laneKey === null) {
          if (truth.packable) { stats.falseRefusals += 1; note('false refusal') }
          continue
        }
        if (!noOverlaps(lanes, { id: 'SUBJECT', start: s.subject.start, end: s.subject.end }, r, tails)) {
          stats.invalid += 1
          note('invalid seat')
        }
        if (truth.minCost != null) {
          if (r.reseats.length > truth.minCost) { stats.nonMinimal += 1; note('non-minimal') }
          if (r.reseats.length < truth.minCost) { stats.belowTruth += 1; note('below truth') }
        }
        // A move is a bystander move when the assignment still holds without it.
        for (const one of r.reseats) {
          const without = { laneKey: r.laneKey, reseats: r.reseats.filter((x) => x.id !== one.id) }
          if (noOverlaps(lanes, { id: 'SUBJECT', start: s.subject.start, end: s.subject.end }, without, tails)) {
            stats.bystander += 1
            note('bystander')
          }
        }
        const to = new Map(r.reseats.map((x) => [x.id, x.to]))
        for (const b of s.bookings) {
          if (!b.requiresPrivate) continue
          const finalRoom = s.rooms.find((x) => x.key === (to.get(b.id) ?? b.room))!
          if (finalRoom.roomClass !== 'private') { stats.stranded += 1; note('stranded 個室のみ') }
        }
      }
      // The battery has to have actually engaged the pack, or it proves nothing.
      expect(stats.packed).toBeGreaterThan(200)
      expect({ ...stats, firstFailure }).toEqual({
        ...stats,
        falseRefusals: 0, invalid: 0, nonMinimal: 0, belowTruth: 0, bystander: 0, stranded: 0,
        firstFailure: [],
      })
    })
  }
})

/** ⚖ 9/3 R7 — THE SECOND BATTERY, ON THE DAYS THE ORACLE CANNOT AFFORD.
 *
 *  Exhaustive ground truth costs `rooms ^ movables`, so the battery above stops
 *  at three rooms and five movables — and the deepest defect this search can
 *  have (a branch that fails, is abandoned, and leaves one of its own
 *  grandchildren's moves standing in the shared state) only shows up on days
 *  with longer chains than that.
 *
 *  So this battery drops the oracle and keeps the two checks that need none:
 *  the answer must HOLD (no two claims on one room), and every move in it must
 *  be NECESSARY (drop any one and the answer stops holding). Both are O(n), so
 *  six rooms and eight movables are affordable, and stale state shows up as a
 *  move nobody needed. */
describe('the deep battery — 80,000 bigger days, checked for validity and necessity', () => {
  for (const mode of ['mixed', 'all-standard'] as const) {
    it(`${mode}: every answer holds, and every move in it was necessary`, () => {
      const size = { rooms: 5, movables: 7 }
      const stats = { packed: 0, invalid: 0, bystander: 0, stranded: 0 }
      const firstFailure: string[] = []
      for (let seed = 1; seed <= 40000; seed += 1) {
        const s = genScene(seed, mode, size)
        const lanes = lanesOf(s)
        const tails = tailsOf(s)
        const ask = {
          id: 'SUBJECT', currentBed: s.subject.currentBed, stores: ['store-a'],
          requiresPrivate: s.subject.requiresPrivate, start: s.subject.start, end: s.subject.end,
        }
        if (allocateBed(lanes, ask).laneKey !== null) continue
        const r = allocateBed(lanes, { ...ask, pack: true, now: s.now, cleanupMinutesByBed: tails })
        if (r.laneKey === null) continue
        stats.packed += 1
        const subj = { id: 'SUBJECT', start: s.subject.start, end: s.subject.end }
        const note = (what: string) => { if (firstFailure.length < 3) firstFailure.push(`${what} @ ${mode} seed ${seed}`) }
        if (!noOverlaps(lanes, subj, r, tails)) { stats.invalid += 1; note('invalid seat') }
        for (const one of r.reseats) {
          const without = { laneKey: r.laneKey, reseats: r.reseats.filter((x) => x.id !== one.id) }
          if (noOverlaps(lanes, subj, without, tails)) { stats.bystander += 1; note(`unnecessary move of ${one.id}`) }
        }
        const to = new Map(r.reseats.map((x) => [x.id, x.to]))
        for (const b of s.bookings) {
          if (!b.requiresPrivate) continue
          if (s.rooms.find((x) => x.key === (to.get(b.id) ?? b.room))!.roomClass !== 'private') { stats.stranded += 1; note('stranded 個室のみ') }
        }
      }
      expect(stats.packed).toBeGreaterThan(500)
      expect({ ...stats, firstFailure }).toEqual({ ...stats, invalid: 0, bystander: 0, stranded: 0, firstFailure: [] })
    })
  }
})

// ── SCOPE B — THE WIRING ───────────────────────────────────────────────────

/** This suite renders nothing (Business territory has no renderer — the import
 *  allowlist is react / next / node only), so the screen's half is proven the
 *  way the rest of this board's screen behaviour is: the PURE helpers are
 *  executed against real boards, and the lines that call them are pinned as
 *  source. Both halves are needed — an executed helper nobody calls proves
 *  nothing, and a pinned call to a helper nobody tested proves nothing either. */
const SCREEN = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'), 'utf8')
const EDITS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/BusinessSessionEdits.tsx'), 'utf8')
const INTERACTIONS = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today-interactions.ts'), 'utf8')

describe('B — Liam’s scene, end to end through the wiring', () => {
  it('the solve, the companion record and the line the 仮押さえ box shows', async () => {
    const lanes = await demoLanes()
    const staff = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === 'apt-09'))!
    const solved = allocateBed(lanes, {
      id: 'apt-09', currentBed: 'bed-01', stores: staff.stores, requiresPrivate: false,
      start: 840, end: 900, pack: true, now: 804, cleanupMinutesByBed: {},
    })
    const companions = companionsFor(lanes, solved.reseats)
    // The record 元に戻す restores from: the room she left, the drawing she had,
    // and the room this landing gives her.
    expect(companions).toHaveLength(1)
    expect({ id: companions[0].id, from: companions[0].bedOrigin.laneKey, to: companions[0].bedTo })
      .toEqual({ id: 'apt-26', from: 'bed-01', to: 'bed-02' })
    // …and the line the operator reads on the 仮押さえ box.
    expect(companionLines(lanes, companions)).toEqual(['見本 さくら様 ベッド1 → ベッド2'])
    // The board the staging writes, from the same helper the verdict uses: さくら
    // is drawn on ベッド2 and ベッド1 is hers no longer.
    const staged = applyBedMoves(lanes, companions, { open: 600, close: 1140 })
    const on = (key: string) => staged.find((l) => l.key === key)!.items.some((i) => i.caseId === 'apt-26')
    expect({ 'bed-01': on('bed-01'), 'bed-02': on('bed-02') }).toEqual({ 'bed-01': false, 'bed-02': true })
  })
})

describe('R6 — a second landing of the same card solves against the day it started on', () => {
  it('lanesWithCompanionsRestored puts every companion back where it stood', async () => {
    const lanes = await demoLanes()
    const companions: BedCompanion[] = [{ id: 'apt-26', bedOrigin: { laneKey: 'bed-01', x: 10, w: 5 }, bedTo: 'bed-02' }]
    const staged = applyBedMoves(lanes, companions, { open: 600, close: 1140 })
    const back = lanesWithCompanionsRestored(staged, companions, { open: 600, close: 1140 })
    const roomOf = (board: BoardLane[]) => board.find((l) => l.group === 'beds' && l.items.some((i) => i.caseId === 'apt-26'))!.key
    expect([roomOf(lanes), roomOf(staged), roomOf(back)]).toEqual(['bed-01', 'bed-02', 'bed-01'])
    // No companions is the board itself, untouched — every landing that packed
    // nothing pays nothing for this rule.
    expect(lanesWithCompanionsRestored(lanes, undefined, { open: 600, close: 1140 })).toBe(lanes)
  })

  it('and the screen asks that question at every landing, through ONE function', () => {
    expect(SCREEN).toContain('function solveLanes(id: string | null): BoardLane[] {')
    expect(SCREEN).toContain('lanesWithCompanionsRestored(boardLanesRef.current, pending.companions, hours, props.bedCleanupMinutes)')
    expect(SCREEN).toContain(': boardLanesRef.current')
    // All four landings go through it — the drop, the keyboard nudge, the 次回予約
    // placement and the shelf chip. A landing that read the raw board would
    // shuffle さくら a second time out of the seat this change gave her.
    // ⚖ FIX ROUND 2 (F2) — FIVE, with 「より良い開始」: it was the one landing that
    // staged a room off the verdict instead of solving for it.
    expect((SCREEN.match(/solveBed\(solveLanes\(/g) ?? [])).toHaveLength(5)
    expect(SCREEN).not.toContain('solveBed(boardLanesRef.current')
  })

  it('and the new companion set REPLACES the old one at stage time', () => {
    // The previous landing's companions are written home first, then this
    // landing's are written — so a second gesture cannot leave a card stranded
    // in a room the first gesture borrowed.
    expect(SCREEN).toContain('const previous = pending && pending.id === id ? (pending.companions ?? []) : []')
    expect(SCREEN).toContain('for (const c of previous) next[c.id] = c.bedOrigin')
  })
})

/** ⚖ FIX ROUND 1 (F1), Fable's line audit of e70ca6dd9 — A RE-LANDING WAS BEING
 *  JUDGED ON A DIFFERENT BOARD THAN IT IS SOLVED ON.
 *
 *  `verdictAtLanding` asked `landingVerdict` about the board on SCREEN, while
 *  the landing that follows it solves through `solveBed(solveLanes(id), …)` —
 *  the board with the previous companions put back. On a first gesture those are
 *  the same day. On a SECOND gesture on the same staged card they are not: the
 *  first landing's companions are sitting in their new rooms on one and at home
 *  on the other. The operator was then shown one answer and given another — the
 *  word could promise a room the drop would not take, or say nobody moves while
 *  the drop moved somebody, and `solveBed`'s own toast could speak AFTER a clean
 *  verdict. This is that disagreement, on Liam's own board. */
describe('R6b — a re-landing is judged on the board it is solved on', () => {
  /** Liam's scene, one gesture in: きり 14:00〜15:00 takes ベッド1 and さくら
   *  (apt-26) is moved ベッド1 → ベッド2. `staged` is what the screen then shows;
   *  `restored` is what `solveLanes(id)` hands the next landing. */
  const afterFirstLanding = async () => {
    const lanes = await demoLanes()
    const staff = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === 'apt-09'))!
    const first = allocateBed(lanes, {
      id: 'apt-09', currentBed: 'bed-01', stores: staff.stores, requiresPrivate: false,
      start: 840, end: 900, stagedId: null, pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
    })
    expect({ room: first.laneKey, reseats: first.reseats })
      .toEqual({ room: 'bed-01', reseats: [{ id: 'apt-26', from: 'bed-01', to: 'bed-02' }] })
    const companions = companionsFor(lanes, first.reseats)
    const staged = applyBedMoves(lanes, companions, HOURS)
    return { staff, staged, restored: lanesWithCompanionsRestored(staged, companions, HOURS) }
  }

  /** The second landing, asked exactly as the screen asks it — `verdictFor`'s
   *  own field list, with the board as the argument F1 added. */
  const askAt = (staffKey: string, start: number, end: number) => ({
    staffLane: staffKey, bedLane: 'bed-01', solveRoom: true, id: 'apt-09',
    requiresPrivate: false, start, end, span: place(start, end, HOURS),
    foreignRefusal: null, hasPrice: true, locked: [] as string[],
    minutesOf: (x: number) => minuteOf(x, HOURS),
    stagedId: 'apt-09', pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
  })

  /** And what `solveBed(solveLanes(id), …)` will actually do with it. */
  const solveOn = (board: BoardLane[], staffKey: string, stores: string[] | null, start: number, end: number) =>
    allocateBed(board, {
      id: 'apt-09', currentBed: 'bed-01', stores, requiresPrivate: false,
      start, end, stagedId: 'apt-09', pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
    })

  it('the second landing’s companions are the ones the solve will really move', async () => {
    const { staff, staged, restored } = await afterFirstLanding()
    // 14:05〜15:05 — さくら has to move again for this one, measured from the day
    // the operator started on.
    const solve = solveOn(restored, staff.key, staff.stores, 845, 905)
    expect(solve.reseats).toEqual([{ id: 'apt-26', from: 'bed-01', to: 'bed-02' }])

    const q = askAt(staff.key, 845, 905)
    const judged = landingVerdict(restored, q, null)
    expect({ room: judged.bedLane, reseats: judged.reseats })
      .toEqual({ room: solve.laneKey, reseats: solve.reseats })

    // …and the board on screen would have said NOBODY moves — the 仮押さえ box
    // would have named no one, and the guard would never have been re-asked on
    // the shuffled day at all.
    const onScreen = landingVerdict(staged, q, null)
    expect(onScreen.reseats).toEqual([])
    expect(onScreen.reseats).not.toEqual(solve.reseats)
  })

  it('…and the room itself can differ, so the word can name a room the drop will not take', async () => {
    const { staff, staged, restored } = await afterFirstLanding()
    // 14:30〜15:30 — さくら's own hold hour. Restored, ベッド1 is hers and きり
    // gets ベッド2; on the screen's board she has already vacated it.
    const solve = solveOn(restored, staff.key, staff.stores, 870, 930)
    const q = askAt(staff.key, 870, 930)
    expect(landingVerdict(restored, q, null).bedLane).toBe(solve.laneKey)
    expect([landingVerdict(staged, q, null).bedLane, solve.laneKey]).toEqual(['bed-01', 'bed-02'])
  })

  it('and the screen takes ONE board and asks everything on it', () => {
    // `solveLanes` is the single answer to 「which board does this landing solve
    // against?」 — the cell, both verdicts and the shuffle all read it, so the
    // judgement and the solve can no longer drift apart.
    expect(SCREEN).toContain('const base = solveLanes(q.id)')
    expect(SCREEN).toContain('const v = verdictFor(q, cellOn(base), opts.pack, base)')
    expect(SCREEN).toContain('const shuffled = applyBedMoves(base, companionsFor(base, v.reseats), hours, props.bedCleanupMinutes)')
    expect(SCREEN).toContain('return { ...verdictFor(q, cellOn(shuffled), true, shuffled), reseats: v.reseats }')
    // The gesture end reads the board through `solveLanes` and nowhere else.
    const landing = SCREEN.slice(SCREEN.indexOf('const verdictAtLanding = useCallback('), SCREEN.indexOf('const verdictRef = useRef('))
    expect(landing).not.toContain('boardLanes)')
    expect(landing).not.toContain('boardLanes,')
    // …and every OTHER consumer still gets the board on screen, by default.
    expect(SCREEN).toContain('(q: LandingAsk, cell: RailCell | null, pack = false, lanes: BoardLane[] = boardLanes): LandingVerdict =>')
  })
})

/** ⚖ FIX ROUND 2 — THE THREE SCREEN DEFECTS THE BLIND ROUND FOUND, EXECUTED.
 *
 *  F1 (CODE-LENS-1, BLOCKER) — the per-frame word ran the pack.
 *  F2 (CODE-LENS-2, BLOCKER) — 「より良い開始」 staged a shuffled board's room and
 *    sent the shuffle home in the same write.
 *  F3 (CODE-LENS-2, MAJOR)  — a packing landing answered `reseats: []`.
 *
 *  All three live in `TodayScreen`, which this suite does not render, so each is
 *  proven the way R6b's own half is: the screen's line is pinned as source, and
 *  the RULE it stands on is executed here on Liam's own board. */
describe('F1 — `pack` is the only switch: the same ask, two answers', () => {
  /** `verdictFor`'s own field list, so this is the question the screen asks. */
  const askKiri = (staffKey: string, pack: boolean) => ({
    staffLane: staffKey, bedLane: 'bed-01', solveRoom: true, id: 'apt-09',
    requiresPrivate: false, start: 840, end: 900, span: place(840, 900, HOURS),
    foreignRefusal: null, hasPrice: true, locked: [] as string[],
    minutesOf: (x: number) => minuteOf(x, HOURS),
    stagedId: null, pack, now: 804, cleanupMinutesByBed: NO_CLEANUP,
  })

  it('with the pack OFF the landing is refused, in today’s exact sentence, moving nobody', async () => {
    const lanes = await demoLanes()
    const staff = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === 'apt-09'))!
    const off = landingVerdict(lanes, askKiri(staff.key, false), null)
    expect(off.kind).toBe('blocked')
    expect(off.bedLane).toBeNull()
    expect(off.reseats).toEqual([])
    expect(off.reason).toBe(
      '14:00〜15:00はベッドに空きがありません。ベッド1（見本 さくら様 14:30〜15:30）、ベッド2（見本 かえる様 13:00〜14:30）、ベッド3（テスト なぎ様 14:05〜15:05）が使用中です',
    )
    // …and a question that never names `pack` at all is the same answer, because
    // absent means NO — every caller that predates the pack is untouched.
    const silent: Omit<ReturnType<typeof askKiri>, 'pack'> & { pack?: boolean } = askKiri(staff.key, false)
    delete silent.pack
    expect(landingVerdict(lanes, silent, null).reason).toBe(off.reason)
  })

  it('with the pack ON the same ask returns the packed room — one flag, nothing else changed', async () => {
    const lanes = await demoLanes()
    const staff = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === 'apt-09'))!
    const on = landingVerdict(lanes, askKiri(staff.key, true), null)
    expect(on.bedLane).toBe('bed-01')
    expect(on.reseats).toEqual([{ id: 'apt-26', from: 'bed-01', to: 'bed-02' }])
    // The 満室 refusal is gone because the room is REAL, not because the sentence
    // was rewritten — the OFF ask above still gets it, byte for byte. (What is
    // left on this ask is the staff-side 重複 with きり's own un-moved card: this
    // suite asks the verdict about a board the drag has not been applied to,
    // which the screen's own `liveMoves` does before it asks.)
    expect(on.reason).not.toBe(
      '14:00〜15:00はベッドに空きがありません。ベッド1（見本 さくら様 14:30〜15:30）、ベッド2（見本 かえる様 13:00〜14:30）、ベッド3（テスト なぎ様 14:05〜15:05）が使用中です',
    )
  })
})

describe('F3 — a packing landing answers with the companions it will actually stage', () => {
  it('the verdict’s `reseats` are the first solve’s, never the shuffled board’s empty set', async () => {
    const lanes = await demoLanes()
    const staff = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === 'apt-09'))!
    // Leg one, as `verdictAtLanding` runs it.
    const v = landingVerdict(lanes, {
      staffLane: staff.key, bedLane: 'bed-01', solveRoom: true, id: 'apt-09',
      requiresPrivate: false, start: 840, end: 900, span: place(840, 900, HOURS),
      foreignRefusal: null, hasPrice: true, locked: [], minutesOf: (x: number) => minuteOf(x, HOURS),
      stagedId: null, pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
    }, null)
    expect(v.reseats).toEqual([{ id: 'apt-26', from: 'bed-01', to: 'bed-02' }])

    // Leg two, on the board the shuffle would leave: step 0 succeeds there, so
    // its OWN reseats are empty. That empty set used to be the returned answer.
    const shuffled = applyBedMoves(lanes, companionsFor(lanes, v.reseats), HOURS)
    const second = landingVerdict(shuffled, {
      staffLane: staff.key, bedLane: 'bed-01', solveRoom: true, id: 'apt-09',
      requiresPrivate: false, start: 840, end: 900, span: place(840, 900, HOURS),
      foreignRefusal: null, hasPrice: true, locked: [], minutesOf: (x: number) => minuteOf(x, HOURS),
      stagedId: null, pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
    }, null)
    expect(second.reseats).toEqual([])

    // The screen returns the second leg's verdict WITH the first leg's reseats —
    // and that set is exactly what the landing stages (`solveBed`'s companions).
    const returned = { ...second, reseats: v.reseats }
    const staged = companionsFor(lanes, allocateBed(lanes, {
      id: 'apt-09', currentBed: 'bed-01', stores: staff.stores, requiresPrivate: false,
      start: 840, end: 900, pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
    }).reseats)
    expect(returned.reseats.map((r) => `${r.id}:${r.from}→${r.to}`))
      .toEqual(staged.map((c) => `${c.id}:${c.bedOrigin.laneKey}→${c.bedTo}`))
  })
})

/** ⚖ FIX ROUND 2 (F2), CODE-LENS-2's BLOCKER — 「より良い開始」 DOUBLE-BOOKED A ROOM.
 *
 *  `placePendingAt` was the ONE landing on this board that did not re-solve: it
 *  took `again.bedLane` off the second verdict — a room chosen on the SHUFFLED
 *  board — and called `stage()` with no companions, which writes every previous
 *  companion HOME in the same update. The room was free only because of a
 *  shuffle the same call cancelled.
 *
 *  This is that scene, with both stagings executed as `stage()` writes them. */
describe('F2 — the safe-start press stages a room it solved for, on the board it stages against', () => {
  /** Two bookings on one bed lane, overlapping in time — ⚖ 8/9's impossible
   *  state, the thing the operator actually sees drawn. */
  const doubleBookings = (board: BoardLane[]) => {
    const out: string[] = []
    for (const l of board.filter((x) => x.group === 'beds')) {
      const on = l.items.filter((i) => i.kind === 'booking')
      for (let i = 0; i < on.length; i += 1) {
        for (let j = i + 1; j < on.length; j += 1) {
          if (on[i].startMin < on[j].endMin && on[j].startMin < on[i].endMin) out.push(`${l.key}:${on[i].caseId}×${on[j].caseId}`)
        }
      }
    }
    return out
  }

  const scene = async () => {
    const lanes = await demoLanes()
    const staff = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === 'apt-09'))!
    // Gesture one: きり 14:00〜15:00 takes ベッド1, さくら moves ベッド1 → ベッド2.
    const first = allocateBed(lanes, {
      id: 'apt-09', currentBed: 'bed-01', stores: staff.stores, requiresPrivate: false,
      start: 840, end: 900, pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
    })
    const companions = companionsFor(lanes, first.reseats)
    const span = place(840, 900, HOURS)
    // `stage()`'s own writes, transcribed: the subject, then the companions in
    // vacate-before-occupy order.
    const bedMoves: Record<string, { laneKey: string; x: number; w: number }> = { 'apt-09': { laneKey: first.laneKey!, ...span } }
    for (const c of vacateBeforeOccupy(companions)) bedMoves[c.id] = { laneKey: c.bedTo, x: c.bedOrigin.x, w: c.bedOrigin.w }
    // `stage()` writes the STAFF side too, and `applyMoves` reads every span
    // from there — a companion has no entry, so its time never moves (⚖ 51).
    const moves: Record<string, { laneKey: string; x: number; w: number }> = { 'apt-09': { laneKey: staff.key, ...span } }
    const staged = applyMoves(lanes, moves, [], [], HOURS, bedMoves)
    return { lanes, staff, companions, moves, bedMoves, staged, restored: lanesWithCompanionsRestored(staged, companions, HOURS) }
  }

  /** The press: 「より良い開始」 at 14:05, the same 60 minutes. */
  const AT = place(845, 905, HOURS)

  it('the OLD press double-booked ベッド1 — the room the shuffle bought, with the shuffle cancelled', async () => {
    const { lanes, staff, moves, bedMoves, staged, restored } = await scene()
    // The verdict's SECOND leg, which is where `again.bedLane` came from.
    const v = landingVerdict(restored, {
      staffLane: staff.key, bedLane: 'bed-01', solveRoom: true, id: 'apt-09',
      requiresPrivate: false, start: 845, end: 905, span: AT,
      foreignRefusal: null, hasPrice: true, locked: [], minutesOf: (x: number) => minuteOf(x, HOURS),
      stagedId: 'apt-09', pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
    }, null)
    const shuffled = applyBedMoves(restored, companionsFor(restored, v.reseats), HOURS)
    const again = landingVerdict(shuffled, {
      staffLane: staff.key, bedLane: 'bed-01', solveRoom: true, id: 'apt-09',
      requiresPrivate: false, start: 845, end: 905, span: AT,
      foreignRefusal: null, hasPrice: true, locked: [], minutesOf: (x: number) => minuteOf(x, HOURS),
      stagedId: 'apt-09', pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
    }, null)
    // The word says CLEAN, so the button fires…
    expect(again.kind).not.toBe('blocked')
    expect(again.bedLane).toBe('bed-01')
    // …and the old `stage(…, { bedLane: again.bedLane })` carried no companions,
    // so the previous ones are written home in the same update.
    const old: Record<string, { laneKey: string; x: number; w: number }> = { ...bedMoves, 'apt-09': { laneKey: again.bedLane!, ...AT } }
    for (const c of (await scene()).companions) old[c.id] = c.bedOrigin
    const onStaff = { ...moves, 'apt-09': { laneKey: staff.key, ...AT } }
    expect(doubleBookings(applyMoves(lanes, onStaff, [], [], HOURS, old))).toEqual(['bed-01:apt-09×apt-26'])
    // (and the board it was staged FROM was clean — the press made the mess)
    expect(doubleBookings(staged)).toEqual([])
  })

  it('the NEW press re-solves on the board it stages against: no overlap, and the companions ride along', async () => {
    const { lanes, staff, companions, moves, bedMoves, restored } = await scene()
    // `solveBed(solveLanes(pending.id), …)` — the same door the other four
    // landings use, on the board with the first gesture's companions restored.
    const solved = allocateBed(restored, {
      id: 'apt-09', currentBed: 'bed-01', stores: staff.stores, requiresPrivate: false,
      start: 845, end: 905, stagedId: 'apt-09', pack: true, now: 804, cleanupMinutesByBed: NO_CLEANUP,
    })
    expect(solved.laneKey).not.toBeNull()
    const next = companionsFor(restored, solved.reseats)
    // `stage()`'s own bookkeeping: the previous set goes home, then this one.
    const fixed: Record<string, { laneKey: string; x: number; w: number }> = { ...bedMoves, 'apt-09': { laneKey: solved.laneKey!, ...AT } }
    for (const c of companions) fixed[c.id] = c.bedOrigin
    for (const c of vacateBeforeOccupy(next)) fixed[c.id] = { laneKey: c.bedTo, x: c.bedOrigin.x, w: c.bedOrigin.w }
    expect(doubleBookings(applyMoves(lanes, { ...moves, 'apt-09': { laneKey: staff.key, ...AT } }, [], [], HOURS, fixed))).toEqual([])
    // …and the 仮押さえ box names さくら, rather than naming nobody while she moves.
    expect(companionLines(restored, next)).toEqual(['見本 さくら様 ベッド1 → ベッド2'])
  })
})

describe('R7 — one 元に戻す, all the cards', () => {
  it('the revert restores every companion before the subject', () => {
    const revert = SCREEN.slice(SCREEN.indexOf('function revertPending()'), SCREEN.indexOf('function confirmPending()'))
    const companionLine = revert.indexOf('for (const c of pending.companions ?? []) next[c.id] = c.bedOrigin')
    const subjectLine = revert.indexOf('if (bedOrigin) next[id] = bedOrigin')
    expect(companionLine).toBeGreaterThan(-1)
    expect(subjectLine).toBeGreaterThan(companionLine)
  })

  it('and the record they are restored from lives on the change itself', () => {
    expect(EDITS).toContain('companions?: ReadonlyArray<BedCompanion>')
    expect(EDITS).toContain("import type { BedCompanion, Move, Moves } from './business/today/today-interactions'")
  })
})

describe('R8 — 確定 re-asks every companion’s room, and writes vacate-before-occupy', () => {
  it('a companion whose room was taken meanwhile refuses the confirm, naming that room', () => {
    // The confirm's own predicate, executed: the companion's room asked with
    // every OTHER room filtered out, so the allocator's own 満室 sentence names
    // the one room that is no longer free.
    const taken = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [
        booking({ key: 'c', caseId: 'apt-c', title: '見本 さくら' }, 780, 840),
        booking({ key: 'other', caseId: 'apt-other', title: '見本 かえる' }, 780, 840),
      ] }),
    ])
    const room = allocateBed(taken.filter((l) => l.group !== 'beds' || l.key === 'bed-02'), {
      id: 'apt-c', currentBed: 'bed-02', stores: ['store-a'], requiresPrivate: false, start: 780, end: 840,
    })
    expect(room.laneKey).toBeNull()
    expect(room.refusal).toBe('13:00〜14:00はベッドに空きがありません。ベッド2（見本 かえる様）が使用中です')
    // …and with the room still free the same ask answers with that room, so the
    // confirm passes rather than refusing everything.
    const free = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1' }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2', items: [booking({ key: 'c', caseId: 'apt-c', title: '見本 さくら' }, 780, 840)] }),
    ])
    expect(allocateBed(free.filter((l) => l.group !== 'beds' || l.key === 'bed-02'), {
      id: 'apt-c', currentBed: 'bed-02', stores: ['store-a'], requiresPrivate: false, start: 780, end: 840,
    }).laneKey).toBe('bed-02')
  })

  it('and the confirm actually runs that loop, over EVERY companion', () => {
    const confirm = SCREEN.slice(SCREEN.indexOf('function confirmPending()'), SCREEN.indexOf('⚖ LIAM flag 92 (2026-08-31) — THE SAFE ANSWER, PRESSED'))
    expect(confirm).toContain('for (const c of pending.companions ?? []) {')
    // ⚖ FIX ROUND 2 (F10) — the re-check is a pure function now, so the screen is
    // the thin caller and the RULE is executed above rather than spelled here.
    expect(confirm).toContain('const room = companionRoomStillFree(boardLanes, c, span, hours)')
    expect(confirm).toContain('if (!room.ok) {')
    // ⚖ FIX ROUND 2 (F5) — and the refusal is ATTRIBUTED: the composed 満室
    // sentence is about the companion's own window and room, which match nothing
    // the operator dragged. The sibling sentence stands only where the board
    // cannot name the person (⚖ A3 — omit what cannot be stated).
    expect(confirm).toContain('const title = boardLanes.flatMap((l) => l.items).find((i) => i.caseId === c.id)?.title')
    expect(confirm).toContain('? `${title}様の移動先を確保できなくなったため、この内容では確定できません`')
    expect(confirm).toContain(": (room.refusal ?? '状況が変わったため、この内容では確定できません'))")
    expect(confirm).not.toContain('allocateBed(')
    // ONE home for the sentence — the native pass rewrites it in one place.
    expect((SCREEN.match(/様の移動先を確保できなくなったため/g) ?? [])).toHaveLength(1)
  })

  it('vacate-before-occupy: the card LEAVING a room is written before the card entering it', () => {
    // A chain: B → ベッド3, A → ベッド2 (the room B is vacating). B must be
    // written first, whatever order the search happened to return them in.
    const chain: BedCompanion[] = [
      { id: 'A', bedOrigin: { laneKey: 'bed-01', x: 0, w: 1 }, bedTo: 'bed-02' },
      { id: 'B', bedOrigin: { laneKey: 'bed-02', x: 0, w: 1 }, bedTo: 'bed-03' },
    ]
    expect(vacateBeforeOccupy(chain).map((c) => c.id)).toEqual(['B', 'A'])
    expect(vacateBeforeOccupy([...chain].reverse()).map((c) => c.id)).toEqual(['B', 'A'])
    // A three-link chain orders end-first all the way down.
    expect(vacateBeforeOccupy([
      { id: 'A', bedOrigin: { laneKey: 'bed-01', x: 0, w: 1 }, bedTo: 'bed-02' },
      { id: 'B', bedOrigin: { laneKey: 'bed-02', x: 0, w: 1 }, bedTo: 'bed-03' },
      { id: 'C', bedOrigin: { laneKey: 'bed-03', x: 0, w: 1 }, bedTo: 'bed-04' },
    ]).map((c) => c.id)).toEqual(['C', 'B', 'A'])
    // A CYCLE has no such order — nothing can go first — so it keeps the order it
    // came in with, and it is the one case core needs an atomic batch for. The
    // seam is named in the source rather than silently worked around.
    const cycle: BedCompanion[] = [
      { id: 'A', bedOrigin: { laneKey: 'bed-01', x: 0, w: 1 }, bedTo: 'bed-02' },
      { id: 'B', bedOrigin: { laneKey: 'bed-02', x: 0, w: 1 }, bedTo: 'bed-01' },
    ]
    expect(vacateBeforeOccupy(cycle).map((c) => c.id)).toEqual(['A', 'B'])
    expect(SCREEN).toContain('core seam (design §4)')
    // Every writer of companion rooms uses the order — the stage, the 次回予約
    // placement and the shelf chip.
    expect((SCREEN.match(/vacateBeforeOccupy\(/g) ?? [])).toHaveLength(3)
  })
})

/** ⚖ FIX ROUND 2 (F10), CODE-LENS-4 F1 — THE SCREEN'S TWO COMPANION RULES,
 *  EXECUTED RATHER THAN TEXT-PINNED.
 *
 *  The breaker's finding, verbatim: 「every check is a source-text pin, never an
 *  execution … A rewrite that preserves the pinned substring while changing
 *  behavior (or one that changes an unrelated adjacent line the pin doesn't
 *  check) would sail through all 10,559 green tests undetected.」 Both closures
 *  are pure decisions, so both are now functions in today-interactions and the
 *  screen is their caller. The pins above hold the calls; these hold the rules. */
describe('F10 — `isStagedCard`: every card the change moved wears the outline', () => {
  const withCompanions = {
    id: 'apt-09',
    companions: [{ id: 'apt-26', bedOrigin: { laneKey: 'bed-01', x: 0, w: 1 }, bedTo: 'bed-02' }] as BedCompanion[],
  }
  it('the subject, and every companion, and nobody else', () => {
    expect(isStagedCard(withCompanions, 'apt-09')).toBe(true)
    expect(isStagedCard(withCompanions, 'apt-26')).toBe(true)
    expect(isStagedCard(withCompanions, 'apt-14')).toBe(false)
  })
  it('a change that moved nobody still marks its own card', () => {
    expect(isStagedCard({ id: 'apt-09' }, 'apt-09')).toBe(true)
    expect(isStagedCard({ id: 'apt-09', companions: [] }, 'apt-26')).toBe(false)
  })
  it('nothing staged, or a row with no booking behind it, is never staged', () => {
    // A 清掃 tail, a 予定ブロック and a shift hatch all carry `caseId: null`, and
    // an id of `null` must never match the subject's own id by accident.
    expect(isStagedCard(null, 'apt-09')).toBe(false)
    expect(isStagedCard(undefined, 'apt-09')).toBe(false)
    expect(isStagedCard(withCompanions, null)).toBe(false)
    expect(isStagedCard(null, null)).toBe(false)
  })
})

describe('F10 — `companionRoomStillFree`: the confirm-time re-check, on Liam’s board', () => {
  /** さくら (apt-26) staged into ベッド2 for her own hour, 14:30〜15:30. */
  const sakura: BedCompanion = { id: 'apt-26', bedOrigin: { laneKey: 'bed-01', x: 0, w: 1 }, bedTo: 'bed-02' }
  const HER_SPAN = place(870, 930, HOURS)

  it('says yes while the room is hers', async () => {
    const lanes = await demoLanes()
    // かえる leaves ベッド2 at 14:30, so it is free for her whole hour.
    expect(companionRoomStillFree(lanes, sakura, HER_SPAN, HOURS)).toEqual({ ok: true })
  })

  it('says no, and names the room, when somebody took ベッド2 meanwhile', async () => {
    const lanes = await demoLanes()
    // An intruder lands in ベッド2 across her window — another operator, another
    // tab, the world moving under an unconfirmed change (canon R11-7's reason).
    const intruder = lanes.map((l) => (l.key === 'bed-02'
      ? { ...l, items: [...l.items, booking({ key: 'x', caseId: 'apt-x', title: '見本 かえで' }, 870, 930)] }
      : l))
    const answer = companionRoomStillFree(intruder, sakura, HER_SPAN, HOURS)
    expect(answer.ok).toBe(false)
    expect(answer.ok === false && answer.refusal)
      .toBe('14:30〜15:30はベッドに空きがありません。ベッド2（見本 かえで様）が使用中です')
  })

  it('the room filter buys the SENTENCE, never the decision (CODE-LENS-4 F6)', async () => {
    const lanes = await demoLanes()
    const intruder = lanes.map((l) => (l.key === 'bed-02'
      ? { ...l, items: [...l.items, booking({ key: 'x', caseId: 'apt-x', title: '見本 かえで' }, 870, 930)] }
      : l))
    // Asked about the WHOLE board the allocator answers with some other free
    // room, so the gate still refuses — but with no sentence to say. That is the
    // whole of the filter's job, and it is why the filter lives in one place.
    const staff = intruder.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === sakura.id))!
    const unfiltered = allocateBed(intruder, {
      id: sakura.id, currentBed: sakura.bedTo, stores: staff.stores, requiresPrivate: false, start: 870, end: 930,
    })
    expect(unfiltered.laneKey).not.toBe(sakura.bedTo)
    expect(unfiltered.laneKey).not.toBeNull()
    expect(unfiltered.refusal).toBeNull()
  })

  it('reads the booking’s own 個室のみ tag, exactly as the landings do', async () => {
    const lanes = await demoLanes()
    // なぎ (apt-29) is the fixture's one tagged booking, in ベッド3 14:05〜15:05.
    // Ask her re-check about a STANDARD room and the tag refuses it; the same
    // ask with the allocator stubbed proves the field reaches the call.
    const seen: Array<boolean> = []
    const answer = companionRoomStillFree(
      lanes,
      { id: 'apt-29', bedOrigin: { laneKey: 'bed-03', x: 0, w: 1 }, bedTo: 'bed-01' },
      place(845, 905, HOURS),
      HOURS,
      ((board, opts) => { seen.push(opts.requiresPrivate); return allocateBed(board, opts) }) as typeof allocateBed,
    )
    expect(seen).toEqual([true])
    expect(answer.ok).toBe(false)
  })
})

describe('R10 — a shuffle that kills a held window is judged on the board it would leave', () => {
  it('the bed door flips on the SAME board once the companions are applied', () => {
    // ベッド2 is free 13:00〜14:00, so a new client could be placed there. A
    // companion moving INTO it takes that away — and the guard has to be asked
    // about the board the shuffle leaves, not the one before it.
    const beds = [
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: [booking({ key: 'c', caseId: 'apt-c', title: 'C' }, 780, 840)] }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ]
    const board = boardOf(beds)
    const w = applyBedMoves(board, [{ id: 'apt-c', bedOrigin: { laneKey: 'bed-01', x: 0, w: 1 }, bedTo: 'bed-02' }], HOURS)
    // 「could a new client have ベッド2 for this hour?」 — asked of ベッド2 alone,
    // which is what a held 新規用 window depends on.
    const bed2Free = (b: BoardLane[]) =>
      allocateBed(b.filter((l) => l.group !== 'beds' || l.key === 'bed-02'), {
        id: null, currentBed: 'bed-02', stores: ['store-a'], requiresPrivate: false, start: 780, end: 840,
      }).laneKey
    expect(bed2Free(board)).toBe('bed-02')
    expect(bed2Free(w)).toBeNull()
  })

  it('and the screen asks the guard on exactly that board', () => {
    expect(SCREEN).toContain('const v = verdictFor(q, cellOn(base), opts.pack, base)')
    expect(SCREEN).toContain('if (!opts.pack || v.reseats.length === 0) return v')
    expect(SCREEN).toContain('const shuffled = applyBedMoves(base, companionsFor(base, v.reseats), hours, props.bedCleanupMinutes)')
    expect(SCREEN).toContain('return { ...verdictFor(q, cellOn(shuffled), true, shuffled), reseats: v.reseats }')
  })
})

describe('B — the fence at the screen: only a gesture END packs', () => {
  /** ⚖ FIX ROUND 2 (F1), CODE-LENS-1's BLOCKER — THE FENCE, ASKED OF EVERY CALL
   *  SITE RATHER THAN OF A GREP.
   *
   *  The pin this replaces counted `/pack: true/` and found ONE — `solveBed`'s
   *  keyword form — and called that proof that the per-frame word does not pack.
   *  It was not: `verdictAtLanding`'s body hardcoded a POSITIONAL `true`, which
   *  that regex can never match, and both live paint paths reach it through
   *  `verdictRef`. Every pointer-move frame over an occupied room ran the full
   *  backtracking search. The test title said otherwise and 637 tests were green.
   *
   *  So the fence is now asked of the CALL SITES: every one of them names its
   *  own answer, and the two per-frame paints name OFF. */
  it('every landing question names its own `pack`, and the two per-frame words say no', () => {
    // ⚖ LIVE-WHILE-DRAGGING (2026-09-11) — AND NOW ONE OF THEM SAYS 「whatever
    // this gesture is」. The cursor's word asks the packing question while an
    // UNSTAGED board card is in hand, because the gesture's own memo made it
    // affordable — measured NEGATIVE against today's frame on both stress
    // boards. So ⚖ flag 54's asymmetry closes rather than being kept: the word
    // promises exactly what the release will do. The fence is unchanged in
    // shape — every call site still names its own answer out loud — and the one
    // new spelling, `livePack()`, has ONE home and is pinned to it below.
    //
    // Thirteen call sites, each carrying its answer as the second argument. The
    // regex matches a CALL (`(`), so a comment naming the function is not one.
    // The thirteenth is the aimed chip's own re-judge inside
    // `paintProxyVerdict` (⚖ ADJUDICATION L2 M-1).
    const calls = [...SCREEN.matchAll(/verdict(?:Ref\.current|AtLanding)\(/g)].map((m) => m.index ?? -1)
    expect(calls).toHaveLength(13)
    for (let i = 0; i < calls.length; i += 1) {
      const seg = SCREEN.slice(calls[i], calls[i + 1] ?? SCREEN.length)
      // `, livePack())` rather than a bare `livePack()`: the switch is ALSO read
      // as `livePack().pack` at the `verdictFor(` sites two layers down, and an
      // answer is the one that sits in this call's own argument position.
      const answers = seg.match(/\{ pack: (?:true|false) \}|, livePack\(\)\)/g) ?? []
      // Exactly one answer between this call and the next: no call is silent,
      // and none of them is answered twice.
      expect({ at: seg.slice(0, 48), answers: answers.length }).toEqual({ at: seg.slice(0, 48), answers: 1 })
    }
    // Nine gesture ENDS and three OFF sites — counted over the whole file, so a
    // thirteenth call cannot hide inside a segment.
    //
    // ⚖ FIX ROUND 3 (G1, DELTA-CODE-D1) — the third OFF site is
    // `pendingGuardRow`'s own offer gate, not a fourth per-frame paint word.
    // That `useMemo` depends on `boardLanes`, which gets a fresh identity on
    // every RAF frame while the staged card is re-dragged (the one live drag
    // reachable with a card pending, every other drag door refuses while
    // `pending` is set) — so it used to run the packed search on every frame of
    // that gesture. FIX ROUND 2's own count (ten ON, two OFF) missed it.
    //
    // ⚖ LIVE-WHILE-DRAGGING / ADJUDICATION L2 M-4 — `{ pack: false }` goes 3 → 2,
    // NOT 3 → 1: the shelf chip is out of this round's scope and
    // `paintChipVerdict` is byte-unchanged. Its landing lattice is
    // `shelfLanding(fractionIn(track, clientX), …)`, a different geometry from the
    // card's `nextSpan`, so wiring it is a round of its own (queued). Nine ON is
    // unchanged.
    expect((SCREEN.match(/\{ pack: true \}/g) ?? [])).toHaveLength(9)
    expect((SCREEN.match(/\{ pack: false \}/g) ?? [])).toHaveLength(2)
    // …and the card's per-frame paint answers with the GESTURE's own switch while
    // the shelf chip's stays OFF. Both are called from the coalesced pointer-move
    // frame; only one of them has a memo behind it.
    const proxyBody = SCREEN.slice(SCREEN.indexOf('function paintProxyVerdict('), SCREEN.indexOf('\n  }\n', SCREEN.indexOf('function paintProxyVerdict(')))
    expect({ fn: 'paintProxyVerdict', live: proxyBody.includes('livePack()') }).toEqual({ fn: 'paintProxyVerdict', live: true })
    expect({ fn: 'paintProxyVerdict', on: proxyBody.includes('{ pack: true }') }).toEqual({ fn: 'paintProxyVerdict', on: false })
    expect({ fn: 'paintProxyVerdict', off: proxyBody.includes('{ pack: false }') }).toEqual({ fn: 'paintProxyVerdict', off: false })
    const chipBody = SCREEN.slice(SCREEN.indexOf('function paintChipVerdict('), SCREEN.indexOf('\n  }\n', SCREEN.indexOf('function paintChipVerdict(')))
    expect({ fn: 'paintChipVerdict', off: chipBody.includes('{ pack: false }') }).toEqual({ fn: 'paintChipVerdict', off: true })
    expect({ fn: 'paintChipVerdict', on: chipBody.includes('{ pack: true }') }).toEqual({ fn: 'paintChipVerdict', on: false })
    expect({ fn: 'paintChipVerdict', live: chipBody.includes('livePack()') }).toEqual({ fn: 'paintChipVerdict', live: false })
    //
    // ⚖ THE SWITCH HAS ONE HOME, AND IT READS ONE THING. A `livePack` that
    // consulted anything else — a prop, a dial, a second ref — would be a second
    // answer to 「is this gesture packing?」, which is the disease the whole fence
    // exists to prevent.
    expect(SCREEN).toContain('const livePack = () => ({ pack: gestureMemoRef.current != null })')
    expect((SCREEN.match(/const livePack = /g) ?? [])).toHaveLength(1)
    // …and the ref it reads is OPENED in exactly one place, under exactly one
    // condition: an unstaged MOVE of a board card. A bed-row drag, a resize and a
    // staged card's re-drag each keep today's path byte for byte, and the last of
    // those is a correctness rule rather than a cost one — a staged re-drag solves
    // on the board with its companions put back, so memoising its chips on the
    // board on screen would be a NEW disagreement.
    expect(SCREEN).toContain("if (ctx.origin.mode === 'move' && ctx.group !== 'beds' && pending?.id !== ctx.id) {\n      gestureMemoRef.current = gestureAllocator({")
    // ⚖ ADJUDICATION L2 MINOR 4 — tolerant of whitespace and of `??=`, because
    // this pin's whole job is to be the one thing between the product and a
    // second creation site, and `gestureAllocator (` would have walked past it.
    expect((SCREEN.match(/gestureMemoRef\.current\s*(?:\?\?)?=\s*gestureAllocator\s*\(/g) ?? [])).toHaveLength(1)
    // …and every exit of the release frees it, through one `finally`.
    expect(SCREEN).toContain('    try {\n      finishDragAt(clientX, clientY, upAt)\n    } finally {\n      freeGesture()\n    }')
    expect(SCREEN).toContain('function freeGesture() {\n    gestureMemoRef.current?.free()\n    gestureMemoRef.current = null\n    toneRef.current = null\n  }')
    // ⚖ ADJUDICATION L2 MAJOR 3 — …AND THE OTHER THREE EXITS, each with the
    // statement it stands beside. ⚖ M-4 asks for `free()` at four exits and only
    // the `finally` was pinned, so the breaker's mutant (e) — delete the call
    // from `cancelDrag` — shipped the whole battery green, leaving a cancelled
    // gesture's memo alive: `livePack()` goes on saying `true` and every render
    // between the cancel and the next pointerdown paints the strip through a
    // memo built for a hand that is no longer there.
    expect(SCREEN).toContain('    clearDrag()\n    freeGesture()\n  }')
    expect(SCREEN).toContain('useEffect(() => () => { dragRef.current?.detach(); freeGesture() }, [])')
    expect(SCREEN).toContain("if (e.button !== 0 || dragRef.current || !item.caseId) return\n    // Defensive: a gesture that ended through a path nobody expected must not\n    // lend its answers to the next one (⚖ ADJUDICATION L2 M-4).\n    freeGesture()")
    // …one definition and four calls, counted, so a fifth exit cannot appear
    // without this line and a call cannot quietly move into `clearDrag`.
    expect((SCREEN.match(/freeGesture\(/g) ?? [])).toHaveLength(5)
    // …and `pendingGuardRow`'s own memo body is the third OFF site — the FIX
    // ROUND 3 (G1) mutant: reverting its gate to `{ pack: true }` must fail
    // this pin.
    {
      const start = SCREEN.indexOf('const pendingGuardRow = useMemo(')
      const end = SCREEN.indexOf(
        '}, [pending, pendingOffBoard, moves, bedMoves, boardLanes, hours, verdictAt, props.guard.bookingStepMin])',
      )
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      const body = SCREEN.slice(start, end)
      expect({ fn: 'pendingGuardRow', off: body.includes('{ pack: false }') }).toEqual({ fn: 'pendingGuardRow', off: true })
      expect({ fn: 'pendingGuardRow', on: body.includes('{ pack: true }') }).toEqual({ fn: 'pendingGuardRow', on: false })
    }
    // `solveBed`'s own keyword form is the ONE remaining spelling — the other
    // door design §3 allows, and the only `pack:` field written anywhere.
    expect((SCREEN.match(/pack: true,/g) ?? [])).toHaveLength(1)
    //
    // ⚖ ADJUDICATION L2 M-6 — THE THREE `verdictFor(` CALL SITES, ENUMERATED BY
    // TEXT, because a count cannot tell a per-frame ask from a gesture-end one
    // and the 9/8 round lost a positional `true` to exactly that blindness. The
    // renderer names the gesture's switch, `reseatLandingAt` names `false`, and
    // `verdictAtLanding` passes its own argument through on both legs.
    const verdictForCalls = [...SCREEN.matchAll(/verdictFor\(/g)]
    expect(verdictForCalls).toHaveLength(6)
    for (const site of [
      'const v = inHand ? verdictFor({ ...inHand, staffLane: rail.laneKey, span: place(c.start, c.start + railDur, hours) }, c, livePack().pack) : null',
      'const v = verdictFor(ask, verdictAt(laneKey, start, railDur, null, lanes), false, lanes)',
      // ⚖ ADJUDICATION L2 MINOR 2 — the ⇄ fill's own first ask, inside
      // `fillToneSlots`. Five of the six sites were named and this was the one
      // left out: the only site that could grow a bare positional `true`
      // unnoticed, and the one F1 has just moved.
      'const v = verdictFor(ask, c, livePack().pack)',
      'const v = verdictFor(q, cellOn(base), opts.pack, base)',
      'return { ...verdictFor(q, cellOn(shuffled), true, shuffled), reseats: v.reseats }',
      'const final = verdictFor(ask, verdictAt(rail.laneKey, c.start, railDur, inHand.id, shuffled), false, shuffled)',
    ]) {
      expect({ site, present: SCREEN.includes(site) }).toEqual({ site, present: true })
    }
    // …and the ONE literal `true` in that set is `verdictAtLanding`'s own re-judge
    // on the shuffled board — the drop's second leg, pinned line by line in §A
    // above. No per-frame site may grow one.
    expect([...SCREEN.matchAll(/verdictFor\([\s\S]{0,200}?,\s*true[,)]/g)]).toHaveLength(1)
    //
    // ⚖ ADJUDICATION L2 M-3 — THE MEMO'S TWO STAMPS ARE WRITTEN IN THE RENDER
    // BODY, ADJACENT TO THE BOARD REF AND ABOVE THE CHIPS THAT READ THEM. The
    // mutant this exists for leaves every ANSWER correct and only changes COST:
    // move either assignment into an effect and the ref is one frame stale, every
    // chip fails the memo's board-family gate, and the memo is silently dead. No
    // suite renders TodayScreen, so the behavioural clause cannot see the wiring —
    // the ordering and the ADJACENCY are the text that can.
    expect(SCREEN).toContain('const boardLanesRef = useRef(boardLanes)\n  boardLanesRef.current = boardLanes')
    expect(SCREEN).toContain("const rowStampRef = useRef('')\n  rowStampRef.current = handRowStamp(boardLanes, handId ?? '', live?.bedLane ?? null)")
    expect(SCREEN.indexOf('boardLanesRef.current = boardLanes')).toBeLessThan(SCREEN.indexOf('const v = inHand ? verdictFor('))
    expect(SCREEN.indexOf('rowStampRef.current = handRowStamp(')).toBeLessThan(SCREEN.indexOf('const v = inHand ? verdictFor('))
    //
    // ⚖ FIX ROUND 1 (F1 — Fable + blind lenses 1 and 2) — AND THE ⇄ TONE FILL IS
    // THE OTHER READER, so it is ordered too. The pin above indexed the ref
    // against the CHIP MAP only, and the fill's own ask is spelled without the
    // `inHand ?` — so it sat 111 lines ABOVE the ref with this assertion green,
    // every one of its asks failed the board-family gate, and the gesture's most
    // expensive frame paid ~660 uncached packing searches where the design
    // budgets 22. Every answer was correct; only the cost was wrong, which is
    // exactly the class no battery and no grep can see.
    expect(SCREEN.indexOf('boardLanesRef.current = boardLanes')).toBeLessThan(SCREEN.indexOf('function fillToneSlots('))
    expect(SCREEN.indexOf('rowStampRef.current = handRowStamp(')).toBeLessThan(SCREEN.indexOf('function fillToneSlots('))
    expect(SCREEN.indexOf('worldStampRef.current = worldStamp')).toBeLessThan(SCREEN.indexOf('function fillToneSlots('))
    //
    // ⚖ FIX ROUND 1 (F2) — THE SLOTS' LIFETIME IS THE MEMO'S, SPELLED ON THE
    // SCREEN. The memo empties on exactly two conditions; the view of its
    // answers is rebuilt on the same two. Dropping either compare from this
    // gate leaves a chip that becomes a ⇄ candidate after a mid-gesture clear
    // with no slot at all — it then wears ⇄ composed from the UN-shuffled
    // verdict, which is a promise the release can refuse.
    expect(SCREEN).toContain(
      'if (inHand != null && livePack().pack && (toneRef.current == null || toneRef.current.world !== worldStampRef.current || toneRef.current.row !== rowStampRef.current)) fillToneSlots()',
    )
    expect(SCREEN).toContain('toneRef.current = { world: worldStampRef.current, row: rowStampRef.current, slots }')
    // …and the gate reads the packing switch through its ONE home rather than
    // spelling `gestureMemoRef.current != null` a second time (⚖ L2 MINOR 1).
    // Six reads of the ref in all: `livePack`, the two in `freeGesture`, the two
    // authorised allocator seams (`verdictFor`'s ask and `solveBed`), and the one
    // creation site. The gate above is NOT a seventh.
    expect((SCREEN.match(/gestureMemoRef\.current/g) ?? [])).toHaveLength(6)
    //
    // ⚖ ADJUDICATION L2 MAJOR 2 — THE ⇄ SLOT KEY HAS ONE HOME AND THREE CALLERS.
    // Three spellings of one string agreement, none of them pinned: the
    // breaker's mutant (k) dropped `dur` from all three and shipped green.
    expect(SCREEN).toContain('export function slotKey(laneKey: string, start: number, dur: number): string {\n  return `${laneKey}|${start}|${dur}`\n}')
    expect((SCREEN.match(/slotKey\(/g) ?? [])).toHaveLength(4)
    // …and the two renderer lines ⚖ M-6(a) never got, byte for byte. `drop` is
    // the read; `mark` is what the read decides.
    expect(SCREEN).toContain(
      'const drop = v && v.reseats.length > 0 ? toneRef.current?.slots.get(slotKey(rail.laneKey, c.start, railDur)) : undefined',
    )
    expect(SCREEN).toContain('const mark = chip ? chip.mark : (explained?.mark ?? null)')
    // ⚖ ADJUDICATION L3 MAJOR — …and the chip's own SENTENCE, which is its
    // `aria-label` and what pressing it shows. A ⇄ chip reaches for the rest
    // layer's one clause; every other chip keeps the fallback chain byte for
    // byte. Reverting this to the bare chain leaves a screen reader hearing the
    // guard's rest-time capacity sentence on a chip whose face says 「this start
    // needs a swap」.
    expect(SCREEN).toContain(
      'const sentence =\n              v && chip?.mark\n                ? reseatSentence(v.reason ?? c.sentence, companionLines(boardLanes, companionsFor(boardLanes, v.reseats)), null)\n                : (v?.reason ?? explained?.sentence ?? c.sentence)',
    )
    // …and there is exactly ONE spelling of the clause in the whole product:
    // the engine's own helper. A literal on the screen would be the same defect
    // one round later. (The screen's single mention is a COMMENT naming this
    // helper — the regex below is anchored on the template's own opening, which
    // no comment carries.)
    expect((SCREEN.match(/ここに置くと、ほかのお客様のベッドを入れ替えて収めます/g) ?? [])).toHaveLength(0)
    expect((INTERACTIONS.match(/ここに置くと、ほかのお客様のベッドを入れ替えて収めます/g) ?? [])).toHaveLength(1)
    expect(SCREEN).toContain('slots.set(slotKey(rail.laneKey, c.start, railDur), final.kind)')
    // …and the aimed chip's own refresh keys on the length it DERIVES from the
    // frame's span, never on the render body's `railDur`: this function is
    // reached only through the listeners `beginDrag` binds once per gesture, so
    // its closure is the POINTERDOWN render's — where `live` and `dragLen` are
    // both null and `railDur` is `props.guard.standardSessionMin`. `span` is the
    // object `applyDragFrame` has just handed `setLive`, so this expression is
    // `aimDur`'s own on the same values (see §Deviations, FIX-REPORT-1).
    expect(SCREEN).toContain('      const dur = minuteOf(span.x + span.w, hours) - minuteOf(span.x, hours)\n')
    expect(SCREEN).toContain('const slot = slotKey(ctx.targetLane, chipStart, dur)')
    expect(SCREEN).toContain('const slots = toneRef.current?.slots ?? null')
    //
    // ⚖ ADJUDICATION L4 — AND THE WORLD STAMP'S DEP LIST IS PINNED BY EXACT TEXT.
    // The memo has no self-check that its caller's stamp is complete: a dropped
    // dependency serves a stale answer in silence. Each name is an invalidator in
    // its own right — a server refresh or a block move (`placedLanes`), the shelf
    // (`parked`), this session's own cards (`addedHere`), committed moves
    // (`moves`/`bedMoves`), staging (`pending`), the day (`hours`), the clock the
    // pack's lead floor reads, and each room's turnaround.
    expect(SCREEN).toContain('[placedLanes, parked, addedHere, moves, bedMoves, pending, hours, props.sell.nowMinute, props.bedCleanupMinutes],')
    // No default on the landing question, so a new call site cannot forget.
    expect(SCREEN).toContain('(q: LandingAsk, opts: { pack: boolean }): LandingVerdict => {')
    expect(SCREEN).not.toContain('opts: { pack: boolean } = ')
    expect(SCREEN).toContain('const v = verdictFor(q, cellOn(base), opts.pack, base)')
    // `verdictFor` itself never turns it on — it takes the answer from its caller
    // and defaults to OFF, so every other consumer (the 60分配置 strip's × marks,
    // the word under the cursor, the rail's own probes) is byte-unchanged. The
    // board is defaulted the same way (⚖ FIX ROUND 1 F1), so those consumers are
    // still asked about the board on screen.
    expect(SCREEN).toContain('(q: LandingAsk, cell: RailCell | null, pack = false, lanes: BoardLane[] = boardLanes): LandingVerdict =>')
    expect(SCREEN).toContain('      landingVerdict(\n        lanes,')
    const forBody = SCREEN.slice(SCREEN.indexOf('const verdictFor = useCallback('), SCREEN.indexOf('const verdictAtLanding = useCallback('))
    expect(forBody).toContain('pack,')
    expect(forBody).not.toContain('pack: true')
    // …and `pack` is not a field on the ask every surface passes around.
    expect(SCREEN).toContain("type LandingAsk = Pick<LandingQuestion, 'staffLane' | 'bedLane' | 'solveRoom' | 'id' | 'requiresPrivate' | 'foreignRefusal' | 'hasPrice'> & {")
    const askType = SCREEN.slice(SCREEN.indexOf('type LandingAsk = Pick<'), SCREEN.indexOf('type LandingAsk = Pick<') + 300)
    expect(askType).not.toContain('pack')
  })

  it('every moved card wears the staged outline', () => {
    // ⚖ FIX ROUND 2 (F10) — the predicate is `isStagedCard`, executed above.
    expect(SCREEN).toContain('const isPending = isStagedCard(pending, item.caseId)')
    // No new class and no new colour: it is the outline the subject already wore.
    expect(SCREEN).toContain("${isPending ? ' pending' : ''}")
  })

  it('the 仮押さえ box gains the lines ADDITIVELY — its own sentence is untouched', () => {
    // `holdSummary` has a second caller (the caution box's facts) and this
    // surface has a second construction branch (the day's own standing hold);
    // both answer for a landing that moved nobody, so neither may change.
    expect((SCREEN.match(/holdSummary\(/g) ?? [])).toHaveLength(2)
    expect(SCREEN).toContain('summary: pendingOffBoard ? \'\' : holdSummary(boardLanes, pending.id, moves[pending.id], hours, pending.bedOrigin?.laneKey ?? null),')
    expect(SCREEN).toContain('companionLines: pendingOffBoard ? [] : companionLines(boardLanes, pending.companions ?? []),')
    expect(SCREEN).toContain('companionLines?: readonly string[]')
    // One DOM line each — a `\n`-joined string would collapse into one run-on
    // sentence — and no new CSS rule for it.
    // ⚖ FIX ROUND 2 (F6) — keyed on index AND text: `key={line}` collapsed two
    // identical lines, so the board could move two people and name one.
    expect(SCREEN).toContain('{holdPop.companionLines.map((line, i) => (')
    expect(SCREEN).toContain('<span key={`${i}-${line}`} style={{ flexBasis: \'100%\' }}>{line}</span>')
    expect(readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')).not.toContain('companion')
  })

  /** ⚖ FIX ROUND 1 (F2) — EVERY COMPANION GETS ITS OWN LINE, AND THERE IS NO
   *  FOLD. The ceiling is what makes that safe, so the ceiling is pinned here
   *  beside the list: at `PACK_MAX_MOVES = 4` a landing can never carry a fifth
   *  companion, so the 「、ほかN件」 tail was unreachable — and standing alone as
   *  a LINE it opened with a 読点, which is only right inside
   *  `protectedWindowsClause`'s `・`-joined run. Raise the ceiling and this test
   *  fails, which is the design question landing on the round that raised it. */
  it('every companion gets its own line — the ceiling is the reason, and it is pinned', () => {
    expect(INTERACTIONS).toContain('const PACK_MAX_MOVES = 4')
    // The ceiling in force, read from the source rather than assumed.
    const ceiling = Number(/const PACK_MAX_MOVES = (\d+)/.exec(INTERACTIONS)![1])
    expect(ceiling).toBeLessThanOrEqual(4)
    // No fold left in the helper, and no line that opens with a 読点.
    expect(INTERACTIONS.slice(INTERACTIONS.indexOf('export function companionLines('))).not.toContain('ほか')

    const board = boardOf([
      lane({ key: 'bed-01', group: 'beds', label: 'ベッド1', items: ['a', 'b', 'c', 'd'].map((id) => booking({ key: id, caseId: id, title: id.toUpperCase() }, 780, 790)) }),
      lane({ key: 'bed-02', group: 'beds', label: 'ベッド2' }),
    ])
    const full: BedCompanion[] = ['a', 'b', 'c', 'd'].slice(0, ceiling)
      .map((id) => ({ id, bedOrigin: { laneKey: 'bed-01', x: 0, w: 1 }, bedTo: 'bed-02' }))
    const lines = companionLines(board, full)
    expect(lines).toHaveLength(ceiling)
    expect(lines).toEqual([
      'A様 ベッド1 → ベッド2', 'B様 ベッド1 → ベッド2', 'C様 ベッド1 → ベッド2', 'D様 ベッド1 → ベッド2',
    ].slice(0, ceiling))
    for (const line of lines) expect(line.startsWith('、')).toBe(false)
    // A name the board cannot show is OMITTED, never invented (⚖ A3's law).
    expect(companionLines(board, [{ id: 'nobody', bedOrigin: { laneKey: 'bed-01', x: 0, w: 1 }, bedTo: 'bed-02' }]))
      .toEqual(['ベッド1 → ベッド2'])
  })
})

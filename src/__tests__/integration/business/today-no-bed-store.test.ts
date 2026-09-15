// ⚖ ROUND 3 · C (⚖ D-52 (a)/(b)) — THE GYM LEGS.
//
// STORE_C (テスト渋谷店, fixtures.ts) carries ZERO `resources` rows
// (fixtures-today.ts): no bed lane exists on this board at all, by
// construction (`today-board.buildLanes` draws a `group: 'beds'` lane per
// resource row). This file proves the real thread — data.* → buildLanes → the
// allocator, the mask, the honest netting, the rail, the sell/gap/online
// layers — runs end to end on a store shaped like a gym: staff time is the
// only capacity, no bed door is reachable, and nothing throws.
//
// G1-G9 below (PKT-BUILD-R3-C.md §15). G10 (the drop path, ⚖ D-52 (b)) is
// pinned in `today-screen-interactions.test.ts` (source) and driven in the
// lane render rig's `c-drive.harness.test.tsx` (behaviour) — both outside
// this file, per the packet.
//
// THE CLOCK: the same frozen instant `today-off-identity.test.ts` uses, so
// the gym board sits on the same day as the identity suite's STORE_A/STORE_B
// lenses (no coincidence needed between suites).

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { STORE_C } from '@/business/lib/fixtures'
import * as data from '@/business/lib/data'
import {
  hhmm,
  place,
  minuteOf,
  type BoardItem,
  type BoardLane,
  type Hours,
} from '@/business/lib/today-board'
import {
  allocateBed,
  explainRails,
  gapLayerFor,
  gapPackingDials,
  guardRailsFor,
  landingVerdict,
  onlineOffers,
  sellLayerFor,
  storeHasBeds,
  windowsOf,
  type GuardRail,
  type LandingQuestion,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { reservedOffersFor, type BedTruth } from '@/app/[locale]/(business)/business/today/capacity-ledger'
import { fallbackCellsFor, type FallbackResult } from '@/app/[locale]/(business)/business/today/fallback-cells'
import { withheldOffers, type OfferAsk } from '@/app/[locale]/(business)/business/today/bed-aware-sales'
import { reservedMaskFor, type ReservedLaneMask } from '@/app/[locale]/(business)/business/today/reserved-mask'
import { honestHeld } from '@/app/[locale]/(business)/business/today/honest-held'
import { bedDoor, bedViewsFor, TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { clampPriceInputs } from '@/business/lib/canon-logic/pricing'
import type { GapCell, SellCell } from '@/business/lib/canon-logic/availability'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function screenProps(node: any): TodayProps | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === TodayScreen) return node.props
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
    const hit = screenProps(kid)
    if (hit) return hit
  }
  return null
}

let GYM: TodayProps

beforeAll(async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-08-19T00:00:00Z'))
  supabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({ select: () => chain(r), eq: () => chain(r), maybeSingle: async () => r })
  service.mockReturnValue({
    from: (table: string) =>
      chain(
        table === 'business_workspace_grants'
          ? { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null }
          : table === 'profiles'
            ? { data: { customer_id: 'biz-1', is_management: false }, error: null }
            : { data: null, error: null },
      ),
  })
  // ⚖ G8 — THE REAL THREAD, PAGE-COMPOSED: the same `data.* → buildLanes` walk
  // `today-board.test.ts`'s lens helpers use, taken through `TodayPage` itself
  // (the pattern `selling-engine-flip.test.ts`'s `REAL` and
  // `today-board.test.ts`'s `board()` already use) so "nothing throws" means
  // the actual server render, not a hand-assembled stand-in.
  GYM = screenProps(
    await TodayPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve({ store: STORE_C }),
    }),
  )!
})

afterAll(() => jest.useRealTimers())

const frameOf = () => ({ openMin: GYM.hours.open, closeMin: GYM.hours.close, nowMin: GYM.sell.nowMinute ?? GYM.hours.open })
const bookOf = (): BedTruth => bedViewsFor(GYM.lanes, frameOf(), null).world
const maskOf = (book: BedTruth = bookOf()): readonly ReservedLaneMask[] =>
  reservedMaskFor({
    lanes: GYM.lanes,
    closeMin: GYM.hours.close,
    nowMin: GYM.sell.nowMinute,
    guard: GYM.guard.config,
    gapGuardMode: GYM.guard.mode,
    book,
  })

const priceOf = () => {
  const price = clampPriceInputs(GYM.dialogs.pricing.hqMax, GYM.dialogs.pricing.base, GYM.dialogs.pricing)
  return {
    price,
    depth: Math.round((1 - price.lo / price.hi) * 100),
    frame: { hi: price.hi, lo: price.lo, hqMin: GYM.dialogs.pricing.hqMin, hqMax: GYM.dialogs.pricing.hqMax },
  }
}

/** The screen's own sales-door composition (⚖ door() in
 *  selling-engine-flip.test.ts), rebuilt here for the ONE gym world — no
 *  matrix, the fixture's own shipped dials, `held` = this board's own mask
 *  (⚖ D-52 (a): the netting round is gated off by `hasBeds`, but the E3b mask
 *  machinery is not — G8 prints the reserved rows it produces). */
function gymDoor(held: readonly ReservedLaneMask[]) {
  const { price, depth, frame } = priceOf()
  const guard = GYM.guard.config
  const dialOpts = {
    gridMin: GYM.sell.gridMin,
    sessionMin: GYM.guard.standardSessionMin,
    gapFillMin: GYM.guard.gapFillMinMin,
    gapFillDiscountPct: GYM.guard.gapFillDiscountPct,
    nowMinute: GYM.sell.nowMinute,
    frame,
    depth,
    guard,
  }
  const gap = gapLayerFor(GYM.lanes, { ...dialOpts, minSellableMin: GYM.guard.minSellableMin, locked: [], held })
  const claims: GapCell[] = [...gap.packed, ...gap.scraps]
  const drops: SellDrop[] = []
  const sell = sellLayerFor(GYM.lanes, GYM.hours, {
    gridMin: GYM.sell.gridMin,
    sellSlotMin: GYM.sell.sellSlotMin,
    nowMinute: GYM.sell.nowMinute,
    locked: [],
    showPrice: true,
    hi: price.hi,
    hqMin: GYM.dialogs.pricing.hqMin,
    depth,
    reconcile: { claims, cleanupMinutesByBed: GYM.bedCleanupMinutes, onDrop: (d) => drops.push(d) },
    held,
  })
  const fallback: FallbackResult = fallbackCellsFor({
    lanes: GYM.lanes,
    closeMin: GYM.hours.close,
    dropped: drops,
    survivors: sell.cells,
    claims,
    cleanupMinutesByBed: GYM.bedCleanupMinutes,
    held,
    locked: [],
    minSellableMin: GYM.guard.minSellableMin,
    dials: { ...gapPackingDials(GYM.lanes, dialOpts), sellSlotMin: GYM.sell.sellSlotMin },
  })
  const gapDrawn = { packed: [...gap.packed, ...fallback.packed], scraps: [...gap.scraps, ...fallback.scraps] }
  const reserved = reservedOffersFor(held)
  const asks: OfferAsk[] = [
    ...sell.cells.map((c): OfferAsk => ({ key: `sell|${c.laneKey}|${c.h}`, laneKey: c.laneKey, start: c.h, end: c.e, stores: GYM.lanes.find((l) => l.key === c.laneKey)?.stores ?? null })),
    ...gapDrawn.packed.map((c): OfferAsk => ({ key: `packed|${c.laneKey}|${c.s}`, laneKey: c.laneKey, start: c.s, end: c.e, stores: GYM.lanes.find((l) => l.key === c.laneKey)?.stores ?? null })),
  ]
  return {
    sell,
    gap,
    gapDrawn,
    fallback,
    drops,
    asks,
    reserved,
    online: onlineOffers({
      sell: sell.staffBands,
      packed: gapDrawn.packed,
      scraps: gapDrawn.scraps,
      reserved,
      lanes: GYM.lanes,
      showPrice: true,
    }),
  }
}

/** The screen's rail composition, on THIS board (⚖ `explainHand` in
 *  today-rail-halfhour.test.ts). */
function gymRails() {
  const views = bedViewsFor(GYM.lanes, frameOf(), null)
  const bedFree = bedDoor(views, GYM.lanes, null)
  const rails = guardRailsFor(GYM.lanes, {
    open: GYM.hours.open,
    close: GYM.hours.close,
    stepMin: 30,
    dur: GYM.guard.standardSessionMin,
    protectedDur: GYM.guard.protectedDurationMin,
    nowMinute: GYM.sell.nowMinute,
    locked: [],
    guard: GYM.guard.config,
    excludeId: null,
    placementFeasible: bedFree,
    protectedWindowFeasible: bedFree,
    resting: null,
  })
  const explained = explainRails(rails, GYM.lanes, {
    dur: GYM.guard.standardSessionMin,
    handId: null,
    stagedId: null,
    sellCells: [],
    claims: [],
    drops: [],
    inHand: false,
    sellDisplayed: true,
    bedsOver: (laneKey, start, end) => {
      const lane = GYM.lanes.find((l) => l.key === laneKey && l.group === 'staff')
      if (!lane) return null
      const asker = { stores: lane.stores, requiresPrivate: false }
      const answer = views.world.bedFor(start, end, asker)
      if (!answer.compatibleRoomsExist) return null
      return { full: answer.laneKey === null, keys: () => views.world.freeBedKeys(start, end, asker) }
    },
  })
  return { rails, explained, views }
}

describe('G1 — the board itself owns no room', () => {
  it('prints the gym lanes, storeHasBeds and the cleanup dial', async () => {
    const staffKeys = GYM.lanes.filter((l) => l.group === 'staff').map((l) => l.key)
    const bedLanes = GYM.lanes.filter((l) => l.group === 'beds')
    const resources = await data.listResources(STORE_C)
    // eslint-disable-next-line no-console
    console.log('G1', {
      staffKeys,
      bedLaneCount: bedLanes.length,
      storeHasBeds: storeHasBeds(GYM.lanes),
      storeHasBedsScoped: storeHasBeds(GYM.lanes, [STORE_C]),
      resourcesCount: resources.length,
      bedCleanupOn: GYM.bedCleanupOn,
    })
    expect(staffKeys).toContain('c-03')
    expect(bedLanes).toEqual([])
    expect(storeHasBeds(GYM.lanes)).toBe(false)
    expect(storeHasBeds(GYM.lanes, [STORE_C])).toBe(false)
    expect(resources).toEqual([])
    expect(GYM.bedCleanupOn).toBe(false)
  })
})

describe('G2 — the mask holds windows on staff time alone', () => {
  it('prints protectedCount per lane — non-zero on c-03 (⚖ pre-fix this printed 0, see mutant m2)', () => {
    const mask = maskOf()
    // eslint-disable-next-line no-console
    console.log('G2', mask.map((m) => ({ laneKey: m.laneKey, protectedCount: m.protectedCount, spans: m.spans })))
    const c03 = mask.find((m) => m.laneKey === 'c-03')
    expect(c03).toBeDefined()
    expect(c03!.protectedCount).toBeGreaterThan(0)
  })
})

describe('G3 — the allocator and the landing verdict', () => {
  it('an untagged ask stands with no room; a 個室のみ ask gets the 個室 sentence; the verdict is not hard-room', () => {
    const c03 = GYM.lanes.find((l) => l.key === 'c-03' && l.group === 'staff')!
    const untagged = allocateBed(GYM.lanes, { id: null, currentBed: null, stores: [STORE_C], requiresPrivate: false, start: 780, end: 840 })
    const tagged = allocateBed(GYM.lanes, { id: null, currentBed: null, stores: [STORE_C], requiresPrivate: true, start: 780, end: 840 })
    const q: LandingQuestion = {
      staffLane: c03.key,
      bedLane: null,
      solveRoom: true,
      id: null,
      requiresPrivate: false,
      start: 780,
      end: 840,
      span: place(780, 840, GYM.hours),
      foreignRefusal: null,
      hasPrice: true,
      locked: [],
      minutesOf: (x: number) => minuteOf(x, GYM.hours),
    }
    const verdict = landingVerdict(GYM.lanes, q, null)
    // eslint-disable-next-line no-console
    console.log('G3', { untagged, tagged, verdict: { kind: verdict.kind, floor: verdict.floor, reason: verdict.reason } })
    expect(untagged).toEqual({ laneKey: null, refusal: null, blockers: [], reseats: [] })
    expect(tagged.refusal).toBe('この店舗には個室がありません。個室のある店舗へ移してください')
    expect(verdict.floor).not.toBe('hard-room')
    expect(verdict.kind).not.toBe('blocked')
  })
})

describe('G4 — the sell layer: staff cells only', () => {
  it('prints the cell count — zero bed cells, every resourceKey empty', () => {
    const { price, depth } = priceOf()
    const sell = sellLayerFor(GYM.lanes, GYM.hours, {
      gridMin: GYM.sell.gridMin,
      sellSlotMin: GYM.sell.sellSlotMin,
      nowMinute: GYM.sell.nowMinute,
      locked: [],
      showPrice: true,
      hi: price.hi,
      hqMin: GYM.dialogs.pricing.hqMin,
      depth,
    })
    const bedCells = sell.cells.filter((c) => c.group === 'beds')
    // eslint-disable-next-line no-console
    console.log('G4', { cellCount: sell.cells.length, bedCellCount: bedCells.length, resourceKeys: [...new Set(sell.cells.map((c) => c.resourceKey))] })
    expect(bedCells).toEqual([])
    expect(sell.cells.every((c) => c.resourceKey === '')).toBe(true)
  })

  // ⚖ DISCLOSED, NOT FIXED (out of scope: availability.ts) — canon's own cap:
  // a no-resource store sells at most ONE start per hour across all its staff
  // (canon-logic.test.ts:522-536, `[null]` index-wise pairing). This fixture's
  // one floating trainer cannot show the cap biting (there is nothing to
  // contend with); a synthetic two-staff no-bed board prints it instead.
  it('DISCLOSURE — the one-start-per-hour cap on a two-staff no-bed board (queued, not this slice)', () => {
    const hours: Hours = { open: GYM.hours.open, close: GYM.hours.close }
    const staffLane = (key: string, label: string): BoardLane => ({
      key, group: 'staff', label, sub: '', absentNote: null, mine: false, items: [],
      window: { from: hours.open, until: hours.close }, untilLabel: hhmm(hours.close),
      listPrice: 7000, stores: [STORE_C], roomClass: null,
    })
    const twoStaff = [staffLane('g-01', 'テスト いちろう'), staffLane('g-02', 'テスト じろう')]
    const { price, depth } = priceOf()
    const sell = sellLayerFor(twoStaff, hours, {
      gridMin: GYM.sell.gridMin, sellSlotMin: GYM.sell.sellSlotMin, nowMinute: null,
      locked: [], showPrice: true, hi: price.hi, hqMin: GYM.dialogs.pricing.hqMin, depth,
    })
    const perHour = new Map<number, number>()
    for (const c of sell.cells) perHour.set(c.h, (perHour.get(c.h) ?? 0) + 1)
    const counts = [...new Set(perHour.values())]
    // eslint-disable-next-line no-console
    console.log('G4-DISCLOSURE', { perHour: Object.fromEntries(perHour), counts })
    expect(counts).toEqual([1])
  })
})

describe('G5 — the withheld layer', () => {
  it('withheldOffers is NOTHING with honest undefined; honestHeld(on) is the shared/total-0 record', () => {
    const book = bookOf()
    const mask = maskOf(book)
    const nothing = withheldOffers([], undefined, mask, GYM.lanes, book, true)
    const netted = honestHeld(mask, GYM.lanes, book, true)
    // eslint-disable-next-line no-console
    console.log('G5', {
      keysSize: nothing.keys.size,
      total: netted.total,
      shared: netted.byLane.flatMap((l) => l.shared.map((s) => ({ laneKey: l.laneKey, sharedRoom: s.sharedRoom, rooms: s.rooms }))),
    })
    expect(nothing.keys.size).toBe(0)
    expect(netted.total).toBe(0)
    const allShared = netted.byLane.flatMap((l) => l.shared)
    expect(allShared.length).toBeGreaterThan(0)
    expect(allShared.every((s) => s.sharedRoom === '')).toBe(true)
  })
})

describe('G6 — the rail: no ベッド, no 満室/清掃, no compatible rooms', () => {
  it('prints every chip word/sentence and the bedFor existence check', () => {
    const { explained, views } = gymRails()
    const chips: Array<{ laneKey: string; start: number; word: string | null; sentence: string }> = []
    for (const [laneKey, per] of explained) {
      for (const [start, said] of per) chips.push({ laneKey, start, word: said.word, sentence: said.sentence })
    }
    const c03 = GYM.lanes.find((l) => l.key === 'c-03' && l.group === 'staff')!
    const answer = views.world.bedFor(780, 840, { stores: c03.stores, requiresPrivate: false })
    // eslint-disable-next-line no-console
    console.log('G6', { chipCount: chips.length, sample: chips.slice(0, 3), compatibleRoomsExist: answer.compatibleRoomsExist })
    expect(chips.length).toBeGreaterThan(0)
    for (const c of chips) {
      expect(c.word === '満室' || c.word === '清掃').toBe(false)
      expect(c.sentence).not.toContain('ベッド')
    }
    expect(bedDoor(views, GYM.lanes, null)).toBeUndefined()
    expect(answer.compatibleRoomsExist).toBe(false)
  })
})

describe('G7 — the chip number equals the mask sum', () => {
  it('prints the identity-arm total and the mask Σ protectedCount', () => {
    const book = bookOf()
    const mask = maskOf(book)
    const identity = honestHeld(mask, GYM.lanes, book, false)
    const chipTotal = windowsOf(identity, GYM.lanes).total
    const maskSum = mask.reduce((n, m) => n + m.protectedCount, 0)
    // eslint-disable-next-line no-console
    console.log('G7', { chipTotal, maskSum })
    expect(chipTotal).toBe(maskSum)
  })
})

describe('G8 — nothing throws; the online reserved rows exist', () => {
  it('runs the whole page-side derivation and prints the online group counts by kind', () => {
    const book = bookOf()
    const mask = maskOf(book)
    let door!: ReturnType<typeof gymDoor>
    expect(() => {
      door = gymDoor(mask)
    }).not.toThrow()
    const byKind = Object.fromEntries(door.online.groups.map((g) => [g.kind, g.rows.length]))
    // eslint-disable-next-line no-console
    console.log('G8', { byKind, dropCount: door.drops.length, fallbackPacked: door.fallback.packed.length })
    expect(byKind.reserved).toBeGreaterThan(0)
  })
})

describe('G9 — no 「ベッド」 reachable', () => {
  it('no derived string carries 「ベッド」', () => {
    const { explained } = gymRails()
    const book = bookOf()
    const mask = maskOf(book)
    const door = gymDoor(mask)
    const untagged = allocateBed(GYM.lanes, { id: null, currentBed: null, stores: [STORE_C], requiresPrivate: false, start: 780, end: 840 })
    const sentences: string[] = []
    for (const per of explained.values()) for (const said of per.values()) sentences.push(said.sentence)
    for (const g of door.online.groups) for (const r of g.rows) sentences.push(g.label)
    if (untagged.refusal) sentences.push(untagged.refusal)
    // eslint-disable-next-line no-console
    console.log('G9', { sentenceCount: sentences.length, anyBed: sentences.some((s) => s.includes('ベッド')) })
    expect(sentences.some((s) => s.includes('ベッド'))).toBe(false)
  })

  it('SOURCE-TEXT CENSUS — every 「ベッド」 line in TodayScreen.tsx and today-interactions.ts outside a comment is on the allowlist', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const files = [
      'src/app/[locale]/(business)/business/today/TodayScreen.tsx',
      'src/app/[locale]/(business)/business/today/today-interactions.ts',
    ]
    // The allowlist is every e0132e47b census line (§Census, this packet's own
    // saved bed-census-e0132e47b.txt), by its own distinctive text — this
    // round's edits carried every one of them byte-identical except the five
    // tour sites (wrapped in `${hasBeds ? … : ''}`, the QUOTED Japanese kept
    // whole) and the two comment rewrites named below. An allowlist of exact
    // fragments, never a comment-stripping regex (the S10 lesson).
    const allow = [
      // TodayScreen.tsx — the 29 census lines (comment + code), unchanged text
      'ベッド・設備', // :609/:620/:9110
      "ベッド or 個室, from the ask's own",
      'スキマ枠 both on ベッド2) was invisible',
      'さくら様 ベッド1 → ベッド2',
      'with an intruder in ベッド2, because',
      "on Liam's own board: ベッド1",
      'retarget PRINT — ベッド3 → ベッド2',
      "roomWord: ask.requiresPrivate ? '個室' : 'ベッド'", // :5978/:6547
      '空いているベッドがいません」、which told', // fallback if reflowed
      '空いているベッドがいません',
      '【ベッド3】 over an occupied ベッド3',
      'so in ベッド view,',
      'ベッド2 were never compared',
      'ベッドは自動で選ばれます', // :7532
      'この時間のベッドを先に使う予定です', // :7738/:7799
      'ベッドを共有している確保枠', // :7887
      'このベッドを必要とする確保枠が重なっている', // :7890
      '「満室」はその30分にベッドの空きがないという意味で', // :8012 (hasBeds-wrapped)
      'ベッドを別のスタッフの枠が使っていて', // :8012 (hasBeds-wrapped)
      '【ベッド3】 while', // :8382
      'its twin stands on ベッド2 is the impossible state ⚖ 51', // :8383
      "the card's own 【ベッド3】 reads as a description", // :8395
      '今日の予約に対してベッドが用意できる数で', // :8522 (chip tour, honest-gated)
      '⇄ ベッドを入れ替えて置ける', // :8853 (hasBeds-wrapped)
      '⇄ = ベッドを入れ替えて置ける', // :8996 (hasBeds-wrapped)
      'ベッドを入れ替えれば置ける開始に', // :8979 (hasBeds-wrapped)
      'ベッドが埋まっているときは、ほかのお客様のベッドを入れ替えて', // :9803 (hasBeds-wrapped)
      // today-interactions.ts — the 30 census lines, unchanged text (5738 deleted)
      '担当/ベッド sentence',
      'while sitting in ベッド1',
      '【ベッド2】 on a staff lane',
      'card left wearing 【ベッド3】',
      'its twin stands on ベッド2 is the impossible state ⚖ 8/9',
      'still says ベッド3 is the impossible state',
      'both point at ベッド2 at the same minute',
      'この開始ではベッドを', // :2800 — behind ctx.placementFeasible already
      '空いているベッドがいません」 is RETIRED',
      '空きベッドなし」 was never',
      '「ベッドが空いていません」 is the reason',
      'ベッドが空いていません・確保が解除されれば', // :3067 (withheldSub)
      '「ベッドは別のスタッフ（…）の枠が使う」) and 販売中',
      '「ここに置くと、ほかのお客様のベッドを', // :3249/:3487
      'ここに置くと、ほかのお客様のベッドを入れ替えて収めます', // :3268 (reseatSentence)
      '「…使えるベッドがありません」 and NO occupants',
      '「ベッド満室」',
      '「ベッドは別の販売枠（…）が使っています」',
      'ベッドは別のスタッフ（${opts.takerLabel}）の枠が使うため', // :3532 (taker clause)
      '「ベッドは別のスタッフ（…）の枠が使う」 — naming',
      'ベッド3 →', // :5404
      'ベッド2. The allocator retargets', // :5405
      '「…はベッドが満室です」',
      "const room = requiresPrivate ? '個室' : 'ベッド'", // :5710
      '使えるベッドがありません」 named', // :5732 N8 rewrite, quote kept
      '「10:00〜11:00はベッドに空きがありません。',
      '「⇄ = ベッドを入れ替えて置ける」',
      '「…ベッドを入れ替えて収めます」）',
      // ⚖ ROUND 3 · C — the ONE new line this slice's own comments introduced
      'now-retired 「ベッドがありません」', // :5127, item 3's doc paraphrase
    ]
    const offenders: string[] = []
    for (const rel of files) {
      const text = fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
      const lines = text.split('\n')
      for (const line of lines) {
        if (!line.includes('ベッド')) continue
        const trimmed = line.trim()
        const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')
        if (isComment) continue
        if (allow.some((a) => line.includes(a))) continue
        offenders.push(`${rel}: ${line.trim()}`)
      }
    }
    // eslint-disable-next-line no-console
    console.log('G9-CENSUS', { offenderCount: offenders.length, offenders })
    expect(offenders).toEqual([])
  })

  // ⚖ m3's own catch — a SOURCE-TEXT pin on the two ⚖ D-52 (a) gates (item
  // 10/11), since the underlying `honestHeld`/`withheldOffers` calls in G5/G8
  // above cannot observe whether the SCREEN actually gates them: only the
  // source can prove `honest` and `heldBoardHonest` sit behind `storeHasBeds`.
  it('the honest-netting gates are source-present (item 10/11, catches m3)', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
      'utf8',
    )
    expect(src).toContain('HONEST_HELD && heldCommitted && storeHasBeds(committedLanes)')
    expect(src).toContain('HONEST_HELD && heldBoard && !staffCardInHand && hasBeds')
  })
})

describe('THE MATRIX — the rows this file can print (PLAN §4)', () => {
  it('B×C — sellSlotMin 45 on the gym: staff cells only, no bed cells', () => {
    const { price, depth } = priceOf()
    const sell = sellLayerFor(GYM.lanes, GYM.hours, {
      gridMin: GYM.sell.gridMin, sellSlotMin: 45, nowMinute: GYM.sell.nowMinute,
      locked: [], showPrice: true, hi: price.hi, hqMin: GYM.dialogs.pricing.hqMin, depth,
    })
    // eslint-disable-next-line no-console
    console.log('MATRIX B×C', { cellCount: sell.cells.length, bedCells: sell.cells.filter((c) => c.group === 'beds').length })
    expect(sell.cells.filter((c) => c.group === 'beds')).toEqual([])
  })

  it('C×D — withheldOffers stays NOTHING even with a real netting handed in (rooms.length === 0 → continue)', () => {
    const book = bookOf()
    const mask = maskOf(book)
    const honest = honestHeld(mask, GYM.lanes, book, true)
    const withReal = withheldOffers([], honest, mask, GYM.lanes, book, true)
    const withUndefined = withheldOffers([], undefined, mask, GYM.lanes, book, true)
    // eslint-disable-next-line no-console
    console.log('MATRIX C×D', { withRealKeys: withReal.keys.size, withUndefinedKeys: withUndefined.keys.size })
    expect(withReal.keys.size).toBe(0)
    expect(withUndefined.keys.size).toBe(0)
  })

  it('隙間ガード OFF on the gym — mask empty, guard off pays nothing', () => {
    const book = bookOf()
    const off = reservedMaskFor({
      lanes: GYM.lanes, closeMin: GYM.hours.close, nowMin: GYM.sell.nowMinute,
      guard: GYM.guard.config, gapGuardMode: 'off', book,
    })
    // eslint-disable-next-line no-console
    console.log('MATRIX guard-off', { rows: off.length })
    expect(off).toEqual([])
  })

  it('HONEST_HELD off on the gym — identical to gym-with-C (the netting never ran anyway)', () => {
    const book = bookOf()
    const mask = maskOf(book)
    const on = honestHeld(mask, GYM.lanes, book, false)
    const cGate = storeHasBeds(GYM.lanes) ? honestHeld(mask, GYM.lanes, book, true) : undefined
    // eslint-disable-next-line no-console
    console.log('MATRIX HONEST_HELD-off≡gym-C', { onTotal: on.total, cGateIsUndefined: cGate === undefined })
    expect(cGate).toBeUndefined()
  })
})

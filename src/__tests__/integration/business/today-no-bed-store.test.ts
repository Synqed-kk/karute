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
  type LandingQuestion,
  type SellDrop,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { reservedOffersFor, type BedTruth } from '@/app/[locale]/(business)/business/today/capacity-ledger'
import { fallbackCellsFor, type FallbackResult } from '@/app/[locale]/(business)/business/today/fallback-cells'
import { withheldOffers, type OfferAsk } from '@/app/[locale]/(business)/business/today/bed-aware-sales'
import { reservedMaskFor, type ReservedLaneMask } from '@/app/[locale]/(business)/business/today/reserved-mask'
import { heldMaskOf, honestHeld } from '@/app/[locale]/(business)/business/today/honest-held'
import { bedDoor, bedViewsFor, TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'
import { HONEST_HELD } from '@/app/[locale]/(business)/business/today/selling-engine-gate'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { clampPriceInputs } from '@/business/lib/canon-logic/pricing'
import { trackFree, type GapCell } from '@/business/lib/canon-logic/availability'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
    const verdict = landingVerdict(GYM.lanes, q, null, GYM.words, GYM.genericWords)
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
    console.log('G4', { cellCount: sell.cells.length, bedCellCount: bedCells.length, resourceKeys: [...new Set(sell.cells.map((c) => c.resourceKey))] })
    expect(bedCells).toEqual([])
    expect(sell.cells.every((c) => c.resourceKey === '')).toBe(true)
  })

  // ⚖ DISCLOSED PIN MOVE (⚖ D-53 (c) R1, N0) — the cap this test used to
  // record is CLOSED: the seam now passes `needsUnit`, so a no-unit store's
  // staff sell on staff time alone with no cap — the count per hour is the
  // number of FREE staff, not one. This fixture's two store-bound staff (both
  // free the whole day, nothing to contend with) print [2]; G1 closed. This
  // test is the RECORD of that, with its ⚖ reason, not a queued defect.
  it('the no-unit rule closes the one-start-per-hour cap on a two-staff no-bed board (⚖ D-53 (c) R1, G1)', () => {
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
    console.log('G4-DISCLOSURE', { perHour: Object.fromEntries(perHour), counts })
    expect(counts).toEqual([2])
  })
})

describe('⚖ D-53 (c) R2 — the inspector heading states the staff fact on a no-unit store (F2 item 5, L1 MAJOR 1)', () => {
  // STORE_C carries no fixture appointment or decision row (`appointments()`
  // and `decisions` in fixtures.ts/fixtures-today.ts never assign STORE_C, by
  // the file's own "no-bed store" design) — so GYM.cases has NO booking case
  // at all to drive `bookingProofs`'s heading through the page. Per the
  // packet's own disclosed fallback: pin it at the SOURCE instead.
  it('GYM has no booking case to render (confirms the page-level door does not exist for this fixture)', () => {
    expect(Object.keys(GYM.cases).length).toBe(0)
  })

  it('SOURCE PIN — the exact ternary text: a no-unit-store booking heading states the staff fact, never 設備は未確定', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/page.tsx'),
      'utf8',
    )
    expect(src).toContain(
      "b.resourceId ? `${b.staffName} + ${b.resourceName}が成立` : hasUnits ? '設備は未確定' : `${b.staffName}が担当`,",
    )
  })

  it("⚖ D-53 (g) — the card's unit axis is the booking's own store, re-joined by id (Greptile #933 P1-2)", () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/page.tsx'),
      'utf8',
    )
    expect(src).toContain('const hasUnits = storeHasBeds(lanes, storeId == null ? null : [storeId])')
    expect(src).not.toContain('staffLane?.stores')
  })
})

describe('G5 — the withheld layer', () => {
  it('withheldOffers is NOTHING with honest undefined; honestHeld(on) is the shared/total-0 record', () => {
    const book = bookOf()
    const mask = maskOf(book)
    const nothing = withheldOffers([], undefined, mask, GYM.lanes, book, true)
    const netted = honestHeld(mask, GYM.lanes, book, true)
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
    for (const g of door.online.groups) for (let i = 0; i < g.rows.length; i += 1) sentences.push(g.label)
    if (untagged.refusal) sentences.push(untagged.refusal)
    console.log('G9', { sentenceCount: sentences.length, anyBed: sentences.some((s) => s.includes('ベッド')) })
    expect(sentences.some((s) => s.includes('ベッド'))).toBe(false)
  })

  it('SOURCE-TEXT CENSUS — every 「ベッド」 line in TodayScreen.tsx and today-interactions.ts is on the allowlist', () => {
    const files = [
      'src/app/[locale]/(business)/business/today/TodayScreen.tsx',
      'src/app/[locale]/(business)/business/today/today-interactions.ts',
    ]
    // The allowlist is every e0132e47b census line (§Census, this packet's own
    // saved bed-census-e0132e47b.txt), by its own distinctive text — this
    // round's edits carried every one of them byte-identical except the five
    // tour sites (wrapped in `${hasBeds ? … : ''}`, the QUOTED Japanese kept
    // whole) and the two comment rewrites named below. Raw lines, an exact
    // allowlist, no comment detection of any kind (F2 fold, ⚖ D-52 (e) L1
    // MINOR 1 — the loop used to skip `//`/`*`/`/**` lines before the
    // allowlist check, so a NEW comment carrying a bed fact would never be
    // seen; every line is checked now, comment or code).
    const allow = [
      // TodayScreen.tsx — the 29 census lines (comment + code), unchanged text
      'ベッド・設備', // :609/:620/:9110
      "ベッド or 個室, from the ask's own",
      'スキマ枠 both on ベッド2) was invisible',
      'さくら様 ベッド1 → ベッド2',
      'with an intruder in ベッド2, because',
      "on Liam's own board: ベッド1",
      'retarget PRINT — ベッド3 → ベッド2',
      // ⚖ D-53 (n) — twelve entries PRUNED here: N2a slotted the resource word
      // into every one of these TodayScreen.tsx sentences (roomWord ternary,
      // 自動で選ばれます, the withheld/shared-lane guides, the two hasBeds-wrapped
      // rail-tour sentences, the day-chip guide, the three ⇄ sites, the hold-
      // popover guide), so the old literal text no longer appears on the tip —
      // a dead entry left in place would silently re-permit that exact literal
      // if it were ever reintroduced. See the allowlist-integrity leg below.
      // (A 13th entry — a PRE-EXISTING "fallback if reflowed" duplicate of
      // the line below, matching 0 lines even before N2a — was pruned here
      // too: the new integrity leg caught it on its first run.)
      '空いているベッドがいません',
      '【ベッド3】 over an occupied ベッド3',
      'so in ベッド view,',
      'ベッド2 were never compared',
      '【ベッド3】 while', // :8382
      'its twin stands on ベッド2 is the impossible state ⚖ 51', // :8383
      "the card's own 【ベッド3】 reads as a description", // :8395
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
      // ⚖ D-53 (u)/(n2b1) — PRUNED: withheldSub's literal 'ベッドが空いていません・
      // 確保が解除されれば' now reads '${words.resourceNoun}が空いていません…' —
      // the line no longer carries the literal word at all (PKT-BUILD-N2B1-SINGLE-LANE.md).
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
    const matchCounts = new Map<string, number>(allow.map((a) => [a, 0]))
    for (const rel of files) {
      const text = readFileSync(join(process.cwd(), rel), 'utf8')
      const lines = text.split('\n')
      for (const line of lines) {
        if (!line.includes('ベッド')) continue
        const hit = allow.filter((a) => line.includes(a))
        for (const a of hit) matchCounts.set(a, (matchCounts.get(a) ?? 0) + 1)
        if (hit.length === 0) offenders.push(`${rel}: ${line.trim()}`)
      }
    }
    console.log('G9-CENSUS', { offenderCount: offenders.length, offenders })
    expect(offenders).toEqual([])

    // ⚖ D-53 (n) item 3, L1 MINOR-2's fix — 12 dead entries were pruned above
    // (N2a slotted the resource word into their sentences, so the old literal
    // text no longer appears on the tip). A 0-match entry left in the list
    // would be a standing permission nobody is protecting any more; this
    // proves every SURVIVING entry still matches at least one real line, so a
    // future prune can never leave a stale entry behind undetected. This leg
    // itself caught a 13th, PRE-EXISTING dead entry (a "fallback if
    // reflowed" duplicate of the line above it, matching 0 lines even before
    // N2a) — pruned alongside the twelve, out of an abundance of the same
    // fix.
    const stale = allow.filter((a) => (matchCounts.get(a) ?? 0) === 0)
    console.log('G9-ALLOWLIST-INTEGRITY', { entryCount: allow.length, prunedCount: 14, stale })
    expect(stale).toEqual([])
  })

  // ⚖ m3's own catch — a SOURCE-TEXT pin on the two ⚖ D-52 (a) gates (item
  // 10/11), since the underlying `honestHeld`/`withheldOffers` calls in G5/G8
  // above cannot observe whether the SCREEN actually gates them: only the
  // source can prove `honest` and `heldBoardHonest` sit behind `storeHasBeds`.
  it('the honest-netting gates are source-present (item 10/11, catches m3)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
      'utf8',
    )
    expect(src).toContain('HONEST_HELD && heldCommitted && storeHasBeds(committedLanes)')
    expect(src).toContain('HONEST_HELD && heldBoard && !staffCardInHand && hasBeds')
  })

  // ⚖ m5's own catch — item 12's five tour/legend sites, pinned by their
  // GATING SYNTAX rather than by the Japanese text alone: the G9(ii) census
  // above allows the underlying sentences unconditionally (they are legitimate
  // e0132e47b lines), so removing one `hasBeds ?`/`hasBeds &&` wrapper leaves
  // the text intact and the census blind to it. The occurrence COUNT is the
  // simple half (any dropped gate lowers it); the five exact fragments are the
  // named half, for a readable failure.
  it('the five tour/legend hasBeds gates are all present (item 12, catches m5)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/today/TodayScreen.tsx'),
      'utf8',
    )
    const hasBedsCount = (src.match(/hasBeds/g) ?? []).length
    console.log('m5-catch', { hasBedsCount })
    // 1 definition + 2 honest-gate reads + 6 tour-site reads (the rail tour's
    // two sentences, the ⇄ legend key, the ⇄ guard-tour clause, the ⇄ key span,
    // the 仮押さえ tour's two sentences counted as one guard) = 9.
    expect(hasBedsCount).toBe(9)
    // ⚖ D-53 (n) — DISCLOSED PIN MOVE: N2a slotted the RESOURCE WORD inside
    // each fragment (満室→${w.fullWord}, ベッド→${w.resourceNoun}/
    // ${holdPopWords.resourceNoun}); the `hasBeds ?`/`hasBeds &&` gate itself,
    // which is what this leg actually proves, is byte-identical.
    // ⚖ D-53 (z), PKT-FIX-N2A-F4 — PIN MOVE: the first fragment's chip token
    // is now `props.genericWords.fullWord` (same rule as the other two
    // chip-naming spots); the gate syntax and `${w.resourceNoun}` are
    // unchanged.
    for (const fragment of [
      '${hasBeds ? `「${props.genericWords.fullWord}」はその30分に${w.resourceNoun}の空きがないという意味で',
      '${hasBeds ? `${w.resourceNoun}を別のスタッフの枠が使っていて',
      '{hasBeds && <b>⇄ {w.resourceNoun}を入れ替えて置ける</b>}',
      '${hasBeds ? `ボードのカードをドラッグしている間は、${w.resourceNoun}を入れ替えれば置ける開始に',
      '{hasBeds && <span className="guard-key reseat-key">⇄ = {w.resourceNoun}を入れ替えて置ける</span>}',
      '${hasBeds ? `${holdPopWords.resourceNoun}が埋まっているときは、ほかのお客様の${holdPopWords.resourceNoun}を入れ替えて収めることがあります',
    ]) {
      expect(src).toContain(fragment)
    }
  })
})

describe('THE MATRIX — the rows this file can print (PLAN §4)', () => {
  it('B×C — sellSlotMin 45 on the gym: staff cells only, no bed cells', () => {
    const { price, depth } = priceOf()
    const sell = sellLayerFor(GYM.lanes, GYM.hours, {
      gridMin: GYM.sell.gridMin, sellSlotMin: 45, nowMinute: GYM.sell.nowMinute,
      locked: [], showPrice: true, hi: price.hi, hqMin: GYM.dialogs.pricing.hqMin, depth,
    })
    console.log('MATRIX B×C', { cellCount: sell.cells.length, bedCells: sell.cells.filter((c) => c.group === 'beds').length })
    expect(sell.cells.filter((c) => c.group === 'beds')).toEqual([])
  })

  it('C×D — withheldOffers stays NOTHING even with a real netting handed in (rooms.length === 0 → continue)', () => {
    const book = bookOf()
    const mask = maskOf(book)
    const honest = honestHeld(mask, GYM.lanes, book, true)
    const withReal = withheldOffers([], honest, mask, GYM.lanes, book, true)
    const withUndefined = withheldOffers([], undefined, mask, GYM.lanes, book, true)
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
    console.log('MATRIX guard-off', { rows: off.length })
    expect(off).toEqual([])
  })

  it('HONEST_HELD off on the gym — identical to gym-with-C (the netting never ran anyway)', () => {
    const book = bookOf()
    const mask = maskOf(book)
    const on = honestHeld(mask, GYM.lanes, book, false)
    const cGate = storeHasBeds(GYM.lanes) ? honestHeld(mask, GYM.lanes, book, true) : undefined
    console.log('MATRIX HONEST_HELD-off≡gym-C', { onTotal: on.total, cGateIsUndefined: cGate === undefined })
    expect(cGate).toBeUndefined()
  })
})

// ⚖ ROUND 3 · C F4 — G11/G12 (⚖ D-52 (g)) — THE MIXED BOARD, THROUGH THE SCREEN'S OWN COMPOSITION.
const D52G_HOURS: Hours = { open: 600, close: 1200 }
const d52gLane = (over: Partial<BoardLane> & Pick<BoardLane, 'key' | 'group'>): BoardLane =>
  ({
    label: over.key, sub: '', absentNote: null, mine: false, items: [],
    window: over.group === 'staff' ? { from: D52G_HOURS.open, until: D52G_HOURS.close } : null,
    untilLabel: over.group === 'staff' ? hhmm(D52G_HOURS.close) : null,
    listPrice: over.group === 'staff' ? 7000 : 0,
    stores: ['store-a'],
    roomClass: over.group === 'staff' ? null : 'standard',
    ...over,
  }) as BoardLane
const d52gItem = (over: Partial<BoardItem> & Pick<BoardItem, 'key' | 'caseId'>, start: number, end: number): BoardItem =>
  ({
    kind: 'booking', state: 'confirmed', category: 'repeat', ...place(start, end, D52G_HOURS),
    title: '見本 はなこ', tag: '', time: '', ticketCat: '単発', ticketCore: null, held: false, micro: false,
    label: '', requiresPrivateRoom: false, ...over,
  }) as BoardItem
const d52gSpan = (start: number, end: number) => ({ start, end, windowStart: start })

describe("G11 — the mixed board through the screen's own composition (⚖ ROUND 3 · C F4, D-52 (g))", () => {
  it('honest nets over all three rows; store-z is held by construction; the online rows include it', () => {
    const lanes: BoardLane[] = [
      d52gLane({ key: 'ga', group: 'staff', label: '見本 ごろう', stores: ['store-a'] }),
      d52gLane({ key: 'az', group: 'staff', label: '見本 あずさ', stores: ['store-a'] }),
      d52gLane({ key: 'bed-a1', group: 'beds', label: 'ベッド1', stores: ['store-a'] }),
      d52gLane({ key: 'bed-a2', group: 'beds', label: 'ベッド2', stores: ['store-a'] }),
      d52gLane({ key: 'p-z', group: 'staff', label: '見本 mock', stores: ['store-z'] }),
    ]
    const mask: ReservedLaneMask[] = [
      { laneKey: 'ga', spans: [d52gSpan(870, 960)], protectedCount: 1 },
      { laneKey: 'az', spans: [d52gSpan(905, 995)], protectedCount: 1 },
      { laneKey: 'p-z', spans: [d52gSpan(870, 960)], protectedCount: 1 },
    ]
    const book: BedTruth = {
      frame: { openMin: D52G_HOURS.open, closeMin: D52G_HOURS.close, nowMin: D52G_HOURS.open },
      stats: { allocateBedCalls: 0, storeBindings: 0 },
      freeBedKeys: (start: number) => (start === 870 ? ['bed-a1'] : start === 905 ? ['bed-a2'] : []),
      bedFor: (() => { throw new Error('G11 asked bedFor, which it may not') }) as unknown as BedTruth['bedFor'],
      freeBedCount: (() => { throw new Error('G11 asked freeBedCount, which it may not') }) as unknown as BedTruth['freeBedCount'],
      fullRuns: (() => { throw new Error('G11 asked fullRuns, which it may not') }) as unknown as BedTruth['fullRuns'],
      newClientMask: (() => { throw new Error('G11 asked newClientMask, which it may not') }) as unknown as BedTruth['newClientMask'],
    }
    // ⚖ D-52 (g) — the screen's own `honest` line, re-spelled as a pure expression.
    const honest = HONEST_HELD && mask && storeHasBeds(lanes)
      ? honestHeld(mask, lanes, book, true, (l) => storeHasBeds(lanes, l.stores))
      : undefined
    expect(honest).toBeDefined()
    const total = windowsOf(honest!, lanes).total
    const maskSum = mask.reduce((n, m) => n + m.protectedCount, 0)
    console.log('G11', { total, maskSum })
    expect(total).toBe(maskSum)
    const online = reservedOffersFor(honest!.byLane.map(heldMaskOf))
    console.log('G11 online', online)
    expect(online.some((r) => r.laneKey === 'p-z')).toBe(true)
    const z = honest!.byLane.find((l) => l.laneKey === 'p-z')!
    expect(z.shared).toEqual([])
  })
})

describe('G12 — Greptile P1-1, pinned as NOT a defect (⚖ D-52 (g))', () => {
  it("the door's true and the clamped board's undefined are the same answer to the guard — the refusal lives in the allocator on both", () => {
    const lanes: BoardLane[] = [
      d52gLane({ key: 'ga', group: 'staff', label: '見本 ごろう', stores: ['store-a'] }),
      d52gLane({ key: 'bed-a1', group: 'beds', label: 'ベッド1', stores: ['store-a'] }),
      d52gLane({
        // the "booking in hand" lives on its OWN window, away from the probe
        // below (780-840), so the check strip sees no clash from it.
        key: 'p-z', group: 'staff', label: '見本 mock', stores: ['store-z'],
        items: [d52gItem({ key: 'z-ask-1', caseId: 'z-ask-1', requiresPrivateRoom: true }, 400, 460)],
      }),
    ]
    const frame = { openMin: D52G_HOURS.open, closeMin: D52G_HOURS.close, nowMin: D52G_HOURS.open }
    const views = bedViewsFor(lanes, frame, null)
    const storeZLane = lanes.find((l) => l.key === 'p-z')!
    const door = bedDoor(views, lanes, 'z-ask-1')
    const q: LandingQuestion = {
      staffLane: 'p-z', bedLane: null, solveRoom: true, id: null, requiresPrivate: true,
      start: 780, end: 840, span: place(780, 840, D52G_HOURS), foreignRefusal: null, hasPrice: true,
      locked: [], minutesOf: (x: number) => minuteOf(x, D52G_HOURS),
    }
    const verdict = landingVerdict(lanes, q, null, GYM.words, GYM.genericWords)
    console.log('G12 mixed', { door: door?.(storeZLane, 780, 60), verdict: { kind: verdict.kind, floor: verdict.floor, reason: verdict.reason } })
    expect(door?.(storeZLane, 780, 60)).toBe(true)
    expect(verdict.kind).toBe('blocked')
    expect(verdict.floor).toBe('hard-room')
    expect(verdict.reason).toBe('この店舗には個室がありません。個室のある店舗へ移してください')

    // the SAME two reads on the CLAMPED gym board (STORE_C alone)
    const c03 = GYM.lanes.find((l) => l.key === 'c-03' && l.group === 'staff')!
    const gymViews = bedViewsFor(GYM.lanes, frameOf(), null)
    const gymDoorFn = bedDoor(gymViews, GYM.lanes, 'gym-ask-1')
    const gymQ: LandingQuestion = {
      staffLane: c03.key, bedLane: null, solveRoom: true, id: null, requiresPrivate: true,
      start: 780, end: 840, span: place(780, 840, GYM.hours), foreignRefusal: null, hasPrice: true,
      locked: [], minutesOf: (x: number) => minuteOf(x, GYM.hours),
    }
    const gymVerdict = landingVerdict(GYM.lanes, gymQ, null, GYM.words, GYM.genericWords)
    console.log('G12 clamped', { door: gymDoorFn, verdict: { kind: gymVerdict.kind, floor: gymVerdict.floor, reason: gymVerdict.reason } })
    expect(gymDoorFn).toBeUndefined()
    expect(gymVerdict.kind).toBe('blocked')
    expect(gymVerdict.floor).toBe('hard-room')
    expect(gymVerdict.reason).toBe('この店舗には個室がありません。個室のある店舗へ移してください')
  })
})

// ⚖ D-53 (c) R1 — N0's SEEDED SELL-LAYER FAMILY (PKT-BUILD-N0-SELL-NO-UNIT.md
// item 7). No generator ever pointed at `sellLayerFor` with a STORE-BOUND
// no-unit roster before this: the shipped fixture's only no-unit lane (STORE_C)
// has a single FLOATING trainer (c-03), which is structurally blind to G2 (a
// floating staff always answers `needsUnit → true` — DESIGN-D-53 §9 R1). This
// family builds a unit store (store-a, real beds) beside a store-BOUND no-unit
// store (store-z, zero beds — never `null`), through the real seam
// (`sellLayerFor`), on ≥200 seeded boards.
describe('⚖ D-53 (c) R1 — N0 seeded family: a store-bound no-unit roster beside a unit store', () => {
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

  const N0_OPEN = 600
  const N0_CLOSE = 1080
  const GRIDS = [15, 30, 60]
  const SLOTS = [45, 60, 90]
  const DURS = [30, 45, 60, 90]
  const overlaps = (a: { start: number; end: number }, s: number, e: number) => a.start < e && s < a.end

  function n0Item(key: string, start: number, end: number): BoardItem {
    return {
      key, kind: 'booking', state: 'confirmed', category: null, x: 0, w: 0,
      startMin: start, endMin: end, title: '', tag: '', time: '',
      ticketCat: null, ticketCore: null, held: false, micro: false, caseId: key, label: '',
    }
  }

  function n0StaffLane(key: string, stores: string[] | null, items: BoardItem[] = []): BoardLane {
    return {
      key, group: 'staff', label: key, sub: '', absentNote: null, mine: false, items,
      window: { from: N0_OPEN, until: N0_CLOSE }, untilLabel: hhmm(N0_CLOSE),
      listPrice: 7000, stores, roomClass: null,
    }
  }

  function n0BedLane(key: string, storeId: string, items: BoardItem[] = []): BoardLane {
    return {
      key, group: 'beds', label: key, sub: '', absentNote: null, mine: false, items,
      window: null, untilLabel: null, listPrice: 0, stores: [storeId], roomClass: 'standard',
    }
  }

  /** A unit store (store-a) beside a STORE-BOUND no-unit store (store-z), plus
   *  a floating staff on half the seeds. Every store-a bed is deliberately
   *  double-booked solid for the FIRST sellable slot (decision point (ii)/(e):
   *  a mixed board with every unit busy still sells the no-unit store's free
   *  staff) — forced, not left to chance, so every seed exercises it; store-z's
   *  own random bookings are kept OUT of that same slot so its staff are
   *  provably free there. */
  function genN0Board(seed: number) {
    const rnd = mulberry32(seed)
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
    const gridMin = pick(GRIDS)
    const sellSlotMin = pick(SLOTS)

    const numStaffA = 2 + Math.floor(rnd() * 5) // 2..6
    const numBeds = 1 + Math.floor(rnd() * 4) // 1..4
    const numBookingsA = Math.floor(rnd() * 7) // 0..6
    const numStaffZ = 1 + Math.floor(rnd() * 5) // 1..5
    const numBookingsZ = Math.floor(rnd() * 5) // 0..4
    const hasFloating = seed % 2 === 0 // half the seeds, exactly

    const aStaffKeys = Array.from({ length: numStaffA }, (_, i) => `a-staff-${seed}-${i}`)
    const bedKeys = Array.from({ length: numBeds }, (_, i) => `a-bed-${seed}-${i}`)
    const zStaffKeys = Array.from({ length: numStaffZ }, (_, i) => `z-staff-${seed}-${i}`)
    const floatingKey = hasFloating ? `float-${seed}` : null

    const aStaffOccupied = new Map<string, Array<{ start: number; end: number }>>(aStaffKeys.map((k) => [k, []]))
    const bedOccupied = new Map<string, Array<{ start: number; end: number }>>(bedKeys.map((k) => [k, []]))
    const zStaffOccupied = new Map<string, Array<{ start: number; end: number }>>(zStaffKeys.map((k) => [k, []]))

    // store-a bookings: a real staff+bed pair, rejection-sampled against both.
    for (let i = 0; i < numBookingsA; i += 1) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const staffKey = pick(aStaffKeys)
        const bedKey = pick(bedKeys)
        const start = N0_OPEN + Math.floor(rnd() * 24) * 15
        const dur = pick(DURS)
        const end = start + dur
        if (end > N0_CLOSE) continue
        if (aStaffOccupied.get(staffKey)!.some((o) => overlaps(o, start, end))) continue
        if (bedOccupied.get(bedKey)!.some((o) => overlaps(o, start, end))) continue
        aStaffOccupied.get(staffKey)!.push({ start, end })
        bedOccupied.get(bedKey)!.push({ start, end })
        break
      }
    }
    // THE FORCED LOCKDOWN: every store-a bed busy for the whole first slot.
    for (const bedKey of bedKeys) bedOccupied.get(bedKey)!.push({ start: N0_OPEN, end: N0_OPEN + sellSlotMin })

    // ⚖ SELF-CORRECTION (F2 NOTE (d), disclosed) — THE FORCED FLOATING WINDOW.
    // The pairing loop below is byte-identical, unchanged canon: it iterates
    // `needing` in ARRAY order and stops as soon as `claimed.size` reaches
    // `freeBeds.length` — and the floating lane is always LAST in that order
    // (it is appended after every other staff group when the board's lanes
    // are built above). So whenever enough store-a staff are simultaneously
    // free to fill every store-a bed on their own (real on seeds with few or
    // no store-a bookings — e.g. numStaffA >= numBeds), floating never gets a
    // turn ALL DAY and `floatCells` is empty — not a regression, a pre-existing
    // property of the frozen pairing order the family's own claim ("non-empty
    // on every seed today") did not hold on real seeds (seed 2 failed it: 3
    // staff, 3 beds, 0 conflicts). Forced, not sampled, exactly like the
    // lockdown above: one late slot where every store-a staff is occupied and
    // one bed is guaranteed clear, so floating is the ONLY member of `needing`
    // there and provably pairs.
    if (floatingKey) {
      const steps = Math.floor((N0_CLOSE - sellSlotMin - N0_OPEN) / gridMin)
      const floatSm = N0_OPEN + steps * gridMin
      const floatEnd = floatSm + sellSlotMin
      for (const k of aStaffKeys) aStaffOccupied.get(k)!.push({ start: floatSm, end: floatEnd })
      const clearBed = bedKeys[0]
      bedOccupied.set(clearBed, bedOccupied.get(clearBed)!.filter((o) => !overlaps(o, floatSm, floatEnd)))
    }

    // store-z bookings: staff only (no beds exist on this store to pair with),
    // and never inside the lockdown slot — so (e) always has a free z-staff.
    for (let i = 0; i < numBookingsZ; i += 1) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const staffKey = pick(zStaffKeys)
        const start = N0_OPEN + sellSlotMin + Math.floor(rnd() * 20) * 15
        const dur = pick(DURS)
        const end = start + dur
        if (end > N0_CLOSE) continue
        if (zStaffOccupied.get(staffKey)!.some((o) => overlaps(o, start, end))) continue
        zStaffOccupied.get(staffKey)!.push({ start, end })
        break
      }
    }

    const aStaffLanes = aStaffKeys.map((k) =>
      n0StaffLane(k, ['store-a'], aStaffOccupied.get(k)!.map((o, i) => n0Item(`${k}-b${i}`, o.start, o.end))),
    )
    const bedLanes = bedKeys.map((k) =>
      n0BedLane(k, 'store-a', bedOccupied.get(k)!.map((o, i) => n0Item(`${k}-b${i}`, o.start, o.end))),
    )
    const zStaffLanes = zStaffKeys.map((k) =>
      n0StaffLane(k, ['store-z'], zStaffOccupied.get(k)!.map((o, i) => n0Item(`${k}-b${i}`, o.start, o.end))),
    )
    const floatingLane = floatingKey ? n0StaffLane(floatingKey, null) : null

    const unitLanes = [...aStaffLanes, ...bedLanes]
    const lanes = [...unitLanes, ...zStaffLanes, ...(floatingLane ? [floatingLane] : [])]

    return {
      lanes, unitLanes, zStaffLanes, floatingLane, floatingKey, gridMin, sellSlotMin, zStaffKeys,
      zFreeAt: (staffKey: string, s: number, e: number) => trackFree(zStaffOccupied.get(staffKey) ?? [], s, e),
    }
  }

  it('≥200 seeded boards: G1 no-cap, G2 mixed-board honesty, byte-identical isolation, floating pairing', () => {
    const hours: Hours = { open: N0_OPEN, close: N0_CLOSE }
    const { price, depth } = priceOf()
    const SEEDS = 220
    let totalNoUnitCells = 0
    let totalUnitCells = 0
    let totalBands = 0
    let floatingSeeds = 0

    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const b = genN0Board(seed)
      const opts = {
        gridMin: b.gridMin, sellSlotMin: b.sellSlotMin, nowMinute: null, locked: [],
        showPrice: true, hi: price.hi, hqMin: GYM.dialogs.pricing.hqMin, depth,
      }
      const mixed = sellLayerFor(b.lanes, hours, opts)
      const unitOnlyLanes = b.floatingLane ? [...b.unitLanes, b.floatingLane] : b.unitLanes
      const unitOnly = sellLayerFor(unitOnlyLanes, hours, opts)
      const noUnitOnly = sellLayerFor(b.zStaffLanes, hours, opts)

      const zKeySet = new Set(b.zStaffKeys)
      const mixedNoUnitCells = mixed.cells.filter((c) => zKeySet.has(c.laneKey))
      const mixedUnitCells = mixed.cells.filter((c) => !zKeySet.has(c.laneKey))

      // (a) the no-unit store's cells = one per FREE staff per slot, all resourceKey ''
      expect(mixedNoUnitCells.every((c) => c.resourceKey === '' && c.bed === '')).toBe(true)
      const bySlot = new Map<number, number>()
      for (const c of mixedNoUnitCells) bySlot.set(c.h, (bySlot.get(c.h) ?? 0) + 1)
      for (let sm = N0_OPEN; sm + b.sellSlotMin <= N0_CLOSE; sm += b.gridMin) {
        const end = sm + b.sellSlotMin
        const freeCount = b.zStaffKeys.filter((k) => b.zFreeAt(k, sm, end)).length
        expect({ seed, sm, count: bySlot.get(sm) ?? 0 }).toEqual({ seed, sm, count: freeCount })
      }

      // (b)/(c) byte-identical EXCEPT `tier`: `buildSellLayer`'s tiering is a
      // GLOBAL min/max reduction over every staff cell IN THE LAYER (pre-existing,
      // unrelated to N0 — the same crosstalk exists on any two-store board today);
      // adding or removing the other store's cells can shift the price pool and
      // relabel a tier bucket without moving the underlying `price`. The
      // additive-only law N0 owns is about WHICH cells exist and their own
      // fields, not this shared display bucket, so it is stripped before the
      // isolation checks below.
      const noTier = (cells: typeof mixed.cells) => cells.map((c) => ({ ...c, tier: 1 as const }))

      // (b) the unit store's (+ floating's) cells are byte-identical with/without the no-unit store
      expect(noTier(mixedUnitCells)).toEqual(noTier(unitOnly.cells))

      // (c) the no-unit store's cells are byte-identical to its own clamped board
      expect(noTier(mixedNoUnitCells)).toEqual(noTier(noUnitOnly.cells))

      // (d) the floating staff (when present) always pairs with a real unit — never unitless
      if (b.floatingLane) {
        floatingSeeds += 1
        const floatCells = mixed.cells.filter((c) => c.laneKey === b.floatingKey)
        // `every` on an empty array is vacuously true — the floating staff has
        // a full-day window and at most 6 store-a bookings against at most 4
        // beds, so it must sell somewhere; prove the array is non-empty before
        // trusting the `every` below (⚖ L1 NOTE (d)).
        expect(floatCells.length).toBeGreaterThan(0)
        expect(floatCells.every((c) => c.resourceKey !== '')).toBe(true)
      }

      // (e) the forced lockdown slot: every store-a bed busy, store-z's staff still sell
      const lockdownCount = mixed.cells.filter((c) => c.h === N0_OPEN && zKeySet.has(c.laneKey)).length
      expect({ seed, lockdownCount }).toEqual({ seed, lockdownCount: b.zStaffKeys.length })

      // (f) nothing throws; the chip's own count tracks staffBands.length
      expect(mixed.chipLabel.startsWith(`オンライン販売中 ${mixed.staffBands.length}`)).toBe(true)

      totalNoUnitCells += mixedNoUnitCells.length
      totalUnitCells += mixedUnitCells.length
      totalBands += mixed.bands.length
    }

    console.log('N0 seeded sell-layer family', {
      seeds: SEEDS, floatingSeeds, totalNoUnitCells, totalUnitCells, totalBands, failures: 0,
    })
    expect(SEEDS).toBeGreaterThanOrEqual(200)
  })

  // ⚖ D-53 (g) — a `SellCell` carries no store: an unpaired offer for a
  // two-store staff could be booked at the unit store with every unit busy
  // (the ⚖ 8/9 class: advertising what cannot be honoured). So a staff who
  // can use a unit anywhere needs one — capacity at the no-unit store is
  // HIDDEN for that person at slots where the unit store is full; disclosed,
  // queued: a per-slot store on the sell cell is its own design (DESIGN §9
  // R6 / PLAN §9), never a silent widening here.
  describe('⚖ D-53 (g) — a staff member who works in a unit store AND a no-unit store needs a unit (the conservative rule; Greptile #933 P1-1, pinned + disclosed)', () => {
    // Reuses this file's own `n0StaffLane`/`n0BedLane`/`n0Item` helpers
    // (declared above, in this same describe's closure) rather than a new
    // builder — one unit store (1 bed + 1 store-a staff), one no-unit store
    // (1 store-z staff), and ONE two-store staff, grid 60 / slot 60.
    it('the two-store staff is never unpaired; a busy bed hides them while the store-z-only staff still sells', () => {
      const hours: Hours = { open: N0_OPEN, close: N0_CLOSE }
      const { price, depth } = priceOf()
      const opts = {
        gridMin: 60, sellSlotMin: 60, nowMinute: null, locked: [],
        showPrice: true, hi: price.hi, hqMin: GYM.dialogs.pricing.hqMin, depth,
      }
      const aStaff = n0StaffLane('p1-a-staff', ['store-a'])
      const zStaff = n0StaffLane('p1-z-staff', ['store-z'])
      const twoStore = n0StaffLane('p1-two-store', ['store-a', 'store-z'])

      // variant 1 — all free all day: the two-store staff is either paired
      // (won the bed) or absent for the slot (the cap gave the bed to
      // someone else) — never an unpaired `resourceKey ''` cell.
      const freeBed = n0BedLane('p1-a-bed', 'store-a')
      const free = sellLayerFor([aStaff, freeBed, zStaff, twoStore], hours, opts)
      const twoStoreFreeCells = free.cells.filter((c) => c.laneKey === 'p1-two-store')
      console.log('P1-1 free board', {
        count: twoStoreFreeCells.length,
        resourceKeys: [...new Set(twoStoreFreeCells.map((c) => c.resourceKey))],
      })
      expect(twoStoreFreeCells.every((c) => c.resourceKey !== '')).toBe(true)

      // variant 1b — a SECOND store-a bed lane, also free all day: the
      // 2-bed board records the rule's positive half (the 1-bed board only
      // ever sees this staff absent under the cap); under mutant g3 both
      // boards go RED.
      const freeBed2 = n0BedLane('p1-a-bed-2', 'store-a')
      const free2 = sellLayerFor([aStaff, freeBed, freeBed2, zStaff, twoStore], hours, opts)
      const twoStoreFreeCells2 = free2.cells.filter((c) => c.laneKey === 'p1-two-store')
      console.log('P1-1 2-bed free board', {
        twoBedCount: twoStoreFreeCells2.length,
        allPaired: twoStoreFreeCells2.every((c) => c.resourceKey !== ''),
      })
      expect(twoStoreFreeCells2.length).toBeGreaterThan(0)
      expect(twoStoreFreeCells2.every((c) => c.resourceKey !== '')).toBe(true)

      // variant 2 — the one bed BUSY over the first slot: the two-store
      // staff sells nothing there (they still need a unit and none is
      // free), while the store-z-only staff still sells their staff-time
      // cell.
      const busyBed = n0BedLane('p1-a-bed', 'store-a', [n0Item('p1-busy', N0_OPEN, N0_OPEN + 60)])
      const busy = sellLayerFor([aStaff, busyBed, zStaff, twoStore], hours, opts)
      const twoStoreCellsAtBusySlot = busy.cells.filter((c) => c.laneKey === 'p1-two-store' && c.h === N0_OPEN).length
      const zOnlyCellsAtBusySlot = busy.cells.filter((c) => c.laneKey === 'p1-z-staff' && c.h === N0_OPEN).length
      console.log('P1-1 busy-bed slot', { twoStoreCellsAtBusySlot, zOnlyCellsAtBusySlot })
      expect({ twoStoreCellsAtBusySlot, zOnlyCellsAtBusySlot }).toEqual({ twoStoreCellsAtBusySlot: 0, zOnlyCellsAtBusySlot: 1 })
    })
  })
})

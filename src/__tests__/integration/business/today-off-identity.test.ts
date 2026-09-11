/**
 * 今日の運営 — THE OFF GATE (test-only PR).
 *
 * What it is: the eleven board calculations at three store views (STORE_A,
 * STORE_B, viewAll) must produce byte-identical answers to the frozen file
 * below; a change here is a change to what every store sees on 今日の運営 with
 * no class feature switched on. The fixture's beds all carry 0 cleanup, so
 * the cleanupBlocks cell freezes that (vacuous) fixture value directly; a
 * separate `cleanup15` literal exercises cleanupBlocks' own arithmetic at a
 * fixed 15 minutes.
 *
 * The frozen file is EMITTED by this suite
 * (`EMIT_OFF_IDENTITY=<sha> npx jest today-off-identity`), never typed by
 * hand; the emitting PR carries the file's sha256 in its body.
 *
 * ⚖ COORDINATION SENTENCE: 「A foundation change that legitimately moves the
 * board RE-EMITS this file in the same PR and states the reason in that PR's
 * body; a re-emit with no stated reason is a review-fail.」
 *
 * Why no stable-stringify: every path below is pure and deterministic, so key
 * order is fixed by the code — nothing here needs a stable-stringify library.
 *
 * The strip() half (class rows removed vs present) and the dial's runtime
 * half land together with the class fields; today only the source pin (the
 * last `it` below) stands.
 *
 * Time is frozen once for the whole file; every explicit now-parameter below
 * (NOW_MIN, sellLayerFor's nowMinute, bedTruthViews' nowMin) derives from
 * that one instant.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { jstDayKey, jstMinuteOfDay } from '@/business/lib/clock'
import { STORE_A, STORE_B } from '@/business/lib/fixtures'
import * as data from '@/business/lib/data'
import type { StoreLens } from '@/business/lib/data'
import {
  buildLanes,
  cleanupBlocks,
  dayBookings,
  laneMinutes,
  minuteOf,
  place,
  utilization,
  type BoardBooking,
  type BoardItem,
  type BoardLane,
  type BuildInput,
  type Hours,
} from '@/business/lib/today-board'
import {
  allocateBed,
  fitsDrag,
  laneSpans,
  orderRooms,
  roomFitsNeed,
  sellLayerFor,
} from '@/app/[locale]/(business)/business/today/today-interactions'
import { computeChecks, type Check, type CheckContext, type CheckSpan } from '@/business/lib/canon-logic/drag-rules'
import { bedTruthViews, type DayFrame, type NewClient } from '@/app/[locale]/(business)/business/today/capacity-ledger'

const FROZEN_PATH = join(process.cwd(), 'src/__tests__/integration/business/today-off-identity.frozen.json')
const FROZEN_INSTANT = '2026-08-19T00:00:00Z'

beforeAll(() => jest.useFakeTimers().setSystemTime(new Date(FROZEN_INSTANT)))
afterAll(() => jest.useRealTimers())

const NOW_MIN = jstMinuteOfDay(new Date(FROZEN_INSTANT))

// The live page's own read window (page.tsx:96 `const WINDOW = 45`, :141-142
// `from`/`to`) — WINDOW is not exported, so mirrored here rather than reused.
// Without it, `listAppointments(lens)` with no range pulls every fixture
// appointment ever dated, not the window the real board would ever ask for.
const WINDOW = 45
const DAY_MS = 86_400_000
const APPT_FROM = new Date(new Date(FROZEN_INSTANT).getTime() + (-WINDOW - 1) * DAY_MS).toISOString()
const APPT_TO = new Date(new Date(FROZEN_INSTANT).getTime() + (WINDOW + 1) * DAY_MS).toISOString()

const LENSES: ReadonlyArray<readonly [string, StoreLens]> = [
  ['STORE_A', STORE_A],
  ['STORE_B', STORE_B],
  ['viewAll', { viewAll: true } as const],
]

const PATHS = [
  'dayBookings',
  'buildLanes',
  'cleanupBlocks',
  'laneMinutes',
  'utilization',
  'computeChecks',
  'laneSpans',
  'roomAllocation',
  'sellLayerFor',
  'bedTruthViews',
  'fitsDrag',
] as const

interface World {
  input: BuildInput
  bookings: BoardBooking[]
  lanes: BoardLane[]
  hours: Hours
  opsConfig: { reserveStartGridMin: number }
  pricingRule: { hq_min: number; hq_max: number }
}

/** The `viewAll` assembly from `today-board.test.ts:119-156 mergedLanes()`,
 *  copied and parameterised by lens rather than hardcoded to viewAll — the
 *  house does not share test helpers across files (`codeOnly` is copied
 *  twice already). */
async function buildWorld(lens: StoreLens): Promise<World> {
  const [customers, appts, menus, staff, resources, planes, shell, storeOptions, staffStores] =
    await Promise.all([
      data.listCustomers(lens),
      data.listAppointments(lens, { from: APPT_FROM, to: APPT_TO }),
      data.listMenus(lens),
      data.listStaff(lens),
      data.listResources(lens),
      data.readDayPlanes(lens, jstDayKey(new Date())),
      data.readShellIdentity(),
      data.listStoreOptions(),
      data.readStaffStores(lens),
    ])
  const input: BuildInput = {
    appointments: appts,
    customers,
    menus,
    staff,
    resources,
    shifts: planes.shifts,
    qualifications: planes.staffQualifications,
    staffListPrice: planes.staffListPrice,
    staffStores,
    absence: planes.absence,
    blocks: planes.blocks,
    sellSlots: planes.sellSlots,
    decisions: planes.decisions,
    hours: planes.operatingHours,
    dayKey: jstDayKey(new Date()),
    operatorStaffId: shell.operator.staff_id,
    storeNames: new Map(storeOptions.map((s) => [s.id, s.name])),
    crossStore: typeof lens !== 'string',
  }
  const bookings = dayBookings(input)
  const lanes = buildLanes(input, bookings)
  return { input, bookings, lanes, hours: input.hours, opsConfig: planes.opsConfig, pricingRule: planes.pricingRule }
}

/** Each bed lane's own bookings, in cleanupBlocks' input shape — shared by
 *  cell 3 (the fixture's own cleanup_minutes) and the `cleanup15` literal
 *  (a fixed 15), so both read off the same per-bed grouping. Bed lane key =
 *  resource id (`lanes.push({ key: resource.id, group: 'beds', ... })`,
 *  today-board.ts:609-611 — grep-verified). */
function bedBookingsByLane(world: World): Array<[string, Array<{ id: string; start: number; end: number }>]> {
  return world.lanes
    .filter((l) => l.group === 'beds')
    .map((l) => [
      l.key,
      world.bookings
        .filter((b) => b.resourceId === l.key)
        .map(({ id, startMinute, endMinute }) => ({ id, start: startMinute, end: endMinute })),
    ])
}

/** The fixed-15 exercise of cleanupBlocks' own arithmetic (G3) — moved out of
 *  cell 3, which now freezes the fixture's own (vacuous) cleanup_minutes. */
function cleanup15For(world: World): Record<string, unknown> {
  return Object.fromEntries(bedBookingsByLane(world).map(([key, bk]) => [key, cleanupBlocks(bk, 15, world.hours)]))
}

/** The computeChecks probe (G2): the first staff lane with >= 2 bookings —
 *  `chosen` is the first of those two (`chosenItem` its BoardItem form,
 *  `.startMin`/`.endMin`), `second` the other. `ctx.bookingId` is `chosen`'s
 *  own id, so drag-rules.ts:200 excludes `chosen`'s own span(s) from the
 *  conflict pool; `now` (built by the caller) straddles BOTH `chosen`'s own
 *  slot and `second`'s, so that exclusion is load-bearing — proven by mutant
 *  M8 (drop the exclusion), which then names `chosen` in the label too.
 *  Lane chosen per lens (verified empirically, see the build report):
 *  STORE_A → staff lane `c-03`; viewAll → the same `c-03` (same booking,
 *  same fixture rows). STORE_B has no staff lane with 2 bookings at all (its
 *  2 real bookings sit on 2 DIFFERENT staff members) — see the fallback
 *  below, which uses its bed lane instead. */
function checksProbeFor(world: World): { staffLane: BoardLane; chosen: BoardBooking; chosenItem: BoardItem; second: BoardItem } {
  const staffLaneWithTwo = world.lanes.find(
    (l) => l.group === 'staff' && l.items.filter((i) => i.kind === 'booking').length >= 2,
  )
  if (staffLaneWithTwo) {
    const [chosenItem, second] = staffLaneWithTwo.items.filter((i) => i.kind === 'booking')
    const chosen = world.bookings.find((b) => b.id === chosenItem.caseId)!
    return { staffLane: staffLaneWithTwo, chosen, chosenItem, second }
  }
  // Fallback (STORE_B only, verified empirically): its 2 real bookings sit on
  // 2 DIFFERENT staff members, so no single staff lane ever carries 2 — its
  // one bed lane (bed-04) does, since both bookings are on the same bed.
  // `chosen`'s own staff lane still supplies staffName/staffUntil; `second`
  // and the overlap come from the shared bed lane instead.
  const bedLaneWithTwo = world.lanes.find(
    (l) => l.group === 'beds' && l.items.filter((i) => i.kind === 'booking').length >= 2,
  )!
  const [chosenItem, second] = bedLaneWithTwo.items.filter((i) => i.kind === 'booking')
  const chosen = world.bookings.find((b) => b.id === chosenItem.caseId)!
  const staffLane = world.lanes.find((l) => l.group === 'staff' && l.key === chosen.staffId)!
  return { staffLane, chosen, chosenItem, second }
}

/** Every one of the eleven paths, computed once for one lens's world. */
function cellsFor(world: World, lens: StoreLens): Record<(typeof PATHS)[number], unknown> {
  const { input, bookings, lanes, hours, opsConfig, pricingRule } = world

  // 3 — cleanupBlocks: the fixture's own OFF value. All four bed resources
  // carry cleanup_minutes: 0 (fixtures-today.ts:140-143), so this cell is
  // vacuous ([] per bed) today — a genuine fact, not a probe; buildLanes' own
  // derived 清掃 blocks (built from these SAME resource.cleanup_minutes) cover
  // the real path. Production shape, not the whole day on one timeline —
  // `cleanupBlocks` is documented "清掃 windows on ONE resource"
  // (today-board.ts:88) and both buildLanes (:585) and the sibling test
  // (:245-256) feed it one bed's own bookings at a time.
  const bedLanes = lanes.filter((l) => l.group === 'beds')
  const resourceByKey = new Map(input.resources.map((r) => [r.id, r]))
  const cleanupBlocksValue = Object.fromEntries(
    bedBookingsByLane(world).map(([key, bk]) => [key, cleanupBlocks(bk, resourceByKey.get(key)?.cleanup_minutes ?? 0, hours)]),
  )

  // 4 — laneMinutes (also literal A).
  const laneMinutesValue = laneMinutes(input, bookings)

  // 5 — utilization.
  const utilizationValue = utilization(laneMinutesValue)

  // 6 — computeChecks (also literal B). ctx.spans built from ONLY the chosen
  // booking's own two lanes — its staff lane and, if it has one, its bed lane
  // — never the whole board: both production callers restrict the pool this
  // way. TodayScreen.tsx:2687 `const onLanes = boardLanes.filter((l) =>
  // l.items.some((i) => i.caseId === id))`; today-interactions.ts:5269 `for
  // (const lane of [staff, bed])`. `bookingId` comes from `checksProbeFor`
  // (G2) — a real id, never synthesised. `now` is a long drag stretching from
  // 15 min into `chosen`'s own slot to 15 min into `second`'s, so it overlaps
  // BOTH — the self-exclusion on `ctx.bookingId` is load-bearing (proven by
  // mutant M8): with it, only `second`'s title conflicts; without it,
  // `chosen`'s own title joins the label too. Guard (not observed in this
  // fixture, kept defensive): if `second`'s start + 15 wouldn't land after
  // `chosen`'s start + 15, use the later of the two bookings' own end
  // minutes instead, so the span never degenerates to zero width.
  const { staffLane: staffLaneWithTwo, chosen: chosenBooking, chosenItem, second: secondItem } = checksProbeFor(world)
  const checkStart = chosenItem.startMin + 15
  const naiveCheckEnd = secondItem.startMin + 15
  const checkEnd = naiveCheckEnd > checkStart ? naiveCheckEnd : Math.max(secondItem.endMin, chosenItem.endMin)
  const checkNow = place(checkStart, checkEnd, hours)
  const bookingBedLane = bedLanes.find((l) => l.key === chosenBooking.resourceId) ?? null
  const onLanes = [staffLaneWithTwo, ...(bookingBedLane ? [bookingBedLane] : [])]
  const spans: CheckSpan[] = onLanes
    .flatMap((l) => l.items)
    .map((i) => ({ id: i.caseId ?? i.key, x: i.x, w: i.w, title: i.title, derived: i.kind === 'cleanup', parked: false }))
  const ctx: CheckContext = {
    spans,
    bookingId: chosenBooking.id,
    staffName: staffLaneWithTwo.label,
    staffUntil: staffLaneWithTwo.untilLabel,
    laneLocked: false,
    minutesOf: (x: number) => minuteOf(x, hours),
  }
  const computeChecksValue: Check[] = computeChecks(checkNow, ctx)

  // 7 — laneSpans.
  const laneSpansValue = Object.fromEntries(lanes.map((l) => [l.key, laneSpans(l)]))

  // 8 — roomFitsNeed / orderRooms / allocateBed, for the day's first booking.
  // `bedLanes` reused from cell 3 above. `fits` probes BOTH needs (not just
  // the first booking's own, which is `false` and short-circuits `roomFitsNeed`
  // before it ever reads `lane.roomClass` — STORE_A's bed-03 is the real
  // private room, fixtures-today.ts:142, and was otherwise never exercised).
  const firstBooking = bookings[0]
  const need = firstBooking.requiresPrivateRoom
  const bookingStaffLane = lanes.find((l) => l.group === 'staff' && l.key === firstBooking.staffId) ?? null
  // allocFull is a second probe: allocateBed for a NEW booking at this lens's
  // own busiest bed slot — only STORE_B (1 bed, 2 bookings) is guaranteed a
  // genuine refusal by this fixture; STORE_A/viewAll may legitimately find a
  // free bed.
  let busiestT = hours.open
  let busiestCount = -1
  for (let t = hours.open; t < hours.close - 60; t += 30) {
    const occupied = bedLanes.filter((l) =>
      bookings.some((b) => b.resourceId === l.key && b.startMinute <= t && t < b.endMinute),
    ).length
    if (occupied > busiestCount) {
      busiestCount = occupied
      busiestT = t
    }
  }
  const roomAllocationValue = {
    fits: {
      standard: bedLanes.map((l) => [l.key, roomFitsNeed(l, false)]),
      private: bedLanes.map((l) => [l.key, roomFitsNeed(l, true)]),
    },
    order: orderRooms(bedLanes).map((l) => l.key),
    // `currentBed: null` (not the booking's own resourceId) so the search
    // runs the ordered walk instead of returning early on keep-your-room.
    alloc: allocateBed(lanes, {
      id: firstBooking.id,
      currentBed: null,
      stores: bookingStaffLane?.stores ?? null,
      requiresPrivate: need,
      start: firstBooking.startMinute,
      end: firstBooking.endMinute,
      now: NOW_MIN,
    }),
    allocFull: allocateBed(lanes, {
      id: 'off-identity-full',
      currentBed: null,
      stores: typeof lens === 'string' ? [lens] : null,
      requiresPrivate: false,
      start: busiestT,
      end: busiestT + 60,
      now: NOW_MIN,
    }),
    // allocKeep/allocKeepPrivate exercise rule 1 of allocateBed's own three
    // (「keep the booking's current bed when it is free」) — `alloc`/`allocFull`
    // both pass `currentBed: null` and never reach it.
    allocKeep: allocateBed(lanes, {
      id: firstBooking.id,
      currentBed: firstBooking.resourceId,
      stores: bookingStaffLane?.stores ?? null,
      requiresPrivate: need,
      start: firstBooking.startMinute,
      end: firstBooking.endMinute,
      now: NOW_MIN,
    }),
    allocKeepPrivate: allocateBed(lanes, {
      id: firstBooking.id,
      currentBed: firstBooking.resourceId,
      stores: bookingStaffLane?.stores ?? null,
      requiresPrivate: true,
      start: firstBooking.startMinute,
      end: firstBooking.endMinute,
      now: NOW_MIN,
    }),
  }

  // 9 — sellLayerFor (covers deriveSellableCells). Same opts shape as the
  // sibling's call at :786; gridMin/hi/hqMin read off the same fixture door
  // (readDayPlanes) the page itself reads them from, since this suite never
  // renders the page.
  const sellLayerOpts: Omit<Parameters<typeof sellLayerFor>[2], 'nowMinute'> = {
    gridMin: opsConfig.reserveStartGridMin,
    locked: [],
    showPrice: true,
    hi: pricingRule.hq_max,
    hqMin: pricingRule.hq_min,
    depth: 9,
  }
  // `atOpen` alone leaves 「過ぎた時間は売れない」 untested: NOW_MIN (09:00) sits
  // before `hours.open` (10:00), so `Math.max(open, …)` is always dominated by
  // `open` and the now-clamp never bites; `midDay` (a fixed mid-day instant
  // derived from the fixture's own opening hour) makes it bite.
  const sellLayerForValue = {
    atOpen: sellLayerFor(lanes, hours, { ...sellLayerOpts, nowMinute: NOW_MIN }),
    midDay: sellLayerFor(lanes, hours, { ...sellLayerOpts, nowMinute: hours.open + 150 }),
  }

  // 10 — capacity-ledger bedTruthViews. Captured before any other call on
  // this `world` (own block, `world`/`bedWorld` used nowhere else); never
  // includes `stats`. `mask` is a function (`(startMin) => boolean`), so it
  // is evaluated at each slot's own `t` rather than serialised as a closure.
  const frame: DayFrame = { openMin: hours.open, closeMin: hours.close, nowMin: NOW_MIN }
  const { world: bedWorld } = bedTruthViews(lanes, frame, null)
  const asker: NewClient = { stores: null }
  const dur = 60
  const runs = bedWorld.fullRuns(dur, null)
  const maskLane = lanes.find((l) => l.group === 'staff')!
  const mask = bedWorld.newClientMask(maskLane, dur)
  // `runs` does not vary per slot (fullRuns is asked once, on (dur, stores)
  // alone) — a sibling field beside `slots`, not repeated inside every entry.
  const slots: Array<{ t: number; free: readonly string[]; count: number; mask: boolean }> = []
  for (let t = hours.open; t < hours.close; t += 30) {
    slots.push({
      t,
      free: bedWorld.freeBedKeys(t, t + dur, asker),
      count: bedWorld.freeBedCount(t, t + dur, asker),
      mask: mask(t),
    })
  }
  const bedTruthViewsValue = { runs, slots }

  // 11 — fitsDrag.
  const fitsDragValue = ([[15, 15], [30, 15], [30, 30], [45, 30], [60, 90], [90, 60], [0, 15], [15, 0]] as const).map(
    ([a, d]) => fitsDrag(a, d),
  )

  return {
    dayBookings: bookings,
    buildLanes: lanes,
    cleanupBlocks: cleanupBlocksValue,
    laneMinutes: laneMinutesValue,
    utilization: utilizationValue,
    computeChecks: computeChecksValue,
    laneSpans: laneSpansValue,
    roomAllocation: roomAllocationValue,
    sellLayerFor: sellLayerForValue,
    bedTruthViews: bedTruthViewsValue,
    fitsDrag: fitsDragValue,
  }
}

function hashOf(value: unknown): { sha256: string; bytes: number; n: number } {
  const json = JSON.stringify(value)
  const n = Array.isArray(value)
    ? value.length
    : value !== null && typeof value === 'object'
      ? Object.keys(value as Record<string, unknown>).length
      : 1
  return { sha256: createHash('sha256').update(json).digest('hex'), bytes: json.length, n }
}

let WORLDS: Record<string, World>
let CELLS: Record<string, Record<(typeof PATHS)[number], unknown>>

beforeAll(async () => {
  WORLDS = {}
  CELLS = {}
  for (const [lensName, lens] of LENSES) {
    const world = await buildWorld(lens)
    WORLDS[lensName] = world
    CELLS[lensName] = cellsFor(world, lens)
  }
})

const EMIT_SHA = process.env.EMIT_OFF_IDENTITY
// A stray/unset-by-accident value here would otherwise skip every real
// assertion and exit 0 — validated at module load so that can never pass
// silently, in CI or anywhere else.
if (EMIT_SHA !== undefined && !/^[0-9a-f]{7,40}$/.test(EMIT_SHA)) {
  throw new Error(`EMIT_OFF_IDENTITY must be a lowercase hex git sha (7-40 chars); got ${JSON.stringify(EMIT_SHA)}`)
}
const itNormal = EMIT_SHA ? it.skip : it
const itEmit = EMIT_SHA ? it : it.skip

interface FrozenFile {
  emittedAt: string
  instant: string
  cells: Record<string, Record<string, { sha256: string; bytes: number; n: number }>>
  literals: { laneMinutes: Record<string, unknown>; computeChecks: Record<string, unknown>; cleanup15: Record<string, unknown> }
}

let FROZEN: FrozenFile | null = null
if (!EMIT_SHA) {
  FROZEN = JSON.parse(readFileSync(FROZEN_PATH, 'utf8')) as FrozenFile
}

describe('the 33 cells', () => {
  for (const [lensName] of LENSES) {
    for (const path of PATHS) {
      itNormal(`${lensName}/${path} is unchanged`, () => {
        const { sha256, bytes, n } = hashOf(CELLS[lensName][path])
        expect({ lens: lensName, path, sha256, bytes, n }).toEqual({
          lens: lensName,
          path,
          ...FROZEN!.cells[lensName][path],
        })
      })
    }
  }

  // ── emit mode ──────────────────────────────────────────────────────────
  itEmit('emits the frozen file', () => {
    const cells: FrozenFile['cells'] = {}
    const literals: FrozenFile['literals'] = { laneMinutes: {}, computeChecks: {}, cleanup15: {} }
    for (const [lensName] of LENSES) {
      cells[lensName] = {}
      for (const path of PATHS) {
        cells[lensName][path] = hashOf(CELLS[lensName][path])
      }
      literals.laneMinutes[lensName] = laneMinutes(WORLDS[lensName].input, WORLDS[lensName].bookings)
      literals.computeChecks[lensName] = CELLS[lensName].computeChecks
      literals.cleanup15[lensName] = cleanup15For(WORLDS[lensName])
    }
    const frozen: FrozenFile = { emittedAt: EMIT_SHA as string, instant: FROZEN_INSTANT, cells, literals }
    writeFileSync(FROZEN_PATH, `${JSON.stringify(frozen, null, 2)}\n`)
  })
})

describe('the three literals', () => {
  for (const [lensName] of LENSES) {
    itNormal(`${lensName} laneMinutes literal is unchanged`, () => {
      const { input, bookings } = WORLDS[lensName]
      expect(laneMinutes(input, bookings)).toEqual(FROZEN!.literals.laneMinutes[lensName])
    })

    itNormal(`${lensName} computeChecks literal is unchanged, and proves a real conflict with someone else`, () => {
      const value = CELLS[lensName].computeChecks as Check[]
      expect(value).toEqual(FROZEN!.literals.computeChecks[lensName])
      expect(value.some((c) => !c.ok)).toBe(true)
      const { second } = checksProbeFor(WORLDS[lensName])
      expect(value.some((c) => !c.ok && c.label.includes(second.title))).toBe(true)
    })

    itNormal(`${lensName} cleanup15 literal is unchanged`, () => {
      expect(cleanup15For(WORLDS[lensName])).toEqual(FROZEN!.literals.cleanup15[lensName])
    })
  }
})

describe('the dial pin', () => {
  it('buildLanes carries no class-slot dial', () => {
    // buildLanes keys on rows, never on the master dial (ADJUDICATION §3); the runtime half of this pin lands with the class fields.
    expect(String(buildLanes)).not.toMatch(/class_slots_enabled|classSlotsEnabled/)
  })
})

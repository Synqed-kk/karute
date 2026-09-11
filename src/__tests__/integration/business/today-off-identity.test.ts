/**
 * 今日の運営 — THE OFF GATE (test-only PR).
 *
 * What it is: the eleven board calculations at three store views (STORE_A,
 * STORE_B, viewAll) must produce byte-identical answers to the frozen file
 * below; a change here is a change to what every store sees on 今日の運営 with
 * no class feature switched on. The fixture's beds all carry 0 cleanup, so
 * the cleanupBlocks cell applies a fixed 15-minute turnaround instead of the
 * fixture's own (vacuous) value.
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
      data.listAppointments(lens),
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

/** Every one of the eleven paths, computed once for one lens's world. */
function cellsFor(world: World): Record<(typeof PATHS)[number], unknown> {
  const { input, bookings, lanes, hours, opsConfig, pricingRule } = world

  // 3 — cleanupBlocks. The fixture's beds all carry 0 cleanup, so the cell
  // applies a fixed 15-minute turnaround; production shape, not the whole
  // day on one timeline — `cleanupBlocks` is documented "清掃 windows on ONE
  // resource" (today-board.ts:88) and both buildLanes (:585) and the sibling
  // test (:245-256) feed it one bed's own bookings at a time. Bed lane key =
  // resource id (`lanes.push({ key: resource.id, group: 'beds', ... })`,
  // today-board.ts:609-611 — grep-verified), so `l.key` is what
  // `b.resourceId` is filtered against below. One entry per bed lane.
  const bedLanes = lanes.filter((l) => l.group === 'beds')
  const cleanupBlocksValue = Object.fromEntries(
    bedLanes.map((l) => [
      l.key,
      cleanupBlocks(
        bookings.filter((b) => b.resourceId === l.key).map(({ id, startMinute, endMinute }) => ({ id, start: startMinute, end: endMinute })),
        15,
        hours,
      ),
    ]),
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
  // (const lane of [staff, bed])`. `now` is the first booking of the first
  // staff lane that has one, shifted +30 min — long enough that the shift
  // still overlaps its own original span, producing a real 時間帯が重複.
  const staffLaneWithBooking = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.kind === 'booking'))!
  const firstStaffBookingItem = staffLaneWithBooking.items.find((i) => i.kind === 'booking')!
  const checkNow = place(firstStaffBookingItem.startMin + 30, firstStaffBookingItem.endMin + 30, hours)
  const chosenBooking = bookings.find((b) => b.id === firstStaffBookingItem.caseId)!
  const bookingBedLane = bedLanes.find((l) => l.key === chosenBooking.resourceId) ?? null
  const onLanes = [staffLaneWithBooking, ...(bookingBedLane ? [bookingBedLane] : [])]
  const spans: CheckSpan[] = onLanes
    .flatMap((l) => l.items)
    .map((i) => ({ id: i.caseId ?? i.key, x: i.x, w: i.w, title: i.title, derived: i.kind === 'cleanup', parked: false }))
  const ctx: CheckContext = {
    spans,
    bookingId: 'off-identity-synthetic',
    staffName: staffLaneWithBooking.label,
    staffUntil: staffLaneWithBooking.untilLabel,
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
  }

  // 9 — sellLayerFor (covers deriveSellableCells). Same opts shape as the
  // sibling's call at :786; gridMin/hi/hqMin read off the same fixture door
  // (readDayPlanes) the page itself reads them from, since this suite never
  // renders the page.
  const sellLayerForValue = sellLayerFor(lanes, hours, {
    gridMin: opsConfig.reserveStartGridMin,
    nowMinute: NOW_MIN,
    locked: [],
    showPrice: true,
    hi: pricingRule.hq_max,
    hqMin: pricingRule.hq_min,
    depth: 9,
  })

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
    CELLS[lensName] = cellsFor(world)
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
  literals: { laneMinutes: Record<string, unknown>; computeChecks: Record<string, unknown> }
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
    const literals: FrozenFile['literals'] = { laneMinutes: {}, computeChecks: {} }
    for (const [lensName] of LENSES) {
      cells[lensName] = {}
      for (const path of PATHS) {
        cells[lensName][path] = hashOf(CELLS[lensName][path])
      }
      literals.laneMinutes[lensName] = laneMinutes(WORLDS[lensName].input, WORLDS[lensName].bookings)
      literals.computeChecks[lensName] = CELLS[lensName].computeChecks
    }
    const frozen: FrozenFile = { emittedAt: EMIT_SHA as string, instant: FROZEN_INSTANT, cells, literals }
    writeFileSync(FROZEN_PATH, `${JSON.stringify(frozen, null, 2)}\n`)
  })
})

describe('the two literals', () => {
  for (const [lensName] of LENSES) {
    itNormal(`${lensName} laneMinutes literal is unchanged`, () => {
      const { input, bookings } = WORLDS[lensName]
      expect(laneMinutes(input, bookings)).toEqual(FROZEN!.literals.laneMinutes[lensName])
    })

    itNormal(`${lensName} computeChecks literal is unchanged, and proves a real conflict`, () => {
      const value = CELLS[lensName].computeChecks as Check[]
      expect(value).toEqual(FROZEN!.literals.computeChecks[lensName])
      expect(value.some((c) => !c.ok)).toBe(true)
    })
  }
})

describe('the dial pin', () => {
  it('buildLanes carries no class-slot dial', () => {
    // buildLanes keys on rows, never on the master dial (ADJUDICATION §3); the runtime half of this pin lands with the class fields.
    expect(String(buildLanes)).not.toMatch(/class_slots_enabled|classSlotsEnabled/)
  })
})

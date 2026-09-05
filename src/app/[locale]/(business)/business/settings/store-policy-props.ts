// 予約と確保 — ONE ASSEMBLY for #812's dials, called from 設定's own props file.
//
// ⚖ S17 FOLD (PACKET-ROOM9-S17 §A1). This is #812's `page.tsx` body, moved
// verbatim: `guardConfigFor`, `railInputFor`, the scene loop, the sample
// landing, `liveFieldsFrom`, `saveRefusal` and the props object are the same
// lines that shipped on 2026-09-01. What is gone is only the ROUTE half — the
// admission gate, the `?store=` clamp, the stylesheet import and the render —
// because the 設定 route already does all four, once, for every section.
//
// ⚖ THE ROOM-3 F1 LAW: ONE ASSEMBLY. `settings-props.ts` calls this inside
// `settingsProps()`, so the evidence harness and the suite render the SAME
// assembly the route does rather than a hand-written replica of it.
//
// SERVER-ONLY ON PURPOSE, like every other room's props file: every read, join
// and guard evaluation happens here, so the client receives plain values and no
// data access exists on the client at all.
//
// ⚠ PLAY-PHASE, AND THE FENCE IS THE REASON. Every value below comes from
// `src/business/lib/data.ts` reading fixtures. The charter's persistence split
// asks for the two live wire fields (`gap_guard_mode`,
// `new_client_session_minutes`) to be read and written through
// `StorePolicyClient` — and THREE independent machines forbid a core reach from
// Business territory today: `scripts/business/check-business-data-access.mjs`
// (「NO DIRECT core reach, anywhere — @synqed-kk/client」, and 「NO writes,
// anywhere」), the import allowlist in
// `src/__tests__/integration/business-isolation.test.ts` (which names
// `@synqed-kk/client` as an offender in as many words), and the CI diff gate,
// which refuses a Business PR that touches the guard scripts at all. Their own
// headers say the reconnection is 「a deliberate PR on Liam's word that has to
// amend this file」, and `scripts/business/` is CODEOWNER-gated so that PR gets
// owner review by construction. So the room ships the dials FIXTURE-BACKED with
// the honest note pattern, and `./store-policy-seam.ts` is the one file the swap
// lands in. Reported to Liam as the round's one deviation.

import { jstDayKey } from '@/business/lib/clock'
import { computeChecks, confirmCaption, type CheckSpan } from '@/business/lib/canon-logic/drag-rules'
import { type GuardConfig } from '@/business/lib/canon-logic/gap-guard'
import type { PriceFrame } from '@/business/lib/canon-logic/pricing'
import {
  listAppointments,
  listCustomers,
  listMenus,
  listResources,
  listStaff,
  listStoreOptions,
  readDayPlanes,
  readShellIdentity,
  readStaffStores,
  type StoreLens,
} from '@/business/lib/data'
import { buildLanes, dayBookings, hhmm, minuteOf, place, type BoardLane, type BuildInput, type Hours } from '@/business/lib/today-board'
import { guardVerdictAt, lossOf, protectedCapacityOf, type RailCell } from '../today/today-interactions'
import { liveFieldsFrom, MINUTE_CHOICES, saveRefusal, sceneKeyFor } from './store-policy-seam'
import { type StorePolicyProps, type StorePolicyScene } from './StorePolicySection'

const DAY_MS = 86_400_000
/** The rail's own question — 「could a 60分 placement start here」 — asked at the
 *  board's own grid. Both are canon's numbers, read off the store's dials where
 *  the store has one (`standardSessionMin`) so the preview and the board are
 *  asking the same question of the same day. */
const RAIL_STEP_MIN = 30

/** THE STORE'S GUARD, at a candidate 確保 length and strictness — assembled the
 *  ONE way 今日の運営 assembles it (its `props.guard.config`), so the preview's
 *  verdict and the board's verdict come out of one configuration and cannot
 *  disagree about what is being protected. */
function guardConfigFor(
  opsConfig: Awaited<ReturnType<typeof readDayPlanes>>['opsConfig'],
  menus: Array<{ name: string; duration_minutes: number }>,
  minutes: number,
  strict: boolean,
): GuardConfig {
  return {
    services: menus.map((m) => ({ name: m.name, dur: m.duration_minutes })),
    newClientSessionMin: minutes,
    protectedLabel: '新規',
    gapFillMinMin: opsConfig.gapFillMinMin,
    blockStepMin: opsConfig.blockStepMin,
    leadTimeMin: opsConfig.leadTimeMin,
    // ⚖ 9/1 — core `gap_guard_mode`, and the ENGINE half of the mock's
    // 「店長のみでも警告を止める」 dial: `reason.ackAllowed = mode === 'standard'`
    // (gap-guard), so at STRICT a refused start comes back un-ackable.
    //
    // ⚖ 9/1 STRICT-SWITCH RULING (fix round 1 F1) — THAT IS HALF THE DIAL, and
    // the engine's half is role-blind on purpose: canon knows nothing about
    // operators. WHO the un-ackable start actually walls is decided at the
    // composer, from ruling 91's `level` (`warnFaceFor`) — the unpermitted lose
    // the commit, the permitted keep the warn press. Which is what the dial's own
    // description promises: 「権限のないスタッフは…確定できなくなります」.
    //
    // OFF has no engine spelling at all (`GuardConfig.mode` is standard | strict),
    // which is why the room answers it before the engine rather than here — see
    // `sceneKeyFor`.
    mode: strict ? 'strict' : 'standard',
  }
}

/** What the 設定 route has already settled by the time this runs: the resolved
 *  lens, the store list it was resolved against, and the render's ONE clock
 *  read (the family's own rule, Greptile P1 on #724). Passed in rather than
 *  re-read, so 設定 and this section cannot disagree about which store or which
 *  instant they are describing. */
export interface StorePolicyPropsInput {
  lens: StoreLens
  storeId: string | null
  clamped: boolean
  storeOptions: Awaited<ReturnType<typeof listStoreOptions>>
  now: Date
}

export async function storePolicyProps({
  lens,
  storeId,
  clamped,
  storeOptions,
  now,
}: StorePolicyPropsInput): Promise<StorePolicyProps> {
  const dayKey = jstDayKey(now)
  const from = new Date(now.getTime() - DAY_MS).toISOString()
  const to = new Date(now.getTime() + DAY_MS).toISOString()

  const [customers, appointments, menus, staff, resources, planes, shell] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens, { from, to }),
    listMenus(lens),
    listStaff(lens),
    listResources(lens),
    readDayPlanes(lens, dayKey),
    readShellIdentity(),
  ])
  const staffStores = await readStaffStores(lens)

  // ⚖ THE PREVIEW STANDS ON THE STORE'S REAL DAY, not on a scene of its own.
  // The board the operator will actually work is composed here, out of the SAME
  // `today-board` producers 今日の運営 uses, so the card the settings screen
  // shows and the card the board shows are one composition of one day.
  const input: BuildInput = {
    appointments,
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
    dayKey,
    operatorStaffId: shell.operator.staff_id,
    storeNames: new Map(storeOptions.map((s) => [s.id, s.name])),
    crossStore: !clamped,
  }
  const bookings = dayBookings(input)
  const lanes = buildLanes(input, bookings)
  const hours: Hours = { open: planes.operatingHours.open, close: planes.operatingHours.close }
  const staffLanes = lanes.filter((l) => l.group === 'staff' && l.window != null)
  const dur = planes.opsConfig.standardSessionMin

  const railInputFor = (minutes: number, strict: boolean) => ({
    open: hours.open,
    close: hours.close,
    stepMin: RAIL_STEP_MIN,
    dur,
    protectedDur: minutes,
    nowMinute: planes.boardNow,
    locked: [] as string[],
    guard: guardConfigFor(planes.opsConfig, menus, minutes, strict),
  })

  /** ⚖ THE SAMPLE LANDING IS FOUND BY RULE, never written down. The mock draws
   *  one hand-picked card; a hardcoded lane + start here would be a scene that
   *  quietly stops being true the day the fixture day moves. So the room asks
   *  the store's own day for the FIRST 60分 start, in board order, that actually
   *  costs the store a protected 新規 window at the shipped dials — which is the
   *  precise landing the warn card exists for (⚖ 9/1 ruling 2/2: the warn face
   *  fires only where protected windows are really lost, `lossOf > 0`).
   *
   *  ⚖ AND IT PREFERS THE LANDING THE DIALS ON THIS SCREEN ACTUALLY MOVE. Two
   *  warn-grade classes reach the card, and only one of them answers to
   *  「店長のみでも警告を止める」: a guard REFUSAL carries `ackAllowed = mode ===
   *  'standard'` (gap-guard), so at STANDARD it wears a live 注意して配置 and at
   *  STRICT the same card goes commit-less. A `degraded` landing is the engine
   *  saying the loss is unavoidable — true, and identical under both settings,
   *  so previewing on one would leave that dial looking like a dead lever (⚠ the
   *  flag-53 disease this family already paid for once). Board order still
   *  decides which refusal; the fallback keeps any warn-grade landing rather
   *  than showing nothing.
   *
   *  Nothing found = a day on which no placement costs the store anything, and
   *  the preview then says so, honestly, rather than inventing a loss. */
  const shipped = railInputFor(planes.opsConfig.newClientSessionMin, planes.opsConfig.gapGuardMode === 'strict')
  const candidates: Array<{ lane: BoardLane; start: number; refusal: boolean }> = []
  for (const lane of staffLanes) {
    for (let start = hours.open; start < hours.close; start += RAIL_STEP_MIN) {
      const cell = guardVerdictAt(lanes, lane.key, start, shipped)
      if (cell !== null && lossOf(cell) > 0) candidates.push({ lane, start, refusal: cell.state === 'blocked' })
    }
  }
  const picked = candidates.find((c) => c.refusal) ?? candidates[0] ?? null
  const sampleLane: BoardLane | null = picked?.lane ?? null
  const sampleStart = picked?.start ?? 0

  /** The guard's verdict at that landing, and the day's 確保 capacity, at EVERY
   *  value the two chips can take — six small evaluations, done here so the
   *  browser can re-paint the card on a chip press without any data access or
   *  any arithmetic of its own.
   *
   *  ⚖ ONE BASIS. The capacity number is the ENGINE'S own `protectedCapacity`
   *  over the day's own `freePockets` — never a count this room derives — for
   *  the same reason the warn card's ¥ is asked of canon's pricing door: a
   *  second spelling of 「how many 新規 windows does this day hold」 is ⚖ 54's
   *  disease, and it is exactly the number the guardrail line is about.
   *
   *  ⚖ 9/1 (fix round 1 F5) — AND THE WALK ITSELF NOW LIVES BESIDE `lossOf`,
   *  drivable. Spelled out here it was a number no test could reach, so a
   *  fabricated capacity shipped green through 1676 of them; as
   *  `protectedCapacityOf` it is the board's own function on the board's own
   *  inputs, and the room's suite drives it against the engine directly. */
  const scenes: Record<string, StorePolicyScene> = {}
  for (const minutes of MINUTE_CHOICES) {
    const capacity = protectedCapacityOf(lanes, railInputFor(minutes, false))
    for (const strict of [false, true]) {
      const cell: RailCell | null =
        sampleLane === null ? null : guardVerdictAt(lanes, sampleLane.key, sampleStart, railInputFor(minutes, strict))
      // ⚖ 9/1 (fix round 1 F4) — the key is the SEAM'S, so the room has one
      // spelling of 「which scene do these dials ask for」 and the OFF store's
      // answer (there is no scene) is decided in the same place.
      scenes[sceneKeyFor(strict ? 'STRICT' : 'STANDARD', minutes)!] = { capacity, cell }
    }
  }

  /** The confirm surface's own ✓/× rows for that landing, from the FROZEN engine
   *  (`computeChecks`, drag-rules) — the same producer the board's own hold bar
   *  runs, handed the same lane's spans. The warn card folds the passing ones
   *  into its 「…は問題ありません」 line; a room that hand-wrote those four
   *  sentences would be a second author for the engine's own words. */
  const sampleBox = sampleLane === null ? { x: 0, w: 0 } : place(sampleStart, sampleStart + dur, hours)
  const sampleChecks =
    sampleLane === null
      ? []
      : computeChecks(sampleBox, {
          spans: sampleLane.items.map(
            (i): CheckSpan => ({ id: i.caseId ?? i.key, x: i.x, w: i.w, title: i.title, derived: i.kind === 'cleanup', parked: false }),
          ),
          // The landing is a HYPOTHETICAL, so it excludes no card of its own —
          // every span on the lane is a real obstacle to it.
          bookingId: '',
          staffName: sampleLane.label,
          staffUntil: sampleLane.untilLabel,
          laneLocked: false,
          minutesOf: (x) => minuteOf(x, hours),
        })

  /** ⚖ WHO COUNTS AS 「スタッフ」 FOR THE PREVIEW, read off the store's own data
   *  rather than spelled here (⚠SETTINGS-BATCH's law, the same one
   *  `canReleaseHeld` obeys). A role the override dial admits but the
   *  manager-level list does not is, by this data model's own definition, not a
   *  manager — so it is the role the スタッフ preview stands in. No such role =
   *  a store whose every role is manager-level, and the preview then shows the
   *  operator's own role in both seats, honestly. */
  const managerRoles = planes.opsConfig.releaseHeldRoles
  const sampleStaffRole =
    planes.opsConfig.overridePolicy.roles.find((r) => !managerRoles.includes(r)) ?? shell.operator.role

  /** ⚖ THE TWO WIRE FIELDS, THROUGH THE SEAM. Everything else on this screen is
   *  read straight off `opsConfig`; these two are read through
   *  `liveFieldsFrom` in core's own field spellings, so the day the fixture is
   *  replaced by `StorePolicyClient.get(storeId)` the change is one function
   *  body and no reader below moves. */
  const live = liveFieldsFrom({
    gapGuardMode: planes.opsConfig.gapGuardMode,
    newClientSessionMinutes: planes.opsConfig.newClientSessionMin,
  })

  /** ⚖ THE HQ SAVE GATE, from the ROLES HOME and never from a literal. The store
   *  names its own manager-level people once (`releaseHeldRoles` — the same list
   *  売上分析's `viewRoles` and 人件費's `laborCostRoles` are drawn from, and the
   *  one ⚠SETTINGS-BATCH pins as DATA), so a store that names a different set
   *  changes its settings and not this file. Decided HERE, once, like every other
   *  authority in this family: the screen is handed the ANSWER, never the rule,
   *  so an operator is never shown a control they would only be refused for. */
  const refusal = saveRefusal(managerRoles, shell.operator.role)

  const props: StorePolicyProps = {
    // ⚖ VIEW STATE IS STORE-SCOPED (the 売上・レジ precedent): `?store=`
    // navigation keeps the same screen instance, so a preset chosen against one
    // store's dials would still be pressed over another store's. The key resets
    // it, which is what a shop expects when it changes whose rules it is looking
    // at.
    storeKey: storeId ?? 'all',
    storeLabel: clamped ? (storeOptions.find((s) => s.id === storeId)?.name ?? 'この店舗') : 'すべての店舗',
    policy: {
      overrideRoles: [...planes.opsConfig.overridePolicy.roles],
      managerRoles: [...managerRoles],
      lockedOut: [...planes.opsConfig.overridePolicy.lockedOut],
      // ⚖ 9/1 (fix round 1 F4) — THE WHOLE ENUM CROSSES, never a boolean. `strict:
      // mode === 'STRICT'` collapsed OFF into STANDARD at the very seam this room
      // exists to build: an off store would have opened on a dial claiming it was
      // running standard warnings, and a save built off that dial would have
      // turned the guard ON without anyone pressing anything.
      mode: live.gap_guard_mode,
      holdToConfirm: planes.opsConfig.overrideHoldToConfirm,
      newClientMinutes: live.new_client_session_minutes,
      heldRankAccess: planes.opsConfig.heldRankAccess,
      // すき間の販売 — the store's own 販売可能な最小の長さ is what turns it off:
      // above zero the board advertises the leftovers, at zero it does not
      // (⚖ Liam 8/21, `minSellableMin`). The dial is the sentence, the number is
      // the data behind it.
      gapSelling: planes.opsConfig.minSellableMin > 0,
      bookingStepMin: planes.opsConfig.bookingStepMin,
    },
    scenes,
    sample:
      sampleLane === null
        ? null
        : {
            laneKey: sampleLane.key,
            laneLabel: sampleLane.label,
            summary: `見本の予約 → ${hhmm(sampleStart)}〜${hhmm(sampleStart + dur)} / 担当 ${sampleLane.label}`,
            rows: sampleChecks.map((c) => ({ label: c.label, tone: c.ok ? ('' as const) : ('bad' as const) })),
            confirmEnabled: confirmCaption(sampleChecks).enabled,
            listPrice: sampleLane.listPrice,
            // The board's own opening levers (TodayScreen's initial `appliedPrice`:
            // 最高価格 = HQ's ceiling, 最低価格 = the base), so the card's ¥ comes
            // off the same frame the board prices its own windows with.
            frame: {
              hi: planes.pricingRule.hq_max,
              lo: planes.pricingRule.base,
              hqMin: planes.pricingRule.hq_min,
              hqMax: planes.pricingRule.hq_max,
            } satisfies PriceFrame,
            depth: Math.round((1 - planes.pricingRule.base / planes.pricingRule.hq_max) * 100),
          },
    operator: { name: shell.operator.name, role: shell.operator.role, staff_id: shell.operator.staff_id },
    sampleStaffRole,
    roster: staff.map((s) => ({ id: s.id, name: s.full_name })),
    save: { refusal, roles: [...managerRoles] },
  }

  return props
}

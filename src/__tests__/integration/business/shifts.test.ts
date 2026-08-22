/**
 * スタッフ・シフト — the transplanted room's pins.
 *
 * THE ONE THING THIS SUITE IS FOR: this board and 今日の運営 describe the same
 * people on the same day, so every claim they share has to be the SAME claim.
 * A shift board that says 見本 はなこ works until 19:00 over a board that has
 * her stopping at 13:00 is worse than no shift board at all. Most assertions
 * here are therefore EQUALITIES BETWEEN SURFACES, not spot-checks.
 *
 * Second job: the room holds no impossible state (⚖ 8/9) on ANY real date —
 * every fixture here is relative (⚖ L-6), so the pins run at pinned clocks
 * months apart and a rest day is never a day its owner is already booked into.
 *
 * Third job: the boundaries — 人件費 and 希望休 approval by role, the store
 * isolation law on every list, and the refusal invariant on both staged paths.
 *
 * NOTE ON RENDER SMOKES: react-dom is deliberately OFF territory's import
 * allowlist (business-isolation.test.ts), so a section is smoke-tested by
 * asserting the props the screen is handed for it — the technique the other
 * three business suites use. The pixels are proven by the deployed
 * real-browser pass in the room's evidence folder.
 */

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
// The door is passed through untouched; ONE reader is wrapped so the
// role-boundary pin can hand the page a different persona for one render.
// jest.spyOn cannot redefine an ES module namespace property, and the boundary
// is the whole point of the section — it does not get to be argued away.
jest.mock('@/business/lib/data', () => {
  const actual = jest.requireActual('@/business/lib/data')
  return { ...actual, readShellIdentity: jest.fn(actual.readShellIdentity) }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { jstDayKey } from '@/business/lib/clock'
import { readShellIdentity } from '@/business/lib/data'
import { appointments, operator, staff, STORE_A, STORE_B } from '@/business/lib/fixtures'
import { hourlyWage, leaveRequests, shiftsPolicy } from '@/business/lib/fixtures-shifts'
import { absence, closedWeekday, shifts, staffQualifications } from '@/business/lib/fixtures-today'
import {
  MONTH_OFFSETS,
  absenceImpact,
  bookedKeysOf,
  bookingCount,
  buildRoster,
  cellFor,
  conflictsOn,
  dayKeyOf,
  editKey,
  hours,
  laborCost,
  minuteOfDay,
  mondayOf,
  monthCoords,
  resolveLeaveRequests,
  restWeekday,
  seatOf,
  weekCoords,
  weekOffsetBounds,
  ymdOf,
  type DayContext,
  type RosterMember,
} from '@/business/lib/shifts'
import { availableMinutes, dayTotals, effectiveShift, hhmm } from '@/business/lib/today-board'
import ShiftsPage from '@/app/[locale]/(business)/business/shifts/page'
import { ShiftsScreen, type ShiftsProps } from '@/app/[locale]/(business)/business/shifts/ShiftsScreen'
import TodayPage from '@/app/[locale]/(business)/business/today/page'
import { TodayScreen, type TodayProps } from '@/app/[locale]/(business)/business/today/TodayScreen'

const service = createServiceClient as jest.Mock
const supabase = createClient as jest.Mock

function serviceStub(fallback: unknown, byTable: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (r: unknown): any => ({
    select: () => chain(r),
    eq: () => chain(r),
    maybeSingle: async () => r,
  })
  return { from: (table: string) => chain(table in byTable ? byTable[table] : fallback) }
}

/** The props a page hands its screen — the page returns an element tree and no
 *  renderer is available in territory (see the header). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function propsOf<T>(node: any, screen: unknown): T | null {
  if (!node || typeof node !== 'object') return null
  if (node.type === screen) return node.props as T
  const kids = node.props?.children
  for (const kid of Array.isArray(kids) ? kids.flat() : [kids]) {
    const hit = propsOf<T>(kid, screen)
    if (hit) return hit
  }
  return null
}

const room = async (q: { store?: string; view?: string; week?: string; ym?: string } = {}) =>
  propsOf<ShiftsProps>(
    await ShiftsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve(q) }),
    ShiftsScreen,
  )!

const board = async (store?: string) =>
  propsOf<TodayProps>(
    await TodayPage({
      params: Promise.resolve({ locale: 'ja' }),
      searchParams: Promise.resolve(store ? { store } : {}),
    }),
    TodayScreen,
  )!

/** Pin the render clock. Only the zero-argument construction is faked; the
 *  calendar arithmetic needs real `new Date(iso)` AND the statics (`Date.UTC`
 *  builds every coordinate in shifts.ts), so they are carried across — a stub
 *  without them fails inside the code under test rather than proving anything
 *  about it. */
const RealDate = Date
function pin(iso: string): () => void {
  const at = new RealDate(iso)
  const stub = function (this: unknown, ...args: unknown[]) {
    return args.length === 0 ? new RealDate(at) : new RealDate(...(args as [string]))
  } as unknown as DateConstructor
  stub.UTC = RealDate.UTC
  stub.parse = RealDate.parse
  stub.now = () => at.getTime()
  globalThis.Date = stub
  return () => {
    globalThis.Date = RealDate
  }
}

const SRC = readFileSync(
  join(process.cwd(), 'src/app/[locale]/(business)/business/shifts/ShiftsScreen.tsx'),
  'utf8',
)
const CSS = readFileSync(
  join(process.cwd(), 'src/app/[locale]/(business)/business/shifts/shifts.css'),
  'utf8',
)
const LAYOUT = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/layout.tsx'), 'utf8')

const todayKeyNow = () => jstDayKey(new Date())
const numberOf = (s: string) => Number(s.replace(/[^0-9-]/g, ''))

/** The context the page builds, rebuilt here so the pure functions can be
 *  driven directly without a render. */
function contextFor(roster: RosterMember[], todayKey: number, withAbsence = true): DayContext {
  const byDay = new Map<number, ReturnType<typeof appointments>>()
  for (const a of appointments()) {
    const key = jstDayKey(a.starts_at)
    byDay.set(key, [...(byDay.get(key) ?? []), a])
  }
  const leaves = resolveLeaveRequests(leaveRequests, roster, todayKey, byDay, closedWeekday)
  const bookedKeys = new Set<string>()
  for (const [dayKey, rows] of byDay) {
    for (const a of rows) {
      if (a.staff_id && a.status !== 'cancelled') bookedKeys.add(editKey(a.staff_id, dayKey))
    }
  }
  return {
    closedWd: closedWeekday,
    todayKey,
    absence: withAbsence ? absence : null,
    leaveKeys: new Set(leaves.map((l) => editKey(l.staffId, l.dayKey))),
    bookedKeys,
    shiftEdits: new Map(),
    leaveAnswers: new Map(),
  }
}

function rosterFor(todayKey: number, ids: string[] = staff.map((s) => s.id)): RosterMember[] {
  return buildRoster(
    staff.filter((s) => ids.includes(s.id)),
    shifts,
    staffQualifications,
    hourlyWage,
    closedWeekday,
    todayKey,
  )
}

beforeEach(() => {
  supabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'o@x.jp' } }, error: null }) },
  })
  service.mockReturnValue(
    serviceStub(
      { data: null, error: null },
      {
        business_workspace_grants: { data: { workspace_id: 'business_admin', granted_by: 'u1' }, error: null },
        profiles: { data: { customer_id: 'biz-1', is_management: false }, error: null },
      },
    ),
  )
})

// ── 1. the plane holds no impossible state (⚖ 8/9) ──────────────────────────

describe('the shift plane is operationally possible', () => {
  it('every wage belongs to somebody who actually has a shift, and nobody is priced at zero', () => {
    const scheduled = new Set(shifts.map((s) => s.staff_id))
    for (const [id, wage] of Object.entries(hourlyWage)) {
      expect(scheduled.has(id)).toBe(true)
      expect(wage).toBeGreaterThan(0)
    }
    // 見本 みらい is 受付・会計 with no shift row in the board's plane. Giving
    // her a wage here would price hours nobody scheduled.
    expect(hourlyWage['p-09']).toBeUndefined()
  })

  it('a day its owner is the assigned 担当 is NEVER drawn as a rest day (⚖ 8/9)', () => {
    // The impossible state this room could produce: a blank cell over a booking
    // the person has to be there for. A booking beats the weekly rota, on every
    // date — the fixture calendar is relative, so a weekday that is free today
    // is booked on some other real date.
    for (const iso of ['2026-08-22T06:00:00Z', '2026-11-03T22:00:00Z', '2027-02-27T01:00:00Z']) {
      const restore = pin(iso)
      try {
        const todayKey = todayKeyNow()
        const roster = rosterFor(todayKey)
        const ctx = contextFor(roster, todayKey)
        let checked = 0
        for (const a of appointments()) {
          if (!a.staff_id || a.status === 'cancelled') continue
          const member = roster.find((m) => m.id === a.staff_id)
          if (!member || !member.shift) continue
          const day = jstDayKey(a.starts_at)
          if (ymdOf(day).wd === closedWeekday) continue // its own conflict, named separately
          expect(cellFor(member, day, ctx).kind).not.toBe('rest')
          checked += 1
        }
        expect(checked).toBeGreaterThan(10)
      } finally {
        restore()
      }
    }
  })

  it('nobody rests on the 定休日 or on today — the board opposite has them all working', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const todayWd = ymdOf(todayKey).wd
      for (const m of rosterFor(todayKey)) {
        if (m.restWd === null) continue
        expect(m.restWd).not.toBe(closedWeekday)
        expect(m.restWd).not.toBe(todayWd)
      }
    } finally {
      restore()
    }
  })

  it('the rest day is real: everyone who works is off exactly one weekday, and they spread out', () => {
    // A guard against the derivation quietly returning nothing, which would make
    // the pins around it vacuously true.
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const roster = rosterFor(todayKeyNow()).filter((m) => m.shift)
      expect(roster.length).toBeGreaterThan(0)
      expect(roster.every((m) => m.restWd !== null)).toBe(true)
      // Not everyone on the same day — a store with nobody in it is not a rota.
      expect(new Set(roster.map((m) => m.restWd)).size).toBeGreaterThan(1)
    } finally {
      restore()
    }
  })

  it('the rest day depends on the PERSON, never on the viewer', () => {
    // seatOf is the whole reason 見本 ごろう has one day off rather than one per
    // store: it reads the id, which no lens can change.
    expect(seatOf('p-05')).toBe(seatOf('p-05'))
    expect(seatOf('p-05')).not.toBe(seatOf('c-03'))
    expect(restWeekday(seatOf('p-05'), 1, 6)).toBe(restWeekday(seatOf('p-05'), 1, 6))
    // and it never lands on the closed day or on today
    for (const id of ['p-01', 'p-02', 'c-03', 'p-04', 'p-05', 'p-06']) {
      for (let closed = 0; closed < 7; closed += 1) {
        for (let today = 0; today < 7; today += 1) {
          if (closed === today) continue
          const wd = restWeekday(seatOf(id), closed, today)
          expect(wd).not.toBe(closed)
          expect(wd).not.toBe(today)
        }
      }
    }
  })

  it('a 希望休 is never filed on a 定休日 or on its own requester’s day off', () => {
    for (const iso of ['2026-08-22T06:00:00Z', '2026-12-31T20:00:00Z']) {
      const restore = pin(iso)
      try {
        const todayKey = todayKeyNow()
        const roster = rosterFor(todayKey)
        const byDay = new Map<number, ReturnType<typeof appointments>>()
        for (const a of appointments()) {
          const key = jstDayKey(a.starts_at)
          byDay.set(key, [...(byDay.get(key) ?? []), a])
        }
        const resolved = resolveLeaveRequests(leaveRequests, roster, todayKey, byDay, closedWeekday)
        expect(resolved).toHaveLength(leaveRequests.length)
        for (const l of resolved) {
          const member = roster.find((m) => m.id === l.staffId)!
          expect(ymdOf(l.dayKey).wd).not.toBe(closedWeekday)
          expect(ymdOf(l.dayKey).wd).not.toBe(member.restWd)
          expect(l.dayKey).toBeGreaterThan(todayKey)
        }
      } finally {
        restore()
      }
    }
  })

  it('exactly one 希望休 is the DELIBERATE conflict, and it really conflicts', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey)
      const byDay = new Map<number, ReturnType<typeof appointments>>()
      for (const a of appointments()) {
        const key = jstDayKey(a.starts_at)
        byDay.set(key, [...(byDay.get(key) ?? []), a])
      }
      const resolved = resolveLeaveRequests(leaveRequests, roster, todayKey, byDay, closedWeekday)
      const clashing = resolved.filter((l) => l.conflicts.length > 0)
      expect(clashing).toHaveLength(1)
      expect(clashing[0].staffId).toBe('p-04')
      // and the clean one really is clean
      expect(resolved.filter((l) => l.conflicts.length === 0)).toHaveLength(1)
    } finally {
      restore()
    }
  })
})

// ── 2. ONE FIXTURE WORLD — today is the board's today ───────────────────────

describe('today on this board IS today on 今日の運営', () => {
  it('every cell for today is the BOARD’s own shift row, cut by the BOARD’s own absence rule', async () => {
    const props = await room({ store: STORE_A })
    const todayKey = props.plane.todayKey
    const today = props.plane.days.find((d) => d.dayKey === todayKey)
    // A week that does not hold today proves nothing — the default view opens
    // on the current week, so this must be there.
    expect(today).toBeDefined()
    const roster = props.plane.roster as unknown as RosterMember[]
    const ctx: DayContext = {
      closedWd: props.plane.closedWd,
      todayKey,
      absence: props.plane.absence,
      leaveKeys: new Set(props.plane.leaves.map((l) => editKey(l.staffId, l.dayKey))),
      bookedKeys: bookedKeysOf(props.plane.days),
      shiftEdits: new Map(),
      leaveAnswers: new Map(),
    }
    let checked = 0
    for (const row of shifts) {
      const member = roster.find((m) => m.id === row.staff_id)
      if (!member) continue // another store's person — isolation, covered below
      const cell = cellFor(member, todayKey, ctx)
      const expected = effectiveShift(row, absence)
      expect({ id: row.staff_id, start: cell.start, end: cell.end }).toEqual({
        id: row.staff_id,
        start: expected.start,
        end: expected.end,
      })
      checked += 1
    }
    // Non-empty guard: an empty roster would satisfy the loop above silently.
    expect(checked).toBeGreaterThanOrEqual(4)
  })

  it('the absent staff member’s cell stops exactly where the board stops her', async () => {
    const props = await room({ store: STORE_A })
    const roster = props.plane.roster as unknown as RosterMember[]
    const her = roster.find((m) => m.id === absence.staff_id)!
    const ctx: DayContext = {
      closedWd: props.plane.closedWd,
      todayKey: props.plane.todayKey,
      absence: props.plane.absence,
      leaveKeys: new Set(),
      bookedKeys: bookedKeysOf(props.plane.days),
      shiftEdits: new Map(),
      leaveAnswers: new Map(),
    }
    const cell = cellFor(her, props.plane.todayKey, ctx)
    expect(cell.kind).toBe('partial')
    expect(cell.end).toBe(absence.from)
    expect(cell.afterFrom).toBe(absence.from)
    // and a day that is NOT today keeps her whole shift — the absence is one day
    const other = cellFor(her, props.plane.todayKey + 7, ctx)
    if (other.kind === 'work') expect(other.end).toBe(her.shift!.end)
  })

  it('today’s 予約件数 equals the board’s own 本日の予約件数, to the booking', async () => {
    const [shiftsProps, todayProps] = await Promise.all([room({ store: STORE_A }), board(STORE_A)])
    const today = shiftsProps.plane.days.find((d) => d.dayKey === shiftsProps.plane.todayKey)!
    expect(today.bookings).toBe(numberOf(todayProps.kpi.count))
    expect(today.bookings).toBeGreaterThan(0)
  })

  it('欠勤影響 and 未確定 equal the board’s own incident counts', async () => {
    const [shiftsProps, todayProps] = await Promise.all([room({ store: STORE_A }), board(STORE_A)])
    expect(todayProps.incident).not.toBeNull()
    expect(shiftsProps.incident).not.toBeNull()
    const affected = shiftsProps.incident!.stats.find((s) => s.label === '影響予約')!
    const undecided = shiftsProps.incident!.stats.find((s) => s.label === '未確定')!
    expect(affected.value).toBe(todayProps.incident!.affected)
    expect(numberOf(undecided.value)).toBe(todayProps.incident!.undecided)
    // Non-vacuous: the incident really has something to count.
    expect(numberOf(affected.value)).toBeGreaterThan(0)
  })

  it('the incident is ONE object — the panel, the banner and the dialog cannot disagree', () => {
    // Structural, because the three surfaces are in three places: they all read
    // props.incident and the screen holds no second copy.
    expect(SRC).not.toMatch(/props\.week\.incident/)
    expect(SRC.match(/props\.incident/g)!.length).toBeGreaterThanOrEqual(4)
  })

  it('the 未確定 figure has ONE home: the strip, the panel head and the stat agree', async () => {
    const props = await room({ store: STORE_A })
    const undecided = props.incident!.stats.find((s) => s.label === '未確定')!.value
    expect(props.week!.openIssueLabel).toBe(undecided)
    // canon prints 2件 in the summary over a panel head that says 1件 未確定;
    // both of ours are the same call.
    expect(props.week!.rows.filter((r) => r.statusTone === 'danger')).toHaveLength(numberOf(undecided))
  })

  it('absenceImpact counts only OPEN decisions that point at the absent person’s bookings', () => {
    const rows = [
      { appointment_id: 'a', state: 'open' },
      { appointment_id: 'b', state: 'open' },
      { appointment_id: 'c', state: 'open' },
      { appointment_id: 'd', state: 'resolved' },
      { appointment_id: null, state: 'open' },
    ]
    const hers = new Set(['a', 'b', 'd'])
    const held = new Set(['a'])
    expect(absenceImpact(rows, (id) => hers.has(id), (id) => held.has(id))).toEqual({
      affected: 2,
      withCandidate: 1,
      undecided: 1,
    })
  })
})

// ── 3. store isolation, both directions (⚖ 8/17) ────────────────────────────

describe('the store isolation law binds every list on this board', () => {
  it('a branch lens names ONLY its own store’s people', async () => {
    const ginza = await room({ store: STORE_A })
    const daikanyama = await room({ store: STORE_B })
    const namesA = ginza.plane.roster.map((m) => m.name)
    const namesB = daikanyama.plane.roster.map((m) => m.name)
    // 見本 はなこ works 銀座 only; 見本 たろう works 代官山 only.
    expect(namesA).toContain('見本 はなこ')
    expect(namesA).not.toContain('見本 たろう')
    expect(namesB).toContain('見本 たろう')
    expect(namesB).not.toContain('見本 はなこ')
    // Neither board mentions the other store at all.
    expect(JSON.stringify(daikanyama.plane)).not.toContain('見本 はなこ')
    expect(JSON.stringify(ginza.plane)).not.toContain('見本 たろう')
  })

  it('the 勤務不可 belongs to its own store — 代官山 has no incident to show', async () => {
    const daikanyama = await room({ store: STORE_B })
    expect(daikanyama.plane.absence).toBeNull()
    expect(daikanyama.incident).toBeNull()
    expect(daikanyama.head.impactChip).toBe('欠勤影響 0件')
    expect(daikanyama.week!.rows).toHaveLength(0)
  })

  it('a shared person’s rest day is the SAME day in both stores', async () => {
    // 見本 ごろう and テスト さぶろう work both stores. One person, one day off:
    // two boards answering differently would be two truths about one roster.
    const ginza = await room({ store: STORE_A })
    const daikanyama = await room({ store: STORE_B })
    for (const id of ['p-05', 'c-03']) {
      const a = ginza.plane.roster.find((m) => m.id === id)
      const b = daikanyama.plane.roster.find((m) => m.id === id)
      expect(a).toBeDefined()
      expect(b).toBeDefined()
      expect(a!.restWd).toBe(b!.restWd)
    }
  })

  it('the roster clamp is what lands a staged edit — not a store stamp (⚖ 46)', async () => {
    // One person has one shift on one day. A stamp let two boards state
    // different hours for the SAME person (見本 ごろう and テスト さぶろう work
    // both stores) and let ONE 希望休 be answered twice, possibly two ways.
    // The gate is the roster: a person a lens cannot see has no cell at all.
    const ginza = await room({ store: STORE_A })
    const daikanyama = await room({ store: STORE_B })
    const shared = ['p-05', 'c-03']
    for (const id of shared) {
      expect(ginza.plane.roster.some((m) => m.id === id)).toBe(true)
      expect(daikanyama.plane.roster.some((m) => m.id === id)).toBe(true)
    }
    // 見本 はなこ is 銀座-only, so an edit of hers can never reach 代官山.
    expect(daikanyama.plane.roster.some((m) => m.id === 'p-01')).toBe(false)
    // The screen reads the session lists whole; nothing filters them by store.
    expect(SRC).not.toContain('editsHere(')
    expect(SRC).toContain('shiftEdits.map((e) => [editKey(e.staffId, e.dayKey), e])')
    // …and the record itself no longer carries a store to filter on.
    const lib = readFileSync(join(process.cwd(), 'src/business/lib/shifts.ts'), 'utf8')
    const staged = lib.slice(lib.indexOf('export interface StagedShift'), lib.indexOf('export interface StagedLeave'))
    expect(staged).not.toContain('store:')
  })
})

// ── 4. the role boundary ────────────────────────────────────────────────────

describe('人件費 and 希望休 approval are answers the server resolved', () => {
  it('the logged-in 店舗管理者 sees the labour estimate', async () => {
    const props = await room({ store: STORE_A, view: 'month' })
    expect(shiftsPolicy.laborCostRoles).toContain(operator.role)
    expect(props.month!.laborCost).not.toBeNull()
    expect(props.plane.roster.some((m) => m.wage !== null)).toBe(true)
  })

  it('a viewer without the right is never SENT a wage — not hidden, absent', async () => {
    const real = await (readShellIdentity as unknown as jest.Mock).getMockImplementation()!()
    ;(readShellIdentity as unknown as jest.Mock).mockResolvedValueOnce({
      ...real,
      operator: { ...real.operator, role: 'スタッフ' },
    })
    try {
      const props = await room({ store: STORE_A, view: 'month' })
      expect(props.month!.laborCost).toBeNull()
      // The wage never reaches the client at all.
      expect(props.plane.roster.every((m) => m.wage === null)).toBe(true)
      expect(JSON.stringify(props)).not.toContain('1600')
      // And the approval right goes with it, stated rather than silently gone.
      expect(props.month!.mayApproveLeave).toBe(false)
      expect(props.month!.leaveStripNote).toContain('店舗管理者')
    } finally {
      ;(readShellIdentity as unknown as jest.Mock).mockReset()
      const actual = jest.requireActual('@/business/lib/data')
      ;(readShellIdentity as unknown as jest.Mock).mockImplementation(actual.readShellIdentity)
    }
  })

  it('no client component holds a role name', () => {
    for (const role of ['オーナー', '店舗管理者', 'スタッフ']) {
      // The strip's explanatory SENTENCE is server-composed; the screen must not
      // decide anything from a role literal of its own.
      expect(SRC).not.toContain(`=== '${role}'`)
      expect(SRC).not.toContain(`includes('${role}')`)
    }
  })

  it('the labour estimate is the same minutes the grid draws, priced', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey, ['p-01', 'p-04'])
      const ctx = contextFor(roster, todayKey)
      const days = monthCoords(todayKey, 0).days
      const cells = days.flatMap((d) =>
        roster.map((m) => ({ staffId: m.id, workedMinutes: cellFor(m, d, ctx).workedMinutes })),
      )
      const cost = laborCost(cells, roster)
      const byHand = cells.reduce((n, c) => {
        const m = roster.find((r) => r.id === c.staffId)!
        return n + (c.workedMinutes / 60) * (m.wage ?? 0)
      }, 0)
      expect(cost.yen).toBe(Math.round(byHand))
      expect(cost.yen).toBeGreaterThan(0)
      expect(cost.missingRate).toEqual([])
    } finally {
      restore()
    }
  })

  it('a person with no rate is NAMED, never silently costed at zero', () => {
    const roster: RosterMember[] = [
      { id: 'x', name: '見本 ゆう', shift: shifts[0], restWd: null, wage: null, qualifications: [] },
    ]
    const out = laborCost([{ staffId: 'x', workedMinutes: 480 }], roster)
    expect(out.yen).toBe(0)
    expect(out.missingRate).toEqual(['見本 ゆう'])
  })

  it('人件費 does not invent a 売上ペース比 it has no takings for', async () => {
    const props = await room({ store: STORE_A, view: 'month' })
    expect(props.month!.laborCost!.paceNote).toContain('売上分析')
    expect(props.month!.laborCost!.note).toContain('休憩を除く')
  })
})

// ── 5. the cells, and what the session stages over them ─────────────────────

describe('one cell, one precedence — and a staged edit that survives a page flip', () => {
  const at = (m: RosterMember, dayKey: number, ctx: DayContext) => cellFor(m, dayKey, ctx)

  it('定休日 beats everything, and nothing can be scheduled on it', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey, ['p-04'])
      const ctx = contextFor(roster, todayKey)
      // the next 定休日 from today
      const closed = [...Array(8).keys()].map((i) => todayKey + i).find((k) => ymdOf(k).wd === closedWeekday)!
      const cell = at(roster[0], closed, ctx)
      expect(cell.kind).toBe('closed')
      expect(cell.workedMinutes).toBe(0)
      // even with an edit staged on it, the store is still shut
      ctx.shiftEdits.set(editKey('p-04', closed), {
        staffId: 'p-04', dayKey: closed, kind: 'work', start: 600, end: 1140,
      })
      expect(at(roster[0], closed, ctx).kind).toBe('closed')
    } finally {
      restore()
    }
  })

  it('a person with no shift row renders 勤務予定なし, never a blank nobody explains', async () => {
    const props = await room({ store: STORE_A })
    const mirai = props.plane.roster.find((m) => m.id === 'p-09')!
    expect(mirai.shift).toBeNull()
    expect(mirai.patternLabel).toBe('勤務予定なし')
  })

  it('a staged edit changes the cell, its worked minutes and nothing else', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey, ['p-04'])
      const ctx = contextFor(roster, todayKey)
      const day = todayKey + 7
      const before = at(roster[0], day, ctx)
      ctx.shiftEdits.set(editKey('p-04', day), {
        staffId: 'p-04', dayKey: day, kind: 'work', start: 11 * 60, end: 15 * 60,
      })
      const after = at(roster[0], day, ctx)
      expect(after.staged).toBe(true)
      expect(after.start).toBe(11 * 60)
      expect(after.workedMinutes).toBe(4 * 60)
      expect(after.workedMinutes).not.toBe(before.workedMinutes)
      // the day BEFORE it is untouched
      expect(at(roster[0], day - 1, ctx).staged).toBe(false)
    } finally {
      restore()
    }
  })

  it('a PENDING 希望休 still costs its hours — the roster stands until answered', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey)
      const ctx = contextFor(roster, todayKey)
      const key = [...ctx.leaveKeys][0]
      const [staffId, dayKeyText] = key.split('@')
      const dayKey = Number(dayKeyText)
      const member = roster.find((m) => m.id === staffId)!
      const pending = cellFor(member, dayKey, ctx)
      expect(pending.kind).toBe('leave-pending')
      expect(pending.workedMinutes).toBe(availableMinutes(member.shift!))
      // …and APPROVING it is what drops them, which is the whole point of the
      // control: a pending request costed at zero makes the answer a dead lever.
      ctx.leaveAnswers.set(key, { staffId, dayKey, answer: 'approved' })
      const approved = cellFor(member, dayKey, ctx)
      expect(approved.kind).toBe('rest')
      expect(approved.workedMinutes).toBe(0)
      expect(approved.answered).toBe('approved')
      // Rejecting keeps them.
      ctx.leaveAnswers.set(key, { staffId, dayKey, answer: 'rejected' })
      expect(cellFor(member, dayKey, ctx).workedMinutes).toBe(availableMinutes(member.shift!))
    } finally {
      restore()
    }
  })

  it('the week board SAYS 休み rather than leaving a blank nobody can read', () => {
    // M10 discipline: the plain rest day and the STAGED one print the same
    // markup, so asserting the string alone stays true when the plain branch is
    // deleted. The whole function is read instead — it may return no blanks.
    const body = SRC.slice(SRC.indexOf('function weekCell('), SRC.indexOf('function monthCell('))
    expect(body).not.toContain('return null')
    expect((body.match(/shift rest/g) ?? []).length).toBe(3) // 未設定 · staged 休み · 休み
    expect(SRC).toContain('勤務予定なし</span></div>')
    // and the week legend names the colour it uses for it
    expect(SRC).toContain('<span className="rest"><i /> 休み</span>')
    expect(CSS).toContain('.biz .pg-shifts .legend.week .rest i')
  })

  it('the week legend paints 欠勤・休暇 the colour the CELL wears (canon: red)', () => {
    // Canon scopes its month grey to #monthView; one shared rule painted the
    // week swatch grey over a red cell — a legend lying about its own board.
    expect(CSS).toContain('.biz .pg-shifts .legend.week .off i { background: var(--red-soft)')
    expect(CSS).toContain('.biz .pg-shifts .legend.month .off i { background: #f4f4f5')
    expect(CSS).toContain('.biz .pg-shifts .shift.off { border-color: #e6a09a; background: var(--red-soft)')
  })

  it('the period picker REMOUNTS when the view flips', () => {
    // One slot, two input types. Reusing the node makes a single commit change
    // both `type` and `value`, and the browser warns 「2026-08 is not
    // yyyy-MM-dd」 — a console message on the route, which the room may not have.
    const picker = SRC.slice(SRC.indexOf('function PeriodPicker('))
    expect(picker).toContain('key={picker.kind}')
    expect(picker.indexOf('key={picker.kind}')).toBeLessThan(picker.indexOf('type={picker.kind}'))
  })

  it('every form field carries a name (no browser autofill issue)', () => {
    // Comment-stripped so a long note above an attribute cannot push it out of
    // the window, and windowed so the NEXT input's name cannot satisfy this one.
    const chunks = SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('<input').slice(1)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    for (const c of chunks) expect(c.slice(0, 200)).toMatch(/name=/)
  })

  it('休みにする stages a rest day with zero worked minutes', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey, ['p-04'])
      const ctx = contextFor(roster, todayKey)
      const day = todayKey + 8
      ctx.shiftEdits.set(editKey('p-04', day), {
        staffId: 'p-04', dayKey: day, kind: 'off', start: 0, end: 0,
      })
      const cell = at(roster[0], day, ctx)
      expect(cell.kind).toBe('rest')
      expect(cell.workedMinutes).toBe(0)
      expect(cell.staged).toBe(true)
    } finally {
      restore()
    }
  })

  it('the staged edits live ABOVE the screen, so a ?view= / ?week= flip cannot wipe them', () => {
    // The remount is real (both are Links), so this is pinned structurally: the
    // screen declares none of it and reads it from the layout's provider.
    expect(SRC).not.toMatch(/const \[shiftEdits, set/)
    expect(SRC).not.toMatch(/const \[leaveAnswers, set/)
    expect(SRC).toContain('} = useShiftEdits()')
    expect(LAYOUT).toContain('import { ShiftsSessionEdits } from')
    expect(LAYOUT).toMatch(/<ShiftsSessionEdits>\{children\}<\/ShiftsSessionEdits>/)
    const provider = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/ShiftsSessionEdits.tsx'),
      'utf8',
    )
    for (const name of ['shiftEdits', 'leaveAnswers']) expect(provider).toContain(`const [${name}, set`)
    expect(provider).not.toContain("'react-dom'")
  })

  it('the period navigation is a real LINK, not client state', () => {
    expect(SRC).toContain('href={props.toggle.weekHref}')
    expect(SRC).toContain('href={props.toggle.monthHref}')
    expect(SRC).not.toMatch(/const \[view, setView\]/)
  })
})

// ── 6. the two refusals ─────────────────────────────────────────────────────

describe('a refusal changes nothing and stays readable', () => {
  it('a 希望休 whose owner is already the 担当 that day is REFUSED with the reason', async () => {
    const props = await room({ store: STORE_A, view: 'month' })
    const refused = props.plane.leaves.filter((l) => l.refusal !== null)
    expect(refused).toHaveLength(1)
    expect(refused[0].refusal).toContain('担当')
    expect(refused[0].refusal).toContain('予約一覧')
    // The clean one carries no refusal, so the pin is not just "always refuse".
    expect(props.plane.leaves.filter((l) => l.refusal === null)).toHaveLength(1)
  })

  it('the refused approval is a reachable, explained control — never a silent no-op', () => {
    // aria-disabled (focusable, reason on the control), not the `disabled`
    // attribute a keyboard cannot reach.
    expect(SRC).toContain('l.refusal ? (')
    expect(SRC).toMatch(/aria-disabled="true" title=\{l\.refusal\}/)
    // 却下 stays available on a refused row: the manager can still answer.
    expect(SRC).toContain("answerLeave(l, 'rejected')")
  })

  it('a shift edit that would strand a booking refuses, keeps the typed values and stays on screen', () => {
    // Structural, because it is a DOM interaction: the handler sets a refusal
    // and returns BEFORE staging anything, and the refusal renders as a block
    // inside the dialog rather than a toast that flashes past (⚖ 47).
    const save = SRC.slice(SRC.indexOf('function saveCell()'), SRC.indexOf('function offCell()'))
    expect(save).toContain('setRefusal(clash)')
    expect(save.indexOf('setRefusal(clash)')).toBeLessThan(save.indexOf('setShiftEdits'))
    expect(save).toMatch(/if \(clash\) \{[\s\S]*return/)
    expect(SRC).toContain('{refusal && <div className="dialog-block" role="alert">{refusal}</div>}')
  })

  it('休みにする refuses the same way when the day holds a booking', () => {
    const off = SRC.slice(SRC.indexOf('function offCell()'), SRC.indexOf('function answerLeave('))
    expect(off).toContain('setRefusal(')
    expect(off.indexOf('setRefusal(')).toBeLessThan(off.indexOf('setShiftEdits'))
  })

  it('the refusal names the booking it is protecting', async () => {
    const props = await room({ store: STORE_A, view: 'month' })
    // Every day carries the per-person booking list the dialog needs, so the
    // refusal can name the customer rather than saying "there is a conflict".
    const withBooking = props.plane.days.find((d) => Object.values(d.bookedBy).some((v) => v.length > 0))
    expect(withBooking).toBeDefined()
    const sample = Object.values(withBooking!.bookedBy).flat()[0]
    expect(sample.label).toMatch(/様$/)
    expect(sample.startMinute).toBeGreaterThan(0)
  })

  it('answering the last open 希望休 dismisses the surface (⚖ 41)', () => {
    expect(SRC).toContain('if (pendingLeaves.length <= 1) leaveRef.current?.close()')
    // An answered row keeps its outcome and loses its buttons.
    expect(SRC).toContain('{answer === null && (')
    expect(SRC).toContain('承認済み（この画面の中だけ休みに変更）')
  })
})

// ── 7. navigation: every arrow acts or refuses out loud ─────────────────────

describe('the period navigation', () => {
  it('opens on the current week, canon’s own default view', async () => {
    const props = await room({ store: STORE_A })
    expect(props.view).toBe('week')
    expect(props.plane.days).toHaveLength(7)
    expect(props.plane.days.some((d) => d.isToday)).toBe(true)
  })

  it('the month view draws the whole month and names it', async () => {
    const props = await room({ store: STORE_A, view: 'month' })
    const todayKey = props.plane.todayKey
    expect(props.plane.days).toHaveLength(monthCoords(todayKey, 0).days.length)
    expect(props.period.label).toBe(`${ymdOf(todayKey).y}年${ymdOf(todayKey).m}月`)
  })

  it('stops at the window edges with the reason ON the control', async () => {
    const props = await room({ store: STORE_A, view: 'month' })
    const todayKey = props.plane.todayKey
    const last = monthCoords(todayKey, MONTH_OFFSETS[MONTH_OFFSETS.length - 1])
    const far = await room({ store: STORE_A, view: 'month', ym: `${last.y}-${String(last.m).padStart(2, '0')}` })
    expect(far.period.next.href).toBeNull()
    expect(far.period.next.title).toContain('表示できません')
    expect(far.period.prev.href).not.toBeNull()
    // …and the middle of the window can step both ways
    expect(props.period.prev.href).not.toBeNull()
    expect(props.period.next.href).not.toBeNull()
  })

  it('a month beyond the window clamps to the edge rather than erroring', async () => {
    const props = await room({ store: STORE_A, view: 'month', ym: '2031-01' })
    const todayKey = props.plane.todayKey
    const last = monthCoords(todayKey, 1)
    expect(props.period.label).toBe(`${last.y}年${last.m}月`)
    const early = await room({ store: STORE_A, view: 'month', ym: '2001-01' })
    const first = monthCoords(early.plane.todayKey, -1)
    expect(early.period.label).toBe(`${first.y}年${first.m}月`)
  })

  it('junk in the URL falls back to the current period, never an error', async () => {
    for (const q of [{ ym: 'banana' }, { week: '99-99-99' }, { week: '2026-13-40' }, { view: 'sideways' }]) {
      const props = await room({ store: STORE_A, ...q })
      expect(props.plane.days.length).toBeGreaterThan(0)
    }
    const junkView = await room({ store: STORE_A, view: 'sideways' })
    expect(junkView.view).toBe('week')
  })

  it('a date anywhere in a week selects that WHOLE week, Monday first', async () => {
    const props = await room({ store: STORE_A })
    const todayKey = props.plane.todayKey
    const wednesday = mondayOf(todayKey) + 2 + 7
    const p = ymdOf(wednesday)
    const target = await room({
      store: STORE_A,
      week: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`,
    })
    expect(target.plane.days[0].dayKey).toBe(mondayOf(wednesday))
    expect(ymdOf(target.plane.days[0].dayKey).wd).toBe(1)
  })

  it('the picker and the arrows write the SAME parameter, so they cannot disagree', async () => {
    const props = await room({ store: STORE_A })
    expect(props.period.picker.param).toBe('week')
    expect(props.period.prev.href).toContain('week=')
    expect(props.period.picker.value).toBe(
      (() => {
        const p = ymdOf(props.plane.days[0].dayKey)
        return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
      })(),
    )
    const monthProps = await room({ store: STORE_A, view: 'month' })
    expect(monthProps.period.picker.param).toBe('ym')
    expect(monthProps.period.prev.href).toContain('ym=')
  })

  it('the toggle carries the store and the other view’s period with it', async () => {
    const props = await room({ store: STORE_A, view: 'week' })
    expect(props.toggle.monthHref).toContain(`store=${encodeURIComponent(STORE_A)}`)
    expect(props.toggle.monthHref).toContain('view=month')
    expect(props.toggle.monthHref).toContain('week=')
    expect(props.toggle.weekHref).toContain('ym=')
  })

  it('the week window covers exactly the month window', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const bounds = weekOffsetBounds(todayKey)
      const first = monthCoords(todayKey, MONTH_OFFSETS[0]).days[0]
      const lastDays = monthCoords(todayKey, 1).days
      expect(weekCoords(todayKey, bounds.min)[0]).toBe(mondayOf(first))
      expect(weekCoords(todayKey, bounds.max)[0]).toBe(mondayOf(lastDays[lastDays.length - 1]))
      expect(bounds.min).toBeLessThan(0)
      expect(bounds.max).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })
})

// ── 8. every control does something, or refuses out loud ────────────────────

describe('no dead levers', () => {
  it('パターン and 別月のシフトをコピー ship refused, with their reason, not as toasts', async () => {
    const props = await room({ store: STORE_A, view: 'month' })
    expect(props.refusedActions).toHaveLength(2)
    for (const a of props.refusedActions) expect(a.title).toContain('見本データ')
    expect(SRC).toContain('aria-disabled="true" title={a.title}')
  })

  it('the 確認する button refuses once every request has been answered', () => {
    expect(SRC).toContain("title={pendingLeaves.length === 0 ? 'この画面で答えた希望休はすべて記録済みです'")
    expect(SRC).toContain('if (pendingLeaves.length === 0) return')
  })

  it('the topbar action exists only when there is an absence to read', () => {
    expect(SRC).toContain("useTopbarAction(props.incident ? '欠勤内容を確認' : '', openAbsence)")
    const topbar = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/BusinessTopbar.tsx'), 'utf8')
    expect(topbar).toContain('if (!label) {')
  })

  it('a 定休日 cell is not a control at all', () => {
    expect(SRC).toContain('d.closed ? (')
    expect(SRC).toContain('className="cell-quiet"')
  })

  it('the inspector action states the board’s own answer instead of pretending', async () => {
    const props = await room({ store: STORE_A })
    for (const r of props.week!.rows) {
      expect(r.action === '安全な候補がありません' || r.action.includes('仮押さえ済み')).toBe(true)
    }
    expect(SRC).toContain('disabled title="担当の確定は予約一覧で行います"')
  })
})

// ── 9. the coverage warning, on its deliberate fixture ──────────────────────

describe('bookings that do not fit their shift are named', () => {
  it('a booking running past its 担当’s shift is flagged 勤務時間外', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey)
      const ctx = contextFor(roster, todayKey)
      // apt-30 is 見本 しろう at 17:30–18:30 tomorrow; his shift ends 18:00, and
      // the fixture says so out loud ("exactly why a person has to look at it").
      const apt = appointments().find((a) => a.id === 'apt-30')!
      const day = jstDayKey(apt.starts_at)
      const found = conflictsOn(day, [apt], roster, ctx)
      expect(found).toHaveLength(1)
      expect(found[0].reason).toBe('勤務時間外')
      expect(found[0].staffName).toBe('見本 しろう')
    } finally {
      restore()
    }
  })

  it('a booking inside its 担当’s shift is NOT flagged', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey)
      const ctx = contextFor(roster, todayKey)
      const apt = appointments().find((a) => a.id === 'apt-12')!
      expect(conflictsOn(jstDayKey(apt.starts_at), [apt], roster, ctx)).toHaveLength(0)
    } finally {
      restore()
    }
  })

  it('today’s post-absence booking is flagged — the same one the board keeps off her lane', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey)
      const ctx = contextFor(roster, todayKey)
      const apt = appointments().find((a) => a.id === 'apt-27')!
      const found = conflictsOn(todayKey, [apt], roster, ctx)
      expect(found).toHaveLength(1)
      expect(found[0].reason).toBe('勤務時間外')
    } finally {
      restore()
    }
  })

  it('a booking on a 定休日 is named rather than drawn as a normal day', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey)
      const ctx = contextFor(roster, todayKey)
      const closed = [...Array(8).keys()].map((i) => todayKey + i).find((k) => ymdOf(k).wd === closedWeekday)!
      const apt = { ...appointments()[0], id: 'synthetic', staff_id: 'p-04' }
      const found = conflictsOn(closed, [apt], roster, ctx)
      expect(found).toHaveLength(1)
      expect(found[0].reason).toBe('定休日')
    } finally {
      restore()
    }
  })

  it('a cancelled booking is not a coverage problem', () => {
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      const roster = rosterFor(todayKey)
      const ctx = contextFor(roster, todayKey)
      const apt = { ...appointments().find((a) => a.id === 'apt-30')!, status: 'cancelled' as const }
      expect(conflictsOn(jstDayKey(apt.starts_at), [apt], roster, ctx)).toHaveLength(0)
    } finally {
      restore()
    }
  })
})

// ── 10. data states ─────────────────────────────────────────────────────────

describe('every data state renders sanely', () => {
  it('a week with no incident says so instead of showing an empty panel', async () => {
    const props = await room({ store: STORE_B })
    expect(props.week!.rows).toHaveLength(0)
    expect(props.week!.emptyRecovery.title).toContain('ありません')
  })

  it('the room is populated at pinned clocks months apart (⚖ L-6)', async () => {
    for (const iso of ['2026-08-22T06:00:00Z', '2026-09-30T20:00:00Z', '2027-02-28T15:00:00Z']) {
      const restore = pin(iso)
      try {
        const props = await room({ store: STORE_A, view: 'month' })
        expect(props.plane.days.length).toBeGreaterThanOrEqual(28)
        expect(props.plane.roster.filter((m) => m.shift).length).toBeGreaterThanOrEqual(4)
        // Somebody is working on a normal day — the board is never blank.
        const open = props.plane.days.find((d) => !d.closed)!
        expect(open).toBeDefined()
      } finally {
        restore()
      }
    }
  })

  it('a leap-year February is drawn whole', () => {
    const restore = pin('2028-02-14T06:00:00Z')
    try {
      expect(monthCoords(todayKeyNow(), 0).days).toHaveLength(29)
    } finally {
      restore()
    }
  })

  it('the calendar coordinates survive the JST/UTC boundary', () => {
    // 2026-08-22T15:30Z is already 00:30 JST on the 23rd.
    expect(ymdOf(jstDayKey(new Date('2026-08-22T15:30:00Z')))).toEqual({ y: 2026, m: 8, d: 23, wd: 0 })
    expect(ymdOf(jstDayKey(new Date('2026-08-22T14:30:00Z')))).toEqual({ y: 2026, m: 8, d: 22, wd: 6 })
    expect(dayKeyOf(2026, 8, 22)).toBe(jstDayKey(new Date('2026-08-22T06:00:00Z')))
  })

  it('a month boundary crossing a year still names its own year', () => {
    const restore = pin('2026-12-15T06:00:00Z')
    try {
      const todayKey = todayKeyNow()
      expect(monthCoords(todayKey, 1)).toMatchObject({ y: 2027, m: 1 })
      expect(monthCoords(todayKey, -1)).toMatchObject({ y: 2026, m: 11 })
    } finally {
      restore()
    }
  })

  it('hours prints canon’s own shape', () => {
    expect(hours(480)).toBe('8時間')
    expect(hours(450)).toBe('7.5時間')
    expect(hours(0)).toBe('0時間')
  })

  it('worked minutes exclude the break, and the week summary splits the two', async () => {
    const props = await room({ store: STORE_A })
    const roster = props.plane.roster as unknown as RosterMember[]
    const withBreak = roster.find((m) => m.shift && m.shift.breaks.length > 0)!
    const cell = cellFor(withBreak, props.plane.days.find((d) => !d.closed)!.dayKey, {
      closedWd: props.plane.closedWd,
      todayKey: props.plane.todayKey,
      absence: null,
      leaveKeys: new Set(),
      bookedKeys: new Set(),
      shiftEdits: new Map(),
      leaveAnswers: new Map(),
    })
    if (cell.kind === 'work') {
      expect(cell.workedMinutes).toBe(availableMinutes(withBreak.shift!))
      expect(cell.workedMinutes).toBeLessThan(cell.spanMinutes)
    }
  })

  it('a day’s booking count uses the BOARD’s own rule, cancelled rows excluded', () => {
    // M10 discipline: comparing today's rows against the same predicate is true
    // for two reasons (today happens to hold no cancelled row), so the rule is
    // driven directly with one of each.
    const live = appointments().find((a) => a.id === 'apt-12')!
    const cancelled = appointments().find((a) => a.status === 'cancelled')!
    expect(cancelled).toBeDefined()
    expect(bookingCount([live, cancelled])).toBe(1)
    expect(bookingCount([live])).toBe(1)
    expect(bookingCount([cancelled])).toBe(0)
    // …and it really is the board's own function, not a second rule.
    const rows = appointments().filter((a) => jstDayKey(a.starts_at) === jstDayKey(new Date()))
    expect(bookingCount(rows)).toBe(dayTotals(rows, 0).count)
  })
})

// ── 11. the sheet cannot reach another room ─────────────────────────────────

describe('shifts.css is scoped from day one (room 1’s D-C)', () => {
  it('EVERY rule sits under .pg-shifts — no bare .panel, .page or dialog', () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors: string[] = []
    for (const block of stripped.split('}')) {
      const head = block.split('{')[0].trim()
      if (!head || head.startsWith('@')) continue
      for (const one of head.split(',')) {
        const sel = one.trim()
        if (sel) selectors.push(sel)
      }
    }
    expect(selectors.length).toBeGreaterThan(60)
    const offenders = selectors.filter((s) => !s.startsWith('.biz .pg-shifts') && !s.startsWith('.biz .page.pg-shifts'))
    expect(offenders).toEqual([])
  })

  it('exactly one node carries the route class', () => {
    expect(SRC).toContain("const ROOT = 'page pg-shifts'")
    expect(SRC.match(/pg-shifts/g)!.length).toBe(1)
    expect(SRC.match(/className=\{ROOT\}/g)!.length).toBe(1)
  })

  it('the root rule outranks a neighbour room’s bare .biz .page', () => {
    // Same specificity would leave it to sheet order, which is the half of
    // room 1’s D-C that a room CAN fix from inside itself.
    expect(CSS).toContain('.biz .page.pg-shifts {')
    expect(CSS).not.toMatch(/^\.biz \.pg-shifts \{/m)
  })

  it('the native dialog gets its centering back (⚖ 32)', () => {
    const dialogRule = CSS.slice(CSS.indexOf('.biz .pg-shifts dialog {'))
    expect(dialogRule.slice(0, dialogRule.indexOf('}'))).toContain('margin: auto')
  })

  it('the room adds no token to the shared shell sheet', () => {
    const shell = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business-shell.css'),
      'utf8',
    )
    for (const token of ['--red-hatch', '--blue-row', '--red-row']) {
      expect(shell).not.toContain(token)
      expect(CSS).toContain(token)
    }
  })
})

// ── 12. the engine is untouched ─────────────────────────────────────────────

describe('the room borrows the board, and touches nothing it borrows', () => {
  it('shifts.ts reads the board’s own predicates rather than restating them', () => {
    const lib = readFileSync(join(process.cwd(), 'src/business/lib/shifts.ts'), 'utf8')
    expect(lib).toContain("from './today-board'")
    expect(lib).toContain('effectiveShift')
    expect(lib).toContain('availableMinutes')
    expect(lib).toContain('dayTotals')
    // and it holds no clock of its own
    expect(lib).not.toMatch(/new Date\(\)/)
  })

  it('the page reads the clock exactly once', () => {
    const page = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/shifts/page.tsx'),
      'utf8',
    )
    expect(page.match(/renderNow\(\)/g)!.length).toBe(1)
    expect(page).not.toMatch(/new Date\(\)/)
  })

  it('the screen holds no clock and no data access', () => {
    expect(SRC).not.toMatch(/new Date\(/)
    expect(SRC).not.toContain('@/business/lib/data')
    expect(SRC).not.toContain('@/business/lib/fixtures-shifts')
  })

  it('minuteOfDay agrees with the board’s own reading of the same instant', () => {
    const apt = appointments().find((a) => a.id === 'apt-12')!
    expect(hhmm(minuteOfDay(apt.starts_at))).toBe('10:00')
  })
})

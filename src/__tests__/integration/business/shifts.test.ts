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
const LIB = readFileSync(join(process.cwd(), 'src/business/lib/shifts.ts'), 'utf8')
const PAGE_SRC = readFileSync(
  join(process.cwd(), 'src/app/[locale]/(business)/business/shifts/page.tsx'),
  'utf8',
)

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

  it('⚖ D-11 = A — ONE PERSON, ONE ANSWER, and the cell says so under both lenses', () => {
    // ⚖ LIAM 8/22, ruling A locked: an answer given under one store lens is
    // THE answer under the other, for a person both stores share. The browser
    // scene proved it across a real store switch; this drives the same claim
    // end to end through the derivation both boards run.
    const restore = pin('2026-08-22T04:00:00.000Z')
    try {
      const todayKey = todayKeyNow()
      // 見本 ごろう (p-05) is on BOTH rosters; 見本 はなこ (p-01) is 銀座-only.
      const ginza = rosterFor(todayKey, ['p-01', 'p-05'])
      const daikanyama = rosterFor(todayKey, ['p-05'])
      const shared = ginza.find((m) => m.id === 'p-05')!
      const alsoShared = daikanyama.find((m) => m.id === 'p-05')!
      const day = todayKey + 4
      const ctx = contextFor(ginza, todayKey)
      // The answer is given ONCE, in the session both lenses read.
      ctx.shiftEdits.set(editKey('p-05', day), {
        staffId: 'p-05', dayKey: day, kind: 'work', start: 12 * 60, end: 16 * 60,
      })
      const underGinza = cellFor(shared, day, ctx)
      const underDaikanyama = cellFor(alsoShared, day, ctx)
      expect(underGinza).toEqual(underDaikanyama)
      expect(underGinza.start).toBe(12 * 60)
      expect(underGinza.end).toBe(16 * 60)
      expect(underGinza.staged).toBe(true)
      // NOT true for two reasons: the SAME session also holds an edit for a
      // person 代官山 cannot see, and the roster clamp is what keeps it out —
      // she simply has no cell there, so nothing had to filter by store.
      ctx.shiftEdits.set(editKey('p-01', day), {
        staffId: 'p-01', dayKey: day, kind: 'work', start: 9 * 60, end: 11 * 60,
      })
      expect(cellFor(ginza.find((m) => m.id === 'p-01')!, day, ctx).start).toBe(9 * 60)
      expect(daikanyama.some((m) => m.id === 'p-01')).toBe(false)
      // and the shared person's answer did not move when the other one landed
      expect(cellFor(alsoShared, day, ctx)).toEqual(underGinza)
    } finally {
      restore()
    }
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
    const body = SRC.slice(SRC.indexOf('function WeekCell('), SRC.indexOf('function monthCell('))
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
    const restore = pin('2026-08-22T06:00:00Z')
    try {
      const props = await room({ store: STORE_A, view: 'month' })
      const refused = props.plane.leaves.filter((l) => l.refusal !== null)
      expect(refused).toHaveLength(1)
      expect(refused[0].refusal).toContain('担当')
      expect(refused[0].refusal).toContain('予約一覧')
      // The clean one carries no refusal, so the pin is not just "always refuse".
      expect(props.plane.leaves.filter((l) => l.refusal === null)).toHaveLength(1)
    } finally {
      restore()
    }
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
    // `stageShift` is the ONE staging seam a shift edit writes through; the
    // refusal has to beat it to the punch.
    expect(save.indexOf('setRefusal(clash)')).toBeLessThan(save.indexOf('stageShift('))
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

  it('a date the calendar does not HAVE takes that same fallback', async () => {
    // The one junk a range test cannot see. `dayKeyOf` is `Date.UTC`, which
    // normalises rather than refuses: 2026-02-31 is well formed, month 2 and
    // day 31 are both in range, and it came back as March 3rd — so the room
    // answered with a week nobody asked for while the documented fallback
    // never fired. Only the round trip separates 2/31 from 3/31.
    for (const week of [
      '2026-02-31', // the report's own case
      '2026-02-29', // 2026 is not a leap year
      '2026-04-31', // April has 30
      '2026-13-01', // month 13 rolls into next January
      '2026-00-10', // month 0 rolls into last December
      '2026-01-00', // day 0 rolls into last December
      '0026-05-01', // Date.UTC(26, …) is 1926
    ]) {
      const props = await room({ store: STORE_A, week })
      expect(props.plane.days[0].dayKey).toBe(mondayOf(props.plane.todayKey))
    }
  })

  it('…and a real leap day is still a real date', async () => {
    // The other half of the round trip: it must refuse only what the calendar
    // refuses. 2028-02-29 exists, so the week board opens on ITS week (Monday
    // the 28th), not on the fallback.
    const restore = pin('2028-02-14T06:00:00Z')
    try {
      const props = await room({ store: STORE_A, week: '2028-02-29' })
      expect(props.plane.days[0].dayKey).toBe(mondayOf(dayKeyOf(2028, 2, 29)))
      expect(props.plane.days[0].dayKey).not.toBe(mondayOf(props.plane.todayKey))
      expect(props.plane.days.map((d) => ymdOf(d.dayKey).d)).toContain(29)
    } finally {
      restore()
    }
  })

  it('?ym= has no twin of that hole — its one component is range-checked', async () => {
    // The month is the only thing `?ym=` carries and nothing normalises it, so
    // 2026-13 falls back the way `banana` does rather than becoming 2027-01.
    for (const ym of ['2026-13', '2026-00']) {
      const props = await room({ store: STORE_A, view: 'month', ym })
      const here = ymdOf(props.plane.todayKey)
      expect(props.period.label).toBe(`${here.y}年${here.m}月`)
    }
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

  it('and the room is fenced against the NEIGHBOURS’ bare rules coming the other way', () => {
    // Scoping is one-way. today.css states `.biz .inspector { display: none }`
    // for its own drawer and App Router leaves that sheet in the document, so
    // the week board's whole 候補の確認 aside vanished on a soft navigation from
    // 今日の運営 while rendering perfectly on a hard load. The fence states this
    // room's own value for every property a sibling declares on a shared name.
    for (const stated of [
      '.biz .page.pg-shifts .inspector { display: block; margin: 0; max-height: none;',
      '.biz .page.pg-shifts .summary { background: transparent; }',
      '.biz .page.pg-shifts .summary-main { border-left: 0; }',
      '.biz .page.pg-shifts .toast { opacity: 1; transform: none; transition: none; pointer-events: auto; }',
      '.biz .page.pg-shifts .inspector-actions { grid-template-columns: none; }',
    ]) {
      expect(CSS).toContain(stated)
    }
    // FOUR levels, not three: a sibling's `.biz .toast.show` is three too, and
    // a tie is decided by whichever sheet was inserted last.
    const fence = CSS.slice(CSS.indexOf('.biz .page.pg-shifts .inspector {'))
    expect(fence.slice(0, fence.indexOf('/* ── page head'))).not.toMatch(/^\.biz \.pg-shifts /m)
    // The narrow layout too — all three siblings narrow `.biz .page` in their
    // own 1320 block, and 顧客's is 20px where this room's is 18.
    expect(CSS).toContain('.biz .page.pg-shifts { padding-left: 18px; padding-right: 18px; }')
  })

  it('the one-way accent law, as this room adjudicated it', () => {
    // The law has no sound automated gate (CLAUDE.md: pressability is
    // semantic), so the enforceable half is a class contract. THE LIST IS THE
    // ADJUDICATION: a bare accent TEXT colour on any other selector has to be
    // argued in here rather than slipped in, and the three the batched
    // Greptile round neutralised (.qualification, .inspector-kicker,
    // .booking-mark) are absent because they are neutral now.
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const wearing: string[] = []
    for (const block of stripped.split('}')) {
      const head = block.split('{')[0].trim()
      const body = block.slice(block.indexOf('{') + 1)
      if (!head || head.startsWith('@') || !block.includes('{')) continue
      if (/(^|;)\s*color:\s*(var\(--indigo\)|#3f5be8)/i.test(body)) {
        wearing.push(...head.split(',').map((s) => s.trim()))
      }
    }
    expect(wearing.sort()).toEqual([
      '.biz .pg-shifts .cell-note.staged', // state marker — semantic tier
      '.biz .pg-shifts .chip.context', // accent text on an accent WASH
      '.biz .pg-shifts .status.info', // ditto
      '.biz .pg-shifts .today-head', // 本日 — the board's temporal anchor
      '.biz .pg-shifts .today-tag', // ditto, wash chip
      '.biz .pg-shifts .toggle-seg.active', // R13 selected state of a control
    ])
    // Neutralised, and pinned so they stay that way.
    expect(CSS).toContain('.biz .pg-shifts .inspector-kicker { color: var(--muted);')
    expect(CSS).toContain('.biz .pg-shifts .booking-mark { display: block; margin-top: 3px; color: var(--muted);')
    // The badge's accent was already dead: it is a <span> inside .staff-cell,
    // and `.staff-cell span` outranks it (three classes AND a tag), so --muted
    // is what the browser has always painted. Both rules are pinned together,
    // because the fix is that they now AGREE.
    const badge = CSS.slice(CSS.indexOf('.biz .pg-shifts .qualification {'))
    expect(badge.slice(0, badge.indexOf('}'))).toContain('color: var(--muted)')
    expect(CSS).toContain('.biz .pg-shifts .staff-cell span { display: block; margin-top: 3px; color: var(--muted);')
    // KEPT, and pinned too: 土 blue / 日 red is the Japanese calendar's own
    // weekday semantics, the same tier as red-destructive — not decoration.
    expect(CSS).toContain('.biz .pg-shifts .row-sat .day-label { color: #33449b; }')
    expect(CSS).toContain('.biz .pg-shifts .row-sun .day-label { color: var(--red-dark); }')
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

// ── 13. E-2 · the boards hold ANY roster size ───────────────────────────────
//
// ⚖ LIAM 8/22: 「20〜30人、店舗によって違う。どの規模でも構造的に成り立つこと」.
// The DEMO WORLD STAYS SIX PEOPLE — the roster below is built here, in the
// test, and never reaches the fixtures.

describe('E-2 · the boards scale to any roster size', () => {
  /** A synthetic store of `n` people, all with real shifts, wages and one
   *  qualification. Test-local by construction: nothing here is exported and
   *  nothing writes to `fixtures-*` — the demo world stays six people.
   *
   *  THE WAGES AND THE BREAK ARE DELIBERATELY AWKWARD. A roster of round hours
   *  on a round wage prices every cell to a whole yen, and a total that rounds
   *  ONCE and a total that rounds every cell agree — which would make the
   *  exactness pin below true for a reason that has nothing to do with the
   *  arithmetic it is guarding (M33 survived exactly that, first run). A
   *  45-minute break and a 130-yen wage ladder put a half-yen on most cells. */
  function syntheticRoster(n: number, todayKey: number): RosterMember[] {
    const people = Array.from({ length: n }, (_, i) => ({
      id: `syn-${String(i).padStart(2, '0')}`,
      full_name: `合成 ${i}`,
    }))
    const rows = people.map((p, i) => ({
      staff_id: p.id,
      start: (9 + (i % 3)) * 60,
      end: (17 + (i % 3)) * 60,
      breaks: [{ start: 13 * 60, end: 13 * 60 + 45 }],
    }))
    return buildRoster(
      people as unknown as typeof staff,
      rows,
      Object.fromEntries(people.map((p) => [p.id, ['整体']])),
      Object.fromEntries(people.map((p, i) => [p.id, 1500 + (i % 7) * 130])),
      closedWeekday,
      todayKey,
    )
  }

  /** The screen's own commit work, run outside React: every cell of the period
   *  through `cellFor`, then `laborCost` over the lot. This is the half that
   *  grows with the roster.
   *
   *  `exact` and `perCell` are the SAME money added up two ways — rounded once
   *  at the end, and rounded at every cell. They differ by construction on this
   *  roster, which is what lets the pin below say which one the code does. */
  function monthPass(roster: RosterMember[], days: number[], ctx: DayContext) {
    const wage = new Map(roster.map((m) => [m.id, m.wage]))
    let cells = 0
    let worked = 0
    let exact = 0
    let perCell = 0
    const priced: Array<{ staffId: string; workedMinutes: number }> = []
    for (const dayKey of days) {
      for (const m of roster) {
        const cell = cellFor(m, dayKey, ctx)
        cells += 1
        worked += cell.workedMinutes
        const yen = (cell.workedMinutes / 60) * (wage.get(m.id) ?? 0)
        exact += yen
        perCell += Math.floor(yen)
        priced.push({ staffId: m.id, workedMinutes: cell.workedMinutes })
      }
    }
    return { cells, worked, exact, perCell, cost: laborCost(priced, roster) }
  }

  it('28 people over a whole month is exact arithmetic, not an approximation', () => {
    const restore = pin('2026-08-22T04:00:00.000Z')
    try {
      const todayKey = todayKeyNow()
      const roster = syntheticRoster(28, todayKey)
      const month = monthCoords(todayKey, 0)
      const ctx: DayContext = {
        closedWd: closedWeekday,
        todayKey,
        absence: null,
        leaveKeys: new Set(),
        bookedKeys: new Set(),
        shiftEdits: new Map(),
        leaveAnswers: new Map(),
      }
      const pass = monthPass(roster, month.days, ctx)
      // Every person × every day of August 2026 — one cell each, no more.
      expect(month.days).toHaveLength(31)
      expect(pass.cells).toBe(28 * 31)
      // The month costs what its 868 cells cost, rounded ONCE, to the yen.
      expect(pass.cost.yen).toBe(Math.round(pass.exact))
      expect(pass.cost.missingRate).toEqual([])
      // NOT true for two reasons: on this roster the same money rounded at
      // every cell lands somewhere else, so the pin can tell the two apart.
      expect(pass.perCell).not.toBe(Math.round(pass.exact))
      // and the number is real: nobody is costed at zero and nobody is dropped.
      expect(pass.worked).toBeGreaterThan(0)
      expect(pass.cost.yen).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })

  it('the pricing pass builds its index ONCE — no quadratic hiding in the join', () => {
    // A timing ratio is not a pin: it passed a real O(n²) `laborCost` on this
    // box, because the quadratic half was small next to the rest. So COUNT the
    // work instead. `laborCost` indexes the roster by id; reading that id
    // through a counter says exactly how many times the index was built —
    // once for a linear pass, once per cell for a quadratic one.
    const restore = pin('2026-08-22T04:00:00.000Z')
    try {
      const todayKey = todayKeyNow()
      const roster = syntheticRoster(28, todayKey)
      const month = monthCoords(todayKey, 0).days
      const ctx: DayContext = {
        closedWd: closedWeekday, todayKey, absence: null,
        leaveKeys: new Set(), bookedKeys: new Set(),
        shiftEdits: new Map(), leaveAnswers: new Map(),
      }
      const pass = monthPass(roster, month, ctx)
      const priced = month.flatMap((dayKey) =>
        roster.map((m) => ({ staffId: m.id, workedMinutes: cellFor(m, dayKey, ctx).workedMinutes })),
      )
      expect(priced).toHaveLength(28 * 31)

      let idReads = 0
      const counted = roster.map((m) => {
        const o = { ...m }
        Object.defineProperty(o, 'id', { get: () => { idReads += 1; return m.id }, enumerable: true })
        return o as RosterMember
      })
      const cost = laborCost(priced, counted)
      // ONE index for 868 cells. A per-cell rebuild reads it 868 × 28 times.
      expect(idReads).toBe(28)
      // NOT true for two reasons: a pass that read nothing because it priced
      // nothing would also read the id once per person and then stop, so the
      // money has to be the same money the honest pass produced.
      expect(cost.yen).toBe(pass.cost.yen)
      expect(cost.yen).toBe(Math.round(pass.exact))
    } finally {
      restore()
    }
  })

  it('the WEEK board pans sideways only — the PAGE owns the vertical scroll', () => {
    // ⚖ Liam 8/22 (page-scroll flag): a capped wrap made a nested vertical
    // scroller that trapped the wheel mid-screen. The wrap pans horizontally
    // and nothing else — the ABSENCE is the pin, so the trap cannot return.
    expect(CSS).toContain('.biz .pg-shifts .week-wrap { overflow-x: auto; }')
    const wrap = CSS.slice(CSS.indexOf('.biz .pg-shifts .week-wrap {'))
    const wrapRule = wrap.slice(0, wrap.indexOf('}'))
    expect(wrapRule).not.toContain('max-height')
    expect(wrapRule).not.toContain('overscroll-behavior')
    const th = CSS.slice(CSS.indexOf('.biz .pg-shifts .week-table th {'))
    const thRule = th.slice(0, th.indexOf('}'))
    // No sticky-TOP: a sticky-top th would bind to the WRAP (which is a scroll
    // container on both axes) rather than to the page the operator scrolls.
    expect(thRule).not.toContain('top:')
    // …and no sticky at all on a header cell with no inset, where it is inert.
    // The LEFT freeze lives on the FROZEN cell: it works against the horizontal
    // pan, which is the axis the wrap still owns, so WHO a row is stays on
    // screen while panning.
    expect(thRule).not.toContain('position:')
    expect(CSS).toContain('.biz .pg-shifts .week-table th:first-child { width: 180px; position: sticky; left: 0;')
    expect(CSS).toContain('.biz .pg-shifts .staff-cell { position: sticky; left: 0;')
  })

  it('the MONTH board keeps its dates frozen while the operator pans', () => {
    expect(CSS).toContain('.biz .pg-shifts .month-wrap { overflow-x: auto; }')
    const wrap = CSS.slice(CSS.indexOf('.biz .pg-shifts .month-wrap {'))
    const wrapRule = wrap.slice(0, wrap.indexOf('}'))
    expect(wrapRule).not.toContain('max-height')
    expect(wrapRule).not.toContain('overscroll-behavior')
    const th = CSS.slice(CSS.indexOf('.biz .pg-shifts .month-table th {'))
    const thRule = th.slice(0, th.indexOf('}'))
    expect(thRule).not.toContain('top:')
    // Sticky is stated on the two FROZEN header cells, not on every th — on a
    // header cell with no inset it does nothing but add a stacking context.
    expect(thRule).not.toContain('position:')
    expect(CSS).toContain('.biz .pg-shifts .month-table th:nth-child(1) { position: sticky; left: 0;')
    // ⚖ Liam 8/22 — THE FROZEN PAIR IS COUPLED. 予約 starts where 日付 ends, so
    // its sticky offset IS the 日付 column's width; a literal there is the pair
    // coming apart the first time a divider moves. Header and body both.
    expect(CSS).toContain('.biz .pg-shifts .month-table th:nth-child(2) { position: sticky; left: var(--date-w);')
    expect(CSS).toContain('.biz .pg-shifts .month-table .booking-cell { position: sticky; z-index: 1;')
    expect(CSS).toContain('.biz .pg-shifts .month-table .booking-cell { left: var(--date-w); }')
    // NOT true for a reason: the old hard-coded offset is gone from the sheet
    // entirely, so it cannot come back as a "harmless" second copy.
    expect(CSS).not.toContain('left: 148px')
    // The frozen cells carry the ROW's colour, or a Saturday would turn white
    // as it passed under them.
    for (const row of ['row-sat', 'row-sun', 'row-closed', 'row-today']) {
      expect(CSS).toContain(`.biz .pg-shifts .${row} .day-label, .biz .pg-shifts .${row} .booking-cell`)
    }
    // and the today rail rides the frozen cell, not the row behind it
    expect(CSS).toContain('tbody tr.row-today .day-label { box-shadow: inset 3px 0 0 var(--indigo); }')
    expect(CSS).not.toContain('tbody tr.row-today { background: var(--proof); box-shadow')
  })

  it('the month table’s WIDTH is a function of the roster, not a fixed number', () => {
    // A fixed min-width divided among 30 columns squashes every one of them —
    // the exact failure this item exists to remove. ⚖ Liam 8/22: and it is a
    // function of the THREE COLUMN WIDTHS too, so a dragged 日付 widens the
    // board rather than stealing the room from the staff columns.
    expect(CSS).toContain(
      'min-width: max(860px, calc(var(--date-w) + var(--booking-w) + var(--cols, 6) * var(--staff-w)));',
    )
    expect(SRC).toContain("'--cols': String(plane.roster.length)")
  })

  it('the sticky columns need SEPARATED borders, and the grid is unchanged', () => {
    // Collapsed borders belong to the table, not the cell: a frozen column
    // would travel and leave its edge behind. Every cell states its own.
    expect(CSS).toContain('.biz .pg-shifts .week-table { width: 100%; min-width: 930px; border-collapse: separate; border-spacing: 0;')
    expect(CSS).toContain('border-collapse: separate; border-spacing: 0; table-layout: fixed;')
    expect(CSS).not.toContain('border-collapse: collapse; table-layout: fixed')
  })

  it('the scrollers are the room’s own — the page body never scrolls sideways', () => {
    // The gate law. Both boards pan INSIDE their wrap, and no rule in this
    // sheet ever puts an overflow on the room's root.
    const root = CSS.slice(CSS.indexOf('.biz .page.pg-shifts {'))
    expect(root.slice(0, root.indexOf('}'))).not.toContain('overflow')
    expect((CSS.match(/-wrap \{ overflow-x: auto; \}/g) ?? []).length).toBe(2)
    // ⚖ Liam 8/22: and SIDEWAYS is all they own. Neither board may re-grow a
    // nested vertical scroller — that is what trapped the wheel mid-screen.
    expect(CSS).not.toContain('overflow: auto; max-height:')
    expect(CSS).not.toContain('overscroll-behavior: contain')
  })
})

// ── 14. ⚖ Liam 8/22 · the month board's columns ─────────────────────────────
//
// His words at the live review, over his own screenshots: the shift-time edge
// drag was 「an unnecessary stupid function」 and went; what he asked for was
// 「the 日付 and 予約 columns are far wider than their tiny content」 — tighter
// defaults so more staff fit on one screen, and the COLUMN BORDER LINES
// draggable so he can set the widths himself, with the frozen pair still frozen
// at whatever width he lands on.

describe('⚖ the shift-time edge drag is GONE — the dialog is the one editor', () => {
  it('no handle, no gesture, no geometry left in the screen', () => {
    for (const dead of [
      'EdgeDrag', 'dragRef', 'paintEdge', 'endEdgeDrag', 'spanAt',
      'onGripDown', 'onGripMove', 'onGripUp', 'BarWiring',
      'resizeShift', 'DRAG_PX_PER_STEP', 'edgeLabel', 'EdgeSpan',
      'data-dragging', 'bar-time', 'shift draggable',
    ]) {
      expect(SRC).not.toContain(dead)
    }
    for (const dead of ['.grip', 'data-dragging', '.shift.draggable']) {
      expect(CSS).not.toContain(dead)
    }
  })

  it('and the ARITHMETIC went with it — the library keeps no orphaned drag maths', () => {
    // The screen losing its handles left the whole minutes-arithmetic block in
    // shifts.ts with no caller: exported, compiling, tested by nothing, and
    // exactly the kind of thing a later reader mistakes for a live rule. The
    // absence is pinned on the LIBRARY as well as the screen, because that is
    // where it actually survived the removal.
    for (const dead of [
      'resizeShift', 'edgeLabel', 'EdgeSpan', 'EdgeClamp',
      'DRAG_PX_PER_STEP', 'SHIFT_STEP_MIN', 'TRACK_PAD_MIN',
      'TrackWindow', 'trackWindow',
    ]) {
      expect(LIB).not.toContain(dead)
      expect(SRC).not.toContain(dead)
      expect(PAGE_SRC).not.toContain(dead)
    }
    // …and the prop the page built for it is gone from the contract too, so no
    // caller can go on paying to compute a window nothing reads.
    expect(SRC).not.toMatch(/^\s*track:/m)
    expect(PAGE_SRC).not.toMatch(/^\s*track:/m)
    // The one import it was the last user of went with it.
    expect(LIB).toContain("import { availableMinutes, dayTotals, effectiveShift } from './today-board'")
  })

  it('the chip still OPENS the dialog, and its label no longer promises a drag', () => {
    const cell = SRC.slice(SRC.indexOf('function WeekCell('), SRC.indexOf('function monthCell('))
    expect(cell).toContain('className="shift-open"')
    expect(cell).toContain('onClick={() => open(m, day)}')
    expect(cell).toContain('aria-label={cellLabel(m, day, cell)}')
    expect(SRC).not.toContain('端をドラッグ')
    // ONE staging seam, and now only ONE caller of it: the dialog's 保存.
    expect(SRC.match(/const stageShift =/g)!.length).toBe(1)
    expect((SRC.match(/stageShift\(/g) ?? []).length).toBe(1) // saveCell, and nothing else
    // The live label was a single text node only because the drag wrote it;
    // with nothing imperative writing it, it is plain interpolation again.
    expect(cell).toContain('<b>{hhmm(cell.start!)}–{hhmm(cell.end!)}</b>')
  })

  it('the refusal toast went with it — every refusal answers inside its dialog', () => {
    // The warn toast existed for a released drag, which has no dialog to answer
    // inside. Nothing produces one now, so the branch is gone rather than
    // sitting there unreachable.
    expect(SRC).not.toContain('warn: true')
    expect(CSS).not.toContain('.toast.warn')
    expect(SRC).toContain('<div className="toast show" role="status" aria-live="polite" aria-atomic="true">')
  })
})

describe('⚖ the month board’s columns are tighter, and the operator sets them', () => {
  /** The three defaults, read out of the sheet rather than restated here. */
  const widths = () => {
    const rule = CSS.slice(CSS.indexOf('.biz .pg-shifts .month-table {'))
    const head = rule.slice(0, rule.indexOf('}'))
    const px = (name: string) => Number(new RegExp(`--${name}-w:\\s*(\\d+)px`).exec(head)![1])
    return { date: px('date'), booking: px('booking'), staff: px('staff') }
  }

  it('every default is TIGHTER than the layout Liam rejected', () => {
    // 148 / 140 / 132 was the board in his screenshots. Measured in real
    // Chromium against this sheet, the content floors are 104.6px (日付, the
    // date itself), 74px (予約, the 定休日 chip) and 110.9px (a staff column's
    // 10:00–19:00 chip) — so every one of these had room to give.
    const w = widths()
    expect(w.date).toBeLessThan(148)
    expect(w.booking).toBeLessThan(140)
    expect(w.staff).toBeLessThan(132)
    // and none of them is tighter than its own floor
    expect(w.date).toBeGreaterThanOrEqual(106)
    expect(w.booking).toBeGreaterThanOrEqual(76)
    expect(w.staff).toBeGreaterThanOrEqual(112)
  })

  it('the frozen pair costs 28 people less of the screen than it did', () => {
    // The whole point of the tightening: what the two frozen columns take is
    // what the staff columns never get. At the shell's 1280 layout the board
    // has 1146px, and the arithmetic below is what the layout probe measures
    // for real (6 staff columns fully visible before, 8 after).
    const w = widths()
    const visible = (frozen: number, staff: number) => Math.floor((1146 - frozen) / staff)
    expect(visible(148 + 140, 132)).toBe(6)
    expect(visible(w.date + w.booking, w.staff)).toBeGreaterThan(6)
  })

  it('the long strings WRAP rather than widening 28 columns for one day', () => {
    // 勤務不可 and 希望休 are one-person, one-day chips; 予約's warn chip already
    // wrapped at 140px. A column sized to hold them on one line is ~20px wider
    // on every staff column, every month, for a chip most months never show.
    for (const kind of ['absence', 'warn', 'quiet', 'request']) {
      const rule = CSS.slice(CSS.indexOf(`.biz .pg-shifts .chip-shift.${kind} {`))
      expect(rule.slice(0, rule.indexOf('}'))).toContain('white-space: normal')
    }
    // The date itself never breaks — it holds no space, so `keep-all` leaves it
    // no break opportunity, and the 本日 tag is what drops under it.
    const day = CSS.slice(CSS.indexOf('.biz .pg-shifts .day-label { padding'))
    expect(day.slice(0, day.indexOf('}'))).toContain('word-break: keep-all')
    expect(SRC).toContain('{d.monthCell}{d.isToday && <> <span className="today-tag">本日</span></>}')
  })

  it('a border line is a 10px grab zone with a col-resize cursor, in both frozen headers', () => {
    // The practicality law: a 1px border is not a target. R13: the line LIGHTS
    // on the accent, and is never a fill.
    const grip = CSS.slice(CSS.indexOf('.biz .pg-shifts .col-grip {'))
    const rule = grip.slice(0, grip.indexOf('}'))
    expect(rule).toContain('width: 10px')
    expect(rule).toContain('cursor: col-resize')
    expect(rule).toContain('touch-action: none')
    expect(CSS).toContain('.biz .pg-shifts .col-grip[data-sizing]::after { background: var(--indigo); }')
    expect(CSS).not.toMatch(/\.col-grip[^{]*\{[^}]*background: (#000|#18181b|var\(--ink\))/)
    expect(SRC).toContain('<th>日付{divider(\'date\')}</th>')
    expect(SRC).toContain('<th>予約{divider(\'booking\')}</th>')
  })

  it('ONE clamp decides every width, and it is the truncation guard', () => {
    // A width below the floor is a string that truncates, so there is no second
    // check to forget — and both the grab and the move go through it.
    expect(SRC).toContain("const COL_MIN: Record<MonthColKey, number> = { date: 106, booking: 76 }")
    expect(SRC).toContain('const COL_MAX = 360')
    expect(SRC.match(/Math\.min\(COL_MAX, Math\.max\(COL_MIN\[key\]/g)!.length).toBe(1)
    const move = SRC.slice(SRC.indexOf('function onDividerMove('), SRC.indexOf('function resetDivider('))
    expect(move).toContain('colWidth(d.key, d.startW + (e.clientX - d.startX))')
    // 1:1 with the pointer: travel is added to the width, never divided by a
    // gearing constant (which E-1 needed only because minutes are not pixels).
    expect(move).not.toMatch(/[/*]\s*[A-Z_]*PX[A-Z_]*/)
  })

  it('no React render per pointermove — the frame writes the variable', () => {
    const move = SRC.slice(SRC.indexOf('function onDividerMove('), SRC.indexOf('function resetDivider('))
    expect(move).toContain("tableRef.current?.style.setProperty(COL_VAR[d.key]")
    // no state setter of any kind — the only `set` here is the DOM's own
    expect(move).not.toContain('setColWidths')
    expect(move.replace(/setProperty/g, '')).not.toMatch(/\bset[A-Z]/)
    // Capture rides the handle, and every ENDING tears the gesture down.
    const down = SRC.slice(SRC.indexOf('function onDividerDown('), SRC.indexOf('function onDividerMove('))
    expect(down).toContain('handle.setPointerCapture(e.pointerId)')
    for (const ending of [
      'onPointerUp={endSizing}',
      'onPointerCancel={(e) => endSizing(e, false)}',
      'onLostPointerCapture={endSizing}',
    ]) {
      expect(SRC).toContain(ending)
    }
  })

  it('a CANCELED gesture changes nothing, and a bare click is not a resize', () => {
    const end = SRC.slice(SRC.indexOf('const endSizing = useCallback('), SRC.indexOf('function onDividerDown('))
    // (1) Only the pointer that STARTED the gesture may end it. A second finger
    // lifting elsewhere used to commit somebody else's drag.
    expect(end).toContain('if (!d || (e && e.pointerId !== d.pointerId)) return')
    expect(SRC).toContain('const endSizing = useCallback((e?: React.PointerEvent<HTMLElement>, commit = true)')
    // (2) CANCEL REVERTS. pointercancel is the OS taking the gesture away, and
    // the room's invariant is that a canceled gesture leaves nothing behind:
    // the inline variable goes back to what the session held — REMOVED when it
    // held nothing, so shifts.css stays the one place a default is written.
    expect(end).toContain('if (!commit) {')
    expect(end).toContain('if (d.prev === undefined) tableRef.current?.style.removeProperty(COL_VAR[d.key])')
    expect(end).toContain("else tableRef.current?.style.setProperty(COL_VAR[d.key], `${d.prev}px`)")
    // the revert reads what was CAPTURED at pointerdown, not live state, so a
    // remount between down and cancel cannot make it restore the wrong number
    const down = SRC.slice(SRC.indexOf('function onDividerDown('), SRC.indexOf('function onDividerMove('))
    expect(down).toContain('prev: colWidths[key], moved: false,')
    // (3) A DOWN+UP WITH NO MOVE IS NOT A RESIZE. It used to write the sheet's
    // own default into session state as an explicit override — a column the
    // operator never dragged, pinned by a click, and silently immune to a later
    // change of the default. The capture still releases and the lit line still
    // goes out; only the write is skipped.
    expect(end).toContain('if (!d.moved) return')
    expect(end.indexOf('delete d.handle.dataset.sizing')).toBeLessThan(end.indexOf('if (!commit) {'))
    expect(end.indexOf('releasePointerCapture')).toBeLessThan(end.indexOf('if (!d.moved) return'))
    const move = SRC.slice(SRC.indexOf('function onDividerMove('), SRC.indexOf('function resetDivider('))
    expect(move).toContain('d.moved = true')
  })

  it('a width survives the remount every 週/月 flip and every month arrow causes', () => {
    // `?view=` and `?ym=` are real Links, so ShiftsScreen remounts on both. A
    // column that snapped back to its default on every one of them would be a
    // control that undoes itself — the same lesson as the staged shifts.
    const provider = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/ShiftsSessionEdits.tsx'),
      'utf8',
    )
    expect(provider).toContain('const [colWidths, setColWidths] = useState<MonthColWidths>({})')
    expect(provider).toContain('colWidths, setColWidths')
    expect(SRC).toContain('colWidths, setColWidths } = useShiftEdits()')
    expect(SRC).not.toMatch(/useState<MonthColWidths>/)
    // NOTHING persists past the tab, and nothing is a setting: this is direct
    // manipulation, so there is no dial, no storage and no write.
    expect(SRC).not.toContain('localStorage')
    expect(SRC).not.toContain('sessionStorage')
    expect(provider).not.toContain('localStorage')
  })

  it('a reset DELETES the width — the default is written in exactly one place', () => {
    const reset = SRC.slice(SRC.indexOf('function resetDivider('), SRC.indexOf('const divider ='))
    expect(reset).toContain('delete next[key]')
    expect(reset).toContain('removeProperty(COL_VAR[key])')
    expect(SRC).toContain("onDoubleClick={() => resetDivider(key)}")
    // and the screen never restates a default number of its own
    expect(SRC).not.toMatch(/--date-w': '13\d/)
  })
})

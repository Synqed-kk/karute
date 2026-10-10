/**
 * The practice door, ON (PKT-PR2 §7): every reader driven through data.ts's seam
 * against THE RECORDED ANSWER SET (./practice-door-recorded) — no network. The
 * core-reach mock keeps clientFor's two throws exactly (switch unset; another
 * business → PracticeTenantMismatch, before any read) and answers with the
 * recorded reads; admission answers per scenario.
 */

// The SDK ships raw ESM this jest setup does not transform (same stub as practice-door.test.ts).
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/practice-door/core-reach', () => {
  const actual = jest.requireActual('@/business/lib/practice-door/core-reach')
  const { doorFor, practiceTenant } = jest.requireActual('@/business/lib/practice-door/switch')
  return {
    ...actual,
    clientFor: (admitted: { businessId: string }) => {
      mockBuilt.n += 1 // R50 P1/P2 — how many times a core client was asked for
      const tenant = practiceTenant()
      if (tenant === null) throw new Error('practice door called with the switch unset')
      if (!doorFor(admitted.businessId)) throw new actual.PracticeTenantMismatch(admitted.businessId) // R50 F2 — the real guard's one match
      return mockCore.reads
    },
  }
})

// ⚖ A1b · P2-2 — the card's two reads, wrapped (same functions) so a test can see whether they ran at all.
jest.mock('@/business/lib/data', () => {
  const actual = jest.requireActual('@/business/lib/data')
  return { ...actual, readReserveCardColor: jest.fn(actual.readReserveCardColor), readStoreAddress: jest.fn(actual.readStoreAddress), listStoreOptions: jest.fn(actual.listStoreOptions) }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as data from '@/business/lib/data'
import * as door from '@/business/lib/practice-door/door'
import { hash } from '@/business/lib/practice-door/door-inbox-register'
import { INBOX_WINDOW_DAYS } from '@/business/lib/inbox'
import { WINDOW_DAYS as RESERVATIONS_WINDOW_DAYS } from '@/app/[locale]/(business)/business/reservations/reservations-props'
import { threads as fixtureThreads } from '@/business/lib/fixtures-inbox'
import { reservations as fixtureReservations } from '@/business/lib/fixtures-reservations'
import { transactions as fixtureTransactions, closing as fixtureClosing, cashTolerance, type FixtureTransaction } from '@/business/lib/fixtures-register'
import { buildLedger, ledgerTotals, expectedCash, denominationTotal } from '@/business/lib/register'
import { inboxProps } from '@/app/[locale]/(business)/business/inbox/inbox-props'
import { registerProps } from '@/app/[locale]/(business)/business/register/register-props'

import { requireBusinessAdmission } from '@/business/lib/admission'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { PracticeLensRefused, pageAll, practiceActor } from '@/business/lib/practice-door/actor'
import { doorFor } from '@/business/lib/practice-door/switch'
import {
  attachSample, historyOperatorName, PLANE_LABEL, PLANE_MAP_SAYS_LIVE, PLANE_ROW, planesOf, PRACTICE_PLANES, rekeyKeys, rekeyRows, sampleFor,
  sampleKeys, samplePart, sampleRows, sampleSelfId, sampleWhole, SINGLETONS_BY_FIXTURE_STORE, STORE_PLANE_OVERRIDES, storeSample,
} from '@/business/lib/practice-door/sample-facade'
import { liveIdOf, SAMPLE_SLOT_PRICES, samplePolicyFor, STORE_SAMPLE_POLICY } from '@/business/lib/practice-door/registry'
import { customers, operator, staff as fxStaff, stores as fxStores, STORE_A, STORE_B, STORE_C } from '@/business/lib/fixtures'
import {
  absence as fxAbsence, closedWeekday, decisions as fxDecisions, defaultKindOf, operatingHours, opsConfig, register, sellSlots as fxSlots, shifts as fxShifts,
  staffListPrice as fxListPrice, staffQualifications,
} from '@/business/lib/fixtures-today'
import { jstDayKey, jstMinuteOfDay } from '@/business/lib/clock'
import { dayBookings, dayTotals, type BuildInput } from '@/business/lib/today-board'
import { weekdayOfKey } from '@/business/lib/practice-door/store-hours'
import { rulebook, storeDials } from '@/business/lib/fixtures-settings'
import { accessFor as settingsAccessFor, RAIL, yen } from '@/business/lib/settings'
import { salesTargets } from '@/business/lib/fixtures-analytics'
import { accessFor as askAiAccessFor } from '@/business/lib/ask-ai'
import { accessFor as karuteAccessFor } from '@/business/lib/karute'
import { accessFor as recordingAccessFor } from '@/business/lib/recording'
import { accessFor as registerAccessFor } from '@/business/lib/register'
import { settingsProps } from '@/app/[locale]/(business)/business/settings/settings-props'
import { LATE_FROM_BOOKING_NOTE } from '@/business/lib/data'
import { recordingProps } from '@/app/[locale]/(business)/business/recording/recording-props'
import { karuteProps } from '@/app/[locale]/(business)/business/karute/karute-props'
import {
  APPOINTMENTS, APT, AKARI, ASSIGNMENTS, CARD, CUSTOMERS, KOBAYASHI, LOGIN, MENU, POLICIES, STAFF, STORE, STORES, TENANT, membership, recordedReads,
  type RecordedOptions,
} from './practice-door-recorded'

// Hoisted-mock handle (jest allows `mock`-prefixed names in a factory).
const mockCore: { reads: CoreReads } = { reads: recordedReads() }
const mockBuilt = { n: 0 }
const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>

// 13:24 JST on 2026-09-14 — the recorded bookings' day. Date only; timers stay real.
jest.useFakeTimers({
  now: new Date('2026-09-14T04:24:00Z'),
  doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
})
const TODAY = jstDayKey(new Date('2026-09-14T04:24:00Z'))

type Spied = { [K in keyof CoreReads]: jest.Mock }
function withReads(o: RecordedOptions = {}): Spied {
  const base = recordedReads(o)
  const spied = Object.fromEntries(Object.entries(base).map(([k, fn]) => [k, jest.fn(fn as (...a: unknown[]) => unknown)])) as unknown as Spied
  mockCore.reads = spied as unknown as CoreReads
  return spied
}
/** ⚖ §v11 PR-B — the floating path (no assignments row = every store), with むすび's recorded row taken out. */
const floatingMusubi = () => withReads().staffStoresList.mockResolvedValue({ assignments: Object.fromEntries(Object.entries(ASSIGNMENTS).filter(([id]) => id !== CARD.musubi)) })
function as(userId: string, email: string | null = null, businessId: string = TENANT) {
  admission.mockResolvedValue({ userId, email, displayName: null, businessId })
}

const saved = process.env.BUSINESS_PRACTICE_TENANT
beforeEach(() => {
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  withReads()
  as(LOGIN.owner)
})
afterEach(() => {
  if (saved === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
  else process.env.BUSINESS_PRACTICE_TENANT = saved
})

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id)
const VIEW_ALL = { viewAll: true } as const

describe('(1) OWNER — viewAll', () => {
  it("React cache() is a pass-through outside a render: two practiceActor() calls read staff twice", async () => {
    const spy = withReads()
    await practiceActor()
    await practiceActor()
    expect(spy.staffList).toHaveBeenCalledTimes(2)
  })

  it('listStoreOptions: the 7 active stores in core order, typed by sample policy', async () => {
    const opts = await data.listStoreOptions()
    expect(ids(opts)).toEqual([STORE.devSalon, STORE.devGinza, STORE.tokyo, STORE.yokohama, STORE.laEstro, STORE.gym, STORE.jiyugaoka])
    // ⚖ PR-3 V4-2 — every practice store takes a plane: a borrower shows its plane's 業種 unless it names its own.
    expect(opts.map((s) => s.business_type)).toEqual(['beauty_chiropractic', 'beauty_chiropractic', 'beauty_chiropractic', 'massage', 'esthetic_salon', 'personal_gym', 'hair_salon'])
    expect(opts.map((s) => s.default_kind_id)).toEqual(['k-a', 'k-a', 'k-a', 'k-b', 'k-a', 'k-a', 'k-a'])
    expect(opts.map((s) => s.name)).toEqual(['Dev Salon', 'Dev 銀座', 'テスト東京店', 'テスト横浜店', 'La Estro Test Store', 'テスト恵比寿ジム', 'テスト自由が丘店'])
  })

  it('readShellIdentity: live org name + the actor-visible count + the card; honest empty when org is null', async () => {
    const shell = await data.readShellIdentity()
    expect(shell.business).toEqual({ name: 'Dev Salon', storeCount: 7 })
    expect(shell.operator).toEqual({ name: 'Dev Salon', mark: 'Dev', role: 'オーナー', staff_id: CARD.owner })
    expect(typeof shell.reserveSyncedAt).toBe('string')
    withReads({ orgName: null })
    expect((await data.readShellIdentity()).business.name).toBe('')
  })

  it('R53 P2 readShellViewer door ON: the core card + the admission e-mail + the role label, the operator untouched', async () => {
    as(LOGIN.owner, 'dev@karute.test')
    const admitted = await requireBusinessAdmission()
    const viewer = await data.readShellViewer(admitted)
    const shell = await data.readShellIdentity()
    expect(viewer).toEqual({ name: shell.operator.name, mark: shell.operator.mark, email: admitted.email, roleLabel: 'オーナー' })
    expect(viewer.name).toBe('Dev Salon')
    expect(viewer.email).toBe('dev@karute.test')
  })

  it('listStaff(東京): the 東京-assigned + floating cards; the inactive card never', async () => {
    expect(ids(await data.listStaff(STORE.tokyo))).toEqual([
      CARD.saburo,
      'd27c76c4-eda7-4b12-9491-4eb6d9edaee5',
      CARD.goro,
      '00a86dcc-1204-4438-b295-e20861f3a137',
      '088f928a-552b-4068-8ecc-9bc2d9d19cd7',
      'ff708849-6ed2-4dca-90ae-a7fe2f4ac961',
      CARD.musubi,
    ])
    const all = await data.listStaff(VIEW_ALL)
    expect(ids(all)).not.toContain(CARD.inactive)
    expect(all).toHaveLength(21) // ⚖ §v11 PR-B — + the gym's own five
    expect(all.find((s) => s.id === CARD.goro)).toEqual({ id: CARD.goro, full_name: '見本 ごろう', email: 'goro@test.invalid' })
  })

  it('readStaffStores: null for the floating card, the two-store arrays from the live assignments', async () => {
    const map = await data.readStaffStores(STORE.tokyo)
    // ⚖ §v11 PR-B — REWRITTEN: むすび was the floating card (null); she now works every recorded store but the gym (S4a).
    expect(map[CARD.musubi]).toEqual(ASSIGNMENTS[CARD.musubi])
    expect(map[CARD.saburo]).toEqual([STORE.tokyo, STORE.yokohama])
    expect(map[CARD.goro]).toEqual([STORE.yokohama, STORE.tokyo])
    expect(map).not.toHaveProperty(CARD.inactive)
    expect(Object.keys(map)).toHaveLength(21)
    floatingMusubi() // …and a card with no assignments row is still null, never a list
    expect((await data.readStaffStores(STORE.tokyo))[CARD.musubi]).toBeNull()
  })

  it('listMenus: store menus + 全店舗; twins carry their kind, the La Estro menu none', async () => {
    const tokyo = await data.listMenus(STORE.tokyo)
    expect(ids(tokyo)).toEqual([MENU.seitai, MENU.kotsuban, MENU.stretch, MENU.zenten])
    expect(tokyo.map((m) => m.requires_kind_id)).toEqual(['k-a', 'k-a', 'k-a', null])
    expect(tokyo[0]).toEqual({ id: MENU.seitai, store_id: STORE.tokyo, requires_kind_id: 'k-a', name: 'テスト整体 60分', price: 6600, duration_minutes: 60 })
    const laEstro = await data.listMenus(STORE.laEstro)
    expect(ids(laEstro)).toEqual([MENU.body, MENU.zenten])
    expect(laEstro[0].requires_kind_id).toBeNull()
    expect(ids(await data.listMenus(VIEW_ALL))).not.toContain(MENU.inactive)
  })

  it('listCustomers(東京): core membership, LIVE fields + twin SAMPLE fields; La Estro: defaults', async () => {
    const tokyo = await data.listCustomers(STORE.tokyo)
    expect(ids(tokyo)).toEqual(membership(STORE.tokyo))
    expect(tokyo.length).toBeGreaterThan(0)
    const akari = tokyo.find((c) => c.id === AKARI)!
    expect(akari).toMatchObject({ member_number: 'C-3001', name: '見本 あかり', mark: '見本', ticket_balance: 4, merge_status: 'open', duplicate_of: 'C-3009' })
    const laEstro = await data.listCustomers(STORE.laEstro)
    expect(laEstro).toEqual([{
      id: KOBAYASHI, member_number: '', name: '小林 あや', furigana: null, mark: '小林', phone: null, email: null,
      source: '', identity_check: null, ticket_balance: null, wallet_balance: null, merge_status: 'none', duplicate_of: null,
      consent: null, line_linked: false, party: [], thin: false, external_owner: false, note: null, vip: false,
    }])
    expect(await data.listCustomers(VIEW_ALL)).toHaveLength(14 + 20) // ⚖ §v11 — + the gym's, 自由が丘's and (PR-B) 東京's C6 own 20
  })

  it('listCustomers: literal membership anchors from fixtures.ts, independent of the membership() helper', async () => {
    // 見本 きり (cus-07) books at STORE_A (apt-09, apt-27); テスト おとは (cus-05) at STORE_B (apt-21).
    expect(ids(await data.listCustomers(STORE.tokyo))).toContain('554c295d-8599-44b0-8394-790c40cfbfc6')
    expect(ids(await data.listCustomers(STORE.yokohama))).toContain('f3b15433-b27f-443e-b937-ddc221fc3268')
  })

  it('listAppointments: to is inclusive (+1 ms), the status map, display_no, yen only, null-store + BLOCK hidden', async () => {
    const a14Start = '2026-09-14T04:00:00.000Z'
    const tokyo = await data.listAppointments(STORE.tokyo, { from: '2026-08-01T00:00:00.000Z', to: a14Start })
    expect(ids(tokyo)).toContain(APT.a14)
    expect(ids(tokyo)).not.toContain(APT.nullStore)
    expect(ids(tokyo)).not.toContain(APT.blockUntitled)
    const all = await data.listAppointments(VIEW_ALL, {})
    const by = (id: string) => all.find((a) => a.id === id)!
    expect([by(APT.a01).status, by(APT.a01).board_state]).toEqual(['done', 'confirmed']) // COMPLETED
    expect([by(APT.a03).status, by(APT.a03).board_state]).toEqual(['booked', 'confirmed']) // SCHEDULED
    expect([by(APT.a05).status, by(APT.a05).board_state]).toEqual(['cancelled', null]) // CANCELLED
    expect([by(APT.a09).status, by(APT.a09).board_state]).toEqual(['booked', 'noshow']) // NO_SHOW
    expect([by(APT.a13).status, by(APT.a13).board_state]).toEqual(['in_progress', 'confirmed']) // IN_PROGRESS — ⚖ S81 R1 carried, board_state as SCHEDULED
    expect(by(APT.a14).display_no).toBe('R-4814')
    expect(by(APT.a14).updated_minute).toBe(15 * 60 + 30)
    expect(by(APT.a01).updated_minute).toBeNull()
    expect(by(APT.nullStore).store_id).toBeNull() // shown under viewAll
    expect(ids(all)).not.toContain(APT.blockMidnight)
    const laEstro = await data.listAppointments(STORE.laEstro, {})
    expect(laEstro).toHaveLength(1)
    expect(laEstro[0]).toMatchObject({ id: APT.laEstro, booked_price: null, display_no: '', source: 'SYNQED_RESERVE', customer_id: KOBAYASHI })
  })

  it('listBlocksByDay: the midnight block splits into two days; the title-less block prints the default label', async () => {
    const byDay = await data.listBlocksByDay(STORE.tokyo, { from: TODAY, to: TODAY + 1 })
    expect([...byDay.keys()]).toEqual([TODAY, TODAY + 1])
    expect(byDay.get(TODAY)!.map((b) => [b.id, b.kind, b.start, b.end, b.store_id])).toEqual([
      [APT.blockUntitled, '', 12 * 60, 12 * 60 + 30, STORE.tokyo],
      [APT.blockMidnight, 'recorded block', 23 * 60 + 30, 1440, STORE.tokyo],
      [APT.blockOvernightBefore, '', 0, 30, STORE.tokyo],
    ])
    expect(byDay.get(TODAY + 1)!.map((b) => [b.id, b.start, b.end, b.micro, b.note])).toEqual([
      [APT.blockMidnight, 0, 30, false, 'recorded note'],
      [APT.blockTwoNights, 22 * 60, 1440, false, ''],
    ])
  })

  it('listBlocksByDay: a block crossing TWO midnights yields three pieces (first · whole middle · last)', async () => {
    const byDay = await data.listBlocksByDay(STORE.tokyo, { from: TODAY + 1, to: TODAY + 3 })
    const pieces = [TODAY + 1, TODAY + 2, TODAY + 3].map((k) =>
      (byDay.get(k) ?? []).filter((b) => b.id === APT.blockTwoNights).map((b) => [b.start, b.end]))
    expect(pieces).toEqual([[[22 * 60, 1440]], [[0, 1440]], [[0, 2 * 60]]])
  })

  it('listBlocksByDay: an overnight block begun the day BEFORE the queried day shows its 00:00–00:30 piece', async () => {
    const byDay = await data.listBlocksByDay(STORE.tokyo, { from: TODAY, to: TODAY })
    expect([...byDay.keys()]).toEqual([TODAY])
    expect(byDay.get(TODAY)!.filter((b) => b.id === APT.blockOvernightBefore).map((b) => [b.start, b.end])).toEqual([[0, 30]])
  })

  it('a null-store BLOCK: absent under a store lens, carried with store_id \'\' under viewAll', async () => {
    const tokyo = await data.listBlocksByDay(STORE.tokyo, { from: TODAY, to: TODAY })
    expect(ids(tokyo.get(TODAY)!)).not.toContain(APT.blockNullStore)
    const all = await data.listBlocksByDay(VIEW_ALL, { from: TODAY, to: TODAY })
    expect(all.get(TODAY)!.filter((b) => b.id === APT.blockNullStore).map((b) => [b.store_id, b.start, b.end])).toEqual([['', 9 * 60, 9 * 60 + 30]])
  })

  it('a BLOCK that ends before it starts is loud, never a silent vanish', async () => {
    withReads({ backwardsBlock: true })
    await expect(data.listBlocksByDay(STORE.tokyo, { from: TODAY, to: TODAY })).rejects.toThrow(`practice door: block ${APT.blockBackwards} ends before it starts`)
  })

  it('viewAll drops a booking at a store outside VISIBLE (the inactive store) — the door drops it, not the mock', async () => {
    const spy = withReads()
    expect(ids(await data.listAppointments(VIEW_ALL, {}))).not.toContain(APT.inactiveStore)
    expect(spy.appointmentsList).toHaveBeenCalled()
    const served = (await spy.appointmentsList.mock.results[0].value) as { appointments: Array<{ id: string }> }
    expect(ids(served.appointments)).toContain(APT.inactiveStore)
  })

  it('dayStartIso: 00:00 JST of today, yesterday and across a month boundary (the from/to the door sends)', async () => {
    // `from` is the day BEFORE the range (F2: an overnight block begun on from−1 must be fetched).
    const cases: Array<[number, string, string]> = [
      [TODAY, '2026-09-12T15:00:00.000Z', '2026-09-14T15:00:00.000Z'],
      [TODAY - 1, '2026-09-11T15:00:00.000Z', '2026-09-13T15:00:00.000Z'],
      [jstDayKey('2026-08-31T03:00:00Z'), '2026-08-29T15:00:00.000Z', '2026-08-31T15:00:00.000Z'],
      [jstDayKey('2026-10-01T03:00:00Z'), '2026-09-29T15:00:00.000Z', '2026-10-01T15:00:00.000Z'],
    ]
    for (const [key, from, to] of cases) {
      const spy = withReads()
      await data.listBlocksByDay(STORE.tokyo, { from: key, to: key })
      expect(spy.appointmentsList).toHaveBeenCalledWith(expect.objectContaining({ from, to, store_id: STORE.tokyo }))
    }
  })

  it('listVisits: the per-customer read, clamped (null-store hidden under a store lens); the lens-wide list = COMPLETED bookings', async () => {
    expect(await data.listVisits(STORE.tokyo, { customerId: AKARI })).toHaveLength(1)
    const all = await data.listVisits(VIEW_ALL, { customerId: AKARI })
    expect(all.map((v) => v.booked_price)).toEqual([6600, 3300])
    expect(ids(await data.listVisits(STORE.tokyo, {}))).toEqual([APT.a01])
  })

  it('listResources is [] (READBACK: 0 at every store); readUnresolvedCounts keys = the visible stores', async () => {
    expect(await data.listResources(STORE.tokyo)).toEqual([])
    expect(await data.listResources(VIEW_ALL)).toEqual([])
    const counts = await data.readUnresolvedCounts()
    expect(Object.keys(counts.byStore)).toEqual([STORE.devSalon, STORE.devGinza, STORE.tokyo, STORE.yokohama, STORE.laEstro, STORE.gym, STORE.jiyugaoka])
    expect(counts.byStore[STORE.tokyo]).toBe(4)
    // ⚖ PR-4a R6 + R8' — each borrower counts what it is served; the recorded world has 0 rooms at every
    // store, so no borrower is served a slot or its decision → 0. 横浜 twins STORE_B: none.
    expect([STORE.devSalon, STORE.devGinza, STORE.laEstro, STORE.gym, STORE.jiyugaoka].map((s) => counts.byStore[s])).toEqual([0, 0, 0, 0, 0])
    expect(counts.all).toBe(Object.values(counts.byStore).reduce((a, b) => a + b, 0))
    expect(counts.all).toBe(4)
  })

  it('readDayPlanes(東京, today): SAMPLE planes on live ids, the live blocks, no fixture store id anywhere', async () => {
    const planes = await data.readDayPlanes(STORE.tokyo, TODAY)
    expect(planes.shifts.every((s) => /^[0-9a-f-]{36}$/.test(s.staff_id))).toBe(true)
    expect(ids(planes.blocks)).toEqual([APT.blockUntitled, APT.blockMidnight, APT.blockOvernightBefore])
    expect(planes.sellSlots.every((s) => s.store_id === STORE.tokyo)).toBe(true)
    expect(planes.sellSlots.length).toBeGreaterThan(0)
    expect(planes.register.terminal_held).toEqual([])
    expect(JSON.stringify(planes)).not.toContain('store-test-')
    const other = await data.readDayPlanes(STORE.tokyo, TODAY + 1)
    expect(other.decisions).toEqual([])
    expect(other.register.terminal_held).toEqual([])
  })

  it('terminal_held under ON is [] — the fixture held row\'s twin booking IS live at 東京 today, and still no fixture ¥6,600 attaches (FE-1)', async () => {
    expect(register.terminal_held.map((h) => liveIdOf('appointments', h.appointment_id))).toEqual([APT.a25])
    const a25 = (await data.listAppointments(STORE.tokyo, {})).find((a) => a.id === APT.a25)!
    expect(jstDayKey(a25.starts_at)).toBe(TODAY)
    for (const lens of [STORE.tokyo, VIEW_ALL]) {
      expect((await data.readDayPlanes(lens, TODAY)).register.terminal_held).toEqual([])
      expect((await data.readReservationPlanes(lens)).register.terminal_held).toEqual([])
    }
  })

  it('readReservationPlanes + readAnalyticsPlanes: rewritten ids, targets by sample policy', async () => {
    const res = await data.readReservationPlanes(STORE.tokyo)
    expect(JSON.stringify(res)).not.toContain('store-test-')
    expect(res.register.terminal_held).toEqual([])
    // F3: the audit trail is keyed by appointment id → the keys are the live twins.
    const keys = Object.keys(res.auditTrail)
    expect(keys).toEqual(expect.arrayContaining([liveIdOf('appointments', 'apt-30'), liveIdOf('appointments', 'apt-31')]))
    expect(keys.every((k) => /^[0-9a-f-]{36}$/.test(k))).toBe(true)
    expect(keys.some((k) => k.startsWith('apt-'))).toBe(false)
    expect((await data.readAnalyticsPlanes(STORE.tokyo)).target).toBe(2000000)
    // ⚖ PR-3 V4-2 — a borrower's target is its plane's (every practice store is filled in).
    expect((await data.readAnalyticsPlanes(STORE.laEstro)).target).toBe(2000000)
    expect((await data.readAnalyticsPlanes(VIEW_ALL)).target).toBe(6 * 2000000 + 800000)
  })
})

describe('(2) AREA MANAGER — two stores by the answer sheet', () => {
  beforeEach(() => as(LOGIN.goro))
  it('sees 東京 + 横浜 only; other lenses and viewAll are refused', async () => {
    expect(ids(await data.listStoreOptions())).toEqual([STORE.tokyo, STORE.yokohama])
    await expect(data.listCustomers(STORE.laEstro)).rejects.toBeInstanceOf(PracticeLensRefused)
    await expect(data.listAppointments(VIEW_ALL)).rejects.toBeInstanceOf(PracticeLensRefused)
    const shell = await data.readShellIdentity()
    expect(shell.business.storeCount).toBe(2)
    expect(shell.operator.role).toBe('店舗管理者')
  })

  it('readStaffStores never carries a hidden store id; a card assigned only to hidden stores has no key', async () => {
    const map = await data.readStaffStores(STORE.tokyo)
    const json = JSON.stringify(map)
    for (const hidden of [STORE.laEstro, STORE.devSalon, STORE.devGinza]) expect(json).not.toContain(hidden)
    expect(map).not.toHaveProperty(CARD.mio) // assigned ONLY to La Estro (READBACK §2) → unresolved, never null
    expect(map).not.toHaveProperty(CARD.owner) // Dev Salon only
    expect(map[CARD.saburo]).toEqual([STORE.tokyo, STORE.yokohama])
    // ⚖ §v11 PR-B — REWRITTEN (was: null, floating): むすび's stores, cut to the two he sees; floating stays floating.
    expect(map[CARD.musubi]).toEqual([STORE.tokyo, STORE.yokohama])
    floatingMusubi()
    expect((await data.readStaffStores(STORE.tokyo))[CARD.musubi]).toBeNull()
    as(LOGIN.owner)
    expect((await data.readStaffStores(STORE.tokyo))[CARD.mio]).toEqual([STORE.laEstro])
  })
})

describe('(2b) role labels — the Business vocabulary, from the rulebook', () => {
  it("each sheet role prints the label rulebook.roleKeyOf maps to it; any other role prints ''", async () => {
    const labelOf = Object.fromEntries(Object.entries(rulebook.roleKeyOf).map(([label, key]) => [key, label]))
    expect(Object.keys(labelOf).sort()).toEqual(['manager', 'owner', 'practitioner'])
    for (const [login, key] of [[LOGIN.owner, 'owner'], [LOGIN.goro, 'manager'], [LOGIN.perry, 'practitioner']] as const) {
      as(login)
      expect((await data.readShellIdentity()).operator.role).toBe(labelOf[key])
    }
    as(LOGIN.probe) // frontdesk
    expect((await data.readShellIdentity()).operator.role).toBe('')
  })
  it('settings under ON: a practitioner reads as スタッフ and every settings.manage section is closed', async () => {
    as(LOGIN.perry)
    const { props } = await settingsProps({ locale: 'ja' })
    // The role word reaches the page only through each closed section's boundary sentence.
    const closed = props.sections.filter((s) => s.gate === 'no-rights')
    expect(closed.length).toBeGreaterThan(0)
    for (const s of closed) expect(s.boundaryLine).toContain('スタッフの権限では開けません')
    // ⚖ A1b — every GATED section, store or business: `!== 'self'` is what `scope === 'store'` meant here.
    const needsManage = RAIL.filter((e) => e.scope !== 'self' && e.needs === 'settings.manage').map((e) => e.id)
    expect(needsManage).toContain('reserve-store-page')
    expect(needsManage.length).toBeGreaterThan(0)
    for (const id of needsManage) expect(props.sections.find((x) => x.id === id)?.gate).toBe('no-rights')
  })
  it("every room's accessFor('') is its most restrictive answer and never throws", () => {
    expect(RAIL.every((e) => e.needs === null || !settingsAccessFor('', rulebook).has(e.needs))).toBe(true)
    expect(rulebook.capabilities.every(({ token }) => !settingsAccessFor('', rulebook).has(token as never))).toBe(true)
    expect(askAiAccessFor('')).toEqual({ consult: false })
    expect(karuteAccessFor('')).toEqual({ discardContent: false, reassign: false })
    expect(recordingAccessFor('')).toEqual({ storeWide: false, discardReview: false })
    expect(registerAccessFor('')).toEqual({ refund: false, close: false, redactSummary: true })
  })
})

describe("(2c) a live actor's SAMPLE rows are their fixture twin's", () => {
  it('ON as 見本 あずさ (twin p-06): recording resolves her own card (c-06); karute 自分 is her live id', async () => {
    as(LOGIN.azusa)
    expect((await karuteProps({ locale: 'ja', store: STORE.tokyo })).props.selfStaffId).toBe(CARD.azusa)
    const { props } = await recordingProps({ locale: 'ja', store: STORE.tokyo })
    // selfCardId is not a prop; what IS: `ownDiscardLine` is computed only when the
    // self card resolves (ownDiscardsThisMonth → null without one).
    expect(props.ownDiscardLine).not.toBeNull()
    expect(props.historyCaption).toBe('自分の録音（新しい順・まず1週間ぶん）')
  })
  it('ON as テスト さぶろう (twin c-03, no email): his SAMPLE takes and karute rows attach to his live bookings', async () => {
    as(LOGIN.saburo)
    const rec = (await recordingProps({ locale: 'ja', store: STORE.tokyo })).props
    expect(rec.ownDiscardLine).not.toBeNull()
    // `takes` (RecordingTakeProps[]): rs-0004 is his (card c-03) take on apt-05, a recorded 東京 booking.
    expect(rec.takes.map((t) => t.id)).toContain('rs-0004')
    const kar = (await karuteProps({ locale: 'ja', store: STORE.tokyo })).props
    expect(kar.selfStaffId).toBe(CARD.saburo)
    const own = kar.rows.filter((r) => r.staffId === kar.selfStaffId)
    expect(own.length).toBeGreaterThan(0)
    expect(JSON.stringify(kar.rows)).not.toMatch(/\bapt-\d/)
  })
  it('ON as the owner (no twin): no self rows, no throw', async () => {
    const kar = (await karuteProps({ locale: 'ja', store: STORE.tokyo })).props
    expect(kar.selfStaffId).toBe(CARD.owner)
    expect(kar.rows.filter((r) => r.staffId === kar.selfStaffId)).toEqual([])
    const { props } = await recordingProps({ locale: 'ja', store: STORE.tokyo })
    expect(props.ownDiscardLine).toBeNull()
  })
  it('sampleSelfId: OFF identity; ON the twin, an unknown uuid → null', () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(sampleSelfId(false, 'staff', 'p-06')).toBe('p-06')
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    expect(sampleSelfId(true, 'staff', CARD.azusa)).toBe('p-06')
    expect(sampleSelfId(true, 'staff', CARD.owner)).toBeNull()
    expect(sampleSelfId(true, 'staff', null)).toBeNull()
  })
  it('attachSample: OFF the same plane (same reference); ON the ids rewritten', () => {
    const plane = [{ appointment_id: 'apt-14', store_id: STORE_A, by_staff_card_id: 'c-03' }]
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(attachSample(false, plane, null)).toBe(plane)
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    expect(attachSample(true, plane, null)).toEqual([{ appointment_id: APT.a14, store_id: STORE.tokyo, by_staff_card_id: 'c-03' }])
  })
})

describe('(3) UNASSIGNED — null without viewAll is EMPTY (fold F-2)', () => {
  beforeEach(() => as(LOGIN.musubi))
  it('no stores, every lens refused', async () => {
    expect(await data.listStoreOptions()).toEqual([])
    await expect(data.listMenus(VIEW_ALL)).rejects.toBeInstanceOf(PracticeLensRefused)
    await expect(data.listMenus(STORE.tokyo)).rejects.toBeInstanceOf(PracticeLensRefused)
  })
})

describe('(4)–(8) walls, identity, paging, errors', () => {
  it('(4) R50 — another admitted business takes the OFF path: every reader answers the sample world, no core client', async () => {
    const spy = withReads()
    as(LOGIN.owner, null, 'other')
    const calls: Array<() => Promise<unknown>> = [
      () => data.listStoreOptions(), () => data.listCustomers(STORE.tokyo), () => data.listAppointments(STORE.tokyo),
      () => data.listVisits(STORE.tokyo), () => data.readShellIdentity(), () => data.listMenus(STORE.tokyo),
      () => data.readUnresolvedCounts(), () => data.listResources(STORE.tokyo), () => data.listShiftsByDay(STORE.tokyo, { from: TODAY, to: TODAY }),
      () => data.listAbsenceByDay(STORE.tokyo, { from: TODAY, to: TODAY }), () => data.listBlocksByDay(STORE.tokyo, { from: TODAY, to: TODAY }),
      () => data.readDayPlanes(STORE.tokyo, TODAY), () => data.readReservationPlanes(STORE.tokyo), () => data.readAnalyticsPlanes(STORE.tokyo),
      () => data.listStaff(STORE.tokyo), () => data.readStaffStores(STORE.tokyo),
    ]
    delete process.env.BUSINESS_PRACTICE_TENANT
    const off: unknown[] = []
    for (const call of calls) off.push(await call())
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    mockBuilt.n = 0
    for (const [i, call] of calls.entries()) expect(await call()).toEqual(off[i])
    expect(mockBuilt.n).toBe(0)
    expect(spy.storesList).not.toHaveBeenCalled()
    expect(spy.staffList).not.toHaveBeenCalled()
  })
  it('(5) no card → loud', async () => {
    as('nobody', null)
    await expect(data.listStoreOptions()).rejects.toThrow('practice door: no staff card for the admitted user')
  })
  it('(6) email tier, case-insensitive', async () => {
    as('x', 'GORO@test.invalid')
    expect((await data.readShellIdentity()).operator.staff_id).toBe(CARD.goro)
  })
  it('(7) paging: 3 per page gives the same answers; a runaway total hits the 50-page cap', async () => {
    const normal = [await data.listStoreOptions(), await data.listStaff(STORE.tokyo), await data.listCustomers(VIEW_ALL), await data.listAppointments(VIEW_ALL)]
    const spy = withReads({ forcePageSize: 3 })
    const small = [await data.listStoreOptions(), await data.listStaff(STORE.tokyo), await data.listCustomers(VIEW_ALL), await data.listAppointments(VIEW_ALL)]
    expect(small).toEqual(normal)
    expect(spy.staffList.mock.calls.length).toBeGreaterThan(2)
    withReads({ runawayStaff: true })
    await expect(data.listStaff(STORE.tokyo)).rejects.toThrow('practice door: staff list exceeded 50 pages')
  })
  it('(7b) pageAll stops on the SHORT page, never on core\'s total', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => i)
    // total claims 1, ten rows over pages of 3 → all ten.
    const lying = jest.fn(async (page: number) => ({ rows: rows.slice((page - 1) * 3, page * 3), page_size: 3, total: 1 }))
    expect(await pageAll('lying', 3, lying)).toEqual(rows)
    // An exact multiple (6 rows, size 3): page 3 is the short, EMPTY page that ends the read —
    // one extra call is the price of never trusting a count.
    const six = jest.fn(async (page: number) => ({ rows: rows.slice(0, 6).slice((page - 1) * 3, page * 3), page_size: 3 }))
    expect(await pageAll('six', 3, six)).toEqual([0, 1, 2, 3, 4, 5])
    expect(six.mock.calls.map(([p]) => p)).toEqual([1, 2, 3])
    // Through the door: every read's total under-reports (1) at 3 per page → the same answers.
    const normal = [await data.listStaff(STORE.tokyo), await data.listCustomers(VIEW_ALL), await data.listAppointments(VIEW_ALL)]
    withReads({ forcePageSize: 3, lyingTotal: 1 })
    expect([await data.listStaff(STORE.tokyo), await data.listCustomers(VIEW_ALL), await data.listAppointments(VIEW_ALL)]).toEqual(normal)
  })
  it('(8) a core error propagates — never an empty list', async () => {
    const spy = withReads()
    spy.staffList.mockRejectedValue(new Error('502'))
    await expect(data.listStaff(STORE.tokyo)).rejects.toThrow('502')
  })
})

describe('(9) storeSample — the three bypass sites’ one read', () => {
  it('OFF: exactly defaultKindOf + storeDials, including the throw', () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const allLive = Object.fromEntries(Object.keys(PRACTICE_PLANES).map((k) => [k, 'live']))
    expect(storeSample(false, STORE_A)).toEqual({ state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A], marked: false, planes: allLive })
    expect(() => storeSample(false, 'nope')).toThrow('Missing default kind for store nope')
  })
  it('ON: by sample policy; a live uuid never throws', () => {
    // Reserve S66 §9 R1 — the admitted store's six booking rules read core's row: bookingPolicy is its one override.
    expect(storeSample(true, STORE.tokyo)).toEqual({ state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A], marked: true, planes: { ...PRACTICE_PLANES, bookingPolicy: 'live' } })
    expect(STORE_PLANE_OVERRIDES).toEqual({ [STORE.tokyo]: { bookingPolicy: 'live' } })
    // ⚖ PR-3 V4-2 — every practice store (and any id the table does not name) takes a plane WITH dials.
    const onA = { state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A], marked: true, planes: PRACTICE_PLANES }
    expect(storeSample(true, STORE.laEstro)).toEqual(onA)
    expect(storeSample(true, STORE.devSalon)).toEqual(onA)
    expect(storeSample(true, 'nope')).toEqual(onA)
  })
  // ⚖ PR-3 — the mark keys on the door being ON, never on `state === 'sample'`
  // (which is also every OFF answer).
  it('PR-3 marked: OFF false on every fixture store; ON true on a twin and on a borrower (V4-2)', () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    for (const id of [STORE_A, STORE_B]) expect(storeSample(false, id)).toMatchObject({ state: 'sample', marked: false })
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    expect(storeSample(true, STORE.tokyo)).toMatchObject({ state: 'sample', marked: true })
    expect(storeSample(true, STORE.devSalon)).toMatchObject({ state: 'sample', marked: true })
  })
  // ⚖ PR-3 §v4 V4-2 — ⚠1/⚠2: no practice store is empty, no id answers `none`.
  const SEVEN = {
    devSalon: '5a171878-4faa-4512-ba07-17ca4e20ab9e', devGinza: 'a1a26517-33c0-4e73-9ea2-e56e98d99c6f',
    tokyo: 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f', yokohama: '8ac43a4b-7763-4a10-9f73-a662085460af',
    laEstro: '8696b856-11ab-4879-9290-bef40b03ea66', gym: 'c33e4c43-bc3b-4470-ac22-aa60fecdabe3',
    jiyugaoka: '0e8fd5dd-8da6-48c4-9ad2-2ab305aa907c',
  }
  it('(a) every practice store + the fallback: dials non-null, words = its plane\'s own (the fixture kinds carry null words)', () => {
    for (const id of [...Object.values(SEVEN), 'not-in-the-table']) {
      const s = storeSample(true, id)
      expect({ id, state: s.state, dials: s.dials !== null }).toEqual({ id, state: 'sample', dials: true })
      const fixture = samplePolicyFor(id)
      expect(fixture.kind).toBe('twin')
      if (fixture.kind === 'twin') {
        expect(s.words).toBe(defaultKindOf(fixture.fixtureStoreId).words)
        expect(s.dials).toBe(storeDials[fixture.fixtureStoreId])
      }
    }
  })
  it('(b) an unknown uuid under ON: sample, dials non-null, marked', () => {
    expect(storeSample(true, '11111111-2222-4333-8444-555555555555')).toMatchObject({ state: 'sample', dials: storeDials[STORE_A], marked: true })
  })
  it('(c) no-sample-policy is unreachable under ON — the seven + three random uuids', () => {
    const random = ['0f0f0f0f-1e1e-4d2d-8c3c-4b4b4b4b4b4b', 'ffffffff-ffff-4fff-bfff-ffffffffffff', '12345678-9abc-4def-8123-456789abcdef']
    for (const id of [...Object.values(SEVEN), ...random]) expect({ id, state: storeSample(true, id).state }).toEqual({ id, state: 'sample' })
  })
  it('(d) La Estro keeps its 業種 (esthetic_salon) while its dials are STORE_A\'s', async () => {
    expect(samplePolicyFor(SEVEN.laEstro)).toEqual({ kind: 'twin', type: 'beauty_chiropractic', fixtureStoreId: STORE_A, business_type: 'esthetic_salon' })
    expect(storeSample(true, SEVEN.laEstro).dials).toBe(storeDials[STORE_A])
  })
})

describe('(9b) ⚖ PR-3 §v3 — the plane table, ONE home per store × plane', () => {
  const SHIPPED = structuredClone(STORE_PLANE_OVERRIDES) // Reserve S66 — the table ships one row (テスト東京店 · bookingPolicy)
  afterEach(() => {
    for (const k of Object.keys(STORE_PLANE_OVERRIDES)) delete STORE_PLANE_OVERRIDES[k]
    Object.assign(STORE_PLANE_OVERRIDES, structuredClone(SHIPPED))
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
  })
  const BOARD = ['shifts', 'absence', 'sellSlots', 'operatingHours'] as const
  // ⚖ §v6 V6-2 — every plane but ONE: #1049 connected 予約の色分け's read (core's per-store colours), so
  // `bookingColors` is LIVE in the practice table; every other plane stays SAMPLE.
  it('every plane is SAMPLE for the practice business but bookingColors (LIVE, §v6 V6-2), and `marked` IS 「some plane is sample」', () => {
    expect(Object.entries(PRACTICE_PLANES).filter(([, s]) => s !== 'sample')).toEqual([['bookingColors', 'live']])
    expect(sampleWhole(true, STORE.tokyo, 'bookingColors')).toBeUndefined()
    expect(sampleWhole(true, STORE.tokyo, 'language')).toEqual({ form: 'whole' })
    const s = storeSample(true, STORE.tokyo)
    expect(s.state === 'sample' && s.marked === Object.values(s.planes).some((p) => p === 'sample')).toBe(true)
  })
  it('OFF: no mark from either reader, on any store; the planes read all live', () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    for (const id of [STORE_A, STORE_B]) {
      expect(sampleWhole(false, id, 'auditLog')).toBeUndefined()
      expect(samplePart(false, id, ...BOARD)).toBeUndefined()
      const s = storeSample(false, id)
      expect(s.state === 'sample' && Object.values(s.planes).every((p) => p === 'live')).toBe(true)
    }
  })
  it('F-6 — no store in view (a storeless 設定 / an empty list): no mark, never a storeSample call', () => {
    expect(sampleWhole(true, null, 'auditLog')).toBeUndefined()
    expect(samplePart(true, null, 'staffActive')).toBeUndefined()
    expect(sampleWhole(true, [], 'decisions')).toBeUndefined()
  })
  it('ON: whole form; part form names its planes by the native-pass labels, deduped (shifts + absence = ONE label), in order', () => {
    expect(sampleWhole(true, STORE.tokyo, 'auditLog')).toEqual({ form: 'whole' })
    expect(samplePart(true, STORE.tokyo, ...BOARD)).toEqual({ form: 'part', labels: ['シフトと休み', '販売可能枠', '営業時間'] })
    expect(samplePart(true, STORE.tokyo, 'staffActive')).toEqual({ form: 'part', labels: ['稼働状態'] })
  })
  it('flipping ONE plane live for ONE store removes that plane and nothing else; a plane still sample elsewhere in view keeps it', () => {
    STORE_PLANE_OVERRIDES[STORE.tokyo] = { operatingHours: 'live' }
    expect(sampleWhole(true, STORE.tokyo, 'operatingHours')).toBeUndefined()
    expect(samplePart(true, STORE.tokyo, ...BOARD)).toEqual({ form: 'part', labels: ['シフトと休み', '販売可能枠'] })
    expect(sampleWhole(true, STORE.tokyo, 'shifts')).toEqual({ form: 'whole' })
    expect(sampleWhole(true, STORE.yokohama, 'operatingHours')).toEqual({ form: 'whole' })
    expect(sampleWhole(true, [STORE.tokyo, STORE.yokohama], 'operatingHours')).toEqual({ form: 'whole' })
    expect(storeSample(true, STORE.tokyo)).toMatchObject({ state: 'sample', marked: true })
    STORE_PLANE_OVERRIDES[STORE.tokyo] = Object.fromEntries(Object.keys(PRACTICE_PLANES).map((k) => [k, 'live']))
    expect(storeSample(true, STORE.tokyo)).toMatchObject({ state: 'sample', marked: false })
    expect(samplePart(true, STORE.tokyo, ...BOARD)).toBeUndefined()
    expect(planesOf('toString')).toEqual(PRACTICE_PLANES)
  })
  it('every plane names its CONTRACT-MAP row (the lane harness reads the map against this table)', () => {
    expect(PLANE_ROW).toMatchObject({ inboxThreads: 'FixtureThread.id', registerLedger: 'FixtureBookingTransaction.appointment_id' })
    expect(PRACTICE_PLANES).toMatchObject({ inboxThreads: 'sample', registerLedger: 'sample' })
    expect(Object.keys(PLANE_ROW).sort()).toEqual(Object.keys(PRACTICE_PLANES).sort())
    expect(Object.values(PLANE_ROW).every((r) => r.length > 0)).toBe(true)
    expect(PLANE_MAP_SAYS_LIVE.every((k) => k in PLANE_ROW)).toBe(true)
    // Reserve S66 — bookingPolicy's read is connected (setReservePolicy / settings-props), so it left the list.
    expect(PLANE_MAP_SAYS_LIVE).toEqual(['closures'])
  })
  it('a borrowed label is the field\'s OWN on-screen name, verbatim from the block that prints it', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/settings/settings-props.ts'), 'utf8')
    for (const word of ['住所', '電話番号', '店舗写真']) expect(src).toContain(`'store-hours.row-${{ 住所: 'address', 電話番号: 'phone', 店舗写真: 'photo' }[word]}', '${word}'`)
    expect(src).toContain('いまある内容の表示・非表示はここで切り替えられます。')
    expect(src).toContain("block('services.tickets', '回数券の整合'")
    expect(src).toContain('本部による一括の管理は使っていません。')
    expect(PLANE_LABEL.storeProfile).toEqual(['住所', '電話番号', '店舗写真'])
    expect(PLANE_LABEL.menuVisible).toEqual(['表示・非表示'])
    expect(PLANE_LABEL.tickets).toEqual(['回数券'])
    expect(PLANE_LABEL.company).toEqual(['本部による一括の管理'])
    // Reserve S66 R1 — 受付ウィンドウ's fixture rows, each its row title verbatim.
    for (const word of PLANE_LABEL.opsConfig) expect(src).toMatch(new RegExp(`row\\(\\s*'reserve\\.row-[a-z]+',\\s*'${word}'`))
    expect(samplePart(true, STORE.tokyo, 'opsConfig')).toEqual({ form: 'part', labels: [...PLANE_LABEL.opsConfig] })
    expect(sampleWhole(true, STORE.tokyo, 'bookingPolicy')).toBeUndefined()
    expect(sampleWhole(true, STORE.devSalon, 'bookingPolicy')).toEqual({ form: 'whole' })
  })
  it('V4-3 — the sample history credits the fixture operator, never the admitted person', () => {
    expect(historyOperatorName()).toBe(operator.name)
    expect(historyOperatorName()).toBe('見本 あずさ')
  })
})

describe('(10) sampleKeys + sampleRows', () => {
  it('sampleKeys: keys become live uuids; a key with no twin is dropped', () => {
    const out = sampleKeys('staff', { ...staffQualifications, 'p-99': ['x'] })
    expect(Object.keys(out).length).toBe(Object.keys(staffQualifications).length)
    expect(Object.keys(out).every((k) => /^[0-9a-f-]{36}$/.test(k))).toBe(true)
    expect(out[liveIdOf('staff', 'p-01')!]).toEqual(staffQualifications['p-01'])
    expect(() => sampleKeys('staff', JSON.parse('{"__proto__":1}'))).toThrow('refused key "__proto__"')
  })
  it('sampleRows: a STORE_C row is dropped, a null-store row kept, a twin store rewritten', () => {
    const out = sampleRows([{ store_id: STORE_C }, { store_id: null }, { store_id: STORE_A }], null)
    expect(out).toEqual([{ store_id: null }, { store_id: STORE.tokyo }])
  })
  it('the recorded membership is derived from the fixture world, not hand-listed', () => {
    expect(membership(STORE.tokyo)).toContain(liveIdOf('customers', 'cus-01'))
    expect(membership(STORE.tokyo)).not.toContain(liveIdOf('customers', 'cus-10')) // never booked anywhere
    expect(membership(STORE.devSalon)).toEqual([])
    expect(customers.length).toBe(13)
    expect(STAFF).toHaveLength(22) // ⚖ §v11 PR-B — + the gym's five
    // ⚖ §v11 PR-B — REWRITTEN (was: むすび has no row): every recorded store but the gym, whose roster is production's five.
    expect(ASSIGNMENTS[CARD.musubi]).toEqual(STORES.filter((x) => x.active && x.id !== STORE.gym).map((x) => x.id))
  })
})

describe('(11) PR-2b — 設定 reads its ROWS through the door; SAMPLE follows the store policy', () => {
  type Props = Awaited<ReturnType<typeof settingsProps>>['props']
  const sec = (props: Props, id: string) => props.sections.find((s) => s.id === id)!
  const blockOf = (props: Props, sectionId: string, blockId: string) => sec(props, sectionId).blocks.find((b) => b.id === blockId)!
  const controlOf = (props: Props, id: string) =>
    props.sections.flatMap((s) => s.blocks.flatMap((b) => b.rows.flatMap((r) => r.controls))).find((c) => c.id === id)!
  // ⚖ PR-3 — the bare 「サンプル設定なし」 is gone: a SAMPLE part with no sample
  // plane is the block's (or the page's) `sampleNone` card, and a SAMPLE block
  // under the door carries `sample`. Rows keep their live facts, never a placeholder.
  const everyBlock = (props: Props) => props.sections.flatMap((x) => x.blocks)

  it('twin 東京: the roster is listStaff (core 稼働 beats a fixture 休止; a no-twin person appears), menus are listMenus, 事業構成 is the shell + the live stores', async () => {
    const { props } = await settingsProps({ locale: 'ja', store: STORE.tokyo })
    expect(props.sections.filter((s) => s.kicker === '店舗を選んでください')).toEqual([])
    const live = ids(await data.listStaff(STORE.tokyo))
    // 人・設備
    const people = blockOf(props, 'people-equipment', 'people.staff').rows
    expect(people.map((r) => r.id).sort()).toEqual(live.map((id) => `people.row-${id}`).sort())
    const mirai = liveIdOf('staff', 'p-09')!
    expect(storeDials[STORE_A].staffActive['p-09']).toBe(false) // the fixture says 休止…
    expect(controlOf(props, `people.active-${mirai}`).value).toBe(true) // …core lists her active, and core wins
    expect(people.find((r) => r.id === `people.row-${CARD.musubi}`)!.meta).toEqual([]) // no twin → no sample role, and no placeholder
    expect(people.find((r) => r.id === `people.row-${CARD.azusa}`)!.meta).toEqual([rulebook.roles.find((r) => r.key === 'manager')!.label])
    // スタッフ管理
    expect(blockOf(props, 'staff', 'staff.roster').rows.map((r) => r.id).sort()).toEqual(live.map((id) => `staff.row-${id}`).sort())
    expect(blockOf(props, 'staff', 'staff.roster').rows.find((r) => r.id === `staff.row-${CARD.musubi}`)!.controls).toEqual([])
    expect(controlOf(props, `staff.preset-${CARD.azusa}`).value).toBe('manager')
    // 提供内容: 東京's live menus + 全店舗; 表示 through the twin
    const menuRows = blockOf(props, 'services', 'services.menus').rows
    expect(menuRows.map((r) => r.id)).toEqual([MENU.seitai, MENU.kotsuban, MENU.stretch, MENU.zenten].map((id) => `services.row-${id}`))
    expect(controlOf(props, `services.visible-${MENU.stretch}`).value).toBe(false) // twin menu-03 is 非表示
    // 回数券の整合: the floor is the twin menu's LIVE price × 0.7, never ¥0
    expect(blockOf(props, 'services', 'services.tickets').rows[0].meta[0]).toBe(`対象メニューの最低価格 ${yen(4620)}`)
    // 料金・ポイント: bands from the live menus; the target through the store's fixture self
    expect(controlOf(props, `pricing.hi-${MENU.seitai}`).value).toBe('6600')
    expect(salesTargets[STORE_A]).toBeGreaterThan(0)
    expect(controlOf(props, 'pricing.target').value).toBe(String(salesTargets[STORE_A]))
    // 事業構成
    const org = blockOf(props, 'business-structure', 'org.stores')
    expect(org.note).toBe('Dev Salonが運営する店舗の一覧です。ほかの店舗の設定はここからは変更できません。')
    expect(org.table!.rows.map((r) => r.cells[0])).toEqual(['Dev Salon', 'Dev 銀座', 'テスト東京店', 'テスト横浜店', 'La Estro Test Store', 'テスト恵比寿ジム', 'テスト自由が丘店'])
    expect(org.table!.rows.map((r) => r.cells[1])).toEqual(['—', '—', 'いま見ている店舗', '—', '—', '—', '—'])
    expect(blockOf(props, 'business-structure', 'org.brand').facts[0]).toMatch(/^7店舗の運営のため/)
    // 予約同期: the shell's own stamp, 12 minutes before the board's moment
    expect(blockOf(props, 'sync', 'sync.status').facts[0]).toMatch(/^最終同期は12分前/)
    // ⚖ PR-3 — the mark: SAMPLE blocks carry it, ROW blocks never; a twin has no no-sample card.
    // ⚖ §v3 V3-3 — its FORM: whole where every value is sample; part (named) over live rows.
    expect(blockOf(props, 'audit-log', 'audit.rows').sample).toEqual({ form: 'whole' })
    expect(blockOf(props, 'business-structure', 'org.entity').sample).toEqual({ form: 'whole' })
    expect(blockOf(props, 'people-equipment', 'people.staff').sample).toEqual({ form: 'part', labels: ['役職と表示'] }) // §v5 V5-1 — the role echo, never the live 稼働
    expect(blockOf(props, 'staff', 'staff.roster').sample).toEqual({ form: 'part', labels: ['役職と表示'] })
    expect(blockOf(props, 'store-hours', 'store-hours.info').sample).toEqual({ form: 'part', labels: ['住所', '電話番号', '店舗写真'] })
    expect(blockOf(props, 'store-hours', 'store-hours.hours').sample).toEqual({ form: 'whole' })
    expect(blockOf(props, 'services', 'services.menus').sample).toEqual({ form: 'part', labels: ['表示・非表示'] })
    expect(blockOf(props, 'services', 'services.tickets').sample).toEqual({ form: 'part', labels: ['回数券'] })
    expect(sec(props, 'booking-guard').sample).toEqual({ form: 'part', labels: ['予約と確保の設定'] }) // F2 — block-less
    // ⚖ §v3 V3-8 — 業種 (no core field yet) and the 本部 sentence are sample and say so.
    expect(blockOf(props, 'people-equipment', 'people.business-type').sample).toEqual({ form: 'whole' })
    expect(blockOf(props, 'business-structure', 'org.brand').sample).toEqual({ form: 'part', labels: ['本部による一括の管理'] }) // §v5 V5-2 — the store count is live
    // ⚖ §v4 V4-3 — the sample history credits the fixture operator, never the signed-in person.
    // Reserve S66 R11/R11b — the two LIVE 受付 blocks print core's own date (updated_at) or nothing; every other
    // block's line is the sample history and names the sample operator.
    const LIVE_RESERVE = ['reserve.window', 'reserve.cancel']
    const audits = everyBlock(props).filter((b) => !LIVE_RESERVE.includes(b.id)).map((b) => b.audit).filter((a): a is string => a !== null)
    expect(audits.length).toBeGreaterThan(5)
    expect(audits.every((a) => a.startsWith('最終変更: 見本 あずさ ・'))).toBe(true)
    for (const id of LIVE_RESERVE) expect(blockOf(props, 'reserve-acceptance', id).audit ?? null).toMatch(/^最終変更: \d+月\d+日\(.\)$/)
    // ⚖ §v3 V3-5 — the dateline drops サンプルデータ under the door (the topbar names the practice world).
    expect(props.dateline).not.toContain('サンプルデータ')
    expect(props.dateline.endsWith(' / テスト東京店')).toBe(true)
    for (const [sid, bid] of [['business-structure', 'org.stores'], ['audit-log', 'audit.filter'], ['people-equipment', 'people.equipment'], ['pricing-points', 'pricing.bands']]) {
      expect(blockOf(props, sid, bid)).not.toHaveProperty('sample')
    }
    expect(everyBlock(props).filter((b) => b.sampleNone)).toEqual([])
    expect(props.sections.filter((x) => x.sampleNone)).toEqual([])
  })

  it('予約同期 on a wall clock 37 s past the board minute still says 12分前 — the board anchor, never the wall clock', async () => {
    // Every other clock here sits on :00.000, where the wall clock and the board anchor agree.
    jest.setSystemTime(new Date('2026-09-14T04:24:37Z'))
    try {
      const { props } = await settingsProps({ locale: 'ja', store: STORE.tokyo })
      expect(blockOf(props, 'sync', 'sync.status').facts[0]).toMatch(/^最終同期は12分前/)
    } finally {
      jest.setSystemTime(new Date('2026-09-14T04:24:00Z'))
    }
  })

  // ⚖ PR-3 §v4 V4-2 — PRACTICE MODE = EVERYTHING FILLED IN: a store that is not an
  // exact twin borrows a fixture plane, so it shows the same filled page a twin does.
  it.each([
    ['La Estro (borrows 東京, keeps esthetic_salon)', STORE.laEstro],
    ['Dev Salon (borrows 東京)', STORE.devSalon],
  ])('%s: never 店舗を選んでください, never a no-sample card; live rows render and every SAMPLE block is filled and marked', async (_label, store) => {
    const { props } = await settingsProps({ locale: 'ja', store })
    expect(props.sections.filter((s) => s.kicker === '店舗を選んでください')).toEqual([])
    const people = blockOf(props, 'people-equipment', 'people.staff').rows
    expect(people.map((r) => r.id)).toEqual(ids(await data.listStaff(store)).map((id) => `people.row-${id}`))
    expect(people.length).toBeGreaterThan(0)
    const menuRows = blockOf(props, 'services', 'services.menus').rows
    expect(menuRows.map((r) => r.id)).toEqual(ids(await data.listMenus(store)).map((id) => `services.row-${id}`))
    expect(everyBlock(props).filter((b) => b.sampleNone)).toEqual([])
    expect(props.sections.filter((x) => x.sampleNone)).toEqual([])
    for (const [sid, bid] of [['services', 'services.tickets'], ['business-structure', 'org.entity'], ['store-hours', 'store-hours.hours'], ['audit-log', 'audit.rows'], ['payments', 'payments.methods']]) {
      expect({ bid, filled: blockOf(props, sid, bid).sampleNone === undefined, marked: blockOf(props, sid, bid).sample !== undefined }).toEqual({ bid, filled: true, marked: true })
    }
    expect(blockOf(props, 'business-structure', 'org.entity').rows.length).toBe(3)
    expect(blockOf(props, 'audit-log', 'audit.rows').table!.rows.length).toBeGreaterThan(0)
    expect(blockOf(props, 'business-structure', 'org.stores').table!.rows).toHaveLength(7)
    expect(sec(props, 'booking-guard').sample).toBeTruthy()
    // ⚖ FIX-1a (V3-3) — a part mark only where some row draws the sample part. No borrowed
    // person has twin settings, so the roster names nothing; the 全店舗 menu IS twinned
    // (registry menu-06), so its 表示 switch draws here and the menus mark stays.
    const roster = blockOf(props, 'staff', 'staff.roster')
    expect(roster.rows.every((r) => r.controls.length === 0)).toBe(true)
    expect(roster.sample).toBeUndefined()
    // ⚖ §v5 V5-1 — 人・設備's スタッフ: 稼働 is live and no row echoes a twin role, so no mark.
    expect(blockOf(props, 'people-equipment', 'people.staff').sample).toBeUndefined()
    const menus = blockOf(props, 'services', 'services.menus')
    expect(menus.rows.filter((r) => r.controls.length > 0).map((r) => r.id)).toEqual([`services.row-${MENU.zenten}`])
    expect(menus.sample).toEqual({ form: 'part', labels: ['表示・非表示'] })
    expect(JSON.stringify(props)).not.toContain('サンプル設定なし')
    expect(JSON.stringify(props)).not.toContain('現在準備中です')
  })

  it('FIX-1a (V3-3): a borrower whose menus have no twin draws no 表示 switch, so the menus block carries no mark', async () => {
    // The 全店舗 menu is the only twinned menu a borrower lists; without it no row draws the switch.
    const spy = withReads()
    const all = spy.menusList.getMockImplementation()!
    spy.menusList.mockImplementation(async (q: unknown) => {
      const r = await all(q)
      return { ...r, menus: r.menus.filter((m: { store_id: string | null }) => m.store_id !== null) }
    })
    const { props } = await settingsProps({ locale: 'ja', store: STORE.laEstro })
    const menus = blockOf(props, 'services', 'services.menus')
    expect(menus.rows.map((r) => r.id)).toEqual([`services.row-${MENU.body}`])
    expect(menus.rows.every((r) => r.controls.length === 0)).toBe(true)
    expect(menus.sample).toBeUndefined()
    expect(menus.sampleNone).toBeUndefined()
  })

  it('PR-3 業種: a store whose type is \'\' shows 「未設定」 selected and never choosable; a typed store has no such option', async () => {
    // V4-2 leaves no practice store untyped, so the '' store is made here: the D10 path stays pinned for a store with no 業種.
    const real = await data.listStoreOptions()
    ;(data.listStoreOptions as jest.Mock).mockResolvedValueOnce(real.map((s) => (s.id === STORE.devSalon ? { ...s, business_type: '' } : s)))
    const c = controlOf((await settingsProps({ locale: 'ja', store: STORE.devSalon })).props, 'people.type')
    expect(c.value).toBe('')
    expect(c.control.kind === 'select' && c.control.options[0]).toEqual({ value: '', label: '未設定', disabled: true })
    const t = controlOf((await settingsProps({ locale: 'ja', store: STORE.tokyo })).props, 'people.type')
    expect(t.control.kind === 'select' && t.control.options.some((o) => o.value === '')).toBe(false)
    const dev = controlOf((await settingsProps({ locale: 'ja', store: STORE.devSalon })).props, 'people.type')
    expect(dev.value).toBe('beauty_chiropractic')
  })

  it('viewAll (an actor with no visible store): open store sections keep 店舗を選んでください, and no row reader is asked — the door would refuse the lens', async () => {
    as(LOGIN.musubi)
    const spy = withReads()
    await expect(data.listStaff(VIEW_ALL)).rejects.toThrow(PracticeLensRefused)
    spy.menusList.mockClear()
    spy.resourcesList.mockClear()
    spy.staffStoresList.mockClear()
    const { props } = await settingsProps({ locale: 'ja' })
    expect(props.dateline.endsWith('/ すべての店舗')).toBe(true)
    const open = props.sections.filter((s) => RAIL.find((e) => e.id === s.id)!.scope === 'store' && s.gate === 'open')
    expect(open.length).toBeGreaterThan(0)
    expect(open.every((s) => s.kicker === '店舗を選んでください')).toBe(true)
    expect(spy.menusList).not.toHaveBeenCalled()
    expect(spy.resourcesList).not.toHaveBeenCalled()
    expect(spy.staffStoresList).not.toHaveBeenCalled()
  })
})

describe('(12) PR-2b — the register plane under ON is neutral, never fixture money (LIVE-PROOF M-A)', () => {
  it('S84 settlements preserve the full M-A/FE-1 aggregate', async () => {
    await data.readRegisterPlanes(STORE.tokyo, undefined, { transactions: [], closing: null, cashTolerance: 0 })
    expect((await data.readDayPlanes(STORE.tokyo, TODAY)).register).toEqual({ cash_difference: 0, refunds: 0, terminal_held: [] })
  })
  it('readDayPlanes + readReservationPlanes: refunds and cash_difference are 0, whatever the fixture holds', async () => {
    expect(register.refunds).toBeGreaterThan(0) // the fixture refund the door used to spread onto a live 純売上
    const day = await data.readDayPlanes(STORE.tokyo, TODAY)
    expect({ refunds: day.register.refunds, cash_difference: day.register.cash_difference }).toEqual({ refunds: 0, cash_difference: 0 })
    const res = await data.readReservationPlanes(STORE.tokyo)
    expect({ refunds: res.register.refunds, cash_difference: res.register.cash_difference }).toEqual({ refunds: 0, cash_difference: 0 })
  })
})

describe('⚖ A1b — カードの見た目 under ON: the colour comes from org settings through the door, one per business', () => {
  const orgWith = (settings: Record<string, unknown>) => ({ business_id: TENANT, name: 'Dev Salon', settings, created_at: 'x', updated_at: 'x' })
  const look = async (store?: string) => (await settingsProps({ locale: 'ja', store })).props.sections.find((s) => s.id === 'reserve-store-page')!

  it.each([
    ['#1c2247', '#1C2247'],
    ['#1C2247', '#1C2247'],
    ['#285643', '#285643'], // legacy, off-palette: passes through untouched (contract §8)
    ['red', null],
    ['#FFF', null],
    ['#1C2247AA', null],
    [' #1C2247', null],
    [null, null],
    [{}, null],
  ])('reserve_card_color %j → %j', async (stored, want) => {
    withReads().orgSettingsGet.mockResolvedValue(orgWith({ reserve_card_color: stored }))
    expect(await data.readReserveCardColor()).toBe(want)
  })

  it('no key, or no org row at all → null', async () => {
    withReads().orgSettingsGet.mockResolvedValue(orgWith({}))
    expect(await data.readReserveCardColor()).toBeNull()
    withReads({ orgName: null })
    expect(await data.readReserveCardColor()).toBeNull()
  })

  it('R3 — the same value under every lens and in the all-stores view; the section never becomes 店舗を選んでください', async () => {
    const spy = withReads()
    spy.orgSettingsGet.mockResolvedValue(orgWith({ reserve_card_color: '#00304c' }))
    for (const store of [STORE.tokyo, STORE.yokohama]) {
      const s = await look(store)
      expect({ store, gate: s.gate, kicker: s.kicker, value: s.cardLook?.value }).toEqual({ store, gate: 'open', kicker: 'Reserve設定', value: '#00304C' })
    }
    spy.storesList.mockResolvedValue({ stores: [] }) // the owner sees no store: the all-stores view
    const { props } = await settingsProps({ locale: 'ja' })
    expect(props.dateline.endsWith('/ すべての店舗')).toBe(true)
    const all = props.sections.find((s) => s.id === 'reserve-store-page')!
    expect({ gate: all.gate, kicker: all.kicker, value: all.cardLook?.value, storeLine: all.cardLook?.storeLine, address: 'address' in all.cardLook! })
      .toEqual({ gate: 'open', kicker: 'Reserve設定', value: '#00304C', storeLine: '', address: false })
  })

  it('K11 — ON: the cover address is the door’s own store record, never the fixture twin’s', async () => {
    const spy = withReads()
    spy.storesList.mockResolvedValue({ stores: STORES.map((s) => (s.id === STORE.tokyo ? { ...s, address: '東京都港区実在1-2-3' } : s)) })
    expect(await data.readStoreAddress(STORE.tokyo)).toBe('東京都港区実在1-2-3')
    expect((await look(STORE.tokyo)).cardLook!.address).toBe('東京都港区実在1-2-3')
    // 横浜 is a fixture TWIN with a sample address in its dials; core holds none → omitted, never the fixture's
    expect(storeSample(true, STORE.yokohama).dials?.profile.address).toBeTruthy() // the value the old source printed
    expect(await data.readStoreAddress(STORE.yokohama)).toBeNull()
    expect('address' in (await look(STORE.yokohama)).cardLook!).toBe(false)
  })

  it('P2-2 — ONE org-settings read per 設定 render: the shell’s name and the card colour share it', async () => {
    const spy = withReads()
    const colour = data.readReserveCardColor as jest.Mock
    colour.mockClear()
    const { props } = await settingsProps({ locale: 'ja', store: STORE.tokyo })
    expect(props.sections.find((s) => s.id === 'reserve-store-page')!.gate).toBe('open')
    expect(colour).toHaveBeenCalledTimes(1)
    expect(spy.orgSettingsGet).toHaveBeenCalledTimes(1)
  })

  it('P2-2 — a reader the card’s gate shuts out: the colour and the address are never read', async () => {
    as(LOGIN.perry)
    const spy = withReads()
    const colour = data.readReserveCardColor as jest.Mock, address = data.readStoreAddress as jest.Mock
    colour.mockClear()
    address.mockClear()
    const { props } = await settingsProps({ locale: 'ja' })
    expect(props.sections.find((s) => s.id === 'reserve-store-page')!.gate).toBe('no-rights')
    expect(colour).not.toHaveBeenCalled()
    expect(address).not.toHaveBeenCalled()
    expect(spy.orgSettingsGet).toHaveBeenCalledTimes(1) // the shell's own (the business name)
  })

  it('R50 — another admitted business gets the OFF props, byte for byte — nothing of core can reach the payload', async () => {
    const spy = withReads()
    delete process.env.BUSINESS_PRACTICE_TENANT
    const off = await settingsProps({ locale: 'ja' })
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    as(LOGIN.owner, null, '00000000-0000-4000-8000-00000000dead')
    expect(await settingsProps({ locale: 'ja' })).toEqual(off)
    expect(off.props.dateline.startsWith('サンプルデータ ')).toBe(true)
    expect(spy.orgSettingsGet).not.toHaveBeenCalled()
  })
})

describe('(12) PR-3 — 今日の運営 marks its SAMPLE planes under the door', () => {
  // ⚖ S81 F5 — 営業時間 is named only when the hours painted ARE the sample set: 東京's come from its own core week.
  it.each([
    ['twin 東京 (hours from core)', STORE.tokyo, ['シフトと休み', '販売可能枠']],
    ['Dev Salon (borrows 東京; hours sample)', STORE.devSalon, ['シフトと休み', '販売可能枠', '営業時間']],
  ])('%s: the board carries its marks; no 「お客様様」, no raw enum with a dangling 「/」', async (_label, store, labels) => {
    const TodayPage = (await import('@/app/[locale]/(business)/business/today/page')).default
    const el = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store }) })
    const props = (el as unknown as { props: Record<string, unknown> }).props
    // ⚖ §v3 — the grid head names its planes (D2 order); the decisions + 勤務不可 marks are whole.
    expect(props.boardMark).toEqual({ form: 'part', labels })
    expect(props.decisionsMark).toEqual({ form: 'whole' })
    expect(props.absenceMark).toEqual({ form: 'whole' })
    expect(props).not.toHaveProperty('marked')
    const json = JSON.stringify(props)
    expect(json).not.toContain('様様')
    expect(json).not.toMatch(/(MANUAL|QUICKRESERVE|SYNQED_RESERVE|SALON_BOARD|HOT_PEPPER|OTHER) \//)
  })
})

describe('(13) PR-4a — every store\'s board is filled: a borrower is served the borrowed day (⚖ §v7 V7-3)', () => {
  const named = (ids: string[]) => ids.map((id) => ({ id, name: `名 ${id}` }))
  const at = (store: string, roster: string[], rooms: string[] = []) => ({ store, roster: named(roster), rooms: named(rooms) })
  /** ⚖ R8' — Dev Salon with two LIVE rooms (handed out of id order; the door sorts by id). */
  const ROOM_A = '00000000-0000-4000-8000-0000000000d1', ROOM_B = '00000000-0000-4000-8000-0000000000d2'
  const withRooms = () => {
    const room = (id: string, name: string) => ({ id, store_id: STORE.devSalon, name, note: null, room_class: 'standard' as const, cleanup_minutes: 0, display_order: 0, active: true, created_at: 'x', updated_at: 'x' })
    const spy = withReads()
    spy.resourcesList.mockImplementation(async (q?: { store_id?: string }) => ({ resources: q?.store_id === STORE.devSalon ? [room(ROOM_B, '個室B'), room(ROOM_A, '個室A')] : [] }))
    return spy
  }
  const SEAT3 = ['s0', 's1', 's2']
  const shiftOf = (fixtureId: string) => fxShifts.find((s) => s.staff_id === fixtureId)!
  type Board = { cards: Array<{ id: string; title: string; bookingId: string | null }>; cases: Record<string, { meta: string; facts: string[][] }>; myDay: { shift: string } | null }
  const board = async (store: string): Promise<Board> => {
    const TodayPage = (await import('@/app/[locale]/(business)/business/today/page')).default
    const el = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store }) })
    return (el as unknown as { props: Board }).props
  }
  const BORROWERS = [STORE.devSalon, STORE.devGinza, STORE.laEstro, STORE.gym, STORE.jiyugaoka]

  it('a borrower: store rows re-keyed to it, ids + the slot pointer suffixed per store, another store\'s records nulled (R4, nested too); another fixture store\'s row drops', () => {
    const rows = rekeyRows(fxDecisions, [at(STORE.devSalon, SEAT3)], 'attribute')
    expect(rows.map((d) => d.id)).toEqual(fxDecisions.map((d) => `${d.id}~5a171878`))
    expect(rows.every((d) => d.store_id === STORE.devSalon && d.appointment_id === null)).toBe(true)
    expect(rows.map((d) => d.sell_slot_id)).toEqual(fxDecisions.map((d) => d.sell_slot_id && `${d.sell_slot_id}~5a171878`))
    expect(rekeyRows(fxDecisions, [at(STORE.devGinza, SEAT3)], 'attribute')[0].id).toBe('dec-recovery~a1a26517')
    expect(rekeyRows([{ ...fxAbsence, store_id: STORE_B }], [at(STORE.devSalon, SEAT3)], 'identity')).toEqual([])
    const nested = rekeyRows([{ id: 'x', store_id: STORE_A, n: [{ customer_id: 'cus-01', staff_id: 'p-01' }] }], [at(STORE.devSalon, SEAT3)], 'attribute')
    expect(nested[0].n).toEqual([{ customer_id: null, staff_id: 's0' }])
  })

  it('person-identity rows: by position, NO wrap — a fixture person with no seat drops the row (a slot too, R1)', () => {
    const three = rekeyRows(fxShifts, [at(STORE.devSalon, SEAT3)], 'identity')
    expect(three).toEqual([{ ...shiftOf('p-01'), staff_id: 's0' }, { ...shiftOf('c-03'), staff_id: 's2' }, { ...shiftOf('p-02'), staff_id: 's1' }])
    expect(new Set(three.map((s) => s.staff_id)).size).toBe(3)
    expect(rekeyRows(fxShifts, [at(STORE.devSalon, ['s0'])], 'identity')).toEqual([{ ...shiftOf('p-01'), staff_id: 's0' }])
    expect(rekeyRows([fxAbsence], [at(STORE.devSalon, ['s0'])], 'identity')).toEqual([{ ...fxAbsence, store_id: STORE.devSalon, staff_id: 's0' }])
    expect(rekeyRows(fxShifts, [at(STORE.devSalon, [])], 'identity')).toEqual([])
    expect(rekeyRows([fxAbsence], [at(STORE.devSalon, [])], 'identity')).toEqual([])
    expect(rekeyRows(fxSlots, [at(STORE.devSalon, ['s0', 's1', 's2', 's3'], ['r1', 'r2'])], 'identity').map((x) => [x.id, x.staff_id])).toEqual([['slot-01~5a171878', 's3'], ['slot-02~5a171878', 's2']])
    expect(rekeyRows(fxSlots, [at(STORE.devSalon, ['s0'], ['r1', 'r2'])], 'identity')).toEqual([])
  })

  it('R8\' — a borrowed slot sits on the borrower\'s OWN room by position (no wrap), its text names that room; no room → the slot drops', () => {
    const four = ['s0', 's1', 's2', 's3']
    const two = rekeyRows(fxSlots, [at(STORE.devSalon, four, ['room-1', 'room-2'])], 'identity')
    expect(two.map((x) => [x.id, x.resource_id])).toEqual([['slot-01~5a171878', 'room-2'], ['slot-02~5a171878', 'room-1']])
    expect(rekeyRows(fxSlots, [at(STORE.devSalon, four, ['room-1'])], 'identity').map((x) => x.id)).toEqual(['slot-02~5a171878'])
    expect(rekeyRows(fxSlots, [at(STORE.devSalon, four, [])], 'identity')).toEqual([])
    const dec = rekeyRows(fxDecisions, [at(STORE.devSalon, four, ['room-1', 'room-2'])], 'attribute')[2] // dec-capacity
    expect([dec.detail, dec.proofs[1]]).toEqual(['名 s3 + 名 room-2 / 新規オンライン単発', '名 room-2を確保'])
    expect(rekeyRows(fxSlots, [at(STORE.tokyo, four, ['room-1'])], 'identity')).toEqual(sampleRows(fxSlots, null)) // the twin: untouched
  })

  it('P3 — a borrowed room\'s position counts only the BORROWED store\'s fixture rooms (STORE_B\'s ベッド1 is its first, not the 4th)', () => {
    const lenderB = 'b0b0b0b0-0000-4000-8000-000000000004' // a store borrowing 横浜's plane (none does on the recorded world)
    STORE_SAMPLE_POLICY[lenderB] = { kind: 'twin', fixtureStoreId: STORE_B }
    try {
      expect(rekeyRows([{ id: 'x', store_id: STORE_B, staff_id: 'p-01', resource_id: 'bed-04' }], [at(lenderB, ['s0'], ['room-1'])], 'identity'))
        .toEqual([{ id: 'x~b0b0b0b0', store_id: lenderB, staff_id: 's0', resource_id: 'room-1' }])
    } finally {
      delete STORE_SAMPLE_POLICY[lenderB]
    }
  })

  it('R9 — a borrowed row\'s free text names the SEATED person, by the row\'s own seat rule, in one pass; the twin\'s text is untouched', () => {
    const rows = rekeyRows(fxDecisions, [at(STORE.devSalon, SEAT3)], 'attribute')
    expect(rows[0].detail).toBe('名 s0欠勤 / 名 s0 + ベッド1が成立') // はなこ p-01 → seat 0; しろう p-04 → 3 mod 3 = 0
    expect(rows[2].detail).toBe('名 s0 + ベッド2 / 新規オンライン単発')
    const names = fxStaff.map((p) => p.full_name)
    for (const [store, roster] of [[STORE.devSalon, SEAT3], [STORE.laEstro, ['s0']]] as const) {
      const json = JSON.stringify([...rekeyRows(fxDecisions, [at(store, [...roster])], 'attribute'), ...rekeyRows([...fxShifts, fxAbsence, ...fxSlots], [at(store, [...roster])], 'identity')])
      expect({ store, named: names.filter((n) => json.includes(n)) }).toEqual({ store, named: [] })
    }
    // one pass: a seat whose live name IS another fixture name is never re-read
    const swap = rekeyRows([{ ...fxDecisions[0], proofs: ['見本 はなこ / 見本 しろう'] }], [{ store: STORE.devSalon, roster: [{ id: 'a', name: '見本 しろう' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }], rooms: [] }], 'attribute')
    expect(swap[0].proofs).toEqual(['見本 しろう / D'])
    // an identity row naming a person with no seat drops, like its own person would
    expect(rekeyRows([{ ...fxAbsence, reason: '見本 みらい' }], [at(STORE.devSalon, ['s0'])], 'identity')).toEqual([])
    expect(rekeyRows(fxDecisions, [at(STORE.tokyo, SEAT3)], 'attribute').map((d) => d.detail)).toEqual(fxDecisions.map((d) => d.detail))
  })

  it('P1 — a fixture name that another one prefixes is replaced WHOLE (longest first): ベッド12 → the 4th room, never 〈ベッド1\'s room〉2', async () => {
    // FIXTURE_NAME is built once at load, so the facade is loaded fresh AFTER the room joins the fixture.
    await jest.isolateModulesAsync(async () => {
      const today = await import('@/business/lib/fixtures-today')
      today.resources.push({ id: 'bed-12', store_id: STORE_A, kind_id: 'k-a', name: 'ベッド12', note: '', cleanup_minutes: 0, room_class: 'standard' })
      try {
        const facade = await import('@/business/lib/practice-door/sample-facade')
        const [row] = facade.rekeyRows([{ id: 'x', store_id: STORE_A, detail: 'ベッド12を確保' }], [at(STORE.devSalon, SEAT3, ['r0', 'r1', 'r2', 'r3'])], 'attribute')
        expect(row.detail).toBe('名 r3を確保')
      } finally {
        today.resources.pop()
      }
    })
  })

  it('P2 — a row\'s own id and its slot pointer are never read as free text; a nested text field is', () => {
    const [row] = rekeyRows([{ id: 'dec-見本 はなこ', store_id: STORE_A, sell_slot_id: 'slot-見本 しろう', n: { note: '見本 はなこ' } }], [at(STORE.devSalon, SEAT3)], 'attribute')
    expect(row).toEqual({ id: 'dec-見本 はなこ~5a171878', store_id: STORE.devSalon, sell_slot_id: 'slot-見本 しろう~5a171878', n: { note: '名 s0' } })
  })

  it('decision person attributes wrap (n mod seats), null on an empty roster', () => {
    const one = rekeyRows(fxDecisions, [at(STORE.devSalon, ['s0'])], 'attribute')
    expect(one.map((d) => d.owner_staff_id)).toEqual(fxDecisions.map((d) => (d.owner_staff_id === null ? null : 's0')))
    expect(rekeyRows(fxDecisions, [at(STORE.devSalon, SEAT3)], 'attribute')[0].owner_staff_id).toBe('s2') // p-06 = 5 → 5 mod 3
    const none = rekeyRows(fxDecisions, [at(STORE.devSalon, [])], 'attribute')
    expect(none).toHaveLength(fxDecisions.length)
    expect(none.every((d) => d.owner_staff_id === null)).toBe(true)
  })

  it('R2 — 資格 and 定価 key onto the borrower\'s seats, no seat → no entry', () => {
    expect(rekeyKeys(staffQualifications, [at(STORE.devSalon, ['s0', 's1'])])).toEqual({ s0: staffQualifications['p-01'], s1: staffQualifications['p-02'] })
    expect(rekeyKeys(fxListPrice, [at(STORE.devSalon, ['s0'])])).toEqual({ s0: fxListPrice['p-01'] })
    expect(rekeyKeys(fxListPrice, [at(STORE.devSalon, [])])).toEqual({})
  })

  it('an exact twin (東京/横浜) is untouched whatever its roster: the registry person map, the plain ids, the registry keys', () => {
    for (const roster of [[], ['s0'], SEAT3]) {
      expect(rekeyRows(fxDecisions, [at(STORE.tokyo, roster)], 'attribute')).toEqual(sampleRows(fxDecisions, null))
      expect(rekeyRows(fxShifts, [at(STORE.tokyo, roster)], 'identity')).toEqual(sampleFor(fxShifts, null))
      expect(rekeyRows(fxSlots, [at(STORE.tokyo, roster)], 'identity')).toEqual(sampleRows(fxSlots, null))
      expect(rekeyKeys(staffQualifications, [at(STORE.tokyo, roster)])).toEqual(sampleKeys('staff', staffQualifications))
      expect(rekeyRows(fxShifts, [at(STORE.yokohama, roster)], 'identity')).toEqual(sampleFor(fxShifts, null))
      expect(rekeyRows([fxAbsence, ...fxDecisions], [at(STORE.yokohama, roster)], 'attribute')).toEqual([])
    }
  })

  it('viewAll = exact twins first (R3), then every borrower\'s own rows; a person\'s day deduped by staff_id, a slot never', () => {
    const view = [at(STORE.devSalon, ['m', 'a']), at(STORE.devGinza, ['m']), at(STORE.tokyo, [])]
    expect(rekeyRows(fxShifts, view, 'identity').map((s) => s.staff_id)).toEqual([...sampleFor(fxShifts, null).map((s) => s.staff_id), 'm', 'a'])
    expect(rekeyRows([fxAbsence], view, 'identity').map((a) => [a.store_id, a.staff_id])).toEqual([[STORE.tokyo, liveIdOf('staff', 'p-01')], [STORE.devSalon, 'm']])
    const dec = rekeyRows(fxDecisions, view, 'attribute')
    expect(dec.map((d) => d.store_id)).toEqual([STORE.tokyo, STORE.devSalon, STORE.devGinza].flatMap((s) => fxDecisions.map(() => s)))
    expect(new Set(dec.map((d) => d.id)).size).toBe(dec.length)
    const four = ['a', 'b', 'c', 'm']
    expect(rekeyRows(fxSlots, [at(STORE.devSalon, four, ['r1', 'r2']), at(STORE.devGinza, four, ['r1', 'r2'])], 'identity')).toHaveLength(4)
    expect(rekeyKeys(fxListPrice, view)).toEqual({ ...sampleKeys('staff', fxListPrice), m: fxListPrice['p-01'], a: fxListPrice['p-02'] })
  })

  it('pure and deterministic: the same input twice gives the same rows; the fixture is never mutated', () => {
    const before = JSON.stringify([fxShifts, fxAbsence, fxDecisions, fxSlots])
    const view = [at(STORE.laEstro, SEAT3), at(STORE.devSalon, ['s0'])]
    expect(rekeyRows(fxDecisions, view, 'attribute')).toEqual(rekeyRows(fxDecisions, view, 'attribute'))
    expect(rekeyRows(fxShifts, view, 'identity')).toEqual(rekeyRows(fxShifts, view, 'identity'))
    expect(rekeyKeys(staffQualifications, view)).toEqual(rekeyKeys(staffQualifications, view))
    expect(JSON.stringify([fxShifts, fxAbsence, fxDecisions, fxSlots])).toBe(before)
  })

  it('the door, Dev Salon: decisions, the 勤務不可 row, shifts, 資格 and 定価 on its own store and roster; every door reader agrees (R5)', async () => {
    const planes = await data.readDayPlanes(STORE.devSalon, TODAY)
    const roster = ids(await data.listStaff(STORE.devSalon))
    expect([planes.decisions, planes.sellSlots]).toEqual([[], []]) // R8' — the recorded world: 0 rooms, no slot, no card
    expect(roster).toContain(planes.absence?.staff_id)
    expect(planes.shifts.length).toBeGreaterThan(0)
    expect(planes.shifts.every((s) => roster.includes(s.staff_id))).toBe(true)
    expect(new Set(planes.shifts.map((s) => s.staff_id)).size).toBe(planes.shifts.length)
    // R2 — the person seated on p-04 (Invite Probe, 4th by id) carries p-04's 資格 and 定価
    expect([planes.staffQualifications[CARD.probe], planes.staffListPrice[CARD.probe]]).toEqual([staffQualifications['p-04'], fxListPrice['p-04']])
    expect((await data.listShiftsByDay(STORE.devSalon, { from: TODAY, to: TODAY })).get(TODAY)).toEqual(planes.shifts)
    expect((await data.listAbsenceByDay(STORE.devSalon, { from: TODAY, to: TODAY })).get(TODAY)).toEqual(planes.absence)
    const res = await data.readReservationPlanes(STORE.devSalon)
    expect([res.shifts, res.absence, res.staffQualifications, res.sellSlots]).toEqual([planes.shifts, planes.absence, planes.staffQualifications, planes.sellSlots])
  })

  it('R8\' + R9, the door with live rooms: Dev Salon\'s slot sits on its own room; the card, its text and the inspector name the seated person and that room', async () => {
    withRooms()
    const probe = STAFF.find((s) => s.id === CARD.probe)!.name
    const planes = await data.readDayPlanes(STORE.devSalon, TODAY)
    expect(planes.sellSlots.map((x) => [x.id, x.staff_id, x.resource_id])).toEqual([['slot-01~5a171878', CARD.probe, ROOM_B], ['slot-02~5a171878', CARD.perry, ROOM_A]])
    expect(planes.decisions.map((d) => [d.id, d.detail, d.proofs[1]])).toEqual([['dec-capacity~5a171878', `${probe} + 個室B / 新規オンライン単発`, '個室Bを確保']])
    expect(JSON.stringify([planes.decisions, planes.sellSlots])).not.toMatch(new RegExp(fxStaff.map((p) => p.full_name).join('|')))
    const p = await board(STORE.devSalon)
    expect(p.cards.map((c) => [c.title, p.cases[c.id].facts[0]])).toEqual([['16:00の安全な1枠を販売する', ['担当・設備', `${probe} / 個室B`]]])
    expect((await data.readUnresolvedCounts()).byStore[STORE.devSalon]).toBe(1)
  })

  it('§v9 V9-3 — rooms are read only for a store that BORROWS: never for 東京/横浜, once per borrower, once per borrower in view', async () => {
    const spy = withReads()
    const shiftsOf = (lens: string | typeof VIEW_ALL) => data.listShiftsByDay(lens, { from: TODAY, to: TODAY })
    await shiftsOf(STORE.tokyo)
    await shiftsOf(STORE.yokohama)
    expect(spy.resourcesList).not.toHaveBeenCalled()
    for (const store of BORROWERS) {
      spy.resourcesList.mockClear()
      await shiftsOf(store)
      expect(spy.resourcesList.mock.calls).toEqual([[{ store_id: store, active: true }]])
    }
    spy.resourcesList.mockClear()
    await shiftsOf(VIEW_ALL)
    const byStore = (a: { store_id: string }, b: { store_id: string }) => a.store_id.localeCompare(b.store_id)
    expect(spy.resourcesList.mock.calls.map(([q]) => q).sort(byStore)).toEqual(BORROWERS.map((store_id) => ({ store_id, active: true })).sort(byStore))
  })

  it('R9 — no fixture staff name in anything a borrower is served (decisions · slots · shifts · 勤務不可 · resources · 予約一覧)', async () => {
    const names = fxStaff.map((p) => p.full_name)
    for (const store of BORROWERS) {
      const d = await data.readDayPlanes(store, TODAY)
      const r = await data.readReservationPlanes(store)
      const json = JSON.stringify([d.decisions, d.sellSlots, d.shifts, d.absence, await data.listResources(store), r.shifts, r.absence, r.sellSlots])
      expect({ store, named: names.filter((n) => json.includes(n)) }).toEqual({ store, named: [] })
    }
  })

  it('R1 + R4, rendered: a borrower\'s cards compose on its own records — no 「の…」 title, no other store\'s booking or customer, the slot on the seated person', async () => {
    const foreign = [
      ...fxDecisions.flatMap((d) => (d.appointment_id ? [liveIdOf('appointments', d.appointment_id)!] : [])),
      ...CUSTOMERS.filter((c) => membership(STORE.tokyo).includes(c.id)).map((c) => c.name),
    ]
    for (const store of BORROWERS) {
      const p = await board(store)
      const cases = p.cards.map((c) => p.cases[c.id])
      expect({ store, heads: p.cards.filter((c) => c.title.startsWith('の') || c.bookingId !== null) }).toEqual({ store, heads: [] })
      expect({ store, unset: cases.filter((k) => k.meta === '枠未設定') }).toEqual({ store, unset: [] })
      const json = JSON.stringify([p.cards, cases])
      expect({ store, named: [...foreign, ...fxStaff.map((x) => x.full_name)].filter((f) => json.includes(f)) }).toEqual({ store, named: [] })
    }
    // R8' — the recorded world has 0 rooms at every store: no borrower is served a slot or a card
    for (const store of BORROWERS) {
      const out = { store, cards: (await board(store)).cards, slots: (await data.readDayPlanes(store, TODAY)).sellSlots }
      expect(out).toEqual({ store, cards: [], slots: [] })
    }
  })

  it('R4 — a borrowed decision built on a booking is refused even when it also names a served slot; the twin keeps it', async () => {
    withRooms()
    fxDecisions.push({ ...fxDecisions[2], id: 'dec-both', appointment_id: 'apt-26' })
    try {
      expect((await data.readDayPlanes(STORE.devSalon, TODAY)).decisions.map((d) => d.id)).toEqual(['dec-capacity~5a171878'])
      expect((await data.readDayPlanes(STORE.tokyo, TODAY)).decisions.map((d) => d.id)).toContain('dec-both')
    } finally {
      fxDecisions.pop()
    }
  })

  it('R10 — a borrowed slot is served only on a room its OWN live day shows free for the slot\'s window; the card, the count and 予約一覧 follow; 東京 untouched', async () => {
    // Dev Salon (withRooms): slot-01 16:00–17:00 → 個室B (ROOM_B); slot-02 17:30–18:30 → 個室A (ROOM_A).
    const jst = (hm: string) => new Date(`2026-09-14T${hm}:00+09:00`).toISOString()
    const live = (store: string, room: string, from: string, to: string, extra: Partial<(typeof APPOINTMENTS)[number]> = {}) =>
      ({ ...APPOINTMENTS[0], id: `00000000-0000-4000-8000-00000000${room.slice(-4)}`, store_id: store, staff_id: CARD.probe, menu_id: MENU.zenten, resource_id: room, starts_at: jst(from), ends_at: jst(to), status: 'SCHEDULED' as const, ...extra })
    const day = async (rows: Array<(typeof APPOINTMENTS)[number]>) => {
      const spy = withRooms()
      const base = recordedReads().appointmentsList
      spy.appointmentsList.mockImplementation(async (q?: Parameters<CoreReads['appointmentsList']>[0]) => {
        const r = await base(q)
        const more = rows.filter((a) => (!q?.store_id || a.store_id === q.store_id) && (!q?.from || Date.parse(a.starts_at) >= Date.parse(q.from)) && (!q?.to || Date.parse(a.starts_at) < Date.parse(q.to)))
        return (q?.page ?? 1) > 1 ? r : { ...r, appointments: [...r.appointments, ...more] }
      })
      const planes = await data.readDayPlanes(STORE.devSalon, TODAY)
      const counts = await data.readUnresolvedCounts()
      expect((await data.readReservationPlanes(STORE.devSalon)).sellSlots).toEqual(planes.sellSlots)
      expect((await data.readDayPlanes(STORE.tokyo, TODAY)).sellSlots).toEqual(sampleRows(fxSlots, null).filter((x) => x.store_id === STORE.tokyo))
      expect([counts.byStore[STORE.devSalon], counts.byStore[STORE.tokyo]]).toEqual([planes.decisions.length, 4]) // R6
      return { slots: planes.sellSlots.map((x) => x.id), cards: (await board(STORE.devSalon)).cards.map((c) => c.id) }
    }
    const both = { slots: ['slot-01~5a171878', 'slot-02~5a171878'], cards: ['dec-capacity~5a171878'] }
    expect(await day([live(STORE.devSalon, ROOM_B, '15:00', '16:00')])).toEqual(both) // adjacent, no overlap
    expect(await day([live(STORE.devSalon, ROOM_B, '16:30', '17:00')])).toEqual({ slots: ['slot-02~5a171878'], cards: [] })
    expect(await day([live(STORE.devSalon, ROOM_B, '15:00', '16:00', { occupied_until: jst('16:10') })])).toEqual({ slots: ['slot-02~5a171878'], cards: [] }) // core's cleanup
    expect(await day([live(STORE.devSalon, ROOM_B, '15:00', '16:30', { occupied_until: jst('15:30') })])).toEqual({ slots: ['slot-02~5a171878'], cards: [] }) // P5 — an earlier snapshot never shortens the span
    expect(await day([live(STORE.devSalon, ROOM_B, '16:30', '17:00', { status: 'CANCELLED' })])).toEqual(both)
    // ⚖ §v11 V11-11 (PR-B) — the next two rows sit on 店主 (seated p-05: no slot), so they keep testing the ROOM alone; on slot-01's
    // own person (Invite Probe) the slot is refused by the person rule — pinned in P8 below.
    expect(await day([live(STORE.devSalon, ROOM_B, '16:30', '17:00', { status: 'NO_SHOW', staff_id: CARD.owner })])).toEqual(both) // P4 — NO_SHOW is core's tombstone too
    expect(await day([live(STORE.devSalon, ROOM_A, '18:00', '18:30', { kind: 'BLOCK', customer_id: null })])).toEqual({ slots: ['slot-01~5a171878'], cards: ['dec-capacity~5a171878'] })
    expect(await day([live(STORE.devSalon, ROOM_A, '16:00', '17:00', { staff_id: CARD.owner })])).toEqual(both) // P6 — slot-01's exact window on ANOTHER room: 個室B stays free
    expect(await day([live(STORE.tokyo, 'bed-02', '16:00', '17:00')])).toEqual(both) // an exact twin's room is never checked
    // P7 — a block begun the day BEFORE runs from 00:00 on the displayed day: a 00:00–01:00 slot on 個室B is not served.
    fxSlots.push({ ...fxSlots[0], id: 'slot-night', start: 0, end: 60 })
    try {
      const night = { ...live(STORE.devSalon, ROOM_B, '00:00', '00:30'), id: '00000000-0000-4000-8000-0000000000e7', starts_at: new Date('2026-09-13T23:00:00+09:00').toISOString() }
      expect(await day([night])).toEqual(both)
    } finally {
      fxSlots.pop()
    }
  })

  it('R6 — every visible store counts exactly the open decisions it is served', async () => {
    const counts = await data.readUnresolvedCounts()
    for (const s of Object.keys(counts.byStore)) {
      const open = (await data.readDayPlanes(s, TODAY)).decisions.filter((d) => d.state === 'open').length
      expect({ s, count: counts.byStore[s] }).toEqual({ s, count: open })
    }
  })

  it('the door, viewAll: twins first, then each borrower\'s own served rows; ids distinct; one shift per person; the 勤務不可 row is 東京\'s (R3)', async () => {
    const planes = await data.readDayPlanes(VIEW_ALL, TODAY)
    const own = async (s: string) => (await data.readDayPlanes(s, TODAY)).decisions
    const order = [STORE.tokyo, STORE.yokohama, STORE.devSalon, STORE.devGinza, STORE.laEstro]
    expect(planes.decisions).toEqual((await Promise.all(order.map(own))).flat())
    expect(new Set(planes.decisions.map((d) => d.id)).size).toBe(planes.decisions.length)
    expect(new Set(planes.shifts.map((s) => s.staff_id)).size).toBe(planes.shifts.length)
    expect([planes.absence?.store_id, planes.absence?.staff_id]).toEqual([STORE.tokyo, liveIdOf('staff', 'p-01')])
  })

  it('東京 and 横浜 unchanged: their planes equal the pre-change expectations exactly', async () => {
    const tokyo = await data.readDayPlanes(STORE.tokyo, TODAY)
    // ⚖ §v11 V11-8 (PR-B) — REWRITTEN (was: exactly the fixture's shifts): the recorded 東京 day now holds its two live C6 rows,
    // and the sample day gives way to them — ごろう's 17:00 終業 → 17:30 for 後藤 大輔; みらい, who has no sample shift, is
    // served the day's own window for 青木 修. Every other row is the fixture's, exactly.
    const [goro, mirai] = [liveIdOf('staff', 'p-05'), liveIdOf('staff', 'p-09')!]
    expect(tokyo.shifts).toEqual([...sampleFor(fxShifts, null).map((x) => (x.staff_id === goro ? { ...x, end: 17 * 60 + 30 } : x)), { staff_id: mirai, start: 600, end: 1140, breaks: [] }])
    expect(tokyo.decisions).toEqual(sampleRows(fxDecisions, null).filter((d) => d.store_id === STORE.tokyo))
    expect(tokyo.absence).toEqual(sampleRows([fxAbsence], null)[0])
    expect(tokyo.sellSlots).toEqual(sampleRows(fxSlots, null).filter((x) => x.store_id === STORE.tokyo))
    expect([tokyo.staffQualifications, tokyo.staffListPrice]).toEqual([sampleKeys('staff', staffQualifications), sampleKeys('staff', fxListPrice)])
    const yokohama = await data.readDayPlanes(STORE.yokohama, TODAY)
    expect([yokohama.shifts, yokohama.decisions, yokohama.absence, yokohama.sellSlots]).toEqual([sampleFor(fxShifts, null), [], null, []])
  })

  it('自分の1日: the operator seated on the Dev Salon roster gets a re-keyed row as mineShift', async () => {
    const shell = await data.readShellIdentity()
    const planes = await data.readDayPlanes(STORE.devSalon, TODAY)
    const seat = ids(await data.listStaff(STORE.devSalon)).sort().indexOf(shell.operator.staff_id)
    const mineShift = planes.shifts.find((s) => s.staff_id === shell.operator.staff_id) ?? null // page.tsx's own read
    expect(mineShift).toEqual({ ...shiftOf(fxStaff[seat].id), staff_id: shell.operator.staff_id })
    expect((await board(STORE.devSalon)).myDay?.shift).toBe('シフト 10:00–17:00')
  })

  // ⚖ §v11 V11-5 — REWRITTEN: this pin once asserted that every store got the SAME shared window, the very
  // defect Liam saw on テスト恵比寿ジム (DIAGNOSIS T3). Core's own hours (CENSUS-S18 § A, recorded): 東京 10–19
  // tue-closed · the gym 07–22 every day · 自由が丘 10–20 tue-closed; the other four hold none.
  const hoursSource = (plane: object) => (plane as { hoursSource?: string }).hoursSource
  const OWN_HOURS: Record<string, [{ open: number; close: number }, number[]]> = {
    [STORE.tokyo]: [{ open: 600, close: 1140 }, [2]], [STORE.gym]: [{ open: 420, close: 1320 }, []], [STORE.jiyugaoka]: [{ open: 600, close: 1200 }, [2]],
  }
  /** The week a store with ONE window and these closed weekdays serves (⚖ §v11 V11-7). */
  const weekOfPair = (pair: { open: number; close: number }, closed: number[]) => [0, 1, 2, 3, 4, 5, 6].map((wd) => (closed.includes(wd) ? null : pair))
  it('§v11 V11-5 — 営業時間 · 定休日: a store with core hours serves its OWN on all three planes; a store without, and the all-stores view, the SAME shared instance marked sample; opsConfig stays shared', async () => {
    for (const lens of [STORE.tokyo, STORE.yokohama, ...BORROWERS, VIEW_ALL]) {
      const own = typeof lens === 'string' ? OWN_HOURS[lens] : undefined
      const [day, res, ana] = [await data.readDayPlanes(lens, TODAY), await data.readReservationPlanes(lens), await data.readAnalyticsPlanes(lens)]
      expect(day.opsConfig).toBe(opsConfig)
      if (own) {
        expect([day.operatingHours, day.closedWeekdays, res.operatingHours, ana.closedWeekdays]).toEqual([own[0], own[1], own[0], own[1]])
        for (const plane of [day, res, ana]) expect(plane.weeklyHours).toEqual(weekOfPair(own[0], own[1]))
        expect([hoursSource(day), hoursSource(res), hoursSource(ana)]).toEqual(['core', 'core', 'core'])
        continue
      }
      for (const hours of [day.operatingHours, res.operatingHours]) expect(hours).toBe(operatingHours)
      for (const plane of [day, res, ana]) expect([plane.closedWeekdays, plane.weeklyHours]).toEqual([[closedWeekday], weekOfPair(operatingHours, [closedWeekday])])
      expect([hoursSource(day), hoursSource(res), hoursSource(ana)]).toEqual(['sample', 'sample', 'sample'])
    }
    // 東京 on its closed weekday (Tuesday 9/15) draws its usual window; a failed read serves the sample set.
    expect((await data.readDayPlanes(STORE.tokyo, TODAY + 1)).operatingHours).toEqual({ open: 600, close: 1140 })
    const spy = withReads()
    spy.storePolicyGet.mockRejectedValue(new Error('core down'))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const day = await data.readDayPlanes(STORE.gym, TODAY)
      expect([day.operatingHours, hoursSource(day)]).toEqual([operatingHours, 'sample'])
      expect(quiet).toHaveBeenCalledWith('[practice hours] core did not answer:', 'core down')
    } finally {
      quiet.mockRestore()
    }
  })

  /** 設定's 営業時間 block for one store: its seven rows (JST minutes; null = switched off), its 定休日 and its length ceiling. */
  async function settingsHours(store: string) {
    const { props } = await settingsProps({ locale: 'ja', store })
    const c = new Map(props.sections.flatMap((x) => x.blocks.flatMap((b) => b.rows.flatMap((r) => r.controls))).map((x) => [x.id, x]))
    const at = (hhmm: unknown) => Number(String(hhmm).slice(0, 2)) * 60 + Number(String(hhmm).slice(3))
    const rows = [0, 1, 2, 3, 4, 5, 6].map((d) => (c.get(`store-hours.day-${d}`)?.value === true ? { open: at(c.get(`store-hours.open-${d}`)?.value), close: at(c.get(`store-hours.close-${d}`)?.value) } : null))
    const closed = [0, 1, 2, 3, 4, 5, 6].filter((d) => rows[d] === null)
    const ceiling = (c.get('store-hours.block-step')?.control as { max?: number } | undefined)?.max
    const audit = props.sections.find((x) => x.id === 'store-hours')?.blocks.find((b) => b.id === 'store-hours.hours')?.audit
    return { rows, closed, ceiling, audit }
  }

  it('§v11 V11-6 P2 — never again: the four readers agree for every lens (day · reservation · analytics · 設定, its length ceiling and its audit line included)', async () => {
    // Its OWN list, never BORROWERS: every store with core hours, the four without, and the all-stores view.
    const lenses = [...Object.keys(OWN_HOURS), STORE.yokohama, STORE.laEstro, STORE.devSalon, STORE.devGinza, VIEW_ALL]
    let checked = 0
    for (const lens of lenses) {
      checked += 1
      const day = await data.readDayPlanes(lens, TODAY)
      const [res, ana] = [await data.readReservationPlanes(lens), await data.readAnalyticsPlanes(lens)]
      expect([res.operatingHours, res.weeklyHours, res.closedWeekdays, ana.weeklyHours, ana.closedWeekdays]).toEqual([day.operatingHours, day.weeklyHours, day.closedWeekdays, day.weeklyHours, day.closedWeekdays])
      if (typeof lens !== 'string') continue // the all-stores view has no 営業時間 block
      const set = await settingsHours(lens)
      const longest = Math.max(...day.weeklyHours.map((w) => (w ? w.close - w.open : 0)))
      expect({ lens, rows: set.rows, closed: set.closed, ceiling: set.ceiling }).toEqual({ lens, rows: day.weeklyHours, closed: day.closedWeekdays, ceiling: longest })
    }
    expect(checked).toBe(8)
    expect((await settingsHours(STORE.gym)).audit).toMatch(/（定休日なしに設定）$/)
    expect((await settingsHours(STORE.tokyo)).audit).toMatch(/（火曜を定休日に設定）$/)
  })

  it('§v11 V11-2 — the all-stores lens chooses no store: no plane and no 設定 read ever asks core for a store policy; a store asks for its own', async () => {
    const spy = withReads()
    await Promise.all([data.readDayPlanes(VIEW_ALL, TODAY), data.readReservationPlanes(VIEW_ALL), data.readAnalyticsPlanes(VIEW_ALL), data.readStoreHours(VIEW_ALL, TODAY)])
    expect(spy.storePolicyGet).not.toHaveBeenCalled()
    await data.readStoreHours(STORE.gym, TODAY)
    expect(spy.storePolicyGet.mock.calls).toEqual([[STORE.gym]])
  })

  // ⚖ §v11 V11-7 — THE PLANE CARRIES THE WEEK. テスト横浜店 holds NO hours in core (CENSUS-S18 § A: weekly_hours null), so
  // these two tests alone answer for it an invented week: its own window per weekday, closed Wednesday AND Saturday.
  const WEEK_WS = {
    sun: { open: '09:00', close: '18:00' }, mon: { open: '10:00', close: '19:00' }, tue: { open: '10:00', close: '19:00' }, wed: null,
    thu: { open: '11:00', close: '22:00' }, fri: { open: '10:00', close: '19:00' }, sat: null,
  }
  const withWeek = () => {
    const spy = withReads()
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.yokohama ? { ...POLICIES[id], source: 'custom', weekly_hours: WEEK_WS } : POLICIES[id]))
    return spy
  }
  it('§v11 V11-7 — 設定 states each weekday its OWN window from the week (never today\'s pair repeated), and the length ceiling is the longest day', async () => {
    withWeek()
    const { props } = await settingsProps({ locale: 'ja', store: STORE.yokohama })
    const c = new Map(props.sections.flatMap((x) => x.blocks.flatMap((b) => b.rows.flatMap((r) => r.controls))).map((x) => [x.id, x]))
    const row = (d: number) => (c.get(`store-hours.day-${d}`)?.value === true ? `${c.get(`store-hours.open-${d}`)?.value}–${c.get(`store-hours.close-${d}`)?.value}` : 'closed')
    expect([0, 1, 2, 3, 4, 5, 6].map(row)).toEqual(['09:00–18:00', '10:00–19:00', '10:00–19:00', 'closed', '11:00–22:00', '10:00–19:00', 'closed'])
    expect((c.get('store-hours.block-step')?.control as { max?: number }).max).toBe(11 * 60)
  })
  it('§v11 V11-7 — a week closed Wed + Sat marks BOTH on the month calendar and the shift board, and every printer names both', async () => {
    withWeek()
    const today = (await board(STORE.yokohama)) as unknown as { calendar: Array<{ wd: number; closed?: boolean }>; closedWeekdayLabel: string | null }
    const closedWds = (days: Array<{ wd: number; closed?: boolean }>) => [...new Set(days.filter((d) => d.closed).map((d) => d.wd))].sort()
    expect(closedWds(today.calendar)).toEqual([3, 6])
    expect(today.closedWeekdayLabel).toBe('水曜・土曜')
    const ShiftsPage = (await import('@/app/[locale]/(business)/business/shifts/page')).default
    const shifts = await ShiftsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.yokohama }) })
    expect(closedWds((shifts as unknown as { props: { plane: { days: Array<{ wd: number; closed: boolean }> } } }).props.plane.days)).toEqual([3, 6])
    expect((await settingsHours(STORE.yokohama)).audit).toMatch(/（水曜・土曜を定休日に設定）$/)
  })

  // ⚖ S81 R8 — V11-2a's own difference is RETIRED: the ONE resolver sends a malformed weekday on to the business hours /
  // default; with no business hours set, R6 serves that default day the store's usual pair — the same window as before.
  it('§v11 V11-2a → S81 R8 — a malformed weekday never takes the week with it: Monday 「25:00」 keeps Tuesday–Sunday\'s real windows and goes on through the resolver (no business hours here → the usual pair, R6), logged', async () => {
    const spy = withReads()
    // ⚖ §v11 V11-14 P9 (PR-B) — RE-PINNED at a usual pair (Tue + Fri 09:00–20:00) that is NOT the sample default 10:00–19:00:
    // the old pin's usual pair equalled the sample one, so it could not tell the usual-pair path from the sample path.
    const U = { open: '09:00', close: '20:00' }
    const bad = { ...WEEK_WS, mon: { open: '10:00', close: '25:00' }, tue: U, fri: U }
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.yokohama ? { ...POLICIES[id], source: 'custom', weekly_hours: bad } : POLICIES[id]))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const day = await data.readDayPlanes(STORE.yokohama, TODAY + 1) // Tuesday 9/15
      const [W, T] = [{ open: 540, close: 1200 }, { open: 660, close: 1320 }]
      expect([hoursSource(day), day.operatingHours]).toEqual(['core', W])
      expect(day.weeklyHours).toEqual([{ open: 540, close: 1080 }, W, W, null, T, W, null]) // Monday = the usual pair (Tue + Fri)
      expect(day.closedWeekdays).toEqual([3, 6]) // core's own closures only — never a closure the store did not set
      expect(quiet).toHaveBeenCalledWith('[practice hours] malformed weekday sent on to the business hours / default:', STORE.yokohama, '1')
    } finally {
      quiet.mockRestore()
    }
  })

  // ⚖ S81 R4/R7 — 臨時休業 and 臨時営業日 through Karute's ONE resolver: the shown day answers for itself, painted exactly as a
  // closed (or open) weekday is painted today; the 定休日 legend and every other day keep the weekday's answer.
  const boardOn = async (store: string, day: number) => {
    const TodayPage = (await import('@/app/[locale]/(business)/business/today/page')).default
    const el = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, day: String(day) }) })
    return (el as unknown as { props: { calendar: Array<{ m: number; d: number; closed?: boolean }>; closedWeekdayLabel: string | null } }).props
  }
  const cell = (b: Awaited<ReturnType<typeof boardOn>>, d: number) => b.calendar.find((c) => c.m === 9 && c.d === d)!.closed
  it('S81 R7 — a 臨時休業 date closes the shown day alone (shifts none, the cell 休), never a 定休日; a failed 臨時休業 read is never 「no closed days」', async () => {
    const row = { id: 'c1', store_id: STORE.tokyo, date: '2026-09-14', reason: null, created_by: null, created_at: '2026-09-01T00:00:00Z' }
    withReads({ closedDays: { [STORE.tokyo]: [row] } })
    const day = await data.readDayPlanes(STORE.tokyo, TODAY)
    expect([day.shownDayClosed, day.closedWeekdays, day.operatingHours, hoursSource(day)]).toEqual(['closed_date', [2], { open: 600, close: 1140 }, 'core'])
    // as a closed weekday: nobody is seated off the sample roster — only a person with a live row that day keeps a lane
    const live = new Set((await data.listAppointments(STORE.tokyo, {})).filter((a) => jstDayKey(a.starts_at) === TODAY).map((a) => a.staff_id))
    const seated = (await data.listShiftsByDay(STORE.tokyo, { from: TODAY, to: TODAY + 7 })).get(TODAY)!
    expect(seated.filter((x) => !live.has(x.staff_id))).toEqual([])
    expect((await data.listAbsenceByDay(STORE.tokyo, { from: TODAY, to: TODAY })).get(TODAY)).toBeNull()
    const b = await boardOn(STORE.tokyo, 0)
    expect([cell(b, 14), cell(b, 21), cell(b, 15), b.closedWeekdayLabel]).toEqual([true, false, true, '火曜'])
    const spy = withReads()
    spy.storePolicyListClosedDays.mockRejectedValue(new Error('closed days down'))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const failed = await data.readDayPlanes(STORE.tokyo, TODAY)
      expect([hoursSource(failed), failed.operatingHours]).toEqual(['sample', operatingHours])
      expect(quiet).toHaveBeenCalledWith('[practice hours] core did not answer:', 'closed days down')
    } finally {
      quiet.mockRestore()
    }
  })
  it('S81 R7 — a 臨時営業日 on a 定休日 opens that day with its own window; the next Tuesday stays 定休日', async () => {
    const spy = withReads()
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.tokyo ? { ...POLICIES[id], special_open_days: [{ date: '2026-09-15', open: '11:00', close: '15:00' }] } : POLICIES[id]))
    const day = await data.readDayPlanes(STORE.tokyo, TODAY + 1)
    expect([day.shownDayClosed, day.operatingHours, day.closedWeekdays]).toEqual([null, { open: 660, close: 900 }, [2]])
    const b = await boardOn(STORE.tokyo, 1)
    expect([cell(b, 15), cell(b, 22), b.closedWeekdayLabel]).toEqual([false, true, '火曜'])
  })

  // ⚖ S81 F1/F2/F4 — the fold of the cold read + attack: every calendar day resolves through ITS OWN layers.
  type Cell = { m: number; d: number; closed?: boolean; fits?: number }
  const cellOf = (b: Awaited<ReturnType<typeof boardOn>>, d: number) => (b.calendar as Cell[]).find((c) => c.m === 9 && c.d === d)!
  const notLive = async (store: string, dayKey: number, shifts: Array<{ staff_id: string }>) => {
    const live = new Set((await data.listAppointments(store, {})).filter((a) => jstDayKey(a.starts_at) === dayKey).map((a) => a.staff_id))
    return shifts.filter((x) => !live.has(x.staff_id))
  }
  it('S81 F1 (ATTACK B1) — a 臨時営業日 on a 定休日, shown ≠ today: the window is its own AND the calendar day seats staff (fits > 0, never 満)', async () => {
    const spy = withReads()
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.tokyo ? { ...POLICIES[id], special_open_days: [{ date: '2026-09-15', open: '11:00', close: '15:00' }] } : POLICIES[id]))
    const day = await data.readDayPlanes(STORE.tokyo, TODAY + 1)
    expect([day.shownDayClosed, day.operatingHours]).toEqual([null, { open: 660, close: 900 }])
    const seated = (await data.listShiftsByDay(STORE.tokyo, { from: TODAY - 7, to: TODAY + 7 })).get(TODAY + 1)!
    expect(seated.length).toBeGreaterThan(0)
    expect(seated.every((x) => x.start >= 660 && x.end <= 900)).toBe(true)
    expect((await data.listHoursByDay(STORE.tokyo, { from: TODAY, to: TODAY + 8 })).get(TODAY + 1)).toEqual({ closed: null, window: { open: 660, close: 900 } })
    for (const shownDay of [1, 0]) {
      const c = cellOf(await boardOn(STORE.tokyo, shownDay), 15) // shown, and seen from today
      expect([c.closed, c.fits! > 0]).toEqual([false, true])
    }
  })
  it('S81 F1 (ATTACK S1) — a 臨時休業 TODAY seen from another day: today\'s cell is closed, nobody seated, the same answer as when shown', async () => {
    const row = { id: 'c1', store_id: STORE.tokyo, date: '2026-09-14', reason: null, created_by: null, created_at: '2026-09-01T00:00:00Z' }
    withReads({ closedDays: { [STORE.tokyo]: [row] } })
    expect((await data.listHoursByDay(STORE.tokyo, { from: TODAY - 3, to: TODAY + 3 })).get(TODAY)?.closed).toBe('closed_date')
    const seated = (await data.listShiftsByDay(STORE.tokyo, { from: TODAY - 3, to: TODAY + 3 })).get(TODAY)!
    expect(await notLive(STORE.tokyo, TODAY, seated)).toEqual([])
    for (const shownDay of [2, 0]) {
      const c = cellOf(await boardOn(STORE.tokyo, shownDay), 14)
      expect([c.closed, c.fits]).toEqual([true, 0])
    }
  })
  it('S81 F2 (ATTACK S2) — a no-week store (sample hours): the day\'s REAL 臨時休業 seats nobody; its REAL 臨時営業日 clips the sample shifts to its window', async () => {
    const row = { id: 'c2', store_id: STORE.yokohama, date: '2026-09-16', reason: null, created_by: null, created_at: '2026-09-01T00:00:00Z' }
    const spy = withReads({ closedDays: { [STORE.yokohama]: [row] } })
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.yokohama ? { ...POLICIES[id], special_open_days: [{ date: '2026-09-17', open: '11:00', close: '15:00' }] } : POLICIES[id]))
    const closed = await data.readDayPlanes(STORE.yokohama, TODAY + 2)
    expect([hoursSource(closed), closed.shownDayClosed]).toEqual(['sample', 'closed_date'])
    expect(await notLive(STORE.yokohama, TODAY + 2, closed.shifts)).toEqual([])
    const special = await data.readDayPlanes(STORE.yokohama, TODAY + 3)
    expect([hoursSource(special), special.shownDayClosed, special.operatingHours]).toEqual(['sample', null, { open: 660, close: 900 }])
    expect(special.shifts.length).toBeGreaterThan(0)
    expect(special.shifts.every((x) => x.start >= 660 && x.end <= 900)).toBe(true)
    // a plain sample day keeps the sample fiction, unclipped (as before)
    const plain = await data.readDayPlanes(STORE.yokohama, TODAY + 4)
    expect(plain.shifts.some((x) => x.start < 660 || x.end > 900)).toBe(true)
  })
  it('S81 F4 (M21) → S82 G2 — the door asks core for the 臨時休業 rows of the board\'s whole reach (to exclusive), never today\'s alone; the shown day\'s own row closes it', async () => {
    const row = { id: 'c3', store_id: STORE.tokyo, date: '2026-09-17', reason: null, created_by: null, created_at: '2026-09-01T00:00:00Z' }
    const spy = withReads({ closedDays: { [STORE.tokyo]: [row] } })
    expect((await data.readDayPlanes(STORE.tokyo, TODAY + 3)).shownDayClosed).toBe('closed_date')
    expect(spy.storePolicyListClosedDays.mock.calls).toEqual([[STORE.tokyo, { from: '2026-07-31', to: '2026-10-30' }]])
  })
  it('S81 F4 (M12) — a 臨時営業日 on an OPEN weekday, shown: the cell counts in ITS window, not the weekday\'s', async () => {
    const spy = withReads()
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.tokyo ? { ...POLICIES[id], special_open_days: [{ date: '2026-09-21', open: '10:00', close: '11:00' }] } : POLICIES[id]))
    const shown = cellOf(await boardOn(STORE.tokyo, 7), 21)
    const plain = cellOf(await boardOn(STORE.tokyo, 7), 28)
    expect(shown.closed).toBe(false)
    expect(shown.fits!).toBeLessThan(plain.fits!)
  })
  it('S81 F4 (M12) — the shown day\'s OWN window is the wall an unassigned booking is clipped to: one outside the 臨時営業日\'s window (inside the weekday\'s) eats nothing', async () => {
    const special = (spy: Spied) =>
      spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.tokyo ? { ...POLICIES[id], special_open_days: [{ date: '2026-09-21', open: '10:00', close: '13:00' }] } : POLICIES[id]))
    special(withReads())
    const without = cellOf(await boardOn(STORE.tokyo, 7), 21)
    const spy = withReads()
    special(spy)
    const base = recordedReads().appointmentsList
    spy.appointmentsList.mockImplementation(async (q?: Parameters<CoreReads['appointmentsList']>[0]) => {
      const r = await base(q)
      const a = r.appointments.find((x) => x.id === APT.a14)
      // 15:00–16:00 JST on 9/21, nobody's lane: inside the weekday's 10–19, outside the special 10–13
      return a ? { ...r, appointments: [...r.appointments, { ...a, id: 'm12-unassigned', staff_id: null, starts_at: '2026-09-21T06:00:00Z', ends_at: '2026-09-21T07:00:00Z' }] } : r
    })
    const withIt = cellOf(await boardOn(STORE.tokyo, 7), 21)
    expect(without.fits!).toBeGreaterThan(0)
    expect([withIt.closed, withIt.fits]).toEqual([false, without.fits])
  })
  // ⚖ S82 G1/G2/G6 — ONE hours read per store per request over the board's reach, ONE outcome shared by every caller.
  const cellAt = (b: Awaited<ReturnType<typeof boardOn>>, m: number, d: number) => (b.calendar as Cell[]).find((c) => c.m === m && c.d === d)!
  const closedRow = (store: string, date: string) => ({ id: `c-${date}`, store_id: store, date, reason: null, created_by: null, created_at: '2026-09-01T00:00:00Z' })
  // total: shown ≠ today adds ONE appointments read (the shown day's rows beside today's, a different day) — not an hours read.
  it.each([[0, 62], [3, 63], [45, 63]])('S82 G6(a) — one board render, shown = today + %i: policy 1 · 臨時休業 1 · org 1 (total %i)', async (shownDay, expectedTotal) => {
    const spy = withReads()
    await boardOn(STORE.tokyo, shownDay)
    const n = (k: keyof Spied) => spy[k].mock.calls.length
    const total = (Object.keys(spy) as Array<keyof Spied>).reduce((a, k) => a + n(k), 0)
    // BEFORE S81: 60 (policy 3 · org 1 · 56 others); S81: 63 (policy 1 · 臨時休業 2 · org 1 · 59). The others include the
    // per-reader practiceActor() admission reads React's cache() dedupes in a real request and this harness does not.
    expect({ policy: n('storePolicyGet'), closed: n('storePolicyListClosedDays'), org: n('orgSettingsGet'), total }).toEqual({ policy: 1, closed: 1, org: 1, total: expectedTotal })
    expect(spy.storePolicyListClosedDays.mock.calls[0]).toEqual([STORE.tokyo, { from: '2026-07-31', to: '2026-10-30' }])
  })
  it('S82 G6(a) — a 臨時休業 at either end of the reach (today − 45, today + 45) paints its cell closed', async () => {
    withReads({ closedDays: { [STORE.tokyo]: [closedRow(STORE.tokyo, '2026-07-31'), closedRow(STORE.tokyo, '2026-10-29')] } })
    const b = await boardOn(STORE.tokyo, 0)
    expect([cellAt(b, 7, 31).closed, cellAt(b, 10, 29).closed, cellAt(b, 8, 1).closed, cellAt(b, 10, 28).closed]).toEqual([true, true, false, false])
  })
  it('S82 G6(c) (M14) — core filters by the range it is asked: the last calendar day\'s row is read; a row one day past `to` (exclusive) is not; a range past the reach gets its own read', async () => {
    const spy = withReads()
    const rows = ['2026-07-30', '2026-10-29', '2026-10-30'].map((d) => closedRow(STORE.tokyo, d))
    spy.storePolicyListClosedDays.mockImplementation(async (_id: string, r?: { from?: string; to?: string }) => ({ closed_days: rows.filter((x) => x.date >= r!.from! && x.date < r!.to!) }))
    const b = await boardOn(STORE.tokyo, 0)
    expect([cellAt(b, 7, 31).closed, cellAt(b, 10, 29).closed]).toEqual([false, true])
    expect(spy.storePolicyListClosedDays).toHaveBeenCalledTimes(1)
    const past = await data.listHoursByDay(STORE.tokyo, { from: TODAY + 45, to: TODAY + 46 })
    expect([past.get(TODAY + 45)?.closed, past.get(TODAY + 46)?.closed]).toEqual(['closed_date', 'closed_date'])
    expect(spy.storePolicyListClosedDays.mock.calls[1]).toEqual([STORE.tokyo, { from: '2026-10-29', to: '2026-10-31' }])
  })
  it.each([
    ['rejects', () => Promise.reject(new Error('closed days down'))],
    ['answers after the bound', () => new Promise((r) => setTimeout(() => r({ closed_days: [] }), 5100))],
  ])('S82 G6(b) — the 臨時休業 read %s, policy answers: EVERY caller serves the sample set, the mark names 営業時間, one log line', async (_label, closedDays) => {
    const spy = withReads()
    spy.storePolicyListClosedDays.mockImplementation(closedDays)
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const b = (await boardOn(STORE.tokyo, 1)) as unknown as { calendar: Array<Cell & { wd: number; covered?: boolean }>; boardMark: unknown }
      const day = await data.readDayPlanes(STORE.tokyo, TODAY + 1)
      const settings = await data.readStoreHours(STORE.tokyo, TODAY)
      expect([hoursSource(day), hoursSource(settings)]).toEqual(['sample', 'sample'])
      expect(b.boardMark).toEqual({ form: 'part', labels: ['シフトと休み', '販売可能枠', '営業時間'] })
      const closedWds = [...new Set(b.calendar.filter((c) => c.covered !== false && c.closed).map((c) => c.wd))]
      expect(closedWds).toEqual(day.closedWeekdays)
      expect(quiet.mock.calls.filter((c) => c[0] === '[practice hours] core did not answer:')).toHaveLength(1)
    } finally {
      quiet.mockRestore()
    }
  }, 15000)
  it('S82 G6(b) (M6/M6b/M9) — the bound under fake timers: pending at 4,999 ms, the sample set at 5,000 ms; every timer set is cleared', async () => {
    const spy = withReads()
    spy.storePolicyListClosedDays.mockImplementation(() => new Promise(() => {}))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.useFakeTimers({ now: new Date('2026-09-14T04:24:00Z'), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'hrtime', 'performance'] })
    try {
      let done = false
      const pending = data.readDayPlanes(STORE.tokyo, TODAY).then((d) => ((done = true), d))
      await jest.advanceTimersByTimeAsync(4999)
      expect(done).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      expect(done).toBe(true)
      expect(hoursSource(await pending)).toBe('sample')
      expect(jest.getTimerCount()).toBe(0)
      withReads()
      expect(hoursSource(await data.readDayPlanes(STORE.tokyo, TODAY))).toBe('core')
      expect(jest.getTimerCount()).toBe(0) // the answered race cleared its timer
    } finally {
      jest.useFakeTimers({
        now: new Date('2026-09-14T04:24:00Z'),
        doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
      })
      quiet.mockRestore()
    }
  })
  it('S82 G6(d) (M7) — two stores in one request, each with its own malformed weekday: two log lines, each naming its store', async () => {
    const spy = withReads()
    const bad = { ...WEEK_WS, mon: { open: '10:00', close: '25:00' } }
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.yokohama || id === STORE.tokyo ? { ...POLICIES[id], source: 'custom', weekly_hours: bad } : POLICIES[id]))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const store of [STORE.tokyo, STORE.yokohama, STORE.tokyo, STORE.yokohama]) await data.readDayPlanes(store, TODAY + 1)
      const msg = '[practice hours] malformed weekday sent on to the business hours / default:'
      expect(quiet.mock.calls.filter((c) => c[0] === msg)).toEqual([[msg, STORE.tokyo, '1'], [msg, STORE.yokohama, '1']])
    } finally {
      quiet.mockRestore()
    }
  })
  const specials = (spy: Spied, days: Array<{ date: string; open: string; close: string }>) =>
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.tokyo ? { ...POLICIES[id], special_open_days: days } : POLICIES[id]))
  it('S82 G6(e) (COLD 7(iv)) — a 臨時営業日 on a 定休日 counts in ITS window whatever day is shown: 9/21\'s narrow window never clamps 9/15', async () => {
    specials(withReads(), [{ date: '2026-09-15', open: '11:00', close: '15:00' }, { date: '2026-09-21', open: '10:00', close: '11:00' }])
    const fromShown = cellAt(await boardOn(STORE.tokyo, 1), 9, 15)
    const from21 = cellAt(await boardOn(STORE.tokyo, 7), 9, 15)
    expect(from21.fits!).toBeGreaterThan(0)
    expect([from21.closed, from21.fits]).toEqual([false, fromShown.fits])
  })
  it('S82 G6(e) (ATTACK SF4(iii)) — an unassigned booking outside a non-shown 臨時営業日\'s window eats nothing: the same count as when shown', async () => {
    const spy = withReads()
    specials(spy, [{ date: '2026-09-15', open: '11:00', close: '15:00' }])
    const base = recordedReads().appointmentsList
    spy.appointmentsList.mockImplementation(async (q?: Parameters<CoreReads['appointmentsList']>[0]) => {
      const r = await base(q)
      const a = r.appointments.find((x) => x.id === APT.a14)
      // 16:00–17:00 JST on 9/15, nobody's lane: outside the special 11–15
      return a ? { ...r, appointments: [...r.appointments, { ...a, id: 'sf4-unassigned', staff_id: null, starts_at: '2026-09-15T07:00:00Z', ends_at: '2026-09-15T08:00:00Z' }] } : r
    })
    const shown = cellAt(await boardOn(STORE.tokyo, 1), 9, 15)
    const from14 = cellAt(await boardOn(STORE.tokyo, 0), 9, 15)
    expect(shown.fits!).toBeGreaterThan(0)
    expect([from14.closed, from14.fits]).toEqual([false, shown.fits])
  })
  it('S82 G6(f) (G4) — today\'s 勤務不可 sits on TODAY\'s own hours: a 臨時休業 today → null; one on another day leaves it; a 臨時営業日 on a 定休日 today keeps it', async () => {
    const reach = { from: TODAY - 45, to: TODAY + 45 }
    withReads()
    const plain = (await data.listAbsenceByDay(STORE.tokyo, reach)).get(TODAY)
    expect(plain).not.toBeNull()
    withReads({ closedDays: { [STORE.tokyo]: [closedRow(STORE.tokyo, '2026-09-14')] } })
    expect((await data.listAbsenceByDay(STORE.tokyo, reach)).get(TODAY)).toBeNull()
    withReads({ closedDays: { [STORE.tokyo]: [closedRow(STORE.tokyo, '2026-09-16')] } })
    expect((await data.listAbsenceByDay(STORE.tokyo, reach)).get(TODAY)).toEqual(plain)
    const spy = withReads()
    spy.storePolicyGet.mockImplementation(async (id: string) =>
      id === STORE.tokyo ? { ...POLICIES[id], weekly_hours: { ...POLICIES[id].weekly_hours, mon: null }, special_open_days: [{ date: '2026-09-14', open: '10:00', close: '19:00' }] } : POLICIES[id],
    )
    expect((await data.listAbsenceByDay(STORE.tokyo, reach)).get(TODAY)).toEqual(plain)
  })

  it('§v11 V11-7 — the month calendar counts each day in its OWN window: Thursday (11–22) and Monday (10–19) fit different numbers of courses', async () => {
    withWeek()
    const { calendar } = (await board(STORE.yokohama)) as unknown as { calendar: Array<{ m: number; d: number; wd: number; fits?: number; booked?: number }> }
    const [mon, thu] = [21, 17].map((d) => calendar.find((c) => c.m === 9 && c.d === d)!) // no 横浜 booking on either day
    expect([mon.wd, thu.wd, mon.booked, thu.booked]).toEqual([1, 4, 0, 0])
    // ⚖ §v11 V11-9 (PR-B) — REWRITTEN: this once read 「Thursday fits fewer」 because the sample staff day stayed 10–19 on every
    // day. The sample shifts now cover each day's OWN window (11–22 on Thursday, 10–19 on Monday), so Thursday fits MORE.
    expect(thu.fits).toBeGreaterThan(mon.fits!)
  })

  it('§v11 V11-6 P1 — never again: every live booking of the day lies inside the hours the board draws, today and tomorrow, on every store with core hours', async () => {
    let seen = 0
    for (const store of Object.keys(OWN_HOURS)) {
      for (const dayKey of [TODAY, TODAY + 1]) {
        const { operatingHours: h } = await data.readDayPlanes(store, dayKey)
        const live = (await data.listAppointments(store)).filter((a) => jstDayKey(a.starts_at) === dayKey && a.status !== 'cancelled')
        seen += live.length
        const outside = live.filter((a) => jstMinuteOfDay(a.starts_at) < h.open || jstMinuteOfDay(a.ends_at) > h.close)
        expect({ store, dayKey, outside: outside.map((a) => `${a.starts_at}–${a.ends_at}`) }).toEqual({ store, dayKey, outside: [] })
      }
    }
    expect(seen).toBe(23) // 東京 3 + (PR-B) its two C6 rows · the gym 13 + 4 (PR-B: production's whole day) · 自由が丘 1 — never a vacuous pass
  })

  // ⚖ §v11 V11-14 (the board fix, PR-B) — THE NEVER-AGAIN PINS for the sample day vs the live day, over the recorded world.
  const ALL7 = [STORE.tokyo, STORE.yokohama, ...BORROWERS]
  /** A store's day as the board draws it: its own `dayBookings` (onBoard), on a roster person's lane or a room's. */
  const drawnOn = async (store: string, dayKey: number) => {
    const [planes, roster, rooms, appointments] = [await data.readDayPlanes(store, dayKey), ids(await data.listStaff(store)), ids(await data.listResources(store)), await data.listAppointments(store)]
    const input = { appointments, customers: [], menus: [], staff: [], resources: [], absence: planes.absence, dayKey } as unknown as BuildInput
    const drawn = dayBookings(input).filter((b) => b.onBoard && ((b.staffId !== null && roster.includes(b.staffId)) || (b.resourceId !== null && rooms.includes(b.resourceId))))
    return { planes, roster, appointments, drawn }
  }

  it('§v11 V11-14 P4 — never again: every drawn row lies inside its person\'s served shift, clear of their break and their 勤務不可, on every practice store, today and tomorrow', async () => {
    let seen = 0
    const bad: string[] = []
    for (const store of ALL7) {
      for (const dayKey of [TODAY, TODAY + 1]) {
        const { planes, roster, drawn } = await drawnOn(store, dayKey)
        const shiftOf = new Map(planes.shifts.map((x) => [x.staff_id, x])) // the board's own rule: the last row per person
        bad.push(...drawn.filter((b) => b.staffId !== null && roster.includes(b.staffId)).flatMap((b) => {
          seen += 1
          const x = shiftOf.get(b.staffId!)
          const why = [
            !x ? '本日勤務なし' : b.startMinute < x.start ? '勤務前' : b.endMinute > x.end ? '終業' : '',
            (x?.breaks ?? []).some((br) => b.startMinute < br.end && br.start < b.endMinute) ? '休憩' : '',
            planes.absence?.staff_id === b.staffId && b.endMinute > planes.absence.from ? '勤務不可' : '',
          ].filter(Boolean)
          return why.length > 0 ? [`${store.slice(0, 8)} +${dayKey - TODAY} ${b.timeRange} ${b.staffId!.slice(0, 8)} ${why.join('・')}`] : []
        }))
      }
    }
    expect({ bad, seen }).toEqual({ bad: [], seen: 25 }) // 東京 5 · 横浜 2 · the gym 13 + 4 · 自由が丘 1 — never a vacuous pass
  })

  it('§v11 V11-14 P6 — never again: 本日の予約件数 = |drawn ∪ carried by an open served decision card| on every practice store (a union, never a sum)', async () => {
    const off: object[] = []
    for (const store of ALL7) {
      for (const dayKey of [TODAY, TODAY + 1]) {
        const { planes, appointments, drawn } = await drawnOn(store, dayKey)
        const day = appointments.filter((a) => jstDayKey(a.starts_at) === dayKey) // the page's own count input (today/page.tsx)
        const held = new Set(day.filter((a) => a.status !== 'cancelled').map((a) => a.id))
        // A card naming a booking the day does not hold carries nothing.
        const carried = planes.decisions.flatMap((d) => (d.state === 'open' && d.appointment_id !== null && held.has(d.appointment_id) ? [d.appointment_id] : []))
        const union = new Set([...drawn.map((b) => b.id), ...carried])
        const [count, unseen] = [dayTotals(day, 0).count, [...held].filter((id) => !union.has(id))]
        if (count !== union.size || unseen.length > 0) off.push({ store, dayKey: dayKey - TODAY, count, drawnOrCarried: union.size, unseen })
      }
    }
    expect(off).toEqual([])
  })

  it("§v11 V11-14 P7 — never again: a 'core' store's served shifts cover its own [open, close] on an open day, and a closed weekday serves [] (a key, never a gap) — board and calendar", async () => {
    const edges = (xs: Array<{ start: number; end: number }>) => (xs.length === 0 ? null : [Math.min(...xs.map((x) => x.start)), Math.max(...xs.map((x) => x.end))])
    const [got, want]: object[][] = [[], []]
    for (const [store, [pair, closed]] of Object.entries(OWN_HOURS)) {
      for (const dayKey of [TODAY, TODAY + 1]) {
        const [day, cal] = [await data.readDayPlanes(store, dayKey), await data.listShiftsByDay(store, { from: dayKey, to: dayKey })]
        const own = closed.includes(weekdayOfKey(dayKey)) ? null : [pair.open, pair.close]
        got.push({ store, dayKey: dayKey - TODAY, day: edges(day.shifts), cal: cal.has(dayKey) ? edges(cal.get(dayKey)!) : 'no key' })
        want.push({ store, dayKey: dayKey - TODAY, day: own, cal: own })
      }
    }
    expect(got).toEqual(want)
  })

  it('§v11 V11-12 — a failed live-row read serves the plain seated day, logged once, never a throw; the board\'s own read still throws', async () => {
    const range = { from: TODAY, to: TODAY }
    // The plain seated day = the same store with no live rows at all; the given-way day differs from it (never a vacuous pass).
    const given = await data.listShiftsByDay(STORE.gym, range)
    withReads().appointmentsList.mockResolvedValue({ appointments: [], total: 0, page: 1, page_size: 500 })
    const [plain, plainRes] = [await data.listShiftsByDay(STORE.gym, range), await data.readReservationPlanes(STORE.gym)]
    expect(plain).not.toEqual(given)
    withReads().appointmentsList.mockRejectedValue(new Error('core down'))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await data.listShiftsByDay(STORE.gym, range)).toEqual(plain)
      expect(quiet.mock.calls).toEqual([['[practice sample day] core did not answer:', 'core down']])
      quiet.mockClear()
      const res = await data.readReservationPlanes(STORE.gym)
      expect([res.shifts, res.absence, res.sellSlots]).toEqual([plainRes.shifts, plainRes.absence, plainRes.sellSlots])
      expect(quiet.mock.calls).toEqual([['[practice sample day] core did not answer:', 'core down']])
      await expect(data.readDayPlanes(STORE.gym, TODAY)).rejects.toThrow('core down') // the board's own read propagates (§7), as main
    } finally {
      quiet.mockRestore()
    }
  })

  it('§v11 V11-12 (Greptile P2 on #1071) — the day-rows memo lives on the actor\'s BOUND READS: every reader bound to the same reads object shares it (one 今日の運営 render reads the calendar range once, today once); a fresh reads object reads again', async () => {
    const spy = withReads()
    // PRECONDITION — what the count relies on: every practiceActor() binds the SAME reads object (actor.ts:65
    // `const reads = clientFor(admitted)`; this suite's clientFor returns the one `mockCore.reads`, :21). Outside a render
    // React cache() is a pass-through (pinned at :106), so the actors differ; in production actor.ts:56's cache() gives ONE
    // actor per request — the same sharing scope, one level up.
    const [a, b] = [await practiceActor(), await practiceActor()]
    expect([a === b, a.reads === b.reads]).toEqual([false, true])
    await board(STORE.gym)
    const iso = (k: number) => new Date(k * 86_400_000 - 9 * 3_600_000).toISOString() // 00:00 JST of day k (the door's dayStartIso)
    const reads = (on: Spied, from: number, to: number) => on.appointmentsList.mock.calls.filter(([q]) => q?.store_id === STORE.gym && q.from === iso(from) && q.to === iso(to) && (q.page ?? 1) === 1).length
    expect({ calendar: reads(spy, TODAY - 46, TODAY + 46), today: reads(spy, TODAY - 1, TODAY + 1) }).toEqual({ calendar: 1, today: 1 })
    // THE INVERSE — the count is the memo's doing, not a mock artefact: the same two readers of the same range, each bound
    // to a FRESH reads object, read it twice.
    const range = { from: TODAY - 45, to: TODAY + 45 }
    const first = withReads()
    await data.listBlocksByDay(STORE.gym, range)
    const second = withReads()
    await data.listShiftsByDay(STORE.gym, range)
    expect([reads(first, TODAY - 46, TODAY + 46), reads(second, TODAY - 46, TODAY + 46)]).toEqual([1, 1])
  })

  it('§v11 V11-12 — the readers agree on the generated early-shift absence (R4 + S87 Q4: it goes to the opening-side STYLIST whose rows end first, so it survives): the gym\'s けんた, moved to 21:30', async () => {
    const day = (await data.readDayPlanes(STORE.gym, TODAY)).absence
    const cal = (await data.listAbsenceByDay(STORE.gym, { from: TODAY, to: TODAY })).get(TODAY)
    const res = (await data.readReservationPlanes(STORE.gym)).absence
    // ⚖ S87 Q4: けんた carries it — the opening side's STYLISTs are けんた and なつみ (こはる opens too but is the ASSISTANT);
    // けんた's and なつみ's rows end first (21:30), けんた first by name; give-way moved its `from` from 11:30 to his last row's end
    expect([day?.staff_id, day?.from]).toEqual(['8dd49f39-7ae7-4464-b2f7-f2d0cf7f5461', 21 * 60 + 30]) // GYM.kenta, 21:30
    expect([cal, res]).toEqual([day, day])
  })

  it('Q3 — a generated hair store keeps its 販売可能枠 decision card: the generated slot keeps the template id, so the card is served and counted', async () => {
    // Dev Salon (hair) on its rooms, with a core week of 10:00–20:00 every day: not the 10–19 twin, so its day is GENERATED
    const spy = withRooms()
    const day = { open: '10:00', close: '20:00' }
    const week = { sun: day, mon: day, tue: day, wed: day, thu: day, fri: day, sat: day }
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.devSalon ? { ...POLICIES[id], source: 'custom', weekly_hours: week } : POLICIES[id]))
    const planes = await data.readDayPlanes(STORE.devSalon, TODAY)
    const { price_low, price_high } = SAMPLE_SLOT_PRICES.hair_salon!
    expect(planes.operatingHours).toEqual({ open: 600, close: 1200 })
    expect(planes.sellSlots.length).toBeGreaterThan(0)
    expect(planes.sellSlots.every((x) => x.price_low === price_low && x.price_high === price_high)).toBe(true) // generated (R16), not the fixture's
    const cards = planes.decisions.filter((d) => d.sell_slot_id !== null && planes.sellSlots.some((x) => x.id === d.sell_slot_id))
    expect(cards.length).toBeGreaterThan(0) // the card is present
    const counts = await data.readUnresolvedCounts()
    expect(counts.byStore[STORE.devSalon]).toBe(planes.decisions.filter((d) => d.state === 'open').length) // and counted
    expect(counts.byStore[STORE.devSalon]).toBeGreaterThan(0)
  })

  // The Q3 store-day (Dev Salon, a GENERATED 10:00–20:00 hair day), with optional extra live rows on today.
  const generatedSalon = (rows: ReadonlyArray<typeof APPOINTMENTS[number]> = []) => {
    const spy = withRooms()
    const day = { open: '10:00', close: '20:00' }
    const week = { sun: day, mon: day, tue: day, wed: day, thu: day, fri: day, sat: day }
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.devSalon ? { ...POLICIES[id], source: 'custom', weekly_hours: week } : POLICIES[id]))
    const base = recordedReads().appointmentsList
    spy.appointmentsList.mockImplementation(async (q?: Parameters<CoreReads['appointmentsList']>[0]) => {
      const r = await base(q)
      const more = rows.filter((a) => (!q?.store_id || a.store_id === q.store_id) && (!q?.from || Date.parse(a.starts_at) >= Date.parse(q.from)) && (!q?.to || Date.parse(a.starts_at) < Date.parse(q.to)))
      return (q?.page ?? 1) > 1 ? r : { ...r, appointments: [...r.appointments, ...more] }
    })
  }

  it('F1 (Greptile #1153 P1) — a Reserve販売 card is served iff its slot is among the slots the day FINALLY serves: the fixture slot gives way to a live row, the generated slot (same id) is free → card served and counted', async () => {
    // slot-01's FIXTURE person on Dev Salon is Invite Probe (16:00–17:00); a live row of hers at 16:30 blocks that fixture slot,
    // while the generated slot-01 (same id, 16:00) seats another person and stands free.
    const at = (hm: string) => new Date(`2026-09-14T${hm}:00+09:00`).toISOString()
    generatedSalon([{ ...APPOINTMENTS[0], id: '00000000-0000-4000-8000-0000000000f1', store_id: STORE.devSalon, staff_id: CARD.probe, menu_id: MENU.zenten, resource_id: null, starts_at: at('16:30'), ends_at: at('17:00'), status: 'SCHEDULED' as const }])
    const planes = await data.readDayPlanes(STORE.devSalon, TODAY)
    const slot = planes.sellSlots.find((x) => x.start === 16 * 60)!
    expect(slot).toBeDefined()
    expect(slot.staff_id).not.toBe(CARD.probe) // precondition: the generated slot is a different, free person
    const cards = planes.decisions.filter((d) => d.sell_slot_id === slot.id)
    expect(cards.map((d) => d.kind)).toEqual(['Reserve販売']) // the card is served on the final slot
    const counts = await data.readUnresolvedCounts()
    expect(counts.byStore[STORE.devSalon]).toBe(planes.decisions.filter((d) => d.state === 'open').length) // and the badge counts it
  })

  it('F2 (Greptile #1153 P2) — a generated slot\'s Reserve販売 card names the person the slot SERVES, as its inspector does (one offer, one person)', async () => {
    generatedSalon()
    const planes = await data.readDayPlanes(STORE.devSalon, TODAY)
    const names = new Map((await data.listStaff(STORE.devSalon)).map((p) => [p.id, p.full_name]))
    const cards = planes.decisions.filter((d) => d.sell_slot_id !== null && planes.sellSlots.some((x) => x.id === d.sell_slot_id))
    expect(cards.length).toBeGreaterThan(0)
    for (const d of cards) {
      const slot = planes.sellSlots.find((x) => x.id === d.sell_slot_id)!
      const others = [...names].filter(([id, n]) => id !== slot.staff_id && !names.get(slot.staff_id)!.includes(n)).map(([, n]) => n)
      expect({ id: d.id, named: d.detail.includes(names.get(slot.staff_id)!), others: others.filter((n) => d.detail.includes(n)) })
        .toEqual({ id: d.id, named: true, others: [] })
    }
  })

  it('§v11 V11-14 P8 — never again: no sample sell slot is served on its person\'s live row, twin or borrower; 予約一覧 and the badge follow', async () => {
    // Dev Salon with its two rooms (slot-01 → Invite Probe, slot-02 → perry) and 東京 (slot-01 → 見本 しろう): each slot-01's person
    // holds a live booking inside the slot's window, on NO room — the room rule alone would serve both.
    const at = (hm: string) => new Date(`2026-09-14T${hm}:00+09:00`).toISOString()
    const booked = (n: string, store: string, staff_id: string) => ({ ...APPOINTMENTS[0], id: `00000000-0000-4000-8000-0000000000${n}`, store_id: store, staff_id, menu_id: MENU.zenten, resource_id: null, starts_at: at('16:30'), ends_at: at('17:00'), status: 'SCHEDULED' as const })
    const rows = [booked('e8', STORE.devSalon, CARD.probe), booked('e9', STORE.tokyo, liveIdOf('staff', 'p-04')!)]
    const spy = withReads()
    spy.resourcesList.mockImplementation(async (q?: { store_id?: string }) => ({ resources: q?.store_id !== STORE.devSalon ? [] : ['d2', 'd1'].map((n) => ({ id: `00000000-0000-4000-8000-0000000000${n}`, store_id: STORE.devSalon, name: `個室${n}`, note: null, room_class: 'standard' as const, cleanup_minutes: 0, display_order: 0, active: true, created_at: 'x', updated_at: 'x' })) }))
    const base = recordedReads().appointmentsList
    spy.appointmentsList.mockImplementation(async (q?: Parameters<CoreReads['appointmentsList']>[0]) => {
      const r = await base(q)
      const more = rows.filter((a) => (!q?.store_id || a.store_id === q.store_id) && (!q?.from || Date.parse(a.starts_at) >= Date.parse(q.from)) && (!q?.to || Date.parse(a.starts_at) < Date.parse(q.to)))
      return (q?.page ?? 1) > 1 ? r : { ...r, appointments: [...r.appointments, ...more] }
    })
    const counts = await data.readUnresolvedCounts()
    let served = 0
    const [got, want]: object[][] = [[], []]
    for (const store of ALL7) {
      const [day, res] = [await data.readDayPlanes(store, TODAY), await data.readReservationPlanes(store)]
      const live = (await data.listAppointments(store)).filter((a) => jstDayKey(a.starts_at) === TODAY && a.board_state !== null)
      const onRow = (xs: typeof day.sellSlots) => xs.filter((x) => live.some((a) => a.staff_id === x.staff_id && jstMinuteOfDay(a.starts_at) < x.end && x.start < jstMinuteOfDay(a.ends_at))).map((x) => x.id)
      served += day.sellSlots.length
      got.push({ store, day: onRow(day.sellSlots), res: onRow(res.sellSlots), badge: counts.byStore[store] })
      want.push({ store, day: [], res: [], badge: day.decisions.filter((d) => d.state === 'open').length })
    }
    expect({ got, served }).toEqual({ got: want, served: 2 }) // each store's slot-02 still stands — never a vacuous pass
  })

  // ⚖ §v11 V11-16 (PR-B2) — THE TUESDAY PROBLEM: 東京 and 自由が丘 are closed on Tuesdays, so on a Tuesday TODAY's served
  // shifts are [] — and a page that applied today's row to every shown day emptied the whole week.
  const TUESDAY = '2026-09-15T04:24:00Z' // 13:24 JST, the day after the recorded day
  it('§v11 V11-16 P21 — never again: on a closed today the 勤務表 reads EVERY shown day\'s own served shift — cells, 勤務予定 N名, the 人件費 and 希望休 gates', async () => {
    const ShiftsPage = (await import('@/app/[locale]/(business)/business/shifts/page')).default
    const { bookedKeysOf, cellFor, editKey, laborCost, resolveLeaveRequests } = await import('@/business/lib/shifts')
    const { leaveRequests } = await import('@/business/lib/fixtures-shifts')
    type Props = import('@/app/[locale]/(business)/business/shifts/ShiftsScreen').ShiftsProps
    jest.setSystemTime(new Date(TUESDAY))
    try {
      const [got, want]: object[][] = [[], []]
      for (const store of [STORE.tokyo, STORE.jiyugaoka]) {
        expect((await data.readDayPlanes(store, jstDayKey(new Date(TUESDAY)))).shifts).toEqual([]) // the precondition — never vacuous
        for (const view of ['week', 'month']) {
          const { plane, head } = ((await ShiftsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, view }) })) as unknown as { props: Props }).props
          const served = await data.listShiftsByDay(store, { from: plane.days[0].dayKey, to: plane.days[plane.days.length - 1].dayKey })
          const ctx = { closedWds: plane.closedWds, todayKey: plane.todayKey, absence: plane.absence, leaveKeys: new Set(plane.leaves.map((l) => editKey(l.staffId, l.dayKey))), bookedKeys: bookedKeysOf(plane.days), shiftEdits: new Map(), leaveAnswers: new Map() }
          const priced: Array<{ staffId: string; workedMinutes: number }> = []
          for (const day of plane.days.filter((d) => !d.closed)) for (const m of plane.roster) {
            const s = served.get(day.dayKey)!.find((x) => x.staff_id === m.id) ?? null
            const cell = cellFor(m, day.dayKey, ctx)
            priced.push({ staffId: m.id, workedMinutes: cell.workedMinutes })
            if (view !== 'week') continue
            const rest = m.restWd === day.wd && !ctx.bookedKeys.has(editKey(m.id, day.dayKey))
            got.push({ store, day: day.dayKey, who: m.name, cell: cell.kind === 'none' ? null : cell.kind === 'rest' ? 'rest' : [cell.start, cell.end, cell.breaks] })
            want.push({ store, day: day.dayKey, who: m.name, cell: s === null ? null : rest ? 'rest' : [s.start, s.end, s.breaks] })
          }
          // ON prices by FIXTURE ids (hourlyWage, shifts/page.tsx), so every ON wage is null on ANY day: the pin re-applies
          // buildRoster's own gate (`wage: shift ? rate : null`) to the props' standing row, with a flat rate.
          const yen = laborCost(priced, plane.roster.map((m) => ({ ...m, wage: m.shift ? 1500 : null }))).yen
          got.push({ store, view, chip: Number(/\d+/.exec(head.rosterChip)![0]) > 0, worked: priced.some((p) => p.workedMinutes > 0), yen: view === 'month' && yen > 0 })
          want.push({ store, view, chip: true, worked: true, yen: view === 'month' })
          if (store !== STORE.tokyo || view !== 'week') continue
          // 希望休 — the fixture requests seated on 東京's own cards (an exact twin): each one on the roster still resolves. Asked
          // booking-free (the recorded world holds no 東京 booking after 9/14): the gate under test is the standing row.
          const asked = leaveRequests.map((r) => ({ ...r, staff_id: liveIdOf('staff', r.staff_id) ?? r.staff_id, overlapsBooking: false })).filter((r) => plane.roster.some((m) => m.id === r.staff_id))
          got.push({ leaves: [...new Set(resolveLeaveRequests(asked, plane.roster, plane.todayKey, new Map(), plane.closedWds).map((l) => l.staffId))].sort() })
          want.push({ leaves: [...new Set(asked.map((r) => r.staff_id))].sort() })
          expect(asked.length).toBeGreaterThan(0)
        }
      }
      expect(got).toEqual(want)
    } finally {
      jest.setSystemTime(new Date('2026-09-14T04:24:00Z'))
    }
  })

  it('§v11 V11-16 P22 — never again: on a closed today 予約一覧 reads each row\'s OWN day\'s served shift — a Wednesday row inside its person\'s shift is never flagged; one outside still is', async () => {
    const { reservationsProps } = await import('@/app/[locale]/(business)/business/reservations/reservations-props')
    jest.setSystemTime(new Date(TUESDAY))
    try {
      const wed = jstDayKey(new Date(TUESDAY)) + 1
      const shiro = liveIdOf('staff', 'p-04')!
      const shift = (await data.listShiftsByDay(STORE.tokyo, { from: wed, to: wed })).get(wed)!.find((x) => x.staff_id === shiro)
      expect(shift && [shift.start <= 11 * 60, shift.end >= 12 * 60, shift.end < 19 * 60]).toEqual([true, true, true]) // the precondition
      // The harness's own world seam (the route never passes it): the rows reach 予約一覧, never the door's served day.
      const base = (await data.listAppointments(STORE.tokyo)).find((a) => a.status !== 'cancelled')!
      const at = (hm: string) => new Date(`2026-09-16T${hm}:00+09:00`).toISOString()
      const row = (n: string, from: string, to: string) => ({ ...base, id: `00000000-0000-4000-8000-0000000000${n}`, staff_id: shiro, starts_at: at(from), ends_at: at(to) })
      const { props } = await reservationsProps({ locale: 'ja', store: STORE.tokyo, world: { appointments: [row('f1', '11:00', '12:00'), row('f2', '19:00', '20:00')] } })
      const warn = (n: string) => props.rows.find((r) => r.id === `00000000-0000-4000-8000-0000000000${n}`)?.shiftWarning
      expect({ inside: warn('f1'), outside: warn('f2') }).toEqual({ inside: null, outside: '見本 しろう 10:00–18:00・この予約は120分超過' })
    } finally {
      jest.setSystemTime(new Date('2026-09-14T04:24:00Z'))
    }
  })

  it('§v11 V11-16 P25 (stress M7) — 予約一覧 reads its LAST day too: a row at exactly 00:00 of day +7 (the window admits it) inside its person\'s served shift that day is never flagged', async () => {
    const { reservationsProps } = await import('@/app/[locale]/(business)/business/reservations/reservations-props')
    const last = TODAY + 7
    const shiro = liveIdOf('staff', 'p-04')!
    const midnight = new Date('2026-09-21T00:00:00+09:00').toISOString()
    const row = { ...APPOINTMENTS[0], id: '00000000-0000-4000-8000-0000000000f3', store_id: STORE.tokyo, staff_id: shiro, menu_id: MENU.zenten, resource_id: null, starts_at: midnight, ends_at: new Date('2026-09-21T00:30:00+09:00').toISOString(), status: 'SCHEDULED' as const }
    const spy = withReads()
    const base = recordedReads().appointmentsList
    spy.appointmentsList.mockImplementation(async (q?: Parameters<CoreReads['appointmentsList']>[0]) => {
      const r = await base(q)
      const more = [row].filter((a) => (!q?.store_id || a.store_id === q.store_id) && (!q?.from || Date.parse(a.starts_at) >= Date.parse(q.from)) && (!q?.to || Date.parse(a.starts_at) < Date.parse(q.to)))
      return (q?.page ?? 1) > 1 ? r : { ...r, appointments: [...r.appointments, ...more] }
    })
    // The precondition: day +7 is open and the live row stretches しろう's served shift to hold it (V11-8).
    const served = (await data.listShiftsByDay(STORE.tokyo, { from: last, to: last })).get(last)!.find((x) => x.staff_id === shiro)
    expect(served && [weekdayOfKey(last), served.start, served.end >= 30]).toEqual([1, 0, true])
    const { props } = await reservationsProps({ locale: 'ja', store: STORE.tokyo })
    expect(props.rows.filter((r) => r.id === row.id).map((r) => ({ dayKey: r.dayKey, shiftWarning: r.shiftWarning }))).toEqual([{ dayKey: last, shiftWarning: null }])
  })

  // ⚖ S81 R3 — IN_PROGRESS is DATA, never a look: the same live row read as SCHEDULED and as IN_PROGRESS builds the
  // SAME board (every card field, every total) — only the row's own `status` differs.
  it('S81 R3 — identity: one live row as SCHEDULED and as IN_PROGRESS → the board is deep-equal except the row\'s status', async () => {
    const boardWith = async (status: 'SCHEDULED' | 'IN_PROGRESS') => {
      const spy = withReads()
      const base = recordedReads().appointmentsList
      spy.appointmentsList.mockImplementation(async (q?: Parameters<CoreReads['appointmentsList']>[0]) => {
        const r = await base(q)
        return { ...r, appointments: r.appointments.map((a) => (a.id === APT.a14 ? { ...a, status } : a)) }
      })
      const appointments = await data.listAppointments(STORE.tokyo, {})
      const input = {
        appointments, customers: await data.listCustomers(STORE.tokyo), menus: await data.listMenus(STORE.tokyo), staff: await data.listStaff(STORE.tokyo),
        resources: await data.listResources(STORE.tokyo), absence: null, blocks: [], sellSlots: [], decisions: [], dayKey: TODAY,
      } as unknown as BuildInput
      return { appointments, cards: dayBookings(input), totals: dayTotals(appointments.filter((a) => jstDayKey(a.starts_at) === TODAY), 0) }
    }
    const scheduled = await boardWith('SCHEDULED')
    const live = await boardWith('IN_PROGRESS')
    const row = (b: typeof live) => b.appointments.find((a) => a.id === APT.a14)!
    expect([row(scheduled).status, row(live).status]).toEqual(['booked', 'in_progress'])
    expect(live.cards.some((c) => c.id === APT.a14)).toBe(true) // the row IS on the board
    const sansStatus = (b: typeof live) => b.appointments.map((a) => (a.id === APT.a14 ? { ...a, status: 'X' } : a))
    expect(sansStatus(live)).toEqual(sansStatus(scheduled))
    expect(live.cards).toEqual(scheduled.cards)
    expect(live.totals).toEqual(scheduled.totals)
  })

  // ⚖ S82 G6(g) — the same identity on three more screens' prop builders: 予約一覧 · レジ · シフト.
  it('S82 G6(g) — an IN_PROGRESS row reaches the reservations, register and shifts props exactly as SCHEDULED, but for its status', async () => {
    const propsWith = async (status: 'SCHEDULED' | 'IN_PROGRESS' | 'CANCELLED') => {
      const spy = withReads()
      const base = recordedReads().appointmentsList
      spy.appointmentsList.mockImplementation(async (q?: Parameters<CoreReads['appointmentsList']>[0]) => {
        const r = await base(q)
        return { ...r, appointments: r.appointments.map((a) => (a.id === APT.a14 ? { ...a, status } : a)) }
      })
      const { reservationsProps } = await import('@/app/[locale]/(business)/business/reservations/reservations-props')
      const { registerProps } = await import('@/app/[locale]/(business)/business/register/register-props')
      const ShiftsPage = (await import('@/app/[locale]/(business)/business/shifts/page')).default
      return {
        reservations: JSON.stringify((await reservationsProps({ locale: 'ja', store: STORE.tokyo })).props),
        register: JSON.stringify((await registerProps({ locale: 'ja', store: STORE.tokyo })).props),
        shifts: JSON.stringify(((await ShiftsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo }) })) as unknown as { props: unknown }).props),
      }
    }
    const booked = await propsWith('SCHEDULED')
    const live = await propsWith('IN_PROGRESS')
    expect(booked.reservations).toContain(APT.a14)
    const asBooked = (json: string) => json.replace(/"in_progress"/g, '"booked"')
    // the row REACHES 予約一覧 and シフト (taken away as CANCELLED, their props change); レジ reads `done` rows only
    // (register-props.ts:199-200), so a booked row and an in_progress row alike never reach it — same props all three ways.
    const gone = await propsWith('CANCELLED')
    expect([gone.reservations !== booked.reservations, gone.register !== booked.register, gone.shifts !== booked.shifts]).toEqual([true, false, true])
    expect({ reservations: asBooked(live.reservations), register: asBooked(live.register), shifts: asBooked(live.shifts) }).toEqual(booked)
  })
  it('S81 R3 — an IN_PROGRESS row with no staff, through the door: carried as in_progress, staff_id null (the 担当未定 read-only sheet decides on staff alone)', async () => {
    const spy = withReads()
    const base = recordedReads().appointmentsList
    spy.appointmentsList.mockImplementation(async (q?: Parameters<CoreReads['appointmentsList']>[0]) => {
      const r = await base(q)
      return { ...r, appointments: r.appointments.map((a) => (a.id === APT.a14 ? { ...a, status: 'IN_PROGRESS' as const, staff_id: null } : a)) }
    })
    const a = (await data.listAppointments(STORE.tokyo, {})).find((x) => x.id === APT.a14)!
    expect([a.status, a.staff_id, a.board_state]).toEqual(['in_progress', null, 'confirmed'])
  })

  it('§v11 V11-8 — the door\'s drawn-row predicate IS the board\'s filter, status by status, through the door and dayBookings', async () => {
    const { drawnRow } = await import('@/business/lib/practice-door/sample-day')
    const all = await data.listAppointments(VIEW_ALL, {})
    const statuses = new Set<string>()
    for (const row of APPOINTMENTS.filter((a) => all.some((x) => x.id === a.id))) {
      const a = all.find((x) => x.id === row.id)!
      statuses.add(row.status)
      const drawn = dayBookings({ appointments: [a], customers: [], menus: [], staff: [], resources: [], absence: null, dayKey: jstDayKey(a.starts_at) } as unknown as BuildInput).length === 1
      expect({ id: row.id, status: row.status, drawn }).toEqual({ id: row.id, status: row.status, drawn: drawnRow(row) })
    }
    expect([...statuses].sort()).toEqual(['CANCELLED', 'COMPLETED', 'IN_PROGRESS', 'NO_SHOW', 'SCHEDULED']) // every core status, both sides
    expect(APPOINTMENTS.filter((a) => a.kind === 'BLOCK').some(drawnRow)).toBe(false) // a BLOCK is never a booking card
  })

  // ⚖ §v11 V11-5 — the override table is the SAMPLE world's: exercised on stores core holds no hours for.
  it('§v9 — a per-store value moves only its own plane\'s stores: 横浜 (STORE_B) its own 定休日 · 営業時間 · opsConfig; Dev 銀座 and Dev Salon (a borrower takes STORE_A\'s plane, ⚖ §v4 V4-2) STORE_A\'s 定休日; the all-stores view keeps the shared set (V9-2)', async () => {
    const hoursB = { open: 9 * 60, close: 20 * 60 }
    const opsB = { ...opsConfig }
    SINGLETONS_BY_FIXTURE_STORE[STORE_B] = { closedWeekday: 3, operatingHours: hoursB, opsConfig: opsB }
    SINGLETONS_BY_FIXTURE_STORE[STORE_A] = { closedWeekday: 9 }
    try {
      const yokohama = await data.readDayPlanes(STORE.yokohama, TODAY)
      expect(yokohama.closedWeekdays).toEqual([3])
      expect(yokohama.operatingHours).toBe(hoursB)
      expect(yokohama.opsConfig).toBe(opsB)
      expect((await data.readReservationPlanes(STORE.yokohama)).operatingHours).toBe(hoursB)
      expect((await data.readAnalyticsPlanes(STORE.yokohama)).closedWeekdays).toEqual([3])
      const ginza = await data.readDayPlanes(STORE.devGinza, TODAY)
      expect(ginza.closedWeekdays).toEqual([9])
      expect(ginza.operatingHours).toBe(operatingHours) // the keys it does not name stay shared
      expect(ginza.opsConfig).toBe(opsConfig)
      expect((await data.readDayPlanes(STORE.devSalon, TODAY)).closedWeekdays).toEqual([9])
      const all = await data.readDayPlanes(VIEW_ALL, TODAY) // V9-2 — viewAll chooses no store, so neither entry applies
      expect(all.closedWeekdays).toEqual([1])
      expect(all.operatingHours).toBe(operatingHours)
      expect((await data.readAnalyticsPlanes(VIEW_ALL)).closedWeekdays).toEqual([1])
    } finally {
      delete SINGLETONS_BY_FIXTURE_STORE[STORE_B]
      delete SINGLETONS_BY_FIXTURE_STORE[STORE_A]
    }
  })

  it('§v9 — per key, never a spread: an entry whose key is present but undefined serves the shared constant itself', async () => {
    SINGLETONS_BY_FIXTURE_STORE[STORE_B] = { closedWeekday: undefined }
    try {
      const yokohama = await data.readDayPlanes(STORE.yokohama, TODAY)
      expect(yokohama.closedWeekdays).toEqual([1])
      expect(yokohama.closedWeekdays).toEqual([closedWeekday])
      expect(yokohama.operatingHours).toBe(operatingHours)
    } finally {
      delete SINGLETONS_BY_FIXTURE_STORE[STORE_B]
    }
  })
})

// ⚖ R50 (Business S39) — the practice door is decided PER BUSINESS, never per deployment.
describe('R50 — the door per business (P1–P7)', () => {
  const OTHER = '7bb76aac-2947-47fb-b883-d85fe849ccec' // an admitted business that is NOT the tenant
  const shape = (x: unknown) => JSON.stringify(x, (_k, v: unknown) => (typeof v === 'function' ? `fn:${(v as { name: string }).name}` : v))
  const layoutOf = async () => {
    const BusinessLayout = (await import('@/app/[locale]/(business)/layout')).default
    return shape(await BusinessLayout({ children: null, params: Promise.resolve({ locale: 'ja' }) }))
  }
  const todayOf = async () => {
    const TodayPage = (await import('@/app/[locale]/(business)/business/today/page')).default
    return shape(await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({}) }))
  }
  const settingsPageOf = async () => {
    const SettingsPage = (await import('@/app/[locale]/(business)/business/settings/page')).default
    return (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({}) })).props as Record<string, unknown>
  }
  // Every READ site of the per-site table, reached through its own caller.
  const everyRead = async () => ({
    layout: await layoutOf(),
    today: await todayOf(),
    settingsPage: await settingsPageOf(),
    settings: await settingsProps({ locale: 'ja' }),
    settingsStore: await settingsProps({ locale: 'ja', store: STORE_A }),
    recording: shape(await recordingProps({ locale: 'ja' })),
    karute: shape(await karuteProps({ locale: 'ja' })),
    doorOn: await data.practiceDoorOn(),
    canWriteStoreDays: await data.readCanWriteStoreDays(STORE_A),
    reads: await Promise.all([
      data.listStoreOptions(), data.listCustomers(STORE_A), data.listAppointments(STORE_A), data.listVisits(STORE_A), data.readShellIdentity(),
      data.readReserveCardColor(), data.readBookingColors(), data.readStoreAddress(STORE_A), data.listMenus(STORE_A), data.readUnresolvedCounts(),
      data.listResources(STORE_A), data.listShiftsByDay(STORE_A, { from: TODAY, to: TODAY }), data.listAbsenceByDay(STORE_A, { from: TODAY, to: TODAY }),
      data.listBlocksByDay(STORE_A, { from: TODAY, to: TODAY }), data.readDayPlanes(STORE_A, TODAY), data.readStoreHours(STORE_A, TODAY),
      data.readReservationPlanes(STORE_A), data.readAnalyticsPlanes(STORE_A), data.listStaff(STORE_A), data.readStaffStores(STORE_A),
    ]),
  })
  const offWorld = async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    try { return await everyRead() } finally { process.env.BUSINESS_PRACTICE_TENANT = TENANT }
  }

  it('P1 — door-ON build, another admitted business: every read site answers the OFF world, no core client, no throw', async () => {
    as(LOGIN.owner, null, OTHER)
    const off = await offWorld()
    mockBuilt.n = 0
    const got = await everyRead()
    expect(got).toEqual(off)
    expect(mockBuilt.n).toBe(0)
    expect(got.doorOn).toBe(false)
    expect(got.layout).not.toContain('"practice":true')
    expect(got.settingsPage.saveCardColor).toBeUndefined()
    expect(got.settingsPage.saveStoreDays).toBeUndefined()
    expect(got.settings.props.dateline.startsWith('サンプルデータ ')).toBe(true)
    expect(got.settings.props.demoSaveLine).toBe('保存はこの画面の中だけに反映されます（実データ接続後に本保存）。')
  })

  it('P2 — the same build, the tenant itself: the ON path (a core client, live rows, the practice badge)', async () => {
    as(LOGIN.owner)
    mockBuilt.n = 0
    expect(await data.practiceDoorOn()).toBe(true)
    expect((await data.listStoreOptions()).map((s) => s.id)).toContain(STORE.tokyo)
    expect(await layoutOf()).toContain('"practice":true')
    const { props } = await settingsProps({ locale: 'ja', store: STORE.tokyo })
    expect(props.dateline.startsWith('サンプルデータ ')).toBe(false)
    expect((await settingsPageOf()).saveCardColor).toBeDefined()
    expect(mockBuilt.n).toBeGreaterThan(0)
  })

  it('P3 — switch unset or "": both businesses take the OFF path; a non-UUID value still throws', async () => {
    for (const env of [undefined, '']) {
      for (const who of [TENANT, OTHER]) {
        if (env === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
        else process.env.BUSINESS_PRACTICE_TENANT = env
        as(LOGIN.owner, null, who)
        mockBuilt.n = 0
        expect(await data.practiceDoorOn()).toBe(false)
        expect(await data.listStoreOptions()).toEqual(fxStores)
        expect(mockBuilt.n).toBe(0)
      }
    }
    process.env.BUSINESS_PRACTICE_TENANT = ' '
    expect(() => doorFor(TENANT)).toThrow('BUSINESS_PRACTICE_TENANT is set but is not a UUID')
  })

  it('P4 — doorFor: the tenant, exactly (case-blind UUID), and nothing else', () => {
    expect(doorFor(TENANT)).toBe(true)
    expect(doorFor(TENANT.toUpperCase())).toBe(true)
    expect(doorFor(OTHER)).toBe(false)
    expect(doorFor(null)).toBe(false)
    expect(doorFor(undefined)).toBe(false)
    expect(doorFor('')).toBe(false)
    delete process.env.BUSINESS_PRACTICE_TENANT
    for (const id of [TENANT, OTHER, null, undefined, '']) expect(doorFor(id)).toBe(false)
  })

  it('P5 — the write guard is unchanged: another business under door ON still answers tenant', async () => {
    as(LOGIN.owner, null, OTHER)
    expect(await data.writeReserveCardColor(null)).toEqual({ ok: false, reason: 'tenant' })
  })

  it('F1 — storeSample obeys its PARAMETER, never the env (the two disagree on purpose)', () => {
    expect(storeSample(false, STORE_A)).toMatchObject({ state: 'sample', marked: false })
    expect(() => storeSample(false, 'nope')).toThrow('Missing default kind for store nope')
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(storeSample(true, STORE.tokyo)).toMatchObject({ state: 'sample', marked: true })
  })

  it('F2 — the tenant, upper-cased, is still the tenant: the layout and 設定 take the ON path and a core client IS built', async () => {
    as(LOGIN.owner, null, TENANT.toUpperCase())
    mockBuilt.n = 0
    expect(await layoutOf()).toContain('"practice":true')
    const { props } = await settingsProps({ locale: 'ja', store: STORE.tokyo })
    expect(props.dateline.startsWith('サンプルデータ ')).toBe(false)
    expect(mockBuilt.n).toBeGreaterThan(0)
  })

  it('F3 — readCanManageCardColor + readStoreDays: another business gets the OFF answer, no core client', async () => {
    as(LOGIN.owner, null, OTHER)
    mockBuilt.n = 0
    expect(await data.readCanManageCardColor()).toBe(false)
    expect(await data.readStoreDays(STORE.tokyo)).toMatchObject({ ok: false, reason: 'tenant' })
    expect(mockBuilt.n).toBe(0)
  })

  it('P6 — no memo of the decision across requests in one process, either order', async () => {
    for (const order of [[TENANT, OTHER], [OTHER, TENANT]]) {
      for (const who of order) {
        as(LOGIN.owner, null, who)
        expect({ who, on: await data.practiceDoorOn() }).toEqual({ who, on: who === TENANT })
        expect(await layoutOf()).toContain(who === TENANT ? '"practice":true' : 'サンプル')
        if (who !== TENANT) expect(await layoutOf()).not.toContain('"practice":true')
      }
    }
  })
})

// ⚖ S82 R2 (Greptile P1) — the bound sits on the SHARED org read (orgSettingsOf): no reader of the business settings can
// hold the page past CORE_READ_BOUND_MS. A timeout rejects that one promise exactly as a failed read does; the org read
// logs ONE line per request; the board's readers (the shell, the colours, the hours) take their absent-org answer.
describe('(S82 R2) the shared org read is bounded — the board finishes whatever the business settings read does', () => {
  const ORG_LINE = '[practice org settings] core did not answer:'
  const NOW = new Date('2026-09-14T04:24:00Z')
  const page = async (store: string) => {
    const TodayPage = (await import('@/app/[locale]/(business)/business/today/page')).default
    const el = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store }) })
    return (el as unknown as { props: Record<string, unknown> }).props
  }
  const fakeAll = () => jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'hrtime', 'performance'] })
  const dateOnly = () => jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
  })
  const orgLines = (quiet: jest.SpyInstance) => quiet.mock.calls.filter((c) => c[0] === ORG_LINE).length
  const SAMPLE_MARK = { form: 'part', labels: ['シフトと休み', '販売可能枠', '営業時間'] }
  const absentOrgColours = async () => {
    withReads().orgSettingsGet.mockResolvedValue(null)
    return (await page(STORE.tokyo)).bookingColors
  }

  it('H3(a) page-level — the org read NEVER answers: pending at 4,999 ms, resolved at 5,000 ms; hours sample, colours = the absent-org colours, one org log line, no timer left', async () => {
    const absent = await absentOrgColours()
    const spy = withReads()
    spy.orgSettingsGet.mockImplementation(() => new Promise(() => {}))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    fakeAll()
    try {
      let done = false
      const pending = page(STORE.tokyo).then((p) => ((done = true), p))
      await jest.advanceTimersByTimeAsync(4999)
      expect(done).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      expect(done).toBe(true)
      const props = await pending
      expect(props.boardMark).toEqual(SAMPLE_MARK)
      expect(props.bookingColors).toEqual(absent)
      expect(spy.orgSettingsGet).toHaveBeenCalledTimes(1)
      expect(orgLines(quiet)).toBe(1)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      dateOnly()
      quiet.mockRestore()
    }
  })

  it('H3(b) page-level — the org read REJECTS: the page resolves; hours sample, colours = the absent-org colours, one org log line', async () => {
    const absent = await absentOrgColours()
    withReads().orgSettingsGet.mockRejectedValue(new Error('core down'))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const props = await page(STORE.tokyo)
      expect(props.boardMark).toEqual(SAMPLE_MARK)
      expect(props.bookingColors).toEqual(absent)
      expect(orgLines(quiet)).toBe(1)
    } finally {
      quiet.mockRestore()
    }
  })

  it.each([
    ['readShellIdentity', async () => (await data.readShellIdentity()).business, { name: '', storeCount: 7 }],
    ['readBookingColors', () => data.readBookingColors(), null],
  ])('H3(c) %s alone — the org read never answers: pending at 4,999 ms, its absent-org answer at 5,000 ms, no timer left', async (_name, read, expected) => {
    withReads().orgSettingsGet.mockImplementation(() => new Promise(() => {}))
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    fakeAll()
    try {
      let done = false
      const pending = (read as () => Promise<unknown>)().then((v) => ((done = true), v))
      await jest.advanceTimersByTimeAsync(4999)
      expect(done).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      expect(done).toBe(true)
      expect(await pending).toEqual(expected)
      expect(orgLines(quiet)).toBe(1)
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      dateOnly()
      quiet.mockRestore()
    }
  })

  it('H2 census — every reader of the org settings on a REJECTED org read (the board\'s readers degrade; the settings-page readers and the writers keep their failure path)', async () => {
    const outcome = async (f: () => Promise<unknown>) => {
      withReads().orgSettingsGet.mockRejectedValue(new Error('core down'))
      try {
        return { ok: await f() }
      } catch (e) {
        return { throws: e instanceof Error ? e.message : String(e) }
      }
    }
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const census = {
        readShellIdentity: await outcome(async () => (await data.readShellIdentity()).business.name),
        readBookingColors: await outcome(() => data.readBookingColors()),
        readHours: await outcome(async () => (await data.readDayPlanes(STORE.tokyo, TODAY) as { hoursSource?: string }).hoursSource),
        readReserveCardColor: await outcome(() => data.readReserveCardColor()),
        readStoreCapabilities: await outcome(() => data.readStoreCapabilities(STORE.tokyo)),
        readStoreSeedType: await outcome(() => data.readStoreSeedType(STORE.tokyo)),
        writeReserveCardColor: await outcome(() => data.writeReserveCardColor(null)),
      }
      console.log('H2 census', JSON.stringify(census))
      expect(census).toEqual({
        readShellIdentity: { ok: '' },
        readBookingColors: { ok: null },
        readHours: { ok: 'sample' },
        readReserveCardColor: { throws: 'core down' },
        readStoreCapabilities: { throws: 'core down' },
        readStoreSeedType: { throws: 'core down' },
        writeReserveCardColor: { ok: { ok: false, reason: 'core' } },
      })
    } finally {
      quiet.mockRestore()
    }
  })
})


describe('S84 — live-keyed inbox and register planes', () => {
  const seed = APPOINTMENTS.find((a) => a.kind === 'BOOKING' && a.store_id === STORE.tokyo)!
  const row = (id: string, extra: Partial<typeof seed> = {}) => ({ ...seed, id, customer_id: `customer-${id}`,
    starts_at: '2026-09-14T01:00:00Z', ends_at: '2026-09-14T02:00:00Z', status: 'COMPLETED' as const,
    booked_price_amount: 1234, booked_price_currency: 'JPY', ...extra })
  const serve = (rows: typeof APPOINTMENTS) => {
    const spy = withReads()
    spy.appointmentsList.mockResolvedValue({ appointments: rows, total: rows.length, page: 1, page_size: 500 })
    return spy
  }
  const carries = (id: string) => hash(id) % 23 < 5
  const pick = (prefix: string, thread: boolean, n = 1) => {
    const out: string[] = []
    for (let i = 0; out.length < n; i++) if (carries(`${prefix}-${i}`) === thread) out.push(`${prefix}-${i}`)
    return out
  }
  it('T-a one booking\'s thread is a function of its own id: inserting a booking relabels nobody', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`s85-${i}`))
    serve(rows)
    const first = (await door.readInboxPlanes(STORE.tokyo)).threads
    expect(first.map((t) => t.appointment_id)).toEqual(rows.filter((r) => carries(r.id)).map((r) => r.id))
    for (const t of first) {
      expect(t.id).toBe(`smp-thr-${t.appointment_id}`)
      expect(t.customer_id).toBe(rows.find((a) => a.id === t.appointment_id)!.customer_id)
    }
    for (const inserted of [...pick('s85-new', true), ...pick('s85-new', false)]) {
      serve([...rows.slice(0, 10), row(inserted), ...rows.slice(10)])
      const second = (await door.readInboxPlanes(STORE.tokyo)).threads
      for (const t of first) expect(second.find((u) => u.id === t.id)).toEqual(t)
      expect(second.some((t) => t.appointment_id === inserted)).toBe(carries(inserted))
      expect(second).toHaveLength(first.length + (carries(inserted) ? 1 : 0))
    }
  })
  it('T-b at 200 bookings the thread rate is the fixture 5/23 and change : delivery is 3 : 1', async () => {
    serve(Array.from({ length: 200 }, (_, i) => row(`s85-n-${i}`)))
    const { threads } = await door.readInboxPlanes(STORE.tokyo)
    expect(Math.abs(threads.length - 200 * 5 / 23)).toBeLessThanOrEqual(12)
    const change = threads.filter((t) => t.category === 'change').length
    const delivery = threads.filter((t) => t.category === 'delivery').length
    expect(change + delivery).toBe(threads.length)
    expect(Math.abs(change / threads.length - 3 / 4)).toBeLessThanOrEqual(0.25 * 3 / 4)
  })
  it('T-c cancelled → no thread; 無断 → the noshow template; a future booking never gets it', async () => {
    const [cancelled, absent] = pick('s85-c', true, 2)
    const future = Array.from({ length: 60 }, (_, i) => row(`s85-f-${i}`, { status: 'SCHEDULED', starts_at: '2026-09-16T01:00:00Z', ends_at: '2026-09-16T02:00:00Z' }))
    serve([row(cancelled, { status: 'CANCELLED' }), row(absent, { status: 'NO_SHOW' }), ...future])
    const { threads } = await door.readInboxPlanes(STORE.tokyo)
    expect(threads.some((t) => t.appointment_id === cancelled)).toBe(false)
    const noshow = fixtureThreads.find((t) => t.category === 'noshow')!
    expect(threads.find((t) => t.appointment_id === absent)).toMatchObject({ category: 'noshow', subject: noshow.subject })
    expect(threads.filter((t) => t.category === 'noshow').map((t) => t.appointment_id)).toEqual([absent])
    expect(threads.some((t) => t.category === 'waitlist')).toBe(false)
    serve([row(cancelled, { status: 'CANCELLED' })])
    expect((await door.readInboxPlanes(STORE.tokyo)).threads).toEqual([])
  })
  it('T-d the floor: one eligible booking that its hash leaves out still gets one change thread', async () => {
    const [quiet] = pick('s85-q', false)
    serve([row(quiet), row(pick('s85-x', true)[0], { status: 'CANCELLED' })])
    const { threads } = await door.readInboxPlanes(STORE.tokyo)
    expect(threads.map((t) => [t.appointment_id, t.category])).toEqual([[quiet, 'change']])
  })
  it('T-e a templated seat never carries the fixture\'s source proof', async () => {
    serve(Array.from({ length: 60 }, (_, i) => row(`s85-p-${i}`)))
    const { threads } = await door.readInboxPlanes(STORE.tokyo)
    expect(threads.length).toBeGreaterThan(0)
    expect(threads.every((t) => t.source_proof === null)).toBe(true)
  })
  it('limits inbox reach, keeps canonical twin text and customer-only affiliation', async () => {
    const twin = fixtureThreads.find((t) => t.category === 'change')!
    const live = liveIdOf('appointments', twin.appointment_id!)!
    serve([row(live, { customer_id: liveIdOf('customers', twin.customer_id)! })])
    expect((await door.readInboxPlanes(STORE.tokyo)).threads).toEqual([{ ...twin, id: `smp-thr-${live}`, appointment_id: live, customer_id: liveIdOf('customers', twin.customer_id) }])
    expect(INBOX_WINDOW_DAYS).toBe(RESERVATIONS_WINDOW_DAYS)
    const [d6, d7, before] = [pick('s85-d6', true)[0], pick('s85-d7', true)[0], pick('s85-y', true)[0]]
    serve([row(d6, { starts_at: '2026-09-20T14:59:00Z' }), row(d7, { starts_at: '2026-09-20T15:00:00Z' }), row(before, { starts_at: '2026-09-13T14:59:00Z' })])
    expect((await door.readInboxPlanes(STORE.tokyo)).threads.map((t) => t.appointment_id)).toEqual([d6])
    const wait = fixtureThreads.find((t) => t.appointment_id === null)!
    serve([row('affiliated', { customer_id: liveIdOf('customers', wait.customer_id)! })])
    expect((await door.readInboxPlanes(STORE.tokyo)).threads).toContainEqual({ ...wait, id: `smp-thr-${wait.id}`, customer_id: liveIdOf('customers', wait.customer_id) })
    serve(Array.from({ length: 20 }, (_, i) => row(`mixed-${i}`, { customer_id: liveIdOf('customers', wait.customer_id)! })))
    const mixed = (await door.readInboxPlanes(STORE.tokyo)).threads
    expect(mixed.filter((t) => t.category === 'waitlist').map((t) => t.id)).toEqual([`smp-thr-${wait.id}`])
  })
  it('settles only ended bookings, balances every yen and the count sheet, rejects a refund mutant', async () => {
    const spy = serve([row('paid'), row('zero', { booked_price_amount: null }),
      row('scheduled', { status: 'SCHEDULED' }), row('cancelled', { status: 'CANCELLED' }), row('absent', { status: 'NO_SHOW' }),
      row('future', { status: 'SCHEDULED', ends_at: '2026-09-14T05:00:00Z' }), row('now', { status: 'SCHEDULED', ends_at: '2026-09-14T04:24:00Z' }),
      row('tomorrow', { starts_at: '2026-09-15T01:00:00Z', ends_at: '2026-09-15T02:00:00Z' })])
    const plane = await door.readRegisterPlanes(STORE.tokyo)
    expect(plane.transactions.map((t) => t.appointment_id).sort()).toEqual(['paid', 'scheduled'])
    const bookings = await data.listAppointments(STORE.tokyo)
    const assertMoney = (transactions: FixtureTransaction[]) => {
      expect(transactions.flatMap((t) => t.tenders).every((t) => t.flag === '')).toBe(true)
      expect(transactions.flatMap((t) => t.tenders).reduce((n, t) => n + t.amount, 0)).toBe(2468)
      const totals = ledgerTotals(buildLedger({ transactions, appointments: bookings, customers: [], menus: [], terminalHeld: [], auditTrail: {}, lensStoreId: STORE.tokyo }))
      expect(totals).toMatchObject({ net: 2468, refunds: 0, outstanding: 0 })
      expect(plane.closing!.cash_counted - expectedCash({ float: plane.closing!.cash_float, paidIn: plane.closing!.cash_paid_in, paidOut: plane.closing!.cash_paid_out, bankDeposit: plane.closing!.cash_bank_deposit }, totals.cash)).toBe(0)
      expect(denominationTotal(plane.closing!.cash_count_sheet)).toBe(plane.closing!.cash_counted)
    }
    assertMoney(plane.transactions)
    const mutant = structuredClone(plane.transactions)
    mutant[0].tenders.push({ label: '現金', flag: 'refund', amount: -1 })
    expect(() => assertMoney(mutant)).toThrow()
    expect((await door.readRegisterPlanes(VIEW_ALL, bookings)).closing).toBeNull()
    const calls = spy.appointmentsList.mock.calls.length
    await data.readRegisterPlanes(STORE.tokyo, bookings, { transactions: [], closing: null, cashTolerance: 0 })
    await data.readInboxPlanes(STORE.tokyo, bookings, { threads: [] })
    expect(spy.appointmentsList).toHaveBeenCalledTimes(calls)
  })
  const unsettledCheck = (props: unknown) => JSON.stringify(props).match(/\{"key":"unsettled".*?"done":(true|false)/)
  it('T-f/T-g/T-h the register settles what the close calls finished, and nothing in the chair or unpriced', async () => {
    serve([row('late', { ends_at: '2026-09-14T06:00:00Z' }), row('chair', { status: 'IN_PROGRESS' }), row('unpriced', { booked_price_amount: null })])
    expect((await door.readRegisterPlanes(STORE.tokyo)).transactions.map((t) => t.appointment_id)).toEqual(['late'])
    const check = unsettledCheck((await registerProps({ locale: 'ja', store: STORE.tokyo })).props)!
    expect(check[1]).toBe('false')
    expect(check[0]).toContain('¥0')
    expect(check[0]).not.toContain('¥1,234')
    serve([row('late', { ends_at: '2026-09-14T06:00:00Z' })])
    expect(unsettledCheck((await registerProps({ locale: 'ja', store: STORE.tokyo })).props)![1]).toBe('true')
  })
  it('T-i a twin with no tenders falls back to the single-tender rule', async () => {
    const empty = fixtureTransactions.find((t) => t.appointment_id && t.tenders.length === 0)!
    serve([row(liveIdOf('appointments', empty.appointment_id!)!, { booked_price_amount: 0 })])
    expect((await door.readRegisterPlanes(STORE.tokyo)).transactions[0].tenders).toEqual([{ label: expect.any(String), amount: 0, flag: '' }])
  })
  it('T-j over 30 mixed rows Σ tenders = Σ booked_price of the settled bookings, and only finished visits settle', async () => {
    const statuses = ['COMPLETED', 'SCHEDULED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'] as const
    serve(Array.from({ length: 30 }, (_, i) => row(`s85-m-${i}`, { status: statuses[i % 5],
      booked_price_amount: i % 7 === 0 ? null : 1000 + i * 37, ends_at: i % 3 === 0 ? '2026-09-14T06:00:00Z' : '2026-09-14T02:00:00Z' })))
    const plane = await door.readRegisterPlanes(STORE.tokyo)
    const byId = new Map((await data.listAppointments(STORE.tokyo)).map((a) => [a.id, a]))
    const settled = plane.transactions.map((t) => byId.get(t.appointment_id!)!)
    expect(settled.length).toBeGreaterThan(0)
    expect(settled.every((a) => a.booked_price != null && a.board_state !== 'noshow' && (a.status === 'done' || a.status === 'booked'))).toBe(true)
    expect(plane.transactions.flatMap((t) => t.tenders).reduce((n, t) => n + t.amount, 0)).toBe(settled.reduce((n, a) => n + a.booked_price!, 0))
  })
  it('R4 a live booking without a display number reads as a booking; a fixture walk-in still reads as one', async () => {
    const fact = (r: { facts: Array<{ label: string; value: string }> }) => r.facts.find((f) => f.label === '予約')?.value
    serve([row('visit')])
    const on = (await registerProps({ locale: 'ja', store: STORE.tokyo })).props
    expect(on.rows).toHaveLength(1)
    expect(fact(on.rows[0])).not.toBe('予約なし・店頭販売')
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect((await registerProps({ locale: 'ja', store: STORE_A })).props.rows.map(fact)).toContain('予約なし・店頭販売')
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
  })
  it('S86 TEST 1 planes on Dev 銀座, props on the Tokyo lens with ids that have no 予約一覧 row: today\'s seats carry a deadline, 要対応 moves, 配信失敗 counts; an exception seat, a later day and a no-show keep none', async () => {
    const store = STORE.devGinza
    expect([STORE.tokyo, STORE.yokohama]).not.toContain(store) // not a registry twin: none of its own bookings has a 予約一覧 row
    const at = (id: string, hourUtc: number) => row(id, { store_id: store, customer_id: seed.customer_id, status: 'SCHEDULED',
      starts_at: `2026-09-14T${String(hourUtc).padStart(2, '0')}:00:00Z`, ends_at: `2026-09-14T${String(hourUtc + 1).padStart(2, '0')}:00:00Z` })
    const early = pick('s86-e', true, 6).map((id) => at(id, 1)) // 10:00 JST — before the pinned board now
    const late = pick('s86-l', true, 6).map((id) => at(id, 6)) // 15:00 JST — after it
    const record = fixtureReservations.find((r) => r.appointment_id === fixtureThreads.find((t) => t.category === 'change' && t.appointment_id)!.appointment_id)!
    const exceptionId = liveIdOf('appointments', record.appointment_id)!
    const [tomorrowId] = pick('s86-t', true)
    const tomorrow = { ...at(tomorrowId, 1), starts_at: '2026-09-15T01:00:00Z', ends_at: '2026-09-15T02:00:00Z' } // 10:00 JST tomorrow
    const [absentId] = pick('s86-n', false)
    const absent = { ...at(absentId, 1), status: 'NO_SHOW' as const }
    const extra = [tomorrow, absent]
    serve([...early, ...late, at(exceptionId, 2), ...extra])
    const planes = (await door.readInboxPlanes(store)).threads
    expect(planes.find((t) => t.appointment_id === tomorrowId)!.due).toBeNull()
    expect(planes.find((t) => t.appointment_id === absentId)).toMatchObject({ category: 'noshow', due: null })
    const exceptionSeat = planes.find((t) => t.appointment_id === exceptionId)!
    expect(exceptionSeat.due).toBeNull()
    const seated = planes.filter((t) => t.appointment_id !== null && ![exceptionId, tomorrowId, absentId].includes(t.appointment_id))
    expect(seated.length).toBe(12)
    for (const t of seated) expect(t.due).toBe(jstMinuteOfDay([...early, ...late].find((r) => r.id === t.appointment_id)!.starts_at))
    const records = (await data.readReservationPlanes(store)).reservations.map((r) => r.appointment_id)
    expect(seated.filter((t) => records.includes(t.appointment_id!))).toEqual([])
    // The props half on the Tokyo lens: the recorded harness lists no customers for Dev 銀座, and buildThreads drops
    // a thread whose customer the lens cannot read. These s86-* ids have no fixture twin, so no 予約一覧 row either.
    serve([...early, ...late, at(exceptionId, 2), ...extra].map((r) => ({ ...r, store_id: STORE.tokyo })))
    const tokyoRecords = (await data.readReservationPlanes(STORE.tokyo)).reservations.map((r) => r.appointment_id)
    expect(seated.filter((t) => tokyoRecords.includes(t.appointment_id!))).toEqual([])
    const { props } = await inboxProps({ locale: 'ja', store: STORE.tokyo })
    const shown = props.threads.filter((t) => seated.some((s) => s.id === t.id))
    expect(shown).toHaveLength(12)
    for (const t of shown) expect(t.dueLabel).not.toBe('期限なし')
    expect(props.summary.attention).toBeGreaterThan(0)
    expect(shown.filter((t) => early.some((r) => `smp-thr-${r.id}` === t.id)).every((t) => t.status === 'attention' && t.overdue)).toBe(true)
    expect(shown.filter((t) => late.some((r) => `smp-thr-${r.id}` === t.id)).every((t) => t.status === 'new' && !t.overdue)).toBe(true)
    expect(props.threads.find((t) => t.id === `smp-thr-${tomorrowId}`)).toMatchObject({ dueLabel: '期限なし', status: 'new', overdue: false })
    const failed = shown.filter((t) => t.category === 'delivery')
    expect(failed.length).toBeGreaterThan(0)
    expect(failed.every((t) => t.deliveryState === 'undelivered')).toBe(true)
    expect(props.summary.failures).toBeGreaterThanOrEqual(failed.length)
  })
  it('S86 TEST 2 door ON on the TWIN store: a twin thread keeps its 予約一覧 record\'s deadline, non-null and null alike', async () => {
    const withDeadline = fixtureReservations.find((r) => r.deadline !== null && fixtureThreads.some((t) => t.appointment_id === r.appointment_id))!
    const withoutDeadline = fixtureReservations.find((r) => r.deadline === null && fixtureThreads.some((t) => t.appointment_id === r.appointment_id && t.category !== 'noshow'))!
    expect([withDeadline.appointment_id, withDeadline.deadline, withoutDeadline.appointment_id]).toEqual(['apt-31', 12 * 60 + 30, 'apt-28'])
    const ids = [withDeadline, withoutDeadline].map((r) => liveIdOf('appointments', r.appointment_id)!)
    serve(ids.map((id) => row(id, { customer_id: seed.customer_id, status: 'SCHEDULED', starts_at: '2026-09-14T06:00:00Z', ends_at: '2026-09-14T07:00:00Z' })))
    const planes = (await door.readInboxPlanes(STORE.tokyo)).threads
    expect(ids.map((id) => planes.find((t) => t.appointment_id === id)!.due)).toEqual([null, null])
    const { props } = await inboxProps({ locale: 'ja', store: STORE.tokyo })
    const label = (id: string) => props.threads.find((t) => t.id === `smp-thr-${id}`)!.dueLabel
    expect(label(ids[0])).toMatch(/^12:30まで/)
    expect(label(ids[1])).toBe('期限なし')
  })
  it('S86 P1 a seated thread on a live booking with no fixture twin links 予約一覧 (display_no \'\'); a twin keeps its href exactly', async () => {
    const [liveId] = pick('s86-h', true)
    const twinId = liveIdOf('appointments', 'apt-31')!
    serve([liveId, twinId].map((id) => row(id, { customer_id: seed.customer_id, status: 'SCHEDULED', starts_at: '2026-09-14T06:00:00Z', ends_at: '2026-09-14T07:00:00Z' })))
    const { props } = await inboxProps({ locale: 'ja', store: STORE.tokyo })
    const thread = (id: string) => props.threads.find((t) => t.id === `smp-thr-${id}`)!
    const href = `/ja/business/reservations?store=${encodeURIComponent(STORE.tokyo)}`
    expect(thread(liveId)).toMatchObject({ bookingNo: '', bookingHref: href })
    expect(thread(twinId).bookingNo).toBeTruthy()
    expect(thread(twinId).bookingHref).toBe(href)
  })
  it('S86 P1 register sibling: a live booking with no fixture twin gets a 予約一覧 link on its register row; a twin row keeps its href exactly', async () => {
    const [liveId] = pick('s86-r', false)
    const twin = fixtureTransactions.find((t) => t.appointment_id && t.tenders.length)!
    const twinId = liveIdOf('appointments', twin.appointment_id!)!
    serve([row(liveId, { customer_id: seed.customer_id }), row(twinId, { customer_id: seed.customer_id, booked_price_amount: twin.tenders.reduce((n, t) => n + t.amount, 0) })])
    const txOf = new Map((await door.readRegisterPlanes(STORE.tokyo)).transactions.map((t) => [t.appointment_id, t.id]))
    const { props } = await registerProps({ locale: 'ja', store: STORE.tokyo })
    const rowOf = (id: string) => props.rows.find((r) => r.id === txOf.get(id))!
    const href = `/ja/business/reservations?store=${encodeURIComponent(STORE.tokyo)}`
    expect(rowOf(liveId)).toMatchObject({ bookingNo: '', bookingHref: href })
    expect(rowOf(twinId).bookingNo).toBeTruthy()
    expect(rowOf(twinId).bookingHref).toBe(href)
  })
  it('R5 one id served twice → one thread, one transaction', async () => {
    // The id CARRIES a thread (hash % 23 < 5), so the floor alone cannot make the inbox half pass.
    const [dup] = pick('s85-dup', true)
    serve([row(dup), row(dup)])
    expect((await door.readInboxPlanes(STORE.tokyo)).threads.filter((t) => t.appointment_id === dup)).toHaveLength(1)
    expect((await door.readRegisterPlanes(STORE.tokyo)).transactions).toHaveLength(1)
  })
  it('S86 F2 inboxProps reads appointments from JST midnight to the last ms of day INBOX_WINDOW_DAYS − 1', async () => {
    // Pinned clock: today is 2026-09-14 JST, whose 00:00 is 2026-09-13T15:00Z (the reach test above: 09-13T14:59Z is
    // outside, 09-20T14:59Z inside). inboxProps asks for to = jstSlot(7, 0, 0, now) − 1 ms = 2026-09-20T14:59:59.999Z;
    // the door hands core the exclusive day bound after it, 2026-09-20T15:00:00.000Z — that is the call pinned here.
    const spy = serve([row(pick('s86-w', true)[0])])
    await inboxProps({ locale: 'ja', store: STORE.tokyo })
    const window = spy.appointmentsList.mock.calls.map(([q]) => q as { from?: string; to?: string; store_id?: string }).find((q) => q.from === '2026-09-13T15:00:00.000Z')
    expect(window).toMatchObject({ to: '2026-09-20T15:00:00.000Z', store_id: STORE.tokyo })
  })
  it('retains a safe twin payment, replaces a mismatched twin, and propagates failed reads', async () => {
    const twin = fixtureTransactions.find((t) => t.appointment_id && t.tenders.length)!
    const id = liveIdOf('appointments', twin.appointment_id!)!
    const price = twin.tenders.reduce((n, t) => n + t.amount, 0)
    serve([row(id, { booked_price_amount: price })])
    const kept = (await door.readRegisterPlanes(STORE.tokyo)).transactions[0]
    expect(kept.tenders).toEqual(twin.tenders)
    expect(kept.tenders).not.toBe(twin.tenders)
    expect(kept.tenders[0]).not.toBe(twin.tenders[0])
    expect(kept.audit).toEqual(twin.audit)
    expect(kept.audit).not.toBe(twin.audit)
    serve([row(id, { booked_price_amount: price + 1 })])
    expect((await door.readRegisterPlanes(STORE.tokyo)).transactions[0].tenders).toEqual([{ label: expect.any(String), amount: price + 1, flag: '' }])
    withReads().appointmentsList.mockRejectedValue(new Error('S84 timeout'))
    await expect(door.readInboxPlanes(STORE.tokyo)).rejects.toThrow('S84 timeout')
    await expect(door.readRegisterPlanes(STORE.tokyo)).rejects.toThrow('S84 timeout')
    as(LOGIN.musubi)
    await expect(door.readInboxPlanes(STORE.tokyo)).rejects.toBeInstanceOf(PracticeLensRefused)
    await expect(door.readRegisterPlanes(STORE.tokyo)).rejects.toBeInstanceOf(PracticeLensRefused)
  })
  it('OFF returns exactly the `off` object passed and ON ignores it for the door readers; props keep overrides and table marks', async () => {
    const offInbox = { threads: fixtureThreads }
    const offRegister = { transactions: fixtureTransactions, closing: fixtureClosing[STORE_A], cashTolerance }
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(await data.readInboxPlanes(STORE_A, undefined, offInbox)).toBe(offInbox)
    expect(await data.readRegisterPlanes(STORE_A, undefined, offRegister)).toBe(offRegister)
    expect(await data.readRegisterPlanes(VIEW_ALL, undefined, offRegister)).toBe(offRegister)
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    const onInbox = await data.readInboxPlanes(STORE.tokyo, undefined, offInbox)
    expect(onInbox).not.toBe(offInbox)
    expect(onInbox).toEqual(await door.readInboxPlanes(STORE.tokyo))
    expect(await data.readRegisterPlanes(STORE.tokyo, undefined, offRegister)).toEqual(await door.readRegisterPlanes(STORE.tokyo))
    const inbox = (await inboxProps({ locale: 'ja', store: STORE.tokyo })).props
    const register = (await registerProps({ locale: 'ja', store: STORE.tokyo })).props
    expect(inbox.threads.length).toBeGreaterThan(0)
    expect(register.sample).toEqual({ form: 'whole' })
    expect(inbox.sample).toEqual({ form: 'whole' })
    expect(inbox.dateline).toBe(data.sampleDateline(data.renderNow(), inbox.lensLabel, true))
    expect(register.dateline).not.toContain('サンプル')
    expect((await inboxProps({ locale: 'ja', store: STORE.tokyo, world: { threads: [] } })).props.threads).toEqual([])
  })
})

describe('(12) Reserve S66 — 受付 reads the store\'s six booking rules live (door ON, テスト東京店)', () => {
  type Props = Awaited<ReturnType<typeof settingsProps>>['props']
  const blockOf = (props: Props, blockId: string) => props.sections.find((s) => s.id === 'reserve-acceptance')!.blocks.find((b) => b.id === blockId)!
  const controlOf = (props: Props, id: string) =>
    props.sections.flatMap((s) => s.blocks.flatMap((b) => b.rows.flatMap((r) => r.controls))).find((c) => c.id === id)!
  const SIX = { booking_open_days: 21, cutoff_minutes: 90, reserve_start_grid_min: 15, cancel_free_until_hours: 12, cancel_late_pct: 30, no_show_pct: 100 }
  const read = async (six: Partial<typeof SIX>, updated_at: string | null = '2026-10-07T01:00:00Z') => {
    const spy = withReads()
    spy.storePolicyGet.mockImplementation(async (id: string) => (id === STORE.tokyo ? { ...POLICIES[id], ...SIX, ...six, updated_at } : POLICIES[id]))
    return (await settingsProps({ locale: 'ja', store: STORE.tokyo, section: 'reserve-acceptance' })).props
  }

  it('the six rows show core\'s row; 直前の空きは売らない is linked to 直前締切 (locked, never written)', async () => {
    const props = await read({})
    expect(['reserve.days', 'reserve.cutoff', 'reserve.grid', 'reserve.free', 'reserve.sameday', 'reserve.noshow'].map((id) => controlOf(props, id).value))
      .toEqual(['21', '90', '15', '12', '30', '100'])
    expect(controlOf(props, 'reserve.lead')).toMatchObject({ value: '90', locked: '上の「直前締切」と同じ値です。変えるときは「直前締切」を変更してください' })
    const lead = props.sections.flatMap((s) => s.blocks.flatMap((b) => b.rows)).find((r) => r.controls.some((c) => c.id === 'reserve.lead'))!
    expect(lead.trio!.base).toBe('初期値: 直前締切と同じ')
  })

  it('R5/R5b — the late-from-booking note shows only when cutoff < free×60 AND the late fee is above 0', async () => {
    expect(blockOf(await read({}), 'reserve.cancel').facts).toEqual([LATE_FROM_BOOKING_NOTE])
    expect(blockOf(await read({ cancel_late_pct: 0 }), 'reserve.cancel').facts ?? []).not.toContain(LATE_FROM_BOOKING_NOTE)
    expect(blockOf(await read({ cutoff_minutes: 720 }), 'reserve.cancel').facts ?? []).not.toContain(LATE_FROM_BOOKING_NOTE)
    expect(blockOf(await read({ cutoff_minutes: 719 }), 'reserve.cancel').facts).toEqual([LATE_FROM_BOOKING_NOTE])
  })

  it('R11/R11b — 最終変更 is core\'s updated_at on both live blocks; no line when updated_at is null', async () => {
    const props = await read({})
    expect(blockOf(props, 'reserve.window').audit).toBe('最終変更: 10月7日(水)')
    expect(blockOf(props, 'reserve.cancel').audit).toBe('最終変更: 10月7日(水)')
    const none = await read({}, null)
    expect(blockOf(none, 'reserve.window').audit ?? null).toBeNull()
    expect(blockOf(none, 'reserve.cancel').audit ?? null).toBeNull()
  })

  it('R1 — the window block marks only its opsConfig rows; the cancel block is unmarked while live', async () => {
    const props = await read({})
    expect(blockOf(props, 'reserve.window').sample).toEqual({ form: 'part', labels: [...PLANE_LABEL.opsConfig] })
    expect(blockOf(props, 'reserve.cancel')).not.toHaveProperty('sample')
  })
})

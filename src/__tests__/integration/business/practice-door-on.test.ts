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
  const { practiceTenant } = jest.requireActual('@/business/lib/practice-door/switch')
  return {
    ...actual,
    clientFor: (admitted: { businessId: string }) => {
      const tenant = practiceTenant()
      if (tenant === null) throw new Error('practice door called with the switch unset')
      if (admitted.businessId !== tenant) throw new actual.PracticeTenantMismatch(admitted.businessId)
      return mockCore.reads
    },
  }
})

import * as data from '@/business/lib/data'
import { requireBusinessAdmission } from '@/business/lib/admission'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { PracticeTenantMismatch } from '@/business/lib/practice-door/core-reach'
import { PracticeLensRefused, practiceActor } from '@/business/lib/practice-door/actor'
import { sampleKeys, sampleRows, storeSample } from '@/business/lib/practice-door/sample-facade'
import { liveIdOf } from '@/business/lib/practice-door/registry'
import { customers, STORE_A, STORE_C } from '@/business/lib/fixtures'
import { defaultKindOf, staffQualifications } from '@/business/lib/fixtures-today'
import { storeDials } from '@/business/lib/fixtures-settings'
import { jstDayKey } from '@/business/lib/clock'
import {
  APT, AKARI, ASSIGNMENTS, CARD, KOBAYASHI, LOGIN, MENU, STAFF, STORE, TENANT, membership, recordedReads,
  type RecordedOptions,
} from './practice-door-recorded'

// Hoisted-mock handle (jest allows `mock`-prefixed names in a factory).
const mockCore: { reads: CoreReads } = { reads: recordedReads() }
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
function as(userId: string, email: string | null = null, businessId: string = TENANT) {
  admission.mockResolvedValue({ userId, email, businessId })
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

  it('listStoreOptions: the 5 active stores in core order, typed by sample policy', async () => {
    const opts = await data.listStoreOptions()
    expect(ids(opts)).toEqual([STORE.devSalon, STORE.devGinza, STORE.tokyo, STORE.yokohama, STORE.laEstro])
    expect(opts.map((s) => s.business_type)).toEqual(['', '', 'beauty_chiropractic', 'massage', 'esthetic_salon'])
    expect(opts.map((s) => s.default_kind_id)).toEqual(['', '', 'k-a', 'k-b', ''])
    expect(opts.map((s) => s.name)).toEqual(['Dev Salon', 'Dev 銀座', 'テスト東京店', 'テスト横浜店', 'La Estro Test Store'])
  })

  it('readShellIdentity: live org name + the actor-visible count + the card; honest empty when org is null', async () => {
    const shell = await data.readShellIdentity()
    expect(shell.business).toEqual({ name: 'Dev Salon', storeCount: 5 })
    expect(shell.operator).toEqual({ name: 'Dev Salon', mark: 'Dev', role: 'オーナー', staff_id: CARD.owner })
    expect(typeof shell.reserveSyncedAt).toBe('string')
    withReads({ orgName: null })
    expect((await data.readShellIdentity()).business.name).toBe('')
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
    expect(all).toHaveLength(16)
    expect(all.find((s) => s.id === CARD.goro)).toEqual({ id: CARD.goro, full_name: '見本 ごろう', email: 'goro@test.invalid' })
  })

  it('readStaffStores: null for the floating card, the two-store arrays from the live assignments', async () => {
    const map = await data.readStaffStores(STORE.tokyo)
    expect(map[CARD.musubi]).toBeNull()
    expect(map[CARD.saburo]).toEqual([STORE.tokyo, STORE.yokohama])
    expect(map[CARD.goro]).toEqual([STORE.yokohama, STORE.tokyo])
    expect(map).not.toHaveProperty(CARD.inactive)
    expect(Object.keys(map)).toHaveLength(16)
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
    expect(await data.listCustomers(VIEW_ALL)).toHaveLength(14)
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
    expect([by(APT.a13).status, by(APT.a13).board_state]).toEqual(['booked', 'confirmed']) // IN_PROGRESS
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
    ])
    expect(byDay.get(TODAY + 1)!.map((b) => [b.id, b.start, b.end, b.micro, b.note])).toEqual([[APT.blockMidnight, 0, 30, false, 'recorded note']])
  })

  it('dayStartIso: 00:00 JST of today, yesterday and across a month boundary (the from/to the door sends)', async () => {
    const cases: Array<[number, string, string]> = [
      [TODAY, '2026-09-13T15:00:00.000Z', '2026-09-14T15:00:00.000Z'],
      [TODAY - 1, '2026-09-12T15:00:00.000Z', '2026-09-13T15:00:00.000Z'],
      [jstDayKey('2026-08-31T03:00:00Z'), '2026-08-30T15:00:00.000Z', '2026-08-31T15:00:00.000Z'],
      [jstDayKey('2026-10-01T03:00:00Z'), '2026-09-30T15:00:00.000Z', '2026-10-01T15:00:00.000Z'],
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
    expect(Object.keys(counts.byStore)).toEqual([STORE.devSalon, STORE.devGinza, STORE.tokyo, STORE.yokohama, STORE.laEstro])
    expect(counts.byStore[STORE.tokyo]).toBe(4)
    expect(counts.all).toBe(4)
  })

  it('readDayPlanes(東京, today): SAMPLE planes on live ids, the live blocks, no fixture store id anywhere', async () => {
    const planes = await data.readDayPlanes(STORE.tokyo, TODAY)
    expect(planes.shifts.every((s) => /^[0-9a-f-]{36}$/.test(s.staff_id))).toBe(true)
    expect(ids(planes.blocks)).toEqual([APT.blockUntitled, APT.blockMidnight])
    expect(planes.sellSlots.every((s) => s.store_id === STORE.tokyo)).toBe(true)
    expect(planes.sellSlots.length).toBeGreaterThan(0)
    expect(planes.register.terminal_held.map((h) => h.appointment_id)).toEqual([APT.a25])
    expect(JSON.stringify(planes)).not.toContain('store-test-')
    const other = await data.readDayPlanes(STORE.tokyo, TODAY + 1)
    expect(other.decisions).toEqual([])
    expect(other.register.terminal_held).toEqual([])
  })

  it('readReservationPlanes + readAnalyticsPlanes: rewritten ids, targets by sample policy', async () => {
    const res = await data.readReservationPlanes(STORE.tokyo)
    expect(JSON.stringify(res)).not.toContain('store-test-')
    expect(res.register.terminal_held.map((h) => h.appointment_id)).toEqual([APT.a25])
    expect((await data.readAnalyticsPlanes(STORE.tokyo)).target).toBe(2000000)
    expect((await data.readAnalyticsPlanes(STORE.laEstro)).target).toBe(0)
    expect((await data.readAnalyticsPlanes(VIEW_ALL)).target).toBe(2800000)
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
    expect(shell.operator.role).toBe('マネージャー')
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
  it('(4) tenant mismatch: every reader rejects before any read', async () => {
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
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(PracticeTenantMismatch)
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
  it('(8) a core error propagates — never an empty list', async () => {
    const spy = withReads()
    spy.staffList.mockRejectedValue(new Error('502'))
    await expect(data.listStaff(STORE.tokyo)).rejects.toThrow('502')
  })
})

describe('(9) storeSample — the three bypass sites’ one read', () => {
  it('OFF: exactly defaultKindOf + storeDials, including the throw', () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(storeSample(STORE_A)).toEqual({ state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A] })
    expect(() => storeSample('nope')).toThrow('Missing default kind for store nope')
  })
  it('ON: by sample policy; a live uuid never throws', () => {
    expect(storeSample(STORE.tokyo)).toEqual({ state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A] })
    expect(storeSample(STORE.laEstro)).toEqual({ state: 'sample', words: null, dials: null })
    expect(storeSample(STORE.devSalon)).toEqual({ state: 'no-sample-policy', storeId: STORE.devSalon, words: null, dials: null })
    expect(storeSample('nope')).toEqual({ state: 'no-sample-policy', storeId: 'nope', words: null, dials: null })
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
    expect(STAFF).toHaveLength(17)
    expect(ASSIGNMENTS).not.toHaveProperty(CARD.musubi)
  })
})

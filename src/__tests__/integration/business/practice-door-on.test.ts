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

// ⚖ A1b · P2-2 — the card's two reads, wrapped (same functions) so a test can see whether they ran at all.
jest.mock('@/business/lib/data', () => {
  const actual = jest.requireActual('@/business/lib/data')
  return { ...actual, readReserveCardColor: jest.fn(actual.readReserveCardColor), readStoreAddress: jest.fn(actual.readStoreAddress), listStoreOptions: jest.fn(actual.listStoreOptions) }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as data from '@/business/lib/data'
import { requireBusinessAdmission } from '@/business/lib/admission'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { PracticeTenantMismatch } from '@/business/lib/practice-door/core-reach'
import { PracticeLensRefused, pageAll, practiceActor } from '@/business/lib/practice-door/actor'
import {
  attachSample, historyOperatorName, PLANE_LABEL, PLANE_MAP_SAYS_LIVE, PLANE_ROW, planesOf, PRACTICE_PLANES, rekeyKeys, rekeyRows, sampleFor,
  sampleKeys, samplePart, sampleRows, sampleSelfId, sampleWhole, STORE_PLANE_OVERRIDES, storeSample,
} from '@/business/lib/practice-door/sample-facade'
import { liveIdOf, samplePolicyFor } from '@/business/lib/practice-door/registry'
import { customers, operator, staff as fxStaff, STORE_A, STORE_B, STORE_C } from '@/business/lib/fixtures'
import {
  absence as fxAbsence, decisions as fxDecisions, defaultKindOf, register, sellSlots as fxSlots, shifts as fxShifts,
  staffListPrice as fxListPrice, staffQualifications,
} from '@/business/lib/fixtures-today'
import { jstDayKey } from '@/business/lib/clock'
import { rulebook, storeDials } from '@/business/lib/fixtures-settings'
import { accessFor as settingsAccessFor, RAIL, yen } from '@/business/lib/settings'
import { salesTargets } from '@/business/lib/fixtures-analytics'
import { accessFor as askAiAccessFor } from '@/business/lib/ask-ai'
import { accessFor as karuteAccessFor } from '@/business/lib/karute'
import { accessFor as recordingAccessFor } from '@/business/lib/recording'
import { accessFor as registerAccessFor } from '@/business/lib/register'
import { settingsProps } from '@/app/[locale]/(business)/business/settings/settings-props'
import { recordingProps } from '@/app/[locale]/(business)/business/recording/recording-props'
import { karuteProps } from '@/app/[locale]/(business)/business/karute/karute-props'
import {
  APPOINTMENTS, APT, AKARI, ASSIGNMENTS, CARD, CUSTOMERS, KOBAYASHI, LOGIN, MENU, STAFF, STORE, STORES, TENANT, membership, recordedReads,
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
    // ⚖ PR-3 V4-2 — every practice store takes a plane: a borrower shows its plane's 業種 unless it names its own.
    expect(opts.map((s) => s.business_type)).toEqual(['beauty_chiropractic', 'beauty_chiropractic', 'beauty_chiropractic', 'massage', 'esthetic_salon'])
    expect(opts.map((s) => s.default_kind_id)).toEqual(['k-a', 'k-a', 'k-a', 'k-b', 'k-a'])
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
    expect(Object.keys(counts.byStore)).toEqual([STORE.devSalon, STORE.devGinza, STORE.tokyo, STORE.yokohama, STORE.laEstro])
    expect(counts.byStore[STORE.tokyo]).toBe(4)
    // ⚖ PR-4a R6 + R8' — each borrower counts what it is served; the recorded world has 0 rooms at every
    // store, so no borrower is served a slot or its decision → 0. 横浜 twins STORE_B: none.
    expect([STORE.devSalon, STORE.devGinza, STORE.laEstro].map((s) => counts.byStore[s])).toEqual([0, 0, 0])
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
    expect((await data.readAnalyticsPlanes(VIEW_ALL)).target).toBe(4 * 2000000 + 800000)
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
    expect(map[CARD.musubi]).toBeNull() // floating stays floating
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
    expect(needsManage).toContain('reserve-card-look')
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
    expect(sampleSelfId('staff', 'p-06')).toBe('p-06')
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    expect(sampleSelfId('staff', CARD.azusa)).toBe('p-06')
    expect(sampleSelfId('staff', CARD.owner)).toBeNull()
    expect(sampleSelfId('staff', null)).toBeNull()
  })
  it('attachSample: OFF the same plane (same reference); ON the ids rewritten', () => {
    const plane = [{ appointment_id: 'apt-14', store_id: STORE_A, by_staff_card_id: 'c-03' }]
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(attachSample(plane, null)).toBe(plane)
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    expect(attachSample(plane, null)).toEqual([{ appointment_id: APT.a14, store_id: STORE.tokyo, by_staff_card_id: 'c-03' }])
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
    expect(storeSample(STORE_A)).toEqual({ state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A], marked: false, planes: allLive })
    expect(() => storeSample('nope')).toThrow('Missing default kind for store nope')
  })
  it('ON: by sample policy; a live uuid never throws', () => {
    expect(storeSample(STORE.tokyo)).toEqual({ state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A], marked: true, planes: PRACTICE_PLANES })
    // ⚖ PR-3 V4-2 — every practice store (and any id the table does not name) takes a plane WITH dials.
    const onA = { state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A], marked: true, planes: PRACTICE_PLANES }
    expect(storeSample(STORE.laEstro)).toEqual(onA)
    expect(storeSample(STORE.devSalon)).toEqual(onA)
    expect(storeSample('nope')).toEqual(onA)
  })
  // ⚖ PR-3 — the mark keys on the door being ON, never on `state === 'sample'`
  // (which is also every OFF answer).
  it('PR-3 marked: OFF false on every fixture store; ON true on a twin and on a borrower (V4-2)', () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    for (const id of [STORE_A, STORE_B]) expect(storeSample(id)).toMatchObject({ state: 'sample', marked: false })
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    expect(storeSample(STORE.tokyo)).toMatchObject({ state: 'sample', marked: true })
    expect(storeSample(STORE.devSalon)).toMatchObject({ state: 'sample', marked: true })
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
      const s = storeSample(id)
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
    expect(storeSample('11111111-2222-4333-8444-555555555555')).toMatchObject({ state: 'sample', dials: storeDials[STORE_A], marked: true })
  })
  it('(c) no-sample-policy is unreachable under ON — the seven + three random uuids', () => {
    const random = ['0f0f0f0f-1e1e-4d2d-8c3c-4b4b4b4b4b4b', 'ffffffff-ffff-4fff-bfff-ffffffffffff', '12345678-9abc-4def-8123-456789abcdef']
    for (const id of [...Object.values(SEVEN), ...random]) expect({ id, state: storeSample(id).state }).toEqual({ id, state: 'sample' })
  })
  it('(d) La Estro keeps its 業種 (esthetic_salon) while its dials are STORE_A\'s', async () => {
    expect(samplePolicyFor(SEVEN.laEstro)).toEqual({ kind: 'twin', fixtureStoreId: STORE_A, business_type: 'esthetic_salon' })
    expect(storeSample(SEVEN.laEstro).dials).toBe(storeDials[STORE_A])
  })
})

describe('(9b) ⚖ PR-3 §v3 — the plane table, ONE home per store × plane', () => {
  afterEach(() => {
    for (const k of Object.keys(STORE_PLANE_OVERRIDES)) delete STORE_PLANE_OVERRIDES[k]
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
  })
  const BOARD = ['shifts', 'absence', 'sellSlots', 'operatingHours'] as const
  // ⚖ §v6 V6-2 — every plane but ONE: #1049 connected 予約の色分け's read (core's per-store colours), so
  // `bookingColors` is LIVE in the practice table; every other plane stays SAMPLE.
  it('every plane is SAMPLE for the practice business but bookingColors (LIVE, §v6 V6-2), and `marked` IS 「some plane is sample」', () => {
    expect(Object.entries(PRACTICE_PLANES).filter(([, s]) => s !== 'sample')).toEqual([['bookingColors', 'live']])
    expect(sampleWhole(STORE.tokyo, 'bookingColors')).toBeUndefined()
    expect(sampleWhole(STORE.tokyo, 'language')).toEqual({ form: 'whole' })
    const s = storeSample(STORE.tokyo)
    expect(s.state === 'sample' && s.marked === Object.values(s.planes).some((p) => p === 'sample')).toBe(true)
  })
  it('OFF: no mark from either reader, on any store; the planes read all live', () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    for (const id of [STORE_A, STORE_B]) {
      expect(sampleWhole(id, 'auditLog')).toBeUndefined()
      expect(samplePart(id, ...BOARD)).toBeUndefined()
      const s = storeSample(id)
      expect(s.state === 'sample' && Object.values(s.planes).every((p) => p === 'live')).toBe(true)
    }
  })
  it('F-6 — no store in view (a storeless 設定 / an empty list): no mark, never a storeSample call', () => {
    expect(sampleWhole(null, 'auditLog')).toBeUndefined()
    expect(samplePart(null, 'staffActive')).toBeUndefined()
    expect(sampleWhole([], 'decisions')).toBeUndefined()
  })
  it('ON: whole form; part form names its planes by the native-pass labels, deduped (shifts + absence = ONE label), in order', () => {
    expect(sampleWhole(STORE.tokyo, 'auditLog')).toEqual({ form: 'whole' })
    expect(samplePart(STORE.tokyo, ...BOARD)).toEqual({ form: 'part', labels: ['シフトと休み', '販売可能枠', '営業時間'] })
    expect(samplePart(STORE.tokyo, 'staffActive')).toEqual({ form: 'part', labels: ['稼働状態'] })
  })
  it('flipping ONE plane live for ONE store removes that plane and nothing else; a plane still sample elsewhere in view keeps it', () => {
    STORE_PLANE_OVERRIDES[STORE.tokyo] = { operatingHours: 'live' }
    expect(sampleWhole(STORE.tokyo, 'operatingHours')).toBeUndefined()
    expect(samplePart(STORE.tokyo, ...BOARD)).toEqual({ form: 'part', labels: ['シフトと休み', '販売可能枠'] })
    expect(sampleWhole(STORE.tokyo, 'shifts')).toEqual({ form: 'whole' })
    expect(sampleWhole(STORE.yokohama, 'operatingHours')).toEqual({ form: 'whole' })
    expect(sampleWhole([STORE.tokyo, STORE.yokohama], 'operatingHours')).toEqual({ form: 'whole' })
    expect(storeSample(STORE.tokyo)).toMatchObject({ state: 'sample', marked: true })
    STORE_PLANE_OVERRIDES[STORE.tokyo] = Object.fromEntries(Object.keys(PRACTICE_PLANES).map((k) => [k, 'live']))
    expect(storeSample(STORE.tokyo)).toMatchObject({ state: 'sample', marked: false })
    expect(samplePart(STORE.tokyo, ...BOARD)).toBeUndefined()
    expect(planesOf('toString')).toEqual(PRACTICE_PLANES)
  })
  it('every plane names its CONTRACT-MAP row (the lane harness reads the map against this table)', () => {
    expect(Object.keys(PLANE_ROW).sort()).toEqual(Object.keys(PRACTICE_PLANES).sort())
    expect(Object.values(PLANE_ROW).every((r) => r.length > 0)).toBe(true)
    expect(PLANE_MAP_SAYS_LIVE.every((k) => k in PLANE_ROW)).toBe(true)
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
    expect(STAFF).toHaveLength(17)
    expect(ASSIGNMENTS).not.toHaveProperty(CARD.musubi)
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
    expect(org.table!.rows.map((r) => r.cells[0])).toEqual(['Dev Salon', 'Dev 銀座', 'テスト東京店', 'テスト横浜店', 'La Estro Test Store'])
    expect(org.table!.rows.map((r) => r.cells[1])).toEqual(['—', '—', 'いま見ている店舗', '—', '—'])
    expect(blockOf(props, 'business-structure', 'org.brand').facts[0]).toMatch(/^5店舗の運営のため/)
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
    const audits = everyBlock(props).map((b) => b.audit).filter((a): a is string => a !== null)
    expect(audits.length).toBeGreaterThan(5)
    expect(audits.every((a) => a.startsWith('最終変更: 見本 あずさ ・'))).toBe(true)
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
    expect(blockOf(props, 'business-structure', 'org.stores').table!.rows).toHaveLength(5)
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
  const look = async (store?: string) => (await settingsProps({ locale: 'ja', store })).props.sections.find((s) => s.id === 'reserve-card-look')!

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
    const all = props.sections.find((s) => s.id === 'reserve-card-look')!
    expect({ gate: all.gate, kicker: all.kicker, value: all.cardLook?.value, storeLine: all.cardLook?.storeLine, address: 'address' in all.cardLook! })
      .toEqual({ gate: 'open', kicker: 'Reserve設定', value: '#00304C', storeLine: '', address: false })
  })

  it('K11 — ON: the cover address is the door’s own store record, never the fixture twin’s', async () => {
    const spy = withReads()
    spy.storesList.mockResolvedValue({ stores: STORES.map((s) => (s.id === STORE.tokyo ? { ...s, address: '東京都港区実在1-2-3' } : s)) })
    expect(await data.readStoreAddress(STORE.tokyo)).toBe('東京都港区実在1-2-3')
    expect((await look(STORE.tokyo)).cardLook!.address).toBe('東京都港区実在1-2-3')
    // 横浜 is a fixture TWIN with a sample address in its dials; core holds none → omitted, never the fixture's
    expect(storeSample(STORE.yokohama).dials?.profile.address).toBeTruthy() // the value the old source printed
    expect(await data.readStoreAddress(STORE.yokohama)).toBeNull()
    expect('address' in (await look(STORE.yokohama)).cardLook!).toBe(false)
  })

  it('P2-2 — ONE org-settings read per 設定 render: the shell’s name and the card colour share it', async () => {
    const spy = withReads()
    const colour = data.readReserveCardColor as jest.Mock
    colour.mockClear()
    const { props } = await settingsProps({ locale: 'ja', store: STORE.tokyo })
    expect(props.sections.find((s) => s.id === 'reserve-card-look')!.gate).toBe('open')
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
    expect(props.sections.find((s) => s.id === 'reserve-card-look')!.gate).toBe('no-rights')
    expect(colour).not.toHaveBeenCalled()
    expect(address).not.toHaveBeenCalled()
    expect(spy.orgSettingsGet).toHaveBeenCalledTimes(1) // the shell's own (the business name)
  })

  it('another business is refused before any read — nothing of it can reach the payload', async () => {
    const spy = withReads()
    as(LOGIN.owner, null, '00000000-0000-4000-8000-00000000dead')
    await expect(settingsProps({ locale: 'ja' })).rejects.toThrow(PracticeTenantMismatch)
    expect(spy.orgSettingsGet).not.toHaveBeenCalled()
  })
})

describe('(12) PR-3 — 今日の運営 marks its SAMPLE planes under the door', () => {
  it.each([['twin 東京', STORE.tokyo], ['Dev Salon (borrows 東京)', STORE.devSalon]])('%s: the board carries its marks; no 「お客様様」, no raw enum with a dangling 「/」', async (_label, store) => {
    const TodayPage = (await import('@/app/[locale]/(business)/business/today/page')).default
    const el = await TodayPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store }) })
    const props = (el as unknown as { props: Record<string, unknown> }).props
    // ⚖ §v3 — the grid head names its planes (D2 order); the decisions + 勤務不可 marks are whole.
    expect(props.boardMark).toEqual({ form: 'part', labels: ['シフトと休み', '販売可能枠', '営業時間'] })
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
  const BORROWERS = [STORE.devSalon, STORE.devGinza, STORE.laEstro]

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
    expect(await day([live(STORE.devSalon, ROOM_B, '16:30', '17:00', { status: 'CANCELLED' })])).toEqual(both)
    expect(await day([live(STORE.devSalon, ROOM_A, '18:00', '18:30', { kind: 'BLOCK', customer_id: null })])).toEqual({ slots: ['slot-01~5a171878'], cards: ['dec-capacity~5a171878'] })
    expect(await day([live(STORE.tokyo, 'bed-02', '16:00', '17:00')])).toEqual(both) // an exact twin's room is never checked
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
    expect(tokyo.shifts).toEqual(sampleFor(fxShifts, null))
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
})

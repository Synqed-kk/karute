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
  return { ...actual, readReserveCardColor: jest.fn(actual.readReserveCardColor), readStoreAddress: jest.fn(actual.readStoreAddress) }
})

import * as data from '@/business/lib/data'
import { requireBusinessAdmission } from '@/business/lib/admission'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { PracticeTenantMismatch } from '@/business/lib/practice-door/core-reach'
import { PracticeLensRefused, pageAll, practiceActor } from '@/business/lib/practice-door/actor'
import { attachSample, sampleKeys, sampleRows, sampleSelfId, storeSample } from '@/business/lib/practice-door/sample-facade'
import { liveIdOf } from '@/business/lib/practice-door/registry'
import { customers, STORE_A, STORE_B, STORE_C } from '@/business/lib/fixtures'
import { defaultKindOf, register, staffQualifications } from '@/business/lib/fixtures-today'
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
  APT, AKARI, ASSIGNMENTS, CARD, KOBAYASHI, LOGIN, MENU, STAFF, STORE, STORES, TENANT, membership, recordedReads,
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
    expect(storeSample(STORE_A)).toEqual({ state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A], marked: false })
    expect(() => storeSample('nope')).toThrow('Missing default kind for store nope')
  })
  it('ON: by sample policy; a live uuid never throws', () => {
    expect(storeSample(STORE.tokyo)).toEqual({ state: 'sample', words: defaultKindOf(STORE_A).words, dials: storeDials[STORE_A], marked: true })
    expect(storeSample(STORE.laEstro)).toEqual({ state: 'sample', words: null, dials: null, marked: true })
    expect(storeSample(STORE.devSalon)).toEqual({ state: 'no-sample-policy', storeId: STORE.devSalon, words: null, dials: null })
    expect(storeSample('nope')).toEqual({ state: 'no-sample-policy', storeId: 'nope', words: null, dials: null })
  })
  // ⚖ PR-3 — the mark keys on the door being ON, never on `state === 'sample'`
  // (which is also every OFF answer).
  it('PR-3 marked: OFF false on every fixture store; ON true on a twin; ON + none policy is its own state', () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    for (const id of [STORE_A, STORE_B]) expect(storeSample(id)).toMatchObject({ state: 'sample', marked: false })
    process.env.BUSINESS_PRACTICE_TENANT = TENANT
    expect(storeSample(STORE.tokyo)).toMatchObject({ state: 'sample', marked: true })
    expect(storeSample(STORE.devSalon).state).toBe('no-sample-policy')
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
  const SAMPLE_NONE = 'サンプル設定なし'

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
    expect(people.find((r) => r.id === `people.row-${CARD.musubi}`)!.meta).toEqual([SAMPLE_NONE])
    expect(people.find((r) => r.id === `people.row-${CARD.azusa}`)!.meta).toEqual([rulebook.roles.find((r) => r.key === 'manager')!.label])
    // スタッフ管理
    expect(blockOf(props, 'staff', 'staff.roster').rows.map((r) => r.id).sort()).toEqual(live.map((id) => `staff.row-${id}`).sort())
    expect(controlOf(props, `staff.preset-${CARD.musubi}`).value).toBe(SAMPLE_NONE)
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

  it.each([
    ['La Estro (named)', STORE.laEstro],
    ['Dev Salon (none)', STORE.devSalon],
  ])('%s: never 店舗を選んでください; live rows render and every SAMPLE part says サンプル設定なし', async (_label, store) => {
    const { props } = await settingsProps({ locale: 'ja', store })
    expect(props.sections.filter((s) => s.kicker === '店舗を選んでください')).toEqual([])
    const people = blockOf(props, 'people-equipment', 'people.staff').rows
    expect(people.map((r) => r.id)).toEqual(ids(await data.listStaff(store)).map((id) => `people.row-${id}`))
    expect(people.length).toBeGreaterThan(0)
    expect(people.every((r) => r.controls[0].value === true && r.meta[0] === SAMPLE_NONE)).toBe(true)
    const menuRows = blockOf(props, 'services', 'services.menus').rows
    expect(menuRows.map((r) => r.id)).toEqual(ids(await data.listMenus(store)).map((id) => `services.row-${id}`))
    expect(menuRows.every((r) => r.controls[0].value === SAMPLE_NONE)).toBe(true)
    expect(blockOf(props, 'services', 'services.tickets').facts).toEqual([SAMPLE_NONE])
    expect(blockOf(props, 'business-structure', 'org.entity').facts).toEqual([SAMPLE_NONE])
    expect(blockOf(props, 'business-structure', 'org.stores').table!.rows).toHaveLength(5)
    const pay = sec(props, 'payments')
    expect({ kicker: pay.kicker, lead: pay.lead, blocks: pay.blocks }).toEqual({ kicker: RAIL.find((e) => e.id === 'payments')!.group, lead: SAMPLE_NONE, blocks: [] })
    expect(sec(props, 'booking-guard').kicker).toBe('店舗運営')
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

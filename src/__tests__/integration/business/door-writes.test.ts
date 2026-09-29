/**
 * ⚖ PKT-S29-B1 — the store-days writer (臨時休業 + 特別営業日), door-writes.ts.
 * Same shape as practice-door-write.test.ts (A2's card-colour suite): the SDK
 * is stubbed (raw ESM this jest setup does not transform), core-reach's two
 * throws are kept exactly, and every core call is visible on `mockCore`.
 *
 * Fixture world (packet §2, F16): special_open_days = [{2026-10-20,10:00,19:00}];
 * closures [{id:'c1',date:'2026-10-08',reason:'店内研修（テスト）'},
 * {id:'c2',date:'2026-11-10',reason:'棚卸し'}]; clock pinned to
 * 2026-09-29T03:00:00Z (12:00 JST — "today" = 2026-09-29 JST); actor A = OWNER
 * (settings.manage + stores.viewAll — the app's real OWNER sheets always carry
 * viewAll, e.g. practice-door-recorded.ts's OWNER_CAPS; the packet's F16 names
 * only settings.manage + visible_store_ids:null, which is silent on viewAll —
 * flagged for the lead's line-audit), staff_id 'staff-owner'; actor B = ADMIN,
 * settings.manage, no HQ grant; actor C = STYLIST, no settings.manage.
 */

// The SDK ships raw ESM this jest setup does not transform (same stub as
// practice-door-write.test.ts) — needed only because `jest.requireActual`
// below still evaluates the REAL core-reach.ts, which reaches the SDK through
// @/lib/synqed/client; door-writes.ts itself never imports '@synqed-kk/client'.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/practice-door/core-reach', () => {
  const actual = jest.requireActual('@/business/lib/practice-door/core-reach')
  const { practiceTenant } = jest.requireActual('@/business/lib/practice-door/switch')
  const guard = (admitted: { businessId: string }) => {
    const tenant = practiceTenant()
    if (tenant === null) throw new Error('practice door called with the switch unset')
    if (admitted.businessId !== tenant) throw new actual.PracticeTenantMismatch(admitted.businessId)
  }
  return {
    ...actual,
    clientFor: (admitted: { businessId: string }) => (guard(admitted), mockCore.reads),
    storeDaysWriterFor: (admitted: { businessId: string }) => (guard(admitted), mockCore.writerFor(admitted), { storePolicies: mockCore.writer }),
    auditWriterFor: (admitted: { businessId: string }) => (guard(admitted), mockCore.auditWriterFor(admitted), { audit: { log: mockCore.auditLog } }),
  }
})

import { requireBusinessAdmission } from '@/business/lib/admission'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import * as data from '@/business/lib/data'

const TENANT = 'fb44dd68-4af7-44b0-8cc7-4ee10c54491d'
const STORE_ID = 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f'
const OTHER_STORE_ID = '8ac43a4b-7763-4a10-9f73-a662085460af'

type Staff = Awaited<ReturnType<CoreReads['staffList']>>['staff'][number]
type Sheet = Awaited<ReturnType<CoreReads['answerSheet']>>
type Store = Awaited<ReturnType<CoreReads['storesList']>>['stores'][number]

const staffRow = (id: string, user_id: string, name: string, role: Staff['role']): Staff => ({
  id, business_id: TENANT, user_id, name, name_kana: null, email: `${user_id}@test.local`, role, is_active: true, avatar_url: null, created_at: 'x', updated_at: 'x',
})
const STAFF: Staff[] = [
  staffRow('staff-owner', 'login-owner', 'オーナー', 'OWNER'),
  staffRow('staff-admin', 'login-admin', '管理者', 'ADMIN'),
  staffRow('staff-stylist', 'login-stylist', 'スタイリスト', 'STYLIST'),
]
const sheet = (staff_id: string, role: Sheet['role'], coarse_role: Sheet['coarse_role'], capabilities: string[], visible_store_ids: string[] | null): Sheet =>
  ({ staff_id, role, coarse_role, capabilities, visible_store_ids, money_scope: null, version: '1.0' })
const SHEETS: Record<string, Sheet> = {
  'staff-owner': sheet('staff-owner', 'owner', 'OWNER', ['settings.manage', 'stores.viewAll'], null),
  'staff-admin': sheet('staff-admin', 'manager', 'ADMIN', ['settings.manage'], [STORE_ID]),
  'staff-stylist': sheet('staff-stylist', 'practitioner', 'STYLIST', [], [STORE_ID]),
}
const store = (id: string, name: string): Store => ({ id, business_id: TENANT, name, address: null, phone: null, photo_url: null, is_primary: false, active: true, created_at: 'x', updated_at: 'x' })
const STORES: Store[] = [store(STORE_ID, 'テスト東京店'), store(OTHER_STORE_ID, 'テスト横浜店')]

const CLOSURE_C1 = { id: 'c1c1c1c1-0000-4000-8000-000000000001', store_id: STORE_ID, date: '2026-10-08', reason: '店内研修（テスト）', created_by: null, created_at: 'x' }
const CLOSURE_C2 = { id: 'c2c2c2c2-0000-4000-8000-000000000002', store_id: STORE_ID, date: '2026-11-10', reason: '棚卸し', created_by: null, created_at: 'x' }
const SPECIAL_1020 = { date: '2026-10-20', open: '10:00', close: '19:00' }
const BASE_POLICY = {
  store_id: STORE_ID, override_roles: [], override_locked_out: [], override_hold_to_confirm: true, override_strict_wall: false,
  min_sellable_min: 30, gap_fill_min_min: null, held_rank_access: 'closed' as const, release_held_roles: [], booking_step_min: 30,
  block_step_min: 15, gap_fill_discount_pct: null, lead_time_min: null, reserve_start_grid_min: null, standard_session_min: null,
  price_lock_during_recalc: null, breaks_paid: false, booking_open_days: 0, cutoff_minutes: 0, cancel_free_until_hours: 0,
  cancel_late_pct: 0, no_show_pct: 0, gap_guard_mode: 'OFF' as const, new_client_session_minutes: 60, weekly_hours: null,
  source: 'custom' as const, updated_by: null, updated_at: null, special_open_days: [SPECIAL_1020],
}

function baseReads(): CoreReads {
  return {
    storesList: async () => ({ stores: STORES }),
    staffList: async () => ({ staff: STAFF, total: STAFF.length, page: 1, page_size: 200 }),
    staffStoresList: async () => ({ assignments: {} }),
    answerSheet: async (id: string) => {
      const s = SHEETS[id]
      if (!s) throw new Error(`no sheet for ${id}`)
      return s
    },
    menusList: async () => ({ menus: [] }),
    customersList: async () => ({ customers: [], total: 0, page: 1, page_size: 20, total_pages: 0 }),
    customerVisits: async () => ({ visits: [] }),
    appointmentsList: async () => ({ appointments: [], total: 0, page: 1, page_size: 20 }),
    orgSettingsGet: async () => null,
    resourcesList: async () => ({ resources: [] }),
    storePolicyGet: async () => ({ ...BASE_POLICY }),
    storePolicyListClosedDays: async () => ({ closed_days: [CLOSURE_C1, CLOSURE_C2] }),
    businessGrantsCheck: async () => ({ granted: false }),
    auditList: async () => ({ events: [], total: 0, page: 1, page_size: 20 }),
  }
}

const mockCore: { reads: CoreReads; writer: { set: jest.Mock; addClosedDay: jest.Mock; removeClosedDay: jest.Mock }; writerFor: jest.Mock; auditWriterFor: jest.Mock; auditLog: jest.Mock } = {
  reads: baseReads(),
  writer: { set: jest.fn(), addClosedDay: jest.fn(), removeClosedDay: jest.fn() },
  writerFor: jest.fn(),
  auditWriterFor: jest.fn(),
  auditLog: jest.fn(),
}
type Spied = { [K in keyof CoreReads]: jest.Mock }
function withReads(): Spied {
  const base = baseReads()
  const spied = Object.fromEntries(Object.entries(base).map(([k, fn]) => [k, jest.fn(fn as (...a: unknown[]) => unknown)])) as unknown as Spied
  mockCore.reads = spied as unknown as CoreReads
  return spied
}

const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
const as = (userId: string) => admission.mockResolvedValue({ userId, email: null, businessId: TENANT })
const saved = process.env.BUSINESS_PRACTICE_TENANT
let info: jest.SpyInstance
let warn: jest.SpyInstance
let error: jest.SpyInstance

beforeEach(() => {
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date('2026-09-29T03:00:00Z')) // 12:00 JST
  withReads()
  mockCore.writer = { set: jest.fn(), addClosedDay: jest.fn(), removeClosedDay: jest.fn() }
  mockCore.writerFor = jest.fn()
  mockCore.auditWriterFor = jest.fn()
  mockCore.auditLog = jest.fn().mockResolvedValue({})
  admission.mockClear()
  as('login-owner')
  info = jest.spyOn(console, 'info').mockImplementation(() => {})
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  error = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  jest.useRealTimers()
  if (saved === undefined) delete process.env.BUSINESS_PRACTICE_TENANT
  else process.env.BUSINESS_PRACTICE_TENANT = saved
  info.mockRestore()
  warn.mockRestore()
  error.mockRestore()
})

describe('P-B1-1 — add a special day as OWNER', () => {
  it('sends EXACTLY ONE set(storeId, { acting_staff_id, special_open_days }) with the full sorted array; zero closed-day calls; the badge only on the row sharing a closure date', async () => {
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY, special_open_days: [SPECIAL_1020, { date: '2026-11-10', open: '11:00', close: '15:00' }] })
    const result = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-11-10', open: '11:00', close: '15:00' })
    expect(result).toEqual({ ok: true, specialOpenDays: [SPECIAL_1020, { date: '2026-11-10', open: '11:00', close: '15:00' }] })
    expect(mockCore.writer.set).toHaveBeenCalledTimes(1)
    expect(mockCore.writer.set.mock.calls[0]).toEqual([
      STORE_ID,
      { acting_staff_id: 'staff-owner', special_open_days: [SPECIAL_1020, { date: '2026-11-10', open: '11:00', close: '15:00' }] },
    ])
    expect(Object.keys(mockCore.writer.set.mock.calls[0][1])).toEqual(['acting_staff_id', 'special_open_days'])
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
    expect(mockCore.writer.removeClosedDay).not.toHaveBeenCalled()
    if (result.ok) {
      expect(data.specialDayBadge('2026-11-10', [CLOSURE_C1, CLOSURE_C2])).toBe('臨時休業より優先')
      expect(data.specialDayBadge('2026-10-20', [CLOSURE_C1, CLOSURE_C2])).toBeNull()
    }
  })
})

describe('P-B1-2 — remove a special day as OWNER', () => {
  it('sends set with the remaining array only', async () => {
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY, special_open_days: [] })
    const result = await data.removeStoreSpecialOpenDay(STORE_ID, '2026-10-20')
    expect(result).toEqual({ ok: true, specialOpenDays: [] })
    expect(mockCore.writer.set.mock.calls[0]).toEqual([STORE_ID, { acting_staff_id: 'staff-owner', special_open_days: [] }])
  })
})

describe('P-B1-3 — door validation refuses BEFORE any core call', () => {
  it('past date refused, today accepted (special)', async () => {
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-09-28', open: '11:00', close: '15:00' })).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY })
    await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-09-29', open: '11:00', close: '15:00' })
    expect(mockCore.writer.set).toHaveBeenCalledTimes(1)
  })
  it('past date refused, today accepted (closure)', async () => {
    expect(await data.addStoreClosedDay(STORE_ID, { date: '2026-09-28', reason: '' })).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
    mockCore.writer.addClosedDay.mockResolvedValueOnce({ id: 'c9', store_id: STORE_ID, date: '2026-09-29', reason: null, created_by: null, created_at: 'x' })
    await data.addStoreClosedDay(STORE_ID, { date: '2026-09-29', reason: '' })
    expect(mockCore.writer.addClosedDay).toHaveBeenCalledTimes(1)
  })
  it('open 25:00 refused; close 24:00 accepted; open after close refused; malformed date refused', async () => {
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '25:00', close: '19:00' })).toEqual({ ok: false, reason: 'invalid', message: '閉店時刻は開店時刻より後にしてください。' })
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY })
    const okClose = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-02', open: '20:00', close: '24:00' })
    expect(okClose.ok).toBe(true)
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-03', open: '15:00', close: '11:00' })).toEqual({ ok: false, reason: 'invalid', message: '閉店時刻は開店時刻より後にしてください。' })
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-02-30', open: '10:00', close: '19:00' })).toEqual({ ok: false, reason: 'invalid', message: '存在しない日付です。' })
  })
  it('a second 2026-10-20 refused as a duplicate special day, zero core calls', async () => {
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-10-20', open: '09:00', close: '10:00' })).toEqual({ ok: false, reason: 'invalid', message: 'その日はすでに特別営業日です' })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
  })
  it('2026-10-08 closure again refused as a duplicate closure, zero core calls', async () => {
    expect(await data.addStoreClosedDay(STORE_ID, { date: '2026-10-08', reason: '' })).toEqual({ ok: false, reason: 'invalid', message: 'その日はすでに臨時休業です' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
  })
})

describe('P-B1-4 — capability, honest', () => {
  it('actor B (ADMIN, settings.manage, no HQ grant): read-only + the sentence + zero writes; the grants check runs exactly once', async () => {
    as('login-admin')
    const spied = withReads()
    const result = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '10:00', close: '11:00' })
    expect(result).toEqual({ ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(1)
    // a second write attempt by the SAME actor never asks core the grant question twice (memoized per actor).
    await data.addStoreClosedDay(STORE_ID, { date: '2026-12-02', reason: '' })
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(1)
  })
  it('actor B with a live HQ_ADMIN grant: writes go through', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockResolvedValue({ granted: true })
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY })
    const result = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '10:00', close: '11:00' })
    expect(result.ok).toBe(true)
  })
  it('actor C (STYLIST, no settings.manage): forbidden, zero writes, no grants check (settings.manage fails first)', async () => {
    as('login-stylist')
    const spied = withReads()
    const result = await data.addStoreClosedDay(STORE_ID, { date: '2026-12-01', reason: '' })
    expect(result).toEqual({ ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' })
    expect(spied.businessGrantsCheck).not.toHaveBeenCalled()
  })
  it('a store outside the actor\'s view is forbidden before any call', async () => {
    as('login-admin') // visible_store_ids: [STORE_ID] only
    const result = await data.addStoreClosedDay(OTHER_STORE_ID, { date: '2026-12-01', reason: '' })
    expect(result).toEqual({ ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
  })
})

/** door-writes.ts recognises a core refusal by SHAPE, never `instanceof` (its
 *  own file never imports '@synqed-kk/client' — business-isolation.test.ts's
 *  pin). A plain Error with the same shape (`name`, `status`, `message`)
 *  exercises the exact same branch without this test importing the SDK either. */
const fakeSynqedError = (status: number, message: string): Error => {
  const e = new Error(message) as Error & { status: number }
  e.name = 'SynqedError'
  e.status = status
  return e
}

describe('P-B1-5 — core refusals that pass the door, mapped', () => {
  it('409 duplicate closed day → the JP sibling; list unchanged', async () => {
    mockCore.writer.addClosedDay.mockRejectedValueOnce(fakeSynqedError(409, 'This date is already a closed day for the store.'))
    const result = await data.addStoreClosedDay(STORE_ID, { date: '2026-12-25', reason: '' })
    expect(result).toEqual({ ok: false, reason: 'invalid', message: 'その日はすでに臨時休業です' })
  })
  it('a generic 500 → the generic line, English logged to console.warn, never to the screen', async () => {
    mockCore.writer.addClosedDay.mockRejectedValueOnce(fakeSynqedError(500, 'boom'))
    const result = await data.addStoreClosedDay(STORE_ID, { date: '2026-12-26', reason: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).not.toContain('boom')
      expect(result.message).toBe('いまは保存できないため、時間をおいてもう一度保存してください（予定の一覧はこれまでのままです）。')
    }
    expect(warn).toHaveBeenCalledWith('[business store days] core refused:', 500, 'boom')
  })
})

describe('P-B1-6 — a failed read is an error state', () => {
  it('get throws → { ok: false }, never a silent empty list', async () => {
    const spied = withReads()
    spied.storePolicyGet.mockRejectedValueOnce(new Error('core outage'))
    const result = await data.readStoreDays(STORE_ID)
    expect(result.ok).toBe(false)
    expect(error).toHaveBeenCalled()
  })
  it('listClosedDays throws → { ok: false }', async () => {
    const spied = withReads()
    spied.storePolicyListClosedDays.mockRejectedValueOnce(new Error('core outage'))
    const result = await data.readStoreDays(STORE_ID)
    expect(result.ok).toBe(false)
  })
  it('a successful read returns both lists fresh, never memoized across two calls', async () => {
    const spied = withReads()
    const first = await data.readStoreDays(STORE_ID)
    expect(first.ok).toBe(true)
    await data.addStoreClosedDay(STORE_ID, { date: '2026-12-27', reason: '' }).catch(() => {})
    await data.readStoreDays(STORE_ID)
    // storePolicyGet is called at least twice across the two readStoreDays() calls — never cached.
    expect(spied.storePolicyGet.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('R6 fold — closure removal audit', () => {
  it('removeClosedDay: core is called with (storeId, id, acting_staff_id); the door records its own audit.log after success', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    const result = await data.removeStoreClosedDay(STORE_ID, CLOSURE_C1.id)
    expect(result).toEqual({ ok: true, closures: [CLOSURE_C2] })
    expect(mockCore.writer.removeClosedDay).toHaveBeenCalledWith(STORE_ID, CLOSURE_C1.id, 'staff-owner')
    expect(mockCore.auditLog).toHaveBeenCalledTimes(1)
    expect(mockCore.auditLog.mock.calls[0][0]).toMatchObject({ action: 'store_closed_day.remove', category: 'settings', target_type: 'store_closed_day', target_id: CLOSURE_C1.id })
  })
  it('addClosedDay carries the SDK audit payload (actor_type + action)', async () => {
    mockCore.writer.addClosedDay.mockResolvedValueOnce({ id: 'c9', store_id: STORE_ID, date: '2026-12-28', reason: null, created_by: null, created_at: 'x' })
    await data.addStoreClosedDay(STORE_ID, { date: '2026-12-28', reason: '' })
    expect(mockCore.writer.addClosedDay.mock.calls[0][1]).toMatchObject({
      date: '2026-12-28', acting_staff_id: 'staff-owner',
      audit: { actor_type: 'staff', actor_id: 'staff-owner', category: 'settings', action: 'store_closed_day.add', target_type: 'store_closed_day' },
    })
  })
})

describe('OFF — the practice door unset', () => {
  it('every export answers tenant, zero core calls, before the SDK ever loads', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(await data.readStoreDays(STORE_ID)).toEqual({ ok: false, reason: 'tenant', message: expect.any(String) })
    expect(await data.addStoreClosedDay(STORE_ID, { date: '2026-12-01', reason: '' })).toEqual({ ok: false, reason: 'tenant', message: expect.any(String) })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
  })
})

// ⚖ PKT-S30 F7 / F9 / P3-1 / P3-2 / P3-8 / P3-9 — one admission, one get, one set; no-op short-circuits.
describe('PKT-S30 F7 — one admit, one get, one set per public call', () => {
  const W = ['set', 'addClosedDay', 'removeClosedDay'] as const
  function sequence(spied: Spied): string[] {
    const order: string[] = []
    for (const k of Object.keys(spied) as Array<keyof Spied>) {
      const inner = spied[k].getMockImplementation()!
      spied[k].mockImplementation((...a: unknown[]) => (order.push(k), (inner as (...x: unknown[]) => unknown)(...a)))
    }
    for (const k of W) {
      const inner = mockCore.writer[k].getMockImplementation()
      mockCore.writer[k].mockImplementation((...a: unknown[]) => (order.push(k), inner ? (inner as (...x: unknown[]) => unknown)(...a) : undefined))
    }
    return order
  }
  it('add: exactly one get and one set, the get immediately before the set (the only remaining window)', async () => {
    mockCore.writer.set.mockResolvedValue({ ...BASE_POLICY })
    const order = sequence(withReads())
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '10:00', close: '11:00' })
    expect(r.ok).toBe(true)
    expect(order.filter((k) => k === 'storePolicyGet')).toHaveLength(1)
    expect(order.filter((k) => k === 'set')).toHaveLength(1)
    expect(order.slice(-2)).toEqual(['storePolicyGet', 'set'])
    expect(order.filter((k) => k === 'answerSheet')).toHaveLength(1) // admitted ONCE
  })
  it('remove: one get, one set, the body is the FULL sorted array (P3-2)', async () => {
    const spied = withReads()
    spied.storePolicyGet.mockResolvedValue({ ...BASE_POLICY, special_open_days: [{ date: '2026-12-09', open: '10:00', close: '11:00' }, SPECIAL_1020, { date: '2026-11-01', open: '10:00', close: '11:00' }] })
    mockCore.writer.set.mockResolvedValue({ ...BASE_POLICY })
    const order = sequence(spied)
    await data.removeStoreSpecialOpenDay(STORE_ID, '2026-10-20')
    expect(order.filter((k) => k === 'storePolicyGet')).toHaveLength(1)
    expect(mockCore.writer.set).toHaveBeenCalledTimes(1)
    expect(mockCore.writer.set.mock.calls[0][1].special_open_days.map((d: { date: string }) => d.date)).toEqual(['2026-11-01', '2026-12-09'])
  })
  it('remove of a date the fresh read lacks: ok, NO set (P3-1)', async () => {
    const r = await data.removeStoreSpecialOpenDay(STORE_ID, '2026-12-24')
    expect(r).toEqual({ ok: true, specialOpenDays: [SPECIAL_1020] })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
  })
  it('F9: a closure another admin already removed → ok, list refreshed from the read, no core delete, no error line', async () => {
    const spied = withReads()
    spied.storePolicyListClosedDays.mockResolvedValue({ closed_days: [CLOSURE_C2] })
    const r = await data.removeStoreClosedDay(STORE_ID, CLOSURE_C1.id)
    expect(r).toEqual({ ok: true, closures: [CLOSURE_C2] })
    expect(mockCore.writer.removeClosedDay).not.toHaveBeenCalled()
    expect(mockCore.auditLog).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(spied.storePolicyListClosedDays.mock.calls[0]).toEqual([STORE_ID]) // read WITHOUT the from-date filter
  })
  it('P3-8: a non-uuid closure id is refused before ANY call', async () => {
    const spied = withReads()
    const r = await data.removeStoreClosedDay(STORE_ID, 'c1')
    expect(r).toMatchObject({ ok: false, reason: 'invalid' })
    for (const fn of Object.values(spied)) expect(fn).not.toHaveBeenCalled()
    for (const k of W) expect(mockCore.writer[k]).not.toHaveBeenCalled()
  })
  it('P3-9: removing a closure dated before today → 過ぎた日付です, zero writes', async () => {
    const spied = withReads()
    spied.storePolicyListClosedDays.mockResolvedValue({ closed_days: [{ ...CLOSURE_C1, date: '2026-09-28' }] })
    const r = await data.removeStoreClosedDay(STORE_ID, CLOSURE_C1.id)
    expect(r).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expect(mockCore.writer.removeClosedDay).not.toHaveBeenCalled()
    expect(mockCore.auditLog).not.toHaveBeenCalled()
  })
  it('P3-1: validation before admission — a bad date asks core nothing', async () => {
    const spied = withReads()
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-02-30', open: '10:00', close: '11:00' })
    expect(r).toMatchObject({ ok: false, reason: 'invalid' })
    for (const fn of Object.values(spied)) expect(fn).not.toHaveBeenCalled()
    for (const k of W) expect(mockCore.writer[k]).not.toHaveBeenCalled()
  })
  it('Also-noted B: the JST day turns between validation and write → refused at write time, no set', async () => {
    const spied = withReads()
    spied.storePolicyGet.mockImplementation(async () => {
      jest.setSystemTime(new Date('2026-09-29T15:00:01Z')) // 00:00:01 JST on 9/30
      return { ...BASE_POLICY }
    })
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-09-29', open: '10:00', close: '11:00' })
    expect(r).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
  })
})

describe('PKT-S30 F8 — a grant-check outage is cannot-verify, never a crash or a forbidden', () => {
  it('readCanWriteStoreDays answers false (read-only) and logs when the grant check throws', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockRejectedValue(new Error('grants down'))
    await expect(data.readCanWriteStoreDays(STORE_ID)).resolves.toBe(false)
    expect(error).toHaveBeenCalled()
  })
  it('a write whose grant check throws maps to `core` (503 honesty), zero writes', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockRejectedValue(new Error('grants down'))
    const r = await data.addStoreClosedDay(STORE_ID, { date: '2026-12-01', reason: '' })
    expect(r).toMatchObject({ ok: false, reason: 'core' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    expect(mockCore.writer.removeClosedDay).not.toHaveBeenCalled()
  })
})

describe('PKT-S30 F11 — closure audit payloads say which day, which store, why', () => {
  it('add: the SDK audit parameter carries store_id, target_label = the date, detail { date, reason } (reason "" kept)', async () => {
    mockCore.writer.addClosedDay.mockResolvedValueOnce({ id: 'c9', store_id: STORE_ID, date: '2026-12-28', reason: null, created_by: null, created_at: 'x' })
    await data.addStoreClosedDay(STORE_ID, { date: '2026-12-28', reason: '' })
    expect(mockCore.writer.addClosedDay.mock.calls[0][1].audit).toEqual({
      actor_type: 'staff', actor_id: 'staff-owner', category: 'settings', action: 'store_closed_day.add', target_type: 'store_closed_day',
      store_id: STORE_ID, target_label: '2026-12-28', detail: { date: '2026-12-28', reason: '' },
    })
  })
  it('remove: target_id = row.id, store_id, target_label = the date, detail { date, reason }', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)
    expect(mockCore.auditLog.mock.calls[0][0]).toEqual({
      actor_type: 'staff', actor_id: 'staff-owner', category: 'settings', action: 'store_closed_day.remove', target_type: 'store_closed_day',
      target_id: CLOSURE_C2.id, store_id: STORE_ID, target_label: '2026-11-10', detail: { date: '2026-11-10', reason: '棚卸し' },
    })
  })
  it('remove: a failed audit write logs at warn, never console.error, and the removal still answers ok', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    mockCore.auditLog.mockRejectedValueOnce(new Error('audit down'))
    const r = await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)
    expect(r.ok).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('audit record failed'), 'audit down')
    expect(error).not.toHaveBeenCalled()
  })
})


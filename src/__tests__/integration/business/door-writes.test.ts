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

jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    code?: string
    constructor(status: number, message: string, code?: string) {
      super(message)
      this.status = status
      this.code = code
      this.name = 'SynqedError'
    }
  }
  return { SynqedClient: class {}, SynqedError }
})
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
    storeDaysWriterFor: (admitted: { businessId: string }) => (guard(admitted), mockCore.writerFor(admitted), mockCore.writer),
    auditWriterFor: (admitted: { businessId: string }) => (guard(admitted), mockCore.auditWriterFor(admitted), { log: mockCore.auditLog }),
  }
})

import { requireBusinessAdmission } from '@/business/lib/admission'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import * as doorWrites from '@/business/lib/practice-door/door-writes'

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
  staffRow('staff-owner', 'login-owner', 'オーナー', 'owner'),
  staffRow('staff-admin', 'login-admin', '管理者', 'manager'),
  staffRow('staff-stylist', 'login-stylist', 'スタイリスト', 'practitioner'),
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

const CLOSURE_C1 = { id: 'c1', store_id: STORE_ID, date: '2026-10-08', reason: '店内研修（テスト）', created_by: null, created_at: 'x' }
const CLOSURE_C2 = { id: 'c2', store_id: STORE_ID, date: '2026-11-10', reason: '棚卸し', created_by: null, created_at: 'x' }
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
    staffStoresList: async () => ({ assignments: [] }),
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
    const result = await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-11-10', open: '11:00', close: '15:00' })
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
      expect(doorWrites.specialDayBadge('2026-11-10', [CLOSURE_C1, CLOSURE_C2])).toBe('臨時休業より優先')
      expect(doorWrites.specialDayBadge('2026-10-20', [CLOSURE_C1, CLOSURE_C2])).toBeNull()
    }
  })
})

describe('P-B1-2 — remove a special day as OWNER', () => {
  it('sends set with the remaining array only', async () => {
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY, special_open_days: [] })
    const result = await doorWrites.removeSpecialOpenDay(STORE_ID, '2026-10-20')
    expect(result).toEqual({ ok: true, specialOpenDays: [] })
    expect(mockCore.writer.set.mock.calls[0]).toEqual([STORE_ID, { acting_staff_id: 'staff-owner', special_open_days: [] }])
  })
})

describe('P-B1-3 — door validation refuses BEFORE any core call', () => {
  it('past date refused, today accepted (special)', async () => {
    expect(await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-09-28', open: '11:00', close: '15:00' })).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY })
    await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-09-29', open: '11:00', close: '15:00' })
    expect(mockCore.writer.set).toHaveBeenCalledTimes(1)
  })
  it('past date refused, today accepted (closure)', async () => {
    expect(await doorWrites.addClosedDay(STORE_ID, { date: '2026-09-28', reason: '' })).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
    mockCore.writer.addClosedDay.mockResolvedValueOnce({ id: 'c9', store_id: STORE_ID, date: '2026-09-29', reason: null, created_by: null, created_at: 'x' })
    await doorWrites.addClosedDay(STORE_ID, { date: '2026-09-29', reason: '' })
    expect(mockCore.writer.addClosedDay).toHaveBeenCalledTimes(1)
  })
  it('open 25:00 refused; close 24:00 accepted; open after close refused; malformed date refused', async () => {
    expect(await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '25:00', close: '19:00' })).toEqual({ ok: false, reason: 'invalid', message: '閉店時刻は開店時刻より後にしてください。' })
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY })
    const okClose = await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-12-02', open: '20:00', close: '24:00' })
    expect(okClose.ok).toBe(true)
    expect(await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-12-03', open: '15:00', close: '11:00' })).toEqual({ ok: false, reason: 'invalid', message: '閉店時刻は開店時刻より後にしてください。' })
    expect(await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-02-30', open: '10:00', close: '19:00' })).toEqual({ ok: false, reason: 'invalid', message: '存在しない日付です。' })
  })
  it('a second 2026-10-20 refused as a duplicate special day, zero core calls', async () => {
    expect(await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-10-20', open: '09:00', close: '10:00' })).toEqual({ ok: false, reason: 'invalid', message: 'その日はすでに特別営業日です' })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
  })
  it('2026-10-08 closure again refused as a duplicate closure, zero core calls', async () => {
    expect(await doorWrites.addClosedDay(STORE_ID, { date: '2026-10-08', reason: '' })).toEqual({ ok: false, reason: 'invalid', message: 'その日はすでに臨時休業です' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
  })
})

describe('P-B1-4 — capability, honest', () => {
  it('actor B (ADMIN, settings.manage, no HQ grant): read-only + the sentence + zero writes; the grants check runs exactly once', async () => {
    as('login-admin')
    const spied = withReads()
    const result = await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '10:00', close: '11:00' })
    expect(result).toEqual({ ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(1)
    // a second write attempt by the SAME actor never asks core the grant question twice (memoized per actor).
    await doorWrites.addClosedDay(STORE_ID, { date: '2026-12-02', reason: '' })
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(1)
  })
  it('actor B with a live HQ_ADMIN grant: writes go through', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockResolvedValue({ granted: true })
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY })
    const result = await doorWrites.addSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '10:00', close: '11:00' })
    expect(result.ok).toBe(true)
  })
  it('actor C (STYLIST, no settings.manage): forbidden, zero writes, no grants check (settings.manage fails first)', async () => {
    as('login-stylist')
    const spied = withReads()
    const result = await doorWrites.addClosedDay(STORE_ID, { date: '2026-12-01', reason: '' })
    expect(result).toEqual({ ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' })
    expect(spied.businessGrantsCheck).not.toHaveBeenCalled()
  })
  it('a store outside the actor\'s view is forbidden before any call', async () => {
    as('login-admin') // visible_store_ids: [STORE_ID] only
    const result = await doorWrites.addClosedDay(OTHER_STORE_ID, { date: '2026-12-01', reason: '' })
    expect(result).toEqual({ ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
  })
})

describe('P-B1-5 — core refusals that pass the door, mapped', () => {
  it('409 duplicate closed day → the JP sibling; list unchanged', async () => {
    const { SynqedError } = jest.requireMock('@synqed-kk/client') as { SynqedError: new (s: number, m: string) => Error }
    mockCore.writer.addClosedDay.mockRejectedValueOnce(new SynqedError(409, 'This date is already a closed day for the store.'))
    const result = await doorWrites.addClosedDay(STORE_ID, { date: '2026-12-25', reason: '' })
    expect(result).toEqual({ ok: false, reason: 'invalid', message: 'その日はすでに臨時休業です' })
  })
  it('a generic 500 → the generic line, English logged to console.warn, never to the screen', async () => {
    const { SynqedError } = jest.requireMock('@synqed-kk/client') as { SynqedError: new (s: number, m: string) => Error }
    mockCore.writer.addClosedDay.mockRejectedValueOnce(new SynqedError(500, 'boom'))
    const result = await doorWrites.addClosedDay(STORE_ID, { date: '2026-12-26', reason: '' })
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
    const result = await doorWrites.readStoreDays(STORE_ID)
    expect(result.ok).toBe(false)
    expect(error).toHaveBeenCalled()
  })
  it('listClosedDays throws → { ok: false }', async () => {
    const spied = withReads()
    spied.storePolicyListClosedDays.mockRejectedValueOnce(new Error('core outage'))
    const result = await doorWrites.readStoreDays(STORE_ID)
    expect(result.ok).toBe(false)
  })
  it('a successful read returns both lists fresh, never memoized across two calls', async () => {
    const spied = withReads()
    const first = await doorWrites.readStoreDays(STORE_ID)
    expect(first.ok).toBe(true)
    await doorWrites.addClosedDay(STORE_ID, { date: '2026-12-27', reason: '' }).catch(() => {})
    await doorWrites.readStoreDays(STORE_ID)
    // storePolicyGet is called at least twice across the two readStoreDays() calls — never cached.
    expect(spied.storePolicyGet.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('R6 fold — closure removal audit', () => {
  it('removeClosedDay: core is called with (storeId, id, acting_staff_id); the door records its own audit.log after success', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    const result = await doorWrites.removeClosedDay(STORE_ID, 'c1')
    expect(result).toEqual({ ok: true })
    expect(mockCore.writer.removeClosedDay).toHaveBeenCalledWith(STORE_ID, 'c1', 'staff-owner')
    expect(mockCore.auditLog).toHaveBeenCalledTimes(1)
    expect(mockCore.auditLog.mock.calls[0][0]).toMatchObject({ action: 'store_closed_day.remove', category: 'settings', target_type: 'store_closed_day', target_id: 'c1' })
  })
  it('addClosedDay carries the SDK audit payload (actor_type + action)', async () => {
    mockCore.writer.addClosedDay.mockResolvedValueOnce({ id: 'c9', store_id: STORE_ID, date: '2026-12-28', reason: null, created_by: null, created_at: 'x' })
    await doorWrites.addClosedDay(STORE_ID, { date: '2026-12-28', reason: '' })
    expect(mockCore.writer.addClosedDay.mock.calls[0][1]).toMatchObject({
      date: '2026-12-28', acting_staff_id: 'staff-owner',
      audit: { actor_type: 'staff', actor_id: 'staff-owner', category: 'settings', action: 'store_closed_day.add', target_type: 'store_closed_day' },
    })
  })
})

describe('OFF — the practice door unset', () => {
  it('every export answers tenant, zero core calls, before the SDK ever loads', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    expect(await doorWrites.readStoreDays(STORE_ID)).toEqual({ ok: false, reason: 'tenant', message: expect.any(String) })
    expect(await doorWrites.addClosedDay(STORE_ID, { date: '2026-12-01', reason: '' })).toEqual({ ok: false, reason: 'tenant', message: expect.any(String) })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
  })
})

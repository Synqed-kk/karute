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
import { DUPLICATE_SPECIAL_LINE, GENERIC_FAIL_LINE, READ_ONLY_NOTE } from '@/business/lib/store-days-state'

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
  price_lock_during_recalc: null, breaks_paid: false, booking_open_days: 30, cutoff_minutes: 0, cancel_free_until_hours: 24,
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
/** ⚖ PKT-S30 F12 — every refusal asserts EXPLICITLY which SDK write methods ran: each of the four
 *  (storePolicies.set / addClosedDay / removeClosedDay / audit.log) exactly `n` times, 0 unless named. */
function expectWrites(n: Partial<Record<'set' | 'addClosedDay' | 'removeClosedDay' | 'auditLog', number>> = {}): void {
  expect({
    set: mockCore.writer.set.mock.calls.length,
    addClosedDay: mockCore.writer.addClosedDay.mock.calls.length,
    removeClosedDay: mockCore.writer.removeClosedDay.mock.calls.length,
    auditLog: mockCore.auditLog.mock.calls.length,
  }).toEqual({ set: 0, addClosedDay: 0, removeClosedDay: 0, auditLog: 0, ...n })
}
const as = (userId: string) => admission.mockResolvedValue({ userId, email: null, displayName: null, businessId: TENANT })
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
  data.forgetStoreDaysGrants()
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
    expectWrites()
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY })
    await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-09-29', open: '11:00', close: '15:00' })
    expect(mockCore.writer.set).toHaveBeenCalledTimes(1)
  })
  it('past date refused, today accepted (closure)', async () => {
    expect(await data.addStoreClosedDay(STORE_ID, { date: '2026-09-28', reason: '' })).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
    expectWrites()
    mockCore.writer.addClosedDay.mockResolvedValueOnce({ id: 'c9', store_id: STORE_ID, date: '2026-09-29', reason: null, created_by: null, created_at: 'x' })
    await data.addStoreClosedDay(STORE_ID, { date: '2026-09-29', reason: '' })
    expect(mockCore.writer.addClosedDay).toHaveBeenCalledTimes(1)
  })
  it('open 25:00 refused; close 24:00 accepted; open after close refused; malformed date refused', async () => {
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '25:00', close: '19:00' })).toEqual({ ok: false, reason: 'invalid', message: '閉店時刻は開店時刻より後にしてください。' })
    expectWrites()
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY })
    const okClose = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-02', open: '20:00', close: '24:00' })
    expect(okClose.ok).toBe(true)
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-03', open: '15:00', close: '11:00' })).toEqual({ ok: false, reason: 'invalid', message: '閉店時刻は開店時刻より後にしてください。' })
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-02-30', open: '10:00', close: '19:00' })).toEqual({ ok: false, reason: 'invalid', message: '存在しない日付です' })
    expectWrites({ set: 1 }) // only the accepted 24:00 add wrote
  })
  it('S34 act 0 — the 24:00 edge: 24:30 refused, open 24:00 refused (open must stay before close), 23:59〜24:00 accepted', async () => {
    const refused = { ok: false, reason: 'invalid', message: '閉店時刻は開店時刻より後にしてください。' }
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-04', open: '10:00', close: '24:30' })).toEqual(refused)
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-05', open: '24:00', close: '24:00' })).toEqual(refused)
    expectWrites()
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY })
    const edge = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-06', open: '23:59', close: '24:00' })
    expect(edge.ok).toBe(true)
    expect(mockCore.writer.set).toHaveBeenCalledTimes(1)
    expectWrites({ set: 1 })
  })
  it('a second 2026-10-20 refused as a duplicate special day, zero core calls', async () => {
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-10-20', open: '09:00', close: '10:00' })).toEqual({ ok: false, reason: 'invalid', message: 'その日はすでに特別営業日です' })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    expectWrites()
  })
  it('2026-10-08 closure again refused as a duplicate closure, zero core calls', async () => {
    expect(await data.addStoreClosedDay(STORE_ID, { date: '2026-10-08', reason: '' })).toEqual({ ok: false, reason: 'invalid', message: 'その日はすでに臨時休業です' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
    expectWrites()
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
    // ⚖ PKT-S30 F12 — a refusal clears the memo: a second attempt by the SAME denied actor asks again
    // (a grant given in between takes effect); the "once per actor" pin is on a GRANTED actor (F12 block).
    await data.addStoreClosedDay(STORE_ID, { date: '2026-12-02', reason: '' })
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(2)
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
    expectWrites()
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
    expectWrites()
  })
  it('a store outside the actor\'s view is forbidden before any call', async () => {
    as('login-admin') // visible_store_ids: [STORE_ID] only
    const result = await data.addStoreClosedDay(OTHER_STORE_ID, { date: '2026-12-01', reason: '' })
    expect(result).toEqual({ ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' })
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
    expectWrites()
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
    expectWrites({ addClosedDay: 1 }) // core was asked once and refused: nothing else written, no audit
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
    expectWrites({ addClosedDay: 1 }) // core was asked once and refused: nothing else written, no audit
  })
})

describe('P-B1-6 — a failed read is an error state', () => {
  it('get throws → that list reads as failed (null, P3-10), never a silent empty list', async () => {
    const spied = withReads()
    spied.storePolicyGet.mockRejectedValueOnce(new Error('core outage'))
    const result = await data.readStoreDays(STORE_ID)
    // ⚖ PKT-S30 P3-10 — each list honest on its own: THIS list reads as failed (null), the other arrives.
    expect(result.ok && result.specialOpenDays).toBeNull()
    expect(result.ok && Array.isArray(result.closures)).toBe(true)
    expect(error).toHaveBeenCalled()
  })
  it('listClosedDays throws → that list reads as failed (null, P3-10)', async () => {
    const spied = withReads()
    spied.storePolicyListClosedDays.mockRejectedValueOnce(new Error('core outage'))
    const result = await data.readStoreDays(STORE_ID)
    expect(result.ok && result.closures).toBeNull()
    expect(result.ok && Array.isArray(result.specialOpenDays)).toBe(true)
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
  it('removeClosedDay: core is called with (storeId, id, acting_staff_id); the door records its own audit.log rows (attempt before the delete, remove after it, PKT-S32 R21)', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    const result = await data.removeStoreClosedDay(STORE_ID, CLOSURE_C1.id)
    expect(result).toEqual({ ok: true, closures: [CLOSURE_C2] })
    expect(mockCore.writer.removeClosedDay).toHaveBeenCalledWith(STORE_ID, CLOSURE_C1.id, 'staff-owner')
    expect(mockCore.auditLog).toHaveBeenCalledTimes(2) // PKT-S32 R21: the attempt row, then the remove row
    expect(mockCore.auditLog.mock.calls[1][0]).toMatchObject({ action: 'store_closed_day.remove', category: 'settings', target_type: 'store_closed_day', target_id: CLOSURE_C1.id })
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
    expectWrites()
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
    expectWrites()
  })
  it('P3-9: removing a closure dated before today → 過ぎた日付です, zero writes', async () => {
    const spied = withReads()
    spied.storePolicyListClosedDays.mockResolvedValue({ closed_days: [{ ...CLOSURE_C1, date: '2026-09-28' }] })
    const r = await data.removeStoreClosedDay(STORE_ID, CLOSURE_C1.id)
    expect(r).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expect(mockCore.writer.removeClosedDay).not.toHaveBeenCalled()
    expect(mockCore.auditLog).not.toHaveBeenCalled()
    expectWrites()
  })
  it('P3-1: validation before admission — a bad date asks core nothing', async () => {
    const spied = withReads()
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-02-30', open: '10:00', close: '11:00' })
    expect(r).toMatchObject({ ok: false, reason: 'invalid' })
    for (const fn of Object.values(spied)) expect(fn).not.toHaveBeenCalled()
    for (const k of W) expect(mockCore.writer[k]).not.toHaveBeenCalled()
    expectWrites()
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
    expectWrites()
  })
})

describe('PKT-S30 F8 — a grant-check outage is cannot-verify, never a crash or a forbidden', () => {
  it('readCanWriteStoreDays answers unknown (never read-only) and logs when the grant check throws', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockRejectedValue(new Error('grants down'))
    await expect(data.readCanWriteStoreDays(STORE_ID)).resolves.toBe('unknown')
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
    expectWrites()
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
  it('remove: target_id = row.id, store_id, target_label = the date, detail { date, reason } (the remove row, PKT-S32 R21)', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)
    expect(mockCore.auditLog.mock.calls[1][0]).toEqual({
      actor_type: 'staff', actor_id: 'staff-owner', category: 'settings', action: 'store_closed_day.remove', target_type: 'store_closed_day',
      target_id: CLOSURE_C2.id, store_id: STORE_ID, target_label: '2026-11-10', detail: { date: '2026-11-10', reason: '棚卸し' },
    })
  })
  it('remove: a failed audit write logs at warn, never console.error, and REFUSES the removal (PKT-S32 R19: no row, no removal)', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    mockCore.auditLog.mockRejectedValueOnce(new Error('audit down'))
    const r = await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)
    expect(r).toEqual({ ok: false, reason: 'core', message: GENERIC_FAIL_LINE })
    expect(mockCore.writer.removeClosedDay).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('audit record refused the removal'), expect.stringContaining('audit down'))
    expect(error).not.toHaveBeenCalled()
  })
})

describe('PKT-S30 F12 + P3-3/4/5 — memo per actor; validation lines', () => {
  it('F12: a granted ADMIN is checked ONCE across an add + a remove, with a FRESH reads object per call', async () => {
    as('login-admin')
    const first = withReads()
    first.businessGrantsCheck.mockResolvedValue({ granted: true })
    mockCore.writer.addClosedDay.mockResolvedValueOnce({ ...CLOSURE_C1, id: 'c9', date: '2026-12-28' })
    expect((await data.addStoreClosedDay(STORE_ID, { date: '2026-12-28', reason: '' })).ok).toBe(true)
    const second = withReads() // a new object: a memo hung on the reads object could not survive this
    second.businessGrantsCheck.mockResolvedValue({ granted: true })
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    expect((await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)).ok).toBe(true)
    expect(first.businessGrantsCheck.mock.calls.length + second.businessGrantsCheck.mock.calls.length).toBe(1)
  })
  it('P3-3: core’s 366 cap (whole array, past included) is a validation line, zero writes', async () => {
    const spied = withReads()
    const full = Array.from({ length: 366 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), open: '10:00', close: '11:00' }))
    spied.storePolicyGet.mockResolvedValue({ ...BASE_POLICY, special_open_days: full })
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2027-06-01', open: '10:00', close: '11:00' })
    expect(r).toEqual({ ok: false, reason: 'invalid', message: '特別営業日は366件までのため、これ以上追加できません。' })
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    expectWrites()
  })
  it('P3-4: past special days are not listed, but ride back unchanged in the set', async () => {
    const spied = withReads()
    const PAST = { date: '2026-09-01', open: '10:00', close: '11:00' }
    spied.storePolicyGet.mockResolvedValue({ ...BASE_POLICY, special_open_days: [PAST, SPECIAL_1020] })
    const read = await data.readStoreDays(STORE_ID)
    expect(read.ok && read.specialOpenDays).toEqual([SPECIAL_1020])
    mockCore.writer.set.mockImplementation(async (_s: string, b: { special_open_days: unknown[] }) => ({ ...BASE_POLICY, special_open_days: b.special_open_days }))
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '10:00', close: '11:00' })
    expect(mockCore.writer.set.mock.calls[0][1].special_open_days[0]).toEqual(PAST)
    expect(r).toEqual({ ok: true, specialOpenDays: [SPECIAL_1020, { date: '2026-12-01', open: '10:00', close: '11:00' }] })
  })
  it('P3-5: empty date → 日付を選んでください。 / empty time → 時刻を選んでください。, zero calls', async () => {
    const spied = withReads()
    expect(await data.addStoreClosedDay(STORE_ID, { date: '', reason: '' })).toEqual({ ok: false, reason: 'invalid', message: '日付を選んでください。' })
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '', close: '11:00' })).toEqual({ ok: false, reason: 'invalid', message: '時刻を選んでください。' })
    for (const fn of Object.values(spied)) expect(fn).not.toHaveBeenCalled()
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    expect(mockCore.writer.addClosedDay).not.toHaveBeenCalled()
    expectWrites()
  })
})

describe('PKT-S30 F1 — store isolation through visibleIds(actor): a store outside the view is forbidden before any SDK call', () => {
  // Hand-built actors (the recorded SHEETS cannot shape them): each sees ONLY the OTHER store, never STORE_ID.
  const SCOPED = staffRow('staff-scoped', 'login-scoped', '店舗限定', 'OWNER')
  function actorSeeingOnlyOther(sheetRow: Sheet, granted: boolean): Spied {
    as('login-scoped')
    const spied = withReads()
    spied.staffList.mockResolvedValue({ staff: [...STAFF, { ...SCOPED, role: sheetRow.coarse_role as Staff['role'] }], total: STAFF.length + 1, page: 1, page_size: 200 })
    spied.answerSheet.mockImplementation(async (id: string) => (id === 'staff-scoped' ? sheetRow : SHEETS[id]))
    spied.businessGrantsCheck.mockResolvedValue({ granted })
    return spied
  }
  async function everyWriteForbidden(spied: Spied): Promise<void> {
    const FORBID = { ok: false, reason: 'forbidden', message: '変更には本部の権限が必要です。' }
    expect(await data.addStoreClosedDay(STORE_ID, { date: '2026-12-01', reason: '' })).toEqual(FORBID)
    expect(await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)).toEqual(FORBID)
    expect(await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-12-01', open: '10:00', close: '11:00' })).toEqual(FORBID)
    expect(await data.removeStoreSpecialOpenDay(STORE_ID, '2026-10-20')).toEqual(FORBID)
    expect(await data.readCanWriteStoreDays(STORE_ID)).toBe('read-only')
    // BEFORE any SDK call: no write, no audit, no writer handle built, no store-days read of STORE_ID.
    expectWrites()
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expect(mockCore.auditWriterFor).not.toHaveBeenCalled()
    expect(spied.storePolicyGet).not.toHaveBeenCalled()
    expect(spied.storePolicyListClosedDays).not.toHaveBeenCalled()
  }
  it('OWNER, settings.manage, NO stores.viewAll, visible_store_ids [OTHER] → every write to STORE_ID forbidden, zero calls', async () => {
    const spied = actorSeeingOnlyOther(sheet('staff-scoped', 'owner', 'OWNER', ['settings.manage'], [OTHER_STORE_ID]), true)
    await everyWriteForbidden(spied)
  })
  it('variant 2: ADMIN + a granted HQ_ADMIN, visible_store_ids [OTHER] → the grant does not widen the view', async () => {
    const spied = actorSeeingOnlyOther(sheet('staff-scoped', 'manager', 'ADMIN', ['settings.manage'], [OTHER_STORE_ID]), true)
    await everyWriteForbidden(spied)
  })
  it('the same actor WITH stores.viewAll → allowed (viewAll sees every tenant store)', async () => {
    actorSeeingOnlyOther(sheet('staff-scoped', 'owner', 'OWNER', ['settings.manage', 'stores.viewAll'], [OTHER_STORE_ID]), true)
    mockCore.writer.addClosedDay.mockResolvedValueOnce({ id: 'c9c9c9c9-0000-4000-8000-000000000009', store_id: STORE_ID, date: '2026-12-01', reason: null, created_by: null, created_at: 'x' })
    const r = await data.addStoreClosedDay(STORE_ID, { date: '2026-12-01', reason: '' })
    expect(r.ok).toBe(true)
    expectWrites({ addClosedDay: 1 })
  })
})

// ⚖ PKT-S31 fix run 2 — read2's attack cases (Opus A1/B1/C3/D1/F8-reason), kept as regressions.
describe('PKT-S31 R1/R2/R3/R4/R6 — memo on 403, bounded audit, midnight remove, core validation, trimmed reason', () => {
  it('R1: a 403 on a write clears the actor’s memoized grant — the next capability check asks core again and reads not-writable', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockResolvedValue({ granted: true })
    expect(await data.readCanWriteStoreDays(STORE_ID)).toBe('writable')
    spied.businessGrantsCheck.mockResolvedValue({ granted: false }) // revoked in core after the memo
    mockCore.writer.addClosedDay.mockRejectedValueOnce(fakeSynqedError(403, 'Forbidden'))
    const r = await data.addStoreClosedDay(STORE_ID, { date: '2026-11-20', reason: '' })
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(await data.readCanWriteStoreDays(STORE_ID)).toBe('read-only')
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(2)
  })
  it.each([
    ['remove closure', () => { mockCore.writer.removeClosedDay.mockRejectedValueOnce(fakeSynqedError(403, 'Forbidden')); return data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id) }],
    ['set special days', () => { mockCore.writer.set.mockRejectedValueOnce(fakeSynqedError(403, 'Forbidden')); return data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-11-20', open: '10:00', close: '19:00' }) }],
  ])('R1: a 403 on %s clears the memo too', async (_name, write) => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockResolvedValue({ granted: true })
    expect(await data.readCanWriteStoreDays(STORE_ID)).toBe('writable')
    expect(await write()).toMatchObject({ ok: false, reason: 'forbidden' })
    await data.readCanWriteStoreDays(STORE_ID)
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(2)
  })
  // ⚖ PKT-S32 R16 — the negative side of R1: ONLY a 403 clears the memo. A 409 or a 503 on any of the
  // three writes keeps it, so a second write by the same granted actor never asks core the grant question again.
  const R16_WRITES: Array<[string, (status: number) => void, () => Promise<unknown>]> = [
    ['add closure', (status) => { mockCore.writer.addClosedDay.mockRejectedValueOnce(fakeSynqedError(status, 'refused')) }, () => data.addStoreClosedDay(STORE_ID, { date: '2026-11-20', reason: '' })],
    ['remove closure', (status) => { mockCore.writer.removeClosedDay.mockRejectedValueOnce(fakeSynqedError(status, 'refused')) }, () => data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)],
    ['set special days', (status) => { mockCore.writer.set.mockRejectedValueOnce(fakeSynqedError(status, 'refused')) }, () => data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-11-20', open: '10:00', close: '19:00' })],
  ]
  it.each(R16_WRITES.flatMap(([name, refuse, write]) => [
    [name, 409, 1, refuse, write] as const,
    [name, 503, 1, refuse, write] as const,
    [name, 403, 2, refuse, write] as const,
  ]))('R16: %s refused with %i, then a second write → the grant check ran %i time(s)', async (_name, status, checks, refuse, write) => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockResolvedValue({ granted: true })
    refuse(status)
    expect(await write()).toMatchObject({ ok: false })
    await write()
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(checks)
  })
  it('R2 → PKT-S32 R19 T1: audit.log never answers → the removal is REFUSED once the bound passes, core delete never called, one warn carrying store_id, date and reason', async () => {
    mockCore.auditLog = jest.fn(() => new Promise(() => {}))
    let settled: unknown = 'pending'
    const pending = data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id).then((r) => (settled = r))
    for (let i = 0; i < 40; i++) await new Promise((res) => setImmediate(res))
    expect(settled).toBe('pending')
    expect(mockCore.writer.removeClosedDay).toHaveBeenCalledTimes(0)
    jest.advanceTimersByTime(5000)
    await pending
    expect(settled).toEqual({ ok: false, reason: 'core', message: GENERIC_FAIL_LINE })
    expect(mockCore.writer.removeClosedDay).toHaveBeenCalledTimes(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('nothing removed')
    expect(JSON.parse(String(warn.mock.calls[0][1])).target_id).toBe(CLOSURE_C2.id) // T8 (PKT-S32 R20)
    expect(mockCore.auditLog.mock.calls.map((c) => c[0].action)).toEqual(['store_closed_day.remove_attempt']) // PKT-S32 R21
    const line = String(warn.mock.calls[0][1])
    expect(line).toContain(STORE_ID)
    expect(line).toContain('2026-11-10')
    expect(line).toContain('棚卸し')
    expect(line).toContain('no answer within 5000 ms')
  })
  it('R2 → PKT-S32 R19 T2: a synchronous throw from the audit handle or the log call, or a rejection → REFUSED, zero deletes, warned with the reason', async () => {
    const REFUSED = { ok: false, reason: 'core', message: GENERIC_FAIL_LINE }
    mockCore.auditWriterFor = jest.fn(() => { throw new Error('sync boom') })
    expect(await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)).toEqual(REFUSED)
    mockCore.auditWriterFor = jest.fn()
    mockCore.auditLog = jest.fn(() => { throw new Error('sync log') })
    expect(await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)).toEqual(REFUSED)
    mockCore.auditLog = jest.fn().mockRejectedValue(new Error('async reject'))
    expect(await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)).toEqual(REFUSED)
    expect(mockCore.writer.removeClosedDay).toHaveBeenCalledTimes(0)
    expect(warn.mock.calls.map((c) => String(c[1]))).toEqual([expect.stringContaining('sync boom'), expect.stringContaining('sync log'), expect.stringContaining('async reject')])
    for (const c of warn.mock.calls) expect(String(c[0])).toContain('nothing removed')
    expect(String(warn.mock.calls[1][1])).toContain('棚卸し')
  })
  it('R3: special REMOVE of “today” whose JST day turns during the read → 過ぎた日付です, no set', async () => {
    jest.setSystemTime(new Date('2026-09-29T14:59:59.900Z')) // 23:59:59.9 JST
    const spied = withReads()
    spied.storePolicyGet.mockImplementation(async () => {
      jest.setSystemTime(new Date('2026-09-29T15:00:00.100Z')) // 00:00:00.1 JST the next day
      return { ...BASE_POLICY, special_open_days: [{ date: '2026-09-29', open: '10:00', close: '12:00' }, SPECIAL_1020] }
    })
    const r = await data.removeStoreSpecialOpenDay(STORE_ID, '2026-09-29')
    expect(r).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expectWrites()
  })
  it('R4: core refuses the set with a validation 400 after the user’s entry passed → the generic line, core’s words + the dates logged', async () => {
    const spied = withReads()
    spied.storePolicyGet.mockResolvedValue({ ...BASE_POLICY, special_open_days: [{ date: '2026-01-05', open: '10:00', close: '10:00' }, SPECIAL_1020] })
    mockCore.writer.set.mockRejectedValueOnce(fakeSynqedError(400, 'open must be before close'))
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-11-20', open: '10:00', close: '19:00' })
    expect(r).toEqual({ ok: false, reason: 'core', message: GENERIC_FAIL_LINE })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('special days set'), 400, 'open must be before close', JSON.stringify(['2026-01-05', '2026-10-20', '2026-11-20']))
  })
  it('R4: the 409 duplicate keeps its own line', async () => {
    mockCore.writer.set.mockRejectedValueOnce(fakeSynqedError(409, 'Special open dates must be unique'))
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-11-20', open: '10:00', close: '19:00' })
    expect(r).toEqual({ ok: false, reason: 'invalid', message: DUPLICATE_SPECIAL_LINE })
  })
  it('R15: core’s duplicate MESSAGE wins over the status — a 422 “Special open dates must be unique” → the duplicate line', async () => {
    mockCore.writer.set.mockRejectedValueOnce(fakeSynqedError(422, 'Special open dates must be unique'))
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-11-20', open: '10:00', close: '19:00' })
    expect(r).toEqual({ ok: false, reason: 'invalid', message: DUPLICATE_SPECIAL_LINE })
    expectWrites({ set: 1 })
  })
  it('R15: any other core validation message at 400 still takes R4’s generic line', async () => {
    mockCore.writer.set.mockRejectedValueOnce(fakeSynqedError(400, 'open must be before close'))
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-11-20', open: '10:00', close: '19:00' })
    expect(r).toEqual({ ok: false, reason: 'core', message: GENERIC_FAIL_LINE })
    expect(r).not.toEqual(expect.objectContaining({ message: DUPLICATE_SPECIAL_LINE }))
  })
  it('R17: a 403 carrying the duplicate message stays forbidden and clears the memo — never the duplicate line', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockResolvedValue({ granted: true })
    mockCore.writer.set.mockRejectedValueOnce(fakeSynqedError(403, 'Special open dates must be unique'))
    const r = await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-11-20', open: '10:00', close: '19:00' })
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(r).not.toEqual(expect.objectContaining({ message: DUPLICATE_SPECIAL_LINE }))
    await data.addStoreSpecialOpenDay(STORE_ID, { date: '2026-11-20', open: '10:00', close: '19:00' })
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(2)
  })
  it('R6: a spaces-only closure reason is trimmed, then sent as null (audit detail reason "")', async () => {
    mockCore.writer.addClosedDay.mockImplementation(async (_s: string, b: { date: string; reason: string | null }) => ({ ...CLOSURE_C1, id: 'eeeeeeee-0000-4000-8000-00000000000e', date: b.date, reason: b.reason }))
    await data.addStoreClosedDay(STORE_ID, { date: '2026-11-21', reason: '   ' })
    await data.addStoreClosedDay(STORE_ID, { date: '2026-11-22', reason: '  棚卸し ' })
    expect(mockCore.writer.addClosedDay.mock.calls.map((c) => [c[1].reason, c[1].audit.detail.reason])).toEqual([[null, ''], ['棚卸し', '棚卸し']])
  })
})

// ⚖ PKT-S32 R19/R21 — an attempt row BEFORE core's hard delete (no row, no removal); the remove row only AFTER it.
describe('PKT-S32 R21 — attempt row before the delete, remove row after it', () => {
  const ATTEMPT = 'store_closed_day.remove_attempt'
  const REMOVE = 'store_closed_day.remove'
  const DETAIL = { date: '2026-11-10', reason: '棚卸し' }
  it('T3: audit ok + delete ok → ok, list without the row, exactly 2 rows: attempt BEFORE the delete, remove AFTER it', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    const r = await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)
    expect(r).toEqual({ ok: true, closures: [CLOSURE_C1] })
    expectWrites({ removeClosedDay: 1, auditLog: 2 })
    expect(mockCore.auditLog.mock.calls.map((c) => c[0].action)).toEqual([ATTEMPT, REMOVE])
    for (const c of mockCore.auditLog.mock.calls) {
      expect(c[0]).toMatchObject({ target_id: CLOSURE_C2.id, store_id: STORE_ID, target_label: '2026-11-10' })
      expect(c[0].detail).toEqual(DETAIL)
    }
    const [attemptAt, removeAt] = mockCore.auditLog.mock.invocationCallOrder
    const deleteAt = mockCore.writer.removeClosedDay.mock.invocationCallOrder[0]
    expect(attemptAt).toBeLessThan(deleteAt)
    expect(deleteAt).toBeLessThan(removeAt)
  })
  it('T4: audit ok + delete throws 403 → forbidden, grant memo cleared, exactly 1 row (the attempt)', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockResolvedValue({ granted: true })
    mockCore.writer.removeClosedDay.mockRejectedValueOnce(fakeSynqedError(403, 'Forbidden'))
    expect(await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(mockCore.auditLog).toHaveBeenCalledTimes(1)
    expect(mockCore.auditLog.mock.calls[0][0]).toMatchObject({ action: ATTEMPT, target_id: CLOSURE_C2.id, detail: DETAIL })
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id) // R1: the second write re-checks the grant
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(2)
  })
  it('T5: audit ok + delete throws 503 → the generic line, memo kept, exactly 1 row (the attempt)', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockResolvedValue({ granted: true })
    mockCore.writer.removeClosedDay.mockRejectedValueOnce(fakeSynqedError(503, 'unavailable'))
    expect(await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)).toEqual({ ok: false, reason: 'core', message: GENERIC_FAIL_LINE })
    expect(mockCore.auditLog).toHaveBeenCalledTimes(1)
    expect(mockCore.auditLog.mock.calls[0][0].action).toBe(ATTEMPT)
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(1)
  })
  it('T6: delete ok + the completion row rejects → still ok, list filtered, one "attempt row stands" warn with target_id, no error', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    mockCore.auditLog = jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('audit down'))
    expect(await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)).toEqual({ ok: true, closures: [CLOSURE_C1] })
    expect(mockCore.auditLog.mock.calls.map((c) => c[0].action)).toEqual([ATTEMPT, REMOVE])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('the attempt row stands')
    const payload = JSON.parse(String(warn.mock.calls[0][1]))
    expect(payload).toMatchObject({ store_id: STORE_ID, target_id: CLOSURE_C2.id, date: '2026-11-10', reason: '棚卸し', problem: 'audit down' })
    expect(error).not.toHaveBeenCalled()
  })
  it('T7 (PKT-S32 R20): the JST day turns during the attempt-row wait → 過ぎた日付です, only the attempt row, no delete', async () => {
    jest.setSystemTime(new Date('2026-09-29T14:59:58Z')) // 23:59:58 JST
    const TODAY_CLOSURE = { ...CLOSURE_C2, date: '2026-09-29' }
    const spied = withReads()
    spied.storePolicyListClosedDays.mockResolvedValue({ closed_days: [TODAY_CLOSURE] })
    mockCore.auditLog = jest.fn(() => new Promise((res) => setTimeout(() => res({}), 3000)))
    let settled: unknown = 'pending'
    const pending = data.removeStoreClosedDay(STORE_ID, TODAY_CLOSURE.id).then((r) => (settled = r))
    for (let i = 0; i < 40; i++) await new Promise((res) => setImmediate(res))
    expect(settled).toBe('pending')
    expect(mockCore.auditLog).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(3000) // 00:00:01 JST the next day
    await pending
    expect(settled).toEqual({ ok: false, reason: 'invalid', message: '過ぎた日付です' })
    expectWrites({ auditLog: 1 })
    expect(mockCore.auditLog.mock.calls[0][0]).toMatchObject({ action: ATTEMPT, detail: { date: '2026-09-29', reason: '棚卸し' } })
  })
  it('T9 (PKT-S33): the completion row never answers → pending at 4999 ms, ok at 5000 ms with one "attempt row stands" warn naming the bound, no timer left', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    mockCore.auditLog = jest.fn().mockResolvedValueOnce({}).mockImplementationOnce(() => new Promise(() => {}))
    let settled: unknown = 'pending'
    const pending = data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id).then((r) => (settled = r))
    for (let i = 0; i < 40; i++) await new Promise((res) => setImmediate(res))
    expect(mockCore.auditLog.mock.calls.map((c) => c[0].action)).toEqual([ATTEMPT, REMOVE])
    expect(mockCore.writer.removeClosedDay).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(4999)
    for (let i = 0; i < 40; i++) await new Promise((res) => setImmediate(res))
    expect(settled).toBe('pending')
    jest.advanceTimersByTime(1) // 5000 ms total
    await pending
    expect(settled).toEqual({ ok: true, closures: [CLOSURE_C1] })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('the attempt row stands')
    const payload = JSON.parse(String(warn.mock.calls[0][1]))
    expect(payload).toMatchObject({ store_id: STORE_ID, target_id: CLOSURE_C2.id, date: '2026-11-10' })
    expect(String(payload.problem)).toContain('5000')
    expect(jest.getTimerCount()).toBe(0)
  })
  it('T10 (PKT-S33): the attempt row answers at 4999 ms → inside the bound: the delete runs exactly once, ok', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    mockCore.auditLog = jest.fn().mockImplementationOnce(() => new Promise((res) => setTimeout(() => res({}), 4999))).mockResolvedValueOnce({})
    let settled: unknown = 'pending'
    const pending = data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id).then((r) => (settled = r))
    for (let i = 0; i < 40; i++) await new Promise((res) => setImmediate(res))
    expect(settled).toBe('pending')
    expect(mockCore.writer.removeClosedDay).toHaveBeenCalledTimes(0)
    jest.advanceTimersByTime(4999)
    await pending
    expect(mockCore.writer.removeClosedDay).toHaveBeenCalledTimes(1)
    expect(settled).toEqual({ ok: true, closures: [CLOSURE_C1] })
    expect(warn).not.toHaveBeenCalled()
  })
  it('T11 (PKT-S33): both rows answer at once → ok and no timer left behind (each bound is cleared)', async () => {
    mockCore.writer.removeClosedDay.mockResolvedValueOnce(undefined)
    expect(await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)).toEqual({ ok: true, closures: [CLOSURE_C1] })
    expectWrites({ removeClosedDay: 1, auditLog: 2 })
    expect(jest.getTimerCount()).toBe(0)
  })
  it('T12 (PKT-S33, R17 on the closure path): a 403 carrying a duplicate message stays forbidden — add clears the memo, remove too', async () => {
    as('login-admin')
    const spied = withReads()
    spied.businessGrantsCheck.mockResolvedValue({ granted: true })
    mockCore.writer.addClosedDay.mockRejectedValueOnce(fakeSynqedError(403, 'This date is already a closed day for the store.'))
    const r = await data.addStoreClosedDay(STORE_ID, { date: '2026-11-20', reason: '' })
    expect(r).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(r).not.toMatchObject({ reason: 'invalid' })
    await data.readCanWriteStoreDays(STORE_ID)
    expect(spied.businessGrantsCheck).toHaveBeenCalledTimes(2)
    mockCore.writer.removeClosedDay.mockRejectedValueOnce(fakeSynqedError(403, 'Special open dates must be unique'))
    const r2 = await data.removeStoreClosedDay(STORE_ID, CLOSURE_C2.id)
    expect(r2).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(r2).not.toEqual(expect.objectContaining({ message: DUPLICATE_SPECIAL_LINE }))
  })
})

// ── Reserve S66 — 受付ルール: setReservePolicy (its own door file, this suite's mocks) ───────────────────────────────
describe('Reserve S66 — setReservePolicy, door-reserve-policy.ts through data.ts (the six booking rules, one store)', () => {
  const { RESERVE_POLICY_DEFAULTS, policyHash, pickReservePolicy } = jest.requireActual('@/business/lib/practice-door/reserve-policy') as typeof import('@/business/lib/practice-door/reserve-policy')
  const PROOF = { booking_open_days: 21, cutoff_minutes: 90, reserve_start_grid_min: 15, cancel_free_until_hours: 12, cancel_late_pct: 30, no_show_pct: 100 } as const
  const BASED = policyHash(pickReservePolicy(BASE_POLICY))
  // S67 W2: the writer saves only a store whose 受付 plane is live. The admitted store's line lands in
  // sample-facade.ts with the screen (#1157); here it is set by hand, on the same table the writer reads.
  const { STORE_PLANE_OVERRIDES } = jest.requireActual('@/business/lib/practice-door/sample-facade') as typeof import('@/business/lib/practice-door/sample-facade')
  beforeEach(() => { STORE_PLANE_OVERRIDES[STORE_ID] = { ...STORE_PLANE_OVERRIDES[STORE_ID], bookingPolicy: 'live' } })
  afterEach(() => { delete STORE_PLANE_OVERRIDES[OTHER_STORE_ID] })

  it('W2: a visible store whose 受付 plane is still sample (a hand-made PUT) → tenant, no core call, 0 storePolicies.set', async () => {
    expect(STORE_PLANE_OVERRIDES[OTHER_STORE_ID]?.bookingPolicy).not.toBe('live')
    const reads = withReads()
    expect(await data.setReservePolicy(OTHER_STORE_ID, { ...PROOF }, BASED)).toEqual({ ok: false, reason: 'tenant', message: 'いまは保存できないため、時間をおいてもう一度保存してください。' })
    expect(Object.values(reads).every((fn) => fn.mock.calls.length === 0)).toBe(true)
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expect(mockCore.writer.set).not.toHaveBeenCalled()
    expectWrites()
  })

  it('ok: ONE set(storeId, { acting_staff_id, six fields }) — no lead_time_min, weekly_hours, special_open_days, booking_step_min; basedOn refreshed from the PUT answer', async () => {
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY, ...PROOF, updated_at: '2026-09-29T03:00:00.000Z' })
    const result = await data.setReservePolicy(STORE_ID, { ...PROOF }, BASED)
    expect(result).toEqual({ ok: true, row: { ...PROOF, updated_at: '2026-09-29T03:00:00.000Z' }, basedOn: policyHash(PROOF) })
    expect(mockCore.writer.set.mock.calls).toEqual([[STORE_ID, { acting_staff_id: 'staff-owner', ...PROOF }]])
    expect(Object.keys(mockCore.writer.set.mock.calls[0][1]).sort()).toEqual(['acting_staff_id', ...Object.keys(PROOF)].sort())
    expectWrites({ set: 1 })
  })

  it('two saves in a row: a fresh basedOn passes both times; the first basedOn a second time is stale and nothing is written', async () => {
    let row = { ...BASE_POLICY }
    const reads = withReads()
    reads.storePolicyGet.mockImplementation(async () => ({ ...row }))
    mockCore.writer.set.mockImplementation(async (_id: string, input: Record<string, unknown>) => {
      const { acting_staff_id: _a, ...rest } = input
      row = { ...row, ...rest }
      return { ...row }
    })
    const first = await data.setReservePolicy(STORE_ID, { ...PROOF }, BASED)
    expect(first.ok).toBe(true)
    const second = await data.setReservePolicy(STORE_ID, { ...PROOF, no_show_pct: 50 }, first.ok ? first.basedOn : 'x')
    expect(second.ok).toBe(true)
    const third = await data.setReservePolicy(STORE_ID, { ...PROOF, no_show_pct: 0 }, first.ok ? first.basedOn : 'x')
    expect(third).toMatchObject({ ok: false, reason: 'stale', message: 'この店舗のReserve 受付の設定が、このページを開いたあとにほかの画面や端末で保存されたため、保存できませんでした。変更していない項目は最新の内容に置き換えました。もう一度保存すると、変更した項目が保存されます。' })
    expectWrites({ set: 2 })
  })

  it('stale carries the current six + their basedOn; the next save with that basedOn succeeds (an explicit second press)', async () => {
    const theirs = { ...PROOF, no_show_pct: 50 }
    let row: Record<string, unknown> = { ...BASE_POLICY, ...theirs, updated_at: '2026-10-08T01:00:00.000Z' }
    const reads = withReads()
    reads.storePolicyGet.mockImplementation(async () => ({ ...row }))
    mockCore.writer.set.mockImplementation(async (_id: string, input: Record<string, unknown>) => {
      const rest = Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'acting_staff_id'))
      row = { ...row, ...rest, updated_at: '2026-10-08T02:00:00.000Z' }
      return { ...row }
    })
    const mine = { ...PROOF, cancel_late_pct: 40 }
    const first = await data.setReservePolicy(STORE_ID, mine, BASED)
    expect(first).toEqual({ ok: false, reason: 'stale', message: expect.any(String), current: { ...theirs, updated_at: '2026-10-08T01:00:00.000Z' }, basedOn: policyHash(theirs) })
    expectWrites()
    const second = await data.setReservePolicy(STORE_ID, mine, !first.ok && first.reason === 'stale' ? first.basedOn : 'x')
    expect(second).toEqual({ ok: true, row: { ...mine, updated_at: '2026-10-08T02:00:00.000Z' }, basedOn: policyHash(mine) })
    expectWrites({ set: 1 })
  })

  it('no-op: the six already stored → ok with the stored row and the same basedOn, ONE get and NO set (updated_at stays)', async () => {
    const reads = withReads()
    reads.storePolicyGet.mockResolvedValue({ ...BASE_POLICY, ...PROOF, updated_at: '2026-09-01T00:00:00.000Z' })
    const result = await data.setReservePolicy(STORE_ID, { ...PROOF }, policyHash(PROOF))
    expect(result).toEqual({ ok: true, row: { ...PROOF, updated_at: '2026-09-01T00:00:00.000Z' }, basedOn: policyHash(PROOF) })
    expect(reads.storePolicyGet).toHaveBeenCalledTimes(1)
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expectWrites()
  })

  it('no-op with a stale basedOn is still stale (the precondition is asked first)', async () => {
    withReads().storePolicyGet.mockResolvedValue({ ...BASE_POLICY, ...PROOF })
    expect(await data.setReservePolicy(STORE_ID, { ...PROOF }, policyHash(RESERVE_POLICY_DEFAULTS))).toMatchObject({ ok: false, reason: 'stale' })
    expectWrites()
  })

  it('stale: a basedOn that is not the row as read → stale, no set', async () => {
    const result = await data.setReservePolicy(STORE_ID, { ...PROOF }, policyHash({ ...RESERVE_POLICY_DEFAULTS, booking_open_days: 31 }))
    expect(result).toMatchObject({ ok: false, reason: 'stale' })
    expectWrites()
  })

  it.each([
    ['grid 0', { ...PROOF, reserve_start_grid_min: 0 }], // S67: core holds any grid > 0 (20 is a real row now); 0 never
    ['101%', { ...PROOF, cancel_late_pct: 101 }],
    ['0 days', { ...PROOF, booking_open_days: 0 }],
    ['cutoff 40000', { ...PROOF, cutoff_minutes: 40000 }],
    ['a fraction', { ...PROOF, no_show_pct: 12.5 }],
    ['a seventh field', { ...PROOF, lead_time_min: 60 }],
    ['a missing field', { booking_open_days: 21 }],
  ])('invalid (%s): refused before any core read or write', async (_name, draft) => {
    const reads = withReads()
    const result = await data.setReservePolicy(STORE_ID, draft, BASED)
    expect(result).toEqual({ ok: false, reason: 'invalid', message: '設定できる範囲を超えた値があるため、保存できませんでした。' })
    expect(reads.storePolicyGet).not.toHaveBeenCalled()
    expectWrites()
  })

  it.each([
    ['cutoff longer than the open days', { ...PROOF, booking_open_days: 1, cutoff_minutes: 1441, cancel_free_until_hours: 0 }, '直前締切が受け付ける日数より長く、予約できる枠がなくなるため、保存できませんでした。'],
    ['free deadline longer than the open days', { ...PROOF, booking_open_days: 1, cutoff_minutes: 0, cancel_free_until_hours: 25 }, '無料キャンセル期限が受け付ける日数より長く、すべての予約が期限後になるため、保存できませんでした。'],
  ])('invalid (%s): the §4 line, no core call', async (_name, draft, line) => {
    const reads = withReads()
    expect(await data.setReservePolicy(STORE_ID, draft, BASED)).toEqual({ ok: false, reason: 'invalid', message: line })
    expect(reads.storePolicyGet).not.toHaveBeenCalled()
    expectWrites()
  })

  it('forbidden: a store outside the actor’s visible stores is refused before any core read', async () => {
    as('login-admin')
    STORE_PLANE_OVERRIDES[OTHER_STORE_ID] = { bookingPolicy: 'live' } // live here, so visibility is what refuses
    const reads = withReads()
    expect(await data.setReservePolicy(OTHER_STORE_ID, { ...PROOF }, BASED)).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(reads.storePolicyGet).not.toHaveBeenCalled()
    expect(reads.businessGrantsCheck).not.toHaveBeenCalled()
    expectWrites()
  })

  it('tenant: the practice switch removed → tenant, nothing reaches core', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const reads = withReads()
    expect(await data.setReservePolicy(STORE_ID, { ...PROOF }, BASED)).toMatchObject({ ok: false, reason: 'tenant' })
    expect(Object.values(reads).every((fn) => fn.mock.calls.length === 0)).toBe(true)
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expectWrites()
  })

  it('BASE_POLICY is a row core itself would hold: its six pass the same checks a draft does', () => {
    const { parseReservePolicy, reservePolicyProblem } = jest.requireActual('@/business/lib/practice-door/reserve-policy') as typeof import('@/business/lib/practice-door/reserve-policy')
    const six = parseReservePolicy(pickReservePolicy(BASE_POLICY))
    expect(six).toEqual(RESERVE_POLICY_DEFAULTS)
    expect(six && reservePolicyProblem(six)).toBeNull()
  })

  it('forbidden: a non-OWNER with settings.manage and NO HQ grant — the grant asked once, no get, no set', async () => {
    as('login-admin')
    const reads = withReads()
    expect(await data.setReservePolicy(STORE_ID, { ...PROOF }, BASED)).toEqual({ ok: false, reason: 'forbidden', message: READ_ONLY_NOTE })
    expect(reads.businessGrantsCheck).toHaveBeenCalledTimes(1)
    expect(reads.storePolicyGet).not.toHaveBeenCalled()
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expectWrites()
  })

  it('the same non-OWNER WITH a live HQ grant saves (the grant is the gate, not the role)', async () => {
    as('login-admin')
    withReads().businessGrantsCheck.mockResolvedValue({ granted: true })
    mockCore.writer.set.mockResolvedValueOnce({ ...BASE_POLICY, ...PROOF })
    expect(await data.setReservePolicy(STORE_ID, { ...PROOF }, BASED)).toMatchObject({ ok: true })
    expect(mockCore.writer.set.mock.calls).toEqual([[STORE_ID, { acting_staff_id: 'staff-admin', ...PROOF }]])
    expectWrites({ set: 1 })
  })

  it('the grant check throws → core, no get, no set', async () => {
    as('login-admin')
    const reads = withReads()
    reads.businessGrantsCheck.mockRejectedValue(new Error('grants down'))
    expect(await data.setReservePolicy(STORE_ID, { ...PROOF }, BASED)).toEqual({ ok: false, reason: 'core', message: 'いまは保存できないため、時間をおいてもう一度保存してください。' })
    expect(reads.storePolicyGet).not.toHaveBeenCalled()
    expectWrites()
  })

  it('core answers 403 on the set → forbidden (core’s own requireHqAdmin, the second net)', async () => {
    mockCore.writer.set.mockRejectedValueOnce(fakeSynqedError(403, 'Forbidden'))
    expect(await data.setReservePolicy(STORE_ID, { ...PROOF }, BASED)).toEqual({ ok: false, reason: 'forbidden', message: READ_ONLY_NOTE })
    expectWrites({ set: 1 })
  })

  it.each([
    ['a plain throw', () => new Error('503 from core')],
    ['a core 500', () => fakeSynqedError(500, 'boom')],
  ])('the set throws (%s) → core, reported once, never retried', async (_n, err) => {
    mockCore.writer.set.mockRejectedValueOnce(err())
    expect(await data.setReservePolicy(STORE_ID, { ...PROOF }, BASED)).toMatchObject({ ok: false, reason: 'core' })
    expectWrites({ set: 1 })
  })

  it('invalid beats forbidden: a store the actor cannot see + an invalid draft → invalid, nothing reaches core', async () => {
    as('login-admin')
    const reads = withReads()
    expect(await data.setReservePolicy(OTHER_STORE_ID, { ...PROOF, cancel_late_pct: 101 }, BASED)).toEqual({ ok: false, reason: 'invalid', message: '設定できる範囲を超えた値があるため、保存できませんでした。' })
    expect(Object.values(reads).every((fn) => fn.mock.calls.length === 0)).toBe(true)
    expect(mockCore.writerFor).not.toHaveBeenCalled()
    expectWrites()
  })

  it('invalid beats stale: a visible store + a stale basedOn + an invalid draft → invalid, no get', async () => {
    const reads = withReads()
    expect(await data.setReservePolicy(STORE_ID, { ...PROOF, cutoff_minutes: 40000 }, 'not-the-row')).toMatchObject({ ok: false, reason: 'invalid' })
    expect(reads.storePolicyGet).not.toHaveBeenCalled()
    expectWrites()
  })

  describe('core’s edges, each side', () => {
    const D = { ...RESERVE_POLICY_DEFAULTS }
    beforeEach(() => {
      withReads().storePolicyGet.mockResolvedValue({ ...BASE_POLICY, ...PROOF })
      mockCore.writer.set.mockImplementation(async (_id: string, input: Record<string, unknown>) => {
        const rest = Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'acting_staff_id'))
        return { ...BASE_POLICY, ...rest }
      })
    })

    it.each([
      ['open days 1', { ...D, booking_open_days: 1 }],
      ['open days 365', { ...D, booking_open_days: 365 }],
      ['cutoff 10080 at 7 days (equal)', { ...D, booking_open_days: 7, cutoff_minutes: 10080 }],
      ['cutoff 1440 at 1 day (equal)', { ...D, booking_open_days: 1, cutoff_minutes: 1440 }],
      ['free 720 h at 30 days (equal)', { ...D, booking_open_days: 30, cancel_free_until_hours: 720 }],
      ['free 24 h at 1 day (equal)', { ...D, booking_open_days: 1, cancel_free_until_hours: 24 }],
      ['late 0 %', { ...D, cancel_late_pct: 0 }],
      ['late 100 %', { ...D, cancel_late_pct: 100 }],
      ['no-show 0 %', { ...D, no_show_pct: 0 }],
      ['no-show 100 %', { ...D, no_show_pct: 100 }],
      ['grid 15', { ...D, reserve_start_grid_min: 15 }],
      ['grid 30', { ...D, reserve_start_grid_min: 30 }],
      ['grid 60', { ...D, reserve_start_grid_min: 60 }],
      ['grid 45 (S68: any positive whole minutes)', { ...D, reserve_start_grid_min: 45 }],
      ['grid 10', { ...D, reserve_start_grid_min: 10 }],
      ['grid null', { ...D, reserve_start_grid_min: null }],
      ['30.0 as sent on the wire', JSON.parse('{"booking_open_days":30.0,"cutoff_minutes":0,"reserve_start_grid_min":null,"cancel_free_until_hours":24,"cancel_late_pct":0,"no_show_pct":0}')],
    ])('accepted: %s → ONE set with exactly these six', async (_n, draft) => {
      expect(await data.setReservePolicy(STORE_ID, draft, policyHash(PROOF))).toMatchObject({ ok: true, basedOn: policyHash(draft) })
      expect(mockCore.writer.set.mock.calls).toEqual([[STORE_ID, { acting_staff_id: 'staff-owner', ...draft }]])
      expectWrites({ set: 1 })
    })

    const FIVE = Object.fromEntries(Object.entries(D).filter(([k]) => k !== 'no_show_pct'))
    it.each([
      ['open days 366', { ...D, booking_open_days: 366 }],
      ['cutoff 10081', { ...D, booking_open_days: 365, cutoff_minutes: 10081 }],
      ['cutoff -1', { ...D, cutoff_minutes: -1 }],
      ['free 721 h', { ...D, booking_open_days: 365, cancel_free_until_hours: 721 }],
      ['late 101 %', { ...D, cancel_late_pct: 101 }],
      ['open days 29.9', { ...D, booking_open_days: 29.9 }],
      ["open days '30' (a string)", { ...D, booking_open_days: '30' }],
      ['cutoff NaN', { ...D, cutoff_minutes: NaN }],
      ['a missing field (no_show_pct)', FIVE],
      ['a seventh field (lead_time_min)', { ...D, lead_time_min: null }],
    ])('refused: %s → invalid, before any core read', async (_n, draft) => {
      const reads = mockCore.reads as unknown as Spied
      expect(await data.setReservePolicy(STORE_ID, draft, policyHash(PROOF))).toEqual({ ok: false, reason: 'invalid', message: '設定できる範囲を超えた値があるため、保存できませんでした。' })
      expect(reads.storePolicyGet).not.toHaveBeenCalled()
      expectWrites()
    })
  })

  it('the R5/R5b note condition: cutoff shorter than the free deadline AND a late-cancel fee above 0', () => {
    const { lateFromBooking } = jest.requireActual('@/business/lib/reserve-policy-view') as typeof import('@/business/lib/reserve-policy-view')
    expect(lateFromBooking(PROOF)).toBe(true) // 90 min < 12 h, 30 %
    expect(lateFromBooking({ ...PROOF, cutoff_minutes: 719 })).toBe(true) // one minute short of 12 h
    expect(lateFromBooking({ ...PROOF, cutoff_minutes: 720 })).toBe(false) // equal: not shorter
    expect(lateFromBooking({ ...PROOF, cancel_late_pct: 0 })).toBe(false) // R5b: no fee, nothing late that costs
    expect(lateFromBooking({ ...PROOF, cancel_late_pct: 1 })).toBe(true)
    expect(lateFromBooking(RESERVE_POLICY_DEFAULTS)).toBe(false) // core's defaults: 0 < 24 h, but 0 % → no note
    expect(data.LATE_FROM_BOOKING_NOTE).toBe('直前締切が無料キャンセル期限より短いため、期限を過ぎてから入った予約は、最初からキャンセル料の対象になります。')
  })
})

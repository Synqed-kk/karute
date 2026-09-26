/**
 * @jest-environment jsdom
 *
 * ONE staff lens for the three list tabs (S44) — the shared resolver
 * (⚖ 退職スタッフのリンク = 全員を表示, Liam 9/27 01:56) and the remembered pick
 * (⚖ STAFF CONTROL LOCKED 04:5x: per person, per tab, browser only —
 * URL param > remembered > 全スタッフ).
 */
import {
  STAFF_SCOPE_KEY_BASE,
  pickInitialStaffScope,
  readRememberedStaffScope,
  rememberStaffScope,
  resolveStaffScope,
  staffScopeKey,
} from '@/components/staff/staff-scope'

const ROSTER = ['s1', 's2']

describe('resolveStaffScope — the one lens', () => {
  it('all / missing / empty → all', () => {
    expect(resolveStaffScope('all', { selfStaffId: 's1', rosterIds: ROSTER })).toBe('all')
    expect(resolveStaffScope(null, { selfStaffId: 's1', rosterIds: ROSTER })).toBe('all')
    expect(resolveStaffScope(undefined, { selfStaffId: 's1', rosterIds: ROSTER })).toBe('all')
    expect(resolveStaffScope('', { selfStaffId: 's1', rosterIds: ROSTER })).toBe('all')
  })
  it('self with a profile → self; without one → all', () => {
    expect(resolveStaffScope('self', { selfStaffId: 's1', rosterIds: ROSTER })).toBe('self')
    expect(resolveStaffScope('self', { selfStaffId: null, rosterIds: ROSTER })).toBe('all')
  })
  it('a staff id on the roster → that id', () => {
    expect(resolveStaffScope('s2', { selfStaffId: 's1', rosterIds: ROSTER })).toBe('s2')
  })
  it('a departed staff id (off the roster) → all — label and filter together', () => {
    expect(resolveStaffScope('staff-9', { selfStaffId: 's1', rosterIds: ROSTER })).toBe('all')
  })
  it('an empty roster places nobody → all', () => {
    expect(resolveStaffScope('s2', { selfStaffId: 's1', rosterIds: [] })).toBe('all')
  })
})

describe('the remembered pick — key, storage, precedence', () => {
  beforeEach(() => window.localStorage.clear())

  it('key = karute:staffScope:<tab>:<operatorId>; no identity = no key', () => {
    expect(STAFF_SCOPE_KEY_BASE).toBe('karute:staffScope')
    expect(staffScopeKey('records', 'u1')).toBe('karute:staffScope:records:u1')
    expect(staffScopeKey('customers', 'u1')).toBe('karute:staffScope:customers:u1')
    expect(staffScopeKey('appointments', 'u1')).toBe('karute:staffScope:appointments:u1')
    expect(staffScopeKey('records', null)).toBeNull()
    expect(staffScopeKey('records', '')).toBeNull()
  })

  it('per person, per tab: a pick on one tab or by one person never leaks', () => {
    rememberStaffScope('customers', 'u1', 'self')
    expect(readRememberedStaffScope('customers', 'u1')).toBe('self')
    expect(readRememberedStaffScope('appointments', 'u1')).toBeNull()
    expect(readRememberedStaffScope('records', 'u1')).toBeNull()
    expect(readRememberedStaffScope('customers', 'u2')).toBeNull()
  })

  it('no identity: nothing written, nothing read', () => {
    rememberStaffScope('records', null, 's2')
    expect(window.localStorage.length).toBe(0)
    expect(readRememberedStaffScope('records', null)).toBeNull()
  })

  it('blank stored values read as nothing remembered', () => {
    window.localStorage.setItem('karute:staffScope:records:u1', '   ')
    expect(readRememberedStaffScope('records', 'u1')).toBeNull()
  })

  it('storage that throws degrades to nothing remembered', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => rememberStaffScope('records', 'u1', 'self')).not.toThrow()
    expect(readRememberedStaffScope('records', 'u1')).toBeNull()
    get.mockRestore()
    set.mockRestore()
  })

  it('precedence: URL param > remembered > all', () => {
    expect(pickInitialStaffScope('s1', 'self')).toBe('s1')
    expect(pickInitialStaffScope(null, 'self')).toBe('self')
    expect(pickInitialStaffScope(undefined, null)).toBe('all')
    expect(pickInitialStaffScope('', null)).toBe('all')
  })
})

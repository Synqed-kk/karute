jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))

import { audit } from '@/lib/audit'
import { auditStoreWriteRefused, ensureRecordStoreInScopeAudited } from '@/lib/audit-store-lock'
import { STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'

const actor = {
  actorId: 'auth-user-1',
  businessId: 'biz-1',
  source: 'web' as const,
  requestId: 'req-1',
}

beforeEach(() => jest.clearAllMocks())

describe('audited store lock — refusal payload contains only door, store, code and ids', () => {
  it.each(['booking', 'karute', 'recording', 'settings'] as const)(
    '%s refusal has exactly the allowed detail keys, without customer names or notes',
    (category) => {
      // Real records carry content. None of it belongs in a refusal receipt.
      const record = { store_id: 'store-B', customer_name: 'Private customer', notes: 'Private notes' }
      expect(() => ensureRecordStoreInScopeAudited(
        record,
        { viewAll: false, allowedStoreIds: ['store-A'] },
        'Record not found',
        {
          actor,
          category,
          targetType: 'karute',
          targetId: 'kar-1',
          door: `${category}.test_write`,
          // customer_id is not in StoreRefusalDetailKey — cast through
          // `as never` to prove an extra key still rides the row untouched.
          detail: { customer_id: 'cust-1', recording_session_id: 'rec-1' } as never,
        },
      )).toThrow(expect.objectContaining({ code: 'not_found', message: 'Record not found' }))
      expect(audit).toHaveBeenCalledTimes(1)
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({
        ...actor,
        action: `${category}.store_write_refused`,
        category,
        targetId: 'kar-1',
        detail: {
          door: `${category}.test_write`,
          record_store_id: 'store-B',
          code: 'not_found',
          customer_id: 'cust-1',
          recording_session_id: 'rec-1',
        },
      }))
    },
  )

  it.each(['booking', 'karute', 'recording', 'settings'] as const)(
    '%s degraded scope refuses as store_forbidden without an audit row',
    (category) => {
      expect(() => ensureRecordStoreInScopeAudited(
        { store_id: 'store-A' },
        { viewAll: false, allowedStoreIds: ['store-A'], degraded: true },
        'Record not found',
        { actor, category, targetId: 'kar-1', door: `${category}.test_write` },
      )).toThrow(expect.objectContaining({ code: 'store_forbidden', message: STORE_SCOPE_UNVERIFIED }))
      expect(audit).not.toHaveBeenCalled()
    },
  )

  it('an explicit empty assignment refuses as not_found and emits ONE ids-only row', () => {
    expect(() => ensureRecordStoreInScopeAudited(
      { store_id: 'store-A' },
      { viewAll: false, allowedStoreIds: [] },
      'Record not found',
      { actor, category: 'karute', targetId: 'kar-1', door: 'karute.test_write' },
    )).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: { door: 'karute.test_write', record_store_id: 'store-A', code: 'not_found' },
    }))
  })

  it('a detail trying to carry door, record_store_id or code cannot override the helper\'s own values', () => {
    expect(() => ensureRecordStoreInScopeAudited(
      { store_id: 'store-B' },
      { viewAll: false, allowedStoreIds: ['store-A'] },
      'Record not found',
      {
        actor,
        category: 'karute',
        targetId: 'kar-1',
        door: 'karute.test_write',
        // Reserved keys, cast through `as never` to get past the closed type.
        detail: { door: 'spoofed.door', record_store_id: 'spoofed-store', code: 'spoofed_code' } as never,
      },
    )).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: { door: 'karute.test_write', record_store_id: 'store-B', code: 'not_found' },
    }))
  })

  it('a detail trying to carry door, record_store_id or code cannot override auditStoreWriteRefused\'s own values, called directly', () => {
    auditStoreWriteRefused({
      actor,
      category: 'karute',
      targetId: 'kar-1',
      door: 'karute.test_write',
      recordStoreId: 'store-B',
      code: 'not_found',
      // Reserved keys, cast through `as never` to get past the closed type.
      detail: { door: 'spoofed.door', record_store_id: 'spoofed-store', code: 'spoofed_code' } as never,
    })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      detail: { door: 'karute.test_write', record_store_id: 'store-B', code: 'not_found' },
    }))
  })
})

jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))

import { audit } from '@/lib/audit'
import { ensureRecordStoreInScopeAudited } from '@/lib/audit-store-lock'

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
          detail: { customer_id: 'cust-1', recording_session_id: 'rec-1' },
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
})

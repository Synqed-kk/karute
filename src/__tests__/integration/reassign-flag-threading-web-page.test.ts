/**
 * F4 §5 pin 8b — staffCanReassignRecords flag threading, the web-page half:
 * KaruteDetailPage resolves it from can('records.reassign') and hands it to
 * buildKaruteDetailScreen. The pure chokepoint proof (buildKaruteDetailScreen
 * itself) is reassign-flag-threading.test.ts; the facade-GET half is pinned
 * in app-api-karute-detail-screen.test.ts (same capability toggle, same
 * assertion, against ctx.identity.capabilities.has()).
 */
jest.mock('next/navigation', () => ({ notFound: jest.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'user-1'),
}))
jest.mock('@/lib/supabase/karute', () => ({
  getKaruteRecord: jest.fn(async (id: string) => ({ id, client_id: 'cust-9', summary: null })),
}))
jest.mock('@/lib/karute/outcome', () => ({ getKaruteOutcome: jest.fn(async () => null) }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(async () => ({})) }))
jest.mock('@/lib/synqed/staff-map', () => ({
  lookupProfileIdForSynqedStaffId: jest.fn(async () => null),
}))
// Capability-aware, unlike the blanket-false mock in karute-view-audit.test.ts
// — this is the whole point of this test: distinguish 'records.reassign'
// from every other capability the page also resolves.
const grantedCaps = { current: new Set<string>() }
jest.mock('@/lib/auth/require-permission', () => ({
  can: jest.fn(async (cap: string) => grantedCaps.current.has(cap)),
}))
jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomers: jest.fn(async () => ({ customers: [] })),
}))
jest.mock('@/lib/customers/queries', () => ({ getCustomer: jest.fn(async () => null) }))
jest.mock('@/lib/customers/customer-detail-cached', () => ({
  getCustomerContact: jest.fn(async () => null),
  getCachedCustomerConsent: jest.fn(async () => ({ consent: null })),
}))
jest.mock('@/components/karute/redesign/detail/KaruteDetailView', () => ({ KaruteDetailView: () => null }))
jest.mock('@/components/karute/redesign/detail/PhotoRecordsServer', () => ({ PhotoRecordsServer: () => null }))
jest.mock('@/components/karute/redesign/detail/AiInsightSlots', () => ({
  AIBodyPredictionSlot: () => null,
  AISuggestedMessageSlot: () => null,
}))
jest.mock('@/components/customers/redesign/profile/UpcomingAiFeatures', () => ({
  AIBodyPredictionPreview: () => null,
  AIOutreachPreview: () => null,
}))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => undefined) }))

const buildSpy = jest.fn((_args: unknown) => ({
  karuteId: 'k-1',
  customerId: null,
  transcript: null,
  header: { customerName: 'テスト 太郎' },
  summary: null,
}))
jest.mock('@/lib/karute/detail-screen', () => ({ buildKaruteDetailScreen: (args: unknown) => buildSpy(args) }))

import KaruteDetailPage from '@/app/[locale]/(app)/karute/[id]/page'

beforeEach(() => {
  jest.clearAllMocks()
  buildSpy.mockReturnValue({
    karuteId: 'k-1',
    customerId: null,
    transcript: null,
    header: { customerName: 'テスト 太郎' },
    summary: null,
  })
  grantedCaps.current = new Set()
})

describe('KaruteDetailPage — staffCanReassignRecords (pin 8b, web half)', () => {
  it('resolves false when the caller lacks records.reassign, threaded to buildKaruteDetailScreen', async () => {
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ staffCanReassignRecords: false }),
    )
  })

  it('resolves true when the caller holds records.reassign — distinguished from recordings.viewAll', async () => {
    grantedCaps.current = new Set(['records.reassign'])
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ staffCanReassignRecords: true, canViewAllRecordings: false }),
    )
  })
})

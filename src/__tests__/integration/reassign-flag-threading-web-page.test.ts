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
const karuteRow = { current: { client_id: 'cust-9', summary: null } as Record<string, unknown> }
jest.mock('@/lib/supabase/karute', () => ({
  getKaruteRecord: jest.fn(async (id: string) => ({ id, ...karuteRow.current })),
}))
jest.mock('@/lib/karute/outcome', () => ({ getKaruteOutcome: jest.fn(async () => null) }))
// Slice ①: the page reads the recording behind the karute for the player's
// presence. `recordings.get` only fires when the karute carries a session id.
const recordingsGet = jest.fn(async () => ({
  id: 'sess-1',
  audio_storage_path: 'app_biz-1_11111111-1111-4111-8111-111111111111.mp4',
  duration_seconds: 90,
  status: 'COMPLETED',
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ recordings: { get: () => recordingsGet() } })),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  lookupProfileIdForSynqedStaffId: jest.fn(async () => null),
}))
// Capability-aware, unlike the blanket-false mock in karute-view-audit.test.ts
// — this is the whole point of this test: distinguish 'records.reassign'
// from every other capability the page also resolves.
const grantedCaps = { current: new Set<string>() }
const canMock = jest.fn(async (cap: string) => grantedCaps.current.has(cap))
jest.mock('@/lib/auth/require-permission', () => ({
  can: (cap: string) => canMock(cap),
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
  karuteRow.current = { client_id: 'cust-9', summary: null }
  recordingsGet.mockResolvedValue({
    id: 'sess-1',
    audio_storage_path: 'app_biz-1_11111111-1111-4111-8111-111111111111.mp4',
    duration_seconds: 90,
    status: 'COMPLETED',
  })
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

// Slice ① (the player), web half: the page resolves the playback inputs and
// hands them to the SAME chokepoint. The facade half is pinned in
// app-api-karute-detail-screen.test.ts.
describe('KaruteDetailPage — playback inputs (businessId · recordingRow)', () => {
  it('businessId is the cookie tenant, and a plain staffer gets no viewAll', async () => {
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ canViewAllRecordings: false, businessId: 'biz-1' }),
    )
  })

  // ⚠ FIX ROUND 2 — business.manage is grantable to a manager; it must not
  // become a second door onto other staff's audio. The page must not even READ
  // it for this purpose.
  it('business.manage alone reaches nothing — it is not read, and viewAll stays false', async () => {
    grantedCaps.current = new Set(['business.manage'])
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ canViewAllRecordings: false }),
    )
    expect(canMock).not.toHaveBeenCalledWith('business.manage')
  })

  it('recordings.viewAll — the whole owner floor — is what the builder receives', async () => {
    grantedCaps.current = new Set(['recordings.viewAll'])
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ canViewAllRecordings: true }),
    )
  })

  it('no recording_session_id → recordingRow null and the row is never read', async () => {
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(recordingsGet).not.toHaveBeenCalled()
    expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({ recordingRow: null }))
  })

  it('a session id threads the fetched row through', async () => {
    karuteRow.current = { client_id: 'cust-9', summary: null, recording_session_id: 'sess-1' }
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(recordingsGet).toHaveBeenCalledTimes(1)
    expect(buildSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingRow: expect.objectContaining({ duration_seconds: 90, status: 'COMPLETED' }),
      }),
    )
  })

  // D-8: an accessory read that blipped must cost the player, never the page.
  it('a failed recordings.get degrades to recordingRow null and the page still renders', async () => {
    karuteRow.current = { client_id: 'cust-9', summary: null, recording_session_id: 'sess-1' }
    recordingsGet.mockRejectedValue(new Error('boom'))
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({ recordingRow: null }))
  })
})

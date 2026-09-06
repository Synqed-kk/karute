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
  // The page also resolves the whole SET, for the 再生成 ACT gate (fix round 4,
  // holdsOwnerKeys). Driven by the same handle, so a test grants once.
  getMyCapabilities: jest.fn(async () => grantedCaps.current),
}))
// The page's store primitive (⚖ 8/17 store isolation). Default: unrestricted.
const storeScope = {
  current: {
    storeId: null as string | null,
    viewAll: true,
    allowedStoreIds: null as string[] | null,
    degraded: false,
  },
}
const storeScopeThrows = { current: false }
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => {
    if (storeScopeThrows.current) throw new Error('store scope read failed')
    return storeScope.current
  }),
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
import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'

/** Render the page and return the props it handed KaruteDetailView. The page
 *  is an async server component: it RETURNS an element tree, so the tree is the
 *  honest place to read the hop from — no DOM, no client runtime. */
async function viewPropsFromPage(): Promise<Record<string, unknown>> {
  const tree = await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
  const found: Record<string, unknown>[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const el = node as { type?: unknown; props?: Record<string, unknown> }
    if (el.type === KaruteDetailView && el.props) found.push(el.props)
    if (el.props) walk(el.props.children)
  }
  walk(tree)
  if (found.length !== 1) throw new Error(`expected ONE KaruteDetailView, found ${found.length}`)
  return found[0]
}

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
  storeScope.current = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
  storeScopeThrows.current = false
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

  // ⚠ THE HOP (F12). The blind lens deleted this line and 9,706 tests stayed
  // green — the player would never appear on the web door and nothing noticed.
  // The page is an async server component, so its OWN OUTPUT is what is read:
  // the element it hands the view, not a render of it.
  it('the page hands the builder’s `recording` to the view — the web door’s last hop', async () => {
    buildSpy.mockReturnValue({
      karuteId: 'k-1',
      customerId: null,
      transcript: null,
      header: { customerName: 'テスト 太郎' },
      summary: null,
      recording: { audioPresent: true, durationSeconds: 742, status: 'COMPLETED' },
    } as never)
    const props = await viewPropsFromPage()
    expect(props.recording).toEqual({
      audioPresent: true,
      durationSeconds: 742,
      status: 'COMPLETED',
    })
    // …and the id the mint is called with rides the same hop.
    expect(props.karuteId).toBe('k-1')
  })

  it('…and a null recording arrives as null, never dropped to undefined', async () => {
    buildSpy.mockReturnValue({
      karuteId: 'k-1',
      customerId: null,
      transcript: null,
      header: { customerName: 'テスト 太郎' },
      summary: null,
      recording: null,
    } as never)
    expect((await viewPropsFromPage()).recording).toBeNull()
  })

  // D-8: an accessory read that blipped must cost the player, never the page.
  it('a failed recordings.get degrades to recordingRow null and the page still renders', async () => {
    karuteRow.current = { client_id: 'cust-9', summary: null, recording_session_id: 'sess-1' }
    recordingsGet.mockRejectedValue(new Error('boom'))
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({ recordingRow: null }))
  })
})

// ── ⚖ STORE REACH, WEB HALF (Liam's store-isolation law 8/17; Greptile #848
// point 2). The grant widens WHOSE recordings, never WHICH stores — the page
// resolves the viewer's assignment and hands the builder the NARROWED flag.
// The facade half is pinned in app-api-karute-detail-screen.test.ts.
describe('KaruteDetailPage — the named grant stays inside the viewer’s stores', () => {
  const inStoreB = () => {
    karuteRow.current = { client_id: 'cust-9', summary: null, store_id: 'store-b' }
  }
  const built = () => buildSpy.mock.calls[0][0] as { canViewAllRecordings: boolean }

  it('a grantee assigned ELSEWHERE gets canViewAllRecordings false', async () => {
    inStoreB()
    grantedCaps.current = new Set(['recordings.viewAll'])
    storeScope.current = { storeId: 'store-a', viewAll: false, allowedStoreIds: ['store-a'], degraded: false }
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(built().canViewAllRecordings).toBe(false)
  })

  it('…and the SAME grantee assigned to store-b gets true', async () => {
    inStoreB()
    grantedCaps.current = new Set(['recordings.viewAll'])
    storeScope.current = { storeId: 'store-b', viewAll: false, allowedStoreIds: ['store-b'], degraded: false }
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(built().canViewAllRecordings).toBe(true)
  })

  it('an unrestricted scope (stores.viewAll / floating) reads any store', async () => {
    inStoreB()
    grantedCaps.current = new Set(['recordings.viewAll'])
    storeScope.current = { storeId: null, viewAll: true, allowedStoreIds: null, degraded: false }
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(built().canViewAllRecordings).toBe(true)
  })

  it('a DEGRADED scope fails the grant closed', async () => {
    inStoreB()
    grantedCaps.current = new Set(['recordings.viewAll'])
    storeScope.current = { storeId: null, viewAll: false, allowedStoreIds: null, degraded: true }
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(built().canViewAllRecordings).toBe(false)
  })

  it('a THROWN scope read fails closed and the PAGE still renders', async () => {
    inStoreB()
    grantedCaps.current = new Set(['recordings.viewAll'])
    storeScopeThrows.current = true
    const props = await viewPropsFromPage()
    expect(props).toBeDefined()
    expect(built().canViewAllRecordings).toBe(false)
  })

  it('a record with NO store is read by a clamped grantee (全店舗 / legacy)', async () => {
    grantedCaps.current = new Set(['recordings.viewAll'])
    storeScope.current = { storeId: 'store-a', viewAll: false, allowedStoreIds: ['store-a'], degraded: false }
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(built().canViewAllRecordings).toBe(true)
  })
})

// ── ⚖ 再生成 — the WEB page hands the builder the SERVER'S answer (fix round 4)
// The READ is `recordings.viewAll`; the ACT is the owner's two keys. A named
// grantee reads a colleague's words and must NOT be shown a button the server
// will refuse (blind round 2 F2 / L4 F2).
describe('KaruteDetailPage — staffCanRegenerate (hide, never show-and-refuse)', () => {
  const built = () => buildSpy.mock.calls[0][0] as { staffCanRegenerate: boolean }
  const colleaguesKarute = () => {
    karuteRow.current = { client_id: 'cust-9', summary: null, staff_profile_id: 'other-staff' }
  }

  it('a NAMED GRANTEE (recordings.viewAll alone) on a colleague’s karute → false', async () => {
    colleaguesKarute()
    grantedCaps.current = new Set(['recordings.viewAll'])
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(built().staffCanRegenerate).toBe(false)
  })

  it('…and the OWNER’S HAND (both keys) on the same karute → true', async () => {
    colleaguesKarute()
    grantedCaps.current = new Set(['recordings.viewAll', 'business.manage'])
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(built().staffCanRegenerate).toBe(true)
  })

  it('the RECORDER keeps her own button with no keys at all', async () => {
    karuteRow.current = { client_id: 'cust-9', summary: null, staff_profile_id: 'staff-1' }
    grantedCaps.current = new Set()
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(built().staffCanRegenerate).toBe(true)
  })

  it('a plain staffer on a colleague’s karute → false (unchanged from main)', async () => {
    colleaguesKarute()
    grantedCaps.current = new Set()
    await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
    expect(built().staffCanRegenerate).toBe(false)
  })
})

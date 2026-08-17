// Settings screen facade GET (design-parity packet 12 §S1). Pins: missing
// Bearer → 401, no reads · missing capability → 403, no reads · store-id
// outside a clamped staff's assignment → 403 store_forbidden · isOwner
// derives from the self row keyed by the CONFIRMED authUserId (never the
// first roster row), literal 'owner' match (no case-folding — page.tsx's own
// comparison) · canViewAllStores/canManageStaff/canInviteStaff/canViewAudit
// derive from ctx.identity.capabilities (+ isOwner for canViewAudit) ·
// ?tab=audit only passes through with the canViewAudit grant, else null ·
// initialActiveStoreId reflects the store clamp's resolved storeId ·
// activeStaffId is roster-gated (web parity: getCurrentUserStaffId) — the
// auth id only when its row is present in the DTO's staff roster, else null
// · orgSettings.voice_enrollments is per-staff scoped (design-parity packet
// 12 §S4b — un-zeroed from the S1 placeholder): a staff.manage identity sees
// every entry, everyone else sees ONLY their own row · a failed load-bearing
// read (staff roster / org settings) →
// 502 · initialStores/initialEntitlement populate for a stores.viewAll
// identity via the SAME WithClient twins the web action delegates to, and
// stay []/null for everyone else (packet 12 §B-3 S2, least-privilege — the
// 店舗 tab is hidden without that grant) · a stores-read failure still 200s
// with initialStores: [] (web's own page.tsx:38 tolerance, mirrored here).
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))

const fullOrgSettings = () => ({
  id: 'business-1',
  salon_name: 'テストサロン',
  business_type: 'salon',
  webhook_url: '',
  ai_model: 'gpt-4o-mini',
  confidence_threshold: 0.7,
  audio_quality: 'standard',
  auto_stop_minutes: 30,
  operating_hours: {
    mon: { openMinute: 600, closeMinute: 1200 },
    tue: { openMinute: 600, closeMinute: 1200 },
    wed: { openMinute: 600, closeMinute: 1200 },
    thu: { openMinute: 600, closeMinute: 1200 },
    fri: { openMinute: 600, closeMinute: 1200 },
    sat: { openMinute: 600, closeMinute: 1200 },
    sun: { openMinute: 600, closeMinute: 1200 },
  },
  theme_colors: {},
  recording_disclosure_mode: 'B' as const,
  recording_disclosure_privacy_confirmed: false,
  setup_completed_at: null,
  timezone: 'Asia/Tokyo',
  solo_mode: false,
  ai_auto_summary: true,
  ai_auto_outreach: false,
  ai_voice_style: 'polite' as const,
  audio_source: 'phone' as const,
  noise_suppression: true,
  speaker_diarization: true,
  voice_recognition_improved: false,
  recording_consent_required: false,
  recording_consent_template: '',
  pack_presets: [],
  voice_enrollments: {},
  staff_can_customize_packs: true,
  ticket_packs_enabled: true,
  pack_burn_mode: 'manual' as const,
  coaching_enabled: false,
})

const staffListByBusinessOrThrow = jest.fn(async (..._a: unknown[]) => [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist', has_pin: true, created_at: '2026-01-01' },
  { id: 'staff-2', full_name: 'Someone Else', display_role: 'stylist', has_pin: false, created_at: '2026-01-01', unlinked: true },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: (...a: unknown[]) => staffListByBusinessOrThrow(...a),
}))

const mockCapabilities = jest.fn(async () => new Set(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const orgSettingsWithClient = jest.fn(async (..._a: unknown[]) => fullOrgSettings())
jest.mock('@/actions/org-settings', () => ({
  orgSettingsWithClient: (...a: unknown[]) => orgSettingsWithClient(...a),
}))

const staffStoresGet = jest.fn(async () => ({ store_ids: [] as string[] }))
const storesGet = jest.fn(async () => ({}))
const storesList = jest.fn(async () => ({ stores: [] as Record<string, unknown>[] }))
const staffStoresCounts = jest.fn(async () => ({ counts: {} as Record<string, number> }))
const customersCountsByStore = jest.fn(async () => ({ counts: {} as Record<string, number> }))
const entitlementsGet = jest.fn(async () => ({ tier: 'free', is_unlimited: false }))
const syncGetConfig = jest.fn(async () => null as Record<string, unknown> | null)
const fakeClient = {
  stores: { get: storesGet, list: storesList },
  staffStores: { get: staffStoresGet, counts: staffStoresCounts },
  customers: { countsByStore: customersCountsByStore },
  entitlements: { get: entitlementsGet },
  sync: { getConfig: syncGetConfig },
}
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET } from '@/app/api/app/v1/screens/settings/route'
import { SettingsScreenDTO } from '@/lib/app-api/settings-screen-dto'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: 'auth-user-1',
    iss: ISSUER,
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
    ...overrides,
  })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const route = { params: Promise.resolve({}) }
const req = (
  path = 'https://s/api/app/v1/screens/settings',
  headers: Record<string, string> = {},
  token = bearer(),
) => new Request(path, { headers: { authorization: `Bearer ${token}`, ...headers } })

async function dtoOf(res: Response) {
  const body = await res.json()
  return SettingsScreenDTO.parse(body.data ?? body)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  staffListByBusinessOrThrow.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist', has_pin: true, created_at: '2026-01-01' },
    { id: 'staff-2', full_name: 'Someone Else', display_role: 'stylist', has_pin: false, created_at: '2026-01-01', unlinked: true },
  ])
  orgSettingsWithClient.mockResolvedValue(fullOrgSettings())
  staffStoresGet.mockResolvedValue({ store_ids: [] })
  storesGet.mockResolvedValue({})
  storesList.mockResolvedValue({ stores: [] })
  staffStoresCounts.mockResolvedValue({ counts: {} })
  customersCountsByStore.mockResolvedValue({ counts: {} })
  entitlementsGet.mockResolvedValue({ tier: 'free', is_unlimited: false })
  syncGetConfig.mockResolvedValue(null)
  delete process.env.KARUTE_BILLING_ENFORCEMENT
})

describe('GET /api/app/v1/screens/settings', () => {
  it('missing Bearer → 401, no reads', async () => {
    const res = await GET(new Request('https://s/api/app/v1/screens/settings'), route)
    expect(res.status).toBe(401)
    expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no reads', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await GET(req(), route)
    expect(res.status).toBe(403)
    expect(newSynqedClient).not.toHaveBeenCalled()
    expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
  })

  it('store-id outside a clamped assignment → 403 store_forbidden, no reads', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: ['store-A'] })
    const res = await GET(req('https://s/api/app/v1/screens/settings', { 'store-id': 'store-B' }), route)
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('store_forbidden')
    expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
  })

  it('happy path (non-owner, no grants) → 200, capability-derived flags all false, real self row, client + roster scoped to the resolved businessId', async () => {
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    expect(staffListByBusinessOrThrow).toHaveBeenCalledWith('business-1')
    const dto = await dtoOf(res)
    expect(dto.isOwner).toBe(false)
    expect(dto.canViewAllStores).toBe(false)
    expect(dto.canManageStaff).toBe(false)
    expect(dto.canInviteStaff).toBe(false)
    expect(dto.canViewAudit).toBe(false)
    expect(dto.canManageMenus).toBe(false)
    // Roster-gated: auth-user-1 IS present in the default roster (beforeEach).
    expect(dto.activeStaffId).toBe('auth-user-1')
    expect(dto.staffList).toHaveLength(2)
    // The unlinked flag survives DTO validation (zod strips unknown keys —
    // a schema omission here silently reverts the shell to fetch-and-fail).
    expect(dto.staffList.find((s: { id: string }) => s.id === 'staff-2')?.unlinked).toBe(true)
    expect(dto.staffList.find((s: { id: string }) => s.id === 'auth-user-1')?.unlinked).toBeUndefined()
    expect(dto.orgSettings?.salon_name).toBe('テストサロン')
  })

  it('activeStaffId is null when the authenticated id is absent from the DTO staff roster (roster gate)', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'staff-2', full_name: 'Someone Else', display_role: 'stylist', has_pin: false, created_at: '2026-01-01' },
    ])
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.activeStaffId).toBeNull()
  })

  it('voice_enrollments is clamped to the caller\'s OWN entry without staff.manage (self-scope pin)', async () => {
    orgSettingsWithClient.mockResolvedValue({
      ...fullOrgSettings(),
      voice_enrollments: {
        'auth-user-1': { consent_at: '2026-01-01', sample_path: 'p1', status: 'saved' as const },
        'staff-2': { consent_at: '2026-01-02', sample_path: 'p2', status: 'saved' as const },
      },
    })
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.orgSettings?.voice_enrollments).toEqual({
      'auth-user-1': { consent_at: '2026-01-01', sample_path: 'p1', status: 'saved' },
    })
  })

  it('voice_enrollments carries EVERY staff entry for a staff.manage identity (manage-scope pin)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'staff.manage']))
    orgSettingsWithClient.mockResolvedValue({
      ...fullOrgSettings(),
      voice_enrollments: {
        'auth-user-1': { consent_at: '2026-01-01', sample_path: 'p1', status: 'saved' as const },
        'staff-2': { consent_at: '2026-01-02', sample_path: 'p2', status: 'saved' as const },
      },
    })
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.orgSettings?.voice_enrollments).toEqual({
      'auth-user-1': { consent_at: '2026-01-01', sample_path: 'p1', status: 'saved' },
      'staff-2': { consent_at: '2026-01-02', sample_path: 'p2', status: 'saved' },
    })
  })

  it('voice_enrollments is {} without staff.manage when the caller has no entry of their own', async () => {
    orgSettingsWithClient.mockResolvedValue({
      ...fullOrgSettings(),
      voice_enrollments: {
        'staff-2': { consent_at: '2026-01-02', sample_path: 'p2', status: 'saved' as const },
      },
    })
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.orgSettings?.voice_enrollments).toEqual({})
  })

  it('self row selected by authUserId, not the first roster row', async () => {
    // auth-user-1 is SECOND in the roster — proves the isOwner lookup is
    // keyed by id, not list order.
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'staff-2', full_name: 'Someone Else', display_role: 'stylist', has_pin: false, created_at: '2026-01-01' },
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner', has_pin: true, created_at: '2026-01-01' },
    ])
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.isOwner).toBe(true)
  })

  it('capabilities → canViewAllStores/canManageStaff/canInviteStaff/canViewAudit true when granted', async () => {
    mockCapabilities.mockResolvedValue(
      new Set(['customers.view', 'stores.viewAll', 'staff.manage', 'staff.invite', 'audit.view']),
    )
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.canViewAllStores).toBe(true)
    expect(dto.canManageStaff).toBe(true)
    expect(dto.canInviteStaff).toBe(true)
    expect(dto.canViewAudit).toBe(true)
  })

  it('canManageMenus is the BARE menus.manage grant — true with it, and NOT owner-widened without it (web page.tsx parity)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'menus.manage']))
    expect((await dtoOf(await GET(req(), route))).canManageMenus).toBe(true)

    // Owner roster, no grant: unlike canViewAudit/canViewSync there is no
    // owner fallback — every role that should manage menus already holds the
    // capability through its preset.
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner', has_pin: true, created_at: '2026-01-01' },
    ])
    const dto = await dtoOf(await GET(req(), route))
    expect(dto.isOwner).toBe(true)
    expect(dto.canManageMenus).toBe(false)
  })

  it('canViewAudit is true for an owner even without the explicit audit.view grant', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner', has_pin: true, created_at: '2026-01-01' },
    ])
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.canViewAudit).toBe(true)
  })

  it('?tab=audit passes through to initialTab only WITH the canViewAudit grant', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'audit.view']))
    const res = await GET(req('https://s/api/app/v1/screens/settings?tab=audit&target=cust-1'), route)
    const dto = await dtoOf(res)
    expect(dto.initialTab).toBe('audit')
    expect(dto.auditTargetId).toBe('cust-1')
  })

  it('?tab=audit is dropped to null WITHOUT the canViewAudit grant (web parity)', async () => {
    const res = await GET(req('https://s/api/app/v1/screens/settings?tab=audit&target=cust-1'), route)
    const dto = await dtoOf(res)
    expect(dto.initialTab).toBeNull()
    expect(dto.auditTargetId).toBeNull()
  })

  it('an unrecognized ?tab= value falls through to null (page.tsx only ever honors audit)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'audit.view']))
    const res = await GET(req('https://s/api/app/v1/screens/settings?tab=organization'), route)
    const dto = await dtoOf(res)
    expect(dto.initialTab).toBeNull()
  })

  it('initialActiveStoreId reflects the store clamp — a cross-store viewer keeps the requested store-id', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'stores.viewAll']))
    const res = await GET(req('https://s/api/app/v1/screens/settings', { 'store-id': 'store-A' }), route)
    const dto = await dtoOf(res)
    expect(dto.initialActiveStoreId).toBe('store-A')
  })

  it('a failed load-bearing read (staff roster) → 502', async () => {
    staffListByBusinessOrThrow.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })

  it('a failed load-bearing read (org settings) → 502', async () => {
    orgSettingsWithClient.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
  })

  it('initialStores/initialEntitlement populate for a stores.viewAll identity (packet 12 §B-3 S2)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'stores.viewAll']))
    storesList.mockResolvedValue({
      stores: [
        { id: 'store-A', name: '代官山', address: null, phone: null, is_primary: true, active: true },
      ],
    })
    entitlementsGet.mockResolvedValue({ tier: 'professional', is_unlimited: true })
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.initialStores).toEqual([
      {
        id: 'store-A',
        name: '代官山',
        address: null,
        phone: null,
        isPrimary: true,
        active: true,
        staffCount: 0,
        customerCount: 0,
        businessType: null,
      },
    ])
    expect(dto.initialEntitlement).toMatchObject({ tier: 'professional', isUnlimited: true })
  })

  it('initialStores: [] / initialEntitlement: null for a non-viewAll identity (least-privilege pin) — no read triggered', async () => {
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.initialStores).toEqual([])
    expect(dto.initialEntitlement).toBeNull()
    expect(storesList).not.toHaveBeenCalled()
    expect(entitlementsGet).not.toHaveBeenCalled()
  })

  it('a stores-read failure still 200s with initialStores: [] (web page.tsx:38 tolerance, mirrored)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'stores.viewAll']))
    storesList.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.initialStores).toEqual([])
  })

  it("an entitlement-read failure still 200s with the TWIN's own degraded shape, not null — loadEntitlementWithClient swallows the read internally", async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'stores.viewAll']))
    entitlementsGet.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.initialEntitlement).toMatchObject({ tier: 'free', degraded: true })
  })
})

// 予約同期 status card (Liam ruling 7/24, packet 31): least-privilege read —
// no grant → syncStatus: null AND getConfig is never called at all; a grant
// (owner OR explicit sync.view) → the real fields; a getConfig throw →
// syncStatus: null WITHOUT 502ing the rest of the screen (soft-fail, this
// read is a read-only extra, not load-bearing like staff/org-settings).
describe('GET /api/app/v1/screens/settings — sync.view (packet 31)', () => {
  it('no grant → syncStatus: null, getConfig never called', async () => {
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.syncStatus).toBeNull()
    expect(syncGetConfig).not.toHaveBeenCalled()
  })

  it('owner → syncStatus fields populate from the real config, even without an explicit sync.view grant', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner', has_pin: true, created_at: '2026-01-01' },
    ])
    syncGetConfig.mockResolvedValue({
      username: 'should-never-leave-core',
      enabled: true,
      last_run_at: '2026-07-24T03:00:00.000Z',
      last_run_status: 'OK',
      last_run_error: null,
    })
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.syncStatus).toEqual({
      enabled: true,
      lastRunAt: '2026-07-24T03:00:00.000Z',
      lastRunStatus: 'OK',
      lastRunError: null,
    })
    // Least-data: username never rides the DTO out, even though the client mock returns it.
    expect(JSON.stringify(dto.syncStatus)).not.toContain('should-never-leave-core')
  })

  it('explicit sync.view grant (non-owner) → syncStatus populates', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'sync.view']))
    syncGetConfig.mockResolvedValue({
      enabled: false,
      last_run_at: null,
      last_run_status: null,
      last_run_error: null,
    })
    const res = await GET(req(), route)
    const dto = await dtoOf(res)
    expect(dto.syncStatus).toEqual({
      enabled: false,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
    })
  })

  it('getConfig throws → syncStatus: null, screen still 200 (soft-fail pin)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'sync.view']))
    syncGetConfig.mockRejectedValueOnce(new Error('core down'))
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.syncStatus).toBeNull()
  })

  it('getConfig resolves null (no config saved yet) → syncStatus: null, screen still 200', async () => {
    mockCapabilities.mockResolvedValue(new Set(['customers.view', 'sync.view']))
    syncGetConfig.mockResolvedValue(null)
    const res = await GET(req(), route)
    expect(res.status).toBe(200)
    const dto = await dtoOf(res)
    expect(dto.syncStatus).toBeNull()
  })
})

// serviceNoun skew tolerance (Greptile r1, PR #706): an older server predates
// the field and never sends it — the whole-screen DTO must still parse
// (RecordingSection's own `serviceNoun || t('autostartVisitFallback')` covers
// the missing-noun display). Schema-level pin, no route/mocks needed.
describe('SettingsScreenDTO — serviceNoun skew tolerance', () => {
  it('a response without serviceNoun still parses', () => {
    const skewed = {
      orgSettings: null,
      staffList: [],
      activeStaffId: null,
      isOwner: false,
      canViewAllStores: false,
      canManageStaff: false,
      canInviteStaff: false,
      canViewAudit: false,
      canViewSync: false,
      canManageMenus: false,
      syncStatus: null,
      initialTab: null,
      auditTargetId: null,
      initialActiveStoreId: null,
      initialStores: [],
      initialEntitlement: null,
      featureStaffInvites: false,
      featureMultiStore: false,
      // serviceNoun deliberately omitted — the pre-A4 server shape.
    }
    const dto = SettingsScreenDTO.parse(skewed)
    expect(dto.serviceNoun).toBeUndefined()
  })
})

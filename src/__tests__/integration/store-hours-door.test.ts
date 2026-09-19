// 1c-D — the store-hours door. Pins, in one file because the whole point of
// the design is that these hold identically on BOTH doors:
//   · ALWAYS SEVEN WEEKDAYS. A short week is refused with a typed error and
//     never sent — an absent weekday reads as 定休日 in resolveDayHours, so a
//     one-day save would close the store the other six.
//   · open before close. Same-day only; an overnight window is refused.
//   · OWNER-ONLY on the store write (isRosterOwner), while the SAME manager
//     identity — settings.manage, no owner role — IS allowed the business-wide
//     org write. Both pinned: per-store hours deliberately narrow what a
//     manager can change, and that asymmetry must not drift silently.
//   · `weekly_hours` is the ONLY policy field that leaves this app. The exact
//     SDK body is snapshotted.
//   · ONE storePolicies.list() per settings read, never one get() per store.
//   · Both doors call the SAME core, with the same argument.
//   · The DTO's weeklyHours key is ADDITIVE — skew both ways.
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

import { createHmac } from 'node:crypto'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))
// @synqed-kk/client is ESM (jest node20 can't parse it) — mocked at the seam,
// same as app-api-stores.test.ts.
jest.mock('@synqed-kk/client', () => ({
  // audit()'s durable sink builds its OWN client from this constructor (it must
  // not depend on the session lookup) — give it the seam so a successful save
  // exercises the real forward path instead of the emitter's never-break-the-
  // caller fallback.
  SynqedClient: jest.fn(() => ({ audit: { log: jest.fn(async () => ({ id: 'audit-row-1' })) } })),
  SynqedError: class extends Error {},
}))
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({ get: () => undefined, set: jest.fn(), delete: jest.fn() })),
}))

const mockCapabilities = jest.fn(async () => new Set(['stores.viewAll']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return {
    ...actual,
    capabilitiesForUser: () => mockCapabilities(),
    getMyCapabilities: () => mockCapabilities(),
  }
})

const roster = jest.fn(async () => [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: () => roster(),
  // Web-action identity seam — the SAME roster, so the two doors are compared
  // against one identity and nothing else can explain a divergence.
  getBusinessId: jest.fn(async () => 'business-1'),
  getStaffList: () => roster(),
  getCurrentUserStaffId: jest.fn(async () => 'auth-user-1'),
}))

// Typed by annotation, not by unused parameters — the call tuple is what the
// payload assertions below read.
const storePoliciesSet = jest.fn<Promise<unknown>, [string, Record<string, unknown>]>(
  async () => ({}),
)
const storePoliciesList = jest.fn(async () => ({
  policies: [] as Record<string, unknown>[],
}))
// The app audit row's BEFORE half (R1-3) — one read before the write.
const storePoliciesGet = jest.fn(async () => ({
  weekly_hours: null as Record<string, unknown> | null,
}))
const storesList = jest.fn(async () => ({ stores: [] as Record<string, unknown>[] }))
const staffStoresCounts = jest.fn(async () => ({ counts: {} as Record<string, number> }))
const customersCountsByStore = jest.fn(async () => ({ counts: {} as Record<string, number> }))
const orgSettingsGet = jest.fn(async () => ({
  business_id: 'business-1',
  name: 'テストサロン',
  settings: {} as Record<string, unknown>,
}))
const orgSettingsUpsert = jest.fn(async () => ({}))
const fakeClient = {
  stores: { list: storesList },
  staffStores: { counts: staffStoresCounts },
  customers: { countsByStore: customersCountsByStore },
  storePolicies: { list: storePoliciesList, get: storePoliciesGet, set: storePoliciesSet },
  orgSettings: { get: orgSettingsGet, upsert: orgSettingsUpsert },
}
const newSynqedClient = jest.fn(() => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => newSynqedClient(),
  getSynqedClient: jest.fn(async () => fakeClient),
}))

// The app roster / Supabase profile id, and core's OWN staff id for the SAME
// human. Deliberately different, exactly as on a real roster (every signed-up
// member has core `staff.user_id = <profile id>` and a different `staff.id`),
// so a payload carrying the profile id can never pass the payload pin below.
const PROFILE_ID = 'auth-user-1'
const CORE_STAFF_ID = 'core-staff-7f2a'
const resolveSynqedStaffId = jest.fn(async (profileId: string) => {
  if (profileId === PROFILE_ID) return CORE_STAFF_ID
  throw new Error('no synqed staff record')
})
const lookupSynqedStaffIdForBusiness = jest.fn<Promise<string | null>, [string, string]>(
  async (profileId) => (profileId === PROFILE_ID ? CORE_STAFF_ID : null),
)
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: (profileId: string) => resolveSynqedStaffId(profileId),
  lookupSynqedStaffIdForBusiness: (profileId: string, businessId: string) =>
    lookupSynqedStaffIdForBusiness(profileId, businessId),
}))

import { PATCH as hoursPATCH } from '@/app/api/app/v1/stores/[id]/hours/route'
import { setStoreHours, listStoresWithClient } from '@/actions/stores'
import {
  normalizeOperatingHours,
  resolveDayHours,
  type WeekdayKey,
} from '@/lib/operating-hours'
import { upsertOrgSettings } from '@/actions/org-settings'
import { StoreRowSchema } from '@/lib/app-api/settings-screen-dto'
import {
  STORE_HOURS_ACTOR_UNRESOLVED,
  STORE_HOURS_INVALID_WINDOW,
  STORE_HOURS_UNKNOWN_STORE,
  STORE_HOURS_WEEK_INCOMPLETE,
  STORE_OWNER_DENIAL,
} from '@/lib/validations/store'
import { auditLines } from './helpers/audit-lines'
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({
    sub: 'auth-user-1',
    iss: ISSUER,
    aud: 'authenticated',
    exp: now + 3600,
    iat: now,
  })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}` }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const patchReq = (weeklyHours: unknown) =>
  new Request('https://s/api/app/v1/stores/store-7/hours', {
    method: 'PATCH',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ weekly_hours: weeklyHours }),
  })

/** A complete, valid week: open every day, 火曜 定休日. */
const FULL_WEEK = {
  mon: { open: '10:00', close: '19:30' },
  tue: null,
  wed: { open: '10:00', close: '19:30' },
  thu: { open: '10:00', close: '19:30' },
  fri: { open: '10:00', close: '21:00' },
  sat: { open: '09:00', close: '18:00' },
  sun: { open: '09:00', close: '17:45' },
}

const MANAGER = [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'manager' },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['stores.viewAll']))
  roster.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
  ])
  storePoliciesSet.mockResolvedValue({})
  storePoliciesList.mockResolvedValue({ policies: [] })
  storePoliciesGet.mockResolvedValue({ weekly_hours: null })
  resolveSynqedStaffId.mockImplementation(async (profileId: string) => {
    if (profileId === PROFILE_ID) return CORE_STAFF_ID
    throw new Error('no synqed staff record')
  })
  lookupSynqedStaffIdForBusiness.mockImplementation(async (profileId) =>
    profileId === PROFILE_ID ? CORE_STAFF_ID : null,
  )
  // 'store-7' is the storeId every test in this file writes to — it must be a
  // KNOWN store of the caller's business, or the membership guard below
  // refuses every one of them before core is ever reached.
  storesList.mockResolvedValue({
    stores: [
      { id: 'store-7', name: 'Test store', address: null, phone: null, is_primary: true, active: true },
    ],
  })
  staffStoresCounts.mockResolvedValue({ counts: {} })
  customersCountsByStore.mockResolvedValue({ counts: {} })
  orgSettingsGet.mockResolvedValue({
    business_id: 'business-1',
    name: 'テストサロン',
    settings: {},
  })
})

describe('the seven-weekday invariant', () => {
  it('a six-day week is REFUSED and never sent — an absent weekday would read as 定休日', async () => {
    const sixDays: Record<string, unknown> = { ...FULL_WEEK }
    delete sixDays.tue
    const result = await setStoreHours('store-7', sixDays)
    expect(result).toEqual({ error: STORE_HOURS_WEEK_INCOMPLETE })
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })

  it('a ONE-day save — the shape that would close the store six days — is refused on the phone door too', async () => {
    const res = await hoursPATCH(patchReq({ mon: { open: '10:00', close: '19:00' } }), params('store-7'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: STORE_HOURS_WEEK_INCOMPLETE })
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })

  it('all seven present, every one 定休日, is a legitimate week (not a short save)', async () => {
    const allClosed = Object.fromEntries(
      Object.keys(FULL_WEEK).map((k) => [k, null]),
    )
    const result = await setStoreHours('store-7', allClosed)
    expect(result).toEqual({ ok: true })
    expect(storePoliciesSet.mock.calls[0][1]).toMatchObject({ weekly_hours: allClosed })
  })

  it('a body that is not an object at all is refused, not coerced', async () => {
    // `null` is NOT in this list: it is the reset (see the way-back describe).
    for (const bad of ['mon', 42, [], undefined]) {
      expect(await setStoreHours('store-7', bad)).toEqual({
        error: STORE_HOURS_WEEK_INCOMPLETE,
      })
    }
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })

  it('an EMPTY object is refused for its SHAPE — it is a short week, never a reset', async () => {
    // The resolver reads {} as "not configured" and so would never notice the
    // difference; the validator still refuses it, because the only two shapes
    // this door accepts are null and all seven weekdays.
    expect(await setStoreHours('store-7', {})).toEqual({
      error: STORE_HOURS_WEEK_INCOMPLETE,
    })
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })
})

describe('the way back — 全店共通の初期値に戻す (⚖ reversible by default)', () => {
  it('an explicit null clears the week through the SAME core, and nothing else', async () => {
    expect(await setStoreHours('store-7', null)).toEqual({ ok: true })
    const [storeId, body] = storePoliciesSet.mock.calls[0]
    expect(storeId).toBe('store-7')
    expect(body).toEqual({ weekly_hours: null, acting_staff_id: CORE_STAFF_ID })
  })

  it('the phone door resets identically', async () => {
    const res = await hoursPATCH(patchReq(null), params('store-7'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(storePoliciesSet.mock.calls[0][1]).toEqual({
      weekly_hours: null,
      acting_staff_id: CORE_STAFF_ID,
    })
  })

  it('it logs as its own act, not as an edit', async () => {
    storePoliciesGet.mockResolvedValue({ weekly_hours: FULL_WEEK })
    const lines = await auditLines(async () => {
      expect(await setStoreHours('store-7', null)).toEqual({ ok: true })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'settings.store_hours_reset' })
    const detail = (lines[0] as { detail: { before: string; after: string } }).detail
    expect(detail.before).toContain('mon=10:00-19:30')
    expect(detail.after).toBe('default')
  })

  it('a reset is owner-gated exactly like a save', async () => {
    roster.mockResolvedValue(MANAGER)
    mockCapabilities.mockResolvedValue(new Set(['stores.viewAll', 'settings.manage']))
    expect(await setStoreHours('store-7', null)).toEqual({ error: STORE_OWNER_DENIAL })
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })

  it('after the reset the resolver is back on the business-wide blob, not on a blacked-out week', () => {
    const orgHours = normalizeOperatingHours(null)
    const monday = new Date('2026-09-14T03:00:00.000Z') // JST Mon
    const fact = resolveDayHours({
      date: monday,
      weeklyHours: null,
      closedDates: new Set<string>(),
      orgHours,
      orgSaved: new Set<WeekdayKey>(['mon']),
    })
    expect(fact.closed).toBe(false)
    expect(fact.openMinute).toBe(orgHours.mon.openMinute)
    expect(fact.closeMinute).toBe(orgHours.mon.closeMinute)
  })
})

describe('open before close', () => {
  it('open === close is refused', async () => {
    const result = await setStoreHours('store-7', {
      ...FULL_WEEK,
      mon: { open: '10:00', close: '10:00' },
    })
    expect(result).toEqual({ error: STORE_HOURS_INVALID_WINDOW })
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })

  it('an overnight window (close before open) is refused honestly — the resolver cannot express it', async () => {
    const result = await setStoreHours('store-7', {
      ...FULL_WEEK,
      fri: { open: '20:00', close: '02:00' },
    })
    expect(result).toEqual({ error: STORE_HOURS_INVALID_WINDOW })
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })

  it('a malformed HH:MM is refused', async () => {
    for (const bad of [
      { open: '9:00', close: '19:00' },
      { open: '10:00', close: '24:00' },
      { open: '', close: '19:00' },
      { open: '25:00', close: '26:00' },
    ]) {
      expect(await setStoreHours('store-7', { ...FULL_WEEK, mon: bad })).toEqual({
        error: STORE_HOURS_INVALID_WINDOW,
      })
    }
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })

  it('ANY minute is accepted — no 30-minute step, no fixed list (⚖ no hardcoded durations)', async () => {
    const result = await setStoreHours('store-7', {
      ...FULL_WEEK,
      mon: { open: '10:07', close: '19:53' },
    })
    expect(result).toEqual({ ok: true })
    expect(storePoliciesSet.mock.calls[0][1].weekly_hours).toMatchObject({
      mon: { open: '10:07', close: '19:53' },
    })
  })
})

describe('owner-only on the store write, settings.manage on the org write', () => {
  it('a MANAGER holding settings.manage is REFUSED the per-store hours write (web door)', async () => {
    roster.mockResolvedValue(MANAGER)
    mockCapabilities.mockResolvedValue(new Set(['stores.viewAll', 'settings.manage']))
    expect(await setStoreHours('store-7', FULL_WEEK)).toEqual({ error: STORE_OWNER_DENIAL })
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })

  it('the SAME manager is refused on the phone door, as a 403 — not a soft 200', async () => {
    roster.mockResolvedValue(MANAGER)
    mockCapabilities.mockResolvedValue(new Set(['stores.viewAll', 'settings.manage']))
    const res = await hoursPATCH(patchReq(FULL_WEEK), params('store-7'))
    expect(res.status).toBe(403)
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })

  it('the SAME manager IS allowed the business-wide 組織 hours write — the asymmetry is deliberate', async () => {
    roster.mockResolvedValue(MANAGER)
    mockCapabilities.mockResolvedValue(new Set(['stores.viewAll', 'settings.manage']))
    const result = await upsertOrgSettings({
      operating_hours: {
        mon: { openMinute: 600, closeMinute: 1170 },
        tue: { openMinute: 600, closeMinute: 1170 },
        wed: { openMinute: 600, closeMinute: 1170 },
        thu: { openMinute: 600, closeMinute: 1170 },
        fri: { openMinute: 600, closeMinute: 1170 },
        sat: { openMinute: 540, closeMinute: 1080 },
        sun: { openMinute: 540, closeMinute: 1065 },
      },
    })
    expect(result).not.toHaveProperty('error')
    expect(orgSettingsUpsert).toHaveBeenCalled()
  })

  it('a stylist is refused, and a denied write emits no audit row', async () => {
    roster.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist' },
    ])
    const lines = await auditLines(async () => {
      expect(await setStoreHours('store-7', FULL_WEEK)).toEqual({ error: STORE_OWNER_DENIAL })
    })
    expect(lines).toHaveLength(0)
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })
})

// PKT-FIX-938 ROUND 1 B2 — a receipt-grade governance row must never carry a
// store id this business does not own (the same guard the locked 自動録音
// toggle carries, recording-autostart.ts). Checked AFTER the owner gate,
// BEFORE any storePolicies call.
describe('store membership — a storeId not owned by this business is refused', () => {
  it('a storeId not in stores.list() is refused on the web door; storePolicies is never touched, no audit row', async () => {
    const lines = await auditLines(async () => {
      expect(await setStoreHours('store-elsewhere', FULL_WEEK)).toEqual({
        error: STORE_HOURS_UNKNOWN_STORE,
      })
    })
    expect(storePoliciesGet).not.toHaveBeenCalled()
    expect(storePoliciesSet).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('the same storeId is refused on the phone door, the same way', async () => {
    const lines = await auditLines(async () => {
      const res = await hoursPATCH(patchReq(FULL_WEEK), params('store-elsewhere'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ error: STORE_HOURS_UNKNOWN_STORE })
    })
    expect(storePoliciesGet).not.toHaveBeenCalled()
    expect(storePoliciesSet).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it("an empty storeId is refused the same way; nothing is called", async () => {
    const lines = await auditLines(async () => {
      expect(await setStoreHours('', FULL_WEEK)).toEqual({ error: STORE_HOURS_UNKNOWN_STORE })
    })
    expect(storesList).not.toHaveBeenCalled()
    expect(storePoliciesGet).not.toHaveBeenCalled()
    expect(storePoliciesSet).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('the guard runs even for the reset (null) path — the same core, not a separate one', async () => {
    expect(await setStoreHours('store-elsewhere', null)).toEqual({
      error: STORE_HOURS_UNKNOWN_STORE,
    })
    expect(storePoliciesSet).not.toHaveBeenCalled()
  })
})

describe('the exact SDK payload', () => {
  it('sends weekly_hours + acting_staff_id and NOTHING else — no other policy field is re-sent', async () => {
    expect(await setStoreHours('store-7', FULL_WEEK)).toEqual({ ok: true })
    expect(storePoliciesSet).toHaveBeenCalledTimes(1)
    const [storeId, body] = storePoliciesSet.mock.calls[0]
    expect(storeId).toBe('store-7')
    // Snapshot the WHOLE body: a new key appearing here is a review decision,
    // never a silent one — re-sending a policy field this editor does not own
    // would clobber a setting nobody touched.
    expect(body).toEqual({
      weekly_hours: FULL_WEEK,
      // CORE's staff-id space — NOT the app's profile id. The two are
      // different ids for the same human on every real roster, and core
      // validates neither, so this pin is the only thing standing between a
      // customer-facing `updated_by` and an id that is not a core staff row.
      acting_staff_id: CORE_STAFF_ID,
    })
    expect(CORE_STAFF_ID).not.toBe(PROFILE_ID)
    expect(Object.keys(body).sort()).toEqual(['acting_staff_id', 'weekly_hours'])
  })

  it('keys beyond the seven weekdays are DROPPED, never forwarded to core', async () => {
    await setStoreHours('store-7', {
      ...FULL_WEEK,
      cutoff_minutes: 120,
      holiday: { open: '10:00', close: '11:00' },
    })
    const body = storePoliciesSet.mock.calls[0][1] as { weekly_hours: Record<string, unknown> }
    expect(Object.keys(body.weekly_hours as Record<string, unknown>).sort()).toEqual([
      'fri',
      'mon',
      'sat',
      'sun',
      'thu',
      'tue',
      'wed',
    ])
  })

  it('a successful save emits exactly one settings.store_hours_update row, carrying the week it changed', async () => {
    // Core writes its OWN store_policy.edit row with a full diff regardless
    // (measured 2026-09-16) — this row is the app log's, and it has to say
    // what changed or it is the poorer twin of a row staff cannot reach.
    storePoliciesGet.mockResolvedValue({
      weekly_hours: { ...FULL_WEEK, mon: { open: '09:00', close: '18:00' } },
    })
    const lines = await auditLines(async () => {
      expect(await setStoreHours('store-7', FULL_WEEK)).toEqual({ ok: true })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'settings.store_hours_update',
      target_id: 'store-7',
      source: 'web',
    })
    const detail = (lines[0] as { detail: { before: string; after: string } }).detail
    expect(detail.before).toContain('mon=09:00-18:00')
    expect(detail.after).toContain('mon=10:00-19:30')
    expect(detail.after).toContain('tue=closed')
    // ids and times only — never a store or staff name.
    expect(`${detail.before}${detail.after}`).not.toMatch(/[ぁ-んァ-ヶ一-龥]/)
  })

  it('a store with no week of its own reads as `default` in the BEFORE, not as an empty string', async () => {
    storePoliciesGet.mockResolvedValue({ weekly_hours: null })
    const lines = await auditLines(async () => {
      await setStoreHours('store-7', FULL_WEEK)
    })
    expect((lines[0] as { detail: { before: string } }).detail.before).toBe('default')
  })

  it('an unreadable BEFORE says so and never blocks the save', async () => {
    storePoliciesGet.mockRejectedValue(new Error('core down'))
    const lines = await auditLines(async () => {
      expect(await setStoreHours('store-7', FULL_WEEK)).toEqual({ ok: true })
    })
    expect(storePoliciesSet).toHaveBeenCalledTimes(1)
    expect((lines[0] as { detail: { before: string } }).detail.before).toBe('unavailable')
  })

  it('the phone door emits the same row with source: facade', async () => {
    const lines = await auditLines(async () => {
      const res = await hoursPATCH(patchReq(FULL_WEEK), params('store-7'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'settings.store_hours_update',
      target_id: 'store-7',
      source: 'facade',
    })
  })

  it('a core write rejection produces no audit row and a soft { error }', async () => {
    storePoliciesSet.mockRejectedValueOnce(new Error('not found'))
    const lines = await auditLines(async () => {
      const result = await setStoreHours('store-7', FULL_WEEK)
      expect('error' in result && result.error).toBeTruthy()
    })
    expect(lines).toHaveLength(0)
  })
})

describe('the acting id core is stamped with (CORE staff-id space, both doors)', () => {
  it('the web door sends the RESOLVED core staff id, never the profile id it checked the roster with', async () => {
    expect(await setStoreHours('store-7', FULL_WEEK)).toEqual({ ok: true })
    // R3-1: the web door resolves through the SAME non-creating lookup the
    // facade uses — never the creating resolveSynqedStaffId.
    expect(lookupSynqedStaffIdForBusiness).toHaveBeenCalledWith(PROFILE_ID, 'business-1')
    expect(resolveSynqedStaffId).not.toHaveBeenCalled()
    expect(storePoliciesSet.mock.calls[0][1].acting_staff_id).toBe(CORE_STAFF_ID)
  })

  it('the phone door resolves through the Bearer-safe twin, with the token business', async () => {
    const res = await hoursPATCH(patchReq(FULL_WEEK), params('store-7'))
    expect(res.status).toBe(200)
    expect(lookupSynqedStaffIdForBusiness).toHaveBeenCalledWith(PROFILE_ID, 'business-1')
    expect(storePoliciesSet.mock.calls[0][1].acting_staff_id).toBe(CORE_STAFF_ID)
  })

  it('UNRESOLVABLE on web → the save is REFUSED: nothing reaches core, no audit row', async () => {
    // R3-1: a profile with no core staff row is refused, never minted one —
    // the creating resolver must never even be reached from this door.
    lookupSynqedStaffIdForBusiness.mockResolvedValue(null)
    const lines = await auditLines(async () => {
      expect(await setStoreHours('store-7', FULL_WEEK)).toEqual({
        error: STORE_HOURS_ACTOR_UNRESOLVED,
      })
    })
    expect(storePoliciesSet).not.toHaveBeenCalled()
    expect(resolveSynqedStaffId).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('UNRESOLVABLE on the phone door → refused the same way, never a profile-id fallback', async () => {
    lookupSynqedStaffIdForBusiness.mockResolvedValue(null)
    const lines = await auditLines(async () => {
      const res = await hoursPATCH(patchReq(FULL_WEEK), params('store-7'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ error: STORE_HOURS_ACTOR_UNRESOLVED })
    })
    expect(storePoliciesSet).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it("the APP's own audit row keeps the PROFILE id — that table's actor space, unchanged", async () => {
    const lines = await auditLines(async () => {
      expect(await setStoreHours('store-7', FULL_WEEK)).toEqual({ ok: true })
    })
    expect(lines[0]).toMatchObject({ actor_id: PROFILE_ID })
    expect(storePoliciesSet.mock.calls[0][1].acting_staff_id).toBe(CORE_STAFF_ID)
  })
})

describe('both doors, one core', () => {
  it('the web action and the facade route hand the SDK the identical argument', async () => {
    await setStoreHours('store-7', FULL_WEEK)
    const viaWeb = storePoliciesSet.mock.calls[0]
    storePoliciesSet.mockClear()
    const res = await hoursPATCH(patchReq(FULL_WEEK), params('store-7'))
    expect(res.status).toBe(200)
    const viaFacade = storePoliciesSet.mock.calls[0]
    expect(viaFacade).toEqual(viaWeb)
  })
})

describe('the settings read', () => {
  it('asks core for store policies ONCE for the whole business, never once per store', async () => {
    storesList.mockResolvedValue({
      stores: [
        { id: 'store-A', name: 'A', address: null, phone: null, is_primary: true, active: true },
        { id: 'store-B', name: 'B', address: null, phone: null, is_primary: false, active: true },
        { id: 'store-C', name: 'C', address: null, phone: null, is_primary: false, active: true },
      ],
    })
    storePoliciesList.mockResolvedValue({
      policies: [
        { store_id: 'store-B', weekly_hours: FULL_WEEK },
        { store_id: 'store-C', weekly_hours: null },
      ],
    })
    const rows = await listStoresWithClient(fakeClient as never, 'business-1', {
      ensurePrimary: false,
      withHours: true,
    })
    expect(storePoliciesList).toHaveBeenCalledTimes(1)
    expect(rows.map((r) => r.weeklyHours)).toEqual([null, FULL_WEEK, null])
  })

  it('a read that did NOT ask for hours leaves them undefined — never null, which would read as "none configured"', async () => {
    storesList.mockResolvedValue({
      stores: [
        { id: 'store-A', name: 'A', address: null, phone: null, is_primary: true, active: true },
      ],
    })
    const rows = await listStoresWithClient(fakeClient as never, 'business-1', {
      ensurePrimary: false,
    })
    expect(storePoliciesList).not.toHaveBeenCalled()
    expect(rows[0].weeklyHours).toBeUndefined()
  })
})

describe('the 組織 label names the company-wide default', () => {
  // S4. Pinned as a CONTRACT, not as bytes: the exact wording is still going
  // through the native pass, but the 組織 tab's hours block must never go back
  // to the bare 「営業時間」 it carried before per-store hours existed — that
  // label claimed the whole business's hours were THE hours, and the 店舗 tab
  // can now disagree with it per store.
  const BARE_TITLE_BEFORE_1C_D = { ja: '営業時間', en: 'Hours of operation' }

  const CATALOGUE = { ja, en }

  it.each(['ja', 'en'] as const)(
    '%s: the 組織 title is qualified, and is not the per-store one',
    (locale) => {
      const settings = CATALOGUE[locale].settings
      expect(settings.hoursOfOperation).not.toBe(BARE_TITLE_BEFORE_1C_D[locale])
      expect(settings.hoursOfOperation).not.toBe(settings.stores.hours.title)
      expect(settings.hoursOfOperation.length).toBeGreaterThan(
        BARE_TITLE_BEFORE_1C_D[locale].length,
      )
    },
  )
})

describe('the DTO key is additive', () => {
  const BASE = {
    id: 'store-A',
    name: 'A',
    address: null,
    phone: null,
    isPrimary: true,
    active: true,
    staffCount: 0,
    customerCount: 0,
    businessType: null,
  }

  it('OLD SERVER → NEW CLIENT: a row with no weeklyHours key still parses, as null', () => {
    expect(StoreRowSchema.parse(BASE).weeklyHours).toBeNull()
  })

  it('NEW SERVER → NEW CLIENT: a real week round-trips', () => {
    expect(StoreRowSchema.parse({ ...BASE, weeklyHours: FULL_WEEK }).weeklyHours).toEqual(
      FULL_WEEK,
    )
  })

  it('an explicit null (never configured) is preserved, not defaulted away', () => {
    expect(StoreRowSchema.parse({ ...BASE, weeklyHours: null }).weeklyHours).toBeNull()
  })

  // R1-10 — the read shape validates HH:MM the way the write path does, and a
  // value that fails it degrades THIS FIELD to null rather than failing the
  // row (and with it the whole settings screen).
  it('a malformed window reads as null, with a warning, never a crash', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const row = StoreRowSchema.parse({
        ...BASE,
        weeklyHours: { ...FULL_WEEK, mon: { open: '9:00', close: '19:30' } },
      })
      expect(row.weeklyHours).toBeNull()
      expect(row.name).toBe('A') // the rest of the row survived
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('a value that is not a week at all degrades the same way', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(StoreRowSchema.parse({ ...BASE, weeklyHours: 42 }).weeklyHours).toBeNull()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('NEW SERVER → OLD CLIENT: the key is ignorable — no other field changed shape', () => {
    const rest: Record<string, unknown> = {
      ...StoreRowSchema.parse({ ...BASE, weeklyHours: FULL_WEEK }),
    }
    delete rest.weeklyHours
    expect(rest).toEqual(BASE)
  })
})

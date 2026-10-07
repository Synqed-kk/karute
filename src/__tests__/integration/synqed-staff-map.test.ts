/**
 * Coverage for resolveSynqedStaffId (PR 18, replay/18). Verifies the
 * profiles.id → synqed staff.id translation:
 *  - primary match on synqed staff.user_id,
 *  - email fallback (with self-heal patch to user_id),
 *  - create-on-miss: a real Supabase profile with no synqed staff record yet
 *    (e.g. seeded staff that bypassed createStaff) gets one created on demand,
 *  - and the hard throw when the profile doesn't exist in this business.
 *
 * Deps are mocked per-case and the module is re-imported inside
 * jest.isolateModulesAsync so unstable_cache memoization can't bleed
 * between scenarios. SYNQED_CORE_* env is set so the SynqedClient path runs.
 */
const BIZ = 'biz-1'

interface SynqedStaff {
  id: string
  user_id?: string | null
  email?: string | null
}

let mockStaff: SynqedStaff[] = []
let mockProfileEmail: string | null | undefined = undefined
let mockProfileName: string | null | undefined = undefined
let staffUpdate: jest.Mock
let staffListMock: jest.Mock
let staffCreate: jest.Mock
let mockGetBusinessId: jest.Mock
let mockUpdateTag: jest.Mock
let mockSynqedClient: jest.Mock
let mockProfileQueries: { select: jest.Mock; eq: jest.Mock }[] = []

function mockDeps(opts: {
  staff: SynqedStaff[]
  /** undefined → the profiles row doesn't exist; null/string → it does. */
  profileEmail?: string | null
  profileName?: string | null
  profileCustomerId?: string
  /** Omit/clear env so the self-heal + list path can be exercised without it. */
  withEnv?: boolean
  /** Force the self-heal update() to throw. */
  updateThrows?: boolean
  /** Force staff.list() to reject (models a roster-fetch/core-outage failure). */
  listRejects?: boolean
  /** Force getBusinessId() to reject (models a broken cookie session). */
  businessIdThrows?: boolean
  /** Force the profiles read to fail (models a Supabase outage). */
  profileReadFails?: boolean
  /** What the 24h unstable_cache serves (a STALE roster); omitted = the cache
   *  is transparent and serves the live list. */
  cachedStaff?: SynqedStaff[]
  /** Force updateTag to throw (as Next does outside a Server Action). */
  updateTagThrows?: boolean
}) {
  mockStaff = opts.staff
  mockProfileEmail = opts.profileEmail
  mockProfileName = opts.profileName
  const withEnv = opts.withEnv ?? true
  if (withEnv) {
    process.env.SYNQED_CORE_URL = 'https://core.test'
    process.env.SYNQED_CORE_API_KEY = 'key-123'
  } else {
    delete process.env.SYNQED_CORE_URL
    delete process.env.SYNQED_CORE_API_KEY
  }

  staffUpdate = jest.fn(async () => {
    if (opts.updateThrows) throw new Error('patch failed')
    return {}
  })
  staffListMock = jest.fn(async () => {
    if (opts.listRejects) throw new Error('roster fetch failed')
    return { staff: mockStaff }
  })
  staffCreate = jest.fn(async () => ({ id: 'staff-created' }))
  mockGetBusinessId = jest.fn(async () => {
    if (opts.businessIdThrows) throw new Error('session broken')
    return BIZ
  })
  mockUpdateTag = jest.fn(() => {
    if (opts.updateTagThrows) throw new Error('updateTag can only be called from within a Server Action.')
  })
  mockProfileQueries = []

  mockSynqedClient = jest.fn().mockImplementation(() => ({
    staff: { list: staffListMock, update: staffUpdate, create: staffCreate },
  }))
  jest.doMock('@synqed-kk/client', () => ({ SynqedClient: mockSynqedClient }))

  jest.doMock('@/lib/staff', () => ({
    getBusinessId: mockGetBusinessId,
  }))

  jest.doMock('@/lib/supabase/service', () => ({
    createServiceClient: () => {
      const filters = new Map<string, unknown>()
      const customerId = opts.profileCustomerId ?? BIZ
      const builder = {
        select: jest.fn(),
        eq: jest.fn(),
        maybeSingle: async () => opts.profileReadFails ? { data: null, error: { message: 'profiles read failed' } } : ({
          // A foreign row exists but is invisible when the tenant filter is applied.
          data:
            mockProfileEmail === undefined ||
            (filters.has('customer_id') && filters.get('customer_id') !== customerId)
              ? null
              : {
                  full_name: mockProfileName ?? null,
                  email: mockProfileEmail,
                  customer_id: customerId,
                },
        }),
      }
      builder.select.mockReturnValue(builder)
      builder.eq.mockImplementation((column: string, value: unknown) => {
        filters.set(column, value)
        return builder
      })
      mockProfileQueries.push(builder)
      return { from: () => builder }
    },
  }))

  jest.doMock('next/cache', () => ({
    unstable_cache: (fn: unknown) =>
      opts.cachedStaff
        ? async () =>
            opts.cachedStaff!.map((c) => ({ id: c.id, user_id: c.user_id ?? null, email: c.email ?? null, name: null }))
        : fn,
    updateTag: mockUpdateTag,
    revalidateTag: jest.fn(),
    revalidatePath: jest.fn(),
  }))
}

async function loadFn() {
  let fn!: typeof import('@/lib/synqed/staff-map').resolveSynqedStaffId
  await jest.isolateModulesAsync(async () => {
    fn = (await import('@/lib/synqed/staff-map')).resolveSynqedStaffId
  })
  return fn
}

async function loadLookupFn() {
  let fn!: typeof import('@/lib/synqed/staff-map').lookupSynqedStaffId
  await jest.isolateModulesAsync(async () => {
    fn = (await import('@/lib/synqed/staff-map')).lookupSynqedStaffId
  })
  return fn
}

async function loadResolveForBusinessFn() {
  let fn!: typeof import('@/lib/synqed/staff-map').resolveSynqedStaffIdForBusiness
  await jest.isolateModulesAsync(async () => {
    fn = (await import('@/lib/synqed/staff-map')).resolveSynqedStaffIdForBusiness
  })
  return fn
}

async function loadLookupForBusinessFn() {
  let fn!: typeof import('@/lib/synqed/staff-map').lookupSynqedStaffIdForBusiness
  await jest.isolateModulesAsync(async () => {
    fn = (await import('@/lib/synqed/staff-map')).lookupSynqedStaffIdForBusiness
  })
  return fn
}

async function loadForwardLookupFn() {
  let fn!: typeof import('@/lib/synqed/staff-map').lookupProfileIdForSynqedStaffId
  await jest.isolateModulesAsync(async () => {
    fn = (await import('@/lib/synqed/staff-map')).lookupProfileIdForSynqedStaffId
  })
  return fn
}

async function loadForwardLookupForBusinessFn() {
  let fn!: typeof import('@/lib/synqed/staff-map').lookupProfileIdForSynqedStaffIdForBusiness
  await jest.isolateModulesAsync(async () => {
    fn = (await import('@/lib/synqed/staff-map')).lookupProfileIdForSynqedStaffIdForBusiness
  })
  return fn
}

beforeEach(() => {
  jest.resetModules()
  mockStaff = []
  mockProfileEmail = undefined
  mockProfileName = undefined
})

afterEach(() => {
  delete process.env.SYNQED_CORE_URL
  delete process.env.SYNQED_CORE_API_KEY
})

describe('resolveSynqedStaffId — primary user_id match', () => {
  it('returns the synqed staff id whose user_id matches the profile id', async () => {
    mockDeps({
      staff: [
        { id: 'staff-A', user_id: 'profile-1', email: 'a@x.com' },
        { id: 'staff-B', user_id: 'profile-2', email: 'b@x.com' },
      ],
    })
    const resolve = await loadFn()
    await expect(resolve('profile-1')).resolves.toBe('staff-A')
  })

  it('does not consult the profiles table when the user_id path hits', async () => {
    mockDeps({
      staff: [{ id: 'staff-A', user_id: 'profile-1', email: 'a@x.com' }],
      profileEmail: 'should-not-be-used@x.com',
    })
    const resolve = await loadFn()
    await expect(resolve('profile-1')).resolves.toBe('staff-A')
    // self-heal update is only on the email path
    expect(staffUpdate).not.toHaveBeenCalled()
  })
})

describe('resolveSynqedStaffId — email fallback + self-heal', () => {
  it('falls back to a case-insensitive email match when user_id is null', async () => {
    mockDeps({
      staff: [{ id: 'staff-T', user_id: null, email: 'Teammate@Salon.com' }],
      profileEmail: 'teammate@salon.com',
    })
    const resolve = await loadFn()
    await expect(resolve('profile-99')).resolves.toBe('staff-T')
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('self-heals by patching the synqed record user_id on an email match', async () => {
    mockDeps({
      staff: [{ id: 'staff-T', user_id: null, email: 'teammate@salon.com' }],
      profileEmail: 'teammate@salon.com',
      profileCustomerId: BIZ,
    })
    const resolve = await loadFn()
    await expect(resolve('profile-99')).resolves.toBe('staff-T')
    expect(staffUpdate).toHaveBeenCalledTimes(1)
    expect(staffUpdate).toHaveBeenCalledWith('staff-T', { user_id: 'profile-99' })
    expect(mockUpdateTag.mock.calls).toEqual([['staff-list']])
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('still returns the staff id when the self-heal patch throws', async () => {
    mockDeps({
      staff: [{ id: 'staff-T', user_id: null, email: 'teammate@salon.com' }],
      profileEmail: 'teammate@salon.com',
      updateThrows: true,
    })
    const resolve = await loadFn()
    await expect(resolve('profile-99')).resolves.toBe('staff-T')
  })

  it('matches on email even when the synqed user_id differs (not just null)', async () => {
    // user_id present but pointing at a different profile; email is the bridge.
    mockDeps({
      staff: [{ id: 'staff-T', user_id: 'stale-profile', email: 'teammate@salon.com' }],
      profileEmail: 'teammate@salon.com',
    })
    const resolve = await loadFn()
    await expect(resolve('profile-99')).resolves.toBe('staff-T')
    expect(staffUpdate).toHaveBeenCalledWith('staff-T', { user_id: 'profile-99' })
  })
})

describe('email fallback — business scope', () => {
  it('e2: returns null for a foreign profile with a local card email without self-healing', async () => {
    mockDeps({
      staff: [{ id: 'staff-local', user_id: null, email: 'shared@example.test' }],
      profileEmail: 'shared@example.test',
      profileCustomerId: 'biz-other',
    })
    const lookup = await loadLookupFn()
    await expect(lookup('profile-foreign')).resolves.toBeNull()
    expect(staffUpdate).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
    expect(mockUpdateTag).not.toHaveBeenCalled()
  })

  it('e3: the resolver rejects a foreign profile with a local card email without updating or creating', async () => {
    mockDeps({
      staff: [{ id: 'staff-local', user_id: null, email: 'shared@example.test' }],
      profileEmail: 'shared@example.test',
      profileCustomerId: 'biz-other',
    })
    const resolve = await loadResolveForBusinessFn()
    await expect(resolve('profile-foreign', BIZ)).rejects.toThrow(
      'Could not link Supabase profile profile-foreign to a synqed-core staff record: no such profile.',
    )
    expect(staffUpdate).not.toHaveBeenCalled()
    expect(staffCreate).not.toHaveBeenCalled()
    expect(mockUpdateTag).not.toHaveBeenCalled()
  })

  it('e4: filters the email query by both profile id and business', async () => {
    mockDeps({
      staff: [{ id: 'staff-local', user_id: null, email: 'same@example.test' }],
      profileEmail: 'same@example.test',
      profileCustomerId: BIZ,
    })
    const lookup = await loadLookupFn()
    await expect(lookup('profile-same')).resolves.toBe('staff-local')
    expect(mockProfileQueries).toHaveLength(1)
    const query = mockProfileQueries[0]
    expect(query.select).toHaveBeenCalledWith('email')
    expect(query.eq).toHaveBeenCalledWith('id', 'profile-same')
    expect(query.eq).toHaveBeenCalledWith('customer_id', BIZ)
  })

  it.each([
    ['lookup', loadLookupForBusinessFn],
    ['resolve', loadResolveForBusinessFn],
  ])('e5: the Bearer %s twin uses the token business for the email query', async (_name, load) => {
    const tokenBusinessId = 'biz-token'
    mockDeps({
      staff: [{ id: 'staff-token', user_id: null, email: 'token@example.test' }],
      profileEmail: 'token@example.test',
      profileCustomerId: tokenBusinessId,
      businessIdThrows: true,
    })
    const resolve = await load()
    await expect(resolve('profile-token', tokenBusinessId)).resolves.toBe('staff-token')
    expect(mockGetBusinessId).not.toHaveBeenCalled()
    expect(mockProfileQueries).toHaveLength(1)
    const query = mockProfileQueries[0]
    expect(query.select).toHaveBeenCalledWith('email')
    expect(query.eq).toHaveBeenCalledWith('id', 'profile-token')
    expect(query.eq).toHaveBeenCalledWith('customer_id', tokenBusinessId)
    expect(query.eq).not.toHaveBeenCalledWith('customer_id', BIZ)
    // roster + self-heal write; the resolver adds its one live re-read on a
    // roster miss (F1) — every client on the token business
    expect(mockSynqedClient).toHaveBeenCalledTimes(_name === 'resolve' ? 3 : 2)
    for (const [options] of mockSynqedClient.mock.calls) {
      expect(options.businessId).toBe(tokenBusinessId)
    }
    expect(staffUpdate).toHaveBeenCalledTimes(1)
    expect(staffUpdate).toHaveBeenCalledWith('staff-token', { user_id: 'profile-token' })
    expect(mockUpdateTag.mock.calls).toEqual([['staff-list']])
    expect(staffCreate).not.toHaveBeenCalled()
  })
})

describe('resolveSynqedStaffId — create-on-miss', () => {
  it('creates a synqed staff record from the profile when no link exists', async () => {
    mockDeps({
      staff: [{ id: 'staff-A', user_id: 'other', email: 'other@x.com' }],
      profileName: '牧之瀬 拓海',
      profileEmail: 'takumi@salon.com',
      profileCustomerId: BIZ,
    })
    const resolve = await loadFn()
    await expect(resolve('profile-seeded')).resolves.toBe('staff-created')
    expect(staffCreate).toHaveBeenCalledTimes(1)
    expect(mockUpdateTag.mock.calls).toEqual([['staff-list']])
    expect(staffCreate).toHaveBeenCalledWith({
      name: '牧之瀬 拓海',
      email: 'takumi@salon.com',
      user_id: 'profile-seeded',
    })
  })

  it('s2: rejects a profile in another business without creating staff or invalidating tags', async () => {
    mockDeps({
      staff: [],
      profileName: 'Foreign Staff',
      profileEmail: 'foreign@example.test',
      profileCustomerId: 'biz-other',
    })
    const resolve = await loadFn()
    await expect(resolve('profile-foreign')).rejects.toThrow(
      'Could not link Supabase profile profile-foreign to a synqed-core staff record: no such profile.',
    )
    expect(staffCreate).not.toHaveBeenCalled()
    expect(mockUpdateTag).not.toHaveBeenCalled()
  })

  it('s3: filters the create-on-miss profile query by both profile id and business', async () => {
    mockDeps({ staff: [], profileEmail: 'same@example.test', profileCustomerId: BIZ })
    const resolve = await loadFn()
    await resolve('profile-same')
    const query = mockProfileQueries.find((q) =>
      q.select.mock.calls.some(([columns]) => columns === 'full_name, email'),
    )
    expect(query).toBeDefined()
    expect(query!.eq).toHaveBeenCalledWith('id', 'profile-same')
    expect(query!.eq).toHaveBeenCalledWith('customer_id', BIZ)
  })

  it('s4: the Bearer twin uses the token business, never the cookie business', async () => {
    const tokenBusinessId = 'biz-token'
    mockDeps({
      staff: [],
      profileName: 'Token Staff',
      profileEmail: 'token@example.test',
      profileCustomerId: tokenBusinessId,
    })
    const resolve = await loadResolveForBusinessFn()
    await expect(resolve('profile-token', tokenBusinessId)).resolves.toBe('staff-created')
    expect(mockGetBusinessId).not.toHaveBeenCalled()
    const query = mockProfileQueries.find((q) =>
      q.select.mock.calls.some(([columns]) => columns === 'full_name, email'),
    )
    expect(query!.eq).toHaveBeenCalledWith('customer_id', tokenBusinessId)
    expect(query!.eq).not.toHaveBeenCalledWith('customer_id', BIZ)
    // cached roster + the one live re-read on a roster miss (F1) + the write
    expect(mockSynqedClient).toHaveBeenCalledTimes(3)
    for (const [options] of mockSynqedClient.mock.calls) {
      expect(options.businessId).toBe(tokenBusinessId)
    }
    expect(staffCreate).toHaveBeenCalledTimes(1)
    expect(staffCreate).toHaveBeenCalledWith({
      name: 'Token Staff',
      email: 'token@example.test',
      user_id: 'profile-token',
    })
  })

  it('falls back to the email as the name when the profile has no full_name', async () => {
    mockDeps({
      staff: [],
      profileName: null,
      profileEmail: 'noname@salon.com',
    })
    const resolve = await loadFn()
    await expect(resolve('profile-x')).resolves.toBe('staff-created')
    expect(staffCreate).toHaveBeenCalledWith({
      name: 'noname@salon.com',
      email: 'noname@salon.com',
      user_id: 'profile-x',
    })
  })

  it('creates even when the profile has no email (no fallback match possible)', async () => {
    mockDeps({
      staff: [{ id: 'staff-N', user_id: null, email: null }],
      profileName: 'Solo Stylist',
      profileEmail: null,
    })
    const resolve = await loadFn()
    await expect(resolve('profile-99')).resolves.toBe('staff-created')
    expect(staffCreate).toHaveBeenCalledWith({
      name: 'Solo Stylist',
      email: null,
      user_id: 'profile-99',
    })
  })
})

describe('resolveSynqedStaffId — no profile', () => {
  it('throws only when the Supabase profile itself does not exist', async () => {
    mockDeps({
      staff: [{ id: 'staff-A', user_id: 'other', email: 'other@x.com' }],
      // profileEmail omitted → the profiles row is null
    })
    const resolve = await loadFn()
    await expect(resolve('profile-missing')).rejects.toThrow(
      /Could not link Supabase profile profile-missing.*no such profile/,
    )
    expect(staffCreate).not.toHaveBeenCalled()
  })

  // ⚖ FIX ROUND 3 item 9 (S1) — the assign route maps ONLY this class to 400,
  // so the unknown-profile throw must BE it (the real module, not a mock). The
  // class and the resolvers come from the same isolated module load.
  it('the unknown-profile throw is a StaffProfileNotFoundError (both resolvers)', async () => {
    mockDeps({
      staff: [{ id: 'staff-A', user_id: 'other', email: 'other@x.com' }],
    })
    let mod!: typeof import('@/lib/synqed/staff-map')
    await jest.isolateModulesAsync(async () => {
      mod = await import('@/lib/synqed/staff-map')
    })
    await expect(mod.resolveSynqedStaffId('profile-missing')).rejects.toBeInstanceOf(
      mod.StaffProfileNotFoundError,
    )
    await expect(mod.resolveSynqedStaffIdForBusiness('profile-missing', BIZ)).rejects.toBeInstanceOf(
      mod.StaffProfileNotFoundError,
    )
    expect(staffCreate).not.toHaveBeenCalled()
  })
})

describe('resolveSynqedStaffId — env validation', () => {
  it('throws when SYNQED_CORE_* env vars are missing (staff-list path)', async () => {
    mockDeps({
      staff: [{ id: 'staff-A', user_id: 'profile-1' }],
      withEnv: false,
    })
    const resolve = await loadFn()
    await expect(resolve('profile-1')).rejects.toThrow(
      /Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY/,
    )
  })
})

// The pure-lookup half of the resolver, split out for flows where
// create-on-miss would be wrong (deleteStaff — Greptile P1 on PR #374:
// deleting an unmatched staff must not first CREATE a synqed record).
// Match paths are shared with resolveSynqedStaffId (covered above); what's
// pinned here is the contract difference: null on no link, and NEVER create.
describe('lookupSynqedStaffId — pure lookup, no create', () => {
  it('returns the user_id-matched staff id (same as the resolver path)', async () => {
    mockDeps({
      staff: [{ id: 'staff-A', user_id: 'profile-1', email: 'a@x.com' }],
    })
    const lookup = await loadLookupFn()
    await expect(lookup('profile-1')).resolves.toBe('staff-A')
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('returns null (and creates nothing) when a profile has no synqed link', async () => {
    mockDeps({
      staff: [{ id: 'staff-A', user_id: 'other', email: 'other@x.com' }],
      profileName: 'Unlinked Person',
      profileEmail: 'unlinked@salon.com',
    })
    const lookup = await loadLookupFn()
    await expect(lookup('profile-unlinked')).resolves.toBeNull()
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('returns null (no throw, no create) when the profile itself does not exist', async () => {
    mockDeps({
      staff: [],
      // profileEmail omitted → the profiles row is null
    })
    const lookup = await loadLookupFn()
    await expect(lookup('profile-missing')).resolves.toBeNull()
    expect(staffCreate).not.toHaveBeenCalled()
  })
})

// Forward translation (recorder-lock fix, 2026-08-30 packet): synqed-core
// staff CARD id → Supabase profile id (staff.user_id). Read-only — no
// self-heal, no create, reuses the same cached roster as the reverse lookups
// above (never a raw staff.list() re-fetch of its own).
describe('lookupProfileIdForSynqedStaffId — forward (card id → profile id) lookup', () => {
  it('returns the linked profile id for a known card id', async () => {
    mockDeps({
      staff: [{ id: 'card-101', user_id: 'profile-1', email: 'a@x.com' }],
    })
    const lookup = await loadForwardLookupFn()
    await expect(lookup('card-101')).resolves.toBe('profile-1')
  })

  it('returns null when the id is not a known card id', async () => {
    mockDeps({
      staff: [{ id: 'card-101', user_id: 'profile-1', email: 'a@x.com' }],
    })
    const lookup = await loadForwardLookupFn()
    await expect(lookup('not-a-card-id')).resolves.toBeNull()
  })

  it('returns null when the matched card has no linked profile (user_id null)', async () => {
    mockDeps({
      staff: [{ id: 'card-201', user_id: null, email: 'b@x.com' }],
    })
    const lookup = await loadForwardLookupFn()
    await expect(lookup('card-201')).resolves.toBeNull()
  })

  it('reuses the cached roster — a single lookup makes exactly one staff.list call', async () => {
    mockDeps({
      staff: [{ id: 'card-101', user_id: 'profile-1', email: 'a@x.com' }],
    })
    const lookup = await loadForwardLookupFn()
    await lookup('card-101')
    expect(staffListMock).toHaveBeenCalledTimes(1)
  })
})

// Fail-open (FIX ROUND 2, post-Greptile P1): this lookup runs BEFORE the
// existing owner/viewAll checks at every call site, so a roster-fetch/core
// outage must never bubble up as a throw — it must resolve null so callers'
// `?? original` fallback keeps pre-fix behavior instead of breaking reads
// that never needed the translation.
describe('lookupProfileIdForSynqedStaffId(ForBusiness) — fail-open on lookup failure', () => {
  it('resolves null (never throws) when the roster fetch rejects', async () => {
    mockDeps({ staff: [], listRejects: true })
    const lookup = await loadForwardLookupForBusinessFn()
    await expect(lookup('card-101', BIZ)).resolves.toBeNull()
  })

  it('cookie twin resolves null (never throws) when getBusinessId rejects', async () => {
    mockDeps({
      staff: [{ id: 'card-101', user_id: 'profile-1', email: 'a@x.com' }],
      businessIdThrows: true,
    })
    const lookup = await loadForwardLookupFn()
    await expect(lookup('card-101')).resolves.toBeNull()
  })
})

export {}

// ⚖ Greptile pass 1 P1 (B2 #1143) — the roster the staff pickers offer carries
// an owner-created teammate who has not signed up under its CORE staff id. The
// resolver takes that id only when it is a card of THIS business's roster.
describe('resolveSynqedStaffIdForBusiness — a core-only teammate the picker offers', () => {
  it('a core staff id of this business (no profile, user_id null) is returned as-is: no profiles read, no create', async () => {
    mockDeps({
      staff: [
        { id: 'staff-A', user_id: 'profile-1', email: 'a@x.com' },
        { id: 'core-only-1', user_id: null, email: 'new@x.com' },
      ],
    })
    const resolve = await loadResolveForBusinessFn()
    await expect(resolve('core-only-1', BIZ)).resolves.toBe('core-only-1')
    expect(mockProfileQueries).toHaveLength(0)
    expect(staffCreate).not.toHaveBeenCalled()
    expect(staffUpdate).not.toHaveBeenCalled()
  })

  it('the cookie twin takes the same core id through the same check', async () => {
    mockDeps({ staff: [{ id: 'core-only-1', user_id: null, email: null }] })
    const resolve = await loadFn()
    await expect(resolve('core-only-1')).resolves.toBe('core-only-1')
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('an id that is neither a card of this roster nor a profile of this business → StaffProfileNotFoundError, nothing created', async () => {
    mockDeps({ staff: [{ id: 'core-only-1', user_id: null, email: null }] })
    let mod!: typeof import('@/lib/synqed/staff-map')
    await jest.isolateModulesAsync(async () => {
      mod = await import('@/lib/synqed/staff-map')
    })
    await expect(mod.resolveSynqedStaffIdForBusiness('core-of-another-business', BIZ)).rejects.toBeInstanceOf(
      mod.StaffProfileNotFoundError,
    )
    expect(staffCreate).not.toHaveBeenCalled()
  })
})

// ⚖ Greptile pass 1 P2 (B2 #1143) — a failed profiles read is an outage, never
// "no such profile": both reads (the email fallback and create-on-miss) throw
// the read's error before their null check.
describe('profiles read failure — an outage, never StaffProfileNotFoundError', () => {
  it('lookupSynqedStaffIdForBusiness rejects with the read error (never resolves null)', async () => {
    mockDeps({ staff: [{ id: 'staff-A', user_id: 'other', email: 'a@x.com' }], profileReadFails: true })
    const lookup = await loadLookupForBusinessFn()
    await expect(lookup('profile-1', BIZ)).rejects.toEqual({ message: 'profiles read failed' })
  })

  it('both resolvers reject with the read error, not StaffProfileNotFoundError; nothing created', async () => {
    mockDeps({ staff: [{ id: 'staff-A', user_id: 'other', email: 'a@x.com' }], profileReadFails: true })
    let mod!: typeof import('@/lib/synqed/staff-map')
    await jest.isolateModulesAsync(async () => {
      mod = await import('@/lib/synqed/staff-map')
    })
    for (const run of [() => mod.resolveSynqedStaffId('profile-1'), () => mod.resolveSynqedStaffIdForBusiness('profile-1', BIZ)]) {
      const err = await run().then(() => null, (e: unknown) => e)
      expect(err).toEqual({ message: 'profiles read failed' })
      expect(err).not.toBeInstanceOf(mod.StaffProfileNotFoundError)
    }
    expect(staffCreate).not.toHaveBeenCalled()
  })
})

// ⚖ 10/3 (fix round 6 F1) — the phone picker reads the roster live, the
// resolver through the 24h cache. A card the cache has not seen yet is re-read
// ONCE live before the profile path, with the same businessId.
describe('resolveSynqedStaffIdForBusiness — a card the cached roster has not seen yet', () => {
  it('F1: a card present live but absent from the cached roster is resolved as-is: no profiles read, no create, staff-list refreshed', async () => {
    mockDeps({
      cachedStaff: [{ id: 'staff-A', user_id: 'profile-1', email: 'a@x.com' }],
      staff: [
        { id: 'staff-A', user_id: 'profile-1', email: 'a@x.com' },
        { id: 'core-new-1', user_id: null, email: 'new@x.com' },
      ],
    })
    const resolve = await loadResolveForBusinessFn()
    await expect(resolve('core-new-1', 'biz-token')).resolves.toBe('core-new-1')
    expect(staffListMock).toHaveBeenCalledTimes(1)
    expect(mockSynqedClient.mock.calls.map(([o]) => o.businessId)).toEqual(['biz-token'])
    expect(mockProfileQueries).toHaveLength(0)
    expect(staffCreate).not.toHaveBeenCalled()
    expect(mockUpdateTag.mock.calls).toEqual([['staff-list']])
  })

  it('F1: the refresh failing (updateTag outside a Server Action — the facade) never fails the resolve', async () => {
    mockDeps({ cachedStaff: [], staff: [{ id: 'core-new-1', user_id: null, email: null }], updateTagThrows: true })
    const resolve = await loadResolveForBusinessFn()
    await expect(resolve('core-new-1', BIZ)).resolves.toBe('core-new-1')
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('F1: a card absent from both rosters falls to the profile path as before (StaffProfileNotFoundError, nothing created)', async () => {
    mockDeps({ cachedStaff: [], staff: [{ id: 'core-new-1', user_id: null, email: null }] })
    let mod!: typeof import('@/lib/synqed/staff-map')
    await jest.isolateModulesAsync(async () => {
      mod = await import('@/lib/synqed/staff-map')
    })
    await expect(mod.resolveSynqedStaffIdForBusiness('nobody-1', BIZ)).rejects.toBeInstanceOf(mod.StaffProfileNotFoundError)
    expect(staffListMock).toHaveBeenCalledTimes(1)
    expect(mockProfileQueries.length).toBeGreaterThan(0)
    expect(staffCreate).not.toHaveBeenCalled()
    expect(mockUpdateTag).not.toHaveBeenCalled()
  })

  it('F1: a profile the cached roster already links costs no live re-read', async () => {
    mockDeps({ cachedStaff: [{ id: 'staff-A', user_id: 'profile-1', email: 'a@x.com' }], staff: [] })
    const resolve = await loadResolveForBusinessFn()
    await expect(resolve('profile-1', BIZ)).resolves.toBe('staff-A')
    expect(staffListMock).not.toHaveBeenCalled()
    expect(mockProfileQueries).toHaveLength(0)
  })
})

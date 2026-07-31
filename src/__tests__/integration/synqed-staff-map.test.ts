/**
 * Coverage for resolveSynqedStaffId (PR 18, replay/18). Verifies the
 * profiles.id → synqed staff.id translation:
 *  - primary match on synqed staff.user_id,
 *  - email fallback (with self-heal patch to user_id),
 *  - create-on-miss: a real Supabase profile with no synqed staff record yet
 *    (e.g. seeded staff that bypassed createStaff) gets one created on demand,
 *  - and the hard throw only when the profile itself doesn't exist.
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

function mockDeps(opts: {
  staff: SynqedStaff[]
  /** undefined → the profiles row doesn't exist; null/string → it does. */
  profileEmail?: string | null
  profileName?: string | null
  /** Omit/clear env so the self-heal + list path can be exercised without it. */
  withEnv?: boolean
  /** Force the self-heal update() to throw. */
  updateThrows?: boolean
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
  staffListMock = jest.fn(async () => ({ staff: mockStaff }))
  staffCreate = jest.fn(async () => ({ id: 'staff-created' }))

  jest.doMock('@synqed-kk/client', () => ({
    SynqedClient: jest.fn().mockImplementation(() => ({
      staff: { list: staffListMock, update: staffUpdate, create: staffCreate },
    })),
  }))

  jest.doMock('@/lib/staff', () => ({
    getBusinessId: jest.fn(async () => BIZ),
  }))

  jest.doMock('@/lib/supabase/service', () => ({
    createServiceClient: () => {
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) builder[m] = () => builder
      ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({
        // profileEmail === undefined models "no such profile" (null row);
        // otherwise the row exists with the staged name + email.
        data:
          mockProfileEmail === undefined
            ? null
            : { full_name: mockProfileName ?? null, email: mockProfileEmail },
      })
      return { from: () => builder }
    },
  }))

  jest.doMock('next/cache', () => ({
    unstable_cache: (fn: unknown) => fn,
    updateTag: jest.fn(),
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
    })
    const resolve = await loadFn()
    await resolve('profile-99')
    expect(staffUpdate).toHaveBeenCalledWith('staff-T', { user_id: 'profile-99' })
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

describe('resolveSynqedStaffId — create-on-miss', () => {
  it('creates a synqed staff record from the profile when no link exists', async () => {
    mockDeps({
      staff: [{ id: 'staff-A', user_id: 'other', email: 'other@x.com' }],
      profileName: '牧之瀬 拓海',
      profileEmail: 'takumi@salon.com',
    })
    const resolve = await loadFn()
    await expect(resolve('profile-seeded')).resolves.toBe('staff-created')
    expect(staffCreate).toHaveBeenCalledWith({
      name: '牧之瀬 拓海',
      email: 'takumi@salon.com',
      user_id: 'profile-seeded',
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

export {}

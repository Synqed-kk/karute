/**
 * Coverage for getCurrentUserStaffId (PR #84, replay/09). Verifies the
 * membership rule: the authenticated user's id is returned only when it
 * appears in this tenant's active staff roster; otherwise null.
 *
 * Mocks the lowest-level deps (supabase server/service clients + the
 * synqed-core SDK) and re-imports the module per case so React cache() /
 * unstable_cache memoization doesn't bleed between scenarios.
 */
const BIZ = '00000000-0000-0000-0000-0000000000aa'

function mockDeps(opts: { userId: string | null; staff: Array<{ id: string }> }) {
  jest.doMock('@/lib/supabase/server', () => ({
    createClient: async () => ({
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({
          data: { user: opts.userId ? { id: opts.userId } : null },
        }),
      },
    }),
  }))
  jest.doMock('@/lib/supabase/service', () => ({
    createServiceClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: { customer_id: BIZ } }) }),
        }),
      }),
    }),
  }))
  jest.doMock('next/cache', () => ({
    unstable_cache: (fn: unknown) => fn,
    revalidateTag: jest.fn(),
    revalidatePath: jest.fn(),
  }))
  jest.doMock('@synqed-kk/client', () => ({
    SynqedClient: class {
      staff = {
        list: async () => ({
          staff: opts.staff.map((s) => ({ id: s.id, name: 'Staff', is_active: true })),
        }),
      }
    },
  }))
}

async function loadHelper() {
  let fn!: typeof import('@/lib/staff').getCurrentUserStaffId
  await jest.isolateModulesAsync(async () => {
    fn = (await import('@/lib/staff')).getCurrentUserStaffId
  })
  return fn
}

describe('getCurrentUserStaffId', () => {
  const ORIGINAL_SYNQED_URL = process.env.SYNQED_CORE_URL
  const ORIGINAL_SYNQED_KEY = process.env.SYNQED_CORE_API_KEY

  beforeAll(() => {
    // getStaffList returns [] early without these — set so the synqed mock runs.
    process.env.SYNQED_CORE_URL = 'https://core.test'
    process.env.SYNQED_CORE_API_KEY = 'test-key'
  })
  afterAll(() => {
    process.env.SYNQED_CORE_URL = ORIGINAL_SYNQED_URL
    process.env.SYNQED_CORE_API_KEY = ORIGINAL_SYNQED_KEY
  })
  beforeEach(() => {
    jest.resetModules()
  })

  it('returns the user id when it is in the staff roster', async () => {
    mockDeps({ userId: 'user-1', staff: [{ id: 'user-1' }, { id: 'user-2' }] })
    const getCurrentUserStaffId = await loadHelper()
    await expect(getCurrentUserStaffId()).resolves.toBe('user-1')
  })

  it('returns null when the user is not in the roster', async () => {
    mockDeps({ userId: 'ghost', staff: [{ id: 'user-1' }, { id: 'user-2' }] })
    const getCurrentUserStaffId = await loadHelper()
    await expect(getCurrentUserStaffId()).resolves.toBeNull()
  })

  it('returns null when there is no authenticated user', async () => {
    mockDeps({ userId: null, staff: [{ id: 'user-1' }] })
    const getCurrentUserStaffId = await loadHelper()
    await expect(getCurrentUserStaffId()).resolves.toBeNull()
  })

  it('returns null when the roster is empty', async () => {
    mockDeps({ userId: 'user-1', staff: [] })
    const getCurrentUserStaffId = await loadHelper()
    await expect(getCurrentUserStaffId()).resolves.toBeNull()
  })
})

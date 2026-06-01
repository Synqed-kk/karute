/**
 * Coverage for getCurrentUserStaffId (PR #84, evolved by #92). Verifies the
 * membership rule: the authenticated user's id is returned only when it
 * appears in this tenant's staff roster; otherwise null.
 *
 * Post-#92 the roster is sourced from the Supabase `profiles` table (service
 * client) rather than synqed-core, so the service client is mocked to answer
 * both the business-id lookup (.single()) and the staff-list query (awaited).
 * Modules are re-imported per case so React cache()/unstable_cache memoization
 * doesn't bleed between scenarios.
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
    createServiceClient: () => {
      const staffRows = opts.staff.map((s) => ({
        id: s.id,
        full_name: 'Staff',
        pin_hash: null,
        customer_id: BIZ,
      }))
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'not', 'order']) builder[m] = () => builder
      // getBusinessId resolves via .single(); staffListByBusiness awaits the builder.
      ;(builder as { single: unknown }).single = async () => ({ data: { customer_id: BIZ } })
      ;(builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: staffRows })
      return { from: () => builder }
    },
  }))
  jest.doMock('next/cache', () => ({
    unstable_cache: (fn: unknown) => fn,
    revalidateTag: jest.fn(),
    revalidatePath: jest.fn(),
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

export {}

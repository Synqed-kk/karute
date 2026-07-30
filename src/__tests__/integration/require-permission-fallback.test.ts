/**
 * capabilitiesForUser resolver fallback discipline (Greptile #652 P1).
 *
 * The display_role fallback exists ONLY for the pre-migration schema, where
 * the permission_role/permissions columns don't exist (42703 / PGRST204) and
 * therefore no per-staff override can exist to drop. Any OTHER combined-select
 * failure must fail CLOSED: deriving a preset there would silently drop an
 * explicit override and could re-grant a capability the owner deliberately
 * removed (e.g. customers.view for the Ask AI guard).
 */

const mockState: {
  combined: { data: unknown; error: { code?: string } | null }
  base: { data: unknown; error: null }
} = {
  combined: { data: null, error: null },
  base: { data: null, error: null },
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () =>
            cols.includes('permission_role') ? mockState.combined : mockState.base,
        }),
      }),
    }),
  })),
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(),
}))

import { capabilitiesForUser } from '@/lib/auth/require-permission'

beforeEach(() => {
  mockState.combined = { data: null, error: null }
  mockState.base = { data: null, error: null }
})

describe('capabilitiesForUser — fallback discipline (Greptile #652 P1)', () => {
  it('steady state honors an explicit override that REMOVES customers.view', async () => {
    mockState.combined = {
      data: {
        display_role: 'stylist',
        permission_role: 'practitioner',
        permissions: ['records.write'],
      },
      error: null,
    }
    const caps = await capabilitiesForUser('u-1')
    expect(caps.has('records.write')).toBe(true)
    expect(caps.has('customers.view')).toBe(false)
  })

  it('pre-migration schema (42703 undefined column) → graceful display_role preset', async () => {
    mockState.combined = { data: null, error: { code: '42703' } }
    mockState.base = { data: { display_role: 'stylist' }, error: null }
    const caps = await capabilitiesForUser('u-1')
    expect(caps.has('customers.view')).toBe(true) // practitioner preset
  })

  it('PGRST204 schema-cache miss → throws (a stale cache fires post-migration; honoring it would re-open the override-drop hole — Greptile #652 round 2)', async () => {
    mockState.combined = { data: null, error: { code: 'PGRST204' } }
    mockState.base = { data: { display_role: 'assistant' }, error: null }
    await expect(capabilitiesForUser('u-1')).rejects.toThrow('capability resolution failed')
  })

  it('any OTHER combined-select failure → throws (fail closed), never a preset that could restore a revoked capability', async () => {
    mockState.combined = { data: null, error: { code: '08006' } }
    mockState.base = { data: { display_role: 'stylist' }, error: null }
    await expect(capabilitiesForUser('u-1')).rejects.toThrow('capability resolution failed')
  })

  it('missing profile row without an error keeps the pre-existing preset path', async () => {
    mockState.combined = { data: null, error: null }
    mockState.base = { data: null, error: null }
    const caps = await capabilitiesForUser('u-1')
    expect(caps.has('customers.view')).toBe(true) // practitioner default
  })
})

/**
 * bootstrapBusinessForNewUser writes the OWNER role (packet 03 MUST-FIX 2).
 *
 * The Supabase trigger seeds a new user's profile row with NO role, and bootstrap
 * previously only wrote full_name — so the FIRST owner resolved to `practitioner`
 * (synqedRoleToPreset's default) and was refused by capability gates, including
 * `settings.manage` on completeOnboarding's "Finish setup" (which blocked the
 * onboarding flow itself). The fix writes display_role + permission_role = 'owner'
 * on BOTH the trigger-created (update) path and the fallback insert path — the
 * same fields invites.ts sets for invited staff.
 */
import { effectiveCapabilities, synqedRoleToPreset } from '@/lib/auth/permissions'

const UPDATE = jest.fn((_vals: unknown) => ({ eq: async () => ({ error: null }) }))
const INSERT = jest.fn(async (_vals: unknown) => ({ error: null }))
let profileRow: { customer_id: string; full_name: string } | null = null

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
          error: null,
        }),
      },
    },
    from: () => {
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) builder[m] = () => builder
      ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: profileRow })
      ;(builder as { update: unknown }).update = (vals: unknown) => UPDATE(vals)
      ;(builder as { insert: unknown }).insert = (vals: unknown) => INSERT(vals)
      return builder
    },
  }),
}))

const staffList = jest.fn(async () => ({ staff: [] as unknown[] }))
const staffCreate = jest.fn(async () => ({}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    staff = { list: staffList, create: staffCreate }
  },
}))

import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'

beforeEach(() => {
  jest.clearAllMocks()
  profileRow = null
  process.env.SYNQED_CORE_URL = 'https://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
})

describe('bootstrapBusinessForNewUser — owner role write', () => {
  it('trigger-created row: UPDATE carries display_role + permission_role = owner', async () => {
    profileRow = { customer_id: 'biz-1', full_name: 'owner@example.com' }
    const res = await bootstrapBusinessForNewUser('My Salon', 'user-1')
    expect(res).toEqual({ ok: true, businessId: 'biz-1' })
    expect(UPDATE).toHaveBeenCalledWith(
      expect.objectContaining({ display_role: 'owner', permission_role: 'owner' }),
    )
  })

  it('no existing row: INSERT carries display_role + permission_role = owner', async () => {
    profileRow = null
    const res = await bootstrapBusinessForNewUser('My Salon', 'user-1')
    expect(res).toMatchObject({ ok: true })
    expect(INSERT).toHaveBeenCalledWith(
      expect.objectContaining({ display_role: 'owner', permission_role: 'owner' }),
    )
  })

  it('the written role actually unblocks the gate: owner preset has settings.manage', () => {
    // Proves the fix addresses the ROOT bug — the capability the onboarding gate
    // (upsertOrgSettings) requires. Absent/practitioner would NOT have it.
    const caps = effectiveCapabilities(synqedRoleToPreset('OWNER'), null)
    expect(caps.has('settings.manage')).toBe(true)
    expect(effectiveCapabilities('practitioner', null).has('settings.manage')).toBe(false)
  })
})

export {}

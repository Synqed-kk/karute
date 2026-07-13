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
 *
 * The stamp is GATED on a role-less row: the action takes userId from the
 * (pre-session-sync) client and only verifies the user EXISTS, so it must never
 * change a role someone already holds — a call with an invited staffer's userId
 * keeps their invites.ts-written role.
 */
import { effectiveCapabilities, synqedRoleToPreset } from '@/lib/auth/permissions'

const UPDATE = jest.fn((_vals: unknown) => ({ eq: async () => ({ error: null }) }))
const INSERT = jest.fn(async (_vals: unknown) => ({ error: null }))
let profileRow: { customer_id: string; full_name: string; permission_role?: string | null } | null = null

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
  it('trigger-created ROLE-LESS row: UPDATE carries display_role + permission_role = owner', async () => {
    profileRow = { customer_id: 'biz-1', full_name: 'owner@example.com', permission_role: null }
    const res = await bootstrapBusinessForNewUser('My Salon', 'user-1')
    expect(res).toEqual({ ok: true, businessId: 'biz-1' })
    expect(UPDATE).toHaveBeenCalledWith(
      expect.objectContaining({ display_role: 'owner', permission_role: 'owner' }),
    )
  })

  it('a row that ALREADY has a role keeps it — no owner stamp, full_name still updates', async () => {
    // e.g. an invited staffer's userId passed to this client-callable action:
    // their invites.ts-written role must not be escalated to owner.
    profileRow = { customer_id: 'biz-1', full_name: 'Staffer', permission_role: 'practitioner' }
    const res = await bootstrapBusinessForNewUser('My Salon', 'user-1')
    expect(res).toEqual({ ok: true, businessId: 'biz-1' })
    expect(UPDATE).toHaveBeenCalledWith({ full_name: 'My Salon' })
    expect(UPDATE).not.toHaveBeenCalledWith(
      expect.objectContaining({ permission_role: expect.anything() }),
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

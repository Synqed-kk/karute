/**
 * createStaff / updateStaff error CONTRACT.
 *
 * The bug: a frontdesk who reached updateStaff (stale UI let them open the edit
 * dialog) got a rejection — and a thrown Server Action error has its message
 * STRIPPED in production, so the toast showed the cryptic "An error occurred in
 * the Server Components render...digest" text instead of a reason.
 *
 * These pin the fix: the user-facing staff mutations RETURN { error } with a
 * translated message and NEVER throw for an expected failure (permission,
 * validation, backend hiccup). Success returns undefined. (deleteStaff's own
 * contract is covered in delete-staff-id-resolution.)
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// Echo the i18n key so assertions read 'noPermission' / 'somethingWentWrong'.
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

jest.mock('@synqed-kk/client', () => ({
  // The react-hooks immutability lint mistakes this capitalized mock CLASS for
  // a React component and flags its constructor (false positive — plain jest
  // factory, no hooks). Scoped suppress so the repo-wide lint stays green.
  /* eslint-disable react-hooks/immutability */
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  /* eslint-enable react-hooks/immutability */
}))

const can = jest.fn(async (_cap: string) => true)
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: (cap: string) => can(cap),
}))

const staffCreate = jest.fn(async () => ({ id: 'new-1' }))
const staffUpdate = jest.fn(async () => ({}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    staff: { create: staffCreate, update: staffUpdate },
  })),
}))

jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn(async () => 'biz-1') }))

// No profile row → updateStaff routes to the synqed client (a synqed-only,
// not-yet-signed-up staff — exactly La Estro's placeholders).
let updateError: { message: string } | null = null
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: null })
    ;(builder as { update: unknown }).update = () => ({
      eq: () => ({ eq: async () => ({ error: updateError }) }),
    })
    return { from: () => builder }
  },
}))

import { createStaff, updateStaff } from '@/actions/staff'

const validData = { name: 'New Person', position: '', email: '', phone: '' }

beforeEach(() => {
  jest.clearAllMocks()
  can.mockImplementation(async () => true)
  updateError = null
})

describe('updateStaff — error contract', () => {
  it('denied (no staff.manage): returns { error: noPermission }, never touches core', async () => {
    can.mockResolvedValue(false)
    await expect(updateStaff('staff-1', validData)).resolves.toEqual({
      error: 'noPermission',
    })
    expect(staffUpdate).not.toHaveBeenCalled()
  })

  it('validation failure: returns { error } (a real message), not a throw', async () => {
    const res = await updateStaff('staff-1', { ...validData, name: '' })
    expect(res).toBeTruthy()
    expect((res as { error: string }).error).not.toMatch(/render|digest/i)
  })

  it('granted + valid: resolves undefined (success)', async () => {
    await expect(updateStaff('staff-1', validData)).resolves.toBeUndefined()
    expect(staffUpdate).toHaveBeenCalled()
  })

  it('backend hiccup: caught and returned as the generic fallback, never raw', async () => {
    staffUpdate.mockRejectedValueOnce(new Error('kaboom internal detail'))
    await expect(updateStaff('staff-1', validData)).resolves.toEqual({
      error: 'somethingWentWrong',
    })
  })
})

describe('createStaff — error contract', () => {
  it('denied (no staff.invite): returns { error: noPermission }', async () => {
    can.mockResolvedValue(false)
    await expect(createStaff(validData)).resolves.toEqual({ error: 'noPermission' })
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('granted + valid: resolves undefined', async () => {
    await expect(createStaff(validData)).resolves.toBeUndefined()
    expect(staffCreate).toHaveBeenCalled()
  })
})

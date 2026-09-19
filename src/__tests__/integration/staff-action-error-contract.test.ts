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
  SynqedError: class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

const can = jest.fn(async (_cap: string) => true)
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: (cap: string) => can(cap),
}))

// updateStaff now consults the store clamp before the core. This suite is
// about the ERROR contract, not scope — a viewAll-equivalent pass keeps every
// pin below on its original path. The clamp's own coverage lives in
// staff-actions-store-scope.test.ts.
jest.mock('@/lib/auth/store-scope', () => ({
  staffWriteInScope: jest.fn(async () => true),
  // ⚖ Liam 2026-09-16: createStaff resolves the CREATOR's own stores so the
  // new card can only be placed inside them. Unclamped here — this suite is
  // about the error contract, not the store rule.
  resolveStoreScope: jest.fn(async () => ({
    storeId: null,
    viewAll: true,
    allowedStoreIds: null,
    degraded: false,
  })),
}))

const staffCreate = jest.fn(async () => ({ id: 'new-1' }))
const staffUpdate = jest.fn(async () => ({}))
const staffDelete = jest.fn(async () => ({}))
const staffStoresSet = jest.fn(async () => ({}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    // delete + staffStores are the mint's placement/rollback ports — a client
    // without them cannot exercise a refused placement at all.
    staff: { create: staffCreate, update: staffUpdate, delete: staffDelete },
    staffStores: { set: staffStoresSet, get: jest.fn(async () => ({ store_ids: [] })) },
    // ⚖ I2 — without a stores port the store COUNT is unknown, and an unknown
    // count is now an answer of its own (storeUnknown). This suite is about
    // the error contract, so it models the ordinary one-store salon.
    stores: { list: jest.fn(async () => ({ stores: [{ id: 'store-1', is_primary: true }] })) },
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
import { resolveStoreScope } from '@/lib/auth/store-scope'

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

  it('a THROWN store-scope lookup fails closed, never an unhandled action error (F6)', async () => {
    // ⚖ FOLD ROUND 3 (fresh-eyes F6): resolveStoreScope sat outside the
    // try/catch every other risky call here is inside. A throw turned a hire
    // into the stripped render/digest toast instead of a reason.
    ;(resolveStoreScope as jest.Mock).mockRejectedValueOnce(new Error('core down'))
    await expect(
      createStaff({ ...validData, storeIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] }),
    ).resolves.toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(staffStoresSet).not.toHaveBeenCalled()
  })

  it('granted + valid: resolves undefined', async () => {
    await expect(createStaff(validData)).resolves.toBeUndefined()
    expect(staffCreate).toHaveBeenCalled()
  })
})

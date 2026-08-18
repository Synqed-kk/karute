/**
 * The staff WRITE actions are WIRED to the actor store-scope clamp (web
 * transport). Companion pins:
 *   - the RULE itself (viewAll / floating / degraded / self-edit / overlap)
 *     → store-scope.test.ts, `staffWriteInScope`
 *   - the FACADE transport of the same clamp (ensureStaffWriteInScope)
 *     → app-api-staff.test.ts, "staff writes are clamped to the caller's stores"
 *
 * What only this file can prove: each of update / delete / avatar consults the
 * clamp with the right (target, actor) pair, refuses BEFORE touching core, and
 * surfaces the store-scope message itself — updateStaff swallows core errors
 * into the generic fallback, so a clamp placed on the wrong side of the core
 * call would silently degrade the refusal into "somethingWentWrong".
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// Echo the i18n key so assertions read 'staffStoreScopeDenied'.
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

jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))

// The clamp's own module — stubbed to a switch so this file pins the WIRING
// (call shape, ordering, message) and store-scope.test.ts pins the rule.
jest.mock('@/lib/auth/store-scope', () => ({
  staffWriteInScope: jest.fn(async () => true),
}))

jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'actor-1'),
}))

jest.mock('@/lib/synqed/staff-map', () => ({
  lookupSynqedStaffIdForBusiness: jest.fn(async (id: string) => id),
}))

const staffUpdate = jest.fn(async () => ({}))
const staffDelete = jest.fn(async () => ({}))
const staffUploadAvatar = jest.fn(async () => ({ avatar_url: 'https://cdn.test/a.png' }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    staff: { update: staffUpdate, delete: staffDelete, uploadAvatar: staffUploadAvatar },
  })),
}))

// Records every profiles query the cores make — a refused write must not reach
// Supabase either, not just synqed-core.
let profileQueries = 0
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    profileQueries += 1
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () => ({ data: null })
    return { from: () => builder }
  },
}))

import { updateStaff, deleteStaff, uploadStaffAvatar } from '@/actions/staff'
import { staffWriteInScope as staffWriteInScopeImport } from '@/lib/auth/store-scope'

const staffWriteInScope = staffWriteInScopeImport as jest.Mock

const VALID = { name: 'Branch Person', position: '', email: '', phone: '' }
const avatarForm = () => {
  const fd = new FormData()
  fd.set('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
  return fd
}

// Every write transport, so a clamp that lands on two of three is red.
const writes: Array<[string, () => Promise<unknown>, jest.Mock]> = [
  ['updateStaff', () => updateStaff('staff-9', VALID), staffUpdate],
  ['deleteStaff', () => deleteStaff('staff-9'), staffDelete],
  ['uploadStaffAvatar', () => uploadStaffAvatar('staff-9', avatarForm()), staffUploadAvatar],
]

beforeEach(() => {
  jest.clearAllMocks()
  staffWriteInScope.mockResolvedValue(true)
  profileQueries = 0
})

describe.each(writes)('%s — actor store-scope clamp', (_name, run, coreWrite) => {
  it('out of scope → the store-scope message, core and profiles untouched', async () => {
    staffWriteInScope.mockResolvedValue(false)
    await expect(run()).resolves.toEqual({ error: 'staffStoreScopeDenied' })
    expect(coreWrite).not.toHaveBeenCalled()
    expect(profileQueries).toBe(0)
  })

  it('in scope → passes through to core unchanged', async () => {
    await run()
    expect(coreWrite).toHaveBeenCalled()
  })

  it('the clamp is asked about the TARGET, with the resolved actor', async () => {
    await run()
    expect(staffWriteInScope).toHaveBeenCalledWith({
      targetStaffId: 'staff-9',
      actorId: 'actor-1',
    })
  })
})

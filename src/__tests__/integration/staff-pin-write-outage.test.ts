/**
 * A PIN write never leaves the pad spinning (Round 3 leg 4, 2026-09-25).
 * PinSetup awaits setStaffPin / removeStaffPin with no try/catch — by the
 * surface's contract every action RESOLVES `{ error? }`. A THROWN pre-core
 * read (roster outage in getCurrentUserStaffId, or can() / staffWriteInScope
 * rejecting inside the non-self gate) must answer the action's own
 * `{ error }`, never a rejected action — and must stay a DIFFERENT answer
 * from a resolved-null actor (the core's own refusal), so an outage never
 * reads as a denial. Mock block copied from staff-protection-store-scope.
 */
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// Echo the i18n key so assertions read 'pinSetFailed' / 'noPermission'.
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {},
}))

const can = jest.fn<Promise<boolean>, [string]>(async () => true)
jest.mock('@/lib/auth/require-permission', () => ({
  can: (c: string) => can(c),
  requireCapability: jest.fn(async () => {}),
}))

jest.mock('@/lib/auth/store-scope', () => ({
  staffWriteInScope: jest.fn(async () => true),
  resolveStoreScope: jest.fn(async () => ({ viewAll: false })),
}))

const getCurrentUserStaffId = jest.fn<Promise<string | null>, []>()
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'actor-1'),
  getCurrentUserStaffId: () => getCurrentUserStaffId(),
}))

const setPin = jest.fn(async () => undefined)
const removePin = jest.fn(async () => undefined)
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ staff: { setPin, removePin } })),
  newSynqedClient: jest.fn(() => ({})),
}))

import { setStaffPin, removeStaffPin } from '@/actions/staff-pin'
import { staffWriteInScope as staffWriteInScopeImport } from '@/lib/auth/store-scope'

const staffWriteInScope = staffWriteInScopeImport as jest.Mock

const TARGET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACTOR = 'actor-1'
const outage = () => new Error('roster read failed')

beforeEach(() => {
  jest.clearAllMocks()
  getCurrentUserStaffId.mockResolvedValue(ACTOR)
  can.mockResolvedValue(true)
  staffWriteInScope.mockResolvedValue(true)
})

describe('setStaffPin / removeStaffPin — a thrown pre-core read answers { error }', () => {
  it('P1 setStaffPin: roster outage → pinSetFailed, core and gate untouched', async () => {
    getCurrentUserStaffId.mockRejectedValue(outage())
    await expect(setStaffPin(TARGET, '1234')).resolves.toEqual({ error: 'pinSetFailed' })
    expect(setPin).not.toHaveBeenCalled()
    expect(can).not.toHaveBeenCalled()
  })

  it('P2 removeStaffPin: roster outage → pinRemoveFailed, core untouched', async () => {
    getCurrentUserStaffId.mockRejectedValue(outage())
    await expect(removeStaffPin(TARGET)).resolves.toEqual({ error: 'pinRemoveFailed' })
    expect(removePin).not.toHaveBeenCalled()
  })

  it('P3 non-self: can() rejecting → pinSetFailed, clamp never asked, core untouched', async () => {
    can.mockRejectedValue(outage())
    await expect(setStaffPin(TARGET, '1234')).resolves.toEqual({ error: 'pinSetFailed' })
    expect(staffWriteInScope).not.toHaveBeenCalled()
    expect(setPin).not.toHaveBeenCalled()
  })

  it('P4 non-self: the clamp rejecting → pinSetFailed, core untouched', async () => {
    staffWriteInScope.mockRejectedValue(outage())
    await expect(setStaffPin(TARGET, '1234')).resolves.toEqual({ error: 'pinSetFailed' })
    expect(setPin).not.toHaveBeenCalled()
  })

  it('P5 self happy path is unchanged', async () => {
    await expect(setStaffPin(ACTOR, '1234')).resolves.toEqual({})
    expect(setPin).toHaveBeenCalledWith(ACTOR, '1234', ACTOR)
  })

  it('P6 a RESOLVED null actor still reaches the core refusal — never the outage line', async () => {
    getCurrentUserStaffId.mockResolvedValue(null)
    await expect(setStaffPin(TARGET, '1234')).resolves.toEqual({
      error: 'Not authorized to set a PIN',
    })
    expect(setPin).not.toHaveBeenCalled()
  })

  it('P7 non-self without staff.manage → noPermission, core untouched', async () => {
    can.mockResolvedValue(false)
    await expect(setStaffPin(TARGET, '1234')).resolves.toEqual({ error: 'noPermission' })
    expect(setPin).not.toHaveBeenCalled()
  })
})

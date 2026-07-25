// Edit-layer W2 PR-B (fleet round): the per-entry edit-save CORE (CAS via
// expected_version) + the cookie web wrapper. Pins: params reach updateEntry
// with expected_version/actor_staff_id/action:'EDIT' (category translated); a
// 409 maps to a typed conflict result with NO retry, no audit; the
// choke-point audit fires exactly once on success with customer_id (T1 web
// side); content bounds are enforced server-side too, not just the facade's
// zod (T4); the reverse category map is exact (T2).
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
}))

const auditSpy = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditSpy(...(a as [])) }))

const updateEntry = jest.fn(async () => ({ id: 'e1' }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords: { updateEntry } })),
}))

import {
  updateKaruteDetailEntry,
  updateKaruteDetailEntryWithClient,
  ENTRY_CONTENT_INVALID_ERROR,
} from '@/actions/karute'
import { SESSION_CATEGORY_TO_ENTRY_CATEGORY } from '@/lib/adapters/karute-detail'

beforeEach(() => jest.clearAllMocks())

// Test-only partial client cast — the mock only needs to satisfy updateEntry's
// call shape at runtime, not the full SynqedClient surface.
const fakeClient = { karuteRecords: { updateEntry } } as unknown as Parameters<
  typeof updateKaruteDetailEntryWithClient
>[0]
const actor = { actorId: 'auth-user-1', businessId: 'biz-1', source: 'web' as const }

describe('SESSION_CATEGORY_TO_ENTRY_CATEGORY — full reverse map (T2)', () => {
  it('covers exactly the 8 display categories, one canonical DB value each', () => {
    expect(SESSION_CATEGORY_TO_ENTRY_CATEGORY).toEqual({
      concern: 'SYMPTOM',
      condition: 'BODY_AREA',
      lifestyle: 'LIFESTYLE',
      treatment: 'TREATMENT',
      preference: 'PREFERENCE',
      product: 'PRODUCT',
      next: 'NEXT_VISIT',
      note: 'OTHER',
    })
  })
})

describe('updateKaruteDetailEntryWithClient — CAS core', () => {
  it('sends expected_version/actor_staff_id/action:EDIT, translates category, emits the choke-point audit once', async () => {
    const result = await updateKaruteDetailEntryWithClient(
      fakeClient,
      'kar-1',
      'e1',
      { content: 'new body', category: 'concern', expectedVersion: 2, actorStaffId: 'staff-1' },
      actor,
      'cust-1',
    )
    expect(result).toEqual({ ok: true })
    expect(updateEntry).toHaveBeenCalledWith('kar-1', 'e1', {
      content: 'new body',
      category: 'SYMPTOM',
      expected_version: 2,
      actor_staff_id: 'staff-1',
      action: 'EDIT',
    })
    expect(auditSpy).toHaveBeenCalledTimes(1)
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.entry_edit',
        actorId: 'auth-user-1',
        businessId: 'biz-1',
        targetType: 'karute',
        targetId: 'kar-1',
        source: 'web',
        detail: { entry_id: 'e1', category: 'concern', customer_id: 'cust-1' },
      }),
    )
  })

  it('a 409 (stale version) maps to a typed conflict — no retry, no audit', async () => {
    updateEntry.mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409 }))
    const result = await updateKaruteDetailEntryWithClient(
      fakeClient,
      'kar-1',
      'e1',
      { expectedVersion: 1, actorStaffId: 'staff-1' },
      actor,
      null,
    )
    expect(result).toEqual({ conflict: true })
    expect(updateEntry).toHaveBeenCalledTimes(1)
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('trim-empty or >4000-char content is rejected before the write, no audit (T4)', async () => {
    const empty = await updateKaruteDetailEntryWithClient(
      fakeClient,
      'kar-1',
      'e1',
      { content: '   ', expectedVersion: 1, actorStaffId: 'staff-1' },
      actor,
      null,
    )
    expect(empty).toEqual({ validationError: ENTRY_CONTENT_INVALID_ERROR })
    const tooLong = await updateKaruteDetailEntryWithClient(
      fakeClient,
      'kar-1',
      'e1',
      { content: 'x'.repeat(4001), expectedVersion: 1, actorStaffId: 'staff-1' },
      actor,
      null,
    )
    expect(tooLong).toEqual({ validationError: ENTRY_CONTENT_INVALID_ERROR })
    expect(updateEntry).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })
})

describe('updateKaruteDetailEntry — web wrapper (T1 web side)', () => {
  it('collapses validationError into {error} for the sheet', async () => {
    const result = await updateKaruteDetailEntry('kar-1', 'e1', {
      content: '   ',
      expectedVersion: 1,
    })
    expect(result).toEqual({ error: ENTRY_CONTENT_INVALID_ERROR })
    expect(updateEntry).not.toHaveBeenCalled()
  })

  it('resolves actor_staff_id + audit identity, reaches the core untouched, customerId lands in detail', async () => {
    const result = await updateKaruteDetailEntry('kar-1', 'e1', {
      content: 'edited',
      expectedVersion: 3,
      customerId: 'cust-9',
    })
    expect(result).toEqual({ ok: true })
    expect(updateEntry).toHaveBeenCalledWith('kar-1', 'e1', {
      content: 'edited',
      expected_version: 3,
      actor_staff_id: 'staff-1',
      action: 'EDIT',
    })
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'karute.entry_edit',
        actorId: 'auth-user-1',
        businessId: 'biz-1',
        source: 'web',
        detail: { entry_id: 'e1', category: null, customer_id: 'cust-9' },
      }),
    )
  })
})

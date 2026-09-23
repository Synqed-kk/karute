// Edit-layer W2 PR-B (fleet round): the per-entry edit-save CORE (CAS via
// expected_version) + the cookie web wrapper. Pins: params reach updateEntry
// with expected_version/actor_staff_id/action:'EDIT' (category translated); a
// 409 maps to a typed conflict result with NO retry, no audit; the
// choke-point audit fires exactly once on success with customer_id (T1 web
// side); content bounds are enforced server-side too, not just the facade's
// zod (T4); the reverse category map is exact (T2).
//
// P3 (2026-08-19, core #69 / SDK 1.25): the receipt also carries
// entry_edit_id — the id updateEntry RETURNED, so the audit row points at
// core's entry_edits change row. Pinned here by exact-object detail matches
// (a dropped thread fails), plus no-cross-wiring and degraded-response cases.
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
// Store lock seam (⚖ 9/16): these cases are not about the store clamp, so the
// resolved scope is viewAll. The PREDICATE is untouched — it lives in the pure
// src/lib/auth/store-lock.ts, which nothing here mocks — so a lock deleted
// from a core still shows up as a behaviour change.
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({
    storeId: null,
    viewAll: true,
    allowedStoreIds: null,
    degraded: false,
  })),
  customerLensFor: jest.fn(() => undefined),
  storeStaffIdSet: jest.fn(async () => null),
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
}))

const auditSpy = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditSpy(...(a as [])) }))

// entry_edit_id is optional on the MOCK (not on the SDK type) so the degraded
// -core case below can resolve without it and prove the null normalization.
const updateEntry = jest.fn(
  async (): Promise<{ id: string; entry_edit_id?: string }> => ({
    id: 'e1',
    entry_edit_id: 'edit-row-1',
  }),
)
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    karuteRecords: {
      updateEntry,
      // the web wrapper derives customer_id from the AUTHORITATIVE record
      get: jest.fn(async () => ({ id: 'kar-1', customer_id: 'cust-authoritative' })),
    },
  })),
}))

import { updateKaruteDetailEntry } from '@/actions/karute'
// The CAS core left the action file for the server-only module
// (PKT-SEC-CORES-D2, 2026-09-23); the web wrapper above stayed.
import { updateKaruteDetailEntryWithClient } from '@/lib/karute/karute.core'
import { ENTRY_CONTENT_INVALID_ERROR } from '@/types/karute'
import { STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'
import { SESSION_CATEGORY_TO_ENTRY_CATEGORY } from '@/lib/adapters/karute-detail'

/** These cases are about the edit core itself, not the store lock — every one
 *  of them already assumed an actor who may touch the record. */
const IN_SCOPE = { recordStoreId: 'store-1', scope: { viewAll: true, allowedStoreIds: null } }

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
    IN_SCOPE,
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
        detail: {
          entry_id: 'e1',
          category: 'concern',
          customer_id: 'cust-1',
          entry_edit_id: 'edit-row-1',
        },
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
    IN_SCOPE,
    )
    expect(result).toEqual({ conflict: true })
    expect(updateEntry).toHaveBeenCalledTimes(1)
    expect(auditSpy).not.toHaveBeenCalled()
  })

  // S5b armor (council stress round, 2026-08-19): the generic-error branch had
  // NO audit pin — every other "no audit" test either 409s or never reaches
  // updateEntry, so a receipt emitted after the 409 check survived all gates.
  // A failed write must leave no receipt: both error shapes are pinned, the
  // status-bearing upstream failure and the bare network throw (no `status`).
  it('a non-409 core failure returns {error} and writes NO receipt (S5b)', async () => {
    updateEntry.mockRejectedValueOnce(Object.assign(new Error('upstream boom'), { status: 500 }))
    const upstream = await updateKaruteDetailEntryWithClient(
      fakeClient,
      'kar-1',
      'e1',
      { expectedVersion: 1, actorStaffId: 'staff-1' },
      actor,
      null,
    IN_SCOPE,
    )
    expect(upstream).toEqual({ error: 'upstream boom' })
    expect(auditSpy).not.toHaveBeenCalled()

    updateEntry.mockRejectedValueOnce(new Error('socket hang up'))
    const network = await updateKaruteDetailEntryWithClient(
      fakeClient,
      'kar-1',
      'e1',
      { expectedVersion: 1, actorStaffId: 'staff-1' },
      actor,
      null,
    IN_SCOPE,
    )
    expect(network).toEqual({ error: 'socket hang up' })
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
    IN_SCOPE,
    )
    expect(empty).toEqual({ validationError: ENTRY_CONTENT_INVALID_ERROR })
    const tooLong = await updateKaruteDetailEntryWithClient(
      fakeClient,
      'kar-1',
      'e1',
      { content: 'x'.repeat(4001), expectedVersion: 1, actorStaffId: 'staff-1' },
      actor,
      null,
    IN_SCOPE,
    )
    expect(tooLong).toEqual({ validationError: ENTRY_CONTENT_INVALID_ERROR })
    expect(updateEntry).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })
})

describe('entry_edit_id receipt threading (P3, core #69 / SDK 1.25)', () => {
  const detailOf = (call: number) =>
    (auditSpy.mock.calls[call][0] as { detail: Record<string, unknown> }).detail

  const edit = (entryId: string) =>
    updateKaruteDetailEntryWithClient(
      fakeClient,
      'kar-1',
      entryId,
      { content: 'body', expectedVersion: 1, actorStaffId: 'staff-1' },
      actor,
      'cust-1',
    IN_SCOPE,
    )

  it('carries the id core RETURNED — a different response id changes the receipt', async () => {
    updateEntry.mockResolvedValueOnce({ id: 'e9', entry_edit_id: 'edit-row-FROM-CORE' })
    await edit('e9')
    expect(detailOf(0).entry_edit_id).toBe('edit-row-FROM-CORE')
  })

  it('distinct edits get distinct receipt ids — no cross-wiring', async () => {
    updateEntry.mockResolvedValueOnce({ id: 'e1', entry_edit_id: 'edit-row-A' })
    await edit('e1')
    updateEntry.mockResolvedValueOnce({ id: 'e2', entry_edit_id: 'edit-row-B' })
    await edit('e2')

    expect(auditSpy).toHaveBeenCalledTimes(2)
    expect(detailOf(0)).toMatchObject({ entry_id: 'e1', entry_edit_id: 'edit-row-A' })
    expect(detailOf(1)).toMatchObject({ entry_id: 'e2', entry_edit_id: 'edit-row-B' })
  })

  it('a degraded core response without the id writes null, never undefined', async () => {
    updateEntry.mockResolvedValueOnce({ id: 'e1' })
    await edit('e1')
    const detail = detailOf(0)
    expect(detail.entry_edit_id).toBeNull()
    // the key must still be PRESENT — an absent key and a null one read
    // differently in the 監査ログ (missing = never wired, null = core gave none).
    expect(Object.prototype.hasOwnProperty.call(detail, 'entry_edit_id')).toBe(true)
  })
})

describe('updateKaruteDetailEntry — web wrapper (T1 web side)', () => {
  it('clamped WEB caller + foreign record returns not_found and ONE refusal row with the resolved actor (RS-wiring)', async () => {
    const { resolveStoreScope } = jest.requireMock('@/lib/auth/store-scope') as {
      resolveStoreScope: jest.Mock
    }
    const { getSynqedClient } = jest.requireMock('@/lib/synqed/client') as {
      getSynqedClient: jest.Mock
    }
    resolveStoreScope.mockResolvedValueOnce({
      viewAll: false,
      allowedStoreIds: ['store-A'],
      degraded: false,
    })
    getSynqedClient.mockResolvedValueOnce({
      karuteRecords: {
        get: jest.fn(async () => ({
          id: 'kar-1',
          customer_id: 'cust-authoritative',
          store_id: 'store-B',
        })),
        updateEntry,
      },
    })

    const result = await updateKaruteDetailEntry('kar-1', 'e1', {
      content: 'edited',
      expectedVersion: 1,
    })

    expect(result).toEqual({ error: 'karute not found in this business' })
    expect(updateEntry).not.toHaveBeenCalled()
    expect(auditSpy).toHaveBeenCalledTimes(1)
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.store_write_refused',
        actorId: 'auth-user-1',
        actorType: 'staff',
        businessId: 'biz-1',
        targetType: 'karute',
        targetId: 'kar-1',
        source: 'web',
        severity: 'warning',
        requestId: expect.any(String),
        detail: {
          door: 'karute.entry_edit',
          record_store_id: 'store-B',
          code: 'not_found',
        },
      }),
    )
  })

  it('clamped WEB caller + degraded scope refuses entry-edit with NO refusal row and no write', async () => {
    const { resolveStoreScope } = jest.requireMock('@/lib/auth/store-scope') as {
      resolveStoreScope: jest.Mock
    }
    const { getSynqedClient } = jest.requireMock('@/lib/synqed/client') as {
      getSynqedClient: jest.Mock
    }
    resolveStoreScope.mockResolvedValueOnce({
      viewAll: false, allowedStoreIds: ['store-A'], degraded: true,
    })
    getSynqedClient.mockResolvedValueOnce({
      karuteRecords: {
        get: jest.fn(async () => ({
          id: 'kar-1', customer_id: 'cust-authoritative', store_id: 'store-A',
        })),
        updateEntry,
      },
    })

    const result = await updateKaruteDetailEntry('kar-1', 'e1', {
      content: 'edited', expectedVersion: 1,
    })

    expect(result).toEqual({ error: STORE_SCOPE_UNVERIFIED })
    expect(updateEntry).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('collapses validationError into {error} for the sheet', async () => {
    const result = await updateKaruteDetailEntry('kar-1', 'e1', {
      content: '   ',
      expectedVersion: 1,
    })
    expect(result).toEqual({ error: ENTRY_CONTENT_INVALID_ERROR })
    expect(updateEntry).not.toHaveBeenCalled()
  })

  it('resolves actor_staff_id + audit identity, reaches the core untouched, customer_id is SERVER-derived', async () => {
    const result = await updateKaruteDetailEntry('kar-1', 'e1', {
      content: 'edited',
      expectedVersion: 3,
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
        // from the mocked authoritative get(), never from any client input
        detail: {
          entry_id: 'e1',
          category: null,
          customer_id: 'cust-authoritative',
          entry_edit_id: 'edit-row-1',
        },
      }),
    )
  })
})

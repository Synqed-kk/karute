// Edit-layer W2 summary half: the whole-summary edit CORE + the cookie web
// wrapper. Pins: the write is edited_summary ONLY (never ai_summary, never
// entries — the full-replace foot-gun); the choke-point audit fires exactly
// once on success with before/after SNIPPETS (256-cap) + full lengths +
// customer_id; the no-change guard writes nothing and mints no audit row;
// content bounds are enforced server-side too (the entries T4 rule); the web
// wrapper derives before-text + customer_id from the AUTHORITATIVE record.
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

const update = jest.fn(async () => ({ id: 'kar-1' }))
const get = jest.fn(
  async (): Promise<{
    id: string
    customer_id: string
    ai_summary: string | null
    edited_summary: string | null
  }> => ({
    id: 'kar-1',
    customer_id: 'cust-authoritative',
    ai_summary: 'AIの要約',
    edited_summary: null,
  }),
)
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ karuteRecords: { update, get } })),
}))

import {
  updateKaruteDetailSummary,
  updateKaruteDetailSummaryWithClient,
} from '@/actions/karute'
import { ENTRY_CONTENT_INVALID_ERROR } from '@/types/karute'

beforeEach(() => jest.clearAllMocks())

const fakeClient = { karuteRecords: { update } } as unknown as Parameters<
  typeof updateKaruteDetailSummaryWithClient
>[0]
const actor = { actorId: 'auth-user-1', businessId: 'biz-1', source: 'web' as const }

describe('updateKaruteDetailSummaryWithClient — overlay core', () => {
  it('writes edited_summary + actor_staff_id ONLY — never ai_summary, never entries — and emits the choke-point audit once', async () => {
    const result = await updateKaruteDetailSummaryWithClient(
      fakeClient,
      'kar-1',
      { content: '・直した要約', actorStaffId: 'staff-1' },
      actor,
      'cust-1',
      '・元の要約',
    )
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledTimes(1)
    // Exact payload — an added ai_summary or entries key here would silently
    // clobber the AI original / full-replace human entry rows.
    expect(update).toHaveBeenCalledWith('kar-1', {
      edited_summary: '・直した要約',
      actor_staff_id: 'staff-1',
    })
    expect(auditSpy).toHaveBeenCalledTimes(1)
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.summary_edit',
        actorId: 'auth-user-1',
        businessId: 'biz-1',
        targetType: 'karute',
        targetId: 'kar-1',
        source: 'web',
        detail: {
          customer_id: 'cust-1',
          before: '・元の要約',
          after: '・直した要約',
          before_len: 5,
          after_len: 6,
        },
      }),
    )
  })

  it('caps before/after audit snippets at 256 chars and carries the FULL lengths', async () => {
    const before = 'あ'.repeat(300)
    const after = 'い'.repeat(400)
    await updateKaruteDetailSummaryWithClient(
      fakeClient,
      'kar-1',
      { content: after, actorStaffId: 'staff-1' },
      actor,
      null,
      before,
    )
    const detail = auditSpy.mock.calls[0][0].detail as Record<string, unknown>
    expect(detail.before).toBe('あ'.repeat(256))
    expect(detail.after).toBe('い'.repeat(256))
    expect(detail.before_len).toBe(300)
    expect(detail.after_len).toBe(400)
  })

  it('a never-summarized record audits before:null / before_len:0', async () => {
    await updateKaruteDetailSummaryWithClient(
      fakeClient,
      'kar-1',
      { content: '新規', actorStaffId: 'staff-1' },
      actor,
      null,
      null,
    )
    const detail = auditSpy.mock.calls[0][0].detail as Record<string, unknown>
    expect(detail.before).toBeNull()
    expect(detail.before_len).toBe(0)
  })

  it('no-change guard: identical content writes nothing and mints no audit row', async () => {
    const result = await updateKaruteDetailSummaryWithClient(
      fakeClient,
      'kar-1',
      { content: '・同じ要約', actorStaffId: 'staff-1' },
      actor,
      'cust-1',
      '・同じ要約',
    )
    expect(result).toEqual({ ok: true })
    expect(update).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('trim-empty or >4000-char content is rejected before the write, no audit', async () => {
    const empty = await updateKaruteDetailSummaryWithClient(
      fakeClient,
      'kar-1',
      { content: '   ', actorStaffId: 'staff-1' },
      actor,
      null,
      null,
    )
    expect(empty).toEqual({ validationError: ENTRY_CONTENT_INVALID_ERROR })
    const tooLong = await updateKaruteDetailSummaryWithClient(
      fakeClient,
      'kar-1',
      { content: 'x'.repeat(4001), actorStaffId: 'staff-1' },
      actor,
      null,
      null,
    )
    expect(tooLong).toEqual({ validationError: ENTRY_CONTENT_INVALID_ERROR })
    expect(update).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('an upstream failure returns {error} and no audit row (the log proves presence, never absence)', async () => {
    update.mockRejectedValueOnce(new Error('core down'))
    const result = await updateKaruteDetailSummaryWithClient(
      fakeClient,
      'kar-1',
      { content: '新規', actorStaffId: 'staff-1' },
      actor,
      null,
      null,
    )
    expect(result).toEqual({ error: 'core down' })
    expect(auditSpy).not.toHaveBeenCalled()
  })
})

describe('updateKaruteDetailSummary — web wrapper', () => {
  it('derives before-text + customer_id from the AUTHORITATIVE record (ai_summary when no overlay yet)', async () => {
    const result = await updateKaruteDetailSummary('kar-1', { content: '・直した要約' })
    expect(result).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith('kar-1', {
      edited_summary: '・直した要約',
      actor_staff_id: 'staff-1',
    })
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'karute.summary_edit',
        source: 'web',
        detail: expect.objectContaining({
          customer_id: 'cust-authoritative',
          before: 'AIの要約',
        }),
      }),
    )
  })

  it('an existing overlay wins as the before-text (edited ?? ai)', async () => {
    get.mockResolvedValueOnce({
      id: 'kar-1',
      customer_id: 'cust-authoritative',
      ai_summary: 'AIの要約',
      edited_summary: '前回の人間版',
    })
    await updateKaruteDetailSummary('kar-1', { content: '・さらに直した' })
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ before: '前回の人間版' }),
      }),
    )
  })

  it('collapses validationError into {error} for the sheet', async () => {
    const result = await updateKaruteDetailSummary('kar-1', { content: '   ' })
    expect(result).toEqual({ error: ENTRY_CONTENT_INVALID_ERROR })
    expect(update).not.toHaveBeenCalled()
  })
})

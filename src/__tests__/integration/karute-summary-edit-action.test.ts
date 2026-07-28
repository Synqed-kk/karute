// Edit-layer W2 summary half: the whole-summary edit CORE + the cookie web
// wrapper. Pins: the write is edited_summary ONLY (never ai_summary, never
// entries — the full-replace foot-gun); the choke-point audit fires exactly
// once on success with before_len/after_len + customer_id and NO record
// content (the emitter's log-drain PII rule — the text lives in core's
// lineage row); the no-change guard writes nothing and mints no audit row;
// content bounds are enforced server-side too (the entries T4 rule); the web
// wrapper derives before-value + customer_id from the AUTHORITATIVE record.
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
        // EXACT detail — lengths + ids ONLY. The emitter's interim sink is a
        // console line into log drains; its PII rule bans record content in
        // detail (audit.ts). The text itself lives in core's lineage row.
        detail: {
          customer_id: 'cust-1',
          before_len: 5,
          after_len: 6,
        },
      }),
    )
  })

  it('NO record content ever rides the audit detail — lengths only, any length (PII drain rule)', async () => {
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
    // toEqual (not objectContaining): a re-added before/after text key must
    // turn this red — it would be the codebase's only content-carrying emit.
    expect(detail).toEqual({ customer_id: null, before_len: 300, after_len: 400 })
  })

  it('a never-summarized record audits before_len:0', async () => {
    await updateKaruteDetailSummaryWithClient(
      fakeClient,
      'kar-1',
      { content: '新規', actorStaffId: 'staff-1' },
      actor,
      null,
      null,
    )
    const detail = auditSpy.mock.calls[0][0].detail as Record<string, unknown>
    expect(detail).toEqual({ customer_id: null, before_len: 0, after_len: 2 })
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
        // 'AIの要約' is 5 chars — before_len proves the authoritative
        // ai_summary was the before-value without the text riding the row.
        detail: { customer_id: 'cust-authoritative', before_len: 5, after_len: 6 },
      }),
    )
  })

  it('an existing overlay wins as the before-value (edited ?? ai)', async () => {
    get.mockResolvedValueOnce({
      id: 'kar-1',
      customer_id: 'cust-authoritative',
      ai_summary: 'AIの要約',
      edited_summary: '前回の人間版の要約だ',
    })
    await updateKaruteDetailSummary('kar-1', { content: '・さらに直した' })
    // 10-char overlay (not the 4-char ai_summary) is the before — proven by
    // length, no text in the row.
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ before_len: 10 }),
      }),
    )
  })

  it('collapses validationError into {error} for the sheet', async () => {
    const result = await updateKaruteDetailSummary('kar-1', { content: '   ' })
    expect(result).toEqual({ error: ENTRY_CONTENT_INVALID_ERROR })
    expect(update).not.toHaveBeenCalled()
  })
})

// Contract §7 / PR-M5 pieces ①②⑤ — the durable core sink (forwardToCore).
// Never directly tested before this PR: every existing audit suite only pins
// the console line (the "interim sink"), and forwardToCore itself silently
// dropped requestId (core's own request_id column now exists — ⑦, 2026-09-10)
// and never sent store_id at all. These tests mock the core client the same
// way app-api-audit-log.test.ts does and inspect the exact payload
// `synqed.audit.log(...)` receives.
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-key'

const auditLog = jest.fn(async (_input: Record<string, unknown>) => ({}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({ audit: { log: auditLog } })),
}))

import { audit, getCoreForwardDropCount, _resetCoreForwardDropCount } from '@/lib/audit'

// forwardToCore is fire-and-forget from audit()'s POV (after()/void, never
// awaited by the caller) — flush one macrotask so its dynamic import +
// synqed.audit.log() chain settles before asserting (same convention as
// thin-store-heal.test.ts's flushDynamicImport).
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  auditLog.mockClear()
  _resetCoreForwardDropCount()
})

describe('forwardToCore — requestId rides core\'s own request_id column (piece ①, ⑦)', () => {
  it('sends requestId top-level in the request_id column, not stuffed into detail', async () => {
    audit({
      category: 'staff',
      action: 'staff.add',
      actorId: 'u1',
      actorType: 'staff',
      businessId: 'biz-1',
      requestId: 'req-123',
      source: 'web',
    })
    await flush()
    expect(auditLog).toHaveBeenCalledTimes(1)
    expect(auditLog.mock.calls[0][0]).toMatchObject({ request_id: 'req-123' })
    expect(auditLog.mock.calls[0][0].detail).toBeUndefined()
  })

  it('the request_id column is independent of a caller-supplied detail.request_id (which passes through untouched)', async () => {
    audit({
      category: 'staff',
      action: 'staff.add',
      actorId: 'u1',
      actorType: 'staff',
      businessId: 'biz-1',
      requestId: 'req-outer',
      detail: { request_id: 'req-caller-supplied' },
      source: 'web',
    })
    await flush()
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      request_id: 'req-outer',
      detail: { request_id: 'req-caller-supplied' },
    })
  })

  it('with no requestId, the column is null (never omitted) and detail is sent as-is', async () => {
    audit({
      category: 'staff',
      action: 'staff.add',
      actorId: 'u1',
      actorType: 'staff',
      businessId: 'biz-1',
      source: 'web',
    })
    await flush()
    expect(auditLog.mock.calls[0][0]).toMatchObject({ request_id: null })
    expect(auditLog.mock.calls[0][0].detail).toBeUndefined()
  })

  it('the request_id column never touches an existing detail object (no merge, no request_id key added to it)', async () => {
    audit({
      category: 'customer',
      action: 'customer.memory_add',
      actorId: 'u1',
      actorType: 'staff',
      businessId: 'biz-1',
      requestId: 'req-456',
      detail: { memory_id: 'm-1' },
      source: 'web',
    })
    await flush()
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      request_id: 'req-456',
      detail: { memory_id: 'm-1' },
    })
  })

  it('a full uuid request id (36 chars) forwards intact — the column caps at 100, no truncation branch needed', async () => {
    const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
    expect(uuid.length).toBeLessThan(100)
    audit({
      category: 'staff',
      action: 'staff.add',
      actorId: 'u1',
      actorType: 'staff',
      businessId: 'biz-1',
      requestId: uuid,
      source: 'web',
    })
    await flush()
    expect(auditLog.mock.calls[0][0]).toMatchObject({ request_id: uuid })
  })
})

describe('forwardToCore — store_id (piece ②)', () => {
  it('sends store_id top-level when the event carries one', async () => {
    audit({
      category: 'booking',
      action: 'booking.create',
      actorId: 'u1',
      actorType: 'staff',
      businessId: 'biz-1',
      storeId: 'store-9',
      source: 'web',
    })
    await flush()
    expect(auditLog.mock.calls[0][0]).toMatchObject({ store_id: 'store-9' })
  })

  it('sends store_id: null when the event carries none (never omitted)', async () => {
    audit({
      category: 'staff',
      action: 'staff.add',
      actorId: 'u1',
      actorType: 'staff',
      businessId: 'biz-1',
      source: 'web',
    })
    await flush()
    expect(auditLog.mock.calls[0][0]).toMatchObject({ store_id: null })
  })
})

describe('forwardToCore — drop counter (piece ⑤ / contract §5)', () => {
  it('increments on a swallowed forward failure and logs audit_sink_error (pre-existing line, now counted)', async () => {
    auditLog.mockRejectedValueOnce(new Error('core unavailable'))
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(getCoreForwardDropCount()).toBe(0)

    audit({
      category: 'staff',
      action: 'staff.add',
      actorId: 'u1',
      actorType: 'staff',
      businessId: 'biz-1',
      source: 'web',
    })
    await flush()

    expect(getCoreForwardDropCount()).toBe(1)
    const parsed = warnSpy.mock.calls
      .map((args) => {
        try {
          return JSON.parse(String(args[0]))
        } catch {
          return null
        }
      })
      .filter((j): j is Record<string, unknown> => !!j)
    warnSpy.mockRestore()
    expect(parsed).toContainEqual(expect.objectContaining({ evt: 'audit_sink_error', action: 'staff.add' }))
  })

  it('does NOT increment on a successful forward', async () => {
    audit({
      category: 'staff',
      action: 'staff.add',
      actorId: 'u1',
      actorType: 'staff',
      businessId: 'biz-1',
      source: 'web',
    })
    await flush()
    expect(getCoreForwardDropCount()).toBe(0)
  })
})

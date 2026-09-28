// ⚖ S24 (PLAN-BUSINESS-LIVE v2.2 §2 S2, W0 PR (1)) — the desk's stamp. SYNQED
// Business (the computer version) writes through the phone's own shared cores,
// which emit with `source: actor.source`; the durable row carries no `source`
// column (forwardToCore never sends one), so the ONE home in audit.ts
// (stampBusinessVia, applied at the top of audit() and auditDurable()) adds
// `detail.via: 'business'` for a business-sourced event — on BOTH sinks, never
// overwriting a caller's own `via`, and with every other source's output
// byte-identical. Harness copied from audit-forward-to-core.test.ts (the core
// client mocked, one macrotask flushed for the fire-and-forget forward) plus a
// console spy for sink 1.
process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-key'

const auditLog = jest.fn<Promise<unknown>, [Record<string, unknown>]>(async () => ({}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({ audit: { log: auditLog } })),
}))

import { audit, auditDurable, type AuditEvent } from '@/lib/audit'

const flush = () => new Promise((r) => setTimeout(r, 0))

let logSpy: jest.SpyInstance
let warnSpy: jest.SpyInstance

beforeEach(() => {
  auditLog.mockReset()
  auditLog.mockImplementation(async () => ({}))
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  warnSpy.mockRestore()
})

/** Every `evt: 'audit'` console line either channel carried, parsed. */
function consoleLines(): Record<string, unknown>[] {
  return [...logSpy.mock.calls, ...warnSpy.mock.calls]
    .map((args) => {
      try {
        return JSON.parse(String(args[0])) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter((j): j is Record<string, unknown> => !!j && j.evt === 'audit')
}

const base = (over: Partial<AuditEvent>): AuditEvent => ({
  category: 'booking',
  action: 'booking.update',
  actorId: 'u1',
  actorType: 'staff',
  businessId: 'biz-1',
  storeId: 'store-1',
  targetType: 'customer',
  targetId: 'cust-1',
  requestId: 'req-1',
  source: 'web',
  ...over,
})

describe("source 'business' → detail.via 'business' on BOTH sinks", () => {
  it('audit(): the console line and the durable row both carry the stamp, the caller keeps its own object', async () => {
    const detail = { appointment_id: 'a1', changed: 'time' }
    audit(base({ source: 'business', detail }))
    await flush()
    const [line] = consoleLines()
    expect(line.source).toBe('business')
    expect(line.detail).toEqual({ appointment_id: 'a1', changed: 'time', via: 'business' })
    expect(auditLog).toHaveBeenCalledTimes(1)
    expect(auditLog.mock.calls[0][0].detail).toEqual({ appointment_id: 'a1', changed: 'time', via: 'business' })
    // Added on a copy — the caller's detail object is never mutated.
    expect(detail).toEqual({ appointment_id: 'a1', changed: 'time' })
  })

  it('audit(): no detail at all → one is created holding only the stamp (both sinks)', async () => {
    audit(base({ source: 'business' }))
    await flush()
    expect(consoleLines()[0].detail).toEqual({ via: 'business' })
    expect(auditLog.mock.calls[0][0].detail).toEqual({ via: 'business' })
  })

  it("audit(): a 'warning' event rides the warn channel with the stamp too", async () => {
    audit(base({ source: 'business', severity: 'warning', detail: { x: 1 } }))
    await flush()
    const warned = warnSpy.mock.calls.map((a) => JSON.parse(String(a[0])) as Record<string, unknown>)
    expect(warned).toContainEqual(expect.objectContaining({ evt: 'audit', detail: { x: 1, via: 'business' } }))
    expect(auditLog.mock.calls[0][0].detail).toEqual({ x: 1, via: 'business' })
  })

  it('auditDurable(): both sinks carry the stamp', async () => {
    await auditDurable(base({ source: 'business', detail: { customer_id: 'c1' } }))
    expect(consoleLines()[0].detail).toEqual({ customer_id: 'c1', via: 'business' })
    expect(auditLog.mock.calls[0][0].detail).toEqual({ customer_id: 'c1', via: 'business' })
  })
})

describe("an existing detail.via is kept (added, never overwriting)", () => {
  it.each([
    ['audit', (e: AuditEvent) => audit(e)],
    ['auditDurable', (e: AuditEvent) => auditDurable(e)],
  ] as const)('%s(): a caller-supplied via survives on both sinks', async (_name, emit) => {
    await emit(base({ source: 'business', detail: { via: 'invite', staff_id: 's1' } }))
    await flush()
    expect(consoleLines()[0].detail).toEqual({ via: 'invite', staff_id: 's1' })
    expect(auditLog.mock.calls[0][0].detail).toEqual({ via: 'invite', staff_id: 's1' })
  })
})

describe("every other source is byte-identical — no via key, payload exactly as before", () => {
  const OTHERS = ['web', 'facade', 'system'] as const

  it.each(OTHERS)("source '%s' with a detail: the SAME detail object reaches core, the console line is unchanged", async (source) => {
    const detail = { appointment_id: 'a1', changed: 'staff' }
    audit(base({ source, detail }))
    await flush()
    const { at, ...line } = consoleLines()[0]
    expect(typeof at).toBe('string')
    expect(line).toEqual({
      evt: 'audit',
      category: 'booking',
      action: 'booking.update',
      actor_id: 'u1',
      actor_type: 'staff',
      business_id: 'biz-1',
      target_type: 'customer',
      target_id: 'cust-1',
      severity: 'info',
      break_glass: false,
      detail: { appointment_id: 'a1', changed: 'staff' },
      request_id: 'req-1',
      store_id: 'store-1',
      source,
    })
    expect(auditLog.mock.calls[0][0]).toEqual({
      actor_id: 'u1',
      actor_type: 'staff',
      category: 'booking',
      action: 'booking.update',
      target_type: 'customer',
      target_id: 'cust-1',
      detail: { appointment_id: 'a1', changed: 'staff' },
      request_id: 'req-1',
      store_id: 'store-1',
      break_glass: false,
      severity: 'info',
    })
    // Not a copy: the stamp's home returns the event untouched.
    expect(auditLog.mock.calls[0][0].detail).toBe(detail)
  })

  it.each(OTHERS)("source '%s' with no detail: console detail null, durable detail undefined — nothing created", async (source) => {
    await auditDurable(base({ source }))
    expect(consoleLines()[0].detail).toBeNull()
    expect(auditLog.mock.calls[0][0].detail).toBeUndefined()
    expect(JSON.stringify(consoleLines()[0])).not.toContain('"via"')
  })
})

describe('auditDurable() keeps its { ok, rowId } shape with the stamp present', () => {
  it('a landed row → { ok: true, rowId }', async () => {
    auditLog.mockImplementationOnce(async () => ({ id: 'row-9' }))
    const res = await auditDurable(base({ source: 'business', detail: { customer_id: 'c1' } }))
    expect(res).toEqual({ ok: true, rowId: 'row-9' })
    expect(auditLog.mock.calls[0][0].detail).toEqual({ customer_id: 'c1', via: 'business' })
  })

  it('a failed forward → { ok: false }, the console line still stamped', async () => {
    auditLog.mockRejectedValueOnce(new Error('core unavailable'))
    const res = await auditDurable(base({ source: 'business' }))
    expect(res).toEqual({ ok: false })
    expect(consoleLines()[0].detail).toEqual({ via: 'business' })
  })

  it('no businessId → { ok: false } with no durable call, the console line still stamped', async () => {
    const res = await auditDurable(base({ source: 'business', businessId: null }))
    expect(res).toEqual({ ok: false })
    expect(auditLog).not.toHaveBeenCalled()
    expect(consoleLines()[0].detail).toEqual({ via: 'business' })
  })
})

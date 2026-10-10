// N7 — drop accounting (item 102 fix batch 1; R-S112-5 F6, R-S112-6 NITs).
import { buildClientReport, buildSessionAggregates, rebuildEnvelope, wrapTransport } from '@/lib/observability/sentry-exit'
import type { BaseTransportOptions, Envelope, Transport } from '@sentry/core'

const HEX32 = '0123456789abcdef0123456789abcdef'
const HEX16 = '0123456789abcdef'

function harness() {
  const sent: unknown[] = []
  const counted: unknown[][] = []
  const inner = () => ({ send: (e: unknown) => { sent.push(e); return Promise.resolve({}) }, flush: () => Promise.resolve(true) }) as unknown as Transport
  const opts = { url: 'http://127.0.0.1:9/1', recordDroppedEvent: (...a: unknown[]) => { counted.push(a) } } as unknown as BaseTransportOptions
  return { sent, counted, transport: wrapTransport(inner, { log: true })(opts) }
}

describe('N7 drop accounting', () => {
  let spy: jest.SpyInstance
  beforeEach(() => { spy = jest.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => spy.mockRestore())

  it('1000 bad spans + 500 past the cap: ONE log line per envelope, onDrop per item unchanged', async () => {
    const tx = { event_id: HEX32, type: 'transaction', spans: [...Array(1000).fill({ span_id: 'x' }), ...Array(500).fill({ span_id: HEX16, trace_id: HEX32 })] }
    const calls: unknown[][] = []
    rebuildEnvelope([{}, [[{ type: 'transaction' }, tx]]], (...a) => { calls.push(a) })
    expect(calls.filter((c) => c[1] === 'required_field')).toHaveLength(1000)
    expect(calls.filter((c) => c[1] === 'over_limit')).toEqual([['span', 'over_limit', undefined, 500]])
    const h = harness()
    await h.transport.send([{}, [[{ type: 'transaction' }, tx]]] as unknown as Envelope)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(spy.mock.calls[0][1])).toEqual([
      { item: 'span', reason: 'required_field', count: 1000 },
      { item: 'span', reason: 'over_limit', count: 500 },
    ])
    expect(h.counted.reduce((n, c) => n + (c[2] as number), 0)).toBe(1500)
  })

  it('50 dropped alarms → ONE constant alarm carrying the count', async () => {
    const h = harness()
    const bad = Array.from({ length: 50 }, () => [{ type: 'event' }, { event_id: 'nope', tags: { alarm: '1' } }])
    await h.transport.send([{}, [[{ type: 'event' }, { event_id: HEX32 }], ...bad]] as unknown as Envelope)
    const items = (h.sent[0] as unknown[][])[1] as [Record<string, unknown>, Record<string, unknown>][]
    const constants = items.filter((it) => (it[1].tags as Record<string, unknown> | undefined)?.alarm_kind === 'exit_drop')
    expect(items).toHaveLength(2)
    expect(constants).toHaveLength(1)
    expect(constants[0][1].extra).toEqual({ count: 50 })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('a non-array items list is reported as envelope:unreadable', () => {
    for (const items of ['str', { a: 1 }, null, 5]) {
      const calls: unknown[][] = []
      expect(rebuildEnvelope([{}, items], (...a) => { calls.push(a) })).toBeNull()
      expect(calls).toEqual([['envelope', 'unreadable', undefined, undefined]])
    }
  })

  it('empty {} entries are omitted from frames[], aggregates[] and discarded_events[]', () => {
    const ev = { event_id: HEX32, exception: { values: [{ type: 'E', stacktrace: { frames: [{ filename: 'data:x', function: '田中' }, { lineno: 3 }] } }] } }
    const out = JSON.stringify(rebuildEnvelope([{}, [[{ type: 'event' }, ev]]]))
    expect(out).toContain('"frames":[{"lineno":3}]')
    expect(buildSessionAggregates({ aggregates: [{ x: 1 }, { exited: 1 }] }).aggregates).toEqual([{ exited: 1 }])
    expect(buildClientReport({ discarded_events: [{ reason: 'A B' }, { quantity: 2 }] }).discarded_events).toEqual([{ quantity: 2 }])
  })
})

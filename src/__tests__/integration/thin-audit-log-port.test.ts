/**
 * Audit-log entry of the thin actions port (design-parity packet 17 §S3 —
 * 監査ログ tab live). Pins the TRANSPORT contract (mirrors
 * thin-stores-port.test.ts's style):
 *   - query serialization: absent/false filters omitted, booleans as '1',
 *     page always sent (default 1).
 *   - 2xx → the union forwarded VERBATIM — it already IS the contract, both
 *     the ok:true and the ok:false (core-failure parity) shape.
 *   - 403 → { ok:false, error:'forbidden' } (capability missing).
 *   - 401 → { ok:false, error:'failed' } (transient auth — AuthGate owns
 *     session death; never render a permissions error for a dying token).
 *   - transport reject / other non-2xx → { ok:false, error:'failed' }.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { listAuditLog } from '../../../thin/ports/actions.vite'

describe('thin actions port — audit-log transport contract', () => {
  it('no filters → only page=1 is sent', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe('/api/app/v1/audit-log?page=1')
      return new Response(
        JSON.stringify({ ok: true, events: [], total: 0, page: 1, hasMore: false, breakGlassTotal: null, targetLabels: {} }),
        { status: 200 },
      )
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await listAuditLog({})
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('serializes filters: booleans as "1", false/absent omitted, page forwarded', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe(
        '/api/app/v1/audit-log?category=staff&to=2026-06-30T00%3A00%3A00.000Z&targetId=cus-9&includeViews=1&page=2',
      )
      return new Response(JSON.stringify({ ok: true, events: [], total: 0, page: 2, hasMore: false, breakGlassTotal: null, targetLabels: {} }), {
        status: 200,
      })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await listAuditLog({
      category: 'staff',
      to: '2026-06-30T00:00:00.000Z',
      targetId: 'cus-9',
      includeViews: true,
      breakGlass: false,
      page: 2,
    })
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('2xx ok:true body forwarded VERBATIM', async () => {
    const body = {
      ok: true,
      events: [{ id: 'e1', at: '2026-07-21T00:00:00.000Z', actor_id: null, actor_type: 'system', category: 'auth', action: 'auth.login', target_type: null, target_id: null, target_label: null, detail: null, break_glass: false, severity: 'info' }],
      total: 1,
      page: 1,
      hasMore: false,
      breakGlassTotal: 0,
      targetLabels: {},
    }
    const apiFetch = jest.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listAuditLog({})).resolves.toEqual(body)
  })

  it('2xx ok:false body (core-failure parity envelope) forwarded VERBATIM', async () => {
    const body = { ok: false, error: 'failed' }
    const apiFetch = jest.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listAuditLog({})).resolves.toEqual(body)
  })

  it('403 → { ok:false, error:"forbidden" }', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 403 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listAuditLog({})).resolves.toEqual({ ok: false, error: 'forbidden' })
  })

  it('401 → { ok:false, error:"failed" } (transient auth, never a permissions error)', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 401 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listAuditLog({})).resolves.toEqual({ ok: false, error: 'failed' })
  })

  it('other non-2xx (500) → { ok:false, error:"failed" }', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 500 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listAuditLog({})).resolves.toEqual({ ok: false, error: 'failed' })
  })

  it('a transport reject → { ok:false, error:"failed" }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listAuditLog({})).resolves.toEqual({ ok: false, error: 'failed' })
  })

  // G2 (round-4 line-audit): the 警告/重大 tiles' server filters need the
  // phone transport to actually forward the real severity value, or the
  // facade's parseFilters support (route.ts) never gets exercised from the
  // phone — the "same reader path" both tiles rely on.
  //
  // R3 (round-2 line-audit, still the shape here): the assertion MUST live
  // outside the mock callback — facadeListAuditLog wraps the apiFetch call
  // in its own try/catch, which swallows a throw from inside the mock and
  // leaves the test's only real check (`toHaveBeenCalledTimes`) passing
  // regardless of what path was actually requested. Recording the path into
  // a variable and asserting on it after the `await` closes that hole.
  it('severity:"warn" is serialized as severity=warn, exactly once, under no other key', async () => {
    let capturedPath: string | undefined
    const apiFetch = jest.fn(async (path: string) => {
      capturedPath = path
      return new Response(
        JSON.stringify({
          ok: true,
          events: [],
          total: 0,
          page: 1,
          hasMore: false,
          breakGlassTotal: null,
          targetLabels: {},
        }),
        { status: 200 },
      )
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await listAuditLog({ severity: 'warn' })
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(capturedPath).toBe('/api/app/v1/audit-log?severity=warn&page=1')
  })

  it('severity:"critical" is serialized as severity=critical, exactly once, under no other key', async () => {
    let capturedPath: string | undefined
    const apiFetch = jest.fn(async (path: string) => {
      capturedPath = path
      return new Response(
        JSON.stringify({
          ok: true,
          events: [],
          total: 0,
          page: 1,
          hasMore: false,
          breakGlassTotal: null,
          targetLabels: {},
        }),
        { status: 200 },
      )
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await listAuditLog({ severity: 'critical' })
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(capturedPath).toBe('/api/app/v1/audit-log?severity=critical&page=1')
  })

  it('no severity in filters → no severity param', async () => {
    let capturedPath: string | undefined
    const apiFetch = jest.fn(async (path: string) => {
      capturedPath = path
      return new Response(
        JSON.stringify({
          ok: true,
          events: [],
          total: 0,
          page: 1,
          hasMore: false,
          breakGlassTotal: null,
          targetLabels: {},
        }),
        { status: 200 },
      )
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await listAuditLog({})
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(capturedPath).toBe('/api/app/v1/audit-log?page=1')
  })

  // PR D1 (amendment 4 F5): the thread deep-link's own filter — mirrors the
  // severity tests above (R3, round-2 line-audit: assert outside the mock
  // callback, a throw from inside it would be swallowed by facadeListAuditLog's
  // own try/catch).
  it("targetType:'recording' is serialized as targetType=recording, exactly once", async () => {
    let capturedPath: string | undefined
    const apiFetch = jest.fn(async (path: string) => {
      capturedPath = path
      return new Response(
        JSON.stringify({
          ok: true,
          events: [],
          total: 0,
          page: 1,
          hasMore: false,
          breakGlassTotal: null,
          targetLabels: {},
          folded: 0,
        }),
        { status: 200 },
      )
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await listAuditLog({ targetId: 'sess-1', targetType: 'recording' })
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(capturedPath).toBe('/api/app/v1/audit-log?targetId=sess-1&targetType=recording&page=1')
  })

  // PR D1 §2/§4: folded/threadPartial ride the 2xx body VERBATIM, same
  // forwarding contract as every other field on this union.
  it('2xx body carrying folded/threadPartial is forwarded VERBATIM', async () => {
    const body = {
      ok: true,
      events: [],
      total: 0,
      page: 1,
      hasMore: false,
      breakGlassTotal: null,
      targetLabels: {},
      folded: 2,
      threadPartial: true,
    }
    const apiFetch = jest.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listAuditLog({})).resolves.toEqual(body)
  })
})

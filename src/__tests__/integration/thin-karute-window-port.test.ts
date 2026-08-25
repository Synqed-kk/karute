/**
 * カルテ list 日付チャンク読み込み entry of the thin actions port (PR-2a).
 * The `satisfies typeof import('@/actions/karute').loadKaruteWindow` pin in
 * thin/ports/actions.vite.ts catches SIGNATURE drift only — never transport or
 * field mapping. These pin the wire contract:
 *   - the query string carries olderThan / month / loadedCount, and OMITS what
 *     the caller didn't send (an empty olderThan would silently restart the
 *     walk at the newest window)
 *   - a non-2xx maps to the declared {error} result, like the web action's catch
 *   - a MALFORMED 200 is an ERROR, never "no more history" — a silent empty
 *     window ends the list early and reads as the truth
 * Mirrors thin-karute-reassign-port.test.ts's style/idiom.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { loadKaruteWindow } from '../../../thin/ports/actions.vite'

const port = (apiFetch: jest.Mock) =>
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

const okBody = {
  items: [],
  windowStart: '2026-07-29',
  freshStoreTotal: 62,
  hasMore: true,
}

describe('thin actions port — karute window transport contract', () => {
  it('GETs /api/app/v1/karute/window with the params it was given', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe(
        '/api/app/v1/karute/window?olderThan=2026-08-12&loadedCount=24',
      )
      return new Response(JSON.stringify(okBody), { status: 200 })
    })
    port(apiFetch)

    const res = await loadKaruteWindow({ olderThan: '2026-08-12', loadedCount: 24 })
    expect(res).toEqual(okBody)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('omits params the caller did not send, and forwards month (PR-2b)', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe('/api/app/v1/karute/window?month=2026-07')
      return new Response(JSON.stringify({ ...okBody, hasMore: false }), { status: 200 })
    })
    port(apiFetch)
    await loadKaruteWindow({ month: '2026-07' })
  })

  it('sends loadedCount=0 explicitly (0 is a real count, not "unset")', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toContain('loadedCount=0')
      return new Response(JSON.stringify(okBody), { status: 200 })
    })
    port(apiFetch)
    await loadKaruteWindow({ olderThan: '2026-08-12', loadedCount: 0 })
  })

  it('a non-2xx maps to the declared {error} result', async () => {
    port(
      jest.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'upstream_unavailable' } }), {
            status: 502,
          }),
      ),
    )
    expect(await loadKaruteWindow({ olderThan: '2026-08-12' })).toEqual({
      error: 'upstream_unavailable',
    })
  })

  it('an OLD server that never learned this route (404 + HTML) maps to {error}, never a throw', async () => {
    // A release-18 bundle pointed at a server that predates the endpoint gets
    // Next's HTML 404 page, so `res.json()` REJECTS. The parse is guarded, so
    // the shell shows the retry line instead of an unhandled rejection
    // crossing the port boundary.
    port(
      jest.fn(
        async () =>
          new Response('<!DOCTYPE html><html><body>404</body></html>', {
            status: 404,
            headers: { 'content-type': 'text/html' },
          }),
      ),
    )
    expect(await loadKaruteWindow({ olderThan: '2026-08-12' })).toEqual({
      error: 'Request failed (404)',
    })
  })

  it('a transport rejection maps to {error}, never a throw across the boundary', async () => {
    port(
      jest.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await loadKaruteWindow({ olderThan: '2026-08-12' })).toEqual({ error: 'offline' })
  })

  it('a MALFORMED 200 is an error, never a silent end-of-history', async () => {
    port(jest.fn(async () => new Response(JSON.stringify({ items: 'nope' }), { status: 200 })))
    expect(await loadKaruteWindow({ olderThan: '2026-08-12' })).toEqual({
      error: 'Malformed window response',
    })

    port(jest.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })))
    expect(await loadKaruteWindow({ olderThan: '2026-08-12' })).toEqual({
      error: 'Malformed window response',
    })
  })

  it('a well-formed but partial 200 fills safe defaults rather than undefined', async () => {
    port(
      jest.fn(
        async () =>
          new Response(JSON.stringify({ items: [], windowStart: '2026-07-01' }), {
            status: 200,
          }),
      ),
    )
    expect(await loadKaruteWindow({ olderThan: '2026-07-15' })).toEqual({
      items: [],
      windowStart: '2026-07-01',
      freshStoreTotal: 0,
      hasMore: false,
    })
  })
})

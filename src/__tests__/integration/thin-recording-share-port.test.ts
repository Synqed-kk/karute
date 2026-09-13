/**
 * The recorder's own share toggle — the THIN (phone) entry of the actions
 * port (⚖ Liam 2026-09-13 sharing law; 2026-09-14 design D6/C5). No
 * Idempotency-Key: the body is idempotent by state (D6 step 5's no-op
 * guard), unlike the discard receipt's fail-closed trace.
 *
 * The wire only ever carries an AppApiErrorCode ('forbidden' | 'not_found' |
 * 'upstream_unavailable' | ...) — this port maps that onto the web action's
 * OWN error union (recording-share.ts), and `no_recording`/`not_found` are
 * genuinely indistinguishable at the wire (both arrive as 'not_found') —
 * this test proves the port is honest about that rather than inventing a
 * code the server never sends.
 */
import { setDataPort } from '@/lib/ports/data-port'

import { setRecordingShared } from '../../../thin/ports/actions.vite'

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const apiFetch = jest.fn(res)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

const errorBody = (code: string) => JSON.stringify({ error: { code, message: code } })

describe('thin actions port — recording share toggle', () => {
  it('POSTs the facade share route with { karuteId, shared } and NO Idempotency-Key', async () => {
    let seenPath: string | null = null
    let seenInit: RequestInit | undefined
    const apiFetch = port(async (path, init) => {
      seenPath = path
      seenInit = init
      return new Response(JSON.stringify({ shared: true }), { status: 200 })
    })

    await setRecordingShared('karute-1', true)

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(seenPath).toBe('/api/app/v1/recordings/share')
    expect(seenInit?.method).toBe('POST')
    expect(JSON.parse(String(seenInit?.body))).toEqual({ karuteId: 'karute-1', shared: true })
    const headers = seenInit?.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBeUndefined()
  })

  it('2xx → { ok: true, shared } reported back from the body', async () => {
    port(async () => new Response(JSON.stringify({ shared: false }), { status: 200 }))
    await expect(setRecordingShared('karute-1', false)).resolves.toEqual({ ok: true, shared: false })
  })

  it('a 403 body → { ok: false, error: "forbidden" }', async () => {
    port(async () => new Response(errorBody('forbidden'), { status: 403 }))
    await expect(setRecordingShared('karute-1', true)).resolves.toEqual({ ok: false, error: 'forbidden' })
  })

  it('a 404 body (not_found OR no_recording, indistinguishable at the wire) → { ok: false, error: "not_found" }', async () => {
    port(async () => new Response(errorBody('not_found'), { status: 404 }))
    await expect(setRecordingShared('karute-1', true)).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it.each([
    [502, 'upstream_unavailable'],
    [500, 'internal'],
    [400, 'validation'],
  ])('a %s body (%s) → { ok: false, error: "upstream" } — never invents a code the server did not send', async (status, code) => {
    port(async () => new Response(errorBody(code), { status }))
    await expect(setRecordingShared('karute-1', true)).resolves.toEqual({ ok: false, error: 'upstream' })
  })

  it('an unparseable non-2xx body → { ok: false, error: "upstream" }', async () => {
    port(async () => new Response('not json', { status: 502 }))
    await expect(setRecordingShared('karute-1', true)).resolves.toEqual({ ok: false, error: 'upstream' })
  })

  it('a network throw → { ok: false, error: "upstream" }, never rejects', async () => {
    port(async () => {
      throw new Error('offline')
    })
    await expect(setRecordingShared('karute-1', true)).resolves.toEqual({ ok: false, error: 'upstream' })
  })
})

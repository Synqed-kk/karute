/**
 * PR-6 — the phone's call into PR-7's capture-warning door (the THIN entry of
 * the actions port). It POSTs the one facade path with the recorder's input
 * verbatim, and it NEVER throws: the recorder fires the fact and forgets it,
 * so a refusal, an error body that parses, an unparseable body and a dead
 * socket each settle to one answer.
 *
 * Shape follows thin-recording-discard-port.test.ts.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { recordCaptureWarning } from '../../../thin/ports/actions.vite'

const INPUT = {
  recordingSessionId: '7c1f0a2b-4d3e-4f56-9a7b-8c9d0e1f2a3b',
  takeId: '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30',
  reason: 'server' as const,
  warnedAt: '2026-09-26T03:00:00.000Z',
}

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const apiFetch = jest.fn(res)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

describe('thin actions port — recordCaptureWarning', () => {
  it('POSTs the facade capture-warning path with the input as its JSON body', async () => {
    const apiFetch = port(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(recordCaptureWarning(INPUT)).resolves.toEqual({ ok: true })
    expect(apiFetch).toHaveBeenCalledTimes(1)
    const [path, init] = apiFetch.mock.calls[0]
    expect(path).toBe('/api/app/v1/recordings/capture-warning')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual(INPUT)
  })

  it.each([
    [403, JSON.stringify({ error: { code: 'forbidden', message: 'x' } }), 'forbidden'],
    [400, JSON.stringify({ error: { code: 'validation', message: 'x' } }), 'bad_input'],
    [502, JSON.stringify({ error: { code: 'upstream_unavailable', message: 'x' } }), 'failed'],
    [200, JSON.stringify({ error: 'not_found' }), 'not_found'],
    [200, JSON.stringify({ error: 'failed' }), 'failed'],
    [200, 'not json', 'failed'],
  ])('%i %s → { error: %s }', async (status, body, error) => {
    port(async () => new Response(body, { status }))
    await expect(recordCaptureWarning(INPUT)).resolves.toEqual({ error })
  })

  it('a dead socket settles too — it never throws', async () => {
    port(async () => {
      throw new TypeError('network')
    })
    await expect(recordCaptureWarning(INPUT)).resolves.toEqual({ error: 'failed' })
  })
})

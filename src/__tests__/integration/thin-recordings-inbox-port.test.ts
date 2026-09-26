/**
 * 録音履歴 entry of the thin actions port (Build F1). Pins the TRANSPORT
 * contract, in thin-audit-log-port.test.ts's shape:
 *   - the exact facade path (a typo here is invisible until a phone bake),
 *   - a non-2xx THROWS rather than degrading to [] — the store catches it and
 *     the card says 「一部の録音を読み込めませんでした」; a silent [] would render
 *     "nothing failed" to the one staffer whose recordings are what failed,
 *   - sessions extracted from the envelope, missing key → [].
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { listRecordingsInbox } from '../../../thin/ports/actions.vite'

const ROW = {
  recordingSessionId: 'sess-1',
  customerId: 'cust-1',
  createdAt: '2026-08-25T04:00:00.000Z',
  durationSeconds: 900,
  karuteRecordId: null,
  jobStatus: 'RUNNING',
  jobProbeFailed: false,
  jobLastError: null,
}

function port(res: (path: string) => Promise<Response>) {
  const apiFetch = jest.fn(res)
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

describe('thin actions port — 録音履歴 transport contract', () => {
  it('GETs the facade inbox path, with no query string', async () => {
    let seen: string | null = null
    const apiFetch = port(async (path: string) => {
      seen = path
      return new Response(JSON.stringify({ sessions: [ROW] }), { status: 200 })
    })
    await listRecordingsInbox()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(seen).toBe('/api/app/v1/recordings/inbox')
  })

  it('2xx → sessions extracted verbatim', async () => {
    port(async () => new Response(JSON.stringify({ sessions: [ROW] }), { status: 200 }))
    await expect(listRecordingsInbox()).resolves.toEqual([ROW])
  })

  it('an unknown jobStatus string survives the port (phones bake this DTO)', async () => {
    const future = { ...ROW, jobStatus: 'RETRY_SCHEDULED' }
    port(async () => new Response(JSON.stringify({ sessions: [future] }), { status: 200 }))
    await expect(listRecordingsInbox()).resolves.toEqual([future])
  })

  it('2xx with no sessions key → [] (never undefined into the fold)', async () => {
    port(async () => new Response(JSON.stringify({}), { status: 200 }))
    await expect(listRecordingsInbox()).resolves.toEqual([])
  })

  it.each([401, 403, 500, 502])('%d THROWS — the card must be able to say the list is partial', async (status) => {
    port(async () => new Response(JSON.stringify({ error: { message: 'no' } }), { status }))
    await expect(listRecordingsInbox()).rejects.toThrow(String(status))
  })

  it('a transport reject propagates too', async () => {
    port(async () => {
      throw new Error('network down')
    })
    await expect(listRecordingsInbox()).rejects.toThrow('network down')
  })
})

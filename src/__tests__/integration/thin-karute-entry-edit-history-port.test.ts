/**
 * Entry-history entry of the thin actions port (edit-layer W2 history-sheet
 * packet). Pins the TRANSPORT contract, mirroring thin-stores-port.test.ts's
 * style:
 *   - GET /api/app/v1/karute/[id]/entry-edits, unwraps { edits, truncated } —
 *     same result shape as the web action (listEntryEditHistory) so
 *     EntryHistorySheet behaves identically on both platforms.
 *   - a non-2xx response maps to { error: message }.
 *   - a transport rejection (network/DNS failure) maps to { error: message },
 *     NEVER an escaped rejection — same transport-rejection parity as
 *     facadeUpdateKaruteEntry (Greptile P1, #615).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { listEntryEditHistory } from '../../../thin/ports/actions.vite'

describe('thin actions port — entry-edit-history transport contract', () => {
  it('GET /api/app/v1/karute/[id]/entry-edits, unwraps { edits, truncated }', async () => {
    const edits = [
      {
        id: 'ed-1',
        entryIdOld: null,
        entryIdNew: 'e1',
        action: 'CREATE',
        actorName: '田中',
        contentBefore: null,
        contentAfter: 'a',
        createdAt: '2026-07-20T00:00:00.000Z',
      },
    ]
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe('/api/app/v1/karute/kar-1/entry-edits')
      return new Response(JSON.stringify({ edits, truncated: true }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listEntryEditHistory('kar-1')).resolves.toEqual({ edits, truncated: true })
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('an empty 200 body unwraps to [] / truncated:false', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ edits: [], truncated: false }), { status: 200 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listEntryEditHistory('kar-1')).resolves.toEqual({ edits: [], truncated: false })
  })

  it('a missing truncated field defaults to false (older cached response shape)', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ edits: [] }), { status: 200 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listEntryEditHistory('kar-1')).resolves.toEqual({ edits: [], truncated: false })
  })

  it('a non-2xx response (403) maps to { error: message }', async () => {
    const apiFetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listEntryEditHistory('kar-1')).resolves.toEqual({ error: 'forbidden' })
  })

  it('a non-2xx response with no parseable body falls back to a status message', async () => {
    const apiFetch = jest.fn(async () => new Response('not json', { status: 500 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listEntryEditHistory('kar-1')).resolves.toEqual({
      error: 'Request failed (500)',
    })
  })

  it('a transport rejection (network/DNS failure) maps to { error: message }, never an escaped rejection', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listEntryEditHistory('kar-1')).resolves.toEqual({ error: 'Load failed' })
  })
})

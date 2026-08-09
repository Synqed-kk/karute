/**
 * Customer-photos entries of the thin actions port (packet PR 9b
 * device-wiring delta, 2026-08-09). Pins the TRANSPORT contract, mirroring
 * thin-karute-entry-edit-history-port.test.ts's style:
 *   - listCustomerPhotos: GET /api/app/v1/customers/[id]/photos, unwraps
 *     { photos } — SAME result shape as the web action (listCustomerPhotos,
 *     src/actions/customers.ts, no try/catch there either); a non-2xx or
 *     transport failure THROWS (never returns {error}), matching how
 *     SessionPhotoCard's handlePresent consumes it (try/catch, toast on throw).
 *   - deleteCustomerPhoto: DELETE /api/app/v1/customers/[id]/photos/[photoId],
 *     resolves { success: true } | { success: false, error } — NEVER throws,
 *     matching the web action's own try/catch-everything contract (the
 *     discard-photos dialog Promise.all()s these with no per-call catch).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { listCustomerPhotos, deleteCustomerPhoto } from '../../../thin/ports/actions.vite'

describe('thin actions port — customer photos transport contract', () => {
  describe('listCustomerPhotos', () => {
    it('GET /api/app/v1/customers/[id]/photos, unwraps { photos }', async () => {
      const photos = [{ id: 'p1', signed_url: 'https://x/p1', category: 'before', caption: null }]
      const apiFetch = jest.fn(async (path: string) => {
        expect(path).toBe('/api/app/v1/customers/cust-1/photos')
        return new Response(JSON.stringify({ photos }), { status: 200 })
      })
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

      await expect(listCustomerPhotos('cust-1')).resolves.toEqual({ photos })
      expect(apiFetch).toHaveBeenCalledTimes(1)
    })

    it('an empty 200 body unwraps to []', async () => {
      const apiFetch = jest.fn(
        async () => new Response(JSON.stringify({ photos: [] }), { status: 200 }),
      )
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

      await expect(listCustomerPhotos('cust-1')).resolves.toEqual({ photos: [] })
    })

    it('a non-2xx response THROWS (never returns {error}) — matches the web action exactly', async () => {
      const apiFetch = jest.fn(
        async () => new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 }),
      )
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

      await expect(listCustomerPhotos('cust-1')).rejects.toThrow('forbidden')
    })

    it('a non-2xx response with no parseable body falls back to a status message', async () => {
      const apiFetch = jest.fn(async () => new Response('not json', { status: 500 }))
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

      await expect(listCustomerPhotos('cust-1')).rejects.toThrow('Request failed (500)')
    })

    it('a transport rejection (network/DNS failure) propagates — never swallowed', async () => {
      const apiFetch = jest.fn(async () => {
        throw new TypeError('Load failed')
      })
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

      await expect(listCustomerPhotos('cust-1')).rejects.toThrow('Load failed')
    })
  })

  describe('deleteCustomerPhoto', () => {
    it('DELETE /api/app/v1/customers/[id]/photos/[photoId] → { success: true }', async () => {
      const apiFetch = jest.fn(async (path: string, init?: RequestInit) => {
        expect(path).toBe('/api/app/v1/customers/cust-1/photos/photo-1')
        expect(init?.method).toBe('DELETE')
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

      await expect(deleteCustomerPhoto('cust-1', 'photo-1')).resolves.toEqual({ success: true })
    })

    it('a non-2xx response resolves { success: false, error } — never throws', async () => {
      const apiFetch = jest.fn(
        async () => new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 }),
      )
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

      await expect(deleteCustomerPhoto('cust-1', 'photo-1')).resolves.toEqual({
        success: false,
        error: 'not found',
      })
    })

    it('a non-2xx response with no parseable body falls back to a status message', async () => {
      const apiFetch = jest.fn(async () => new Response('not json', { status: 500 }))
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

      await expect(deleteCustomerPhoto('cust-1', 'photo-1')).resolves.toEqual({
        success: false,
        error: 'Delete failed (500)',
      })
    })

    it('a transport rejection resolves { success: false, error }, never an escaped rejection', async () => {
      const apiFetch = jest.fn(async () => {
        throw new TypeError('Load failed')
      })
      setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

      await expect(deleteCustomerPhoto('cust-1', 'photo-1')).resolves.toEqual({
        success: false,
        error: 'Load failed',
      })
    })
  })
})

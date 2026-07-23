// Port contract (packet-02 build #2). Proves the DataPort seam routes correctly
// on BOTH platforms: web = same-origin (byte-identical to today's fetch), shell =
// facade-prefixed. The Vite impl reads import.meta.env (jest can't parse that),
// so we test the pure routing pieces it is built from — facadeApiUrl + the
// same-origin default — which IS the behavior under test.

import type { DataPort } from '@/lib/ports/types'
import { sameOriginDataPort } from '@/lib/ports/data-port'
import { facadeApiUrl } from '@/lib/ports/rewrite'

describe('facadeApiUrl (shell URL rewrite)', () => {
  it('prefixes an app-relative /api path with the facade base', () => {
    expect(facadeApiUrl('https://karute-omega.vercel.app', '/api/ai/chat')).toBe(
      'https://karute-omega.vercel.app/api/ai/chat',
    )
  })
  it('normalizes a trailing slash on the base (never //api)', () => {
    expect(facadeApiUrl('https://x.dev/', '/api/export')).toBe('https://x.dev/api/export')
  })
  it('adds a leading slash when the path lacks one', () => {
    expect(facadeApiUrl('https://x.dev', 'api/export')).toBe('https://x.dev/api/export')
  })
  it('passes an already-absolute URL through untouched', () => {
    const signed = 'https://bucket.supabase.co/object/sign/abc?token=z'
    expect(facadeApiUrl('https://x.dev', signed)).toBe(signed)
  })
})

describe('DataPort routing', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('web (same-origin): apiFetch calls fetch with the path UNCHANGED', async () => {
    const spy = jest.fn(async () => new Response('ok'))
    global.fetch = spy as unknown as typeof fetch
    await sameOriginDataPort.apiFetch('/api/sync/quickreserve', { method: 'POST' })
    expect(spy).toHaveBeenCalledWith('/api/sync/quickreserve', { method: 'POST' })
  })

  it('shell (facade): apiFetch calls fetch with the facade-prefixed URL', async () => {
    const spy = jest.fn(async () => new Response('ok'))
    global.fetch = spy as unknown as typeof fetch
    // Replicates thin/ports/data.vite.ts without its import.meta wrapper.
    // deliverFile/supportsAutoDeliver (packet 23) aren't under test here —
    // see deliver-file-port.test.ts for those.
    const facadePort: DataPort = {
      apiFetch: (path, init) =>
        fetch(facadeApiUrl('https://karute-omega.vercel.app', path), init),
      deliverFile: async () => {
        throw new Error('not exercised in this suite')
      },
      supportsAutoDeliver: false,
    }
    await facadePort.apiFetch('/api/ai/extract', { method: 'POST' })
    expect(spy).toHaveBeenCalledWith(
      'https://karute-omega.vercel.app/api/ai/extract',
      { method: 'POST' },
    )
  })

  it('both implementations satisfy the DataPort interface', () => {
    const ports: DataPort[] = [sameOriginDataPort]
    expect(typeof ports[0].apiFetch).toBe('function')
  })
})

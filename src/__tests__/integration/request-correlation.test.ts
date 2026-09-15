/**
 * One id across the stack.
 *
 * Karute's facade has always minted a canonical requestId and stamped it on
 * audit rows. It never sent it to core, so core minted its own and the same
 * failure was logged under two unrelated keys. During the 2026-09-04 outage
 * that made a Karute 500 impossible to tie to the core request behind it.
 */
// resolveBearerIdentity eagerly builds the revocation client and throws
// 'config' without the anon key, turning every facade assertion into a 500.
// CI has no .env, so default it like the sibling app-api-* suites do.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
import {
  withRequestId,
  getRequestId,
} from '@/lib/observability/request-context'

// The published SDK is ESM and Jest cannot parse it, so every suite in this
// repo mocks it. This stub reproduces the real base class verbatim from
// node_modules/@synqed-kk/client/dist/client.js:94-124 — same URL shape, same
// header set, and critically the same merge order (`...init?.headers` LAST,
// so a subclass header wins). What is under test is the ActorSynqedClient
// override; the base is a faithful stand-in, not the shipped code.
jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  }
  class SynqedClient {
    baseUrl: string
    apiKey: string
    businessId: string
    constructor(config: { baseUrl: string; apiKey: string; businessId: string }) {
      this.baseUrl = config.baseUrl
      this.apiKey = config.apiKey
      this.businessId = config.businessId
    }
    private headersFor(init?: { headers?: Record<string, string> }) {
      return {
        'x-api-key': this.apiKey,
        'x-business-id': this.businessId,
        'Content-Type': 'application/json',
        ...init?.headers,
      }
    }
    async fetch(path: string, init?: RequestInit) {
      const res = await fetch(`${this.baseUrl}/v1${path}`, {
        ...init,
        headers: this.headersFor(init as { headers?: Record<string, string> }),
      })
      return res.json()
    }
    async fetchRaw(path: string, init?: RequestInit) {
      return fetch(`${this.baseUrl}/v1${path}`, {
        ...init,
        headers: this.headersFor(init as { headers?: Record<string, string> }),
      })
    }
  }
  return { SynqedClient, SynqedError }
})

import { newSynqedClient } from '@/lib/synqed/client'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'
import { createHmac } from 'node:crypto'

jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view'])),
}))

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

beforeEach(() => {
  process.env.SYNQED_CORE_URL = 'https://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-core-key'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  // captureFetch ASSIGNS to global.fetch, and restoreAllMocks does not undo a
  // direct assignment. Without this a later case silently inherits the
  // previous one's transport and the suite becomes order-dependent.
  global.fetch = ORIGINAL_FETCH
  jest.restoreAllMocks()
})

/** Mock global fetch and hand back the headers it was called with. */
function captureFetch() {
  // The parameters must be declared: jest infers mock.calls from the
  // implementation's signature, and a zero-arg one types calls as [], so
  // reading calls[0][1] is a type error.
  // The parameters must be declared: jest infers mock.calls from the
  // implementation's signature, and a zero-arg one types calls as [], so
  // reading calls[0][1] is a type error. They are named for the shape only.
  const spy = jest.fn((url: string, init?: RequestInit) => {
    void url
    void init
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  global.fetch = spy as unknown as typeof fetch
  return () => {
    const init = spy.mock.calls[0]?.[1]
    return (init?.headers ?? {}) as Record<string, string>
  }
}

describe('ambient request id', () => {
  it('is readable inside the scope', () => {
    withRequestId('req-1', () => {
      expect(getRequestId()).toBe('req-1')
    })
  })

  it('is null outside any request', () => {
    expect(getRequestId()).toBeNull()
  })

  it('survives an await boundary', async () => {
    await withRequestId('req-async', async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 1))
      // The whole reason for AsyncLocalStorage: getSynqedClient() is called
      // many awaits deep from the handler that minted the id.
      expect(getRequestId()).toBe('req-async')
    })
  })

  it('does not leak out of the scope', async () => {
    await withRequestId('req-scoped', async () => {
      expect(getRequestId()).toBe('req-scoped')
    })
    expect(getRequestId()).toBeNull()
  })

  it('keeps concurrent requests separate', async () => {
    const seen: string[] = []
    await Promise.all([
      withRequestId('req-a', async () => {
        await new Promise((r) => setTimeout(r, 5))
        seen.push(getRequestId()!)
      }),
      withRequestId('req-b', async () => {
        seen.push(getRequestId()!)
      }),
    ])
    expect(seen.sort()).toEqual(['req-a', 'req-b'])
  })
})

describe('outbound core calls carry the id', () => {
  it('sends x-request-id when there is an ambient id', async () => {
    const headers = captureFetch()

    await withRequestId('req-propagated', async () => {
      const client = newSynqedClient('biz-1')
      await client.fetch('/customers')
    })

    expect(headers()['x-request-id']).toBe('req-propagated')
  })

  it('sends no correlation header outside a request', async () => {
    // A cron or a script has no ambient id; core mints its own rather than
    // receiving an empty or bogus header.
    const headers = captureFetch()

    const client = newSynqedClient('biz-1')
    await client.fetch('/customers')

    expect(headers()['x-request-id']).toBeUndefined()
  })

  it('carries the actor token and the id together', async () => {
    const headers = captureFetch()

    await withRequestId('req-both', async () => {
      const client = newSynqedClient('biz-1', 'actor-token-abc')
      await client.fetch('/customers')
    })

    const h = headers()
    expect(h['x-request-id']).toBe('req-both')
    expect(h.Authorization).toBe('Bearer actor-token-abc')
  })

  it('does not disturb the SDK tenancy headers', async () => {
    const headers = captureFetch()

    await withRequestId('req-tenancy', async () => {
      const client = newSynqedClient('biz-42')
      await client.fetch('/customers')
    })

    const h = headers()
    expect(h['x-api-key']).toBe('test-core-key')
    expect(h['x-business-id']).toBe('biz-42')
  })

  it('propagates on the raw path too', async () => {
    // fetchRaw is the recording-job worker path; it needs correlation just as
    // much as the JSON one.
    const headers = captureFetch()

    await withRequestId('req-raw', async () => {
      const client = newSynqedClient('biz-1')
      await client.fetchRaw('/recording-jobs/claim', { method: 'POST' })
    })

    expect(headers()['x-request-id']).toBe('req-raw')
  })
})

/** The seam itself.
 *
 *  Everything above proves the two halves work in isolation. None of it would
 *  fail if the withRequestId wrapper were deleted from facadeHandler — and
 *  that one line is what makes the feature real. These go through the actual
 *  handler. */
describe('facadeHandler wires the mint to the outbound call', () => {
  const ISSUER = 'https://testproj.supabase.co/auth/v1'
  const SECRET = 'test-jwt-secret-do-not-use-in-prod'
  const HS_CONFIG: VerifierConfig = {
    issuer: ISSUER,
    audience: 'authenticated',
    hs256Secret: SECRET,
    algorithms: ['HS256'],
  }
  const route = { params: Promise.resolve({}) }
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

  function hs256Token() {
    const now = Math.floor(Date.now() / 1000)
    const header = b64({ alg: 'HS256', typ: 'JWT' })
    const payload = b64({
      sub: 'u1',
      iss: ISSUER,
      aud: 'authenticated',
      exp: now + 3600,
      iat: now,
    })
    const sig = createHmac('sha256', SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url')
    return `${header}.${payload}.${sig}`
  }

  function request(extra: Record<string, string> = {}) {
    return new Request('https://s/api/app/v1/x', {
      headers: { authorization: `Bearer ${hs256Token()}`, ...extra },
    })
  }

  it('sends the SAME id it hands the caller back', async () => {
    const headers = captureFetch()
    const handler = facadeHandler(
      'customer.read',
      async (ctx) => {
        const client = newSynqedClient('biz-1')
        await client.fetch('/customers')
        return ok(ctx, { done: true })
      },
      { config: HS_CONFIG },
    )

    const res = await handler(request(), route)
    expect(res.status).toBe(200)

    const minted = res.headers.get('request-id')
    expect(minted).toMatch(/^[0-9a-f-]{36}$/)
    // The link: one id on the response AND on the core call.
    expect(headers()['x-request-id']).toBe(minted)
  })

  it('forwards the SERVER mint, never a client-supplied header', async () => {
    // The facade deliberately refuses to let an untrusted client header become
    // the canonical id. Forwarding must honour that, or a caller could forge
    // the key that ties core's logs together.
    const headers = captureFetch()
    const handler = facadeHandler(
      'customer.read',
      async (ctx) => {
        const client = newSynqedClient('biz-1')
        await client.fetch('/customers')
        return ok(ctx, { done: true })
      },
      { config: HS_CONFIG },
    )

    const res = await handler(request({ 'request-id': 'forged-by-client' }), route)

    expect(headers()['x-request-id']).not.toBe('forged-by-client')
    expect(headers()['x-request-id']).toBe(res.headers.get('request-id'))
  })

  it('correlates a call made on the way to an ERROR response', async () => {
    // The failing request is the one most in need of correlation, which is why
    // the wrapper encloses the whole try/catch rather than the success path.
    const headers = captureFetch()
    const handler = facadeHandler(
      'customer.read',
      async () => {
        const client = newSynqedClient('biz-1')
        await client.fetch('/customers')
        throw new AppApiError('internal', 'boom')
      },
      { config: HS_CONFIG },
    )

    const res = await handler(request(), route)
    expect(res.status).toBe(500)
    expect(headers()['x-request-id']).toBe(res.headers.get('request-id'))
  })
})

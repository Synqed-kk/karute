/**
 * One id across the stack.
 *
 * Karute's facade has always minted a canonical requestId and stamped it on
 * audit rows. It never sent it to core, so core minted its own and the same
 * failure was logged under two unrelated keys. During the 2026-09-04 outage
 * that made a Karute 500 impossible to tie to the core request behind it.
 */
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

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env.SYNQED_CORE_URL = 'https://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-core-key'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  jest.restoreAllMocks()
})

/** Mock global fetch and hand back the headers it was called with. */
function captureFetch() {
  const spy = jest.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  global.fetch = spy as unknown as typeof fetch
  return () => {
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined
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

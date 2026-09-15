/**
 * 監査ログ round 2, PR C — the audit-watch cron's auth/allowlist/mode
 * plumbing (route.ts), same shape as api-auto-burn-auth.test.ts. The actual
 * candidate-finding + write logic is pinned in audit-watch-run.test.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/audit-watch/route'

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- now/mode/deadline are asserted via toHaveBeenCalledWith, not the body
const watchOneBusiness = jest.fn(async (businessId: string, now: Date, mode: 'dry' | 'write', deadline: number) => ({
  businessId,
  candidates: 0,
  written: 0,
  skipped: 0,
  truncated: false,
  error: false,
  unchecked: 0,
  list: [] as unknown[],
}))
jest.mock('@/lib/audit-watch/run', () => ({
  watchOneBusiness: (...a: unknown[]) => watchOneBusiness(...(a as [string, Date, 'dry' | 'write', number])),
}))

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.AUDIT_WATCH_BUSINESS_IDS = 'biz-1'
  delete process.env.AUDIT_WATCH_WRITE
})

describe('GET /api/audit-watch auth', () => {
  it('401s with no Authorization header', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        expect((await fetch({ method: 'GET' })).status).toBe(401)
        expect(watchOneBusiness).not.toHaveBeenCalled()
      },
    })
  })

  it('401s with a wrong bearer token', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer wrong' } })
        expect(res.status).toBe(401)
        expect(watchOneBusiness).not.toHaveBeenCalled()
      },
    })
  })

  it('401s (fail closed) when CRON_SECRET is not configured, even with a bearer', async () => {
    delete process.env.CRON_SECRET
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer anything' } })
        expect(res.status).toBe(401)
        expect(watchOneBusiness).not.toHaveBeenCalled()
      },
    })
  })

  it('an empty allowlist is a no-op, not a crash, and says so', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.AUDIT_WATCH_BUSINESS_IDS = ''
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ mode: 'dry', results: [] })
        expect(watchOneBusiness).not.toHaveBeenCalled()
        expect(warn.mock.calls.flat().join(' ')).toContain('AUDIT_WATCH_BUSINESS_IDS is empty')
      },
    })
    warn.mockRestore()
  })

  it('runs every allowlisted business with the correct bearer', async () => {
    process.env.AUDIT_WATCH_BUSINESS_IDS = 'biz-1, biz-2'
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
        expect(res.status).toBe(200)
        expect(watchOneBusiness).toHaveBeenCalledTimes(2)
        expect(await res.json()).toMatchObject({ results: expect.any(Array) })
      },
    })
  })

  // F-b: an error is not a green run — and the loop must not stop at the
  // first one; every OTHER business still gets its pass.
  it('F-b: one business erroring 500s the whole run, but the other business still ran', async () => {
    process.env.AUDIT_WATCH_BUSINESS_IDS = 'biz-1, biz-2'
    watchOneBusiness.mockImplementation(async (businessId) => ({
      businessId,
      candidates: 0,
      written: 0,
      skipped: 0,
      truncated: false,
      error: businessId === 'biz-1',
      unchecked: 0,
      list: [],
    }))
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
        expect(res.status).toBe(500)
        expect(watchOneBusiness).toHaveBeenCalledTimes(2)
        expect(watchOneBusiness).toHaveBeenCalledWith('biz-1', expect.any(Date), 'dry', expect.any(Number))
        expect(watchOneBusiness).toHaveBeenCalledWith('biz-2', expect.any(Date), 'dry', expect.any(Number))
        const body = await res.json()
        expect(body.results).toHaveLength(2)
      },
    })
  })

  it('a budget-stop (truncated) alone stays 200 — an honest budget stop is not an error', async () => {
    process.env.AUDIT_WATCH_BUSINESS_IDS = 'biz-1'
    watchOneBusiness.mockImplementation(async (businessId) => ({
      businessId,
      candidates: 0,
      written: 0,
      skipped: 0,
      truncated: true,
      error: false,
      unchecked: 0,
      list: [],
    }))
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
        expect(res.status).toBe(200)
      },
    })
  })
})

describe('GET /api/audit-watch mode resolution', () => {
  it('flag unset (default) → mode "dry", regardless of the bearer being correct', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
        expect((await res.json()).mode).toBe('dry')
        expect(watchOneBusiness).toHaveBeenCalledWith('biz-1', expect.any(Date), 'dry', expect.any(Number))
      },
    })
  })

  it('AUDIT_WATCH_WRITE=1 → mode "write"', async () => {
    process.env.AUDIT_WATCH_WRITE = '1'
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
        expect((await res.json()).mode).toBe('write')
        expect(watchOneBusiness).toHaveBeenCalledWith('biz-1', expect.any(Date), 'write', expect.any(Number))
      },
    })
  })

  it('?dry=1 forces mode "dry" even when AUDIT_WATCH_WRITE=1', async () => {
    process.env.AUDIT_WATCH_WRITE = '1'
    await testApiHandler({
      appHandler,
      url: '/api/audit-watch?dry=1',
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
        expect((await res.json()).mode).toBe('dry')
        expect(watchOneBusiness).toHaveBeenCalledWith('biz-1', expect.any(Date), 'dry', expect.any(Number))
      },
    })
  })
})

// PKT-AUDIT-WATCH-DRY-LOG-2026-09-11: the cron caller discards the response
// body and CRON_SECRET is Sensitive (unreadable by anyone) — nobody can call
// ?dry=1 by hand, so the log line is the only window onto a dry run.
describe('GET /api/audit-watch dry-run logging', () => {
  it('logs one [audit-watch] <mode> line per business, containing the businessId and written:0', async () => {
    process.env.AUDIT_WATCH_BUSINESS_IDS = 'biz-1, biz-2'
    // a prior test in this file overrides the mock's implementation for its
    // own case (e.g. truncated: true) and clearAllMocks() never restores it
    // — pin our own so this test doesn't depend on file order.
    watchOneBusiness.mockImplementation(async (businessId) => ({
      businessId,
      candidates: 0,
      written: 0,
      skipped: 0,
      truncated: false,
      error: false,
      unchecked: 0,
      list: [],
    }))
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } })
      },
    })
    const calls = log.mock.calls.filter(([tag]) => tag === '[audit-watch] dry')
    expect(calls).toHaveLength(2)
    for (const businessId of ['biz-1', 'biz-2']) {
      const call = calls.find(([, json]) => JSON.parse(json as string).businessId === businessId)
      expect(call).toBeDefined()
      // exact-shape check (not toMatchObject): a stray field — e.g. a name —
      // must fail this test, not slip through unnoticed.
      expect(JSON.parse(call![1] as string)).toEqual({
        businessId,
        candidates: 0,
        written: 0,
        skipped: 0,
        truncated: false,
        error: false,
        unchecked: 0,
        list: [],
      })
    }
    log.mockRestore()
  })

  it('logs nothing on the 401 path (no bearer, no log line)', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        expect((await fetch({ method: 'GET' })).status).toBe(401)
      },
    })
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

// CP1 (packet §GATES / item 8): a plain CRON_SECRET route, never a facade
// route — no actor resolution, no view receipt. Static source check, same
// spirit as the other route files' header comments.
describe('CP1 — audit-watch is NOT a facade route', () => {
  it('imports no facadeHandler and no listAuditLogWithClient (no actor, no view receipt)', () => {
    const routeSrc = readFileSync(join(process.cwd(), 'src/app/api/audit-watch/route.ts'), 'utf8')
    expect(routeSrc).not.toMatch(/\bimport\b[^\n]*\bfacadeHandler\b/)
    expect(routeSrc).not.toMatch(/\bimport\b[^\n]*\blistAuditLogWithClient\b/)
    expect(routeSrc).toMatch(/CRON_SECRET/)

    // P3-12: every read in this feature actually lives in run.ts, which the
    // check above never touched — extend the same source grep there.
    const runSrc = readFileSync(join(process.cwd(), 'src/lib/audit-watch/run.ts'), 'utf8')
    expect(runSrc).not.toMatch(/\bimport\b[^\n]*\bfacadeHandler\b/)
    expect(runSrc).not.toMatch(/\bimport\b[^\n]*\blistAuditLogWithClient\b/)
  })
})

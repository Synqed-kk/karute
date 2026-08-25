import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/cleanup/route'

// The cleanup cron deletes storage recordings + purges the AI cache with the
// service-role client, so the ONLY thing under test here is that it refuses to
// run without the correct Vercel-Cron bearer. Stub the destructive deps so a
// successful (authorized) call doesn't touch anything real.
const cleanupExpiredAiCache = jest.fn(async () => 0)
jest.mock('@/lib/ai-cache', () => ({
  cleanupExpiredAiCache: () => cleanupExpiredAiCache(),
}))
const storageRemove = jest.fn(async () => ({}))
type ListOpts = { limit: number; offset: number }
const storageList = jest.fn(async (_prefix: string, _opts: ListOpts) => ({
  data: [] as { name: string; created_at: string }[],
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        list: (prefix: string, opts: ListOpts) => storageList(prefix, opts),
        remove: storageRemove,
      }),
    },
  }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  storageList.mockImplementation(async () => ({ data: [] }))
})

describe('GET /api/cleanup auth', () => {
  it('401s with no Authorization header — never touches storage/cache', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(401)
        expect(cleanupExpiredAiCache).not.toHaveBeenCalled()
        expect(storageRemove).not.toHaveBeenCalled()
      },
    })
  })

  it('401s with a wrong bearer token', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer wrong' },
        })
        expect(res.status).toBe(401)
        expect(cleanupExpiredAiCache).not.toHaveBeenCalled()
      },
    })
  })

  it('401s (fail closed) when CRON_SECRET is not configured, even with a bearer', async () => {
    delete process.env.CRON_SECRET
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer anything' },
        })
        expect(res.status).toBe(401)
        expect(cleanupExpiredAiCache).not.toHaveBeenCalled()
      },
    })
  })

  it('runs with the correct bearer', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(200)
        expect(cleanupExpiredAiCache).toHaveBeenCalled()
      },
    })
  })
})

describe('GET /api/cleanup — the sweep sees the WHOLE bucket, not just page 1', () => {
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const fresh = new Date().toISOString()
  const page = (prefix: string, n: number, created_at = old) =>
    Array.from({ length: n }, (_, i) => ({ name: `${prefix}-${i}.webm`, created_at }))

  it('walks past the first page and deletes the orphans it finds there', async () => {
    // The storage list is paged. Before pagination this route called list() with
    // no options, took whatever one page it got, and left every later orphan in
    // the bucket. First page comes back FULL (the route's own limit), so the walk
    // must ask for more; the second page carries the file that proves it did.
    const first = page('p1', 1000)
    const second = [...page('p2', 2), { name: 'too-new.webm', created_at: fresh }]
    storageList.mockImplementation(async (_prefix, opts) => ({
      data: opts.offset === 0 ? first : opts.offset === 1000 ? second : [],
    }))

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ recordingsDeleted: 1002 })
      },
    })

    // Asked for a second page at all, and advanced by what page 1 RETURNED.
    expect(storageList.mock.calls.map(([, o]) => o.offset)).toEqual([0, 1000, 1003])
    const [deleted] = storageRemove.mock.calls[0] as unknown as [string[]]
    expect(deleted).toContain('p2-0.webm')
    // Age filter untouched — a file younger than an hour survives on any page.
    expect(deleted).not.toContain('too-new.webm')
  })
})

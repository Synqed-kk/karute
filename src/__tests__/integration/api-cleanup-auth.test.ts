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
// remove() answers with the objects it actually removed, so the mock mirrors the
// batch it was handed; a case that needs a shorter answer overrides it.
type RemoveResult = { data?: { name: string }[]; error?: { message: string } }
const removedAll = async (names: string[]): Promise<RemoveResult> => ({
  data: names.map((name) => ({ name })),
})
const storageRemove = jest.fn(removedAll)
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
  storageRemove.mockImplementation(removedAll)
})

// remove() is now called once per batch, so "was this name deleted?" is a
// question about the whole run, not about call 0.
const removedNames = () =>
  (storageRemove.mock.calls as unknown as [string[]][]).flatMap(([names]) => names)

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
    const deleted = removedNames()
    expect(deleted).toContain('p2-0.webm')
    // Age filter untouched — a file younger than an hour survives on any page.
    expect(deleted).not.toContain('too-new.webm')
  })
})

describe('GET /api/cleanup — deletion is batched and the count is honest', () => {
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const oldFiles = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `old-${i}.webm`, created_at: old }))

  const run = async () => {
    let body: { recordingsDeleted: number } = { recordingsDeleted: -1 }
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(200)
        body = await res.json()
      },
    })
    return body
  }

  it('splits 250 expired names across remove() calls of 100/100/50', async () => {
    // One oversized remove() carrying all 250 can be refused whole; batching
    // keeps every request inside a size the storage API actually accepts.
    storageList.mockImplementation(async (_prefix, opts) => ({
      data: opts.offset === 0 ? oldFiles(250) : [],
    }))

    expect(await run()).toMatchObject({ recordingsDeleted: 250 })

    const batches = (storageRemove.mock.calls as unknown as [string[]][]).map(
      ([names]) => names.length
    )
    expect(batches).toEqual([100, 100, 50])
    expect(removedNames()).toHaveLength(250)
  })

  it('does not count a batch storage refused, and still runs the batches after it', async () => {
    // The old code discarded remove()'s result and reported expired.length, so a
    // rejected request still came back as a successful deletion.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    storageList.mockImplementation(async (_prefix, opts) => ({
      data: opts.offset === 0 ? oldFiles(250) : [],
    }))
    let call = 0
    storageRemove.mockImplementation(async (names) =>
      ++call === 2 ? { error: { message: 'Payload too large' } } : removedAll(names)
    )

    // 250 expired, the middle batch of 100 refused → 150, not 250.
    expect(await run()).toMatchObject({ recordingsDeleted: 150 })

    // The failure neither aborted the sweep nor went unlogged.
    expect(storageRemove).toHaveBeenCalledTimes(3)
    expect(removedNames()).toHaveLength(250)
    expect(consoleError).toHaveBeenCalledWith(
      '[cleanup] recordings batch error:',
      expect.objectContaining({ message: 'Payload too large' })
    )
    consoleError.mockRestore()
  })

  it('counts what remove() returned, not what it was asked to delete', async () => {
    // An object can disappear between the listing and the delete — this system's
    // own post-transcription cleanup removes takes on exactly that path. remove()
    // answers with the objects it ACTUALLY removed, so a name that was already
    // gone must not be credited as a deletion.
    storageList.mockImplementation(async (_prefix, opts) => ({
      data: opts.offset === 0 ? oldFiles(3) : [],
    }))
    storageRemove.mockImplementation(async (names) => ({
      data: names.slice(1).map((name) => ({ name })), // old-0.webm vanished first
    }))

    // Asked to delete 3, storage removed 2.
    expect(await run()).toMatchObject({ recordingsDeleted: 2 })
    expect(removedNames()).toHaveLength(3)
  })

  it('never collects a row whose created_at is missing or unparseable', async () => {
    // `new Date(null) < cutoff` is the epoch — the old form read an ageless row
    // as two hours old and queued it for deletion.
    storageList.mockImplementation(async (_prefix, opts) => ({
      data:
        opts.offset === 0
          ? [
              { name: 'ageless.webm', created_at: null as unknown as string },
              { name: 'garbage-date.webm', created_at: 'not-a-date' },
              { name: 'genuinely-old.webm', created_at: old },
            ]
          : [],
    }))

    expect(await run()).toMatchObject({ recordingsDeleted: 1 })
    expect(removedNames()).toEqual(['genuinely-old.webm'])
  })
})

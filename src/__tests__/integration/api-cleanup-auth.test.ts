import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/cleanup/route'

// The cleanup cron reads storage + purges the AI cache with the service-role
// client. Two things under test: it refuses to run without the correct
// Vercel-Cron bearer, and — since 2026-09-03, ⚖ audio is never deleted — it
// REPORTS orphan candidates and removes nothing. Stub the destructive deps so a
// successful (authorized) call doesn't touch anything real.
const cleanupExpiredAiCache = jest.fn(async () => 0)
jest.mock('@/lib/ai-cache', () => ({
  cleanupExpiredAiCache: () => cleanupExpiredAiCache(),
}))
// The remove fake exists ONLY to prove it is never called (see the afterEach
// below). It still answers the way storage does, so a regression that brought
// deletion back would run rather than crash — and be caught for what it is.
type RemoveResult = { data?: { name: string }[]; error?: { message: string } }
const removedAll = async (names: string[]): Promise<RemoveResult> => ({
  data: names.map((name) => ({ name })),
})
const storageRemove = jest.fn(removedAll)
type ListOpts = { limit: number; offset: number }
// A page that fails answers with data null + an error, so the mock's shape has
// to be able to say that, not just hand back rows.
type ListResult = {
  data: { name: string; id: string | null; created_at: string }[] | null
  error?: { message: string }
}
const storageList = jest.fn(
  async (_prefix: string, _opts: ListOpts): Promise<ListResult> => ({ data: [] })
)
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

// The sweep's whole output besides the count: one structured warn line per
// orphan candidate. Silenced (a 1000-row page would drown the run) and read
// back here, so "counted 1002" can be checked against WHICH names.
const warn = jest.spyOn(console, 'warn')
const reported = (): string[] =>
  warn.mock.calls.flatMap(([, row]) => {
    const line = row as { evt?: string; name?: string } | undefined
    return line?.evt === 'recordings_orphan_candidate' && line.name ? [line.name] : []
  })

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  storageList.mockImplementation(async () => ({ data: [] }))
  storageRemove.mockImplementation(removedAll)
  warn.mockImplementation(() => {})
})

// THE invariant of this route, asserted after every single case in the file
// rather than in the one test that happens to be about it: nothing in the
// recordings bucket is ever removed, on any path, at any age.
afterEach(() => {
  expect(storageRemove).not.toHaveBeenCalled()
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
    Array.from({ length: n }, (_, i) => ({
      name: `${prefix}-${i}.webm`,
      id: `${prefix}-${i}`,
      created_at,
    }))

  it('walks past the first page and reports the orphans it finds there', async () => {
    // The storage list is paged. Before pagination this route called list() with
    // no options, took whatever one page it got, and left every later orphan
    // unseen. First page comes back FULL (the route's own limit), so the walk
    // must ask for more; the second page carries the file that proves it did.
    const first = page('p1', 1000)
    const second = [...page('p2', 2), { name: 'too-new.webm', id: 'too-new', created_at: fresh }]
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
        // A walk that reached the end of the bucket says so. 1002 old junk
        // names counted; 'too-new.webm' is inside the hour, so it is not.
        expect(await res.json()).toMatchObject({
          recordingsOrphanCandidates: 1002,
          recordingsSweepComplete: true,
        })
      },
    })

    // Asked for a second page at all, and advanced by what page 1 RETURNED.
    expect(storageList.mock.calls.map(([, o]) => o.offset)).toEqual([0, 1000, 1003])
    expect(reported()).toContain('p2-0.webm')
    expect(reported()).not.toContain('too-new.webm')
  })

  it('logs a mid-walk list failure instead of ending the sweep silently', async () => {
    // A failed page also answers with data null, so taking only `data` made it
    // indistinguishable from the end of the bucket: the route finished the
    // partial sweep, reported success, and left no trace anywhere that the
    // orphans past the failure were never looked at.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const first = page('p1', 1000)
    storageList.mockImplementation(async (_prefix, opts) =>
      opts.offset === 0 ? { data: first } : { data: null, error: { message: 'list failed' } }
    )

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        // The cron reads only the status, so a sweep that never saw the rest of
        // the bucket has to come back failed — a 200 here recorded the run as a
        // clean pass and nobody was alerted.
        expect(res.status).toBe(500)
        // The failure still neither throws nor strands page 1: those names were
        // genuinely listed and genuinely expired, so the count reports exactly
        // them, and the body says the sweep was not finished.
        expect(await res.json()).toMatchObject({
          recordingsOrphanCandidates: 1000,
          recordingsSweepComplete: false,
        })
      },
    })

    expect(storageList.mock.calls.map(([, o]) => o.offset)).toEqual([0, 1000])
    expect(reported()).toHaveLength(1000)
    expect(consoleError).toHaveBeenCalledWith(
      '[cleanup] recordings list error:',
      expect.objectContaining({ message: 'list failed' })
    )
    consoleError.mockRestore()
  })

  it('says the sweep is incomplete when the runaway page bound stops the walk', async () => {
    // A bucket that keeps answering with rows exhausts MAX_PAGES. The walk is
    // genuinely partial — everything past the bound was never listed — and the
    // response has to admit it, exactly as the mid-walk failure does.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    storageList.mockImplementation(async (_prefix, opts) => ({
      data: [{ name: `endless-${opts.offset}.webm`, id: `endless-${opts.offset}`, created_at: old }],
    }))

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(500)
        // One row per page for 100 pages: everything it DID see is reported, and
        // the status admits the walk stopped short.
        expect(await res.json()).toMatchObject({
          recordingsOrphanCandidates: 100,
          recordingsSweepComplete: false,
        })
      },
    })

    expect(storageList).toHaveBeenCalledTimes(100)
    expect(consoleError).toHaveBeenCalledWith(
      '[cleanup] recordings walk hit MAX_PAGES; bucket may extend past it'
    )
    consoleError.mockRestore()
  })
})

describe('GET /api/cleanup — the sweep reports, it does not delete', () => {
  const UUID = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
  const TAKE = `app_biz-1_${UUID}.webm`
  const ancient = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString()
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  const run = async () => {
    let body: { recordingsOrphanCandidates: number } = { recordingsOrphanCandidates: -1 }
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

  it('leaves a ten-year-old conforming take alone and never even names it', async () => {
    // THE bug this PR fixes: the old sweep deleted every object past an hour
    // with no look at the job behind it, so a queued/failed/retrying take lost
    // its audio at the next daily cron. Age says nothing about a take now.
    storageList.mockImplementation(async (_prefix, opts) => ({
      data: opts.offset === 0 ? [{ name: TAKE, id: 'take-1', created_at: ancient }] : [],
    }))

    expect(await run()).toMatchObject({ recordingsOrphanCandidates: 0 })
    expect(reported()).toEqual([])
  })

  it('counts and names junk older than an hour — and still deletes none of it', async () => {
    storageList.mockImplementation(async (_prefix, opts) => ({
      data:
        opts.offset === 0
          ? [
              { name: 'junk.webm', id: 'junk-1', created_at: old },
              { name: 'rec_legacy.webm', id: 'rec-legacy-1', created_at: old },
            ]
          : [],
    }))

    expect(await run()).toMatchObject({ recordingsOrphanCandidates: 2 })
    expect(reported()).toEqual(['junk.webm', 'rec_legacy.webm'])
  })

  it('skips the seg/ folder placeholder by shape, not by the created_at accident', async () => {
    // list('') on the root returns the segment tree as a row with `id: null` —
    // storage-js's own signal for a folder, no real object behind it — and no
    // real created_at either. Paired with a genuinely old DOTLESS junk object
    // that DOES carry an id: a route that skipped on "no dot" instead of the
    // real placeholder signal, or one that silently reported nothing at all,
    // both fail this the same way a route that does it right does not.
    storageList.mockImplementation(async (_prefix, opts) => ({
      data:
        opts.offset === 0
          ? [
              { name: 'seg', id: null, created_at: null as unknown as string },
              { name: 'seg', id: null, created_at: old },
              { name: 'ageless.webm', id: 'ageless-1', created_at: null as unknown as string },
              { name: 'garbage-date.webm', id: 'garbage-date-1', created_at: 'not-a-date' },
              { name: 'garbage', id: 'garbage-1', created_at: old },
            ]
          : [],
    }))

    // Only the dotless junk object has BOTH a real id and a real timestamp —
    // the two placeholders are skipped on id alone, the other two on created_at,
    // and 'garbage' is the ONE candidate: a route reporting nothing at all
    // cannot pass this fixture by accident.
    expect(await run()).toMatchObject({ recordingsOrphanCandidates: 1 })
    expect(reported()).toEqual(['garbage'])
  })
})

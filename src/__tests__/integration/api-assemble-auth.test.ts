import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/assemble/route'

// The nightly assembler cron reads the bucket with the service-role client and
// WRITES an object into it — the first job in the app that does. Two things
// under test: it refuses to run without the correct Vercel-Cron bearer (fail
// CLOSED, including when CRON_SECRET is not configured at all), and its HTTP
// status tells the scheduler the truth — a walk that could not see the whole
// tree is a 500, while a run that merely ran out of tonight's budget is a 200,
// because tomorrow continues where it stopped.
//
// runAssembler itself is doubled: its own behaviour is proved in
// recording-assembler.test.ts, and a route test that reached storage would be
// testing the fake bucket twice.
const runAssembler = jest.fn(async (_deps: unknown, _opts: { budgetMs: number }) => summary())
/** `mock`-prefixed so jest's hoisting lets the factory below close over it. */
let mockDepsThrow: Error | null = null
jest.mock('@/lib/recording/assembler', () => ({
  runAssembler: (deps: unknown, opts: { budgetMs: number }) => runAssembler(deps, opts),
  realAssemblerDeps: () => {
    if (mockDepsThrow) throw mockDepsThrow
    return { coreFor: () => ({}), now: () => 0 }
  },
}))

const summary = (over: Record<string, unknown> = {}) => ({
  candidates: 0,
  assembled: 0,
  partial: 0,
  skipped: {
    young: 0,
    objectExists: 0,
    noRow: 0,
    settled: 0,
    noSeq0: 0,
    extMismatch: 0,
    deviceReturned: 0,
    error: 0,
  },
  walkComplete: true,
  budgetExhausted: false,
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  mockDepsThrow = null
  runAssembler.mockImplementation(async () => summary())
})

describe('GET /api/assemble — the route’s own constants', () => {
  // The 270 s budget is measured against THIS number, and the route test
  // doubles the assembler module — so without these two lines a maxDuration
  // lowered to 30 would survive the whole battery while the budget silently
  // outran the wall.
  it('declares maxDuration 300 — the wall the 270 s budget is cut against', () => {
    expect(appHandler.maxDuration).toBe(300)
  })

  it('exports GET and nothing else — a cron reads, it is never posted to', () => {
    expect(typeof appHandler.GET).toBe('function')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect((appHandler as unknown as Record<string, unknown>)[method]).toBeUndefined()
    }
  })
})

describe('GET /api/assemble auth', () => {
  it('401s with no Authorization header — never touches the bucket', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET' })
        expect(res.status).toBe(401)
        expect(runAssembler).not.toHaveBeenCalled()
      },
    })
  })

  it('401s with a wrong bearer token', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer wrong' } })
        expect(res.status).toBe(401)
        expect(runAssembler).not.toHaveBeenCalled()
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
        expect(runAssembler).not.toHaveBeenCalled()
      },
    })
  })

  it('runs with the correct bearer, on the worker’s 270s budget inside a 300s function', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(200)
        expect(runAssembler).toHaveBeenCalledTimes(1)
        expect(runAssembler.mock.calls[0][1]).toEqual({ budgetMs: 270_000 })
      },
    })
  })
})

describe('GET /api/assemble — a job that cannot reach core says so', () => {
  // realAssemblerDeps builds a core client up front precisely so a missing
  // SYNQED_CORE_URL / _API_KEY is a 500 the scheduler can see, rather than a
  // green 200 whose body reports skipped.error === candidates.
  it('a missing core env is a 500 BEFORE any walk, never a green 200', async () => {
    mockDepsThrow = new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(500)
        expect(runAssembler).not.toHaveBeenCalled()
      },
    })
  })
})

describe('GET /api/assemble — the status is the run’s own honesty', () => {
  it('a walk that could not see the whole tree is a 500, whatever it managed to do', async () => {
    runAssembler.mockImplementation(async () => summary({ walkComplete: false, assembled: 3 }))
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(500)
        expect(await res.json()).toMatchObject({ walkComplete: false, assembled: 3 })
      },
    })
  })

  it('a budget stop is a 200 — the walk saw every candidate, and tomorrow continues', async () => {
    runAssembler.mockImplementation(async () =>
      summary({ budgetExhausted: true, candidates: 40, assembled: 20 }),
    )
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ budgetExhausted: true, assembled: 20 })
      },
    })
  })
})

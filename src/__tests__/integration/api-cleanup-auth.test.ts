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
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        list: async () => ({ data: [] }),
        remove: storageRemove,
      }),
    },
  }),
}))

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
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

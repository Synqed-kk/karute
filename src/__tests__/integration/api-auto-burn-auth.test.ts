/**
 * The 自動消化 cron SPENDS CUSTOMER MONEY, so its Bearer gate is pinned the
 * same way /api/cleanup's is (api-cleanup-auth.test.ts) — including the
 * fail-CLOSED case where CRON_SECRET simply isn't configured.
 */
import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/packs/auto-burn/route'

const autoBurnForBusiness = jest.fn(async () => ({ businessId: 'biz-1', burned: 0 }))
jest.mock('@/lib/packs/auto-burn', () => ({
  autoBurnForBusiness: (...a: unknown[]) => autoBurnForBusiness(...(a as [])),
}))
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: jest.fn(() => ({})) }))

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.AUTO_BURN_BUSINESS_IDS = 'biz-1'
})

describe('GET /api/packs/auto-burn auth', () => {
  it('401s with no Authorization header — nothing is burned', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        expect((await fetch({ method: 'GET' })).status).toBe(401)
        expect(autoBurnForBusiness).not.toHaveBeenCalled()
      },
    })
  })

  it('401s with a wrong bearer token', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'GET', headers: { authorization: 'Bearer wrong' } })
        expect(res.status).toBe(401)
        expect(autoBurnForBusiness).not.toHaveBeenCalled()
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
        expect(autoBurnForBusiness).not.toHaveBeenCalled()
      },
    })
  })

  it('runs the allowlisted businesses with the correct bearer', async () => {
    process.env.AUTO_BURN_BUSINESS_IDS = 'biz-1, biz-2'
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(200)
        expect(autoBurnForBusiness).toHaveBeenCalledTimes(2)
        expect(await res.json()).toMatchObject({ results: expect.any(Array) })
      },
    })
  })

  it('an empty allowlist is a no-op, not a crash', async () => {
    process.env.AUTO_BURN_BUSINESS_IDS = ''
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(200)
        expect(autoBurnForBusiness).not.toHaveBeenCalled()
      },
    })
  })

  it("one tenant's failure never skips the rest", async () => {
    process.env.AUTO_BURN_BUSINESS_IDS = 'biz-1,biz-2'
    autoBurnForBusiness.mockRejectedValueOnce(new Error('boom'))
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'GET',
          headers: { authorization: 'Bearer test-cron-secret' },
        })
        expect(res.status).toBe(200)
        expect(autoBurnForBusiness).toHaveBeenCalledTimes(2)
        expect((await res.json()).results[0]).toMatchObject({ error: 'boom' })
      },
    })
  })
})

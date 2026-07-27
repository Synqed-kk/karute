import { testApiHandler } from 'next-test-api-route-handler'

// The summarize route boots ai-rate-limit, which pulls in @synqed-kk/client
// (native ESM) + supabase auth. Stub the rate-limit boundary entirely — its
// behavior is covered separately and isn't relevant to the route's parse path.
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimit: jest.fn(async () => null),
  reportAiUsage: jest.fn(async () => undefined),
  estimateCostCents: jest.fn(() => 1),
}))

// The plan gate pulls entitlements (native-ESM SDK) — stub the boundary like
// the rate limiter above. Allowed by default; the gate's own behavior is
// covered in api-extract.test.ts + subscription-enforcement.test.ts.
jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => true),
}))

// Mutable auth scenario for the fail-fast guard test below (declared before
// the jest.mock call it's referenced from — see consent-save-gate.test.ts).
const authScenario: { user: { id: string } | null } = { user: { id: 'user-1' } }

// Supabase server client is used for the auth guard + the org-settings
// lookup. Return a chain stub so .from().select().limit().single() resolves
// without a real DB.
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: authScenario.user }, error: null })) },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null }),
    })),
  })),
}))

// getOrgSettings pulls @synqed-kk/client (native ESM) — stub it like the other
// boundaries above so the route loads without the real SDK.
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => null),
}))

import * as appHandler from '@/app/api/ai/summarize/route'

jest.mock('@/lib/openai', () => ({
  openai: {
    chat: { completions: { parse: jest.fn() } },
  },
}))

import { openai } from '@/lib/openai'
import { mockSummaryResult } from './helpers/openai-mocks'

describe('POST /api/ai/summarize', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authScenario.user = { id: 'user-1' }
  })

  it('returns 401 for anonymous callers before the rate limiter runs (fail-fast auth guard)', async () => {
    authScenario.user = null
    const { enforceAiRateLimit } = jest.requireMock('@/lib/ai-rate-limit')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })

        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toBe('Unauthorized')
        expect(enforceAiRateLimit).not.toHaveBeenCalled()
      },
    })
  })

  it('returns summary for valid transcript', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: mockSummaryResult } }],
    })

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: 'Client visited for color treatment.',
            locale: 'en',
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toHaveProperty('summary')
        expect(typeof body.summary).toBe('string')
        expect(body.summary).toBe(mockSummaryResult.summary)
      },
    })
  })

  it('returns 400 when transcript is missing', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })

        expect(response.status).toBe(400)
      },
    })
  })

  it('returns 400 when transcript is empty', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: '   ' }),
        })

        expect(response.status).toBe(400)
      },
    })
  })

  it('returns 500 when OpenAI fails', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockRejectedValue(
      new Error('OpenAI API error')
    )

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: 'Client visited for color treatment.',
            locale: 'en',
          }),
        })

        expect(response.status).toBe(500)
      },
    })
  })
})

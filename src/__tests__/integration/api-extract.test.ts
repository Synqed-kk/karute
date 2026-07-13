import { testApiHandler } from 'next-test-api-route-handler'

// The extract route boots ai-rate-limit, which pulls in @synqed-kk/client
// (native ESM) + supabase auth. Stub the rate-limit boundary entirely — its
// behavior is covered separately and isn't relevant to the route's parse path.
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimit: jest.fn(async () => null),
  reportAiUsage: jest.fn(async () => undefined),
  estimateCostCents: jest.fn(() => 1),
}))

// The plan gate pulls entitlements (native-ESM SDK) — stub the boundary like
// the rate limiter above. Default allowed; the 403 test flips it per-case.
jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => true),
}))

// Supabase server client is used for the org-settings lookup. Return a chain
// stub so .from().select().limit().single() resolves without a real DB.
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null }),
    })),
  })),
}))

// getOrgSettings pulls @synqed-kk/client (native ESM) for the business-type
// lookup — stub it like the other boundaries above so the route loads without
// the real SDK. Null → the route uses the neutral default persona.
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => null),
}))

import * as appHandler from '@/app/api/ai/extract/route'

jest.mock('@/lib/openai', () => ({
  openai: {
    chat: { completions: { parse: jest.fn() } },
  },
}))

import { openai } from '@/lib/openai'
import { mockExtractionResult } from './helpers/openai-mocks'

describe('POST /api/ai/extract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns extracted entries for valid transcript', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: mockExtractionResult } }],
    })

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript: 'Client wanted natural brown hair.',
            locale: 'en',
          }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toHaveProperty('entries')
        expect(Array.isArray(body.entries)).toBe(true)
        expect(body.entries).toHaveLength(mockExtractionResult.entries.length)
      },
    })
  })

  it('returns 403 PLAN_LOCKED when the plan gate says no', async () => {
    const { featureAllowed } = jest.requireMock('@/lib/subscription/feature-gate')
    ;(featureAllowed as jest.Mock).mockResolvedValueOnce(false)

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })

        expect(response.status).toBe(403)
        const body = await response.json()
        expect(body.error).toBe('PLAN_LOCKED')
        expect(featureAllowed).toHaveBeenCalledWith('aiKaruteGeneration')
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

  it('returns 400 when transcript is empty string', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: '' }),
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
            transcript: 'Client wanted natural brown hair.',
            locale: 'en',
          }),
        })

        expect(response.status).toBe(500)
      },
    })
  })
})

import { testApiHandler } from 'next-test-api-route-handler'

// The summarize route boots ai-rate-limit, which pulls in @synqed-kk/client
// (native ESM) + supabase auth. Stub the rate-limit boundary entirely — its
// behavior is covered separately and isn't relevant to the route's parse path.
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimit: jest.fn(async () => null),
  reportAiUsage: jest.fn(async () => undefined),
  estimateCostCents: jest.fn(() => 1),
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
        // summary is now a bullet ARRAY (SummaryResultSchema), not a string.
        expect(Array.isArray(body.summary)).toBe(true)
        expect(body.summary).toEqual(mockSummaryResult.summary)
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

import { testApiHandler } from 'next-test-api-route-handler'

// The suggestions route boots ai-rate-limit, which pulls in @synqed-kk/client
// (native ESM) + supabase auth. Stub the rate-limit boundary entirely, same
// convention as api-extract.test.ts / api-summarize.test.ts.
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimit: jest.fn(async () => null),
  reportAiUsage: jest.fn(async () => undefined),
}))

// getOrgSettings pulls @synqed-kk/client (native ESM) for the business-type
// lookup — stub it like the other boundaries above so the route loads without
// the real SDK.
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => null),
}))

// ai-cache.ts does a VALUE import of @synqed-kk/client (needed to construct
// SynqedClient), so any test that reaches it unmocked pulls the untransformed
// ESM package into the graph (house convention — see api-cleanup-auth.test.ts,
// daily-attention-ai-cache-key.test.ts).
jest.mock('@/lib/ai-cache', () => ({
  getCachedAI: jest.fn(async () => null),
  setCachedAI: jest.fn(async () => undefined),
}))

// The LLM call itself isn't the concern of this route's auth test — stub the
// core so a pre-guard anonymous call can't reach real OpenAI.
const runKaruteSuggestions = jest.fn(async () => ({
  result: { suggestions: [] },
  usage: null as { tokensIn: number; tokensOut: number } | null,
}))
jest.mock('@/lib/ai/karute-suggestions', () => ({
  runKaruteSuggestions: (...args: unknown[]) => runKaruteSuggestions(...(args as [])),
}))

// Mutable auth scenario for the fail-fast guard test below (declared before
// the jest.mock call it's referenced from — see consent-save-gate.test.ts).
const authScenario: { user: { id: string } | null } = { user: { id: 'user-1' } }
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({
    auth: { getUser: jest.fn(async () => ({ data: { user: authScenario.user }, error: null })) },
  })),
}))

import * as appHandler from '@/app/api/ai/suggestions/route'

describe('POST /api/ai/suggestions', () => {
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
        expect(runKaruteSuggestions).not.toHaveBeenCalled()
      },
    })
  })
})

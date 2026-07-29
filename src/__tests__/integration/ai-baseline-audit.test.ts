// 監査ログ Wave W1 — ai.* baseline writers (contract §3.1, build packet
// 2026-07-28). Proves:
//   (a) the five promoted FACADE_AUDIT_MAP rows are LIVE (no pendingWave)
//       with the exact expected action strings.
//   (b) each of the four legacy /api/ai/* web routes emits auditWeb() exactly
//       once, with the expected category+action and a non-empty requestId, on
//       every non-error (mocked success) return path — and never emits on an
//       auth-fail/rate-limit/validation/catch error path ("errors are not
//       actions"). Every success-path assertion additionally pins the emit's
//       CLOSED shape (exact key set) so a stray PII-shaped field landing in a
//       future edit fails loud, not just the fields we bothered to name.
//   (c) a detail-less audit() event prints `detail: null` on the console
//       line, never `undefined`.
//   (d) the web (cookie) twin of karute.ai.suggestedMessage —
//       src/lib/karute/ai-outreach.ts's getSuggestedFollowUp — emits on its
//       one success path and never on its internal-error path (fix round #2:
//       this was the real coverage gap the blind round found).
// Mocking conventions copied from api-extract.test.ts / api-summarize.test.ts
// / api-suggestions.test.ts / api-transcribe.test.ts (the #632-era guard
// tests that already drive these four routes) and from facade-audit.test.ts's
// auditLines idiom for the raw-line check in (c).
import { testApiHandler } from 'next-test-api-route-handler'

// ── Shared mocks (all four routes) ──────────────────────────────────────
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => undefined) }))

jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimit: jest.fn(async () => null),
  reportAiUsage: jest.fn(async () => undefined),
  estimateCostCents: jest.fn(() => 1),
}))

jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => true),
  featureAllowedForBusiness: jest.fn(async () => true),
}))

// Mutable auth scenario, same convention as the four existing api-*.test.ts
// files (declared before the jest.mock call it's referenced from).
const authScenario: { user: { id: string } | null } = { user: { id: 'user-1' } }
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

jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => null),
  orgSettingsWithClient: jest.fn(async () => null),
}))

jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { parse: jest.fn() } } },
}))

// suggestions.ts's own AI core + cache (api-suggestions.test.ts's convention).
const runKaruteSuggestions = jest.fn(async () => ({
  result: { suggestions: [{ text: 'suggestion' }] },
  usage: null as { tokensIn: number; tokensOut: number } | null,
}))
jest.mock('@/lib/ai/karute-suggestions', () => ({
  runKaruteSuggestions: (...args: unknown[]) => runKaruteSuggestions(...(args as [])),
}))
jest.mock('@/lib/ai-cache', () => ({
  getCachedAI: jest.fn(async () => null),
  setCachedAI: jest.fn(async () => undefined),
}))

// transcribe.ts's speaker-id boundary (api-transcribe.test.ts's convention —
// avoids the real getCurrentUserStaffId() walking into an unmocked service
// client and draining the Deepgram fetch mock's body).
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => null),
}))

// ── chat-route mocks (Wave W2) ──────────────────────────────────────────
// Mutable scope scenario, same declared-before-mock convention as authScenario.
const scopeScenario: { allowedStoreIds: string[] | null; storeId: string | null } = {
  allowedStoreIds: null,
  storeId: null,
}
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ ...scopeScenario })),
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({})),
}))
// The requireActual of karute-chat below walks into modules that import the
// ESM @synqed-kk/client — stub it out (app-api-ai-chat.test.ts's convention)
// so jest never parses the untransformed package.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))
const runKaruteChat = jest.fn(async () => ({
  reply: 'AIの回答',
  contextLabel: undefined as string | undefined,
  usage: null as { tokensIn: number; tokensOut: number } | null,
}))
jest.mock('@/lib/ai/karute-chat', () => ({
  ...jest.requireActual('@/lib/ai/karute-chat'),
  runKaruteChat: (...args: unknown[]) => runKaruteChat(...(args as [])),
}))

import * as extractHandler from '@/app/api/ai/extract/route'
import * as summarizeHandler from '@/app/api/ai/summarize/route'
import * as suggestionsHandler from '@/app/api/ai/suggestions/route'
import * as transcribeHandler from '@/app/api/ai/transcribe/route'
import * as chatHandler from '@/app/api/ai/chat/route'
import { openai } from '@/lib/openai'
import { mockExtractionResult, mockSummaryResult } from './helpers/openai-mocks'
import { FACADE_AUDIT_MAP } from '@/lib/audit'
import { audit } from '@/lib/audit'
import { auditLines } from './helpers/audit-lines'
import { getSuggestedFollowUp, getSuggestedFollowUpWithClient } from '@/lib/karute/ai-outreach'

const { auditWeb } = jest.requireMock('@/lib/audit-web') as { auditWeb: jest.Mock }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function deepgramResponse(transcript: string): Response {
  return new Response(
    JSON.stringify({
      metadata: { request_id: 'req-1', duration: 12.3 },
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript,
                confidence: 0.94,
                words: [],
                paragraphs: { paragraphs: [] },
              },
            ],
          },
        ],
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('FACADE_AUDIT_MAP — ai.* baseline rows are LIVE (Wave W1)', () => {
  it.each([
    ['ai.extract', 'ai.memory_extract'],
    ['ai.summarize', 'ai.summary_generate'],
    ['ai.transcribe', 'recording.transcribe'],
    ['ai.suggestions', 'ai.suggested_message'],
    ['karute.ai.suggestedMessage', 'ai.suggested_message_view'],
  ] as const)('%s is live (no pendingWave) with action %s', (key, action) => {
    const rule = FACADE_AUDIT_MAP[key]
    expect(rule.pendingWave).toBeUndefined()
    expect(rule.kind).not.toBe('skip')
    expect(rule.action).toBe(action)
  })

  // 2026-07-29 honesty split (Liam ruling, ledgered ×2): the per-open hook row
  // is a VIEW — full-row pin so any drift back to mutation (or away from the
  // _view action the 変更 counter and 閲覧を含む toggle both key on) is loud.
  it('karute.ai.suggestedMessage is the VIEW twin (full-row pin)', () => {
    expect(FACADE_AUDIT_MAP['karute.ai.suggestedMessage']).toEqual({
      kind: 'view',
      category: 'ai',
      action: 'ai.suggested_message_view',
      targetType: 'karute',
    })
  })
})

describe('POST /api/ai/extract — auditWeb writer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authScenario.user = { id: 'user-1' }
  })

  it('mocked success: auditWeb called exactly once with ai.memory_extract + a non-empty requestId', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: mockExtractionResult } }],
    })
    await testApiHandler({
      appHandler: extractHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'Client wanted natural brown hair.', locale: 'en' }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ai', action: 'ai.memory_extract', requestId: expect.stringMatching(UUID_RE) }),
    )
    // Closed shape: exactly these 3 keys — a stray field (e.g. a PII-shaped
    // `detail`) fails this, not just the fields we bothered to assert above.
    expect(Object.keys(auditWeb.mock.calls[0][0]).sort()).toEqual(['action', 'category', 'requestId'])
  })

  it('401 (anonymous, fail-fast auth guard): auditWeb never called', async () => {
    authScenario.user = null
    await testApiHandler({
      appHandler: extractHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })
        expect(res.status).toBe(401)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('429 (rate limited): auditWeb never called, and the limiter body is preserved verbatim', async () => {
    const { enforceAiRateLimit } = jest.requireMock('@/lib/ai-rate-limit')
    const limiterBody = { error: 'Hourly AI request cap reached' }
    ;(enforceAiRateLimit as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify(limiterBody), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
      }),
    )
    await testApiHandler({
      appHandler: extractHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })
        expect(res.status).toBe(429)
        expect(res.headers.get('Retry-After')).toBe('3600')
        // The .catch guard (fix round #2) must never invent a body — the
        // limiter's own body rides through unchanged.
        await expect(res.json()).resolves.toEqual(limiterBody)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('400 (missing transcript, validation): auditWeb never called', async () => {
    await testApiHandler({
      appHandler: extractHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        expect(res.status).toBe(400)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('403 (plan gate locked): auditWeb never called', async () => {
    const { featureAllowed } = jest.requireMock('@/lib/subscription/feature-gate')
    ;(featureAllowed as jest.Mock).mockResolvedValueOnce(false)
    await testApiHandler({
      appHandler: extractHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })
        expect(res.status).toBe(403)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('500 (OpenAI fails, catch path): auditWeb never called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockRejectedValue(new Error('OpenAI API error'))
    await testApiHandler({
      appHandler: extractHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'Client wanted natural brown hair.', locale: 'en' }),
        })
        expect(res.status).toBe(500)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('requestId uniqueness: two successful calls emit two DIFFERENT requestIds', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: mockExtractionResult } }],
    })
    const call = () =>
      testApiHandler({
        appHandler: extractHandler,
        test: async ({ fetch }) => {
          const res = await fetch({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: 'Client wanted natural brown hair.', locale: 'en' }),
          })
          expect(res.status).toBe(200)
        },
      })
    await call()
    await call()
    expect(auditWeb).toHaveBeenCalledTimes(2)
    const [first, second] = auditWeb.mock.calls.map((c) => c[0].requestId)
    expect(first).not.toBe(second)
  })
})

describe('POST /api/ai/summarize — auditWeb writer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authScenario.user = { id: 'user-1' }
  })

  it('mocked success: auditWeb called exactly once with ai.summary_generate + a non-empty requestId', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: mockSummaryResult } }],
    })
    await testApiHandler({
      appHandler: summarizeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'Client visited for color treatment.', locale: 'en' }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ai', action: 'ai.summary_generate', requestId: expect.stringMatching(UUID_RE) }),
    )
    expect(Object.keys(auditWeb.mock.calls[0][0]).sort()).toEqual(['action', 'category', 'requestId'])
  })

  it('401 (anonymous, fail-fast auth guard): auditWeb never called', async () => {
    authScenario.user = null
    await testApiHandler({
      appHandler: summarizeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })
        expect(res.status).toBe(401)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('429 (rate limited): auditWeb never called', async () => {
    const { enforceAiRateLimit } = jest.requireMock('@/lib/ai-rate-limit')
    ;(enforceAiRateLimit as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Hourly AI request cap reached' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
      }),
    )
    await testApiHandler({
      appHandler: summarizeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })
        expect(res.status).toBe(429)
        expect(res.headers.get('Retry-After')).toBe('3600')
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('400 (missing transcript, validation): auditWeb never called', async () => {
    await testApiHandler({
      appHandler: summarizeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        expect(res.status).toBe(400)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('403 (plan gate locked): auditWeb never called', async () => {
    const { featureAllowed } = jest.requireMock('@/lib/subscription/feature-gate')
    ;(featureAllowed as jest.Mock).mockResolvedValueOnce(false)
    await testApiHandler({
      appHandler: summarizeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })
        expect(res.status).toBe(403)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('500 (OpenAI fails, catch path): auditWeb never called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockRejectedValue(new Error('OpenAI API error'))
    await testApiHandler({
      appHandler: summarizeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'Client visited for color treatment.', locale: 'en' }),
        })
        expect(res.status).toBe(500)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/suggestions — auditWeb writer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authScenario.user = { id: 'user-1' }
    runKaruteSuggestions.mockClear()
  })

  it('mocked success (no transcript/summary → empty suggestions): auditWeb called exactly once', async () => {
    await testApiHandler({
      appHandler: suggestionsHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        expect(res.status).toBe(200)
        expect((await res.json()).suggestions).toEqual([])
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ai', action: 'ai.suggested_message', requestId: expect.stringMatching(UUID_RE) }),
    )
    expect(Object.keys(auditWeb.mock.calls[0][0]).sort()).toEqual(['action', 'category', 'requestId'])
  })

  it('mocked success (cache hit): auditWeb called exactly once', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    ;(getCachedAI as jest.Mock).mockResolvedValueOnce({ suggestions: [{ text: 'cached suggestion' }] })
    await testApiHandler({
      appHandler: suggestionsHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'hello', locale: 'en' }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(runKaruteSuggestions).not.toHaveBeenCalled()
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ai', action: 'ai.suggested_message', requestId: expect.stringMatching(UUID_RE) }),
    )
    expect(Object.keys(auditWeb.mock.calls[0][0]).sort()).toEqual(['action', 'category', 'requestId'])
  })

  it('mocked success (generation stubbed via runKaruteSuggestions mock): auditWeb called exactly once', async () => {
    await testApiHandler({
      appHandler: suggestionsHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'hello', locale: 'en' }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ai', action: 'ai.suggested_message', requestId: expect.stringMatching(UUID_RE) }),
    )
    expect(Object.keys(auditWeb.mock.calls[0][0]).sort()).toEqual(['action', 'category', 'requestId'])
  })

  it('401 (anonymous, fail-fast auth guard): auditWeb never called', async () => {
    authScenario.user = null
    await testApiHandler({
      appHandler: suggestionsHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })
        expect(res.status).toBe(401)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
    expect(runKaruteSuggestions).not.toHaveBeenCalled()
  })

  it('429 (rate limited): auditWeb never called', async () => {
    const { enforceAiRateLimit } = jest.requireMock('@/lib/ai-rate-limit')
    ;(enforceAiRateLimit as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Hourly AI request cap reached' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
      }),
    )
    await testApiHandler({
      appHandler: suggestionsHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'anything', locale: 'ja' }),
        })
        expect(res.status).toBe(429)
        expect(res.headers.get('Retry-After')).toBe('3600')
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('500 (runKaruteSuggestions throws, catch path): auditWeb never called', async () => {
    runKaruteSuggestions.mockRejectedValueOnce(new Error('LLM error'))
    await testApiHandler({
      appHandler: suggestionsHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: 'hello', locale: 'en' }),
        })
        expect(res.status).toBe(500)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/transcribe — auditWeb writer', () => {
  const fetchMock = jest.fn()
  const originalFetch = global.fetch

  beforeAll(() => {
    process.env.DEEPGRAM_API_KEY = 'test-key'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-dummy.supabase.co'
  })
  afterAll(() => {
    global.fetch = originalFetch
  })
  beforeEach(() => {
    jest.clearAllMocks()
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof global.fetch
    authScenario.user = { id: 'user-1' }
    const { getOrgSettings } = jest.requireMock('@/actions/org-settings')
    ;(getOrgSettings as jest.Mock).mockResolvedValue({ speaker_diarization: true })
  })

  it('mocked success (FormData audio path): auditWeb called exactly once with recording.transcribe', async () => {
    fetchMock.mockResolvedValue(deepgramResponse('こんにちは'))
    const formData = new FormData()
    formData.append('audio', new Blob(['fake-audio'], { type: 'audio/webm' }), 'audio.webm')
    await testApiHandler({
      appHandler: transcribeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', body: formData })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'recording', action: 'recording.transcribe', requestId: expect.stringMatching(UUID_RE) }),
    )
    expect(Object.keys(auditWeb.mock.calls[0][0]).sort()).toEqual(['action', 'category', 'requestId'])
  })

  it('mocked success (JSON audioUrl path): auditWeb called exactly once with recording.transcribe', async () => {
    fetchMock.mockResolvedValue(deepgramResponse('hello world'))
    const audioUrl = 'https://test-dummy.supabase.co/storage/v1/object/sign/audio.webm?token=abc'
    await testApiHandler({
      appHandler: transcribeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioUrl, locale: 'en' }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'recording', action: 'recording.transcribe', requestId: expect.stringMatching(UUID_RE) }),
    )
    expect(Object.keys(auditWeb.mock.calls[0][0]).sort()).toEqual(['action', 'category', 'requestId'])
  })

  it('401 (anonymous, fail-fast auth guard): auditWeb never called', async () => {
    authScenario.user = null
    const formData = new FormData()
    formData.append('audio', new Blob(['fake-audio'], { type: 'audio/webm' }), 'audio.webm')
    await testApiHandler({
      appHandler: transcribeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', body: formData })
        expect(res.status).toBe(401)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('429 (rate limited): auditWeb never called', async () => {
    const { enforceAiRateLimit } = jest.requireMock('@/lib/ai-rate-limit')
    ;(enforceAiRateLimit as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Hourly AI request cap reached' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
      }),
    )
    const formData = new FormData()
    formData.append('audio', new Blob(['fake-audio'], { type: 'audio/webm' }), 'audio.webm')
    await testApiHandler({
      appHandler: transcribeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', body: formData })
        expect(res.status).toBe(429)
        expect(res.headers.get('Retry-After')).toBe('3600')
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('403 (plan gate locked): auditWeb never called', async () => {
    const { featureAllowed } = jest.requireMock('@/lib/subscription/feature-gate')
    ;(featureAllowed as jest.Mock).mockResolvedValueOnce(false)
    await testApiHandler({
      appHandler: transcribeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', body: new FormData() })
        expect(res.status).toBe(403)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400 (no audio provided, validation): auditWeb never called', async () => {
    await testApiHandler({
      appHandler: transcribeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', body: new FormData() })
        expect(res.status).toBe(400)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('500 (Deepgram fails, catch path): auditWeb never called', async () => {
    fetchMock.mockResolvedValue(new Response('{"err":"bad audio"}', { status: 400 }))
    const formData = new FormData()
    formData.append('audio', new Blob(['fake-audio'], { type: 'audio/webm' }), 'audio.webm')
    await testApiHandler({
      appHandler: transcribeHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', body: formData })
        expect(res.status).toBe(500)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

// (d) Web (cookie) twin of karute.ai.suggestedMessage — since the 2026-07-29
// honesty split (Liam ruling) this function emits TWO distinct rows:
//   · ai.suggested_message_view — unconditionally on every non-error return
//     (cache hit, gated/no-summary null, generated draft all count);
//   · ai.suggested_message (生成) — ONLY when the OpenAI call actually ran,
//     via the private auditLockout-pattern helper. A cache hit MUST NOT
//     produce a 生成 row — that lie was the whole field bug.
// Not a route, so called directly rather than via testApiHandler; reuses the
// shared top-of-file mocks (openai, ai-cache, org-settings, feature-gate,
// audit-web).
const OUTREACH_PARAMS = {
  karuteId: 'karute-1',
  customerId: 'cust-1',
  customerName: 'Jane',
  summary: 'Client came in for a haircut.',
  locale: 'en',
}

describe('getSuggestedFollowUp (src/lib/karute/ai-outreach.ts) — view row always, 生成 row only on real generation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('generated draft: 生成 row THEN view row, both carrying detail.customer_id', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: 'Thanks for visiting today!' } } }],
    })
    const draft = await getSuggestedFollowUp(OUTREACH_PARAMS)
    expect(draft).toEqual({ channel: 'LINE', body: 'Thanks for visiting today!' })
    expect(auditWeb).toHaveBeenCalledTimes(2)
    // calls[0] = the 生成 helper (fires inside the generation branch, before
    // the unconditional view emit on the return path).
    expect(auditWeb.mock.calls[0][0]).toEqual({
      category: 'ai',
      action: 'ai.suggested_message',
      targetType: 'karute',
      targetId: 'karute-1',
      detail: { customer_id: 'cust-1' },
      requestId: expect.stringMatching(UUID_RE),
    })
    expect(auditWeb.mock.calls[1][0]).toEqual({
      category: 'ai',
      action: 'ai.suggested_message_view',
      targetType: 'karute',
      targetId: 'karute-1',
      detail: { customer_id: 'cust-1' },
      requestId: expect.stringMatching(UUID_RE),
    })
  })

  it('cache hit: view row ONLY — no 生成 row, no OpenAI call', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    ;(getCachedAI as jest.Mock).mockResolvedValueOnce({ body: 'cached draft' })
    const draft = await getSuggestedFollowUp(OUTREACH_PARAMS)
    expect(draft).toEqual({ channel: 'LINE', body: 'cached draft' })
    expect(openai.chat.completions.parse).not.toHaveBeenCalled()
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0]).toMatchObject({ action: 'ai.suggested_message_view' })
  })

  it('no summary (null draft): view row ONLY — a non-result is still a completed read', async () => {
    const draft = await getSuggestedFollowUp({ ...OUTREACH_PARAMS, summary: '  ' })
    expect(draft).toBeNull()
    expect(openai.chat.completions.parse).not.toHaveBeenCalled()
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0]).toMatchObject({ action: 'ai.suggested_message_view' })
  })

  it('null customerId degrades to detail.customer_id null, never a dropped row', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    ;(getCachedAI as jest.Mock).mockResolvedValueOnce({ body: 'cached draft' })
    await getSuggestedFollowUp({ ...OUTREACH_PARAMS, customerId: null })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0]).toMatchObject({ detail: { customer_id: null } })
  })

  it('error path (OpenAI throws, caught internally): auditWeb never called', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockRejectedValue(new Error('LLM error'))
    const draft = await getSuggestedFollowUp(OUTREACH_PARAMS)
    expect(draft).toBeNull()
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

// (d2) Facade (Bearer) twin — the 生成 helper emits through the REAL audit()
// (auditWeb is web-only), so assertions read the raw console sink via
// auditLines. The per-VIEW row on this path is the route hook's
// (logFacadeAudit), out of scope here — so a generation prints EXACTLY ONE
// line, and a cache hit prints ZERO.
describe('getSuggestedFollowUpWithClient — facade 生成 row only on real generation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const call = () =>
    getSuggestedFollowUpWithClient(
      {} as never,
      'biz-1',
      'staff-uid-1',
      'req-1',
      OUTREACH_PARAMS,
    )

  it('generated draft: one facade 生成 line with actor/requestId/customer_id', async () => {
    ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
      choices: [{ message: { parsed: { body: 'Thanks!' } } }],
    })
    const lines = await auditLines(async () => {
      await expect(call()).resolves.toEqual({ channel: 'LINE', body: 'Thanks!' })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'ai',
      action: 'ai.suggested_message',
      actor_id: 'staff-uid-1',
      actor_type: 'staff',
      business_id: 'biz-1',
      target_type: 'karute',
      target_id: 'karute-1',
      detail: { customer_id: 'cust-1' },
      request_id: 'req-1',
      source: 'facade',
    })
  })

  it('cache hit: zero audit lines from this function (the hook owns the view row)', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    ;(getCachedAI as jest.Mock).mockResolvedValueOnce({ body: 'cached draft' })
    const lines = await auditLines(async () => {
      await expect(call()).resolves.toEqual({ channel: 'LINE', body: 'cached draft' })
    })
    expect(openai.chat.completions.parse).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })
})

// (c) Raw console-line shape for a detail-less event — the REAL audit()
// emitter (not the auditWeb mock above; @/lib/audit is a separate module
// path, untouched by the jest.mock('@/lib/audit-web', ...) call at top).
describe('detail-less event shape (contract: detail: null, never undefined)', () => {
  it('an ai.* baseline event with no detail prints detail: null on the raw console line', async () => {
    const lines = await auditLines(async () =>
      audit({
        category: 'ai',
        action: 'ai.memory_extract',
        actorId: 'staff-1',
        actorType: 'staff',
        businessId: null,
        source: 'web',
      }),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].detail).toBeNull()
    expect('detail' in lines[0]).toBe(true)
  })
})

// ── Wave W2 (Option A, Liam 7/28): ai.consult_session per exchange ────────

describe('FACADE_AUDIT_MAP — ai.chat promoted, askAi.read stays parked (Wave W2)', () => {
  it('ai.chat is LIVE (no pendingWave) with action ai.consult_session', () => {
    const rule = FACADE_AUDIT_MAP['ai.chat']
    expect(rule.pendingWave).toBeUndefined()
    expect(rule).toEqual({ kind: 'mutation', category: 'ai', action: 'ai.consult_session' })
  })

  it('askAi.read is STILL parked VERBATIM — any edit to this row is an Anthony-gated weakening', () => {
    expect(FACADE_AUDIT_MAP['askAi.read']).toEqual({
      kind: 'mutation',
      category: 'ai',
      action: 'ai.consult_session',
      pendingWave: 'Wave W — 2026-07-27',
    })
  })
})

describe('POST /api/ai/chat — auditWeb writer (Wave W2)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authScenario.user = { id: 'user-1' }
    scopeScenario.allowedStoreIds = null
    scopeScenario.storeId = null
    runKaruteChat.mockResolvedValue({ reply: 'AIの回答', contextLabel: undefined, usage: null })
  })

  it('first exchange (no history): one emit — first_turn true, history_len 0, no store lens; closed shape pinned', async () => {
    await testApiHandler({
      appHandler: chatHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: '肩こりの相談まとめて', locale: 'ja' }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'ai',
        action: 'ai.consult_session',
        detail: { first_turn: true, history_len: 0 },
        storeId: undefined,
        requestId: expect.stringMatching(UUID_RE),
      }),
    )
    // Closed shape: exactly these keys — a stray PII-shaped field fails loud.
    expect(Object.keys(auditWeb.mock.calls[0][0]).sort()).toEqual([
      'action', 'category', 'detail', 'requestId', 'storeId',
    ])
  })

  it('later exchange (2-turn history): first_turn false, history_len 2 — one row per exchange', async () => {
    await testApiHandler({
      appHandler: chatHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: '続きをお願い',
            locale: 'ja',
            history: [
              { role: 'user', content: 'a' },
              { role: 'assistant', content: 'b' },
            ],
          }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0].detail).toEqual({ first_turn: false, history_len: 2 })
  })

  it('clamped staff: the row carries their store as its store lens', async () => {
    scopeScenario.allowedStoreIds = ['store-ginza']
    scopeScenario.storeId = 'store-ginza'
    await testApiHandler({
      appHandler: chatHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'x', locale: 'ja' }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb.mock.calls[0][0].storeId).toBe('store-ginza')
  })

  it('viewAll pinned to a store (allowedStoreIds null, storeId set): NO store lens — scope gate, not raw pin (blind-round F2)', async () => {
    // Kills the `storeId: scope.storeId ?? undefined` mutant: an owner's
    // active-store pin must never store-stamp business-wide consult rows.
    scopeScenario.allowedStoreIds = null
    scopeScenario.storeId = 'store-ginza'
    await testApiHandler({
      appHandler: chatHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'x', locale: 'ja' }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0].storeId).toBeUndefined()
  })

  it('over-budget history: history_len counts the CAPPED turns, not the raw client array (blind-round F3)', async () => {
    // Two turns totalling ~35k chars — capHistory (30k budget) drops the
    // oldest → post-cap length 1 vs raw 2. Kills the `rawHistory.length`
    // mutant the short-history test above cannot distinguish.
    await testApiHandler({
      appHandler: chatHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'x',
            locale: 'ja',
            history: [
              { role: 'user', content: 'a'.repeat(20000) },
              { role: 'assistant', content: 'b'.repeat(15000) },
            ],
          }),
        })
        expect(res.status).toBe(200)
      },
    })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb.mock.calls[0][0].detail).toEqual({ first_turn: false, history_len: 1 })
  })

  it('401 (anonymous): auditWeb never called', async () => {
    authScenario.user = null
    await testApiHandler({
      appHandler: chatHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'x' }),
        })
        expect(res.status).toBe(401)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('429 (rate limited): auditWeb never called, limiter body + Retry-After preserved verbatim', async () => {
    const { enforceAiRateLimit } = jest.requireMock('@/lib/ai-rate-limit')
    const limiterBody = { error: 'Hourly AI request cap reached' }
    ;(enforceAiRateLimit as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify(limiterBody), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
      }),
    )
    await testApiHandler({
      appHandler: chatHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'x' }),
        })
        expect(res.status).toBe(429)
        expect(res.headers.get('Retry-After')).toBe('3600')
        await expect(res.json()).resolves.toEqual(limiterBody)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('400 (blank message, validation): auditWeb never called', async () => {
    await testApiHandler({
      appHandler: chatHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: '   ' }),
        })
        expect(res.status).toBe(400)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('500 (chat core throws, catch path): auditWeb never called — errors are not actions', async () => {
    runKaruteChat.mockRejectedValueOnce(new Error('LLM down'))
    await testApiHandler({
      appHandler: chatHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'x' }),
        })
        expect(res.status).toBe(500)
      },
    })
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

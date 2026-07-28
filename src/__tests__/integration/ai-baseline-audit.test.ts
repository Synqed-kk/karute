// 監査ログ Wave W1 — ai.* baseline writers (contract §3.1, build packet
// 2026-07-28). Proves:
//   (a) the five promoted FACADE_AUDIT_MAP rows are LIVE (no pendingWave)
//       with the exact expected action strings.
//   (b) each of the four legacy /api/ai/* web routes emits auditWeb() exactly
//       once, with the expected category+action and a non-empty requestId, on
//       every non-error (mocked success) return path — and never emits on an
//       auth-fail/rate-limit/validation/catch error path ("errors are not
//       actions").
//   (c) a detail-less audit() event prints `detail: null` on the console
//       line, never `undefined`.
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

import * as extractHandler from '@/app/api/ai/extract/route'
import * as summarizeHandler from '@/app/api/ai/summarize/route'
import * as suggestionsHandler from '@/app/api/ai/suggestions/route'
import * as transcribeHandler from '@/app/api/ai/transcribe/route'
import { openai } from '@/lib/openai'
import { mockExtractionResult, mockSummaryResult } from './helpers/openai-mocks'
import { FACADE_AUDIT_MAP } from '@/lib/audit'
import { audit } from '@/lib/audit'
import { auditLines } from './helpers/audit-lines'

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
    ['karute.ai.suggestedMessage', 'ai.suggested_message'],
  ] as const)('%s is live (no pendingWave) with action %s', (key, action) => {
    const rule = FACADE_AUDIT_MAP[key]
    expect(rule.pendingWave).toBeUndefined()
    expect(rule.kind).not.toBe('skip')
    expect(rule.action).toBe(action)
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

  it('429 (rate limited): auditWeb never called', async () => {
    const { enforceAiRateLimit } = jest.requireMock('@/lib/ai-rate-limit')
    ;(enforceAiRateLimit as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Hourly AI request cap reached' }), {
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
  })

  it('mocked success (freshly generated): auditWeb called exactly once', async () => {
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

import { testApiHandler } from 'next-test-api-route-handler'
import * as appHandler from '@/app/api/ai/transcribe/route'

// Rate limiter is exercised in its own test — keep the transcribe tests
// focused on Deepgram wiring.
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimit: jest.fn(async () => null),
}))

// Mutable auth scenario for the fail-fast guard test below (declared before
// the jest.mock call it's referenced from — see consent-save-gate.test.ts).
const authScenario: { user: { id: string } | null } = { user: { id: 'user-1' } }

// Supabase server client is used for the auth guard. Return a chain stub so
// .from().select().limit().single() resolves without a real DB — mirrors
// api-extract.test.ts's shape (kept complete even though this route's own
// reachable paths don't call .from(), so an unmocked caller degrades to a
// harmless empty result instead of throwing).
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

// The plan gate pulls entitlements (native-ESM SDK) — stub the boundary like
// the rate limiter above. Allowed by default; the gate's own behavior is
// covered in api-extract.test.ts + subscription-enforcement.test.ts.
jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => true),
}))

// Org settings drive the diarize flag — stub a permissive default.
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ speaker_diarization: true })),
}))

// Speaker-id voiceprint resolution is exercised in its own test — keep the
// transcribe tests focused on Deepgram wiring. Without this stub, a non-null
// auth user (above) makes getCurrentUserStaffId() walk into
// getBusinessId()/staffListByBusiness(), which hit the REAL (unmocked)
// service-role client from @/lib/supabase/service. That client resolves its
// fetch implementation lazily against whatever `global.fetch` currently is
// (@supabase/supabase-js's resolveFetch — `(...args) => fetch(...args)`), so
// it silently piggybacks on fetchMock below: a phantom
// GET .../rest/v1/profiles call lands as fetchMock's call #0 and drains the
// single shared Deepgram Response's body before Deepgram is ever reached.
// Stubbing the staff-id boundary closes that off at its source.
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => null),
}))

// Deepgram is reached via global fetch in lib/deepgram.ts. Stub fetch so the
// test runs offline with a deterministic transcript. Installed in beforeEach
// (not beforeAll) so it's freshly (re)applied after all module loading, on
// top of a clean slate every test — cheap insurance against any other suite
// or boundary leaving `global.fetch` in an unexpected state.
const fetchMock = jest.fn()
const originalFetch = global.fetch

beforeAll(() => {
  process.env.DEEPGRAM_API_KEY = 'test-key'
  // Pin the SSRF allowlist host so the audioUrl guard is deterministic here.
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
})

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
                words: [
                  { word: 'hello', start: 0, end: 0.5, confidence: 0.95, speaker: 0 },
                  { word: 'world', start: 0.5, end: 1.0, confidence: 0.93, speaker: 1 },
                ],
                paragraphs: {
                  paragraphs: [
                    {
                      speaker: 0,
                      start: 0,
                      end: 1.0,
                      sentences: [{ text: 'Hello world' }],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('POST /api/ai/transcribe', () => {
  it('returns 401 for anonymous callers before the rate limiter runs (fail-fast auth guard)', async () => {
    authScenario.user = null
    const { enforceAiRateLimit } = jest.requireMock('@/lib/ai-rate-limit')

    const formData = new FormData()
    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm' })
    formData.append('audio', audioBlob, 'audio.webm')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: formData,
        })

        expect(response.status).toBe(401)
        const body = await response.json()
        expect(body.error).toBe('Unauthorized')
        expect(enforceAiRateLimit).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
      },
    })
  })

  it('returns transcript for valid audio upload', async () => {
    fetchMock.mockResolvedValue(deepgramResponse('こんにちは'))

    const formData = new FormData()
    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm' })
    formData.append('audio', audioBlob, 'audio.webm')
    formData.append('locale', 'en')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: formData,
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        // transcript is the contract karute_records reads — keep it primary.
        expect(body.transcript).toBe('こんにちは')
        expect(body.durationSec).toBe(12.3)
        expect(body.confidence).toBeCloseTo(0.94)
        expect(body.words).toHaveLength(2)
        expect(body.paragraphs).toEqual([
          { speaker: 0, start: 0, end: 1.0, text: 'Hello world' },
        ])

        const [url, init] = fetchMock.mock.calls[0]
        expect(String(url)).toMatch(/api\.deepgram\.com\/v1\/listen/)
        expect(String(url)).toMatch(/language=en/)
        expect(String(url)).toMatch(/diarize=true/)
        expect((init as RequestInit).headers).toMatchObject({
          Authorization: 'Token test-key',
          'Content-Type': 'audio/webm',
        })
      },
    })
  })

  it('returns 400 when no audio file provided', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: new FormData(),
        })

        expect(response.status).toBe(400)
        const body = await response.json()
        expect(body).toHaveProperty('error')
        expect(body.error).toMatch(/No audio/i)
        expect(fetchMock).not.toHaveBeenCalled()
      },
    })
  })

  it('defaults language to ja when locale not specified', async () => {
    fetchMock.mockResolvedValue(deepgramResponse('テスト'))

    const formData = new FormData()
    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm' })
    formData.append('audio', audioBlob, 'audio.webm')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: formData,
        })

        expect(response.status).toBe(200)
        const [url] = fetchMock.mock.calls[0]
        expect(String(url)).toMatch(/language=ja/)
      },
    })
  })

  it('sends domain keyterms for ja (base set; bodywork terms only for that family)', async () => {
    fetchMock.mockResolvedValue(deepgramResponse('テスト'))

    const formData = new FormData()
    formData.append('audio', new Blob(['fake-audio'], { type: 'audio/webm' }), 'audio.webm')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({ method: 'POST', body: formData })
        const url = new URL(String(fetchMock.mock.calls[0][0]))
        const terms = url.searchParams.getAll('keyterm')
        // Default org mock has no business_type → the generic base list only.
        expect(terms).toContain('カルテ')
        expect(terms).toContain('施術')
        expect(terms).not.toContain('もみ返し')
      },
    })
  })

  it('adds bodywork keyterms when the org is a bodywork business type', async () => {
    const { getOrgSettings } = jest.requireMock('@/actions/org-settings')
    getOrgSettings.mockResolvedValueOnce({
      speaker_diarization: true,
      business_type: 'massage',
    })
    fetchMock.mockResolvedValue(deepgramResponse('テスト'))

    const formData = new FormData()
    formData.append('audio', new Blob(['fake-audio'], { type: 'audio/webm' }), 'audio.webm')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({ method: 'POST', body: formData })
        const url = new URL(String(fetchMock.mock.calls[0][0]))
        const terms = url.searchParams.getAll('keyterm')
        expect(terms).toContain('もみ返し')
        expect(terms).toContain('可動域')
        // Deepgram hard-caps 500 tokens across all terms — the curated list
        // stays an order of magnitude under it.
        expect(terms.length).toBeLessThanOrEqual(50)
      },
    })
  })

  it('sends no keyterms for en (nothing validated for that locale)', async () => {
    fetchMock.mockResolvedValue(deepgramResponse('test'))

    const formData = new FormData()
    formData.append('audio', new Blob(['fake-audio'], { type: 'audio/webm' }), 'audio.webm')
    formData.append('locale', 'en')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        await fetch({ method: 'POST', body: formData })
        const url = new URL(String(fetchMock.mock.calls[0][0]))
        expect(url.searchParams.getAll('keyterm')).toEqual([])
      },
    })
  })

  it('passes mp4 content-type through to Deepgram (iOS Safari)', async () => {
    fetchMock.mockResolvedValue(deepgramResponse('ok'))

    const formData = new FormData()
    const audioBlob = new Blob(['fake-audio'], { type: 'audio/mp4' })
    formData.append('audio', audioBlob, 'audio.mp4')
    formData.append('locale', 'en')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: formData,
        })

        expect(response.status).toBe(200)
        const [, init] = fetchMock.mock.calls[0]
        expect((init as RequestInit).headers).toMatchObject({
          'Content-Type': 'audio/mp4',
        })
      },
    })
  })

  it('passes a Supabase signed URL straight through to Deepgram', async () => {
    fetchMock.mockResolvedValue(deepgramResponse('hello world'))

    const audioUrl = 'https://test-dummy.supabase.co/storage/v1/object/sign/audio.webm?token=abc'

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioUrl, locale: 'en' }),
        })

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.transcript).toBe('hello world')

        // Only ONE outbound fetch — Deepgram fetches the audio itself.
        // The serverless function should NOT download the file first.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]
        expect(String(url)).toMatch(/api\.deepgram\.com\/v1\/listen/)
        expect((init as RequestInit).headers).toMatchObject({
          'Content-Type': 'application/json',
        })
        expect((init as RequestInit).body).toBe(JSON.stringify({ url: audioUrl }))
      },
    })
  })

  it('rejects an audioUrl on a foreign host (SSRF guard) without fetching', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioUrl: 'https://evil.example.com/internal/metadata',
            locale: 'ja',
          }),
        })

        expect(response.status).toBe(400)
        // Never fetched — not the foreign host, not Deepgram.
        expect(fetchMock).not.toHaveBeenCalled()
      },
    })
  })

  it('returns 400 when JSON body omits audioUrl', async () => {
    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: 'ja' }),
        })

        expect(response.status).toBe(400)
        expect(fetchMock).not.toHaveBeenCalled()
      },
    })
  })

  it('surfaces Deepgram failures as 500', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"err":"bad audio"}', { status: 400 }),
    )

    const formData = new FormData()
    const audioBlob = new Blob(['fake-audio'], { type: 'audio/webm' })
    formData.append('audio', audioBlob, 'audio.webm')

    await testApiHandler({
      appHandler,
      test: async ({ fetch }) => {
        const response = await fetch({
          method: 'POST',
          body: formData,
        })

        expect(response.status).toBe(500)
        const body = await response.json()
        expect(body.error).toMatch(/Transcription failed/i)
        expect(body.detail).toMatch(/Deepgram 400/i)
      },
    })
  })
})

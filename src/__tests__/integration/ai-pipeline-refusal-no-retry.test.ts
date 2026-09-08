/**
 * A REFUSAL IS NOT A BLIP (the transcription spend wall, 2026-09-08).
 *
 * `fetchWithRetry` retried EVERY non-ok answer once, 1.5 s later — including a
 * 429 (the AI spend/rate ceiling) and a 403 (the plan gate), which answer
 * exactly the same the second time. Two costs came with that: a doubled refusal
 * round-trip on a wall that is already saying no, and the retry arm's own
 * message — the raw `HTTP ${status}: ${body}` that puts English on a Japanese
 * screen, which is the leak PipelineErrorCard exists to prevent.
 *
 * A real failure (500, a network throw) keeps its one retry, unchanged.
 */
const awaitTakeSecured = jest.fn(async (_takeId: string) => {})
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { awaitTakeSecured: (takeId: string) => awaitTakeSecured(takeId) },
}))
jest.mock('@/lib/karute/take-store', () => ({
  readTakeSecureMeta: jest.fn(async () => null),
  ensureFinalizedPath: jest.fn(async () => null),
}))
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    prepareTranscription: jest.fn(async () => ({
      body: { path: 'app_biz-1_take-1.webm' },
      path: 'app_biz-1_take-1.webm',
    })),
    finalizedKey: jest.fn(async () => null),
  }),
}))

const apiFetch = jest.fn()
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({ apiFetch: (url: string, init: unknown) => apiFetch(url, init) }),
}))

import { runAIPipeline } from '@/lib/ai-pipeline'

/** The refusal body the two transcribe routes really send (the 429 rebuilt
 *  from the classified error, and the plan gate's 403). */
const refusal = (status: number, body: unknown) =>
  ({ ok: false, status, text: async () => JSON.stringify(body), json: async () => body }) as unknown as Response

const blob = { size: 1, type: 'audio/webm' } as unknown as Blob
const run = () => runAIPipeline(blob, null, 'ja', () => {})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('fetchWithRetry — refusals are not retried', () => {
  it('429 → ONE fetch, and the message is the route’s own readable one', async () => {
    apiFetch.mockResolvedValue(
      refusal(429, { error: '本日の文字起こしの上限に達しました', reason: 'daily_cost' }),
    )

    await expect(run()).rejects.toThrow('本日の文字起こしの上限に達しました')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('403 (the plan gate) → ONE fetch', async () => {
    apiFetch.mockResolvedValue(refusal(403, { error: 'PLAN_LOCKED' }))

    await expect(run()).rejects.toThrow('PLAN_LOCKED')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('500 → still TWO fetches (a real failure keeps its one retry)', async () => {
    apiFetch.mockResolvedValue(refusal(500, { error: 'Transcription failed' }))

    await expect(run()).rejects.toThrow()
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})

// model: claude-opus-5-5 · S87 (R-S87-17 b): the run context's emittedBytes
// reaches ensureAudioOnServer's 6th argument (R-S87-3a route ii, the last hop).
const ensureAudioOnServer = jest.fn(async () => {
  throw new Error('stop here')
})
jest.mock('@/lib/karute/take-store', () => ({
  ...jest.requireActual('@/lib/karute/take-store'),
  readTakeSecureMeta: async () => null,
  ensureFinalizedPath: async () => null,
}))
jest.mock('@/lib/recording/secure-take', () => ({ ensureAudioOnServer: (...a: unknown[]) => ensureAudioOnServer(...(a as [])) }))
jest.mock('@/lib/global-recorder', () => ({ globalRecorder: { awaitTakeSecured: async () => {} } }))
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({ aiBase: '/api/ai', prepareTranscription: jest.fn() }),
}))

import { runAIPipeline } from '@/lib/ai-pipeline'

describe('S87 — ai-pipeline hands the emitted count to the attach', () => {
  it('ctx.emittedBytes → ensureAudioOnServer(…, durationSeconds, emittedBytes)', async () => {
    await expect(
      runAIPipeline(new Blob(['x']), 'take-1', 'ja', () => {}, {
        recordingSessionId: 'sess-1',
        durationSeconds: 5,
        emittedBytes: 777,
      }),
    ).rejects.toThrow('stop here')
    expect(ensureAudioOnServer).toHaveBeenCalledTimes(1)
    const args = ensureAudioOnServer.mock.calls[0] as unknown[]
    expect(args[4]).toBe(5)
    expect(args[5]).toBe(777)
  })
})

/**
 * ⚖ THE IN-TAB LEG WAITS FOR THE STOP'S OWN UPLOAD (capture pipeline PR4 fix
 * round 2).
 *
 * `runAIPipeline` reads the take's finalized key itself — deliberately, so
 * every caller gets the same answer. But the 自動 arm reaches that read at the
 * STOP INSTANT, with the stop leg's own PUT of the whole take still in flight,
 * so the read answered null on an ORDINARY recording and
 * `prepareTranscription`'s fallback staged a SECOND whole copy of the same
 * audio to a server-named key nothing points at: two uploads of the same 43 MB
 * and a permanent orphan object, per recording. The fallback is meant for a
 * take the store never held; this made it the common case.
 *
 * What the recorder's side of that wait actually does is pinned in
 * take-durability.test.ts (`awaitTakeSecured — the reader waits for the leg,
 * not for the hold`). This file pins the READER: it asks, and it does not read
 * the row until it has an answer.
 */
const awaitTakeSecured = jest.fn(async (_takeId: string) => {})
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: {
    awaitTakeSecured: (takeId: string) => awaitTakeSecured(takeId),
  },
}))

const readTakeSecureMeta = jest.fn(
  async (_takeId: string): Promise<{ finalizedPath?: string } | null> => ({}),
)
jest.mock('@/lib/karute/take-store', () => ({
  readTakeSecureMeta: (takeId: string) => readTakeSecureMeta(takeId),
}))

const apiFetch = jest.fn(async (url: string) => {
  const body = url.endsWith('/transcribe')
    ? { transcript: 'こんにちは' }
    : url.endsWith('/extract')
      ? { entries: [] }
      : { summary: 'まとめ' }
  return { ok: true, json: async () => body } as unknown as Response
})
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({ apiFetch: (url: string) => apiFetch(url) }),
}))

const prepareTranscription = jest.fn(
  async (_blob: Blob, finalizedPath: string | null) => ({
    body: { path: finalizedPath ?? 'app_biz-1_staged-9.webm' },
    path: finalizedPath ?? 'app_biz-1_staged-9.webm',
  }),
)
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    aiBase: '/api/ai',
    prepareTranscription: (blob: Blob, finalizedPath: string | null) =>
      prepareTranscription(blob, finalizedPath),
  }),
}))

import { runAIPipeline } from '@/lib/ai-pipeline'

const FINALIZED = 'app_biz-1_take-1.webm'

/** Every microtask in the queue — enough for the whole pipeline, whose only
 *  awaits are these mocks. */
async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

beforeEach(() => {
  jest.clearAllMocks()
  awaitTakeSecured.mockImplementation(async () => {})
  readTakeSecureMeta.mockImplementation(async () => ({}))
  prepareTranscription.mockImplementation(async (_blob, finalizedPath) => ({
    body: { path: finalizedPath ?? 'app_biz-1_staged-9.webm' },
    path: finalizedPath ?? 'app_biz-1_staged-9.webm',
  }))
})

describe('⚖ runAIPipeline waits for the stop’s own upload before it reads the key', () => {
  it('the stop is still uploading: it asks, holds off the read, then transcribes the FINALIZED key', async () => {
    let release!: () => void
    const stopLeg = new Promise<void>((r) => {
      release = r
    })
    awaitTakeSecured.mockImplementation(async () => {
      await stopLeg
    })

    const run = runAIPipeline(new Blob(['audio']), 'take-1', 'ja', () => {})
    await flush()

    // It asked the recorder first, and has NOT touched the row: reading it here
    // is what answered null and sent a second copy of the take to storage.
    expect(awaitTakeSecured).toHaveBeenCalledWith('take-1')
    expect(readTakeSecureMeta).not.toHaveBeenCalled()
    expect(prepareTranscription).not.toHaveBeenCalled()

    // The leg lands: the key is on the row.
    readTakeSecureMeta.mockImplementation(async () => ({ finalizedPath: FINALIZED }))
    release()
    await run

    // One object, the one the stop already PUT — and nothing staged.
    expect(prepareTranscription).toHaveBeenCalledTimes(1)
    expect(prepareTranscription.mock.calls[0][1]).toBe(FINALIZED)
  })

  it('…and the SECOND whole copy of the take never reaches storage', async () => {
    // The same race, judged only by its outcome. With the wait, the transcribe
    // leg is handed the finalized key and uploads nothing. Without it, it is
    // handed null — and null is the staging fallback: a second upload of the
    // same 43 MB to a key no row points at.
    let release!: () => void
    const stopLeg = new Promise<void>((r) => {
      release = r
    })
    awaitTakeSecured.mockImplementation(async () => {
      await stopLeg
    })

    const run = runAIPipeline(new Blob(['audio']), 'take-1', 'ja', () => {})
    await flush()
    readTakeSecureMeta.mockImplementation(async () => ({ finalizedPath: FINALIZED }))
    release()
    await run

    expect(prepareTranscription.mock.calls[0][1]).toBe(FINALIZED)
  })

  it('the stop is DONE by the time it asks: no waiting, same finalized key', async () => {
    readTakeSecureMeta.mockImplementation(async () => ({ finalizedPath: FINALIZED }))
    await runAIPipeline(new Blob(['audio']), 'take-1', 'ja', () => {})
    expect(awaitTakeSecured).toHaveBeenCalledWith('take-1')
    expect(prepareTranscription.mock.calls[0][1]).toBe(FINALIZED)
  })

  it('a take that was never secured still falls back to staging — unchanged', async () => {
    // An offline stop, or a take the store never held. Nothing here creates the
    // object; the port's own fallback stages this one blob exactly as before.
    readTakeSecureMeta.mockImplementation(async () => ({}))
    await runAIPipeline(new Blob(['audio']), 'take-1', 'ja', () => {})
    expect(prepareTranscription.mock.calls[0][1]).toBeNull()
  })

  it('no take at all: nothing is asked and nothing is read', async () => {
    await runAIPipeline(new Blob(['audio']), null, 'ja', () => {})
    expect(awaitTakeSecured).not.toHaveBeenCalled()
    expect(readTakeSecureMeta).not.toHaveBeenCalled()
    expect(prepareTranscription.mock.calls[0][1]).toBeNull()
  })
})

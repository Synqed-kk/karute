/**
 * @jest-environment jsdom
 *
 * A2-2 client half — lib/recording/discard-transcript.ts.
 *
 * The register exists for ONE reason: a discarded take's audio must outlive the
 * discard just long enough for its words to land, and not one moment longer.
 * So the properties here are all about WHEN the audio dies:
 *
 *   - a settled answer (written, or deliberately not kept) deletes it;
 *   - anything unsettled keeps it, stamped, for the next mount's sweep;
 *   - a world with nowhere to persist keeps nothing back at all, so the phone
 *     never accumulates audio waiting for a collection that cannot happen.
 */
const mockPersistDiscardTranscript = jest.fn(async () => ({ ok: true }) as unknown)
const mockTranscribeAndPersistDiscard = jest.fn(async () => ({ ok: true }) as unknown)
jest.mock('@/actions/recording-discard-transcript', () => ({
  persistDiscardTranscript: (...a: unknown[]) => mockPersistDiscardTranscript(...(a as [])),
  transcribeAndPersistDiscard: (...a: unknown[]) =>
    mockTranscribeAndPersistDiscard(...(a as [])),
}))

const mockDeleteTake = jest.fn(async (_takeId: string) => {})
const mockStampDiscardPending = jest.fn(async (_takeId: string, _pending: unknown) => true)
const mockLoadTakeBlob = jest.fn(async (_takeId: string): Promise<Blob | null> => new Blob(['audio']))
const mockListPending = jest.fn(
  async (): Promise<{ takeId: string; discardPending: unknown }[]> => [],
)
jest.mock('@/lib/karute/take-store', () => ({
  deleteTake: (takeId: string) => mockDeleteTake(takeId),
  stampDiscardPending: (takeId: string, pending: unknown) =>
    mockStampDiscardPending(takeId, pending),
  loadTakeBlob: (takeId: string) => mockLoadTakeBlob(takeId),
  listPendingDiscardTakes: () => mockListPending(),
}))

const mockStageForJob = jest.fn(async (_blob: Blob) => ({ path: 'app_business-1_staged.webm' }))
let mockSupported = true
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    supportsDiscardTranscript: mockSupported,
    stageForJob: (blob: Blob) => mockStageForJob(blob),
  }),
}))

import {
  discardTranscriptSupported,
  persistReviewDiscardTranscript,
  runDiscardTranscript,
  sweepDiscardTranscripts,
} from '@/lib/recording/discard-transcript'

const PENDING = {
  recordingSessionId: 'sess-1',
  durationSeconds: 62,
  locale: 'ja',
  stampedAt: 1_756_000_000_000,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSupported = true
  mockPersistDiscardTranscript.mockImplementation(async () => ({ ok: true }))
  mockTranscribeAndPersistDiscard.mockImplementation(async () => ({ ok: true }))
  mockLoadTakeBlob.mockImplementation(async () => new Blob(['audio']))
  mockListPending.mockImplementation(async () => [])
})

describe('the world gate', () => {
  it('follows the recording port', () => {
    expect(discardTranscriptSupported()).toBe(true)
    mockSupported = false
    expect(discardTranscriptSupported()).toBe(false)
  })

  it('unsupported: the review path persists nothing and lets the take go', async () => {
    mockSupported = false
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(true)
    expect(mockPersistDiscardTranscript).not.toHaveBeenCalled()
    expect(mockStampDiscardPending).not.toHaveBeenCalled()
  })

  it('unsupported: the sweep does not even read the store', async () => {
    mockSupported = false
    await sweepDiscardTranscripts()
    expect(mockListPending).not.toHaveBeenCalled()
  })
})

describe('the review path (words already in hand)', () => {
  it('persists and reports the take deletable', async () => {
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(true)
    // No customer travels from the client: the consent gate reads the session
    // row server-side, so there is no id here to name the wrong person with.
    expect(mockPersistDiscardTranscript).toHaveBeenCalledWith({
      recordingSessionId: 'sess-1',
      transcript: 'words',
      durationSeconds: 62,
    })
    expect(mockStampDiscardPending).not.toHaveBeenCalled()
  })

  it('a deliberate skip is settled too — no consent means no retry is owed', async () => {
    mockPersistDiscardTranscript.mockImplementationOnce(async () => ({ skipped: 'consent' }))
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(true)
    expect(mockStampDiscardPending).not.toHaveBeenCalled()
  })

  it('a FAILED write stamps the take instead, so the audio retry can run', async () => {
    mockPersistDiscardTranscript.mockImplementationOnce(async () => ({ error: 'failed' }))
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(false)
    expect(mockStampDiscardPending).toHaveBeenCalledWith('take-1', PENDING)
  })

  it('a TERMINAL refusal is settled here too — stamping would buy one wasted upload', async () => {
    for (const error of ['not_discarded', 'forbidden'] as const) {
      jest.clearAllMocks()
      mockPersistDiscardTranscript.mockImplementationOnce(async () => ({ error }))
      await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(true)
      expect(mockStampDiscardPending).not.toHaveBeenCalled()
    }
  })

  it('a transport-level throw is a failure too, not an unhandled rejection', async () => {
    mockPersistDiscardTranscript.mockImplementationOnce(async () => {
      throw new Error('offline')
    })
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(false)
    expect(mockStampDiscardPending).toHaveBeenCalledTimes(1)
  })

  it('a failure with NO take to stamp cannot hold anything back', async () => {
    mockPersistDiscardTranscript.mockImplementationOnce(async () => ({ error: 'failed' }))
    await expect(persistReviewDiscardTranscript(null, PENDING, 'words')).resolves.toBe(true)
    expect(mockStampDiscardPending).not.toHaveBeenCalled()
  })

  it('a stamp that cannot be written also lets the take go — no orphan audio', async () => {
    mockPersistDiscardTranscript.mockImplementationOnce(async () => ({ error: 'failed' }))
    mockStampDiscardPending.mockImplementationOnce(async () => false)
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(true)
  })
})

describe('the audio path', () => {
  it('stages the take, transcribes it onto the discarded session, then drops the audio', async () => {
    await runDiscardTranscript('take-1', PENDING)
    expect(mockStageForJob).toHaveBeenCalledTimes(1)
    expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledWith({
      recordingSessionId: 'sess-1',
      audioPath: 'app_business-1_staged.webm',
      durationSeconds: 62,
      locale: 'ja',
    })
    expect(mockDeleteTake).toHaveBeenCalledWith('take-1')
  })

  it('a deliberate skip settles it — the reason-only row IS the outcome there', async () => {
    mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({ skipped: 'consent' }))
    await runDiscardTranscript('take-1', PENDING)
    expect(mockDeleteTake).toHaveBeenCalledWith('take-1')
  })

  it('a failure KEEPS the take — the words are still owed', async () => {
    mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({ error: 'failed' }))
    await runDiscardTranscript('take-1', PENDING)
    expect(mockDeleteTake).not.toHaveBeenCalled()
  })

  it('a TERMINAL refusal settles it — no retry can ever change the answer', async () => {
    // `not_discarded` (no reasoned discard on that session — the words have no
    // home) and `forbidden` (the caller lacks the capability, or the key is not
    // this tenant's) cannot become true on a later mount. Kept, they re-staged
    // the whole audio on every record-page mount for seven days.
    for (const error of ['not_discarded', 'forbidden'] as const) {
      jest.clearAllMocks()
      mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({ error }))
      await runDiscardTranscript('take-1', PENDING)
      expect(mockDeleteTake).toHaveBeenCalledWith('take-1')
    }
  })

  it('a take already in flight is not staged a second time', async () => {
    // The sweep fires on EVERY record-page mount and the discard arm kicks its
    // own run: navigating away and back inside a long transcription used to pay
    // Deepgram twice for the same audio.
    let release: () => void = () => {}
    mockTranscribeAndPersistDiscard.mockImplementationOnce(
      () => new Promise((res) => { release = () => res({ ok: true }) }),
    )
    const first = runDiscardTranscript('take-1', PENDING)
    for (let i = 0; i < 8; i++) await Promise.resolve()
    await runDiscardTranscript('take-1', PENDING)
    expect(mockStageForJob).toHaveBeenCalledTimes(1)
    expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledTimes(1)

    release()
    await first
    // …and the guard is released with the run, so a later retry still works.
    await runDiscardTranscript('take-1', PENDING)
    expect(mockStageForJob).toHaveBeenCalledTimes(2)
  })

  it('audio that is gone (or belongs to another signed-in staffer) is left alone', async () => {
    mockLoadTakeBlob.mockImplementationOnce(async () => null)
    await runDiscardTranscript('take-1', PENDING)
    // Nothing staged, nothing transcribed — and NOT deleted: on a shared device
    // this is the other staffer's take, and their own sweep can still finish it.
    expect(mockStageForJob).not.toHaveBeenCalled()
    expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
    expect(mockDeleteTake).not.toHaveBeenCalled()
  })

  it('a staging failure never throws at the caller (it is a fire-and-forget kick)', async () => {
    mockStageForJob.mockImplementationOnce(async () => {
      throw new Error('upload failed')
    })
    await expect(runDiscardTranscript('take-1', PENDING)).resolves.toBeUndefined()
    expect(mockDeleteTake).not.toHaveBeenCalled()
  })
})

describe('the mount sweep', () => {
  it('finishes every take a reload left owing', async () => {
    mockListPending.mockImplementationOnce(async () => [
      { takeId: 'take-1', discardPending: PENDING },
      { takeId: 'take-2', discardPending: { ...PENDING, recordingSessionId: 'sess-2' } },
    ])
    await sweepDiscardTranscripts()
    expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledTimes(2)
    expect(mockDeleteTake.mock.calls.map((c) => c[0])).toEqual(['take-1', 'take-2'])
  })
})

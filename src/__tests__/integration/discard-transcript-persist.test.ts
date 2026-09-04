/**
 * @jest-environment jsdom
 *
 * A2-2 client half — lib/recording/discard-transcript.ts.
 *
 * ⚖ WHAT THIS FILE PINS CHANGED IN PR4. It used to be about WHEN the audio
 * dies: a settled answer deleted the take, an unsettled one kept it. Audio is
 * never deleted now (design v2 item 10), so the register's job is narrower and
 * the properties are about the SETTLE MARK instead:
 *
 *   - a settled answer (written, or deliberately not kept) MARKS the take done,
 *     which is what stops the mount sweep re-reading it forever;
 *   - anything unsettled leaves the mark off, so the next sweep retries;
 *   - a take with no finalized object yet is left entirely alone — nothing here
 *     can create one, and nothing here may destroy the only copy while waiting.
 */
const mockPersistDiscardTranscript = jest.fn(async () => ({ ok: true }) as unknown)
const mockTranscribeAndPersistDiscard = jest.fn(async () => ({ ok: true }) as unknown)
jest.mock('@/actions/recording-discard-transcript', () => ({
  persistDiscardTranscript: (...a: unknown[]) => mockPersistDiscardTranscript(...(a as [])),
  transcribeAndPersistDiscard: (...a: unknown[]) =>
    mockTranscribeAndPersistDiscard(...(a as [])),
}))

const mockMarkDone = jest.fn(async (_takeId: string) => {})
const mockStampDiscardPending = jest.fn(async (_takeId: string, _pending: unknown) => true)
type SecureMeta = {
  finalizedPath?: string
  tailIncomplete?: boolean
  stopPendingAt?: number
  durationMs?: number
  secureError?: string
}
const mockReadSecureMeta = jest.fn(
  async (_takeId: string): Promise<SecureMeta | null> => ({
    finalizedPath: 'app_business-1_take-1.webm',
  }),
)
const mockListPending = jest.fn(
  async (): Promise<{ takeId: string; discardPending: unknown }[]> => [],
)
const mockLoadTakeBlob = jest.fn(async (_takeId: string): Promise<Blob | null> =>
  new Blob(['audio']),
)
jest.mock('@/lib/karute/take-store', () => ({
  markDiscardTranscriptDone: (takeId: string) => mockMarkDone(takeId),
  stampDiscardPending: (takeId: string, pending: unknown) =>
    mockStampDiscardPending(takeId, pending),
  readTakeSecureMeta: (takeId: string) => mockReadSecureMeta(takeId),
  listPendingDiscardTakes: () => mockListPending(),
  loadTakeBlob: (takeId: string) => mockLoadTakeBlob(takeId),
  // ⚖ THE REAL RULE, not a restatement of it (PR4 fix round 2). Whether a take
  // can EVER be sealed is the whole question the staging branch asks, and a
  // copy of it here would go green while take-store's own answer drifted.
  isUnsecurableTake: jest.requireActual('@/lib/karute/take-store').isUnsecurableTake,
}))

let mockSupported = true
const mockPrepareTranscription = jest.fn(
  async (_blob: Blob, _finalizedPath: string | null) => ({
    body: { path: 'app_biz-1_staged-1.webm' },
    path: 'app_biz-1_staged-1.webm',
  }),
)
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    supportsDiscardTranscript: mockSupported,
    prepareTranscription: (blob: Blob, finalizedPath: string | null) =>
      mockPrepareTranscription(blob, finalizedPath),
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
  mockReadSecureMeta.mockImplementation(async () => ({
    finalizedPath: 'app_business-1_take-1.webm',
  }))
  mockListPending.mockImplementation(async () => [])
  mockLoadTakeBlob.mockImplementation(async () => new Blob(['audio']))
  mockPrepareTranscription.mockImplementation(async () => ({
    body: { path: 'app_biz-1_staged-1.webm' },
    path: 'app_biz-1_staged-1.webm',
  }))
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
  it('⚖ transcribes the take’s FINALIZED object and stages nothing', async () => {
    await runDiscardTranscript('take-1', PENDING)
    expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledWith({
      recordingSessionId: 'sess-1',
      audioPath: 'app_business-1_take-1.webm',
      durationSeconds: 62,
      locale: 'ja',
    })
    expect(mockMarkDone).toHaveBeenCalledWith('take-1')
  })

  it('a deliberate skip settles it — the reason-only row IS the outcome there', async () => {
    mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({ skipped: 'consent' }))
    await runDiscardTranscript('take-1', PENDING)
    expect(mockMarkDone).toHaveBeenCalledWith('take-1')
  })

  it('a failure leaves the mark OFF — the words are still owed', async () => {
    mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({ error: 'failed' }))
    await runDiscardTranscript('take-1', PENDING)
    expect(mockMarkDone).not.toHaveBeenCalled()
  })

  it('a TERMINAL refusal settles it — no retry can ever change the answer', async () => {
    // `not_discarded` (no reasoned discard on that session — the words have no
    // home) and `forbidden` (the caller lacks the capability, or the key is not
    // this tenant's) cannot become true on a later mount. Unmarked, they made
    // the sweep re-read the whole take off disk on every record-page mount for
    // seven days.
    for (const error of ['not_discarded', 'forbidden'] as const) {
      jest.clearAllMocks()
      mockReadSecureMeta.mockImplementation(async () => ({
        finalizedPath: 'app_business-1_take-1.webm',
      }))
      mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({ error }))
      await runDiscardTranscript('take-1', PENDING)
      expect(mockMarkDone).toHaveBeenCalledWith('take-1')
    }
  })

  it('a take already in flight is not transcribed a second time', async () => {
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
    expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledTimes(1)

    release()
    await first
    // …and the guard is released with the run, so a later retry still works.
    await runDiscardTranscript('take-1', PENDING)
    expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledTimes(2)
  })

  it('a take that is gone (or belongs to another signed-in staffer) is left alone', async () => {
    mockReadSecureMeta.mockImplementationOnce(async () => null)
    await runDiscardTranscript('take-1', PENDING)
    // Nothing transcribed and NOT marked: on a shared device this is the other
    // staffer's take, and their own sweep can still finish it.
    expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
    expect(mockMarkDone).not.toHaveBeenCalled()
  })

  it('⚖ a take not secured YET is left alone too — never marked, never destroyed', async () => {
    // An offline stop: the record page's mount retry secures it, and the next
    // sweep finishes this. Marking it done here would lose the words forever.
    mockReadSecureMeta.mockImplementationOnce(async () => ({}))
    await runDiscardTranscript('take-1', PENDING)
    expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
    expect(mockPrepareTranscription).not.toHaveBeenCalled()
    expect(mockMarkDone).not.toHaveBeenCalled()
  })

  // ⚖ …AND A TAKE THAT WILL NEVER BE SECURED IS NOT "YET" (PR4 fix round 2).
  // Waiting for a finalized object that can never exist is silence for ever:
  // the discard record keeps its REASON and never its words, which is the
  // manager-review half of the ⚖ 8/20 doctrine, lost on exactly the recordings
  // most likely to need it.
  describe('⚖ a take that can NEVER be secured still gives up its words', () => {
    const unsecurable: [string, SecureMeta][] = [
      // The tail never landed — the disk copy is short of what the recorder
      // captured, and the finalized key is immutable (fix round 16).
      ['a lost tail', { tailIncomplete: true }],
      // A stop leg that died before it could stamp: the stamp is the write
      // that clears the flag, so the pair says it never came (fix round 17).
      ['a stop that never finished', { stopPendingAt: 1_756_000_000_000 }],
      // A settled refusal — the drain has already stopped re-uploading it.
      ['a terminal refusal', { secureError: 'reserved_elsewhere' }],
    ]

    for (const [name, meta] of unsecurable) {
      it(`${name}: the words are transcribed from a STAGED path and the take is marked done`, async () => {
        mockReadSecureMeta.mockImplementationOnce(async () => meta)
        await runDiscardTranscript('take-1', PENDING)
        // Staged through the port's OWN fallback — one upload, no second
        // spelling of it in this file, and nothing deleted.
        expect(mockPrepareTranscription).toHaveBeenCalledTimes(1)
        expect(mockPrepareTranscription.mock.calls[0][1]).toBeNull()
        expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledWith(
          expect.objectContaining({
            audioPath: 'app_biz-1_staged-1.webm',
            recordingSessionId: 'sess-1',
          }),
        )
        expect(mockMarkDone).toHaveBeenCalledWith('take-1')
      })
    }

    it('a RETRYABLE refusal is still merely "not yet" — left for the next sweep', async () => {
      // 'session' is a moment in time (a dead socket, a core 5xx), so the drain
      // will ask again and this take gets a finalized key after all.
      mockReadSecureMeta.mockImplementationOnce(async () => ({ secureError: 'session' }))
      await runDiscardTranscript('take-1', PENDING)
      expect(mockPrepareTranscription).not.toHaveBeenCalled()
      expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
      expect(mockMarkDone).not.toHaveBeenCalled()
    })

    it('a stop-pending take that DID get its stamp is securable — nothing is staged', async () => {
      mockReadSecureMeta.mockImplementationOnce(async () => ({
        stopPendingAt: 1_756_000_000_000,
        durationMs: 62_000,
      }))
      await runDiscardTranscript('take-1', PENDING)
      expect(mockPrepareTranscription).not.toHaveBeenCalled()
      expect(mockMarkDone).not.toHaveBeenCalled()
    })

    it('no blob on disk: nothing is staged and the stamp STAYS', async () => {
      // Persistence failed, or the segments never landed. There are no words to
      // collect, and marking it done would close a record whose words were
      // never even looked for.
      mockReadSecureMeta.mockImplementationOnce(async () => ({ tailIncomplete: true }))
      mockLoadTakeBlob.mockImplementationOnce(async () => null)
      await runDiscardTranscript('take-1', PENDING)
      expect(mockPrepareTranscription).not.toHaveBeenCalled()
      expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
      expect(mockMarkDone).not.toHaveBeenCalled()
    })

    it('a failed staging upload leaves the stamp — the next sweep tries again', async () => {
      mockReadSecureMeta.mockImplementationOnce(async () => ({ tailIncomplete: true }))
      mockPrepareTranscription.mockImplementationOnce(async () => {
        throw new Error('Upload failed (403)')
      })
      await expect(runDiscardTranscript('take-1', PENDING)).resolves.toBeUndefined()
      expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
      expect(mockMarkDone).not.toHaveBeenCalled()
    })
  })

  it('a transport throw never escapes at the caller (it is a fire-and-forget kick)', async () => {
    mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => {
      throw new Error('offline')
    })
    await expect(runDiscardTranscript('take-1', PENDING)).resolves.toBeUndefined()
    expect(mockMarkDone).not.toHaveBeenCalled()
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
    expect(mockMarkDone.mock.calls.map((c) => c[0])).toEqual(['take-1', 'take-2'])
  })
})

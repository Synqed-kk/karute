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

/** The recorder's own wait (PR4 fix round 5). What that wait DOES — it waits on
 *  the leg, not on the hold, and gives up at the 120 s belt — is pinned in
 *  take-durability against the real recorder; here it is the thing this reader
 *  has to ASK before it reads the row. Mocked for the reason the lazy import
 *  itself names: the recorder's graph reaches next/cache. */
const mockAwaitTakeSecured = jest.fn(async (_takeId: string) => {})
/** …and the hold that wait can OUTLIVE (slice five fix round 3, F5). The belt
 *  gives up at 120 s; the leg holding the take does not, and while it holds,
 *  the tail is still on its way to disk. */
const mockIsActiveTake = jest.fn((_takeId: string) => false)
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: {
    awaitTakeSecured: (takeId: string) => mockAwaitTakeSecured(takeId),
    isActiveTake: (takeId: string) => mockIsActiveTake(takeId),
  },
}))

const mockMarkDone = jest.fn(async (_takeId: string) => {})
const mockStampDiscardPending = jest.fn(async (_takeId: string, _pending: unknown) => true)
type SecureMeta = {
  finalizedPath?: string
  /** PR4 fix round 4: where the FIRST staging put this take's audio. */
  stagedPath?: string
  /** PR4 fix round 7: slice three stamped the TIME and not the key. */
  finalizedAt?: number
  mimeType?: string
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
const mockMarkTakeStaged = jest.fn(async (_takeId: string, _stagedPath: string) => {})
/** PR4 fix round 7: forget round 4's anonymous staged copy so the next sweep
 *  stages a copy NAMED for this session. */
const mockClearTakeStaged = jest.fn(async (_takeId: string) => {})
jest.mock('@/lib/karute/take-store', () => ({
  markDiscardTranscriptDone: (takeId: string) => mockMarkDone(takeId),
  stampDiscardPending: (takeId: string, pending: unknown) =>
    mockStampDiscardPending(takeId, pending),
  readTakeSecureMeta: (takeId: string) => mockReadSecureMeta(takeId),
  listPendingDiscardTakes: () => mockListPending(),
  loadTakeBlob: (takeId: string) => mockLoadTakeBlob(takeId),
  markTakeStaged: (takeId: string, stagedPath: string) => mockMarkTakeStaged(takeId, stagedPath),
  clearTakeStaged: (takeId: string) => mockClearTakeStaged(takeId),
  // ⚖ THE REAL RULE again (fix round 7): whether a take stamped by slice THREE
  // (finalizedAt, no key) can still name its object is take-store's own answer.
  ensureFinalizedPath: jest.requireActual('@/lib/karute/take-store').ensureFinalizedPath,
  // ⚖ THE REAL RULE, not a restatement of it (PR4 fix round 2). Whether a take
  // can EVER be sealed is the whole question the staging branch asks, and a
  // copy of it here would go green while take-store's own answer drifted.
  isUnsecurableTake: jest.requireActual('@/lib/karute/take-store').isUnsecurableTake,
  // ⚖ …AND THE RELEASE RULE ITSELF (fix round 2). Whether the device may let go
  // of a take is the consequence a failed staging must NOT reach, so the
  // assertion below reads take-store's own answer rather than restating it.
  serverHoldsTake: jest.requireActual('@/lib/karute/take-store').serverHoldsTake,
}))

let mockSupported = true
/** ⚖ THE STAGED COPY IS NAMED FOR ITS SESSION (fix round 7). Only the `stg/`
 *  prefix matters to this file — the grammar itself (and the binding the server
 *  checks) is proven in recording-upload-actions.test.ts. */
const STAGED = 'stg/business-1_sess-1_staged-1.webm'
/** What round 4's staging left behind: an anonymous, take-shaped key. The
 *  transitional cohort below is exactly the takes still carrying one. */
const OLD_STAGED = 'app_biz-1_staged-1.webm'
const mockPrepareTranscription = jest.fn(
  async (
    _blob: Blob,
    _finalizedPath: string | null,
    _opts?: { stagedFor?: string | null; stagedTake?: string | null },
  ) => ({
    body: { path: STAGED },
    path: STAGED,
  }),
)
/** The backfill door (fix round 7): the web arm composes this take's finalized
 *  key server-side, the phone answers null. */
const mockFinalizedKey = jest.fn(
  async (_takeId: string, _mimeType: string) => null as string | null,
)
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    supportsDiscardTranscript: mockSupported,
    prepareTranscription: (
      blob: Blob,
      finalizedPath: string | null,
      opts?: { stagedFor?: string | null; stagedTake?: string | null },
    ) => mockPrepareTranscription(blob, finalizedPath, opts),
    finalizedKey: (takeId: string, mimeType: string) => mockFinalizedKey(takeId, mimeType),
  }),
}))

import { serverHoldsTake } from '@/lib/karute/take-store'
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
  mockAwaitTakeSecured.mockImplementation(async () => {})
  mockIsActiveTake.mockImplementation(() => false)
  mockPersistDiscardTranscript.mockImplementation(async () => ({ ok: true }))
  mockTranscribeAndPersistDiscard.mockImplementation(async () => ({ ok: true }))
  mockReadSecureMeta.mockImplementation(async () => ({
    finalizedPath: 'app_business-1_take-1.webm',
  }))
  mockListPending.mockImplementation(async () => [])
  mockLoadTakeBlob.mockImplementation(async () => new Blob(['audio']))
  mockMarkTakeStaged.mockImplementation(async () => {})
  mockClearTakeStaged.mockImplementation(async () => {})
  mockFinalizedKey.mockImplementation(async () => null)
  mockPrepareTranscription.mockImplementation(async () => ({
    body: { path: STAGED },
    path: STAGED,
  }))
})

describe('the world gate', () => {
  it('follows the recording port', () => {
    expect(discardTranscriptSupported()).toBe(true)
    mockSupported = false
    expect(discardTranscriptSupported()).toBe(false)
  })

  // ⚖ G6: it still persists nothing and still lets the take go — but it MARKS
  // it on the way out, and deliberately does NOT settle it. The words were
  // never looked for in a world with nowhere to persist, so closing the record
  // would be a lie; the stamp keeps the take out of every recovery offer, and
  // the sweep is a no-op here anyway (it reads the world gate first), so the
  // words are still collectable if this world ever gains support.
  it('unsupported: persists nothing, MARKS the take, and never claims the words are settled', async () => {
    mockSupported = false
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(true)
    expect(mockPersistDiscardTranscript).not.toHaveBeenCalled()
    expect(mockStampDiscardPending).toHaveBeenCalledWith('take-1', PENDING)
    expect(mockMarkDone).not.toHaveBeenCalled()
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
    // ⚖ G6: "deletable" is not "deleted" — the never-delete guard refuses this
    // take if the server never received it, so the mark has to be there or the
    // banner re-offers the session the staffer just discarded. The words DID
    // land, so it is settled in the same breath.
    expect(mockStampDiscardPending).toHaveBeenCalledWith('take-1', PENDING)
    expect(mockMarkDone).toHaveBeenCalledWith('take-1')
  })

  it('a deliberate skip is settled too — no consent means no retry is owed', async () => {
    mockPersistDiscardTranscript.mockImplementationOnce(async () => ({ skipped: 'consent' }))
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(true)
    expect(mockStampDiscardPending).toHaveBeenCalledWith('take-1', PENDING)
    expect(mockMarkDone).toHaveBeenCalledWith('take-1')
  })

  it('a FAILED write stamps the take instead, so the audio retry can run', async () => {
    mockPersistDiscardTranscript.mockImplementationOnce(async () => ({ error: 'failed' }))
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(false)
    expect(mockStampDiscardPending).toHaveBeenCalledWith('take-1', PENDING)
    // …and NOT settled — the words are still owed, which is what its `false`
    // holds the take back for (G6 leaves this path exactly as it was).
    expect(mockMarkDone).not.toHaveBeenCalled()
  })

  it('a TERMINAL refusal is settled here too — stamping would buy one wasted upload', async () => {
    for (const error of ['not_discarded', 'forbidden'] as const) {
      jest.clearAllMocks()
      mockPersistDiscardTranscript.mockImplementationOnce(async () => ({ error }))
      await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(true)
      // Marked and SETTLED: nothing can ever change these answers, so the words
      // are as collected as they will ever be.
      expect(mockStampDiscardPending).toHaveBeenCalledWith('take-1', PENDING)
      expect(mockMarkDone).toHaveBeenCalledWith('take-1')
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

  it('⚖ G6: a stamp that could not be written is never marked DONE on top of nothing', async () => {
    // The take is gone, or it is another staffer's. Settling a row that does
    // not exist would be a claim about a record this device cannot see.
    mockStampDiscardPending.mockImplementationOnce(async () => false)
    await expect(persistReviewDiscardTranscript('take-1', PENDING, 'words')).resolves.toBe(true)
    expect(mockMarkDone).not.toHaveBeenCalled()
  })

  it('⚖ G6: no take to mark is still fine — nothing is stamped and nothing is settled', async () => {
    await expect(persistReviewDiscardTranscript(null, PENDING, 'words')).resolves.toBe(true)
    expect(mockStampDiscardPending).not.toHaveBeenCalled()
    expect(mockMarkDone).not.toHaveBeenCalled()
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
          expect.objectContaining({ audioPath: STAGED, recordingSessionId: 'sess-1' }),
        )
        expect(mockMarkDone).toHaveBeenCalledWith('take-1')
      })
    }

    // ⚖ …BUT NOT WHILE THE RECORDER STILL HOLDS IT (slice five fix round 3,
    // F5). `awaitTakeSecured` is belted at 120 s and the HOLD has no deadline
    // (fix round 16 took it away on purpose), so a slow stop leg — a 43 MB PUT
    // on salon wifi, a queued IndexedDB tail — is still holding the take when
    // that belt expires. Its row reads unsecurable (stopPendingAt, no stamp),
    // so the sweep would stage segments 0..N with N+1 still on its way to disk:
    // a SHORT copy. D11 then reads `stagedPath` + the done mark as proof the
    // server holds this take and releases the device's own, longer one — the
    // tail lost for good, on a take that was only ever discarded.
    it('a take the stop leg still HOLDS is not staged — its tail is still landing', async () => {
      mockIsActiveTake.mockImplementation(() => true)
      mockReadSecureMeta.mockImplementationOnce(async () => ({
        stopPendingAt: 1_756_000_000_000,
      }))

      await runDiscardTranscript('take-1', PENDING)

      expect(mockIsActiveTake).toHaveBeenCalledWith('take-1')
      // Nothing staged, nothing claimed, nothing released…
      expect(mockLoadTakeBlob).not.toHaveBeenCalled()
      expect(mockPrepareTranscription).not.toHaveBeenCalled()
      expect(mockMarkTakeStaged).not.toHaveBeenCalled()
      expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
      // …and the stamp STAYS, so the next sweep collects the words once the leg
      // has let go.
      expect(mockMarkDone).not.toHaveBeenCalled()
    })

    it('…and once the leg lets go, the same take stages normally', async () => {
      mockReadSecureMeta.mockImplementationOnce(async () => ({
        stopPendingAt: 1_756_000_000_000,
      }))
      await runDiscardTranscript('take-1', PENDING)
      expect(mockPrepareTranscription).toHaveBeenCalledTimes(1)
      expect(mockMarkTakeStaged).toHaveBeenCalledWith('take-1', STAGED)
      expect(mockMarkDone).toHaveBeenCalledWith('take-1')
    })

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

    // ⚖ …AND IT IS STAGED ONCE (fix round 4, F3). The staging is a WHOLE-TAKE
    // upload and the sweep fires on every record-page mount, so a transcription
    // that genuinely keeps answering `failed` re-uploaded tens of megabytes
    // each time, for ever. The first copy's key is remembered on the take.
    describe('⚖ the staged copy is staged once', () => {
      /** A store that actually REMEMBERS the mark, so the second sweep reads
       *  what the first one wrote — the whole property under test. */
      const stagingStore = (start: SecureMeta) => {
        let meta: SecureMeta = start
        mockReadSecureMeta.mockImplementation(async () => meta)
        mockMarkTakeStaged.mockImplementation(async (_takeId, stagedPath) => {
          meta = { ...meta, stagedPath }
        })
        return () => meta
      }

      it('two sweeps with a failing transcription: ONE upload, and the second reads the same copy', async () => {
        const metaNow = stagingStore({ tailIncomplete: true })
        mockTranscribeAndPersistDiscard.mockImplementation(async () => ({ error: 'failed' }))

        await runDiscardTranscript('take-1', PENDING)
        await runDiscardTranscript('take-1', PENDING)

        expect(mockPrepareTranscription).toHaveBeenCalledTimes(1)
        expect(mockMarkTakeStaged).toHaveBeenCalledWith('take-1', STAGED)
        expect(metaNow().stagedPath).toBe(STAGED)
        // The retry itself is accepted and paid for — one API call per mount,
        // no upload — and it names the copy that is already up there.
        expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledTimes(2)
        expect(mockTranscribeAndPersistDiscard).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ audioPath: STAGED }),
        )
        // Still owed: nothing was settled by a failure.
        expect(mockMarkDone).not.toHaveBeenCalled()
      })

      it('…and when the words finally land, that same copy settles the take', async () => {
        stagingStore({ tailIncomplete: true })
        mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({ error: 'failed' }))
        await runDiscardTranscript('take-1', PENDING)
        await runDiscardTranscript('take-1', PENDING)

        expect(mockPrepareTranscription).toHaveBeenCalledTimes(1)
        expect(mockLoadTakeBlob).toHaveBeenCalledTimes(1)
        expect(mockMarkDone).toHaveBeenCalledWith('take-1')
      })

      it('a FINALIZED key still wins over a staged one — it is what the pipeline reads', async () => {
        mockReadSecureMeta.mockImplementationOnce(async () => ({
          finalizedPath: 'app_business-1_take-1.webm',
          stagedPath: STAGED,
        }))
        await runDiscardTranscript('take-1', PENDING)
        expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledWith(
          expect.objectContaining({ audioPath: 'app_business-1_take-1.webm' }),
        )
      })
    })

    // ⚖ …AND THE COPY IS NAMED FOR ITS SESSION (fix round 7, J1). A staged copy
    // is the only object in this bucket with no row of its own, so without the
    // session in its KEY the transcribe door had nothing to check a claim
    // against: any records.write holder could name a COLLEAGUE'S finished take
    // and have its words written onto an unrelated discarded session.
    // ⚖ A STAGING THAT COULD NOT PROVE ITSELF SETTLES NOTHING (fix round 2). The
    // port throws `staged copy mismatch` when the object already at the key is
    // not this take's own byte length — an object a records.write holder could
    // have put there first, since the key is composable in advance. What must
    // follow is that NOTHING is written: no staged pointer, no done stamp, so
    // serverHoldsTake stays false and D11 never releases the real recording.
    // The next sweep asks the mint again.
    it('a staged copy that is NOT ours settles nothing — the take is never released', async () => {
      mockReadSecureMeta.mockImplementation(async () => ({ tailIncomplete: true }))
      mockPrepareTranscription.mockImplementationOnce(async () => {
        throw new Error('staged copy mismatch')
      })

      await runDiscardTranscript('take-1', PENDING)

      expect(mockMarkTakeStaged).not.toHaveBeenCalled()
      expect(mockMarkDone).not.toHaveBeenCalled()
      expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
      // …and the take the store still holds is one serverHoldsTake refuses:
      // no finalized key, no staged pointer, so the never-delete guard and the
      // TTL prune both keep it. This is the rule the throw exists to protect.
      expect(
        serverHoldsTake({ tailIncomplete: true, stagedPath: undefined, finalizedAt: undefined }),
      ).toBe(false)
      // The second sweep tries again — one JSON call per mount, no upload.
      await runDiscardTranscript('take-1', PENDING)
      expect(mockPrepareTranscription).toHaveBeenCalledTimes(2)
    })

    // ⚖ …AND FOR ITS TAKE (slice five packet B, D10). The take fills the key's
    // uuid slot, so the copy is composable from the core row alone — and a take
    // staged twice lands on the SAME object rather than minting a second one.
    it('the staging names the session it is staged FOR, and the take it is OF', async () => {
      mockReadSecureMeta.mockImplementationOnce(async () => ({ tailIncomplete: true }))
      await runDiscardTranscript('take-1', PENDING)
      expect(mockPrepareTranscription).toHaveBeenCalledWith(expect.any(Blob), null, {
        stagedFor: 'sess-1',
        stagedTake: 'take-1',
      })
    })

    // ⚖ THE TRANSITIONAL COHORT (fix round 7, J1-e). A take stamped BEFORE this
    // round remembers round 4's anonymous, take-shaped staged key — which the
    // door now refuses. Left alone it would be a permanent silence: settled as
    // "done" with words that never landed.
    describe('⚖ a take still carrying round 4’s anonymous staged copy', () => {
      const stale: SecureMeta = { tailIncomplete: true, stagedPath: OLD_STAGED }

      it('is FORGOTTEN once, not settled — so the next sweep stages a bound copy', async () => {
        mockReadSecureMeta.mockImplementationOnce(async () => stale)
        mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({
          error: 'forbidden',
        }))
        await runDiscardTranscript('take-1', PENDING)

        expect(mockClearTakeStaged).toHaveBeenCalledWith('take-1')
        // NOT done: the words are still owed, and the stamp is what keeps the
        // sweep coming back for them.
        expect(mockMarkDone).not.toHaveBeenCalled()
        // Nothing was re-uploaded on the refused pass — the clear is the whole
        // act, and the old object is left exactly where it is.
        expect(mockPrepareTranscription).not.toHaveBeenCalled()
      })

      // Driven through the SWEEP, against a store that remembers: the mark is
      // what takes a take OFF the worklist, so settling this one as "done"
      // would end it here — refused, with words that never landed.
      it('…and the next sweep does stage a bound copy, which lands', async () => {
        let meta: SecureMeta = stale
        let settled = false
        mockReadSecureMeta.mockImplementation(async () => meta)
        mockClearTakeStaged.mockImplementation(async () => {
          meta = { ...meta, stagedPath: undefined }
        })
        mockMarkTakeStaged.mockImplementation(async (_takeId, stagedPath) => {
          meta = { ...meta, stagedPath }
        })
        mockMarkDone.mockImplementation(async () => {
          settled = true
        })
        mockListPending.mockImplementation(async () =>
          settled ? [] : [{ takeId: 'take-1', discardPending: PENDING }],
        )
        mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({
          error: 'forbidden',
        }))

        await sweepDiscardTranscripts()
        await sweepDiscardTranscripts()

        expect(mockMarkTakeStaged).toHaveBeenCalledWith('take-1', STAGED)
        expect(mockMarkDone).toHaveBeenCalledWith('take-1')
      })

      it('a BOUND copy refused is settled as it always was — never cleared, never a loop', async () => {
        // The one thing the clear must not do: re-stage a whole take on every
        // mount against a refusal that will never change.
        mockReadSecureMeta.mockImplementationOnce(async () => ({
          tailIncomplete: true,
          stagedPath: STAGED,
        }))
        mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({
          error: 'forbidden',
        }))
        await runDiscardTranscript('take-1', PENDING)
        expect(mockClearTakeStaged).not.toHaveBeenCalled()
        expect(mockMarkDone).toHaveBeenCalledWith('take-1')
      })

      it('a FINALIZED key refused is settled too — only a claim is ever forgotten', async () => {
        mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => ({
          error: 'forbidden',
        }))
        await runDiscardTranscript('take-1', PENDING)
        expect(mockClearTakeStaged).not.toHaveBeenCalled()
        expect(mockMarkDone).toHaveBeenCalledWith('take-1')
      })
    })

    it('a failed staging upload leaves the stamp — the next sweep tries again', async () => {
      mockReadSecureMeta.mockImplementationOnce(async () => ({ tailIncomplete: true }))
      mockPrepareTranscription.mockImplementationOnce(async () => {
        throw new Error('Upload failed (403)')
      })
      await expect(runDiscardTranscript('take-1', PENDING)).resolves.toBeUndefined()
      expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
      expect(mockMarkDone).not.toHaveBeenCalled()
      // …and nothing was remembered: there is no copy up there to reuse.
      expect(mockMarkTakeStaged).not.toHaveBeenCalled()
    })
  })

  // ⚖ J2 (fix round 7). Slice three stamped `finalizedAt` alone; this reader
  // gates on the KEY. Such a take read as unsecurable-or-not-yet and dead-ended:
  // it can never be "secured" again, and there was no key to transcribe from.
  it('a take finalized before the key was stamped names its object and stages nothing', async () => {
    mockReadSecureMeta.mockImplementationOnce(async () => ({
      finalizedAt: 1_756_000_000_000,
      mimeType: 'audio/webm',
    }))
    mockFinalizedKey.mockImplementationOnce(async () => 'app_business-1_take-1.webm')

    await runDiscardTranscript('take-1', PENDING)

    expect(mockFinalizedKey).toHaveBeenCalledWith('take-1', 'audio/webm')
    expect(mockPrepareTranscription).not.toHaveBeenCalled()
    expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledWith(
      expect.objectContaining({ audioPath: 'app_business-1_take-1.webm' }),
    )
    expect(mockMarkDone).toHaveBeenCalledWith('take-1')
  })

  it('a transport throw never escapes at the caller (it is a fire-and-forget kick)', async () => {
    mockTranscribeAndPersistDiscard.mockImplementationOnce(async () => {
      throw new Error('offline')
    })
    await expect(runDiscardTranscript('take-1', PENDING)).resolves.toBeUndefined()
    expect(mockMarkDone).not.toHaveBeenCalled()
  })
})

// ⚖ …AND THE KICK WAITS FOR THE STOP'S OWN LEG (PR4 fix round 5). Both discard
// arms fire at the discard instant, with that take's whole-take PUT still in
// flight: the row has no key yet, nothing says it can never have one, and the
// run returned. Nothing re-kicks it but a record-page MOUNT — so a staffer who
// stays on the page could reach the store's seven-day prune with a discard
// record that kept its REASON and never its words (the ⚖ 8/20 half).
describe('⚖ the kick waits for the stop’s own leg first', () => {
  it('the stop is still uploading: it asks, holds off the read, then reads the FINALIZED key', async () => {
    let release!: () => void
    const stopLeg = new Promise<void>((r) => {
      release = r
    })
    mockAwaitTakeSecured.mockImplementation(async () => {
      await stopLeg
    })
    // The row as it stands at the discard instant.
    mockReadSecureMeta.mockImplementation(async () => ({}))

    const run = runDiscardTranscript('take-1', PENDING)
    for (let i = 0; i < 8; i++) await Promise.resolve()

    // It asked the recorder first and has NOT touched the row: reading it here
    // is what returned empty-handed and left the words to the next mount.
    expect(mockAwaitTakeSecured).toHaveBeenCalledWith('take-1')
    expect(mockReadSecureMeta).not.toHaveBeenCalled()

    // The leg lands: the key is on the row.
    mockReadSecureMeta.mockImplementation(async () => ({
      finalizedPath: 'app_business-1_take-1.webm',
    }))
    release()
    await run

    // ONE transcription, off the object the stop already PUT — nothing staged,
    // and the take is settled by this FIRST kick.
    expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledTimes(1)
    expect(mockTranscribeAndPersistDiscard).toHaveBeenCalledWith(
      expect.objectContaining({ audioPath: 'app_business-1_take-1.webm' }),
    )
    expect(mockPrepareTranscription).not.toHaveBeenCalled()
    expect(mockMarkDone).toHaveBeenCalledWith('take-1')
  })

  it('a leg that never settles: the belt lets the run proceed, it is not pinned for ever', async () => {
    jest.useFakeTimers()
    try {
      // The recorder's 120 s belt, modelled — the real one is pinned in
      // take-durability. What THIS side owes is that it waits on that promise
      // and goes on the moment it resolves, however it resolves.
      mockAwaitTakeSecured.mockImplementation(
        () =>
          new Promise<void>((r) => {
            setTimeout(r, 120_000)
          }),
      )
      mockReadSecureMeta.mockImplementation(async () => ({}))

      const run = runDiscardTranscript('take-1', PENDING)
      for (let i = 0; i < 8; i++) await Promise.resolve()
      expect(mockReadSecureMeta).not.toHaveBeenCalled()

      jest.advanceTimersByTime(120_000)
      await run

      // It PROCEEDED, and then answered exactly as it does today: no key yet,
      // so the stamp stays for the next sweep. Nothing hangs, nothing is lost.
      expect(mockReadSecureMeta).toHaveBeenCalledWith('take-1')
      expect(mockTranscribeAndPersistDiscard).not.toHaveBeenCalled()
      expect(mockMarkDone).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
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

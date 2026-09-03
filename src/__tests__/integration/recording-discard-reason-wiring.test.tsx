/**
 * @jest-environment jsdom
 *
 * P5-A — the written-reason gate, wired at BOTH deliberate-discard
 * chokepoints (packet PACKET-P5-DISCARD-2026-08-25.md A-2/A-3, ⚖ 8/17).
 *
 * A deliberate discard is the one recording event that leaves no trace
 * anywhere else. So the property under test is not "a dialog appears" — it is
 * that NOTHING is thrown away until the trace has actually landed, at every
 * site, in every failure mode:
 *
 *   - both chokepoints go through the SAME gate, with the session id each one
 *     actually owns (the recorder’s minted id / the pipeline’s captured one);
 *   - a discard that cannot key its reason row (no session id) does NOT
 *     happen, and neither does one core refuses;
 *   - a failure leaves the take, the draft, the persisted audio and the
 *     session row exactly where they were, and lets the staff member retry;
 *   - a double tap files ONE discard.
 *
 * The mock scaffold mirrors recording-session-cleanup-wiring.test.tsx (the
 * documented mock set for mounting RecordPageView under jsdom).
 */
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))

const mockDeleteRecordingSession = jest.fn(
  async (): Promise<{ ok: true } | { error: string }> => ({ ok: true }),
)
jest.mock('@/actions/recordings', () => ({
  startRecordingSession: jest.fn(),
  deleteRecordingSession: () => mockDeleteRecordingSession(),
}))
/** P5-A: every deliberate discard now passes the written-reason gate first,
 *  and the cleanup only runs once that gate reports success. */
const mockDiscardWithReason = jest.fn(async (input: unknown) => {
  void input // the mock is input-agnostic; the ARG is what the wiring asserts on
  return { ok: true, receiptId: 'row-1', duplicate: false } as const
})
jest.mock('@/actions/recording-discard', () => ({
  discardRecordingWithReason: (input: unknown) => mockDiscardWithReason(input),
}))
jest.mock('@/actions/recording-discards', () => ({
  myDiscardCountThisMonth: jest.fn(async () => null),
  listDiscardReasons: jest.fn(async () => ({ ok: false, error: 'forbidden' })),
}))
jest.mock('@/actions/karute', () => ({
  saveKaruteRecord: jest.fn(),
  saveKaruteRecordInline: jest.fn(async () => ({ id: 'karute-1' })),
}))
jest.mock('@/actions/recovery', () => ({
  getRecoveryDayFacts: jest.fn(async () => ({
    date: '2026-08-25',
    bookings: [],
    packs: [],
    redeemed: { appointmentIds: [], customerIds: [] },
  })),
}))
/** The server-side photo delete the gate awaits on the recorder arm. Held
 *  pending by the photo-deletion-window case below — that await IS the
 *  window under test. */
const mockDeleteCustomerPhoto = jest.fn(async () => ({ success: true }) as { success: boolean })
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
  listCustomerPhotos: jest.fn(async () => ({ photos: [] })),
  uploadCustomerPhoto: jest.fn(async () => ({ photo: { id: 'p1' } })),
  deleteCustomerPhoto: () => mockDeleteCustomerPhoto(),
}))
jest.mock('@/actions/packs', () => ({
  createPackAction: jest.fn(),
  redeemSessionAction: jest.fn(),
  undoRedemptionAction: jest.fn(),
}))
jest.mock('@/actions/recordings-inbox', () => ({ listRecordingsInbox: jest.fn(async () => []) }))
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  const button = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('button', rest, children as React.ReactNode)
  return new Proxy({}, { get: (_t, p) => (p === 'Button' ? button : passthrough) })
})
/** ⚖ 8/26 rider — the banner origin's offer. null for every existing test
 *  (no banner renders); the banner-origin describe block below sets a
 *  below-floor take so RecoveryBanner's belowFloor discard link appears. */
let mockRecoverableTake: Record<string, unknown> | null = null
const mockStampDiscardPending = jest.fn(async (_takeId: string, _pending: unknown) => true)
// Capture pipeline PR3 — the record page's mount retry. This suite's take-store
// is a fake, so the real secureTake would reach for functions that are not in
// it; nothing here is about whether the audio reaches the server (that is
// take-durability.test.ts + recovery-banner-save-only.test.tsx).
jest.mock('@/lib/recording/secure-take', () => ({ secureTake: jest.fn(async () => {}) }))

jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  // A2-2 — the discard-transcript register.
  stampDiscardPending: (takeId: string, pending: unknown) =>
    mockStampDiscardPending(takeId, pending),
  listPendingDiscardTakes: jest.fn(async () => []),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: jest.fn(async () => {}),
  readTakeOutcome: jest.fn(async () => null),
  listOwnTakes: jest.fn(async () => []),
  listOwnStoppedUnsecuredTakeIds: jest.fn(async () => []),
  getRecoverableTake: jest.fn(async () => mockRecoverableTake),
  loadTakeBlob: jest.fn(async () => new Blob(['audio'])),
  // The logout-wipe test runs the REAL wipeSessionVault through this module.
  clearOwnTakes: jest.fn(async () => {}),
}))
/** A2-2 — the persist seam. These tests are about WHAT the record page hands
 *  it and what it lets the page delete; the module's own behaviour (the
 *  support gate, the stamp, the staging run) is proven in
 *  discard-transcript-persist.test.ts. */
let mockDiscardTranscriptSupported = true
const mockPersistReviewDiscard = jest.fn(
  async (_takeId: string | null | undefined, _pending: unknown, _transcript: string) => true,
)
const mockRunDiscardTranscript = jest.fn(async (_takeId: string, _pending: unknown) => {})
jest.mock('@/lib/recording/discard-transcript', () => ({
  discardTranscriptSupported: () => mockDiscardTranscriptSupported,
  persistReviewDiscardTranscript: (
    takeId: string | null | undefined,
    pending: unknown,
    transcript: string,
  ) => mockPersistReviewDiscard(takeId, pending, transcript),
  runDiscardTranscript: (takeId: string, pending: unknown) =>
    mockRunDiscardTranscript(takeId, pending),
  sweepDiscardTranscripts: jest.fn(async () => {}),
}))
jest.mock('@/lib/karute/draft', () => ({
  loadDraft: jest.fn(async () => null),
  clearDraft: jest.fn(),
  currentUserId: jest.fn(async () => 'staff-A'),
}))
jest.mock('@/lib/karute/ai-slot-cache', () => ({ clearAiSlotCache: jest.fn() }))

/** The recorder singleton's live session id — what proceedDiscard must read
 *  BEFORE discardRecording() nulls it. Inlined in the factory below: jest
 *  hoists jest.mock above every const. */
const RECORDER_SESSION = 'sess-live'
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: {
    takeId: null,
    state: 'idle',
    recordingSessionId: 'sess-live',
    subscribe: () => () => {},
    // The logout-wipe test drives the REAL wipeSessionVault through this.
    discard: jest.fn(),
    // Fix round 1: the gate's SECOND chance at a session id. The mint runs once
    // at start() and its promise stays settled, so a failed one made every
    // retry of the bounded await return null again — the discard dead-ended
    // forever. Defaults to "still no id" so the fail-closed cases below are
    // unchanged; the recovery case overrides it.
    retryRecordingSessionMint: jest.fn(async (): Promise<string | null> => null),
  },
}))
let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'recorded'
/** A2-2: the recorder take's length. 60 s (well above BELOW_FLOOR_SEC) unless a
 *  test asks for an accidental tap. */
let mockDurationMs = 60_000
/** The bound customer. null for every case except the photo-deletion window —
 *  session photos only exist for a take bound to a customer. */
let mockTarget: { customerId: string; customerName: string } | null = null
const mockDiscardRecording = jest.fn()
/** The recorder's bounded session-id mint (global-recorder.ts, 1500ms). The
 *  gate awaits it and FAILS CLOSED on null. */
const mockAwaitSession = jest.fn(async (): Promise<string | null> => 'sess-live')
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: mockRecState,
    result: mockRecState === 'recorded' ? { blob: new Blob(['a']), durationMs: mockDurationMs } : null,
    error: null,
    stream: null,
    startedAt: mockRecState === 'idle' ? null : Date.now(),
    overrun: false,
    autoStopped: false,
    target: mockTarget,
    takeId: null,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    discardRecording: (...a: unknown[]) => mockDiscardRecording(...a),
    awaitRecordingSessionId: () => mockAwaitSession(),
  }),
}))

/** The pipeline's own session id — the ReviewScreen chokepoint's source, AND
 *  (⚖ 8/26 rider) the empty-transcript error card's, since 'pipeline-error'
 *  mirrors 'review' exactly and shares this same ctx shape. Inlined in the
 *  factories below for the same hoisting reason. */
const PIPELINE_SESSION = 'sess-reviewed'
let mockPipelineState: 'idle' | 'processing' | 'review' | 'error' = 'idle'
/** ⚖ 8/26 rider — the error card's code, live only in the 'error' state.
 *  Defaults to the qualifying code so a test can flip mockPipelineState alone;
 *  a test asserting the non-qualifying cases overrides it. */
let mockPipelineErrorCode: 'empty-transcript' | 'consent-required' | 'unknown' =
  'empty-transcript'
/** SHOULD-FIX-5 — the phone/server arm's own flag (global-pipeline.ts's
 *  `serverOwned`, set true at pollServerJob entry, never for an in-tab run).
 *  confirmDiscardReason reads it straight off the singleton, not the hook —
 *  live here for the same reason. Defaults false (in-tab); a test flips it. */
let mockServerOwned = false
const mockPipelineReset = jest.fn()
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    version: 0,
    get state() {
      return mockPipelineState
    },
    step: null,
    get result() {
      return mockPipelineState === 'review'
        ? { transcript: 't', entries: [], summary: 's' }
        : null
    },
    error: null,
    get context() {
      // ⚖ 8/26 rider: 'error' carries the same ctx shape as 'review' — the
      // pipeline-error origin keys off it the identical way.
      return mockPipelineState === 'review' || mockPipelineState === 'error'
        ? { customers: [], duration: 60, recordingSessionId: 'sess-reviewed', takeId: 'take-1' }
        : null
    },
    get serverOwned() {
      return mockServerOwned
    },
    runId: 1,
    savedRecordId: null,
    subscribe: () => () => {},
    start: jest.fn(),
    retry: jest.fn(),
    reset: (...a: unknown[]) => mockPipelineReset(...a),
  },
}))
jest.mock('@/hooks/use-global-pipeline', () => ({
  useGlobalPipeline: () => ({
    state: mockPipelineState,
    error: mockPipelineState === 'error' ? mockPipelineErrorCode : null,
    result:
      mockPipelineState === 'review' ? { transcript: 't', entries: [], summary: 's' } : null,
    context:
      mockPipelineState === 'review' || mockPipelineState === 'error'
        ? { customers: [], duration: 60, recordingSessionId: 'sess-reviewed', takeId: 'take-1' }
        : null,
    start: jest.fn(),
    retry: jest.fn(),
    reset: (...a: unknown[]) => mockPipelineReset(...a),
  }),
}))
jest.mock('@/components/review/ReviewScreen', () => ({
  ReviewScreen: ({ onDiscard, onSaved }: { onDiscard: () => void; onSaved: () => void }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createElement } = require('react') as typeof import('react')
    return createElement('div', null, [
      createElement('button', { key: 'd', onClick: onDiscard }, 'review-discard'),
      createElement('button', { key: 's', onClick: onSaved }, 'review-saved'),
    ])
  },
}))

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  RecordPageView,
  type RecordPageViewProps,
} from '@/components/karute/redesign/record/RecordPageView'
import { globalRecorder } from '@/lib/global-recorder'
import { globalPipeline } from '@/lib/global-pipeline'
import { resetInbox } from '@/lib/recordings/inbox-store'
import { sessionPhotoStore, type SessionPhoto } from '@/lib/karute/session-photos'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

/** The re-mint the gate falls back to when the bounded await comes up empty. */
const mockRetryMint = globalRecorder.retryRecordingSessionMint as jest.Mock
/** The recorder's live take id — mutable, because the 使用/破棄 race is a
 *  question about which take the singleton is holding right now. */
const recorderTake = globalRecorder as unknown as { takeId: string | null }
const mockPipelineStart = globalPipeline.start as jest.Mock

async function renderPage(overrides: Partial<RecordPageViewProps> = {}) {
  const r = render(
    <RecordPageView
      customers={[]}
      locale="ja"
      nextAppointment={null}
      nearbyBookings={[]}
      brief={null}
      aiBriefPromise={Promise.resolve(null)}
      recentRecordings={[]}
      consentDate={null}
      currentStaffName="原"
      ticketsEnabled={false}
      {...overrides}
    />,
  )
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
  return r
}


beforeEach(() => {
  jest.clearAllMocks()
  resetInbox()
  mockRecState = 'recorded'
  mockDurationMs = 60_000
  mockDiscardTranscriptSupported = true
  mockStampDiscardPending.mockImplementation(async () => true)
  mockPersistReviewDiscard.mockImplementation(async () => true)
  mockPipelineState = 'idle'
  mockPipelineErrorCode = 'empty-transcript'
  mockServerOwned = false
  mockRecoverableTake = null
  mockAwaitSession.mockImplementation(async () => RECORDER_SESSION)
  recorderTake.takeId = null
  mockTarget = null
  sessionPhotoStore.photos = []
  mockDeleteCustomerPhoto.mockImplementation(async () => ({ success: true }))
  mockDiscardWithReason.mockImplementation(async () => ({
    ok: true,
    receiptId: 'row-1',
    duplicate: false,
  }))
})

afterEach(() => {
  cleanup()
  resetInbox()
})

const REASON = 'お客様が席を外したため録り直します'
const reasonGate = () => screen.queryByText('discardReason.title')

async function tapDiscard(trigger: string) {
  await act(async () => {
    fireEvent.click(screen.getByText(trigger))
  })
}
async function writeReason(text = REASON) {
  await act(async () => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  })
}
async function confirmReason() {
  await act(async () => {
    fireEvent.click(screen.getByText('discardReason.confirm'))
  })
}

// ── 1. ONE gate, BOTH chokepoints ─────────────────────────────────────

describe('both deliberate-discard chokepoints go through the gate', () => {
  it('the 破棄 button: no discard on the tap, the reason lands first, THEN the take goes', async () => {
    await renderPage()
    await tapDiscard('discard')

    // The tap opens the gate and does nothing else — this is the whole
    // point of the ruling: there is no one-tap discard any more.
    expect(reasonGate()).not.toBeNull()
    expect(mockDiscardWithReason).not.toHaveBeenCalled()
    expect(mockDiscardRecording).not.toHaveBeenCalled()

    await writeReason()
    await confirmReason()

    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    expect(mockDiscardWithReason.mock.calls[0][0]).toMatchObject({
      recordingSessionId: RECORDER_SESSION,
      reason: REASON,
    })
    expect(mockDiscardRecording).toHaveBeenCalledTimes(1)
    expect(reasonGate()).toBeNull()
  })

  it('the 破棄 button bounded-awaits the mint (a fast discard can beat it)', async () => {
    await renderPage()
    await tapDiscard('discard')
    await writeReason()
    await confirmReason()

    expect(mockAwaitSession).toHaveBeenCalled()
  })

  it('ReviewScreen’s 破棄: same gate, and it keys on the PIPELINE’s session id', async () => {
    mockPipelineState = 'review'
    await renderPage()
    await tapDiscard('review-discard')

    expect(reasonGate()).not.toBeNull()
    expect(mockPipelineReset).not.toHaveBeenCalled()

    await writeReason()
    await confirmReason()

    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    expect(mockDiscardWithReason.mock.calls[0][0]).toMatchObject({
      recordingSessionId: PIPELINE_SESSION,
      reason: REASON,
    })
    // The review path’s own cleanup runs only after the trace landed.
    expect(mockPipelineReset).toHaveBeenCalledTimes(1)
    // …and it never asks the RECORDER for an id it does not own.
    expect(mockAwaitSession).not.toHaveBeenCalled()
  })

  it('the reason text reaches the server verbatim, trimmed', async () => {
    await renderPage()
    await tapDiscard('discard')
    await writeReason('   録り直します   ')
    await confirmReason()

    expect(mockDiscardWithReason.mock.calls[0][0]).toMatchObject({ reason: '録り直します' })
  })
})

// ── 2. Fail closed ─────────────────────────────────────────────────────

describe('a discard that cannot leave its trace does not happen', () => {
  it('no session id (the mint never landed, and re-minting fails too) → nothing is discarded, the gate stays open', async () => {
    mockAwaitSession.mockImplementation(async () => null)
    await renderPage()
    await tapDiscard('discard')
    await writeReason()
    await confirmReason()

    // The await came back empty, so the gate tried ONCE more to mint the id
    // rather than re-awaiting a promise that can only ever answer null again.
    expect(mockRetryMint).toHaveBeenCalledTimes(1)
    // That failed too — so there is still nowhere to key the reason row (G14).
    expect(mockDiscardWithReason).not.toHaveBeenCalled()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
    expect(mockDeleteRecordingSession).not.toHaveBeenCalled()
    // The staff member is told, keeps their text, and can try again.
    expect(screen.getByRole('alert')).toHaveTextContent('discardReason.failed')
    expect(screen.getByRole('textbox')).toHaveValue(REASON)
    expect(reasonGate()).not.toBeNull()
  })

  // THE fix-round-1 case. Before it, a mint that failed at recording start left
  // the staff member with no way to throw the take away at all: their only exits
  // were saving audio they wanted gone, or walking away and meeting the recovery
  // banner again. The copy promised a retry that could not work.
  it('a failed mint is RE-MINTED on confirm, and the discard then goes through', async () => {
    mockAwaitSession.mockImplementation(async () => null)
    mockRetryMint.mockImplementationOnce(async () => 'sess-reminted')
    await renderPage()
    await tapDiscard('discard')
    await writeReason()
    await confirmReason()

    expect(mockRetryMint).toHaveBeenCalledTimes(1)
    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    // The re-minted id is what the reason row keys on.
    expect(mockDiscardWithReason.mock.calls[0][0]).toMatchObject({
      recordingSessionId: 'sess-reminted',
      reason: REASON,
    })
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(reasonGate()).toBeNull()
  })

  // ── The 使用/破棄 race (fix round 1) ────────────────────────────────────
  // proceedDiscard bumps useRecordingGen, and since P5-A it runs only AFTER the
  // server round-trip — so for the whole dialog lifetime an in-flight 使用 was
  // unguarded. It would hand the very take the staff member is mid-破棄 to
  // transcription, which then resurfaces it as a save offer (and bills the
  // run): the R2 outcome the doctrine forbids. The gate latches its take.
  it('a take handed to the pipeline while the gate was open is NOT discarded', async () => {
    recorderTake.takeId = 'take-1'
    await renderPage()
    await tapDiscard('discard')
    await writeReason()
    // 使用 won the race: the recorder moved on to a different take.
    recorderTake.takeId = 'take-2'
    await confirmReason()

    expect(mockDiscardWithReason).not.toHaveBeenCalled()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('discardReason.takeChanged')
    // Fails closed like every other refusal: text kept, gate open, retryable.
    expect(screen.getByRole('textbox')).toHaveValue(REASON)
    expect(reasonGate()).not.toBeNull()
  })

  it('an in-flight 使用 drops its take while a discard gate is open for it', async () => {
    recorderTake.takeId = 'take-1'
    await renderPage()
    await tapDiscard('discard')

    // The gate is open for take-1; 使用 resolving now must not pipeline it.
    await act(async () => {
      fireEvent.click(screen.getByText('useRecording'))
    })

    expect(mockPipelineStart).not.toHaveBeenCalled()
  })

  // …and the latch has to cover the WHOLE window, not just the dialog's life.
  // The recorder arm awaits the customer's photo deletion between core's OK
  // and proceedDiscard(). The clear used to sit ahead of that await: the gate
  // was closed, the phase was still 'recorded' and useRecordingGen had not
  // moved, so a 使用 tap landing in the deletion window sailed past every
  // guard and handed transcription a take THE SERVER HAD ALREADY DISCARDED —
  // it comes back as a save offer for a recording that no longer exists, and
  // bills the run. The exact R2 outcome the latch was built to prevent, one
  // step later.
  it('a 使用 tap DURING the photo deletion is refused too — the latch outlives the window', async () => {
    recorderTake.takeId = 'take-1'
    mockTarget = { customerId: 'cust-A', customerName: 'テスト花子' }
    sessionPhotoStore.photos = [
      {
        id: 'sp1',
        objectUrl: 'blob:mock',
        status: 'done',
        file: new File(['x'], 'a.jpg'),
        category: 'before',
        customerId: 'cust-A',
        serverId: 's-a',
        takenWithConsent: true,
      } as SessionPhoto,
    ]
    // The deletion is held open — this pending promise IS the window.
    let releaseDelete: (v: { success: boolean }) => void = () => {}
    mockDeleteCustomerPhoto.mockImplementationOnce(
      () => new Promise((res) => { releaseDelete = res }),
    )

    await renderPage()
    await tapDiscard('discard')
    // Photos on screen → the photos confirm comes first; 写真も削除 arms the
    // deletion the gate will run once the reason has landed.
    await act(async () => {
      fireEvent.click(screen.getByText('sessionPhotos.discardPhotosDelete'))
    })
    await writeReason()
    await confirmReason()

    // Core said OK and the gate closed, but the take is NOT gone yet — the
    // deletion is still in flight, so proceedDiscard has not run.
    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    expect(reasonGate()).toBeNull()
    expect(mockDiscardRecording).not.toHaveBeenCalled()

    // THE TAP. Nothing on screen says this take is spoken for any more.
    await act(async () => {
      fireEvent.click(screen.getByText('useRecording'))
    })
    expect(mockPipelineStart).not.toHaveBeenCalled()

    // The window closes and the discard completes as it always did.
    await act(async () => {
      releaseDelete({ success: true })
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(mockPipelineStart).not.toHaveBeenCalled()
  })

  it('core refuses → nothing is discarded, and a retry still works', async () => {
    mockDiscardWithReason.mockImplementationOnce(
      async () => ({ ok: false, error: 'discard_row_failed' }) as never,
    )
    await renderPage()
    await tapDiscard('discard')
    await writeReason()
    await confirmReason()

    expect(mockDiscardRecording).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('discardReason.failed')

    // Retry — the second attempt succeeds and the take finally goes.
    await confirmReason()
    expect(mockDiscardWithReason).toHaveBeenCalledTimes(2)
    expect(mockDiscardRecording).toHaveBeenCalledTimes(1)
  })

  it('a failed review discard leaves the draft, the audio and the pipeline alone', async () => {
    mockDiscardWithReason.mockImplementation(async () => ({ ok: false, error: 'failed' }) as never)
    mockPipelineState = 'review'
    await renderPage()
    await tapDiscard('review-discard')
    await writeReason()
    await confirmReason()

    expect(mockPipelineReset).not.toHaveBeenCalled()
    expect(mockDeleteRecordingSession).not.toHaveBeenCalled()
  })

  it('cancel always backs out cleanly — nothing written, nothing thrown away', async () => {
    await renderPage()
    await tapDiscard('discard')
    await writeReason()
    await act(async () => {
      fireEvent.click(screen.getByText('cancel'))
    })

    expect(reasonGate()).toBeNull()
    expect(mockDiscardWithReason).not.toHaveBeenCalled()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
  })
})

// ── 3. One tap, one discard ────────────────────────────────────────

describe('double tap on 破棄する', () => {
  it('files exactly ONE discard — the second tap lands inside the same tick', async () => {
    // The realistic race: React has not re-rendered with submitting=true yet,
    // so the button is not disabled on screen. Only the ref catches this.
    let release: (v: unknown) => void = () => {}
    mockDiscardWithReason.mockImplementationOnce(
      () => new Promise((res) => { release = res }) as never,
    )
    await renderPage()
    await tapDiscard('discard')
    await writeReason()

    const confirm = screen.getByText('discardReason.confirm')
    // Both taps are dispatched inside ONE act, with no render between them —
    // that is the real race. fireEvent flushes on the way out, so two
    // fireEvent calls would let React re-render (and disable the button)
    // between the taps and quietly prove nothing: the second handler would
    // read a FRESH submitting=true. Raw dispatch keeps both handlers on the
    // same stale render, which is exactly what the phone does on a
    // double-tap, and only the synchronous ref can catch it.
    const tap = () => confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await act(async () => {
      tap()
      tap()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    await act(async () => {
      release({ ok: true, receiptId: 'row-1', duplicate: false })
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    expect(mockDiscardRecording).toHaveBeenCalledTimes(1)
  })

  it('cancel is inert while a confirm is in flight', async () => {
    let release: (v: unknown) => void = () => {}
    mockDiscardWithReason.mockImplementationOnce(
      () => new Promise((res) => { release = res }) as never,
    )
    await renderPage()
    await tapDiscard('discard')
    await writeReason()

    fireEvent.click(screen.getByText('discardReason.confirm'))
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    fireEvent.click(screen.getByText('cancel'))
    await act(async () => {
      release({ ok: true, receiptId: 'row-1', duplicate: false })
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    // The cancel did not abort the in-flight discard.
    expect(mockDiscardRecording).toHaveBeenCalledTimes(1)
  })
})

// ── 4. The gate is not optional ──────────────────────────────────

describe('there is no way past the gate', () => {
  it('a blank reason cannot be confirmed at either chokepoint', async () => {
    for (const trigger of ['discard', 'review-discard']) {
      mockPipelineState = trigger === 'review-discard' ? 'review' : 'idle'
      await renderPage()
      await tapDiscard(trigger)
      await writeReason('     ')
      await confirmReason()

      expect(mockDiscardWithReason).not.toHaveBeenCalled()
      expect(reasonGate()).not.toBeNull()
      cleanup()
      jest.clearAllMocks()
      mockAwaitSession.mockImplementation(async () => RECORDER_SESSION)
    }
  })
})

// ── 5. ⚖ 8/26 rider — the empty-transcript refusal card (pipeline-error) ──
// Ruled case (a): the moment the refusal is known IS the moment the loop's
// exit condition is proven. 'pipeline-error' mirrors 'review' EXACTLY, so
// these pin the same payload/cleanup shape as section 1's review tests.

describe('the empty-transcript refusal card (pipeline-error origin)', () => {
  it('same gate, keyed on the PIPELINE context like review — payload and cleanup match', async () => {
    mockPipelineState = 'error'
    await renderPage()
    await tapDiscard('discardTakeAction')

    expect(reasonGate()).not.toBeNull()
    expect(mockPipelineReset).not.toHaveBeenCalled()

    await writeReason()
    await confirmReason()

    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    expect(mockDiscardWithReason.mock.calls[0][0]).toMatchObject({
      recordingSessionId: PIPELINE_SESSION,
      takeId: 'take-1',
      reason: REASON,
      durationSeconds: 60,
      // SHOULD-FIX-5: the in-tab arm's payload — the pipeline field is the
      // ONE thing this run's cleanup gets from `ctxKeyed` that the banner
      // origin never reads.
      pipeline: 'in_tab',
    })
    // BLOCKER-1: this origin's own inline cleanup (NOT finishReviewDiscard —
    // that would clearDraft() a foreign session's crash-surviving draft this
    // run never wrote). Session-scoped take deletion + reset, no draft touch.
    const { deleteTake } = jest.requireMock('@/lib/karute/take-store') as { deleteTake: jest.Mock }
    const { clearDraft } = jest.requireMock('@/lib/karute/draft') as { clearDraft: jest.Mock }
    expect(deleteTake).toHaveBeenCalledWith('take-1')
    expect(clearDraft).not.toHaveBeenCalled()
    expect(mockPipelineReset).toHaveBeenCalledTimes(1)
    expect(mockAwaitSession).not.toHaveBeenCalled()
  })

  // SHOULD-FIX-5: the phone/server arm — global-pipeline.ts sets serverOwned
  // true before the poll loop for a FAILED/EMPTY_TRANSCRIPT job, and the
  // reviewer traced this branch was live but unobserved by any test.
  it('the payload records pipeline: server when the run was server-owned', async () => {
    mockPipelineState = 'error'
    mockServerOwned = true
    await renderPage()
    await tapDiscard('discardTakeAction')
    await writeReason()
    await confirmReason()

    expect(mockDiscardWithReason.mock.calls[0][0]).toMatchObject({ pipeline: 'server' })
  })

  it('never offers the exit for a non-qualifying error code', async () => {
    mockPipelineState = 'error'
    mockPipelineErrorCode = 'unknown'
    await renderPage()
    expect(screen.queryByText('discardTakeAction')).toBeNull()
  })

  it('a core refusal leaves the take alone, exactly like review', async () => {
    mockPipelineState = 'error'
    mockDiscardWithReason.mockImplementationOnce(
      async () => ({ ok: false, error: 'failed' }) as never,
    )
    await renderPage()
    await tapDiscard('discardTakeAction')
    await writeReason()
    await confirmReason()

    expect(mockPipelineReset).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('discardReason.failed')
  })
})

// ── 6. ⚖ 8/26 rider — a below-floor take offered at the banner ────────────
// Ruled case (b): its own snapshot-at-open latch (bannerDiscardSnapshotRef),
// its own mint-retry params, and its own cleanup (deleteTake — no pipeline to
// reset, nothing is running).

describe('a below-floor take offered at the banner (banner origin)', () => {
  const BELOW_FLOOR_TAKE = {
    takeId: 'take-bf',
    target: {
      customerId: 'cust-bf',
      customerName: 'テスト花子',
      karuteNumber: '#00099',
      appointmentId: 'appt-bf',
    },
    recordingSessionId: 'sess-bf',
    mimeType: 'audio/webm',
    startedAt: Date.parse('2026-08-26T05:00:00Z'),
    updatedAt: Date.parse('2026-08-26T05:00:05Z'), // 5s — under the floor
  }

  beforeEach(() => {
    // Idle: the banner is offered only fully idle, never behind a live take.
    mockRecState = 'idle'
  })

  it('a session id already on the take: no mint-retry, and the payload + cleanup are honest', async () => {
    mockRecoverableTake = BELOW_FLOOR_TAKE
    await renderPage()
    await waitFor(() => screen.getByText('discardTakeAction'))
    await tapDiscard('discardTakeAction')
    await writeReason()
    await confirmReason()

    expect(mockRetryMint).not.toHaveBeenCalled()
    expect(mockAwaitSession).not.toHaveBeenCalled()
    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    expect(mockDiscardWithReason.mock.calls[0][0]).toMatchObject({
      recordingSessionId: 'sess-bf',
      takeId: 'take-bf',
      reason: REASON,
      durationSeconds: 5,
      customerId: 'cust-bf',
      appointmentId: 'appt-bf',
      pipeline: 'in_tab',
    })
    // Cleanup: the take is deleted and the offer clears — no pipeline reset,
    // since nothing was running for an idle-offered banner take.
    const { deleteTake } = jest.requireMock('@/lib/karute/take-store') as { deleteTake: jest.Mock }
    expect(deleteTake).toHaveBeenCalledWith('take-bf')
    expect(mockPipelineReset).not.toHaveBeenCalled()
    expect(screen.queryByText('recoverBannerTitle')).toBeNull()
  })

  it('no session id on the take: ONE mint-retry with the snapshot, then the discard goes through', async () => {
    mockRecoverableTake = { ...BELOW_FLOOR_TAKE, recordingSessionId: null }
    mockRetryMint.mockImplementationOnce(async () => 'sess-bf-reminted')
    await renderPage()
    await waitFor(() => screen.getByText('discardTakeAction'))
    await tapDiscard('discardTakeAction')
    await writeReason()
    await confirmReason()

    expect(mockRetryMint).toHaveBeenCalledTimes(1)
    expect(mockRetryMint).toHaveBeenCalledWith({
      customerId: 'cust-bf',
      appointmentId: 'appt-bf',
      takeId: 'take-bf',
    })
    expect(mockDiscardWithReason.mock.calls[0][0]).toMatchObject({
      recordingSessionId: 'sess-bf-reminted',
    })
  })

  it('no session id and the re-mint fails too: fails closed, honestly — nothing is discarded', async () => {
    mockRecoverableTake = { ...BELOW_FLOOR_TAKE, recordingSessionId: null }
    // mockRetryMint's default (set at module scope) already answers null —
    // the recorder never owned this session either.
    await renderPage()
    await waitFor(() => screen.getByText('discardTakeAction'))
    await tapDiscard('discardTakeAction')
    await writeReason()
    await confirmReason()

    expect(mockRetryMint).toHaveBeenCalledTimes(1)
    expect(mockDiscardWithReason).not.toHaveBeenCalled()
    const { deleteTake } = jest.requireMock('@/lib/karute/take-store') as { deleteTake: jest.Mock }
    expect(deleteTake).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('discardReason.failed')
    expect(reasonGate()).not.toBeNull()
  })

  // BLOCKER-2 (line-audit 8/30): the discard gate had no latch against a
  // recovery save racing it. The auto-finish effect can start a save with NO
  // tap at all, and the reason dialog outlives the banner (it renders from
  // the main return, independent of the banner's `{offer && ...}` guard) — so
  // tap the exit, then a save starts and completes while the dialog is still
  // open, then confirm: the take the pipeline just transcribed/saved/deleted
  // would receive a 破棄 receipt it has no business getting (a discard row on
  // a SAVED session outranks the record in the inbox fold — evidence
  // corruption). Fixed with a refusal at the top of confirmDiscardReason,
  // BEFORE any await, keyed on recoverySavingRef.current and a takeId
  // mismatch between the live recoveredTake and the frozen snapshot.
  //
  // Both cases below are REACHABLE (replaces the deleted null-snapshot
  // theatre test — that guard stays, but nothing could exercise it without
  // reaching into a private ref; these two can, and cover the actual race
  // BLOCKER-2 describes).
  describe('BLOCKER-2 — refuses when a recovery save races the open dialog', () => {
    it('recoverySavingRef true (a save is in flight): refuses, no discard call', async () => {
      mockRecoverableTake = BELOW_FLOOR_TAKE
      await renderPage()
      await waitFor(() => screen.getByText('discardTakeAction'))
      // The mount's own auto-finish attempt already stood down (default
      // not-granted consent) by the time renderPage's flush settles — the
      // exit is enabled here, same as every sibling test in this block.
      await tapDiscard('discardTakeAction')
      await writeReason()

      // A save starts WHILE the dialog is open — the field case is the
      // auto-finish effect; holding 保存する's OWN consent read open here
      // reproduces the same state (recoverySavingRef true, dialog still
      // open) deterministically instead of racing a real effect's timing.
      const { getCustomerConsent } = jest.requireMock('@/actions/customers') as {
        getCustomerConsent: jest.Mock
      }
      getCustomerConsent.mockReturnValueOnce(new Promise(() => {}))
      await act(async () => {
        fireEvent.click(screen.getByText('recoverSaveAction'))
        for (let i = 0; i < 4; i++) await Promise.resolve()
      })

      await confirmReason()

      expect(mockDiscardWithReason).not.toHaveBeenCalled()
      const { deleteTake } = jest.requireMock('@/lib/karute/take-store') as {
        deleteTake: jest.Mock
      }
      expect(deleteTake).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('discardReason.takeChanged')
      expect(reasonGate()).not.toBeNull()
    })

    it('the live recoveredTake no longer matches the snapshot: refuses, no discard call', async () => {
      mockRecoverableTake = BELOW_FLOOR_TAKE
      await renderPage()
      await waitFor(() => screen.getByText('discardTakeAction'))
      await tapDiscard('discardTakeAction')
      await writeReason()

      // A save GRANTED consent this time — it runs to completion (tickets
      // off → straight to commitRecoverySave, a valid blob, globalPipeline.
      // start) and its own success cleanup nulls recoveredTake — the exact
      // "the pipeline already has it" half of BLOCKER-2's bad-outcome pair.
      // The discard dialog is still open through all of this.
      const { getCustomerConsent } = jest.requireMock('@/actions/customers') as {
        getCustomerConsent: jest.Mock
      }
      getCustomerConsent.mockResolvedValueOnce({
        consent: {
          policy_version: RECORDING_CONSENT_POLICY_VERSION,
          granted_at: '2026-08-26T00:00:00Z',
        },
      })
      await act(async () => {
        fireEvent.click(screen.getByText('recoverSaveAction'))
        for (let i = 0; i < 14; i++) await Promise.resolve()
      })
      expect(mockPipelineStart).toHaveBeenCalledTimes(1)

      await confirmReason()

      expect(mockDiscardWithReason).not.toHaveBeenCalled()
      const { deleteTake } = jest.requireMock('@/lib/karute/take-store') as {
        deleteTake: jest.Mock
      }
      expect(deleteTake).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('discardReason.takeChanged')
      expect(reasonGate()).not.toBeNull()
    })

    // Greptile P1's OTHER half — the reverse direction: a save must not be
    // able to START while a discard is mid-commit, because that window
    // (the discardRecordingWithReason network call itself) is invisible to
    // BOTH of the checks above. startRecoveryFlow now refuses while
    // discardReasonSubmittingRef.current is true — proven directly against
    // its own entry guard, the same way the two tests above prove the
    // discard side.
    it('a save entry refuses to start while a discard is submitting (reverse direction)', async () => {
      mockRecoverableTake = BELOW_FLOOR_TAKE
      let releaseDiscard: (v: unknown) => void = () => {}
      mockDiscardWithReason.mockImplementationOnce(
        () =>
          new Promise((res) => {
            releaseDiscard = res
          }) as never,
      )
      await renderPage()
      await waitFor(() => screen.getByText('discardTakeAction'))
      await tapDiscard('discardTakeAction')
      await writeReason()
      // Confirm dispatches the discard's own network call and holds there —
      // discardReasonSubmittingRef.current is true for the whole hold.
      await act(async () => {
        fireEvent.click(screen.getByText('discardReason.confirm'))
        for (let i = 0; i < 4; i++) await Promise.resolve()
      })

      // A save entry, attempted while the discard is still submitting. The
      // mount's own auto-finish attempt already read consent once (and
      // stood down) before this — count from here, not from zero.
      const { getCustomerConsent } = jest.requireMock('@/actions/customers') as {
        getCustomerConsent: jest.Mock
      }
      const consentCallsBefore = getCustomerConsent.mock.calls.length
      await act(async () => {
        fireEvent.click(screen.getByText('recoverSaveAction'))
        for (let i = 0; i < 4; i++) await Promise.resolve()
      })
      expect(mockPipelineStart).not.toHaveBeenCalled()
      // The refusal is at startRecoveryFlow's own entry — the save never
      // even reaches its first await (the consent read).
      expect(getCustomerConsent.mock.calls.length).toBe(consentCallsBefore)

      await act(async () => {
        releaseDiscard({ ok: true, receiptId: 'row-1', duplicate: false })
        for (let i = 0; i < 8; i++) await Promise.resolve()
      })
      expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    })
  })

  it('the shared submitting latch guards this origin too — a same-tick double tap files ONE discard', async () => {
    mockRecoverableTake = BELOW_FLOOR_TAKE
    let release: (v: unknown) => void = () => {}
    mockDiscardWithReason.mockImplementationOnce(
      () =>
        new Promise((res) => {
          release = res
        }) as never,
    )
    await renderPage()
    await waitFor(() => screen.getByText('discardTakeAction'))
    await tapDiscard('discardTakeAction')
    await writeReason()

    const confirm = screen.getByText('discardReason.confirm')
    const tap = () => confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await act(async () => {
      tap()
      tap()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
    await act(async () => {
      release({ ok: true, receiptId: 'row-1', duplicate: false })
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
  })
})

// ── 7. A2-2 — the WORDS of a reasoned discard ────────────────────────────
// ⚖ 8/20: a reasoned discard above the accidental-tap floor keeps what was
// said, so a manager reads the transcript beside the claim. The property under
// test here is the same one section 1 tests for the reason row: NOTHING is
// thrown away before the trace exists — and now the audio counts as trace until
// its words have landed.

describe('A2-2 — persisting the words at discard', () => {
  const takeStore = () =>
    jest.requireMock('@/lib/karute/take-store') as { deleteTake: jest.Mock }

  describe('the 破棄 button (recorder origin)', () => {
    it('above the floor: the take is REGISTERED and held back, not deleted', async () => {
      recorderTake.takeId = 'take-1'
      await renderPage()
      await tapDiscard('discard')
      await writeReason()
      await confirmReason()

      expect(mockStampDiscardPending).toHaveBeenCalledTimes(1)
      expect(mockStampDiscardPending.mock.calls[0]).toEqual([
        'take-1',
        expect.objectContaining({
          recordingSessionId: RECORDER_SESSION,
          durationSeconds: 60,
          locale: 'ja',
        }),
      ])
      // No customer id travels with the register: the consent gate reads the
      // session row server-side, so there is nothing here to name the wrong
      // person with — including after a reload, out of the store.
      expect(mockStampDiscardPending.mock.calls[0][1]).not.toHaveProperty('customerId')
      // The audio survives the discard — only the persist run may delete it.
      expect(mockDiscardRecording).toHaveBeenCalledWith({ keepTake: true })
      expect(takeStore().deleteTake).not.toHaveBeenCalled()
      // …and the persist is kicked immediately, not left to the next mount.
      expect(mockRunDiscardTranscript).toHaveBeenCalledTimes(1)
      expect(mockRunDiscardTranscript.mock.calls[0][0]).toBe('take-1')
    })

    it('BELOW the floor: nothing is registered and the take goes, exactly as before', async () => {
      recorderTake.takeId = 'take-1'
      mockDurationMs = 5_000 // an accidental tap — under BELOW_FLOOR_SEC
      await renderPage()
      await tapDiscard('discard')
      await writeReason()
      await confirmReason()

      // ⚖ the spend gate: an accidental tap never reaches a transcription bill.
      expect(mockStampDiscardPending).not.toHaveBeenCalled()
      expect(mockRunDiscardTranscript).not.toHaveBeenCalled()
      expect(mockDiscardRecording).toHaveBeenCalledWith({ keepTake: false })
    })

    it('a world with nowhere to persist (the phone) keeps nothing back', async () => {
      recorderTake.takeId = 'take-1'
      mockDiscardTranscriptSupported = false
      await renderPage()
      await tapDiscard('discard')
      await writeReason()
      await confirmReason()

      expect(mockStampDiscardPending).not.toHaveBeenCalled()
      expect(mockRunDiscardTranscript).not.toHaveBeenCalled()
      expect(mockDiscardRecording).toHaveBeenCalledWith({ keepTake: false })
    })

    it('a register that cannot be written lets the take go rather than orphan it', async () => {
      recorderTake.takeId = 'take-1'
      mockStampDiscardPending.mockImplementationOnce(async () => false)
      await renderPage()
      await tapDiscard('discard')
      await writeReason()
      await confirmReason()

      // Nothing will ever collect this audio, so keeping it back would only
      // leave a discarded take sitting in the store until the TTL.
      expect(mockDiscardRecording).toHaveBeenCalledWith({ keepTake: false })
      expect(mockRunDiscardTranscript).not.toHaveBeenCalled()
    })
  })

  describe('ReviewScreen’s 破棄 (review origin)', () => {
    it('persists the words already in hand BEFORE anything deletes the audio', async () => {
      mockPipelineState = 'review'
      let releasePersist: (v: boolean) => void = () => {}
      mockPersistReviewDiscard.mockImplementationOnce(
        () => new Promise<boolean>((res) => { releasePersist = res }),
      )
      await renderPage()
      await tapDiscard('review-discard')
      await writeReason()
      await confirmReason()

      // Core has accepted the discard, the persist is in flight — and the take
      // is still there. This ordering IS the feature: a delete that beat the
      // persist would destroy the only copy of the words.
      expect(mockDiscardWithReason).toHaveBeenCalledTimes(1)
      expect(takeStore().deleteTake).not.toHaveBeenCalled()
      expect(mockPipelineReset).not.toHaveBeenCalled()
      // …AND THE DIALOG IS STILL UP. Until globalPipeline.reset() runs (inside
      // finishReviewDiscard, after this await) the page is still rendering
      // ReviewScreen, whose 保存 is a second save writer that knows nothing
      // about the discard. The submitting-locked dialog is the only thing
      // fencing it: closing first left 保存 live for the whole round-trip, and a
      // tap there filed a karute against a session that already carries a staff
      // discard row.
      expect(reasonGate()).not.toBeNull()
      // The pipeline's own transcript is what gets handed over — no re-run.
      expect(mockPersistReviewDiscard.mock.calls[0]).toEqual([
        'take-1',
        expect.objectContaining({ recordingSessionId: PIPELINE_SESSION, durationSeconds: 60 }),
        't',
      ])

      await act(async () => {
        releasePersist(true)
        for (let i = 0; i < 8; i++) await Promise.resolve()
      })
      expect(takeStore().deleteTake).toHaveBeenCalledWith('take-1')
      expect(mockPipelineReset).toHaveBeenCalledTimes(1)
      expect(reasonGate()).toBeNull()
      // The words landed, so there is nothing to retry.
      expect(mockRunDiscardTranscript).not.toHaveBeenCalled()
    })

    it('a persist that failed keeps the take for the audio retry — the UI cleanup still runs', async () => {
      mockPipelineState = 'review'
      mockPersistReviewDiscard.mockImplementationOnce(async () => false)
      await renderPage()
      await tapDiscard('review-discard')
      await writeReason()
      await confirmReason()

      // …and the retry is KICKED NOW, not left to the next mount. reset() is a
      // re-render, not a remount, so the mount sweep will not run again in this
      // page life: waiting for a navigation away and back risks the 7-day TTL
      // pruning words that were in hand and free at the moment of failure.
      expect(mockRunDiscardTranscript).toHaveBeenCalledTimes(1)
      expect(mockRunDiscardTranscript.mock.calls[0][0]).toBe('take-1')
      expect(mockRunDiscardTranscript.mock.calls[0][1]).toEqual(
        expect.objectContaining({ recordingSessionId: PIPELINE_SESSION, durationSeconds: 60 }),
      )
      // The words did not land, so the audio they can be recovered from stays.
      expect(takeStore().deleteTake).not.toHaveBeenCalled()
      // Everything else about the discard completed — the take is not offered
      // back (the register excludes it) and the pipeline is idle again.
      const { clearDraft } = jest.requireMock('@/lib/karute/draft') as { clearDraft: jest.Mock }
      expect(clearDraft).toHaveBeenCalledTimes(1)
      expect(mockPipelineReset).toHaveBeenCalledTimes(1)
    })
  })

  // The negative census. These three arms have no words to keep — by
  // definition, not by omission — and must behave exactly as they did before
  // A2-2 existed.
  describe('the arms that keep NOTHING', () => {
    it('pipeline-error (the empty-transcript refusal): nothing registered, take deleted', async () => {
      mockPipelineState = 'error'
      await renderPage()
      await tapDiscard('discardTakeAction')
      await writeReason()
      await confirmReason()

      expect(mockStampDiscardPending).not.toHaveBeenCalled()
      expect(mockPersistReviewDiscard).not.toHaveBeenCalled()
      expect(mockRunDiscardTranscript).not.toHaveBeenCalled()
      expect(takeStore().deleteTake).toHaveBeenCalledWith('take-1')
    })

    it('banner (a below-floor take at the recovery offer): nothing registered, take deleted', async () => {
      mockRecState = 'idle'
      mockRecoverableTake = {
        takeId: 'take-bf',
        target: {
          customerId: 'cust-bf',
          customerName: 'テスト花子',
          karuteNumber: '#00099',
          appointmentId: 'appt-bf',
        },
        recordingSessionId: 'sess-bf',
        mimeType: 'audio/webm',
        startedAt: Date.parse('2026-08-26T05:00:00Z'),
        updatedAt: Date.parse('2026-08-26T05:00:05Z'),
      }
      await renderPage()
      await waitFor(() => screen.getByText('discardTakeAction'))
      await tapDiscard('discardTakeAction')
      await writeReason()
      await confirmReason()

      expect(mockStampDiscardPending).not.toHaveBeenCalled()
      expect(mockPersistReviewDiscard).not.toHaveBeenCalled()
      expect(mockRunDiscardTranscript).not.toHaveBeenCalled()
      expect(takeStore().deleteTake).toHaveBeenCalledWith('take-bf')
    })

    it('a REFUSED discard registers nothing — the words follow the trace, never precede it', async () => {
      recorderTake.takeId = 'take-1'
      mockDiscardWithReason.mockImplementationOnce(
        async () => ({ ok: false, error: 'failed' }) as never,
      )
      await renderPage()
      await tapDiscard('discard')
      await writeReason()
      await confirmReason()

      expect(mockStampDiscardPending).not.toHaveBeenCalled()
      expect(mockRunDiscardTranscript).not.toHaveBeenCalled()
      expect(mockDiscardRecording).not.toHaveBeenCalled()
    })
  })
})

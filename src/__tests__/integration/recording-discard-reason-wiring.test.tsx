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
const mockDiscardWithReason = jest.fn(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the arg is
  // what the wiring assertions read off mock.calls
  async (_input: unknown) => ({ ok: true, receiptId: 'row-1', duplicate: false }) as const,
)
jest.mock('@/actions/recording-discard', () => ({
  discardRecordingWithReason: (input: unknown) => mockDiscardWithReason(input),
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
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
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
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: jest.fn(async () => {}),
  readTakeOutcome: jest.fn(async () => null),
  listOwnTakes: jest.fn(async () => []),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(async () => new Blob(['audio'])),
  // The logout-wipe test runs the REAL wipeSessionVault through this module.
  clearOwnTakes: jest.fn(async () => {}),
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
  },
}))
let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'recorded'
const mockDiscardRecording = jest.fn()
/** The recorder's bounded session-id mint (global-recorder.ts, 1500ms). The
 *  gate awaits it and FAILS CLOSED on null. */
const mockAwaitSession = jest.fn(async (): Promise<string | null> => 'sess-live')
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: mockRecState,
    result: mockRecState === 'recorded' ? { blob: new Blob(['a']), durationMs: 60_000 } : null,
    error: null,
    stream: null,
    startedAt: mockRecState === 'idle' ? null : Date.now(),
    overrun: false,
    autoStopped: false,
    target: null,
    takeId: null,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    discardRecording: (...a: unknown[]) => mockDiscardRecording(...a),
    awaitRecordingSessionId: () => mockAwaitSession(),
  }),
}))

/** The pipeline's own session id — the ReviewScreen chokepoint's source.
 *  Inlined in the factories below for the same hoisting reason. */
const PIPELINE_SESSION = 'sess-reviewed'
let mockPipelineState: 'idle' | 'processing' | 'review' | 'error' = 'idle'
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
      return mockPipelineState === 'review'
        ? { customers: [], duration: 60, recordingSessionId: 'sess-reviewed', takeId: 'take-1' }
        : null
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
    error: mockPipelineState === 'error' ? 'unknown' : null,
    result:
      mockPipelineState === 'review' ? { transcript: 't', entries: [], summary: 's' } : null,
    context:
      mockPipelineState === 'review'
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

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  RecordPageView,
  type RecordPageViewProps,
} from '@/components/karute/redesign/record/RecordPageView'
import { resetInbox } from '@/lib/recordings/inbox-store'

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
  mockPipelineState = 'idle'
  mockAwaitSession.mockImplementation(async () => RECORDER_SESSION)
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
  it('no session id (the mint never landed) → nothing is discarded, the gate stays open', async () => {
    mockAwaitSession.mockImplementation(async () => null)
    await renderPage()
    await tapDiscard('discard')
    await writeReason()
    await confirmReason()

    // Never even attempted — there is nowhere to key the reason row (G14).
    expect(mockDiscardWithReason).not.toHaveBeenCalled()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
    expect(mockDeleteRecordingSession).not.toHaveBeenCalled()
    // The staff member is told, keeps their text, and can try again.
    expect(screen.getByRole('alert')).toHaveTextContent('discardReason.failed')
    expect(screen.getByRole('textbox')).toHaveValue(REASON)
    expect(reasonGate()).not.toBeNull()
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

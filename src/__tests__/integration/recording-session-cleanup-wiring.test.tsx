/**
 * @jest-environment jsdom
 *
 * Where the discard cleanup IS wired — and, just as load-bearing, where it is
 * NOT (Build F1 fix round 3).
 *
 * The cleanup destroys a server row, so wiring it one call site too wide is a
 * data-loss bug, not a cosmetic one. Every NOT-wired case below is a path
 * where the take survives or the record exists, and removing the session row
 * there would either erase a still-honest 処理中 row or orphan a saved karute
 * from the session it came from.
 *
 * WHY TWO OF THE FIVE NOT-WIRED PATHS HAVE NO TEST HERE (the TTL prune and the
 * recovery banner): they are proven by CENSUS, not by exercise. The cleanup is
 * reachable through exactly one funnel — `deleteRecordingSession` has ONE app
 * call site (RecordPageView's `cleanUpDiscardedSession`), and that helper has
 * exactly TWO call sites repo-wide, both asserted below. Nothing else in src
 * or thin can reach it, so a path that never calls the funnel cannot be made
 * to call it by a test; the two assertions here that DO exercise a not-wired
 * path (the error card, settle-on-save) earn their place because they run
 * through the same component and could plausibly regress into it. If the
 * funnel ever gains a third call site, that census breaks and these two need
 * real tests.
 */
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))

const mockDeleteRecordingSession = jest.fn(
  async (_id: string): Promise<{ ok: true } | { error: string }> => ({ ok: true }),
)
jest.mock('@/actions/recordings', () => ({
  startRecordingSession: jest.fn(),
  deleteRecordingSession: (id: string) => mockDeleteRecordingSession(id),
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
    // P5-A: the reason gate bounded-awaits the mint before it will discard
    // anything, so this must answer with the live session id.
    awaitRecordingSessionId: jest.fn(async () => 'sess-live'),
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
})

/** P5-A: a deliberate discard is now two taps — 破棄, then the required
 *  written reason. `next-intl` is key-echoing in this suite, so the confirm
 *  button's label is its key. */
async function discardThroughReasonGate(trigger: string) {
  await act(async () => {
    fireEvent.click(screen.getByText(trigger))
  })
  await act(async () => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '録り直します' } })
  })
  await act(async () => {
    fireEvent.click(screen.getByText('discardReason.confirm'))
  })
}

afterEach(() => {
  cleanup()
  resetInbox()
})

describe('WIRED — the deliberate discard chokepoints', () => {
  it('the 破棄 button cleans up the RECORDER’s session id', async () => {
    await renderPage()
    await discardThroughReasonGate('discard')
    expect(mockDeleteRecordingSession).toHaveBeenCalledTimes(1)
    expect(mockDeleteRecordingSession).toHaveBeenCalledWith(RECORDER_SESSION)
    // …and the take is still discarded: the cleanup rides along, never gates.
    expect(mockDiscardRecording).toHaveBeenCalled()
  })

  it('the id is read BEFORE discardRecording() nulls it on the singleton', async () => {
    // Ordering is the whole bug class here — a cleanup fired after the reset
    // would silently receive null and quietly do nothing.
    const order: string[] = []
    mockDeleteRecordingSession.mockImplementation(async () => {
      order.push('cleanup')
      return { ok: true }
    })
    mockDiscardRecording.mockImplementation(() => order.push('discard'))
    await renderPage()
    await discardThroughReasonGate('discard')
    expect(order).toEqual(['cleanup', 'discard'])
  })

  it('ReviewScreen’s 破棄 cleans up the PIPELINE’s session id', async () => {
    mockPipelineState = 'review'
    await renderPage()
    await discardThroughReasonGate('review-discard')
    expect(mockDeleteRecordingSession).toHaveBeenCalledTimes(1)
    expect(mockDeleteRecordingSession).toHaveBeenCalledWith(PIPELINE_SESSION)
  })

  it('a failed cleanup never blocks or breaks the discard', async () => {
    mockDeleteRecordingSession.mockRejectedValue(new Error('core down'))
    await renderPage()
    await discardThroughReasonGate('discard')
    expect(mockDiscardRecording).toHaveBeenCalled()
  })
})

describe('NOT WIRED — paths where the row must survive', () => {
  it('the error card’s キャンセル does NOT clean up (the take is KEPT)', async () => {
    mockPipelineState = 'error'
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('cancel'))
    })
    expect(mockDeleteRecordingSession).not.toHaveBeenCalled()
  })

  it('settle-on-save does NOT clean up (the record needs its session)', async () => {
    mockPipelineState = 'review'
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('review-saved'))
    })
    expect(mockDeleteRecordingSession).not.toHaveBeenCalled()
  })

  it('the logout wipe does NOT clean up (a phone job can still land)', async () => {
    const { wipeSessionVault } = await import('@/lib/karute/logout-wipe')
    await wipeSessionVault()
    expect(mockDeleteRecordingSession).not.toHaveBeenCalled()
  })
})

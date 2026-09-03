/**
 * @jest-environment jsdom
 *
 * The discard cleanup is NOT wired ANYWHERE any more (packet item A2-1) — and
 * that is now the property this file exists to hold.
 *
 * HISTORY, because the inversion matters. Build F1 added a cleanup that
 * hard-deleted the recording_sessions row on a deliberate 破棄, so the orphan
 * row would stop showing up in 録音履歴 as an unclearable 失敗. P5-A then made
 * the staff member WRITE why they discarded, and that written reason lands in
 * core's discard ledger keyed on `recording_session_id` — the exact row the
 * cleanup deleted moments later, fire-and-forget, with no app-side signal. The
 * cleanup would have voided the flagship deliverable ~200 ms after it landed.
 *
 * So the session row SURVIVES a reasoned discard, and A2-3 renders it honestly
 * (a grayed 破棄済み row off the same ledger) instead of destroying it. The
 * orphan problem is solved by naming the row correctly, not by deleting it.
 *
 * The census argument is unchanged in shape and stronger in result:
 * `deleteRecordingSession` now has ZERO call sites in RecordPageView, so no
 * path through this component can reach it. Every case below asserts that, at
 * the paths that used to be wired and at the paths that never were.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: jest.fn(async () => {}),
  readTakeOutcome: jest.fn(async () => null),
  listOwnTakes: jest.fn(async () => []),
  listOwnStoppedUnsecuredTakeIds: jest.fn(async () => []),
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

// The recorder singleton's live session id is inlined in the factory below
// (jest hoists jest.mock above every const). A2-1 removed the assertions that
// referenced it by name — nothing compares against these ids any more, because
// the cleanup they were passed to is no longer called at all.
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

// The pipeline's own session id is likewise inlined in the factories below.
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

describe('A2-1 — a reasoned discard KEEPS its session row', () => {
  it('the 破棄 button does NOT clean up: the reason row keys on that session id', async () => {
    await renderPage()
    await discardThroughReasonGate('discard')

    expect(mockDeleteRecordingSession).not.toHaveBeenCalled()
    // …and the take is still discarded. Keeping the row is not a half-discard:
    // the audio goes, the explanation stays.
    expect(mockDiscardRecording).toHaveBeenCalled()
  })

  it('ReviewScreen’s 破棄 does NOT clean up either — same reason, same rule', async () => {
    mockPipelineState = 'review'
    await renderPage()
    await discardThroughReasonGate('review-discard')

    expect(mockDeleteRecordingSession).not.toHaveBeenCalled()
  })

  // The census, asserted rather than asserted-about. The two cases above prove
  // the two paths a test can drive; this proves there is no THIRD path, by
  // reading the source the way the receipt suite pins its 'use server' export
  // set. A future edit that reintroduces the call anywhere in the component
  // goes red here even if no test happens to drive that path.
  it('RecordPageView does not import or call the cleanup anywhere', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/karute/redesign/record/RecordPageView.tsx'),
      'utf8',
    )

    // Matched as CODE shapes, not bare substrings: the file's own comment
    // explains why the cleanup left and names the server module it still lives
    // in, and a prose mention must not fail this.
    expect(source).not.toMatch(/import[\s\S]*?deleteRecordingSession[\s\S]*?from '@\/actions\/recordings'/)
    expect(source).not.toMatch(/\bdeleteRecordingSession\s*\(/)
    expect(source).not.toMatch(/\bcleanUpDiscardedSession\b/)
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

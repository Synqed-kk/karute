/**
 * @jest-environment jsdom
 *
 * RecordPageView with NO recording target — the screen the 8/19 ruling
 * created. buildRecordScreen no longer auto-picks a colleague's booking, so
 * `nextAppointment` is genuinely null for a staffer with nothing of their own
 * today, and this page is what they get.
 *
 * The blind round (A-4) found the whole state pinned only at the leaf: the
 * `showNoTargetActions` gate, the handler wiring, the hidden recorder column
 * and the day picker had ZERO coverage through the real component tree — an
 * inverted gate kept 125 tests green. These pin it end to end:
 *
 *   1. idle + null target → the two-action card, wired, recorder column gone,
 *      no salon-wide day picker, and exactly ONE empty-state card (A-3).
 *   2. anonymous take in flight → the unbound placeholder, still no picker
 *      (A-1: the picker's sheet is the whole salon's day, one tap away from
 *      the card's own 選択せずに録音する).
 *   3. pipeline busy + recorder idle → still the card (A-1: the gate reads
 *      recState, not the composite `live` — a take still transcribing in the
 *      background is a normal window to line up the next customer).
 *   4. お客様を選んで録音 opens the customer dialog.
 *
 * Mock idiom copied from record-page-view-target-mismatch.test.tsx (same
 * transitive server-module wall); next-intl is key-echoed there too, so
 * assertions read as translation keys. The real-ja.json call-site check lives
 * in record-no-own-booking-card.test.tsx.
 */
import { render, screen, fireEvent } from '@testing-library/react'

let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'idle'
let mockPipelineState: 'idle' | 'transcribing' | 'review' = 'idle'
let mockTarget: {
  customerId: string
  customerName: string
  karuteNumber: string | null
  appointmentId: string | null
} | null = null
const mockStartRecording = jest.fn()

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: mockRecState,
    result: null,
    error: null,
    stream: null,
    startedAt: mockRecState === 'idle' ? null : Date.now(),
    overrun: false,
    autoStopped: false,
    target: mockTarget,
    takeId: null,
    recordingSessionId: null,
    startRecording: mockStartRecording,
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    discardRecording: jest.fn(),
    awaitRecordingSessionId: jest.fn(async () => null),
  }),
}))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/packs', () => ({
  createPackAction: jest.fn(),
  redeemSessionAction: jest.fn(),
  undoRedemptionAction: jest.fn(),
}))
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: { start: jest.fn(), retry: jest.fn(), reset: jest.fn(), state: 'idle' },
}))
jest.mock('@/hooks/use-global-pipeline', () => ({
  useGlobalPipeline: () => ({
    state: mockPipelineState,
    error: null,
    start: jest.fn(),
    retry: jest.fn(),
    reset: jest.fn(),
  }),
}))
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  return new Proxy({}, { get: () => passthrough })
})
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
}))

import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'

// The no-target screen as the server actually builds it: every
// nextAppointment-derived field short-circuits to null/empty (pinned
// server-side in record-own-customer-only.test.ts t2).
const noTargetProps = {
  customers: [
    { id: 'c-1', name: '原 奏恵', furigana: null, phone: null },
    { id: 'c-2', name: '佐藤 美咲', furigana: null, phone: null },
  ],
  locale: 'ja',
  nextAppointment: null,
  // A colleague's booking IS in the picker rows — the server still ships the
  // whole day for the explicit picker. That is exactly why no null-target
  // state may render the picker.
  nearbyBookings: [
    {
      id: 'a-theirs',
      start: '10:30',
      end: '12:00',
      customer: '佐藤 美咲',
      initials: '佐藤',
      karute: 'K-0142',
      service: 'カット',
      staff: '佐藤',
      staffId: 's-other',
      staffColorKey: null,
      statusKey: 'booked' as const,
      statusLabel: '予約済',
    },
  ],
  brief: null,
  aiBriefPromise: Promise.resolve(null),
  recentRecordings: [],
  consentDate: null,
  visitSegment: null,
  visitRhythm: null,
  targetHasTicketPack: false,
  targetPack: null,
  currentStaffName: '原',
  ticketsEnabled: true,
}

beforeEach(() => {
  mockRecState = 'idle'
  mockPipelineState = 'idle'
  mockTarget = null
  jest.clearAllMocks()
})

describe('RecordPageView — no own booking today (8/19 ruling)', () => {
  it('idle + null target: the two-action card, wired, no picker, no recorder column', () => {
    const { container } = render(<RecordPageView {...noTargetProps} />)

    // The card itself.
    expect(screen.getByText('noOwnBooking')).toBeInTheDocument()

    // Wiring — both actions reach their handlers. 選択せずに録音する starts an
    // UNBOUND take (the pre-existing walk-in flow, trigger moved onto the card).
    fireEvent.click(screen.getByText('recordWithoutCustomer'))
    expect(mockStartRecording).toHaveBeenCalledTimes(1)
    expect(mockStartRecording.mock.calls[0][0]).toMatchObject({ target: null })

    // The big record button steps aside (mock A2) — no second, competing
    // way to start a take on this screen.
    expect(screen.queryByLabelText('startAria')).not.toBeInTheDocument()

    // The salon-wide day picker is nowhere: not its trigger, not its rows.
    expect(screen.queryByText('choose')).not.toBeInTheDocument()
    expect(screen.queryByText('佐藤 美咲')).not.toBeInTheDocument()

    // A-3: exactly ONE empty-state card — the brief's own noTarget explainer
    // used to stack below this one. aria-busy proves the whole Suspense
    // boundary is gone, not merely that the content hasn't streamed.
    expect(screen.queryByText('noTarget')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-busy]')).not.toBeInTheDocument()
  })

  it('お客様を選んで録音 opens the customer dialog', () => {
    render(<RecordPageView {...noTargetProps} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('chooseCustomer'))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-label', 'target.chooseCustomer')
    // No take is started by merely opening the picker.
    expect(mockStartRecording).not.toHaveBeenCalled()
  })

  it('anonymous take in flight: unbound placeholder, still no picker', () => {
    mockRecState = 'recording' // 選択せずに録音する take, bound to nobody
    render(<RecordPageView {...noTargetProps} />)

    expect(screen.getByText('unboundHint')).toBeInTheDocument()
    // The two actions are gone (a take is already running)…
    expect(screen.queryByText('noOwnBooking')).not.toBeInTheDocument()
    // …and so is every route back to the colleague's booking.
    expect(screen.queryByText('choose')).not.toBeInTheDocument()
    expect(screen.queryByText('佐藤 美咲')).not.toBeInTheDocument()
    // The recorder controls stay: stopping the take must never be hidden.
    expect(screen.getByLabelText('stopAria')).toBeInTheDocument()
  })

  it('pipeline still crunching the LAST take, recorder idle: the card stays', () => {
    mockPipelineState = 'transcribing'
    render(<RecordPageView {...noTargetProps} />)

    expect(screen.getByText('noOwnBooking')).toBeInTheDocument()
    expect(screen.queryByText('choose')).not.toBeInTheDocument()
    expect(screen.queryByText('佐藤 美咲')).not.toBeInTheDocument()
  })
})

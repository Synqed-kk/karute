/**
 * @jest-environment jsdom
 *
 * RecordPageView × the live recorder target (field bug 8/2, 0:17 iPhone
 * prod): start recording customer A via the customer-page mic button →
 * navigate away → return via the center tab. 録音対象 stayed correct, but
 * the schedule-derived sections (other-staff banner, repurchase cue, visit
 * rhythm, closing tactic, セッション前ブリーフィング) kept rendering whatever
 * `nextAppointment` had drifted to (customer B) — two customers' data on one
 * screen mid-recording. `scheduleMismatch` in RecordPageView.tsx is the
 * belt-and-suspenders fix: those sections must not paint when the bound
 * `target` and `nextAppointment` disagree on customerId.
 *
 * Mock idiom copied from thin-record-screen-brief-cache.test.tsx (the only
 * other suite that mounts RecordPageView's real module tree) — same
 * transitive server-module wall (global-recorder.ts → @/actions/recordings;
 * ReviewScreen → @/actions/karute), plus a controllable
 * @/hooks/use-global-recorder mock (this suite's own addition) so a test can
 * bind `target` to a specific customer.
 */
import { render, screen } from '@testing-library/react'

let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'idle'
let mockTarget: {
  customerId: string
  customerName: string
  karuteNumber: string | null
  appointmentId: string | null
} | null = null

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
    startRecording: jest.fn(),
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
jest.mock('@synqed-kk/ui', () => {
  // jest.mock factories run before the module's own ES imports are wired up
  // — requiring react here (rather than importing) is the standard idiom
  // (thin-record-screen-brief-cache.test.tsx).
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

import {
  RecordPageView,
  type RecordPageNextAppointment,
} from '@/components/karute/redesign/record/RecordPageView'

function nextAppointmentFor(
  customerId: string,
  customerName: string,
): RecordPageNextAppointment {
  return {
    id: `apt-${customerId}`,
    customerName,
    customerId,
    karuteNumber: null,
    startTime: '2026-08-02T02:00:00.000Z',
    durationMinutes: 60,
    title: null,
    notes: null,
    statusKey: 'booked',
    staffName: '田中',
    bookedUnderOtherStaff: true,
  }
}

// Props that put ALL FIVE schedule-derived sections in play at once —
// otherStaffBanner, RepurchaseCueBanner, VisitRhythmPanel, ClosingTacticHint,
// and the StreamingBriefCard brief (via a verbatim `opener`, rendered as-is
// with no t()-interpolation to strip it — see PreSessionBriefCard.tsx).
const baseProps = {
  customers: [],
  locale: 'ja',
  nearbyBookings: [],
  brief: {
    isFirstTimeVisit: false,
    lastVisitDate: '',
    lastVisitAgo: '',
    hooks: [],
    concerns: [],
    lastProduct: null,
    recommendedFocus: null,
    reservationMemo: null,
    opener: 'BRIEF-OPENER-MARKER',
  },
  aiBriefPromise: Promise.resolve(null),
  recentRecordings: [],
  consentDate: null,
  visitSegment: 'jouren' as const,
  visitRhythm: { daysSince: 10, avgIntervalDays: 7, ratio: 1.4, state: 'slightly-over' as const },
  targetHasTicketPack: true,
  targetPack: { id: 'pack-1', remaining: 1, size: 5 },
  currentStaffName: '田中',
  ticketsEnabled: true,
}

beforeEach(() => {
  mockRecState = 'idle'
  mockTarget = null
})

describe('RecordPageView — schedule mismatch guard (field bug 8/2)', () => {
  it('hides nextAppointment-bound sections when the live target is a DIFFERENT customer', async () => {
    mockRecState = 'recording'
    mockTarget = {
      customerId: 'cust-A',
      customerName: 'リエム代表',
      karuteNumber: null,
      appointmentId: 'apt-A',
    }
    const { container } = render(
      <RecordPageView {...baseProps} nextAppointment={nextAppointmentFor('cust-B', '富山彩夏')} />,
    )

    // RecordingTargetCard STAYS target-aware — the bound customer keeps
    // showing (this guard must not blank the whole page).
    expect(screen.getByText('リエム代表')).toBeInTheDocument()

    // Every customer-B (nextAppointment)-derived section must be gone.
    expect(screen.queryByText('otherStaffBooking')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument() // RepurchaseCueBanner
    expect(screen.queryByText('jouren_pack')).not.toBeInTheDocument() // ClosingTacticHint
    expect(
      container.querySelector('.overflow-hidden.rounded-2xl.border.border-border'),
    ).not.toBeInTheDocument() // VisitRhythmPanel wrapper
    // Give the Suspense-wrapped brief every chance to have painted before
    // asserting its absence — the guard removes the whole block, so there's
    // nothing to await.
    await Promise.resolve()
    expect(screen.queryByText('BRIEF-OPENER-MARKER')).not.toBeInTheDocument()
  })

  it('renders them normally when target and nextAppointment agree on the same customer', async () => {
    mockRecState = 'recording'
    mockTarget = {
      customerId: 'cust-A',
      customerName: 'リエム代表',
      karuteNumber: null,
      appointmentId: 'apt-A',
    }
    const { container } = render(
      <RecordPageView {...baseProps} nextAppointment={nextAppointmentFor('cust-A', 'リエム代表')} />,
    )

    expect(screen.getByText('otherStaffBooking')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('jouren_pack')).toBeInTheDocument()
    expect(
      container.querySelector('.overflow-hidden.rounded-2xl.border.border-border'),
    ).toBeInTheDocument()
    await screen.findByText('BRIEF-OPENER-MARKER')
  })
})

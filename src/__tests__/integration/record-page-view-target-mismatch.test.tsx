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
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'idle'
let mockResult: { blob: Blob; mimeType: string; durationMs: number } | null = null
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
    result: mockResult,
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
// P5-A: RecordPageView imports the written-reason discard action; unmocked it
// pulls the ESM SDK into this suite. Not exercised here.
jest.mock('@/actions/recording-discard', () => ({ discardRecordingWithReason: jest.fn() }))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/recording-discards', () => ({
  myDiscardCountThisMonth: jest.fn(async () => null),
  listDiscardReasons: jest.fn(async () => ({ ok: false, error: 'forbidden' })),
}))
jest.mock('@/actions/packs', () => ({
  createPackAction: jest.fn(),
  redeemSessionAction: jest.fn(),
  undoRedemptionAction: jest.fn(),
}))
// Pipeline mocked so the stop-flow render test can assert what the save hands
// off (and that no real pipeline work runs in jsdom).
const mockPipelineStart = jest.fn()
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    start: (...args: unknown[]) => mockPipelineStart(...args),
    retry: jest.fn(),
    reset: jest.fn(),
    state: 'idle',
    // The 録音履歴 store arms a settle watch on it (Build F1).
    subscribe: jest.fn(() => () => {}),
  },
}))
jest.mock('@/hooks/use-global-pipeline', () => ({
  useGlobalPipeline: () => ({
    state: 'idle',
    error: null,
    start: (...args: unknown[]) => mockPipelineStart(...args),
    retry: jest.fn(),
    reset: jest.fn(),
  }),
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
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  listOwnUnsecuredTakeIds: jest.fn(async () => []),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
}))

import {
  RecordPageView,
  resolveReturningForOutcome,
  resolveSaveBinding,
  resolveStopFlow,
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
  // Marker content so the blind-round P2 gates (recent recordings +
  // consent pill are nextAppointment-derived too) assert on real output.
  recentRecordings: [
    {
      id: 'rec-1',
      customerName: 'RECENT-MARKER',
      initials: 'RM',
      karuteNumber: null,
      service: 'カット',
      date: '2026-08-01',
      startTime: '10:00',
      durationLabel: '45分',
      karuteLinked: false,
      entryCount: 1,
      karuteId: null,
    },
  ],
  consentDate: '2026-06-21',
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
  mockResult = null
  jest.clearAllMocks()
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
    // The recorder controls themselves must survive the guard — hiding the
    // stop button mid-recording would be worse than the leak (armor lens #2).
    expect(screen.getByLabelText('stopAria')).toBeInTheDocument()

    // Every customer-B (nextAppointment)-derived section must be gone.
    expect(screen.queryByText('otherStaffBooking')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument() // RepurchaseCueBanner
    expect(screen.queryByText('jouren_pack')).not.toBeInTheDocument() // ClosingTacticHint
    expect(
      container.querySelector('.overflow-hidden.rounded-2xl.border.border-border'),
    ).not.toBeInTheDocument() // VisitRhythmPanel wrapper
    expect(screen.queryByText('RECENT-MARKER')).not.toBeInTheDocument() // RecentRecordingsCard
    expect(screen.queryByText('onFile')).not.toBeInTheDocument() // ConsentPill
    // The brief must be gone AS A BLOCK: asserting only the resolved text is
    // vacuous inside one microtask (armor lens #1 — the mutation survived);
    // the Suspense fallback carries aria-busy, so its absence proves the
    // guard removed the whole boundary rather than the content just not
    // having streamed yet.
    expect(container.querySelector('[aria-busy]')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('BRIEF-OPENER-MARKER')).not.toBeInTheDocument(),
    )
  })

  it('treats an anonymous record-anyway take the same way (target null, recorder live)', () => {
    mockRecState = 'recording'
    mockTarget = null // record-anyway: recording is live but bound to nobody
    const { container } = render(
      <RecordPageView {...baseProps} nextAppointment={nextAppointmentFor('cust-B', '富山彩夏')} />,
    )

    // The schedule's customer must not be claimed as the recording target…
    expect(screen.queryByText('富山彩夏')).not.toBeInTheDocument()
    // …their schedule-derived sections must not paint…
    expect(screen.queryByText('otherStaffBooking')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('jouren_pack')).not.toBeInTheDocument()
    expect(screen.queryByText('RECENT-MARKER')).not.toBeInTheDocument()
    expect(screen.queryByText('onFile')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-busy]')).not.toBeInTheDocument()
    // …and the recorder controls stay usable.
    expect(screen.getByLabelText('stopAria')).toBeInTheDocument()
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
    expect(screen.getByText('RECENT-MARKER')).toBeInTheDocument()
    expect(screen.getByText('onFile')).toBeInTheDocument()
    await screen.findByText('BRIEF-OPENER-MARKER')
  })
})

describe('resolveSaveBinding — the take binds only to what it was recorded against', () => {
  it('bound target with a booking: both ids from the target', () => {
    expect(
      resolveSaveBinding({ customerId: 'cust-A', appointmentId: 'apt-A' }, null, null),
    ).toEqual({ appointmentId: 'apt-A', customerId: 'cust-A' })
  })

  it('bound walk-in (appointmentId null): customer from target, NO appointment — never the schedule\'s', () => {
    expect(
      resolveSaveBinding({ customerId: 'cust-A', appointmentId: null }, null, null),
    ).toEqual({ appointmentId: undefined, customerId: 'cust-A' })
  })

  it('予約-launched flow (timetable store ids, no target)', () => {
    expect(resolveSaveBinding(null, 'apt-T', 'cust-T')).toEqual({
      appointmentId: 'apt-T',
      customerId: 'cust-T',
    })
  })

  it('anonymous record-anyway take: binds NOTHING (save requires picking downstream)', () => {
    expect(resolveSaveBinding(null, null, null)).toEqual({
      appointmentId: undefined,
      customerId: undefined,
    })
  })

  it('empty-string walk-in appointment id coerces to undefined, not ""', () => {
    expect(
      resolveSaveBinding({ customerId: 'cust-A', appointmentId: '' }, null, null),
    ).toEqual({ appointmentId: undefined, customerId: 'cust-A' })
  })
})

describe('stop flow under mismatch — end-to-end render pin (delta-verify catch 8/2)', () => {
  it('anonymous recorded take + schedule drift to a 残1 customer: 録音を使用 saves unbound and burns NOTHING', async () => {
    mockRecState = 'recorded'
    mockResult = { blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 5000 }
    mockTarget = null // anonymous record-anyway take
    render(
      <RecordPageView
        {...baseProps}
        ticketsEnabled
        // 残1 pack → outcomeMode 'auto' — the exact wrong-burn scenario.
        targetPack={{ id: 'pack-B', remaining: 1, size: 6 }}
        nextAppointment={nextAppointmentFor('cust-B', '富山彩夏')}
      />,
    )

    fireEvent.click(screen.getByText('useRecording'))

    await waitFor(() => expect(mockPipelineStart).toHaveBeenCalledTimes(1))
    // The take hands off UNBOUND — never customer B's ids.
    expect(mockPipelineStart.mock.calls[0][1]).toMatchObject({
      appointmentCustomerId: undefined,
      appointmentId: undefined,
    })
    // And customer B's pack was NOT burned.
    const { redeemSessionAction } = jest.requireMock('@/actions/packs')
    expect(redeemSessionAction).not.toHaveBeenCalled()
  })
})

describe('resolveStopFlow — ticket economics only run against the session\'s own customer', () => {
  it('tickets off → straight save regardless of mode', () => {
    expect(
      resolveStopFlow({ ticketsEnabled: false, canRunOutcome: true, outcomeMode: 'auto' }),
    ).toBe('save-direct')
  })

  it('schedule mismatch / anonymous take (canRunOutcome false) → straight save, NEVER auto-burn', () => {
    expect(
      resolveStopFlow({ ticketsEnabled: true, canRunOutcome: false, outcomeMode: 'auto' }),
    ).toBe('save-direct')
    expect(
      resolveStopFlow({ ticketsEnabled: true, canRunOutcome: false, outcomeMode: 'conversion' }),
    ).toBe('save-direct')
  })

  it('bound + matching schedule: auto mode burns, other modes open the dialog', () => {
    expect(
      resolveStopFlow({ ticketsEnabled: true, canRunOutcome: true, outcomeMode: 'auto' }),
    ).toBe('auto-redeem')
    expect(
      resolveStopFlow({ ticketsEnabled: true, canRunOutcome: true, outcomeMode: 'conversion' }),
    ).toBe('dialog')
    expect(
      resolveStopFlow({ ticketsEnabled: true, canRunOutcome: true, outcomeMode: 'repurchase' }),
    ).toBe('dialog')
  })
})

describe('resolveReturningForOutcome — the 既存のお客様 gate signal (L2#4)', () => {
  it('returning customer → true (the only value that opens the card)', () => {
    expect(resolveReturningForOutcome({ isFirstTimeVisit: false })).toBe(true)
  })

  it('first-time visit → false', () => {
    expect(resolveReturningForOutcome({ isFirstTimeVisit: true })).toBe(false)
  })

  it('no brief / field absent → null (UNKNOWN, never speculative)', () => {
    expect(resolveReturningForOutcome(null)).toBeNull()
    expect(resolveReturningForOutcome(undefined)).toBeNull()
    expect(resolveReturningForOutcome({})).toBeNull()
  })
})

// Light wiring pin (no new harness — reuses this suite's RecordPageView mount):
// the dialog call site must feed resolveReturningForOutcome(brief), NOT the
// `?? false` isFirstVisit prop. next-intl is key-echoed here, so the 4th card
// surfaces as its translation key.
describe('RecordPageView → dialog wiring — the revisit gate reads the brief', () => {
  const openDialogWith = (brief: (typeof baseProps)['brief'] | null) => {
    mockRecState = 'recorded'
    mockResult = { blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 5000 }
    mockTarget = {
      customerId: 'cust-A',
      customerName: 'リエム代表',
      karuteNumber: null,
      appointmentId: 'apt-A',
    }
    render(
      <RecordPageView
        {...baseProps}
        brief={brief}
        // No pack → resolveOutcomeMode 'conversion', so the dialog (not the
        // auto-burn) is the stop flow.
        targetPack={null}
        nextAppointment={nextAppointmentFor('cust-A', 'リエム代表')}
      />,
    )
    fireEvent.click(screen.getByText('useRecording'))
  }

  it('returning customer brief → the 4th card is offered', () => {
    openDialogWith({ ...baseProps.brief, isFirstTimeVisit: false })
    expect(screen.getByText('revisit.title')).toBeInTheDocument()
  })

  it('first-visit brief → not offered', () => {
    openDialogWith({ ...baseProps.brief, isFirstTimeVisit: true })
    expect(screen.queryByText('revisit.title')).toBeNull()
  })

  it('NO brief (UNKNOWN) → not offered, even though isFirstVisit falls back to false', () => {
    openDialogWith(null)
    // The `?? false` isFirstVisit prop reads this same null brief as
    // "returning" — the gate must NOT, which is the whole L2#4 fix.
    expect(screen.queryByText('revisit.title')).toBeNull()
  })
})

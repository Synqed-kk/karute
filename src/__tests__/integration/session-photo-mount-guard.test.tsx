/**
 * @jest-environment jsdom
 *
 * SessionPhotoCard mount guard (blind-round HIGH 8/2): the card may mount
 * ONLY for a session BOUND to a customer — never off boundCustomerId's
 * nextAppointment fallback (an anonymous record-anyway take would upload
 * photos to whoever the schedule resolves), and never while idle.
 *
 * Module walls mirror thin-record-screen-brief-cache.test.tsx (the
 * documented mock set for mounting RecordPageView under jsdom).
 */
import { render } from '@testing-library/react'

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
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
// P5-A: RecordPageView imports the written-reason discard action; unmocked it
// pulls the ESM SDK into this suite. Not exercised here.
jest.mock('@/actions/recording-discard', () => ({ discardRecordingWithReason: jest.fn() }))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
  uploadCustomerPhoto: jest.fn(async () => ({ photo: { id: 'p1' } })),
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
jest.mock('sonner', () => ({
  toast: { warning: jest.fn(), success: jest.fn(), error: jest.fn(), info: jest.fn() },
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
  listOwnUnsecuredTakeIds: jest.fn(async () => []),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
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
    discardRecording: jest.fn(),
    awaitRecordingSessionId: jest.fn(async () => null),
  }),
}))

import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'

const nextAppointment = {
  id: 'apt-B',
  customerName: '富山彩夏',
  customerId: 'cust-B',
  karuteNumber: null,
  startTime: '2026-08-02T01:00:00.000Z',
  durationMinutes: 60,
  title: null,
  notes: null,
  statusKey: 'booked' as const,
  staffName: '田中',
}

const baseProps = {
  customers: [],
  locale: 'ja',
  nearbyBookings: [],
  brief: null,
  aiBriefPromise: Promise.resolve(null),
  recentRecordings: [],
  consentDate: null,
}

beforeEach(() => {
  mockRecState = 'idle'
  mockTarget = null
})

// The card's hidden camera input is unique to it on the whole page — the
// i18n echo mock strips namespaces, so text keys ('title') would collide.
const cardInput = (c: HTMLElement) => c.querySelector('input[capture="environment"]')

describe('SessionPhotoCard mount guard', () => {
  it('mounts for a BOUND live session', () => {
    mockRecState = 'recording'
    mockTarget = {
      customerId: 'cust-A',
      customerName: 'リエム代表',
      karuteNumber: null,
      appointmentId: null,
    }
    const { container } = render(
      <RecordPageView {...baseProps} nextAppointment={nextAppointment} />,
    )
    expect(cardInput(container)).not.toBeNull()
  })

  it('does NOT mount for an anonymous take even with a schedule fallback available', () => {
    mockRecState = 'recording'
    mockTarget = null // record-anyway: boundCustomerId would fall to cust-B
    const { container } = render(
      <RecordPageView {...baseProps} nextAppointment={nextAppointment} />,
    )
    expect(cardInput(container)).toBeNull()
  })

  it('does NOT mount while idle', () => {
    mockRecState = 'idle'
    const { container } = render(
      <RecordPageView {...baseProps} nextAppointment={nextAppointment} />,
    )
    expect(cardInput(container)).toBeNull()
  })
})

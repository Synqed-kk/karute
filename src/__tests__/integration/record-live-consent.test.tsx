/**
 * @jest-environment jsdom
 *
 * RecordPageView → SessionPhotoCard.takenWithConsent (packet 2026-08-09 PR
 * 9b blind-round §4/§5).
 *
 * §4: takenWithConsent must read the LIVE consent state (consentGranted,
 * refreshed by refreshConsent — getCustomerConsent + isConsentCurrent), NOT
 * the SSR consentDate prop (fetched once at page load, never updates).
 * Ambiguity resolved: the ConsentCheckCard that lets staff GRANT consent
 * only renders while `phase === 'idle'` (recording is blocked until
 * granted), so there is no in-page "grant while actively recording" UI path
 * to click through. The decisive, faithful test of "reads live state, not
 * the frozen SSR prop" is to set consentDate and the live consent row to
 * DISAGREE and prove the live value wins both ways.
 *
 * §5: RECORDING_CONSENT_POLICY_VERSION bumped v1 → v2 — a consent row
 * granted under the OLD version must read as NOT current (isConsentCurrent)
 * until the customer re-consents under the new (photo-inclusive) script.
 *
 * Module walls mirror record-discard-photos-dialog.test.tsx.
 */
import { render, fireEvent, waitFor, act } from '@testing-library/react'

let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'recording'
const mockTarget = {
  customerId: 'cust-A',
  customerName: 'テスト花子',
  karuteNumber: null,
  appointmentId: null,
}
let mockConsentRow: { policy_version?: string | null; granted_at?: string | null } | null = null

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
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
const mockUploadCustomerPhoto = jest.fn(
  async (_customerId: string, _fd: FormData) => ({ photo: { id: 'p1' } }),
)
const mockGetCustomerConsent = jest.fn(async (_id: string) => ({ consent: mockConsentRow }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: (id: string) => mockGetCustomerConsent(id),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
  uploadCustomerPhoto: (customerId: string, fd: FormData) => mockUploadCustomerPhoto(customerId, fd),
  listCustomerPhotos: jest.fn(async () => ({ photos: [] })),
  deleteCustomerPhoto: jest.fn(async () => ({ success: true })),
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
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
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
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

beforeAll(() => {
  global.URL.createObjectURL = jest.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = jest.fn()
})

const baseProps = {
  customers: [],
  locale: 'ja',
  nearbyBookings: [],
  brief: null,
  aiBriefPromise: Promise.resolve(null),
  recentRecordings: [],
  nextAppointment: null,
}

function makeFile() {
  return new File(['x'], 'a.jpg', { type: 'image/jpeg' })
}
function cardInput(c: HTMLElement) {
  return c.querySelector('input[capture="environment"]') as HTMLInputElement
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRecState = 'recording'
  mockConsentRow = null
})

async function takeAndReadConsentField(consentDate: string | null): Promise<string | null> {
  // The StreamingBriefCard leaf suspends on aiBriefPromise (use()) — awaiting
  // the initial render inside act() flushes that settle before we wait on
  // the SIBLING recorderColumn's own refreshConsent effect below (an
  // unawaited suspend can otherwise leave RTL's act-scope in a state where
  // waitFor's polling never observes the effect firing).
  let renderResult!: ReturnType<typeof render>
  await act(async () => {
    renderResult = render(<RecordPageView {...baseProps} consentDate={consentDate} />)
  })
  const { container } = renderResult
  await waitFor(() => expect(mockGetCustomerConsent).toHaveBeenCalled())
  fireEvent.change(cardInput(container), { target: { files: [makeFile()] } })
  await waitFor(() => expect(mockUploadCustomerPhoto).toHaveBeenCalledTimes(1))
  const fd = mockUploadCustomerPhoto.mock.calls[0][1] as FormData
  return fd.get('taken_with_consent') as string | null
}

describe('§4 — takenWithConsent reads the LIVE consent state, not the SSR prop', () => {
  it('SSR consentDate says granted, but no live consent row → stamps false (live wins)', async () => {
    mockConsentRow = null
    const stamped = await takeAndReadConsentField('2026-01-01')
    expect(stamped).toBe('false')
  })

  it('SSR consentDate is null (looks not-granted), but live consent is CURRENT → stamps true (live wins)', async () => {
    mockConsentRow = { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-08-09' }
    const stamped = await takeAndReadConsentField(null)
    expect(stamped).toBe('true')
  })
})

describe('§5 — RECORDING_CONSENT_POLICY_VERSION bump re-blocks old consents', () => {
  it('a consent granted under the OLD version reads as NOT current → stamps false', async () => {
    mockConsentRow = { policy_version: 'v1-2026-05', granted_at: '2026-06-01' }
    const stamped = await takeAndReadConsentField('2026-01-01')
    expect(stamped).toBe('false')
  })

  it('a consent granted under the CURRENT version reads as granted → stamps true', async () => {
    mockConsentRow = { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-08-09' }
    const stamped = await takeAndReadConsentField('2026-01-01')
    expect(stamped).toBe('true')
  })
})

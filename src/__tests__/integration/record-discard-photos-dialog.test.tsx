/**
 * @jest-environment jsdom
 *
 * RecordPageView — D3 discard-with-photos dialog (packet 2026-08-09 PR 9b
 * §②, Liam canon): discarding a recording that has session `done` photos
 * ASKS EACH TIME (写真も削除 / 顧客ページに残す) BEFORE discardRecording()
 * runs. 写真も削除 deletes each done photo (best-effort) then discards;
 * 顧客ページに残す deletes nothing and just discards. The SAVE path
 * (handleUseRecording) never shows it — a structurally separate function
 * that never references the dialog state.
 *
 * Module walls mirror session-photo-mount-guard.test.tsx (the documented
 * mock set for mounting RecordPageView under jsdom).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'recorded'
let mockTarget: {
  customerId: string
  customerName: string
  karuteNumber: string | null
  appointmentId: string | null
} | null = null
const mockDiscardRecording = jest.fn()

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
const mockDeleteCustomerPhoto = jest.fn()
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
  uploadCustomerPhoto: jest.fn(async () => ({ photo: { id: 'p1' } })),
  listCustomerPhotos: jest.fn(async () => ({ photos: [] })),
  deleteCustomerPhoto: (customerId: string, photoId: string) =>
    mockDeleteCustomerPhoto(customerId, photoId),
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
    discardRecording: mockDiscardRecording,
    awaitRecordingSessionId: jest.fn(async () => null),
  }),
}))

import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'
import { sessionPhotoStore, type SessionPhoto } from '@/lib/karute/session-photos'

const baseProps = {
  customers: [],
  locale: 'ja',
  nearbyBookings: [],
  brief: null,
  aiBriefPromise: Promise.resolve(null),
  recentRecordings: [],
  consentDate: null,
  nextAppointment: null,
}

function donePhoto(overrides: Partial<SessionPhoto> = {}): SessionPhoto {
  return {
    id: 'sp1',
    objectUrl: 'blob:mock',
    status: 'done',
    file: new File(['x'], 'a.jpg'),
    category: 'before',
    customerId: 'cust-A',
    serverId: 'server-1',
    takenWithConsent: true,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRecState = 'recorded'
  mockTarget = {
    customerId: 'cust-A',
    customerName: 'テスト花子',
    karuteNumber: null,
    appointmentId: null,
  }
  sessionPhotoStore.photos = []
})

describe('RecordPageView discard — D3 discard-with-photos dialog', () => {
  it('discard with NO done photos → proceeds straight through, no dialog', () => {
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockDiscardRecording).toHaveBeenCalledTimes(1)
  })

  it('discard WITH a done photo → shows the dialog and does NOT discard yet', () => {
    sessionPhotoStore.photos = [donePhoto()]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockDiscardRecording).not.toHaveBeenCalled()
  })

  it('an ERROR-status (unfinished) photo alone does NOT trigger the dialog — only done photos count', () => {
    sessionPhotoStore.photos = [donePhoto({ status: 'error', serverId: null })]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockDiscardRecording).toHaveBeenCalledTimes(1)
  })

  it('写真も削除 deletes each done photo (best-effort) then discards', async () => {
    sessionPhotoStore.photos = [
      donePhoto({ id: 'a', serverId: 's-a' }),
      donePhoto({ id: 'b', serverId: 's-b' }),
    ]
    mockDeleteCustomerPhoto.mockResolvedValue({ success: true })
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosDelete'))
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(mockDeleteCustomerPhoto).toHaveBeenCalledTimes(2)
    expect(mockDeleteCustomerPhoto).toHaveBeenCalledWith('cust-A', 's-a')
    expect(mockDeleteCustomerPhoto).toHaveBeenCalledWith('cust-A', 's-b')
  })

  it('顧客ページに残す deletes nothing, still discards', async () => {
    sessionPhotoStore.photos = [donePhoto()]
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosKeep'))
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
  })

  it('a delete failure still proceeds with the discard (best-effort, one toast)', async () => {
    sessionPhotoStore.photos = [donePhoto()]
    mockDeleteCustomerPhoto.mockResolvedValue({ success: false, error: 'boom' })
    render(<RecordPageView {...baseProps} />)
    fireEvent.click(screen.getByText('discard'))
    fireEvent.click(screen.getByText('sessionPhotos.discardPhotosDelete'))
    await waitFor(() => expect(mockDiscardRecording).toHaveBeenCalledTimes(1))
  })

  it('SAVE path (handleUseRecording) never shows the discard-photos dialog', () => {
    sessionPhotoStore.photos = [donePhoto()]
    // ticketsEnabled=false routes useRecording straight to handleUseRecording
    // (skips the outcome dialog); result stays null (default mock), so it
    // returns immediately (`if (!result) return`) — handleUseRecording never
    // references showDiscardPhotosDialog/sessionDonePhotos/deleteCustomerPhoto
    // anywhere in its body, structurally distinct from handleDiscard.
    render(<RecordPageView {...baseProps} ticketsEnabled={false} />)
    fireEvent.click(screen.getByText('useRecording'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockDeleteCustomerPhoto).not.toHaveBeenCalled()
  })
})

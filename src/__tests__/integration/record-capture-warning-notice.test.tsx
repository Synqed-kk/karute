/**
 * @jest-environment jsdom
 *
 * The recorder's yellow notice on the record page (recording hole PR-6) —
 * RecordPageView itself, not a stand-in: the block sits directly under the
 * recorder controls, carries the serverRowMissing sibling's exact classes, is
 * there only while the recorder is recording or paused, holds no control, and
 * says the device line when the recorder says `device`.
 *
 * Harness copied from record-no-target-page-view.test.tsx (same transitive
 * server-module wall); next-intl is key-echoed, so text reads as the key. The
 * real ja.json words are pinned in capture-warning-copy below.
 */
import { render, screen } from '@testing-library/react'

let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'idle'
let mockPipelineState: 'idle' | 'transcribing' | 'review' = 'idle'
let mockTarget: {
  customerId: string
  customerName: string
  karuteNumber: string | null
  appointmentId: string | null
} | null = null
let mockCaptureWarning: 'device' | 'server' | null = null
let mockPipelineContext: { serverRowMissing?: boolean } | null = null
const mockStartRecording = jest.fn()
const mockReplace = jest.fn()

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
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
    captureWarning: mockCaptureWarning,
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
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    start: jest.fn(),
    retry: jest.fn(),
    reset: jest.fn(),
    state: 'idle',
    // The 録音履歴 store arms a settle watch on it (Build F1).
    subscribe: jest.fn(() => () => {}),
  },
}))
jest.mock('@/hooks/use-global-pipeline', () => ({
  useGlobalPipeline: () => ({
    state: mockPipelineState,
    context: mockPipelineContext,
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
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  listOwnStoppedUnsecuredTakeIds: jest.fn(async () => []),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
}))

import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'

// The props of record-no-target-page-view.test.tsx: an anonymous take in
// flight keeps the recorder column on screen, which is all this file needs.
const noTargetProps = {
  customers: [
    // Space in the id: encodeURIComponent turns it into %20, so a raw
    // concatenation (no encoding) produces a different, wrong URL — pins
    // both the query param name AND the encoding.
    { id: 'c 1', name: '原 奏恵', furigana: null, phone: null },
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


const SIBLING_CLASS =
  'rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200'

beforeEach(() => {
  mockRecState = 'idle'
  mockPipelineState = 'idle'
  mockPipelineContext = null
  mockTarget = null
  mockCaptureWarning = null
  jest.clearAllMocks()
})

describe('RecordPageView — the PR-6 notice', () => {
  it('recording + server: one block directly under the recorder controls, the sibling\'s classes, no control inside', () => {
    mockRecState = 'recording'
    mockCaptureWarning = 'server'
    render(<RecordPageView {...noTargetProps} />)

    const notice = screen.getByText('serverSendStalled')
    expect(notice.tagName).toBe('P')
    expect(notice.className).toBe(SIBLING_CLASS)
    expect(notice.querySelector('button, a, [role="button"]')).toBeNull()
    // Directly under {recorderControls}: the element before it holds the stop control.
    expect(notice.previousElementSibling).toContainElement(screen.getByLabelText('stopAria'))
    expect(screen.queryByText('deviceSaveUnavailable')).not.toBeInTheDocument()
  })

  it('paused + device: the device line, and only it', () => {
    mockRecState = 'paused'
    mockCaptureWarning = 'device'
    render(<RecordPageView {...noTargetProps} />)
    expect(screen.getByText('deviceSaveUnavailable').className).toBe(SIBLING_CLASS)
    expect(screen.queryByText('serverSendStalled')).not.toBeInTheDocument()
  })

  it('sits ABOVE the serverRowMissing sibling, with the same classes', () => {
    mockRecState = 'recording'
    mockCaptureWarning = 'server'
    mockPipelineState = 'transcribing'
    mockPipelineContext = { serverRowMissing: true }
    render(<RecordPageView {...noTargetProps} />)
    const notice = screen.getByText('serverSendStalled')
    const sibling = screen.getByText('serverRowMissing')
    expect(notice.className).toBe(sibling.className)
    expect(notice.nextElementSibling).toBe(sibling)
  })

  it('absent when the recorder is idle, whatever the field says (the recorder column IS on screen)', () => {
    mockCaptureWarning = 'server'
    // A booking of her own, so the idle page keeps the recorder column.
    const withBooking = {
      ...noTargetProps,
      nextAppointment: {
        id: 'apt-1',
        customerName: '原 奏恵',
        customerId: 'c 1',
        karuteNumber: null,
        startTime: '2026-08-02T02:00:00.000Z',
        durationMinutes: 60,
        title: null,
        notes: null,
        statusKey: 'booked' as const,
        staffName: '原',
        bookedUnderOtherStaff: false,
      },
    }
    render(<RecordPageView {...withBooking} />)
    expect(screen.getByLabelText('startAria')).toBeInTheDocument()
    expect(screen.queryByText('serverSendStalled')).not.toBeInTheDocument()
    expect(screen.queryByText('deviceSaveUnavailable')).not.toBeInTheDocument()
  })

  it('absent once the take is recorded, whatever the field says (the recorder column IS on screen)', () => {
    mockRecState = 'recorded'
    mockCaptureWarning = 'device'
    render(<RecordPageView {...noTargetProps} />)
    expect(screen.getByLabelText('ended')).toBeInTheDocument()
    expect(screen.queryByText('serverSendStalled')).not.toBeInTheDocument()
    expect(screen.queryByText('deviceSaveUnavailable')).not.toBeInTheDocument()
  })

  it('absent while recording with nothing wrong', () => {
    mockRecState = 'recording'
    render(<RecordPageView {...noTargetProps} />)
    expect(screen.queryByText('serverSendStalled')).not.toBeInTheDocument()
    expect(screen.queryByText('deviceSaveUnavailable')).not.toBeInTheDocument()
  })
})

describe('capture-warning-copy — the FINAL lines, verbatim', () => {
  it('ja.json carries the two lines exactly, next to serverRowMissing; en.json has both keys', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ja = require('../../../messages/ja.json') as { recording: Record<string, string> }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const en = require('../../../messages/en.json') as { recording: Record<string, string> }
    expect(ja.recording.deviceSaveUnavailable).toBe(
      'この端末に保存できないため、サーバーへ直接送信しています。録音停止までアプリを閉じないでください',
    )
    expect(ja.recording.serverSendStalled).toBe(
      'サーバーに送信できていません。音声はこの端末に保存され、自動送信されます',
    )
    const keys = Object.keys(ja.recording)
    expect(keys.slice(keys.indexOf('serverRowMissing'), keys.indexOf('serverRowMissing') + 3)).toEqual([
      'serverRowMissing',
      'deviceSaveUnavailable',
      'serverSendStalled',
    ])
    expect(typeof en.recording.deviceSaveUnavailable).toBe('string')
    expect(typeof en.recording.serverSendStalled).toBe('string')
  })
})

/**
 * @jest-environment jsdom
 *
 * S126 A2 builder 5 (R-S126-6 e): the recovery legs' burnPromise (runRecoveryLegs —
 * the one burn the recovery banner's save and its auto-finish twin share) reads
 * the use state (S125 § 6a).
 *   pending → legs.burn 'done', burnAck 'redeemed', 「消化を記録しました」 (redeemDone)
 *   held    → the same, with 「確認待ち」 (redeemHeld) as info, never error
 *   refused → already_redeemed / below_zero / guard_unavailable keep today's branches
 * burnAck is observed where it lands: the notice after a refetch that FAILS reads
 * the leg ACK (tier ②), so 'redeemed' = recoverTicketRedeemed, 'unresolved' =
 * recoverAutoTicketUnresolved. Harness = recovery-auto-finish.test.tsx's.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))
const mockRouterPush = jest.fn()
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: (...a: unknown[]) => mockRouterPush(...a), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
// P5-A: RecordPageView imports the written-reason discard action; unmocked it
// pulls the ESM SDK into this suite. Not exercised here.
jest.mock('@/actions/recording-discard', () => ({ discardRecordingWithReason: jest.fn() }))

const mockSaveInline = jest.fn<Promise<{ id: string } | { error: string }>, [unknown]>(
  async () => ({ id: 'karute-1' }),
)
jest.mock('@/actions/karute', () => ({
  saveKaruteRecord: jest.fn(),
  saveKaruteRecordInline: (i: unknown) => mockSaveInline(i),
}))
jest.mock('@/actions/recording-discards', () => ({
  myDiscardCountThisMonth: jest.fn(async () => null),
  listDiscardReasons: jest.fn(async () => ({ ok: false, error: 'forbidden' })),
}))

const DAY_FACTS = {
  date: '2026-08-18',
  bookings: [] as unknown[],
  packs: [] as {
    customerId: string
    packId: string | null
    remaining: number
    size: number
    target: { remaining: number; size: number; otherRemaining: number } | null
  }[],
  redeemed: { appointmentIds: [] as string[], customerIds: [] as string[] },
}
const mockDayFacts = jest.fn<Promise<typeof DAY_FACTS>, [unknown]>(async () => DAY_FACTS)
jest.mock('@/actions/recovery', () => ({
  getRecoveryDayFacts: (i: unknown) => mockDayFacts(i),
}))

const mockGetCustomerConsent = jest.fn<
  Promise<{ consent: { policy_version: string; granted_at: string } | null }>,
  [string]
>(
  async () => ({
    consent: null,
  }),
)
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: (id: string) => mockGetCustomerConsent(id),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
}))

const mockRedeem = jest.fn<Promise<{ ok: boolean; redemptionId?: string; error?: string }>, [unknown]>(
  async () => ({ ok: true, redemptionId: 'r1' }),
)
const mockCreatePack = jest.fn(async () => ({ ok: true }))
jest.mock('@/actions/packs', () => ({
  createPackAction: () => mockCreatePack(),
  redeemSessionAction: (i: unknown) => mockRedeem(i),
  undoRedemptionAction: jest.fn(async () => ({ ok: true })),
}))
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
  return new Proxy(
    {},
    { get: (_target, prop) => (prop === 'Button' ? button : passthrough) },
  )
})

const TAKE = {
  takeId: 'take-1',
  target: {
    customerId: 'cust-1',
    customerName: '佐藤 美咲',
    karuteNumber: '#00058',
    appointmentId: 'appt-1',
    service: 'トリートメント',
  },
  recordingSessionId: 'sess-1',
  mimeType: 'audio/webm',
  startedAt: Date.parse('2026-08-18T05:22:00Z'),
  updatedAt: Date.parse('2026-08-18T05:45:00Z'),
  outcome: undefined as { status: string } | undefined,
  outcomeSkipped: undefined as boolean | undefined,
  outcomeLegs: undefined as { burn: string; pack: string } | undefined,
}
let offerTake = true
let takeOverride: Record<string, unknown> | null = null
const mockStampTakeOutcome = jest.fn(async () => {})
const mockDeleteTake = jest.fn()
let mockTakeBlob: Blob | null = new Blob(['audio'])
// Capture pipeline PR3 — the record page's mount retry. This suite's take-store
// is a fake, so the real secureTake would reach for functions that are not in
// it; nothing here is about whether the audio reaches the server (that is
// take-durability.test.ts + recovery-banner-save-only.test.tsx).
jest.mock('@/lib/recording/secure-take', () => ({ secureTake: jest.fn(async () => {}) }))

jest.mock('@/lib/karute/take-store', () => ({
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: (...a: unknown[]) => mockDeleteTake(...a),
  // PR4 fix round 4: the save's settle door. Same standing as deleteTake here —
  // this suite is about the auto-finish notice, not about the audio.
  settleTakeAfterSave: (...a: unknown[]) => mockDeleteTake(...a),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: (...a: unknown[]) => mockStampTakeOutcome(...(a as [])),
  readTakeOutcome: jest.fn(async () => null),
  listOwnStoppedUnsecuredTakeIds: jest.fn(async () => []),
  getRecoverableTake: jest.fn(async () => (offerTake ? (takeOverride ?? TAKE) : null)),
  loadTakeBlob: jest.fn(async () => mockTakeBlob),
}))

let offerDraft: Record<string, unknown> | null = null
jest.mock('@/lib/karute/draft', () => ({
  loadDraft: jest.fn(async () => offerDraft),
  clearDraft: jest.fn(),
  currentUserId: jest.fn(async () => 'staff-A'),
}))

jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: 'idle',
    result: null,
    error: null,
    stream: null,
    startedAt: null,
    overrun: false,
    autoStopped: false,
    target: null,
    takeId: null,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    discardRecording: jest.fn(),
    awaitRecordingSessionId: jest.fn(async () => null),
  }),
}))

const mockPipelineStart = jest.fn()
// A LIVE fake: the take path's notice waits for a record id the pipeline
// publishes, so this mock has to be able to actually publish one (real
// listeners + a version bump, exactly like the singleton).
const mockPipelineListeners = new Set<() => void>()
const mockPipeline = {
  version: 0,
  state: 'idle' as string,
  step: null,
  result: null,
  error: null,
  runId: 0,
  savedRecordId: null as string | null,
  context: null as { takeId?: string } | null,
  subscribe: (fn: () => void) => {
    mockPipelineListeners.add(fn)
    return () => mockPipelineListeners.delete(fn)
  },
  start: (...a: unknown[]) => {
    // The real start() mints the run id synchronously before its first await.
    mockPipeline.runId += 1
    mockPipelineStart(...a)
  },
  publishSavedRecord: (runId: number, id: string) => {
    if (runId !== mockPipeline.runId) return
    mockPipeline.savedRecordId = id
    mockPipeline.version += 1
    mockPipelineListeners.forEach((f) => f())
  },
  retry: jest.fn(),
  reset: jest.fn(),
}
// A getter, not a value: jest hoists this factory above the const above it.
jest.mock('@/lib/global-pipeline', () => ({
  get globalPipeline() {
    return mockPipeline
  },
}))

import { StrictMode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import {
  RecordPageView,
  type RecordPageViewProps,
} from '@/components/karute/redesign/record/RecordPageView'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

afterEach(() => {
  cleanup()
  jest.clearAllMocks()
  mockGetCustomerConsent.mockReset()
  mockGetCustomerConsent.mockResolvedValue({ consent: null })
  mockSaveInline.mockReset()
  mockSaveInline.mockResolvedValue({ id: 'karute-1' })
  mockDayFacts.mockReset()
  mockDayFacts.mockImplementation(async () => DAY_FACTS)
  mockRedeem.mockReset()
  mockRedeem.mockResolvedValue({ ok: true, redemptionId: 'r1' })
  mockDeleteTake.mockReset()
  offerTake = true
  takeOverride = null
  offerDraft = null
  mockTakeBlob = new Blob(['audio'])
  TAKE.outcome = undefined
  TAKE.outcomeSkipped = undefined
  TAKE.outcomeLegs = undefined
  DAY_FACTS.packs = []
  DAY_FACTS.bookings = []
  DAY_FACTS.redeemed = { appointmentIds: [], customerIds: [] }
  mockPipelineListeners.clear()
  mockPipeline.runId = 0
  mockPipeline.savedRecordId = null
  mockPipeline.context = null
  mockPipeline.state = 'idle'
})

function grantConsent() {
  mockGetCustomerConsent.mockResolvedValue({
    consent: {
      policy_version: RECORDING_CONSENT_POLICY_VERSION,
      granted_at: '2026-08-01T00:00:00Z',
    },
  })
}

async function renderPage(
  overrides: Partial<RecordPageViewProps> = {},
  opts: { strict?: boolean } = {},
) {
  const buildUi = () => (
    <RecordPageView
      customers={[{ id: 'cust-1', name: '佐藤 美咲' } as never]}
      locale="ja"
      nextAppointment={null}
      nearbyBookings={[]}
      brief={null}
      aiBriefPromise={Promise.resolve(null)}
      recentRecordings={[]}
      consentDate={null}
      currentStaffName="原"
      ticketsEnabled
      {...overrides}
    />
  )
  // Rendered INSIDE an awaited act: with a booked target the page mounts a
  // Suspense boundary (StreamingBriefCard's use(aiBriefPromise)) that always
  // suspends on its first pass, and a suspension inside a non-awaited act
  // scope leaves the tree's effects unrun.
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(buildUi(), opts.strict ? { wrapper: StrictMode } : undefined)
    await Promise.resolve()
  })
  // Mount effects (draft + take load), the day-facts fetch, then the whole
  // auto-run chain: consent read → answer read → money legs → write → the
  // notice's own day-facts refetch.
  await act(async () => {
    for (let i = 0; i < 24; i++) await Promise.resolve()
  })
  return {
    ...result,
    rerenderSame: async () => {
      await act(async () => {
        result.rerender(buildUi())
        for (let i = 0; i < 8; i++) await Promise.resolve()
      })
    },
  }
}

/** The pipeline's save landing, as ProcessingIndicator reports it. */
async function pipelineSaves(id = 'karute-9') {
  await act(async () => {
    mockPipeline.publishSavedRecord(mockPipeline.runId, id)
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })
}

/** Day facts with an explicit pack/redemption shape — the two reads
 *  (the mount gate, and armAutoNotice's post-money refetch) must be able to
 *  DISAGREE, or "refetched, not frozen" is unprovable. */
function factsWith(over: {
  remaining?: number
  redeemedAppointments?: string[]
  redeemedCustomers?: string[]
}) {
  return {
    ...DAY_FACTS,
    packs:
      over.remaining === undefined
        ? []
        : [
            {
              customerId: 'cust-1',
              packId: 'pack-1',
              remaining: over.remaining,
              size: 6,
              target: { remaining: over.remaining, size: 6, otherRemaining: 0 },
            },
          ],
    redeemed: {
      appointmentIds: over.redeemedAppointments ?? [],
      customerIds: over.redeemedCustomers ?? [],
    },
  }
}

const notice = () => screen.queryByText('recoverAutoSavedTitle')
const banner = () => screen.queryByText('recoverBannerTitle')


import { toast } from 'sonner'

/** 残4 = the 'auto' cohort, so the recovery burn leg genuinely runs; the notice's
 *  own refetch then dies, so what it says is the leg's burnAck. */
function burnWithDeadRefetch(res: Record<string, unknown>) {
  grantConsent()
  mockDayFacts
    .mockImplementationOnce(async () => factsWith({ remaining: 4 }))
    .mockImplementation(async () => {
      throw new Error('core down')
    })
  mockRedeem.mockResolvedValue(res as never)
}

describe('(c) recovery burnPromise reads the use state', () => {
  it('pending → legs.burn done, burnAck redeemed, the 「消化を記録しました」 toast', async () => {
    burnWithDeadRefetch({ ok: true, state: 'pending' })
    await renderPage()
    expect(mockRedeem).toHaveBeenCalledTimes(1)
    expect(mockRedeem.mock.calls[0][0]).toMatchObject({ packId: 'pack-1', recovery: true })
    expect(mockStampTakeOutcome).toHaveBeenCalledWith('take-1', undefined, true, { burn: 'done', pack: 'none' }, null)
    expect(toast.success).toHaveBeenCalledWith('redeemDone')
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringMatching(/^autoRedeemed/), expect.anything())
    expect(toast.info).not.toHaveBeenCalledWith('redeemHeld')
    expect(toast.error).not.toHaveBeenCalled()
    await pipelineSaves()
    expect(screen.getByText('recoverTicketRedeemed')).toBeTruthy()
    expect(screen.queryByText('recoverAutoTicketUnresolved')).toBeNull()
    expect(banner()).toBeNull()
  })

  it('held → the same certified leg and burnAck, with 「確認待ち」 as info, never error', async () => {
    burnWithDeadRefetch({ ok: true, state: 'held' })
    await renderPage()
    expect(mockStampTakeOutcome).toHaveBeenCalledWith('take-1', undefined, true, { burn: 'done', pack: 'none' }, null)
    expect(toast.info).toHaveBeenCalledWith('redeemHeld')
    expect(toast.success).not.toHaveBeenCalledWith('redeemDone')
    expect(toast.error).not.toHaveBeenCalled()
    await pipelineSaves()
    expect(screen.getByText('recoverTicketRedeemed')).toBeTruthy()
    expect(banner()).toBeNull()
  })

  it('refused already_redeemed → today: leg done, 消化済み, the recoverAlreadyRedeemed info', async () => {
    burnWithDeadRefetch({ ok: false, error: 'already_redeemed' })
    await renderPage()
    expect(mockStampTakeOutcome).toHaveBeenCalledWith('take-1', undefined, true, { burn: 'done', pack: 'none' }, null)
    expect(toast.info).toHaveBeenCalledWith('recoverAlreadyRedeemed')
    expect(toast.info).not.toHaveBeenCalledWith('redeemHeld')
    await pipelineSaves()
    expect(screen.getByText('recoverTicketRedeemed')).toBeTruthy()
  })

  it('refused below_zero → today: leg done, 未処理, the 残回数なし error', async () => {
    burnWithDeadRefetch({ ok: false, error: 'below_zero' })
    await renderPage()
    expect(mockStampTakeOutcome).toHaveBeenCalledWith('take-1', undefined, true, { burn: 'done', pack: 'none' }, null)
    expect(toast.error).toHaveBeenCalledWith('redeemNoSessionsLeft')
    expect(toast.success).not.toHaveBeenCalled()
    await pipelineSaves()
    expect(screen.getByText('recoverAutoTicketUnresolved')).toBeTruthy()
    expect(screen.queryByText('recoverTicketRedeemed')).toBeNull()
  })

  it('refused guard_unavailable → today: nothing certified, no save, the banner and its retry stay', async () => {
    burnWithDeadRefetch({ ok: false, error: 'guard_unavailable' })
    await renderPage()
    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(notice()).toBeNull()
    expect(banner()).toBeTruthy()
    expect(mockStampTakeOutcome).toHaveBeenCalledWith('take-1', undefined, true, { burn: 'pending', pack: 'none' }, null)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalledWith('redeemHeld')
  })
})

/**
 * @jest-environment jsdom
 *
 * PR-B2 — AUTO-FINISH + the green notice (mock section 0, boards B0a/B0b).
 *
 * The contract: stopping always saves, and after a crash the app finishes the
 * save ITSELF on relaunch — a notice, not a question. The amber banner survives
 * only as last-resort residue for what auto-finish cannot honestly complete.
 *
 * What this suite pins, in the order it matters:
 *   · MONEY (R-B2): the auto path never invents an outcome, never fabricates a
 *     skip, and never burns without either a persisted answer or the 'auto'
 *     cohort the live product already burns silently for.
 *   · WRITERS (R-B1): the same two, always — globalPipeline for takes,
 *     saveKaruteRecordInline for drafts. No third shape appears here.
 *   · THE FALLBACKS: unbound, stale consent, an uncertified leg, a failed save
 *     — each one leaves the banner and its retry machinery exactly as shipped.
 *   · ONE SHOT: an attempt per offer, spent whether or not it ran; a failure
 *     falls back to the human, it does not loop.
 *
 * The tapped path's own contract lives in recovery-banner-save-only.test.tsx.
 */

// Params are appended to the key so the derived money numbers in the notice
// (残N/M) are actually assertable — this suite's whole point is that they come
// from REFETCHED server truth, and a params-swallowing stub could not tell.
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

const mockSaveInline = jest.fn(async (_i: unknown) => ({ id: 'karute-1' }) as
  | { id: string }
  | { error: string })
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
  packs: [] as { customerId: string; packId: string | null; remaining: number; size: number }[],
  redeemed: { appointmentIds: [] as string[], customerIds: [] as string[] },
}
const mockDayFacts = jest.fn(async (_i: unknown) => DAY_FACTS)
jest.mock('@/actions/recovery', () => ({
  getRecoveryDayFacts: (i: unknown) => mockDayFacts(i),
}))

const mockGetCustomerConsent = jest.fn(
  async (
    _id: string,
  ): Promise<{ consent: { policy_version: string; granted_at: string } | null }> => ({
    consent: null,
  }),
)
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: (id: string) => mockGetCustomerConsent(id),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
}))

const mockRedeem = jest.fn(async (_i: unknown) => ({ ok: true, redemptionId: 'r1' }) as {
  ok: boolean
  redemptionId?: string
  error?: string
})
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
jest.mock('@/lib/karute/take-store', () => ({
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: (...a: unknown[]) => mockDeleteTake(...a),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: (...a: unknown[]) => mockStampTakeOutcome(...(a as [])),
  readTakeOutcome: jest.fn(async () => null),
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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

/** Move the pipeline the way a real run does — `live` follows it, and with
 *  `live` the recovery offer appears and disappears. */
async function setPipelineState(state: string) {
  await act(async () => {
    mockPipeline.state = state
    mockPipeline.version += 1
    mockPipelineListeners.forEach((f) => f())
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
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
        : [{ customerId: 'cust-1', packId: 'pack-1', remaining: over.remaining, size: 6 }],
    redeemed: {
      appointmentIds: over.redeemedAppointments ?? [],
      customerIds: over.redeemedCustomers ?? [],
    },
  }
}

const DRAFT = {
  transcript: 't',
  summary: 's',
  entries: [] as unknown[],
  duration: 1380,
  appointmentId: 'appt-1',
  appointmentCustomerId: 'cust-1',
  recordingSessionId: 'sess-1',
  takeId: 'take-1',
  savedAt: Date.parse('2026-08-18T05:45:00Z'),
}

/** A bookable target, so the record button is live and handleStartRecording
 *  (the notice's one clear point) is actually reachable from a test. */
const APPOINTMENT = {
  id: 'appt-next',
  customerId: 'cust-1',
  customerName: '佐藤 美咲',
  karuteNumber: null,
  startTime: '2026-08-18T06:00:00.000Z',
  durationMinutes: 60,
  title: null,
  notes: null,
} as never

const notice = () => screen.queryByText('recoverAutoSavedTitle')
const banner = () => screen.queryByText('recoverBannerTitle')
const popup = () => screen.queryByText('disclaimer')
const startCtx = () => mockPipelineStart.mock.calls[0][1] as Record<string, unknown>

describe('auto-finish lands the record itself', () => {
  it('① an ANSWERED take saves with its restored outcome, asks nothing, and reports 消化済み 残N/M', async () => {
    grantConsent()
    TAKE.outcome = { status: 'success' }
    TAKE.outcomeLegs = { burn: 'done', pack: 'none' }
    // R-B4, provable only if the two reads DISAGREE: the mount gate sees an
    // un-burned 残5, the post-money refetch sees the burn and 残4. A notice
    // built from the frozen flow would say 未処理 / 残5 and fail here.
    mockDayFacts
      .mockImplementationOnce(async () => factsWith({ remaining: 5 }))
      .mockImplementation(async () =>
        factsWith({ remaining: 4, redeemedAppointments: ['appt-1'] }),
      )

    await renderPage()

    // No tap happened, and no question was asked.
    expect(popup()).toBeNull()
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
    expect(startCtx().outcome).toEqual({ status: 'success' })
    expect(startCtx().recoveryUnanswered).toBe(false)
    // Legs were already certified before the crash — nothing re-runs, and the
    // answer that survived is not re-stamped over itself either.
    expect(mockRedeem).not.toHaveBeenCalled()
    expect(mockStampTakeOutcome).not.toHaveBeenCalled()

    // The notice waits for the record to provably exist.
    expect(notice()).toBeNull()
    await pipelineSaves()
    expect(notice()).toBeTruthy()
    expect(banner()).toBeNull()
    // B0a's line, off the REFETCH (call 2's 残4), never the mount read's 残5.
    expect(mockDayFacts).toHaveBeenCalledTimes(2)
    expect(
      screen.getByText('recoverAutoTicketBurned:{"remaining":4,"size":6}'),
    ).toBeTruthy()
    expect(screen.queryByText('recoverAutoTicketUnresolved')).toBeNull()
    expect(screen.queryByText('recoverAutoOutcomeUnanswered')).toBeNull()
    // 「佐藤 美咲様 · … · …」 — the identity line (B0a's meta).
    expect(screen.getByText(/^佐藤 美咲target\.honorific · /)).toBeTruthy()
  })

  it('② an UNANSWERED take saves with NO outcome, burns NOTHING, and says 結果未回答', async () => {
    grantConsent()
    // 残2 = the repurchase cohort — the tapped path would open the popup here.
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]

    await renderPage()

    expect(popup()).toBeNull()
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
    // R-B2, the whole point: no invented outcome, no fabricated skip — an
    // honest third state instead, and the coaching layer learns nothing false.
    expect(startCtx().outcome).toBeUndefined()
    expect(startCtx().outcomeSkipped).toBe(false)
    expect(startCtx().recoveryUnanswered).toBe(true)
    expect(mockRedeem).not.toHaveBeenCalled()
    expect(mockCreatePack).not.toHaveBeenCalled()
    // Nothing was answered, so nothing is stamped as answered either.
    expect(mockStampTakeOutcome).not.toHaveBeenCalled()

    await pipelineSaves()
    // ⚖ 14 (Liam 8/23): 未処理 pack + 未回答 結果 no longer stack as two lines
    // that both point at the karute — one merged line, and neither single-
    // condition line may appear alongside it.
    expect(screen.getByText('recoverAutoTicketAndOutcomeUnanswered')).toBeTruthy()
    expect(screen.queryByText('recoverAutoOutcomeUnanswered')).toBeNull()
    expect(screen.queryByText('recoverAutoTicketUnresolved')).toBeNull()
  })

  it('③ the mid-pack auto cohort burns silently, exactly as the live stop flow does', async () => {
    grantConsent()
    // 残4 (>2) = 'auto': the product never asks this cohort, so recovery must
    // not either — it burns and says so.
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }]
    mockRedeem.mockImplementation(async () => {
      DAY_FACTS.redeemed = { appointmentIds: ['appt-1'], customerIds: ['cust-1'] }
      return { ok: true, redemptionId: 'r1' }
    })

    await renderPage()

    expect(popup()).toBeNull()
    expect(mockRedeem).toHaveBeenCalledTimes(1)
    expect(mockRedeem.mock.calls[0][0]).toMatchObject({
      packId: 'pack-1',
      appointmentId: 'appt-1',
      recovery: true,
      redeemedOn: '2026-08-18',
    })
    expect(startCtx().outcomeSkipped).toBe(true)
    expect(startCtx().recoveryUnanswered).toBe(false)
    // The same certification its tapped twin pins (A-6, recovery-banner-save-
    // only.test.tsx): the burn leg is stamped done, with no outcome and no
    // pack payload, so a relaunch never re-runs it.
    expect(mockStampTakeOutcome).toHaveBeenCalledWith(
      'take-1',
      undefined,
      true,
      { burn: 'done', pack: 'none' },
      null,
    )

    await pipelineSaves()
    expect(screen.getByText('recoverAutoTicketBurned:{"remaining":4,"size":6}')).toBeTruthy()
    // Nothing is owed — this cohort is never asked, so no 結果未回答 line.
    expect(screen.queryByText('recoverAutoOutcomeUnanswered')).toBeNull()
  })

  it('④ a DRAFT auto-saves through saveKaruteRecordInline — no 4th writer shape', async () => {
    grantConsent()
    offerTake = false
    offerDraft = {
      transcript: 't',
      summary: 's',
      entries: [],
      duration: 1380,
      appointmentId: 'appt-1',
      appointmentCustomerId: 'cust-1',
      recordingSessionId: 'sess-1',
      takeId: 'take-1',
      savedAt: Date.parse('2026-08-18T05:45:00Z'),
    }

    await renderPage()

    expect(mockSaveInline).toHaveBeenCalledTimes(1)
    expect(mockSaveInline.mock.calls[0][0]).toMatchObject({
      customerId: 'cust-1',
      appointmentId: 'appt-1',
      outcome: undefined,
    })
    expect(mockPipelineStart).not.toHaveBeenCalled()
    // The draft's write completes in-line, so its notice needs no pipeline.
    expect(notice()).toBeTruthy()
    expect(banner()).toBeNull()
  })

  it('a BURNED pack + an unanswered 結果 stays TWO lines — the merge is unresolved-only', async () => {
    grantConsent()
    // 残2 = the repurchase cohort: auto-finish never asks it and never burns,
    // so the 結果 stays owed. The notice's REFETCH then reveals a burn that
    // landed before the crash — redeemed + owed, the one combination ⚖ 14
    // deliberately leaves as two lines (the burn is a settled money fact, not
    // a chore). Widening `merged` to include 'redeemed' fails right here.
    mockDayFacts
      .mockImplementationOnce(async () => factsWith({ remaining: 2 }))
      .mockImplementation(async () =>
        factsWith({ remaining: 2, redeemedAppointments: ['appt-1'] }),
      )

    await renderPage()
    expect(startCtx().recoveryUnanswered).toBe(true)

    await pipelineSaves()
    expect(screen.getByText('recoverAutoTicketBurned:{"remaining":2,"size":6}')).toBeTruthy()
    expect(screen.getByText('recoverAutoOutcomeUnanswered')).toBeTruthy()
    expect(screen.queryByText('recoverAutoTicketAndOutcomeUnanswered')).toBeNull()
  })

  it('the notice links to the karute the save actually landed', async () => {
    grantConsent()
    await renderPage()
    await pipelineSaves('karute-42')
    await act(async () => {
      screen.getByText('recoverAutoOpenKarute').click()
    })
    expect(mockRouterPush).toHaveBeenCalledWith('/karute/karute-42')
  })
})

// ── R-B4's ladder: refetch → this session's leg ACK → pre-save state ──────
describe('the notice never invents a money line', () => {
  it('a refetch that FAILS after a real burn still says 消化済み — the leg ACK is a server answer', async () => {
    grantConsent()
    // 残4 (>2) = the 'auto' cohort, so a burn genuinely runs this session…
    mockDayFacts
      .mockImplementationOnce(async () => factsWith({ remaining: 4 }))
      // …and the notice's own refetch is exactly what dies.
      .mockImplementation(async () => {
        throw new Error('core down')
      })

    await renderPage()

    expect(mockRedeem).toHaveBeenCalledTimes(1)
    await pipelineSaves()
    // Tier ②: the burn was ACKed, so 未処理 would be a lie about money. The
    // COUNT is dropped — 残4 is the pre-burn number and the read that would
    // have proven the new one is what just failed.
    expect(screen.getByText('recoverTicketRedeemed')).toBeTruthy()
    expect(screen.queryByText('recoverAutoTicketUnresolved')).toBeNull()
    expect(screen.queryByText(/recoverAutoTicketBurned/)).toBeNull()
  })

  it('below_zero is NOT a burn: an empty pack reads 未処理 even though the leg certified', async () => {
    grantConsent()
    mockDayFacts
      .mockImplementationOnce(async () => factsWith({ remaining: 4 }))
      .mockImplementation(async () => {
        throw new Error('core down')
      })
    // The leg settles (retrying cannot change an empty pack) but NOTHING moved.
    mockRedeem.mockResolvedValue({ ok: false, error: 'below_zero' })

    await renderPage()

    await pipelineSaves()
    expect(screen.getByText('recoverAutoTicketUnresolved')).toBeTruthy()
    expect(screen.queryByText('recoverTicketRedeemed')).toBeNull()
  })

  it('tickets OFF: no ticket line, and the notice never spends a refetch on one', async () => {
    grantConsent()
    mockDayFacts.mockImplementation(async () => factsWith({ remaining: 4 }))

    await renderPage({ ticketsEnabled: false })

    await pipelineSaves()
    expect(notice()).toBeTruthy()
    expect(screen.queryByText('recoverAutoTicketUnresolved')).toBeNull()
    expect(screen.queryByText('recoverTicketRedeemed')).toBeNull()
    expect(screen.queryByText(/recoverAutoTicketBurned/)).toBeNull()
    expect(mockRedeem).not.toHaveBeenCalled()
    // Only the mount gate's read — armAutoNotice asks nothing when there is no
    // money question to answer.
    expect(mockDayFacts).toHaveBeenCalledTimes(1)
  })

  it('a notice cleared by a NEW recording is never resurrected by the refetch it was waiting on', async () => {
    grantConsent()
    offerTake = false
    offerDraft = { ...DRAFT }
    let releaseRefetch: (v: unknown) => void = () => {}
    mockDayFacts
      .mockImplementationOnce(async () => factsWith({ remaining: 4 }))
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            releaseRefetch = r as (v: unknown) => void
          }) as never,
      )

    await renderPage({ nextAppointment: APPOINTMENT })
    // A booked target renders the Suspense'd brief card, which defers this
    // component's own mount effects past the microtask queue — one macrotask
    // settles it, and only then has the auto-run actually run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })

    expect(mockSaveInline).toHaveBeenCalledTimes(1)
    expect(notice()).toBeNull()

    // The staffer moves on and starts a NEW recording.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('startAria'))
      await Promise.resolve()
    })

    await act(async () => {
      releaseRefetch(factsWith({ remaining: 4 }))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    // 前回の録音 is no longer 前回. The report about it stays dead.
    expect(notice()).toBeNull()
  })

  // The test above pins the EPOCH GUARD (a held refetch cannot re-arm) — its
  // notice was never on screen to begin with. This one pins the other half:
  // the synchronous clear, on a notice that is provably VISIBLE. The recorder
  // is inert in this harness, so `live` never flips — setAutoNotice(null) is
  // the only thing that can take the notice off the screen.
  it('a VISIBLE notice is cleared the moment a new recording starts', async () => {
    grantConsent()
    offerTake = false
    offerDraft = { ...DRAFT }

    await renderPage({ nextAppointment: APPOINTMENT })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(notice()).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('startAria'))
      for (let i = 0; i < 4; i++) await Promise.resolve()
    })
    expect(notice()).toBeNull()
  })
})

describe('what auto-finish REFUSES to do — the banner is the fallback, untouched', () => {
  it('an UNBOUND take is never auto-saved: no writer, banner + picker stay', async () => {
    grantConsent()
    takeOverride = { ...TAKE, target: null }

    await renderPage()

    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(mockSaveInline).not.toHaveBeenCalled()
    expect(banner()).toBeTruthy()
    expect(screen.getByText('recoverPickAndSaveAction')).toBeTruthy()
    expect(notice()).toBeNull()
  })

  it('a NON-CURRENT consent stands the auto path down SILENTLY — no grant dialog opens by itself', async () => {
    // Default mock: consent null.
    await renderPage()

    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'consentDialogTitle' })).toBeNull()
    expect(banner()).toBeTruthy()
    expect(notice()).toBeNull()
  })

  it('day facts that cannot be read block the auto save, exactly as they block the tap', async () => {
    grantConsent()
    mockDayFacts.mockImplementation(async () => ({ ...DAY_FACTS, unavailable: true as const }))

    await renderPage()

    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(banner()).toBeTruthy()
    expect(screen.getByText('recoverTicketUnknown')).toBeTruthy()
  })

  it('guard_unavailable mid-flight certifies NOTHING, aborts to the banner, and shows no notice', async () => {
    grantConsent()
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }]
    mockRedeem.mockResolvedValue({ ok: false, error: 'guard_unavailable' })

    await renderPage()

    // The burn is transient — nothing saved, nothing claimed, retry alive.
    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(notice()).toBeNull()
    expect(banner()).toBeTruthy()
    const retry = screen.getByText('recoverSaveAction') as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    // The leg is stamped as still PENDING — never as done.
    expect(mockStampTakeOutcome).toHaveBeenCalledWith(
      'take-1',
      undefined,
      true,
      { burn: 'pending', pack: 'none' },
      null,
    )
  })

  it('a FAILED save leaves the offer, the banner and the take alone — and no notice', async () => {
    grantConsent()
    offerTake = false
    offerDraft = {
      transcript: 't',
      summary: 's',
      entries: [],
      duration: 60,
      appointmentId: 'appt-1',
      appointmentCustomerId: 'cust-1',
      recordingSessionId: 'sess-1',
      takeId: 'take-1',
      savedAt: Date.parse('2026-08-18T05:45:00Z'),
    }
    mockSaveInline.mockResolvedValue({ error: 'boom' })

    await renderPage()

    expect(mockSaveInline).toHaveBeenCalledTimes(1)
    expect(notice()).toBeNull()
    expect(banner()).toBeTruthy()
    // "the take alone" — the audio survives a failed save, or the retry the
    // banner is offering would have nothing left to save.
    expect(mockDeleteTake).not.toHaveBeenCalled()
  })
})

describe('one shot per offer', () => {
  it('a strict-mode double-invoked mount attempts the save exactly ONCE', async () => {
    grantConsent()
    await renderPage({}, { strict: true })
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })

  // A REAL dependency re-run, not a re-render: the pipeline going busy hides
  // the offer (`live`), and going idle again brings the SAME offer back, so
  // `activeOfferId` genuinely changes null → id and the effect body executes a
  // second time for this offer. That is the only thing standing between a
  // failed attempt and a second unattended save — and it is the ref, nothing
  // else. (A plain rerenderSame() cannot prove this: none of the effect's
  // dependencies move, so React would not re-invoke it even with no guard.)
  it('a FAILED attempt does not re-fire when the effect genuinely runs again', async () => {
    grantConsent()
    offerTake = false
    offerDraft = { ...DRAFT }
    mockSaveInline.mockResolvedValue({ error: 'boom' })

    await renderPage()
    expect(mockSaveInline).toHaveBeenCalledTimes(1)
    expect(banner()).toBeTruthy()

    await setPipelineState('processing')
    expect(banner()).toBeNull()
    await setPipelineState('idle')

    // The offer is back, the banner is back, and the human 保存する is the only
    // thing that will move it now.
    expect(banner()).toBeTruthy()
    expect(mockSaveInline).toHaveBeenCalledTimes(1)
  })

  // SEAMS: a mount that could not read the day's money facts must not BURN the
  // one shot — the gate order (facts first, ref second) is what guarantees the
  // staffer's retry still gets an automatic save instead of a dead banner.
  it('a facts-blocked mount does not spend the shot; the retry then attempts exactly once', async () => {
    grantConsent()
    mockDayFacts
      .mockImplementationOnce(async () => ({ ...DAY_FACTS, unavailable: true as const }))
      .mockImplementation(async () => factsWith({ remaining: 4 }))

    await renderPage()
    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(screen.getByText('recoverTicketUnknown')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('recoverTicketRetry'))
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })

    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })
})

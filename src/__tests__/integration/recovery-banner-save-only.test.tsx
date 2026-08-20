/**
 * @jest-environment jsdom
 *
 * PR-B1 — the recovery banner: save-only, informative, one action.
 *
 * The field lesson (⚖ 8/20): reaching this banner is a SYSTEM failure, and the
 * two amber strips it replaces each offered a 破棄 button next to a title that
 * never said WHOSE recording it was. So the contract this suite pins is
 * behavioural, not cosmetic:
 *   · exactly ONE action, and zero discard affordances, in BOTH variants;
 *   · no save reaches a writer without CURRENT consent (fail-closed, the same
 *     rule ReviewScreen's save-time gate enforces);
 *   · a take whose 結果 survived the crash saves with that outcome — which is
 *     what puts it in the existing autosave cohort instead of a review detour.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))

const mockSaveInline = jest.fn(async (_i: unknown) => ({ id: 'karute-1' }) as
  | { id: string }
  | { error: string })
jest.mock('@/actions/karute', () => ({
  saveKaruteRecord: jest.fn(),
  saveKaruteRecordInline: (i: unknown) => mockSaveInline(i),
}))

const DAY_FACTS = {
  date: '2026-08-18',
  bookings: [],
  packs: [] as { customerId: string; packId: string | null; remaining: number; size: number }[],
  redeemed: { appointmentIds: [] as string[], customerIds: [] as string[] },
}
const mockDayFacts = jest.fn(async (_i: unknown) => DAY_FACTS)
jest.mock('@/actions/recovery', () => ({
  getRecoveryDayFacts: (i: unknown) => mockDayFacts(i),
}))

// Consent: null = never granted → the gate must fail CLOSED. Overridden
// per-test with a current grant to exercise the happy path.
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

jest.mock('@/actions/packs', () => ({
  createPackAction: jest.fn(async () => ({ ok: true })),
  redeemSessionAction: jest.fn(async () => ({ ok: true, redemptionId: 'r1' })),
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
  // 2026-08-18 14:22 JST → 23 minutes long.
  startedAt: Date.parse('2026-08-18T05:22:00Z'),
  updatedAt: Date.parse('2026-08-18T05:45:00Z'),
  outcome: undefined as { status: string } | undefined,
  outcomeSkipped: undefined as boolean | undefined,
}
let offerTake = true
/** Per-test override of the offered take (e.g. an unbound walk-in one). Reset
 *  in afterEach — a mockResolvedValue would leak into every later test, since
 *  clearAllMocks clears CALLS, not implementations. */
let takeOverride: Record<string, unknown> | null = null
/** What take-store would hand back after a reload (F-2's durable draft seam). */
let stampedAnswer: Record<string, unknown> | null = null
const mockStampTakeOutcome = jest.fn(async () => {})
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: (...a: unknown[]) => mockStampTakeOutcome(...(a as [])),
  // F-2: a draft's answer now survives a reload through the take id it already
  // carries. `stampedAnswer` is what a REMOUNT would read back.
  readTakeOutcome: jest.fn(async () => stampedAnswer),
  getRecoverableTake: jest.fn(async () => (offerTake ? (takeOverride ?? TAKE) : null)),
  loadTakeBlob: jest.fn(async () => new Blob(['audio'])),
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
// F-4: the pipeline's CONTEXT is mutable so a test can make the offered take
// become the pipeline's own in-flight take — that is how activeOfferId changes
// while the component stays MOUNTED, which is the only way the abort effect can
// actually be observed (the old test unmounted, destroying the very state the
// effect exists to clean up).
let mockPipelineContext: { takeId?: string } | null = null
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    version: 0,
    state: 'idle',
    step: null,
    result: null,
    error: null,
    get context() {
      return mockPipelineContext
    },
    subscribe: () => () => {},
    start: (...a: unknown[]) => mockPipelineStart(...(a as [])),
    retry: jest.fn(),
    reset: jest.fn(),
  },
}))

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  RecordPageView,
  resolveRecoveryTicketState,
  type RecordPageViewProps,
} from '@/components/karute/redesign/record/RecordPageView'
import { PostSessionResolutionDialog } from '@/components/karute/redesign/record/PostSessionResolutionDialog'
import { RecordCustomerPickerDialog } from '@/components/karute/redesign/record/RecordCustomerPickerDialog'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

afterEach(() => {
  cleanup()
  jest.clearAllMocks()
  // clearAllMocks clears CALLS, not implementations — a helper that installed a
  // persistent mockResolvedValue (grantConsent below) would otherwise leak a
  // granted consent into every later test and silently skip the gate.
  mockGetCustomerConsent.mockReset()
  mockGetCustomerConsent.mockResolvedValue({ consent: null })
  mockSaveInline.mockReset()
  mockSaveInline.mockResolvedValue({ id: 'karute-1' })
  mockDayFacts.mockReset()
  mockDayFacts.mockImplementation(async () => DAY_FACTS)
  offerTake = true
  takeOverride = null
  stampedAnswer = null
  mockPipelineContext = null
  offerDraft = null
  TAKE.outcome = undefined
  TAKE.outcomeSkipped = undefined
  DAY_FACTS.packs = []
  DAY_FACTS.bookings = []
  DAY_FACTS.redeemed = { appointmentIds: [], customerIds: [] }
})

/** Pick an option in the 結果 popup and press 保存. Two separate act() blocks —
 *  RTL wraps each fireEvent in its own act, and the save button's enabled state
 *  only settles after the pick's commit. */
async function answerPopup(optionKey: string) {
  await act(async () => {
    fireEvent.click(screen.getByText(optionKey))
    await Promise.resolve()
  })
  await act(async () => {
    fireEvent.click(screen.getByText('save'))
    for (let i = 0; i < 14; i++) await Promise.resolve()
  })
}

function grantConsent() {
  mockGetCustomerConsent.mockResolvedValue({
    consent: {
      policy_version: RECORDING_CONSENT_POLICY_VERSION,
      granted_at: '2026-08-01T00:00:00Z',
    },
  })
}

async function renderPage(overrides: Partial<RecordPageViewProps> = {}) {
  // A FACTORY, not a cached element: React bails out of re-rendering a fiber
  // whose element is referentially identical, so reusing one would silently
  // no-op every rerenderSame() — and with it every mounted-abort assertion.
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
  const result = render(buildUi())
  // Flush the mount effects (draft + take load, then the day-facts fetch).
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
  return {
    ...result,
    /** Re-render the SAME props so a change to a mocked singleton (the
     *  pipeline's claimed take) is picked up WITHOUT unmounting — the only way
     *  the abort effect is observable (F-4). */
    rerenderSame: async () => {
      await act(async () => {
        result.rerender(buildUi())
        for (let i = 0; i < 6; i++) await Promise.resolve()
      })
    },
  }
}

/** The banner's own subtree — assertions must never accidentally count a
 *  button that belongs to the page behind it. */
function banner(): HTMLElement {
  return screen.getByText('recoverBannerTitle').closest('div.rounded-xl') as HTMLElement
}

describe('the banner offers ONE action and no way to destroy the recording', () => {
  it('take variant: 保存する only — no 破棄, no ✕', async () => {
    await renderPage()
    const buttons = within(banner()).getAllByRole('button')
    // 保存する + 変更 (the re-point link). Nothing else is pressable.
    expect(buttons.map((b) => b.textContent)).toEqual(['recoverRepoint', 'recoverSaveAction'])
    expect(screen.queryByText('recoverDiscard')).toBeNull()
    expect(screen.queryByText('recoverTakeAction')).toBeNull()
    expect(screen.queryByText('recoverAction')).toBeNull()
  })

  it('draft variant: same card, same single action', async () => {
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
    const buttons = within(banner()).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['recoverRepoint', 'recoverSaveAction'])
    expect(screen.queryByText('recoverDiscard')).toBeNull()
  })

  it('an UNBOUND take asks for a customer instead of a 保存先 row', async () => {
    takeOverride = { ...TAKE, target: null }
    await renderPage()
    expect(screen.getByText('recoverPickAndSaveAction')).toBeTruthy()
    expect(screen.queryByText('recoverDestination')).toBeNull()
    expect(screen.getByText('recoverCustomerUnset')).toBeTruthy()
  })

  it('shows the identity facts a staffer needs to trust the save', async () => {
    await renderPage()
    const b = within(banner())
    expect(b.getByText('recoverFieldCustomer')).toBeTruthy()
    expect(b.getByText('recoverFieldRecordedAt')).toBeTruthy()
    expect(b.getByText('recoverFieldLength')).toBeTruthy()
    // 録音者 = the signed-in staff (the take is owner-scoped by construction).
    expect(b.getByText('原')).toBeTruthy()
    // メニュー only when the bind-time snapshot actually carries one.
    expect(b.getByText('トリートメント')).toBeTruthy()
  })
})

describe('consent is fail-closed on BOTH recovery saves', () => {
  it('take save: an ungranted consent opens the gate and reaches no writer', async () => {
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'consentDialogTitle' })).toBeTruthy()
  })

  it('draft save: same gate, same silence at the writer', async () => {
    offerTake = false
    offerDraft = {
      transcript: 't',
      summary: 's',
      entries: [],
      duration: 60,
      appointmentId: 'appt-1',
      appointmentCustomerId: 'cust-1',
      savedAt: Date.now(),
    }
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect(mockSaveInline).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'consentDialogTitle' })).toBeTruthy()
  })

  it('an UNREADABLE consent read is treated as not granted', async () => {
    mockGetCustomerConsent.mockRejectedValueOnce(new Error('network'))
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'consentDialogTitle' })).toBeTruthy()
  })
})

describe('a take whose 結果 survived the crash saves without re-asking', () => {
  it('carries the restored outcome into the pipeline — the autosave cohort', async () => {
    grantConsent()
    TAKE.outcome = { status: 'success' }
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    // The popup must NOT open: its money legs already settled pre-crash.
    expect(screen.queryByText('save')).toBeNull()
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
    const ctx = mockPipelineStart.mock.calls[0][1] as Record<string, unknown>
    // isServerJobEligible (global-pipeline) = recordingSessionId AND
    // appointmentCustomerId AND (outcome OR outcomeSkipped). All three, or the
    // recovered take falls back to a review detour exactly as it used to.
    expect(ctx.recordingSessionId).toBe('sess-1')
    expect(ctx.appointmentCustomerId).toBe('cust-1')
    expect(ctx.outcome).toEqual({ status: 'success' })
    expect(ctx.appointmentId).toBe('appt-1')
  })

  it('a persisted SKIP also qualifies, and still asks nothing', async () => {
    grantConsent()
    TAKE.outcomeSkipped = true
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    const ctx = mockPipelineStart.mock.calls[0][1] as Record<string, unknown>
    expect(ctx.outcomeSkipped).toBe(true)
    expect(ctx.outcome).toBeUndefined()
  })

  it('with NO persisted answer the popup opens instead of a silent save', async () => {
    grantConsent()
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mockPipelineStart).not.toHaveBeenCalled()
    // The 結果 popup is up (its disclaimer is unique to it) and the record is
    // NOT saved behind the staffer's back.
    expect(screen.getByText('disclaimer')).toBeTruthy()
  })

  it('the popup is ANSWERABLE — its 保存 is not disabled by the banner’s own lock', async () => {
    grantConsent()
    // remaining 2 = 'repurchase' (REPURCHASE_PROMPT_REMAINING) — the mode that
    // still ASKS. remaining 4 would be 'auto', which A-6 now answers with the
    // silent burn leg and no dialog at all.
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    await act(async () => {
      // repurchase mode: the cards carry the repurchase.* copy keys.
      fireEvent.click(screen.getByText('repurchase.pending.title'))
      await Promise.resolve()
    })
    const save = screen.getByText('save') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(save)
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    // The answer moved the money (pre-ON toggle) and the record saved with it.
    const { redeemSessionAction } = jest.requireMock('@/actions/packs') as {
      redeemSessionAction: jest.Mock
    }
    expect(redeemSessionAction).toHaveBeenCalledTimes(1)
    expect(redeemSessionAction.mock.calls[0][0]).toMatchObject({
      packId: 'pack-1',
      customerId: 'cust-1',
      appointmentId: 'appt-1',
      // The burn belongs to the VISIT's day, and carries the D5/D7 flag.
      redeemedOn: '2026-08-18',
      recovery: true,
    })
    // A-3: the stamp lands AFTER the money legs, and carries skipped=false.
    expect(mockStampTakeOutcome).toHaveBeenCalledWith(
      'take-1',
      { status: 'pending', reason: null, isFirstVisit: false },
      false,
      // F-3: the stamp now carries WHICH legs settled.
      { burn: 'done', pack: 'none' },
    )
    expect(mockStampTakeOutcome.mock.invocationCallOrder[0]).toBeGreaterThan(
      (jest.requireMock('@/actions/packs') as { redeemSessionAction: jest.Mock })
        .redeemSessionAction.mock.invocationCallOrder[0],
    )
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
    expect((mockPipelineStart.mock.calls[0][1] as Record<string, unknown>).outcome).toMatchObject({
      status: 'pending',
    })
  })

  // A-3, the invariant a call-order assertion cannot reach: a stamp means the
  // money phase COMPLETED. Hold the burn open and the stamp must not exist yet
  // — otherwise an interruption in that window leaves a take that recovery
  // reads as already-resolved and never re-asks, over money that never moved.
  it('A-3: nothing is stamped while the burn is still in flight', async () => {
    grantConsent()
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    const packs = jest.requireMock('@/actions/packs') as { redeemSessionAction: jest.Mock }
    let settleBurn: (v: { ok: boolean }) => void = () => {}
    packs.redeemSessionAction.mockReturnValueOnce(
      new Promise((r) => {
        settleBurn = r
      }),
    )
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    await answerPopup('repurchase.pending.title')
    expect(packs.redeemSessionAction).toHaveBeenCalledTimes(1)
    expect(mockStampTakeOutcome).not.toHaveBeenCalled()
    expect(mockPipelineStart).not.toHaveBeenCalled()
    await act(async () => {
      settleBurn({ ok: true })
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mockStampTakeOutcome).toHaveBeenCalledTimes(1)
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })

  it('double-tapping the popup’s 保存 burns ONCE', async () => {
    grantConsent()
    // remaining 2 = 'repurchase' (REPURCHASE_PROMPT_REMAINING) — the mode that
    // still ASKS. remaining 4 would be 'auto', which A-6 now answers with the
    // silent burn leg and no dialog at all.
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('repurchase.pending.title'))
      await Promise.resolve()
    })
    const save = screen.getByText('save')
    // BOTH dispatches inside ONE act(): RTL wraps each fireEvent in its own
    // act, so two separate calls can never share a commit — and the race only
    // exists before the first tap's state update lands.
    await act(async () => {
      fireEvent.click(save)
      fireEvent.click(save)
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    const { redeemSessionAction } = jest.requireMock('@/actions/packs') as {
      redeemSessionAction: jest.Mock
    }
    expect(redeemSessionAction).toHaveBeenCalledTimes(1)
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })
})

describe('an unbound take: the picker IS the save’s first step', () => {
  it('選んで保存する → pick a day booking → the save continues to the writer', async () => {
    grantConsent()
    takeOverride = { ...TAKE, target: null }
    DAY_FACTS.bookings = [
      {
        id: 'appt-2',
        start: '13:00',
        end: '14:00',
        customer: '田中 花子',
        customerId: 'cust-2',
        initials: '田',
        karute: '#00071',
        service: 'トリートメント',
        staff: '原',
        staffId: 'staff-1',
        staffColorKey: null,
        statusKey: 'booked',
        statusLabel: '予約済',
      },
    ] as never
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverPickAndSaveAction'))
      for (let i = 0; i < 4; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('田中 花子'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    // No persisted answer → the 結果 popup, packed for the CHOSEN customer.
    expect(screen.getByText('disclaimer')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByText('pending.title'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('save'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    const ctx = mockPipelineStart.mock.calls[0][1] as Record<string, unknown>
    expect(ctx.appointmentCustomerId).toBe('cust-2')
    expect(ctx.appointmentId).toBe('appt-2')
  })
})

// ── D4: the popup states 消化済み instead of offering a second burn ─────────
describe('PostSessionResolutionDialog — alreadyRedeemed', () => {
  const base = {
    open: true,
    customerName: '佐藤 美咲',
    isFirstVisit: false,
    pack: { id: 'pack-1', remaining: 4, size: 6 },
    onResolve: jest.fn(),
    onCancel: jest.fn(),
  }

  it('renders a STATIC row and no toggle when the booking already burned', () => {
    render(<PostSessionResolutionDialog {...base} alreadyRedeemed />)
    expect(screen.getByText('redeemAlready')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('keeps the pre-ON toggle for every existing caller (⚖ 8/21 ③ untouched)', () => {
    render(<PostSessionResolutionDialog {...base} />)
    const sw = screen.getByRole('switch')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText('redeemAlready')).toBeNull()
  })

  it('never reports a burn from an alreadyRedeemed dialog', () => {
    const onResolve = jest.fn()
    render(<PostSessionResolutionDialog {...base} onResolve={onResolve} alreadyRedeemed />)
    // 後で決める: the one answer with no 新しい回数券 panel, so 保存 is enabled
    // on a single tap and the assertion is about the BURN, nothing else.
    fireEvent.click(screen.getByText('pending.title'))
    fireEvent.click(screen.getByText('save'))
    expect(onResolve).toHaveBeenCalledTimes(1)
    // arg 2 = redeemPack
    expect(onResolve.mock.calls[0][1]).toBe(false)
  })
})

// ── D2: the re-point picker is bounded to the recording's day ───────────────
describe('RecordCustomerPickerDialog — repoint variant', () => {
  const dayBooking = {
    id: 'appt-2',
    start: '13:00',
    end: '14:00',
    customer: '田中 花子',
    customerId: 'cust-2',
    initials: '田',
    karute: '#00071',
    service: 'トリートメント',
    staff: '原',
    staffId: 'staff-1',
    staffColorKey: null,
    statusKey: 'booked' as const,
    statusLabel: '予約済',
  }

  function renderRepoint(onSelectBooking = jest.fn(), onSelectCustomer = jest.fn()) {
    render(
      <RecordCustomerPickerDialog
        variant="repoint"
        customers={[
          { id: 'cust-9', name: '来店していないお客様' } as never,
          { id: 'cust-2', name: '田中 花子' } as never,
        ]}
        bookings={[dayBooking]}
        facts={[{ id: 'cust-2', pack: { remaining: 4, size: 6 } }]}
        pinned={{ customerId: 'cust-1', name: '佐藤 美咲', karuteNumber: '#00058' }}
        dayLabel="8月18日(月)"
        cancelLabel="cancel"
        onSelectBooking={onSelectBooking}
        onSelectCustomer={onSelectCustomer}
        onClose={jest.fn()}
      />,
    )
    return { onSelectBooking, onSelectCustomer }
  }

  it('lists the recording day’s bookings and pins the original customer', () => {
    renderRepoint()
    expect(screen.getByText('田中 花子')).toBeTruthy()
    expect(screen.getByText('佐藤 美咲')).toBeTruthy()
    expect(screen.getByText('target.repointCurrent')).toBeTruthy()
  })

  it('has NO search box — a customer who was not in the salon that day is unreachable', () => {
    renderRepoint()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText('来店していないお客様')).toBeNull()
  })

  it('selecting a day booking re-points to THAT booking', () => {
    const { onSelectBooking } = renderRepoint()
    fireEvent.click(screen.getByText('田中 花子'))
    expect(onSelectBooking).toHaveBeenCalledWith(dayBooking)
  })

  it('the record variant is untouched: search box present', () => {
    render(
      <RecordCustomerPickerDialog
        customers={[]}
        bookings={[dayBooking]}
        onSelectBooking={jest.fn()}
        onSelectCustomer={jest.fn()}
        onClose={jest.fn()}
        cancelLabel="cancel"
      />,
    )
    expect(screen.getByRole('combobox')).toBeTruthy()
  })
})

// ── D4: the 回数券 line is DERIVED truth, or silence ────────────────────────
describe('resolveRecoveryTicketState', () => {
  const facts = (over: Partial<Parameters<typeof resolveRecoveryTicketState>[0]['facts'] & object> = {}) =>
    ({
      date: '2026-08-18',
      bookings: [],
      packs: [{ customerId: 'c1', packId: 'p1', remaining: 4, size: 6 }],
      redeemed: { appointmentIds: [], customerIds: [] },
      ...over,
    }) as NonNullable<Parameters<typeof resolveRecoveryTicketState>[0]['facts']>

  it('booked + a live redemption on that appointment → 消化済み', () => {
    const r = resolveRecoveryTicketState({
      facts: facts({ redeemed: { appointmentIds: ['a1'], customerIds: [] } }),
      customerId: 'c1',
      appointmentId: 'a1',
    })
    expect(r.state).toBe('redeemed')
    expect(r.packId).toBe('p1')
  })

  it('unbooked + a burn for that customer that day → 消化済み (same key D5 writes)', () => {
    const r = resolveRecoveryTicketState({
      facts: facts({ redeemed: { appointmentIds: [], customerIds: ['c1'] } }),
      customerId: 'c1',
      appointmentId: null,
    })
    expect(r.state).toBe('redeemed')
  })

  it('a pack with nothing burned → 未処理', () => {
    expect(
      resolveRecoveryTicketState({ facts: facts(), customerId: 'c1', appointmentId: 'a1' }).state,
    ).toBe('unresolved')
  })

  it('no pack → the line is omitted, never a guess', () => {
    expect(
      resolveRecoveryTicketState({ facts: facts(), customerId: 'c-nopack', appointmentId: 'a1' })
        .state,
    ).toBe('none')
  })

  it('an UNREADABLE burn history says NOTHING — never a calm-looking 未処理', () => {
    const r = resolveRecoveryTicketState({
      facts: facts({ redeemed: null }),
      customerId: 'c1',
      appointmentId: 'a1',
    })
    expect(r.state).toBe('none')
    // The pack itself is still known — it is the BURN that is unknown.
    expect(r.pack).toEqual({ remaining: 4, size: 6 })
  })

  // A-2 (client half): a prior NULL-appointment burn for the same customer-day
  // must read 消化済み even for a BOOKED destination. Keying on the appointment
  // alone let the banner say 未処理 over a ticket that had already moved.
  it('a booked destination still reads 消化済み off a customer-day burn', () => {
    const r = resolveRecoveryTicketState({
      facts: facts({ redeemed: { appointmentIds: [], customerIds: ['c1'] } }),
      customerId: 'c1',
      appointmentId: 'a1',
    })
    expect(r.state).toBe('redeemed')
  })

  // T-8: the two sets are asymmetric ON PURPOSE. customerIds is filtered to the
  // recording day; appointmentIds is not, because a redemption keyed to THIS
  // appointment is this visit's burn whatever calendar day it was dated to
  // (a late reconcile, a cron pass after midnight).
  it('an appointment-keyed burn dated to another day still reads 消化済み', () => {
    const r = resolveRecoveryTicketState({
      facts: facts({ redeemed: { appointmentIds: ['a1'], customerIds: [] } }),
      customerId: 'c1',
      appointmentId: 'a1',
    })
    expect(r.state).toBe('redeemed')
  })
})

// ── A-6: mid-pack customers never see the conversion question ──────────────
describe('auto mode parity (A-6)', () => {
  it('burns silently and saves — no dialog, no outcome row', async () => {
    grantConsent()
    // >2 sessions left = resolveOutcomeMode 'auto': no conversion conversation
    // happened, so asking would pollute the coaching labels the live stop flow
    // protects by burning silently.
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }]
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(screen.queryByText('disclaimer')).toBeNull()
    const { redeemSessionAction } = jest.requireMock('@/actions/packs') as {
      redeemSessionAction: jest.Mock
    }
    expect(redeemSessionAction).toHaveBeenCalledTimes(1)
    expect(redeemSessionAction.mock.calls[0][0]).toMatchObject({
      packId: 'pack-1',
      redeemedOn: '2026-08-18',
      recovery: true,
    })
    const ctx = mockPipelineStart.mock.calls[0][1] as Record<string, unknown>
    expect(ctx.outcome).toBeUndefined()
    expect(ctx.outcomeSkipped).toBe(true)
    // A-3: the stamp certifies the money phase, so it carries skipped=true.
    expect(mockStampTakeOutcome).toHaveBeenCalledWith('take-1', undefined, true, {
      burn: 'done',
      pack: 'none',
    })
  })

  it('an ALREADY-burned auto customer does not burn again', async () => {
    grantConsent()
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }]
    DAY_FACTS.redeemed = { appointmentIds: ['appt-1'], customerIds: [] }
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    const { redeemSessionAction } = jest.requireMock('@/actions/packs') as {
      redeemSessionAction: jest.Mock
    }
    expect(redeemSessionAction).not.toHaveBeenCalled()
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })
})

// ── T-1: alreadyRedeemed, wired end to end through the page ────────────────
describe('alreadyRedeemed wiring (T-1)', () => {
  it('a burned booking reaches the popup as a static row and burns nothing', async () => {
    grantConsent()
    // remaining 2 → repurchase, so the dialog still opens (auto would not).
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    DAY_FACTS.redeemed = { appointmentIds: ['appt-1'], customerIds: [] }
    await renderPage()
    // The banner states it too.
    expect(screen.getByText('recoverTicketRedeemedCount')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(screen.getByText('redeemAlready')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByText('repurchase.pending.title'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('save'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    const { redeemSessionAction } = jest.requireMock('@/actions/packs') as {
      redeemSessionAction: jest.Mock
    }
    expect(redeemSessionAction).not.toHaveBeenCalled()
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })
})

// ── T-2: the bound re-point, end to end ────────────────────────────────────
const OTHER_BOOKING = {
  id: 'appt-2',
  start: '13:00',
  end: '14:00',
  customer: '田中 花子',
  customerId: 'cust-2',
  initials: '田',
  karute: '#00071',
  service: 'カット',
  staff: '原',
  staffId: 'staff-1',
  staffColorKey: null,
  statusKey: 'booked',
  statusLabel: '予約済',
}

describe('bound re-point (T-2)', () => {
  it('変更 → another booking → 保存 lands on the NEW customer and booking', async () => {
    grantConsent()
    DAY_FACTS.bookings = [OTHER_BOOKING] as never
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverRepoint'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('田中 花子'))
      // The re-point re-fetches the day's facts for the NEW destination, and
      // 保存する stays disabled until they land (A-5 + A-4).
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    // A re-point alone must NOT save — the staffer still has to press 保存する.
    expect(mockPipelineStart).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    // cust-2 holds no pack → conversion mode → the question is asked.
    await answerPopup('pending.title')
    const ctx = mockPipelineStart.mock.calls[0][1] as Record<string, unknown>
    expect(ctx.appointmentCustomerId).toBe('cust-2')
    expect(ctx.appointmentId).toBe('appt-2')
    // The consent gate ran for the NEW customer, not the original.
    expect(mockGetCustomerConsent).toHaveBeenLastCalledWith('cust-2')
  })

  // B-3: after a re-point the picker must stop telling the staffer the save
  // goes to the original — the badge marks where it ACTUALLY goes.
  it('the 現在の保存先 badge moves to the re-pointed booking', async () => {
    grantConsent()
    DAY_FACTS.bookings = [OTHER_BOOKING] as never
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverRepoint'))
      await Promise.resolve()
    })
    // Before: the pinned original wears it.
    expect(
      screen.getByText('target.repointCurrent').closest('button')!.textContent,
    ).toContain('佐藤 美咲')
    await act(async () => {
      fireEvent.click(screen.getByText('田中 花子'))
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('recoverRepoint'))
      await Promise.resolve()
    })
    // After: the booking does.
    const badged = screen.getByText('target.repointCurrent').closest('button')!
    expect(badged.textContent).toContain('田中 花子')
    expect(badged.textContent).not.toContain('佐藤 美咲')
  })

  it('the pinned row reverts to the original binding', async () => {
    grantConsent()
    DAY_FACTS.bookings = [OTHER_BOOKING] as never
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverRepoint'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('田中 花子'))
      // The re-point re-fetches the day's facts for the NEW destination, and
      // 保存する stays disabled until they land (A-5 + A-4).
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('recoverRepoint'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('佐藤 美咲'))
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    await answerPopup('pending.title')
    const ctx = mockPipelineStart.mock.calls[0][1] as Record<string, unknown>
    expect(ctx.appointmentCustomerId).toBe('cust-1')
    expect(ctx.appointmentId).toBe('appt-1')
  })
})

// ── T-3: the latch always comes back ───────────────────────────────────────
describe('latch release (T-3)', () => {
  it('cancelling the outcome popup re-enables 保存する', async () => {
    grantConsent()
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('cancel'))
      await Promise.resolve()
    })
    const save = screen.getByText('recoverSaveAction') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    // And a SECOND attempt genuinely proceeds.
    await act(async () => {
      fireEvent.click(save)
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(screen.getByText('disclaimer')).toBeTruthy()
  })

  it('cancelling the consent dialog re-enables 保存する', async () => {
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(screen.getByRole('dialog', { name: 'consentDialogTitle' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getAllByText('cancel')[0])
      await Promise.resolve()
    })
    expect((screen.getByText('recoverSaveAction') as HTMLButtonElement).disabled).toBe(false)
  })
})

// ── T-5 + A-4: the draft path, and what a failed save must NOT cost ────────
describe('draft save (T-5) and the per-offer answer latch (A-4)', () => {
  const DRAFT = {
    transcript: 't',
    summary: 's',
    entries: [
      { category: 'SYMPTOM', content: '肩こり', sourceQuote: 'q', confidenceScore: 0.9 },
    ],
    duration: 1380,
    appointmentId: 'appt-1',
    appointmentCustomerId: 'cust-1',
    recordingSessionId: 'sess-1',
    takeId: 'take-1',
    savedAt: Date.parse('2026-08-18T05:45:00Z'),
  }

  it('happy path: mapped entries reach the inline save, then the draft settles', async () => {
    grantConsent()
    offerTake = false
    offerDraft = { ...DRAFT }
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('pending.title'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('save'))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mockSaveInline).toHaveBeenCalledTimes(1)
    expect(mockSaveInline.mock.calls[0][0]).toMatchObject({
      customerId: 'cust-1',
      appointmentId: 'appt-1',
      recordingSessionId: 'sess-1',
      entries: [
        { category: 'SYMPTOM', content: '肩こり', sourceQuote: 'q', confidenceScore: 0.9 },
      ],
    })
    const { clearDraft } = jest.requireMock('@/lib/karute/draft') as { clearDraft: jest.Mock }
    const { deleteTake } = jest.requireMock('@/lib/karute/take-store') as {
      deleteTake: jest.Mock
    }
    expect(clearDraft).toHaveBeenCalled()
    expect(deleteTake).toHaveBeenCalledWith('take-1')
  })

  it('A-4: a retry after a FAILED save never mints a second pack sale', async () => {
    grantConsent()
    offerTake = false
    offerDraft = { ...DRAFT }
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    mockSaveInline.mockResolvedValueOnce({ error: 'boom' })
    // A preset prefills the 新しい回数券 panel, so 成約 can actually submit —
    // that combination (a burn AND a pack sale) is the one A-4 protects.
    await renderPage({ packPresets: [{ size: 10, unitPrice: 9900 }] })
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    await answerPopup('repurchase.success.title')
    const packs = jest.requireMock('@/actions/packs') as {
      createPackAction: jest.Mock
      redeemSessionAction: jest.Mock
    }
    expect(mockSaveInline).toHaveBeenCalledTimes(1)
    const firstCreates = packs.createPackAction.mock.calls.length
    const firstRedeems = packs.redeemSessionAction.mock.calls.length
    // The offer SURVIVES a failed save, so the staffer can retry.
    const retry = screen.getByText('recoverSaveAction') as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(retry)
      for (let i = 0; i < 14; i++) await Promise.resolve()
    })
    // The retry saved again — and moved NO money a second time, and never
    // re-opened the question.
    expect(mockSaveInline).toHaveBeenCalledTimes(2)
    expect(packs.createPackAction.mock.calls.length).toBe(firstCreates)
    expect(packs.redeemSessionAction.mock.calls.length).toBe(firstRedeems)
    expect(screen.queryByText('disclaimer')).toBeNull()
  })

  it('B-2: a THROWN inline save is caught, not left as a wedged latch', async () => {
    grantConsent()
    offerTake = false
    offerDraft = { ...DRAFT }
    mockSaveInline.mockRejectedValueOnce(new Error('network'))
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('pending.title'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('save'))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect((screen.getByText('recoverSaveAction') as HTMLButtonElement).disabled).toBe(false)
  })

  it('B-1: a draft whose customer left the cached list is still BOUND', async () => {
    grantConsent()
    offerTake = false
    offerDraft = { ...DRAFT, appointmentCustomerId: 'cust-gone' }
    await renderPage()
    // Bound → the save action, the 保存先 row, never the picker prompt.
    expect(screen.getByText('recoverSaveAction')).toBeTruthy()
    expect(screen.queryByText('recoverPickAndSaveAction')).toBeNull()
    expect(screen.getByText('recoverDestination')).toBeTruthy()
    expect(screen.getAllByText('recoverCustomerUnknown').length).toBeGreaterThan(0)
  })
})

// ── A-5: the day's money truth gates the save ──────────────────────────────
describe('dayFacts tri-state (A-5)', () => {
  it('保存する is disabled until the facts land', async () => {
    grantConsent()
    let release: (v: typeof DAY_FACTS) => void = () => {}
    mockDayFacts.mockReturnValueOnce(
      new Promise<typeof DAY_FACTS>((r) => {
        release = r
      }),
    )
    await renderPage()
    expect((screen.getByText('recoverSaveAction') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      release(DAY_FACTS)
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect((screen.getByText('recoverSaveAction') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a FAILED read says so, blocks the save, and offers a retry that recovers', async () => {
    grantConsent()
    mockDayFacts.mockResolvedValueOnce({ ...DAY_FACTS, unavailable: true } as never)
    await renderPage()
    expect(screen.getByText('recoverTicketUnknown')).toBeTruthy()
    expect((screen.getByText('recoverSaveAction') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByText('recoverTicketRetry'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(screen.queryByText('recoverTicketUnknown')).toBeNull()
    expect((screen.getByText('recoverSaveAction') as HTMLButtonElement).disabled).toBe(false)
  })

  it('tickets OFF: a failed read never strands the record', async () => {
    grantConsent()
    mockDayFacts.mockResolvedValueOnce({ ...DAY_FACTS, unavailable: true } as never)
    await renderPage({ ticketsEnabled: false })
    expect((screen.getByText('recoverSaveAction') as HTMLButtonElement).disabled).toBe(false)
  })
})

// ── A-7: an unbound take is always landable ────────────────────────────────
describe('unbound takes stay landable (A-7)', () => {
  it('an EMPTY day still offers the customer search', async () => {
    grantConsent()
    takeOverride = { ...TAKE, target: null }
    DAY_FACTS.bookings = []
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverPickAndSaveAction'))
      await Promise.resolve()
    })
    const box = screen.getByRole('combobox')
    expect(box).toBeTruthy()
    await act(async () => {
      fireEvent.change(box, { target: { value: '佐藤' } })
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('佐藤 美咲'))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    // Picked → the save continues, with no booking invented.
    expect(mockGetCustomerConsent).toHaveBeenLastCalledWith('cust-1')
  })

  it('a BOUND take keeps the search box OFF — the day restriction stands', async () => {
    grantConsent()
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverRepoint'))
      await Promise.resolve()
    })
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

// ── A-1 / F-4 / F-5 / F-6: the flow freezes, and the abort actually aborts ──
describe('the flow freezes its offer (A-1) and the abort really aborts', () => {
  // F-4: the previous version of this test called rerender(<div />), which
  // UNMOUNTS RecordPageView — flowRef and every piece of state the effect
  // exists to clean up die with it, so the assertion held whether the effect
  // ran or not. The verifier disabled the effect entirely and 4,945 tests
  // stayed green. This one keeps the component mounted and moves the OFFER out
  // from under the live flow, which is the real production sequence.
  it('F-4: an offer claimed mid-flow closes the dialogs and frees the latch, MOUNTED', async () => {
    grantConsent()
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    const { rerenderSame } = await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(screen.getByText('disclaimer')).toBeTruthy()

    // The pipeline claims this take (a new recording handed off) — the offer
    // is gone while the component is very much still on screen.
    mockPipelineContext = { takeId: 'take-1' }
    await rerenderSame()

    // The popup bound to the dead offer is gone, the banner with it, and the
    // latch is released rather than wedged forever.
    expect(screen.queryByText('disclaimer')).toBeNull()
    expect(screen.queryByText('recoverBannerTitle')).toBeNull()
    // Bring the offer back: the banner returns ready, not mid-flow.
    mockPipelineContext = null
    await rerenderSame()
    expect((screen.getByText('recoverSaveAction') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('disclaimer')).toBeNull()
  })

  // F-5: the abort used to tear down the UI while the awaited chain sailed on —
  // re-opening a popup for a dead offer, or moving money for a flow nobody was
  // watching any more.
  it('F-5: an offer that dies during the consent read moves no money and opens nothing', async () => {
    let releaseConsent: (v: { consent: null }) => void = () => {}
    mockGetCustomerConsent.mockReturnValueOnce(
      new Promise((r) => {
        releaseConsent = r as (v: { consent: null }) => void
      }) as never,
    )
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }]
    const { rerenderSame } = await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 4; i++) await Promise.resolve()
    })
    // Offer dies while the consent read is still in flight.
    mockPipelineContext = { takeId: 'take-1' }
    await rerenderSame()
    await act(async () => {
      releaseConsent({ consent: null })
      for (let i = 0; i < 14; i++) await Promise.resolve()
    })
    const packs = jest.requireMock('@/actions/packs') as { redeemSessionAction: jest.Mock }
    // No auto-burn for an abandoned flow, no consent dialog resurrected, and
    // nothing handed to the pipeline.
    expect(packs.redeemSessionAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'consentDialogTitle' })).toBeNull()
    expect(mockPipelineStart).not.toHaveBeenCalled()
  })

  // F-6: the deferred start is not a flow, so the abort's flow branch skipped
  // it — and it fired a save the staffer never re-authorised once the offer
  // came back. The picker re-opened itself for the same reason.
  it('F-6: a pending deferred start is cancelled when the offer goes away', async () => {
    grantConsent()
    takeOverride = { ...TAKE, target: null }
    DAY_FACTS.bookings = [OTHER_BOOKING] as never
    // Hold the post-pick refetch open so the deferred start is still waiting.
    let releaseFacts: (v: typeof DAY_FACTS) => void = () => {}
    const { rerenderSame } = await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverPickAndSaveAction'))
      await Promise.resolve()
    })
    mockDayFacts.mockReturnValueOnce(
      new Promise<typeof DAY_FACTS>((r) => {
        releaseFacts = r
      }),
    )
    await act(async () => {
      fireEvent.click(screen.getByText('田中 花子'))
      for (let i = 0; i < 4; i++) await Promise.resolve()
    })
    // Offer dies while the pending start waits on its facts.
    mockPipelineContext = { takeId: 'take-1' }
    await rerenderSame()
    await act(async () => {
      releaseFacts(DAY_FACTS)
      for (let i = 0; i < 14; i++) await Promise.resolve()
    })
    expect(mockGetCustomerConsent).not.toHaveBeenCalled()
    expect(mockPipelineStart).not.toHaveBeenCalled()
    // And when the offer returns, nothing fires by itself and no picker pops.
    mockPipelineContext = null
    await rerenderSame()
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(mockGetCustomerConsent).not.toHaveBeenCalled()
    expect(screen.queryByText('target.repointTitle')).toBeNull()
  })

  it('an unreadable take SAYS SO instead of eating the tap', async () => {
    grantConsent()
    const store = jest.requireMock('@/lib/karute/take-store') as { loadTakeBlob: jest.Mock }
    store.loadTakeBlob.mockResolvedValueOnce(new Blob([]))
    TAKE.outcome = { status: 'success' }
    const { toast } = jest.requireMock('sonner') as { toast: { error: jest.Mock } }
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('recoverSaveFailed')
  })
})


// ── F-1: the searched customer's 回数券 must reach the save ─────────────────
describe('a search-re-pointed customer keeps their pack (F-1)', () => {
  it('the second fetch carries the DESTINATION, and the auto leg burns', async () => {
    grantConsent()
    takeOverride = { ...TAKE, target: null }
    DAY_FACTS.bookings = []
    // Call 1 (unbound, no destination yet): the day has nothing to say.
    // Call 2 (after the search pick): the destination's pack appears — which
    // only happens because the request now carries their id.
    mockDayFacts.mockImplementationOnce(async () => ({
      ...DAY_FACTS,
      packs: [],
    }))
    mockDayFacts.mockImplementationOnce(async () => ({
      ...DAY_FACTS,
      packs: [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }],
    }))
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverPickAndSaveAction'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '佐藤' } })
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('佐藤 美咲'))
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })

    // (a) both ids ride the request — the original binding (null here) AND the
    // destination. Identical args across the two calls was the whole bug.
    const second = mockDayFacts.mock.calls[1][0] as { pinnedCustomerIds?: unknown[] }
    expect(second.pinnedCustomerIds).toContain('cust-1')

    // (b) remaining 4 = 'auto' → the silent burn leg, NOT the conversion popup.
    // The probe scenario (zero burns + popup open) must be unreachable.
    const packs = jest.requireMock('@/actions/packs') as { redeemSessionAction: jest.Mock }
    expect(screen.queryByText('disclaimer')).toBeNull()
    expect(packs.redeemSessionAction).toHaveBeenCalledTimes(1)
    expect(packs.redeemSessionAction.mock.calls[0][0]).toMatchObject({
      packId: 'pack-1',
      customerId: 'cust-1',
      recovery: true,
    })
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })
})

// ── F-2: a draft's answer survives a reload ────────────────────────────────
describe('draft answers are durable (F-2)', () => {
  const DRAFT2 = {
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

  it('the answer is stamped THROUGH the draft’s take id', async () => {
    grantConsent()
    offerTake = false
    offerDraft = { ...DRAFT2 }
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    await answerPopup('repurchase.pending.title')
    expect(mockStampTakeOutcome).toHaveBeenCalledWith(
      'take-1',
      expect.objectContaining({ status: 'pending' }),
      false,
      { burn: 'done', pack: 'none' },
    )
  })

  it('after a RELOAD the retry goes straight to the save — no second pack sale', async () => {
    grantConsent()
    offerTake = false
    offerDraft = { ...DRAFT2 }
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    mockSaveInline.mockResolvedValueOnce({ error: 'boom' })
    await renderPage({ packPresets: [{ size: 10, unitPrice: 9900 }] })
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    await answerPopup('repurchase.success.title')
    const packs = jest.requireMock('@/actions/packs') as {
      createPackAction: jest.Mock
      redeemSessionAction: jest.Mock
    }
    expect(packs.createPackAction).toHaveBeenCalledTimes(1)
    expect(mockSaveInline).toHaveBeenCalledTimes(1)

    // THE RELOAD. Everything in memory is gone; only what was stamped survives.
    cleanup()
    stampedAnswer = {
      outcome: { status: 'success', reason: null, isFirstVisit: false },
      outcomeSkipped: false,
      outcomeLegs: { burn: 'done', pack: 'done' },
    }
    await renderPage({ packPresets: [{ size: 10, unitPrice: 9900 }] })
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    // Straight to the save: no popup, and — the money defect the probe caught —
    // still exactly ONE pack sale for this customer.
    expect(screen.queryByText('disclaimer')).toBeNull()
    expect(packs.createPackAction).toHaveBeenCalledTimes(1)
    expect(mockSaveInline).toHaveBeenCalledTimes(2)
  })
})

// ── F-3: certify per leg, and only on settled money ────────────────────────
describe('per-leg certification (F-3)', () => {
  function packsMock() {
    return jest.requireMock('@/actions/packs') as {
      createPackAction: jest.Mock
      redeemSessionAction: jest.Mock
    }
  }

  it('a TRANSIENT burn failure certifies nothing, keeps the banner, and retries only that leg', async () => {
    grantConsent()
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    const packs = packsMock()
    packs.redeemSessionAction.mockRejectedValueOnce(new Error('network'))
    await renderPage({ packPresets: [{ size: 10, unitPrice: 9900 }] })
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    await answerPopup('repurchase.success.title')

    // Pack sale landed; burn did not. Nothing saved, banner still there.
    expect(packs.createPackAction).toHaveBeenCalledTimes(1)
    expect(mockPipelineStart).not.toHaveBeenCalled()
    const retry = screen.getByText('recoverSaveAction') as HTMLButtonElement
    expect(retry.disabled).toBe(false)
    // The stamp records the SPLIT, so the retry knows what is left.
    expect(mockStampTakeOutcome).toHaveBeenLastCalledWith(
      'take-1',
      expect.anything(),
      false,
      { burn: 'pending', pack: 'done' },
    )

    await act(async () => {
      fireEvent.click(retry)
      for (let i = 0; i < 18; i++) await Promise.resolve()
    })
    // ONLY the burn re-ran. No second sale, no popup, and now it saves.
    expect(packs.createPackAction).toHaveBeenCalledTimes(1)
    expect(packs.redeemSessionAction).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('disclaimer')).toBeNull()
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })

  it('guard_unavailable says so honestly and certifies nothing', async () => {
    grantConsent()
    // remaining 4 → the auto leg, where the misleading 消化済み was worst.
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }]
    const packs = packsMock()
    packs.redeemSessionAction.mockResolvedValueOnce({ ok: false, error: 'guard_unavailable' })
    const { toast } = jest.requireMock('sonner') as {
      toast: { error: jest.Mock; info: jest.Mock }
    }
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 14; i++) await Promise.resolve()
    })
    // Its own message — never 消化済み, which is what used to be shown.
    expect(toast.error).toHaveBeenCalledWith('recoverBurnCheckFailed')
    expect(toast.info).not.toHaveBeenCalledWith('recoverAlreadyRedeemed')
    // Nothing certified, nothing saved, and the burn is still owed.
    expect(mockStampTakeOutcome).toHaveBeenLastCalledWith('take-1', undefined, true, {
      burn: 'pending',
      pack: 'none',
    })
    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect((screen.getByText('recoverSaveAction') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a PROVABLE already_redeemed certifies the leg and saves', async () => {
    grantConsent()
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }]
    packsMock().redeemSessionAction.mockResolvedValueOnce({
      ok: false,
      error: 'already_redeemed',
    })
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 14; i++) await Promise.resolve()
    })
    // Retrying cannot change it, so the leg is finished — and the record saves.
    expect(mockStampTakeOutcome).toHaveBeenLastCalledWith('take-1', undefined, true, {
      burn: 'done',
      pack: 'none',
    })
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })
})


// ── The two guards the first round-2 red-run pass could not reach ──────────
describe('deferred start + abort, at the edges', () => {
  // F-1b: with tickets OFF, factsBlockSave is always false — so gating the
  // deferred start on it (instead of on facts FRESHNESS) starts the flow
  // against the pre-pick facts. The destination would be right but its picker
  // rows and pack row would be another customer's.
  it('tickets OFF: the deferred start still waits for the destination’s facts', async () => {
    grantConsent()
    takeOverride = { ...TAKE, target: null }
    DAY_FACTS.bookings = []
    mockDayFacts.mockImplementationOnce(async () => ({ ...DAY_FACTS, packs: [] }))
    let releaseSecond: (v: typeof DAY_FACTS) => void = () => {}
    mockDayFacts.mockReturnValueOnce(
      new Promise<typeof DAY_FACTS>((r) => {
        releaseSecond = r
      }),
    )
    await renderPage({ ticketsEnabled: false })
    await act(async () => {
      fireEvent.click(screen.getByText('recoverPickAndSaveAction'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '佐藤' } })
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('佐藤 美咲'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    // The second fetch is still open: nothing may have started yet.
    expect(mockGetCustomerConsent).not.toHaveBeenCalled()
    await act(async () => {
      releaseSecond(DAY_FACTS)
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    expect(mockGetCustomerConsent).toHaveBeenCalledWith('cust-1')
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })

  // F-5: the abort landing DURING the money legs. The legs are already in
  // flight, so they settle and are certified (certify-then-bail) — but the
  // record must NOT be handed to the pipeline, because the take now belongs to
  // a live recording.
  it('an offer claimed during the money legs certifies them but saves nothing', async () => {
    grantConsent()
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 2, size: 6 }]
    const packs = jest.requireMock('@/actions/packs') as { redeemSessionAction: jest.Mock }
    let settleBurn: (v: { ok: boolean }) => void = () => {}
    packs.redeemSessionAction.mockReturnValueOnce(
      new Promise((r) => {
        settleBurn = r
      }),
    )
    const { rerenderSame } = await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('repurchase.pending.title'))
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('save'))
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    // The pipeline claims the take while the burn is still in flight.
    mockPipelineContext = { takeId: 'take-1' }
    await rerenderSame()
    await act(async () => {
      settleBurn({ ok: true })
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    // Certified (the money DID move, so a later retry must not repeat it)…
    expect(mockStampTakeOutcome).toHaveBeenCalledTimes(1)
    // …but never handed to the pipeline, which is now busy with a live take.
    expect(mockPipelineStart).not.toHaveBeenCalled()
  })
})

export {}

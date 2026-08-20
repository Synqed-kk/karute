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
  undoRedemptionAction: jest.fn(),
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
const mockStampTakeOutcome = jest.fn(async () => {})
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: (...a: unknown[]) => mockStampTakeOutcome(...(a as [])),
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
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    version: 0,
    state: 'idle',
    step: null,
    result: null,
    error: null,
    context: null,
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
  offerTake = true
  takeOverride = null
  offerDraft = null
  TAKE.outcome = undefined
  TAKE.outcomeSkipped = undefined
  DAY_FACTS.packs = []
  DAY_FACTS.bookings = []
  DAY_FACTS.redeemed = { appointmentIds: [], customerIds: [] }
})

function grantConsent() {
  mockGetCustomerConsent.mockResolvedValue({
    consent: {
      policy_version: RECORDING_CONSENT_POLICY_VERSION,
      granted_at: '2026-08-01T00:00:00Z',
    },
  })
}

async function renderPage(overrides: Partial<RecordPageViewProps> = {}) {
  const result = render(
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
    />,
  )
  // Flush the mount effects (draft + take load, then the day-facts fetch).
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
  return result
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
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }]
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('pending.title'))
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
    expect(mockStampTakeOutcome).toHaveBeenCalledWith('take-1', { status: 'pending', reason: null, isFirstVisit: false })
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
    expect((mockPipelineStart.mock.calls[0][1] as Record<string, unknown>).outcome).toMatchObject({
      status: 'pending',
    })
  })

  it('double-tapping the popup’s 保存 burns ONCE', async () => {
    grantConsent()
    DAY_FACTS.packs = [{ customerId: 'cust-1', packId: 'pack-1', remaining: 4, size: 6 }]
    await renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('recoverSaveAction'))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(screen.getByText('pending.title'))
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
})

export {}

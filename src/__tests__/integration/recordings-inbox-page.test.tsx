/**
 * @jest-environment jsdom
 *
 * 録音履歴 on the record page (Build F1) — the wiring, end to end.
 *
 * The fold itself is pinned in recordings-inbox-derivation.test.ts. What this
 * suite proves is the part a unit test cannot: that a row's ONE action does the
 * thing it says, on the right take.
 *
 *   · MULTI-TAKE — two recoverable takes are two rows, and 保存する on the
 *     OLDER one saves THAT take. Before F1 the recovery banner offered only the
 *     newest, and everything behind it was lost to the TTL in silence.
 *   · 確認待ち DECAY — 確認する settles the take, so the row falls back to
 *     保存済み and the 要対応 count drops. A badge that cannot reach zero is
 *     worse than no badge.
 *   · 再試行 GATING — offered only while the audio is still on the device.
 *   · A FAILED SERVER READ says so instead of rendering a clean, short list.
 */
jest.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => (ns ? `${ns}.${key}` : key),
}))
const mockPush = jest.fn()
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
// P5-A: RecordPageView imports the written-reason discard action; unmocked it
// pulls the ESM SDK into this suite. Not exercised here.
jest.mock('@/actions/recording-discard', () => ({ discardRecordingWithReason: jest.fn() }))
jest.mock('@/actions/karute', () => ({
  saveKaruteRecord: jest.fn(),
  saveKaruteRecordInline: jest.fn(async () => ({ id: 'karute-1' })),
}))
jest.mock('@/actions/recording-discards', () => ({
  myDiscardCountThisMonth: jest.fn(async () => null),
  listDiscardReasons: jest.fn(async () => ({ ok: false, error: 'forbidden' })),
}))
jest.mock('@/actions/recovery', () => ({
  getRecoveryDayFacts: jest.fn(async () => ({
    date: '2026-08-25',
    bookings: [],
    packs: [],
    redeemed: { appointmentIds: [], customerIds: [] },
  })),
}))
jest.mock('@/actions/customers', () => ({
  // CURRENT consent, on the REAL policy version — the save gate fails closed on
  // a stale one, which would silently divert every save below into the grant
  // dialog instead of the writer.
  getCustomerConsent: jest.fn(async () => ({
    consent: {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      policy_version: (require('@/lib/consent') as typeof import('@/lib/consent'))
        .RECORDING_CONSENT_POLICY_VERSION,
      granted_at: '2026-08-01T00:00:00Z',
    },
  })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/packs', () => ({
  createPackAction: jest.fn(),
  redeemSessionAction: jest.fn(),
  undoRedemptionAction: jest.fn(),
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
  return new Proxy({}, { get: (_t, p) => (p === 'Button' ? button : passthrough) })
})

const NOW = Date.parse('2026-08-25T04:00:00.000Z') // 13:00 JST
const MIN = 60_000

type StoredTake = {
  takeId: string
  target: {
    customerId: string
    customerName: string
    karuteNumber: string | null
    appointmentId: string | null
    service?: string
  } | null
  recordingSessionId: string | null
  mimeType: string
  startedAt: number
  updatedAt: number
  outcome?: unknown
  outcomeSkipped?: boolean
  /** Set = the server has this take's audio. Absent on every take below, which
   *  is what a 確認待ち take IS: one this device never settled. */
  finalizedAt?: number
  /** The three facts isUnsecurableTake reads (PR4 fix round 4) — whether the
   *  server can EVER hold this audio, which is what 確認する is now allowed to
   *  act on. Absent on a take the drain will simply try again. */
  tailIncomplete?: boolean
  stopPendingAt?: number
  durationMs?: number
  secureError?: string
}
/** The device's IndexedDB, in a variable. deleteTake really removes from it, so
 *  a re-fold after 確認する sees the world the app actually left behind — and
 *  it carries the REAL guard (capture pipeline PR4): audio the server does not
 *  have is removed only when a HUMAN resolved the row. A fake that removed
 *  unconditionally would go green on a call site that had lost the flag. */
let stored: StoredTake[] = []
const mockDeleteTake = jest.fn(async (takeId: string, opts?: { humanResolved?: boolean }) => {
  const held = stored.find((t) => t.takeId === takeId)
  if (held && !held.finalizedAt && !opts?.humanResolved) return
  stored = stored.filter((t) => t.takeId !== takeId)
})
/** ⚖ AND THE DECISION ABOVE THAT GUARD (capture pipeline PR4 fix round 4).
 *  確認する no longer asserts the flag — it asks the store, which answers with
 *  the REAL rule: only a take that can never be sealed may be settled by a tap.
 *  `isUnsecurableTake` is required here rather than restated, so a drift in
 *  take-store's own answer cannot leave this suite green. */
const mockSettleTakeAfterSave = jest.fn(async (takeId: string) => {
  const held = stored.find((t) => t.takeId === takeId)
  const { isUnsecurableTake } =
    jest.requireActual<typeof import('@/lib/karute/take-store')>('@/lib/karute/take-store')
  await mockDeleteTake(takeId, { humanResolved: !!held && isUnsecurableTake(held) })
})
jest.mock('@/lib/karute/take-store', () => ({
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: (id: string, opts?: { humanResolved?: boolean }) => mockDeleteTake(id, opts),
  settleTakeAfterSave: (id: string) => mockSettleTakeAfterSave(id),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: jest.fn(async () => {}),
  readTakeOutcome: jest.fn(async () => null),
  listOwnTakes: jest.fn(async () => [...stored].sort((a, b) => b.startedAt - a.startedAt)),
  // The BANNER stays out of the way in this suite — every assertion here is
  // about the inbox rows, and the banner has its own suite.
  listOwnStoppedUnsecuredTakeIds: jest.fn(async () => []),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(async () => new Blob(['audio'])),
}))
jest.mock('@/lib/karute/draft', () => ({
  loadDraft: jest.fn(async () => null),
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
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: {
    takeId: null,
    state: 'idle',
    subscribe: () => () => {},
    // Fix round 17: the page asks whether a stop leg is still finishing a
    // take before it decides it has nothing left to drain — and, for a take
    // with no session id on it, re-reads the stamp the drain may have written
    // since this list loaded. Nothing here has a row to find.
    isSecuring: () => false,
    retryRecordingSessionMint: jest.fn(async (): Promise<string | null> => null),
  },
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
    runId: 1,
    savedRecordId: null,
    subscribe: () => () => {},
    start: (...a: unknown[]) => mockPipelineStart(...(a as [])),
    retry: jest.fn(),
    reset: jest.fn(),
  },
}))

type ServerSession = {
  recordingSessionId: string
  customerId: string | null
  /** Server-side name fill (⚖ 2026-08-17) — see the store-isolation cases. */
  customerName?: string | null
  createdAt: string
  durationSeconds: number | null
  karuteRecordId: string | null
  jobStatus: string | null
  jobProbeFailed: boolean
  jobLastError: string | null
  /** Build 23 slice ③ — what the server holds for this session's audio. */
  serverAudio?: 'segments' | 'object' | null
}
let serverSessions: ServerSession[] = []
let serverThrows = false
jest.mock('@/actions/recordings-inbox', () => ({
  listRecordingsInbox: jest.fn(async () => {
    if (serverThrows) throw new Error('core down')
    return serverSessions
  }),
}))

// Slice ③ — the save-from-server door. The port is the seam both worlds go
// through, so mocking it here is mocking exactly what the page depends on.
const mockEnqueueFromSession = jest.fn(
  async (_i: unknown): Promise<unknown> => ({ ok: true, jobId: 'job-1', status: 'QUEUED' }),
)
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({
    enqueueJobFromSession: (i: unknown) => mockEnqueueFromSession(i),
  }),
}))

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  RecordPageView,
  type RecordPageViewProps,
} from '@/components/karute/redesign/record/RecordPageView'
import { resetInbox } from '@/lib/recordings/inbox-store'

function take(over: Partial<StoredTake> & { takeId: string }): StoredTake {
  return {
    target: {
      customerId: 'cust-1',
      customerName: '佐藤 美咲',
      karuteNumber: '#00058',
      appointmentId: 'appt-1',
    },
    recordingSessionId: null,
    mimeType: 'audio/webm',
    startedAt: NOW - 60 * MIN,
    updatedAt: NOW - 40 * MIN,
    ...over,
  }
}

function session(over: Partial<ServerSession> & { recordingSessionId: string }): ServerSession {
  return {
    customerId: 'cust-1',
    createdAt: new Date(NOW - 60 * MIN).toISOString(),
    durationSeconds: 1200,
    karuteRecordId: null,
    jobStatus: null,
    jobProbeFailed: false,
    jobLastError: null,
    ...over,
  }
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask'] })
  resetInbox()
  stored = []
  serverSessions = []
  serverThrows = false
  mockEnqueueFromSession.mockResolvedValue({ ok: true, jobId: 'job-1', status: 'QUEUED' })
})

afterEach(() => {
  cleanup()
  jest.useRealTimers()
  jest.clearAllMocks()
})

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
      ticketsEnabled={false}
      {...overrides}
    />,
  )
  await flush()
  return result
}

async function flush(rounds = 14) {
  await act(async () => {
    for (let i = 0; i < rounds; i++) await Promise.resolve()
  })
}

const inbox = () => screen.getByTestId('recordings-inbox')
const rows = () => within(inbox()).getAllByTestId(/^inbox-row-/)
const row = (key: string) => within(inbox()).getByTestId(`inbox-row-${key}`)

describe('録音履歴 — multi-take recovery', () => {
  it('two takes are two rows, and 保存する on the OLDER one saves THAT take', async () => {
    stored = [
      take({ takeId: 'take-new', startedAt: NOW - 40 * MIN, updatedAt: NOW - 25 * MIN }),
      take({
        takeId: 'take-old',
        startedAt: NOW - 180 * MIN,
        updatedAt: NOW - 160 * MIN,
        target: {
          customerId: 'cust-1',
          customerName: '田中 花子',
          karuteNumber: '#00012',
          appointmentId: 'appt-old',
        },
      }),
    ]
    await renderPage()

    expect(rows()).toHaveLength(2)
    expect(row('take:take-new').dataset.state).toBe('recoverable')
    expect(row('take:take-old').dataset.state).toBe('recoverable')
    // 要対応 counts both.
    expect(within(inbox()).getByText('recording.inbox.needsAttention')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(row('take:take-old')).getByText('recording.inbox.action.save'))
    })
    await flush(20)

    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
    const [, context] = mockPipelineStart.mock.calls[0] as [Blob, { takeId: string; appointmentId?: string }]
    expect(context.takeId).toBe('take-old')
    expect(context.appointmentId).toBe('appt-old')
  })

  it('a take with no session id still gets its own row', async () => {
    stored = [take({ takeId: 'orphan', recordingSessionId: null })]
    await renderPage()
    expect(row('take:orphan')).toBeInTheDocument()
  })
})

// ⚖ Liam 2026-08-17 store isolation. The page's customer array is STORE-scoped
// for a clamped actor; these rows are STAFF-scoped, so a staffer's own
// recording of an out-of-store customer has an id that array cannot resolve.
// The name is filled server-side instead (actions/recordings-inbox.ts) — the
// pair below is the whole contract: with the fill the name renders, without it
// the row honestly says 不明 rather than inventing one.
describe('録音履歴 — out-of-store customer names', () => {
  const OUT_OF_STORE = 'cust-other-branch'

  it('a saved row for a customer outside the store lens renders the SERVER-filled name', async () => {
    serverSessions = [
      session({
        recordingSessionId: 'sess-out',
        customerId: OUT_OF_STORE,
        customerName: '代官山 太郎',
        karuteRecordId: 'karute-out',
      }),
    ]
    // The clamped page array: the out-of-store id is deliberately absent.
    await renderPage({ customers: [{ id: 'cust-1', name: '佐藤 美咲' } as never] })

    const r = row('session:sess-out')
    expect(r.dataset.state).toBe('saved')
    expect(within(r).getByText('代官山 太郎')).toBeInTheDocument()
    expect(within(r).queryByText('recording.recoverCustomerUnknown')).not.toBeInTheDocument()
  })

  it('without the fill the same row falls back to 不明 — never a wrong name', async () => {
    serverSessions = [
      session({
        recordingSessionId: 'sess-out',
        customerId: OUT_OF_STORE,
        karuteRecordId: 'karute-out',
      }),
    ]
    await renderPage({ customers: [{ id: 'cust-1', name: '佐藤 美咲' } as never] })

    const r = row('session:sess-out')
    expect(within(r).getByText('recording.recoverCustomerUnknown')).toBeInTheDocument()
  })
})

describe('録音履歴 — 確認待ち decays once the staffer looks', () => {
  it('確認する settles the take, opens the karute, and the row falls to 保存済み', async () => {
    serverSessions = [session({ recordingSessionId: 'sess-1', karuteRecordId: 'rec-1' })]
    // ⚖ PR4 fix round 4: a take the server can NEVER hold — here a stop leg
    // that died before it could stamp. That is the cohort 確認する may settle:
    // nothing is coming for this audio, so the tap is the last word on it.
    stored = [
      take({ takeId: 'take-1', recordingSessionId: 'sess-1', stopPendingAt: NOW - 41 * MIN }),
    ]
    await renderPage()

    expect(row('session:sess-1').dataset.state).toBe('awaiting-check')
    expect(within(inbox()).getByText('recording.inbox.needsAttention')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(row('session:sess-1')).getByText('recording.inbox.action.check'))
    })
    await flush(20)

    // ⚖ THE ONE HUMAN-RESOLVED DELETE (PR4 fix round 1). A 確認待ち take is by
    // definition one this device never secured, so without the flag the guard
    // refuses it and the 要対応 badge can never be cleared by anyone. Round 4
    // moved the DECISION into the store: the tap asks, and this take's dead
    // stop leg is what earns the yes.
    expect(mockSettleTakeAfterSave).toHaveBeenCalledWith('take-1')
    expect(mockDeleteTake).toHaveBeenCalledWith('take-1', { humanResolved: true })
    expect(mockPush).toHaveBeenCalledWith('/karute/rec-1')
    // …and the re-fold that follows the settle shows the row as plain 保存済み,
    // with the 要対応 chip gone.
    expect(row('session:sess-1').dataset.state).toBe('saved')
    expect(within(inbox()).queryByText('recording.inbox.needsAttention')).toBeNull()
  })

  // ⚖ …AND A TAKE THE DRAIN CAN STILL SEAL KEEPS ITS ROW (PR4 fix round 4, F1).
  // A 確認待ち take whose secure failed RETRYABLY is audio the server is still
  // going to receive under this take's OWN key. Settling it would throw away
  // the only copy that can get there, so the tap opens the karute and leaves
  // the row standing — the drain finalizes it, and the next tap clears it. The
  // row is honest about a recording the server does not have yet.
  it('…but a take the drain can still seal is NOT settled — the row stays 確認待ち', async () => {
    serverSessions = [session({ recordingSessionId: 'sess-1', karuteRecordId: 'rec-1' })]
    stored = [
      take({ takeId: 'take-1', recordingSessionId: 'sess-1', secureError: 'upload_503' }),
    ]
    await renderPage()

    expect(row('session:sess-1').dataset.state).toBe('awaiting-check')

    await act(async () => {
      fireEvent.click(within(row('session:sess-1')).getByText('recording.inbox.action.check'))
    })
    await flush(20)

    // The settle RAN and the guard refused it — unflagged, because nothing has
    // given up on this audio.
    expect(mockSettleTakeAfterSave).toHaveBeenCalledWith('take-1')
    expect(mockDeleteTake).toHaveBeenCalledWith('take-1', { humanResolved: false })
    // The karute still opens: looking at the record was never gated on the take.
    expect(mockPush).toHaveBeenCalledWith('/karute/rec-1')
    // …and the row says what is true — the recording is still only here.
    expect(row('session:sess-1').dataset.state).toBe('awaiting-check')
    expect(within(inbox()).getByText('recording.inbox.needsAttention')).toBeInTheDocument()
  })

  it('保存済み offers 開く and settles nothing (there is no take to settle)', async () => {
    serverSessions = [session({ recordingSessionId: 'sess-1', karuteRecordId: 'rec-1' })]
    await renderPage()

    expect(row('session:sess-1').dataset.state).toBe('saved')
    await act(async () => {
      fireEvent.click(within(row('session:sess-1')).getByText('recording.inbox.action.open'))
    })
    await flush()
    expect(mockPush).toHaveBeenCalledWith('/karute/rec-1')
    expect(mockDeleteTake).not.toHaveBeenCalled()
  })
})

describe('録音履歴 — 再試行 only when the audio is here', () => {
  it('FAILED with no local take shows the reason and NO retry link', async () => {
    serverSessions = [
      session({ recordingSessionId: 'sess-1', jobStatus: 'FAILED', jobLastError: 'EMPTY_TRANSCRIPT' }),
    ]
    await renderPage()

    const r = row('session:sess-1')
    expect(r.dataset.state).toBe('failed')
    // The one honest string core's error earns, reused from the error card.
    expect(within(r).getByText('recording.pipelineErrorEmptyTranscript')).toBeInTheDocument()
    expect(within(r).queryByText('recording.inbox.action.retry')).toBeNull()
  })

  it('FAILED with a local take offers 再試行, and it runs the same save', async () => {
    serverSessions = [
      session({ recordingSessionId: 'sess-1', jobStatus: 'FAILED', jobLastError: 'boom' }),
    ]
    stored = [take({ takeId: 'take-1', recordingSessionId: 'sess-1' })]
    await renderPage()

    const r = row('session:sess-1')
    expect(r.dataset.state).toBe('failed')
    await act(async () => {
      fireEvent.click(within(r).getByText('recording.inbox.action.retry'))
    })
    await flush(20)
    const [, context] = mockPipelineStart.mock.calls[0] as [Blob, { takeId: string }]
    expect(context.takeId).toBe('take-1')
  })
})

describe('録音履歴 — honesty when a half is missing', () => {
  it('a failed server read SAYS so, and still lists this device’s takes', async () => {
    serverThrows = true
    stored = [take({ takeId: 'take-1' })]
    await renderPage()

    expect(within(inbox()).getByText('recording.inbox.partial')).toBeInTheDocument()
    expect(rows()).toHaveLength(1)
  })

  it('nothing to show renders the empty line, not a phantom row', async () => {
    await renderPage()
    expect(within(inbox()).getByText('recording.inbox.empty')).toBeInTheDocument()
    expect(within(inbox()).queryAllByTestId(/^inbox-row-/)).toHaveLength(0)
    expect(within(inbox()).queryByText('recording.inbox.needsAttention')).toBeNull()
  })

  it('a walk-in session with no customer renders 顧客未設定, never a blank name', async () => {
    serverSessions = [
      session({ recordingSessionId: 'sess-1', customerId: null, karuteRecordId: 'rec-1' }),
    ]
    await renderPage()
    expect(within(row('session:sess-1')).getByText('recording.inbox.unsetCustomer')).toBeInTheDocument()
  })
})

/**
 * 録音履歴 — 保存する ON A ROW WHOSE AUDIO IS ON THE SERVER (build 23 slice ③).
 *
 * The claims a unit test cannot make: that this row's button reaches the NEW
 * door (not the take flow), with THIS row's session, and that a row that still
 * has a take on the device goes the old way, untouched.
 */
describe('録音履歴 — saving from the server', () => {
  const OLD = () => new Date(NOW - 5 * 60 * MIN).toISOString()

  it('a bound server row saves straight through the new door — no take flow', async () => {
    serverSessions = [
      session({ recordingSessionId: 'sess-srv', serverAudio: 'object', createdAt: OLD() }),
    ]
    await renderPage()

    const r = row('session:sess-srv')
    expect(r.dataset.state).toBe('recoverable')
    expect(within(r).getByText('recording.inbox.reason.serverAudio')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(r).getByText('recording.inbox.action.save'))
    })
    await flush(20)

    expect(mockEnqueueFromSession).toHaveBeenCalledWith({
      recordingSessionId: 'sess-srv',
      customerId: 'cust-1',
      locale: 'ja',
    })
    // The take flow is never entered: no blob, no pipeline, no take touched.
    expect(mockPipelineStart).not.toHaveBeenCalled()
    expect(mockSettleTakeAfterSave).not.toHaveBeenCalled()
  })

  it('an UNBOUND server row opens the picker, and the pick carries the door', async () => {
    serverSessions = [
      session({
        recordingSessionId: 'sess-walkin',
        customerId: null,
        serverAudio: 'object',
        createdAt: OLD(),
      }),
    ]
    await renderPage()

    await act(async () => {
      fireEvent.click(
        within(row('session:sess-walkin')).getByText('recording.inbox.action.save'),
      )
    })
    await flush(20)
    // Nothing is queued on the tap alone — the picker IS the save's first step.
    expect(mockEnqueueFromSession).not.toHaveBeenCalled()

    // The picker's search box is ON for a row with no binding (⚖ 8/21 ⑥).
    const searchBox = screen.getByRole('combobox')
    await act(async () => {
      fireEvent.change(searchBox, { target: { value: '佐藤' } })
    })
    await flush(20)
    await act(async () => {
      fireEvent.click(screen.getByText('佐藤 美咲'))
    })
    await flush(20)

    expect(mockEnqueueFromSession).toHaveBeenCalledWith({
      recordingSessionId: 'sess-walkin',
      customerId: 'cust-1',
      locale: 'ja',
    })
  })

  it('a row that STILL has the take takes the old path — the local copy wins', async () => {
    serverSessions = [
      session({ recordingSessionId: 'sess-both', serverAudio: 'object', createdAt: OLD() }),
    ]
    stored = [take({ takeId: 'take-1', recordingSessionId: 'sess-both' })]
    await renderPage()

    const r = row('session:sess-both')
    expect(within(r).getByText('recording.inbox.reason.localAudio')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(r).getByText('recording.inbox.action.save'))
    })
    await flush(20)

    expect(mockEnqueueFromSession).not.toHaveBeenCalled()
    expect(mockPipelineStart).toHaveBeenCalledTimes(1)
  })

  it('a segments row is 処理中 and offers NOTHING to press', async () => {
    serverSessions = [
      session({ recordingSessionId: 'sess-part', serverAudio: 'segments', createdAt: OLD() }),
    ]
    await renderPage()

    const r = row('session:sess-part')
    expect(r.dataset.state).toBe('processing')
    expect(within(r).getByText('recording.inbox.reason.partialOnServer')).toBeInTheDocument()
    expect(within(r).queryByText('recording.inbox.action.save')).not.toBeInTheDocument()
    // …and it is not in 要対応: there is nothing for a human to do yet.
    expect(within(inbox()).queryByText('recording.inbox.needsAttention')).not.toBeInTheDocument()
  })

  it('a refused save says so, and the row is re-read either way', async () => {
    mockEnqueueFromSession.mockResolvedValue({ error: 'no_audio' })
    serverSessions = [
      session({ recordingSessionId: 'sess-srv', serverAudio: 'object', createdAt: OLD() }),
    ]
    await renderPage()

    await act(async () => {
      fireEvent.click(within(row('session:sess-srv')).getByText('recording.inbox.action.save'))
    })
    await flush(20)

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { toast } = require('sonner') as { toast: { error: jest.Mock } }
    expect(toast.error).toHaveBeenCalledWith('recording.recoverSaveFailed')
  })
})

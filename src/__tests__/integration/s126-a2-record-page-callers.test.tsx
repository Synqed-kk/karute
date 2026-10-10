/**
 * @jest-environment jsdom
 *
 * S126 A2 builder 5 (R-S126-6 e): the RecordPageView ticket-use callers read the
 * use state (S125 § 6a). pending = success with 「消化を記録しました」 (no 残from→残to
 * line, which would claim a landed burn); held = 「確認待ち」 as info, never error
 * styling, and the flow moves on; refused keeps today's toast and branch.
 *   (a) the auto-flow (handleAutoFlow, mid-pack 'auto' cohort, no dialog)
 *   (b) the outcome dialog (redeemPromise, 'repurchase' cohort)
 * The recovery banner's burnPromise lives in s126-a2-recovery-burn-callers.test.tsx.
 * Harness = record-page-outcome-double-tap.test.tsx's, plus a sonner spy and the
 * real ja.json strings for the packs namespace (every other key = its own name).
 */
jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      if (ns !== 'customers.profile.packs') return key
      const s = (ja.customers.profile.packs as Record<string, unknown>)[key]
      if (typeof s !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return s.replace(/\{(\w+)\}/g, (_, v: string) => String(vars?.[v] ?? `{${v}}`))
    },
  }
})
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
// P5-A: RecordPageView imports the written-reason discard action; unmocked it
// pulls the ESM SDK into this suite. Not exercised here.
jest.mock('@/actions/recording-discard', () => ({
  discardRecordingWithReason: jest.fn(async () => ({
    ok: true,
    receiptId: 'row-1',
    duplicate: false,
  })),
}))
jest.mock('@/actions/recording-discards', () => ({
  myDiscardCountThisMonth: jest.fn(async () => null),
  listDiscardReasons: jest.fn(async () => ({ ok: false, error: 'forbidden' })),
}))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
// Overridable per-test (mockResolvedValueOnce) — the handleStartRecording
// regression test below needs consent GRANTED to reach the real record-start
// button (RecordButtonCard's onStart no-ops while recordingBlocked). Widened
// return type (not the full RecordingConsent shape) — isConsentCurrent only
// reads policy_version, same partial shape review-screen-discard.test.tsx
// already mocks.
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

const mockCreatePackAction = jest.fn(async (_input: unknown) => ({ ok: true }))
const mockRedeemSessionAction = jest.fn(async (_input: unknown) => ({ ok: true, redemptionId: 'red-1' }))
jest.mock('@/actions/packs', () => ({
  createPackAction: (input: unknown) => mockCreatePackAction(input),
  redeemSessionAction: (input: unknown) => mockRedeemSessionAction(input),
  undoRedemptionAction: jest.fn(),
}))

// @synqed-kk/ui ships ESM-only and isn't transformable in this suite — same
// generic passthrough proxy thin-record-screen-brief-cache.test.tsx uses.
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  // Button renders a REAL <button> so `disabled` is honored natively —
  // fireEvent.click on a disabled <button> is a no-op in the DOM, matching
  // production. The old div passthrough ignored `disabled` entirely, which
  // was the false-green root cause (adversarial-lens P1, #679 re-tip round).
  const button = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('button', rest, children as React.ReactNode)
  return new Proxy(
    {},
    { get: (_target, prop) => (prop === 'Button' ? button : passthrough) },
  )
})
const mockStampTakeOutcome = jest.fn(async () => {})
jest.mock('@/lib/karute/take-store', () => ({
  // A2-2: the discard-transcript register. Default false/[] = nothing is
  // held back, so every case below behaves exactly as it did pre-A2-2.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: (...a: unknown[]) => mockStampTakeOutcome(...(a as [])),
  listOwnStoppedUnsecuredTakeIds: jest.fn(async () => []),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
}))
// The NORMAL path's stamp reads globalRecorder.takeId, so the singleton needs
// one for the A-3 ordering test below to have anything to stamp.
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: {
    takeId: 'take-normal',
    state: 'idle',
    subscribe: () => () => {},
    // Fix round 17: the page asks whether a stop leg is still finishing a
    // take before it decides it has nothing left to drain.
    isSecuring: () => false,
    discard: jest.fn(),
  },
}))

// Real getUserMedia/MediaRecorder don't exist in jsdom, so the recorder
// singleton can never legitimately reach 'recorded' state in this suite
// (see global-recorder-session-race.test.ts's header note) — mock the HOOK
// (not the singleton) so RecordPageView's phase-sync effect renders the
// post-recording "このまま使う" card directly.
// durationMs: 60_000 (⚖ 9/12, was 5000) — this suite's two discard flows
// expect the written-reason DIALOG to open; a take under the accidental-tap
// floor is now a one-tap discard that skips it entirely, and nothing here is
// testing the floor, so the fixture stays above it.
// ⚖ FIX ROUND 1: KEPT even after the unknown-duration fix (unlike the other
// two bumped suites, which reverted cleanly) — 5000 here was never "unknown",
// it's a real, known 5s duration, so it genuinely one-taps under the fixed
// code too. Confirmed by reverting to 5000 and re-running: still red.
const mockResult = { blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 60_000 }
// Mutable so tests can drive a genuine take-lifecycle transition (discard →
// new recording → recorded) instead of the static 'recorded' every render
// used to return — needed to prove the P1 latch (outcomeResolvedRef) clears
// for a real NEW take instead of just staying latched forever. Reset to
// 'recorded' in afterEach so every OTHER test's fresh render still starts
// exactly where they already assume.
let mockRecState: 'idle' | 'recording' | 'paused' | 'recorded' = 'recorded'
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: mockRecState,
    result: mockRecState === 'recorded' ? mockResult : null,
    error: null,
    stream: null,
    startedAt: null,
    overrun: false,
    autoStopped: false,
    target: { customerId: 'cust-1', customerName: '廣瀬浩子', karuteNumber: null, appointmentId: null },
    takeId: null,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    discardRecording: jest.fn(),
    // P5-A: the written-reason gate bounded-awaits the mint before it will
    // discard anything, so the take-lifecycle boundaries below need an id.
    awaitRecordingSessionId: jest.fn(async () => 'sess-live'),
  }),
}))
// The real GlobalPipeline.start() would kick off a real transcription run
// (network calls) — handleUseRecording calls it directly (module import, not
// the hook) once the resolve handler settles. Stub the whole singleton so
// the test stays hermetic; state stays 'idle' so the pipeline-review branch
// never takes over the render.
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    version: 0,
    state: 'idle',
    step: null,
    result: null,
    error: null,
    context: null,
    subscribe: () => () => {},
    start: jest.fn(),
    retry: jest.fn(),
    reset: jest.fn(),
  },
}))

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { globalPipeline } from '@/lib/global-pipeline'
import {
  RecordPageView,
  type RecordPageViewProps,
} from '@/components/karute/redesign/record/RecordPageView'

afterEach(() => {
  cleanup()
  jest.clearAllMocks()
  mockRecState = 'recorded'
})

const NEXT_APPOINTMENT = {
  id: 'appt-1',
  customerName: '廣瀬浩子',
  customerId: 'cust-1',
  karuteNumber: null,
  startTime: '2026-08-07T02:00:00.000Z',
  durationMinutes: 60,
  title: null,
  notes: null,
}
// 残4 > REPURCHASE_PROMPT_REMAINING → 'auto' (handleAutoFlow, no dialog);
// 残2 → 'repurchase' (the outcome dialog's redeemPromise).
const AUTO_PACK = { id: 'p-auto', remaining: 4, size: 10 }
const REPURCHASE_PACK = { id: 'p1', remaining: 2, size: 10 }

const DONE = '消化を記録しました'
const HELD = '確認待ち'
const FROM_TO = '回数券を消化しました（残4 → 残3）'

async function renderRecordedPage(overrides: Partial<RecordPageViewProps> = {}) {
  render(
    <RecordPageView
      customers={[]}
      locale="ja"
      nextAppointment={NEXT_APPOINTMENT}
      nearbyBookings={[]}
      brief={null}
      aiBriefPromise={Promise.resolve(null)}
      recentRecordings={[]}
      consentDate={null}
      targetPack={null}
      packPresets={[{ size: 10, unitPrice: 9900 }]}
      staffCanCustomizePacks
      ticketsEnabled
      {...overrides}
    />,
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function flush(n = 12) {
  await act(async () => {
    for (let i = 0; i < n; i++) await Promise.resolve()
  })
}

/** 録音を使用 on the 'auto' cohort: handleAutoFlow burns, then handleUseRecording runs. */
async function runAutoFlow() {
  await renderRecordedPage({ targetPack: AUTO_PACK })
  await act(async () => {
    fireEvent.click(screen.getByText('useRecording'))
  })
  await flush()
}

/** 録音を使用 → 継続検討 → 保存 on the 'repurchase' cohort: redeemPromise only. */
async function runOutcomeDialog() {
  await renderRecordedPage({ targetPack: REPURCHASE_PACK })
  await act(async () => {
    fireEvent.click(screen.getByText('useRecording'))
    await Promise.resolve()
  })
  await act(async () => {
    fireEvent.click(screen.getByText('repurchase.pending.title'))
    await Promise.resolve()
  })
  await act(async () => {
    fireEvent.click(screen.getByText('save'))
  })
  await flush()
}

describe('(a) auto-flow (handleAutoFlow) reads the use state', () => {
  it('pending → 「消化を記録しました」 success, no 残from→残to line, the flow continues', async () => {
    mockRedeemSessionAction.mockResolvedValueOnce({ ok: true, state: 'pending' } as never)
    await runAutoFlow()
    expect(mockRedeemSessionAction).toHaveBeenCalledTimes(1)
    expect(mockRedeemSessionAction.mock.calls[0][0]).toMatchObject({ packId: 'p-auto', customerId: 'cust-1' })
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith(DONE)
    expect(toast.success).not.toHaveBeenCalledWith(FROM_TO, expect.anything())
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
    // No dialog on this cohort; handleUseRecording ran (the pipeline started).
    expect(screen.queryByText('repurchase.pending.title')).toBeNull()
    expect(globalPipeline.start).toHaveBeenCalledTimes(1)
  })

  it('held → 「確認待ち」 as info (never error), no success claim, the flow continues', async () => {
    mockRedeemSessionAction.mockResolvedValueOnce({ ok: true, state: 'held' } as never)
    await runAutoFlow()
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith(HELD)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(globalPipeline.start).toHaveBeenCalledTimes(1)
  })

  it('refused → today\'s error toast (below_zero → 残回数なし, other → 記録できませんでした), the flow still continues', async () => {
    mockRedeemSessionAction.mockResolvedValueOnce({ ok: false, error: 'below_zero' } as never)
    await runAutoFlow()
    expect(toast.error).toHaveBeenCalledWith('残回数がないため消化できません')
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
    expect(globalPipeline.start).toHaveBeenCalledTimes(1)
    cleanup()
    jest.clearAllMocks()
    mockRedeemSessionAction.mockResolvedValueOnce({ ok: false, error: 'withdrawn' } as never)
    await runAutoFlow()
    expect(toast.error).toHaveBeenCalledWith('記録できませんでした')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('settled (control) → today\'s 残from→残to line with its undo action', async () => {
    mockRedeemSessionAction.mockResolvedValueOnce({ ok: true, state: 'settled', redemptionId: 'red-9' } as never)
    await runAutoFlow()
    expect(toast.success).toHaveBeenCalledWith(FROM_TO, expect.objectContaining({ action: expect.anything() }))
  })
})

describe('(b) outcome dialog (redeemPromise) reads the use state', () => {
  it('held → 「確認待ち」 as info, never error, never success', async () => {
    mockRedeemSessionAction.mockResolvedValueOnce({ ok: true, state: 'held' } as never)
    await runOutcomeDialog()
    expect(mockRedeemSessionAction).toHaveBeenCalledTimes(1)
    expect(mockRedeemSessionAction.mock.calls[0][0]).toMatchObject({ packId: 'p1', customerId: 'cust-1' })
    expect(toast.info).toHaveBeenCalledWith(HELD)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('pending → 「消化を記録しました」 success', async () => {
    mockRedeemSessionAction.mockResolvedValueOnce({ ok: true, state: 'pending' } as never)
    await runOutcomeDialog()
    expect(toast.success).toHaveBeenCalledWith(DONE)
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('refused → today\'s error toasts (below_zero / other)', async () => {
    mockRedeemSessionAction.mockResolvedValueOnce({ ok: false, error: 'below_zero' } as never)
    await runOutcomeDialog()
    expect(toast.error).toHaveBeenCalledWith('残回数がないため消化できません')
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
    cleanup()
    jest.clearAllMocks()
    mockRedeemSessionAction.mockResolvedValueOnce({ ok: false, error: 'withdrawn' } as never)
    await runOutcomeDialog()
    expect(toast.error).toHaveBeenCalledWith('記録できませんでした')
    expect(toast.success).not.toHaveBeenCalled()
  })
})

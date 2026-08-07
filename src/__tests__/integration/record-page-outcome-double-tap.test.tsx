/**
 * @jest-environment jsdom
 *
 * RecordPageView's outcome-dialog 保存 — single-flight guard
 * (fix/post-session-money-guards, PR-0).
 *
 * Live prod bug: RecordPageView rendered <PostSessionResolutionDialog>
 * without the `saving` prop (unlike OutcomeCard.tsx and TicketPackCard.tsx,
 * which both disable their save control while a write is in flight), and its
 * onResolve handler fired createPackAction/redeemSessionAction as bare `void`
 * calls with no re-entry guard. A double-tap 保存 — two taps landing in the
 * same event-loop tick, before React re-renders the disabled button — called
 * createPackAction (or redeemSessionAction) twice: a double-charged customer
 * (two ticket_packs rows) or a double-burned walk-in (two pack_redemptions
 * rows; appointmentId:null defeats the DB's partial unique index).
 *
 * The fix adds a resolvingOutcomeRef (synchronous re-entry check — state
 * alone reads stale mid-tick) + resolvingOutcome state (fed to the dialog's
 * `saving` prop). Both taps must be dispatched inside ONE `act()` call to
 * reproduce the race: RTL's fireEvent auto-wraps each dispatch in its own
 * act(), so two SEPARATE fireEvent.click calls already can't reproduce the
 * bug (the first click's re-render/dialog-close happens before the second
 * fires) — that was already true of the ORIGINAL buggy code too, since
 * setOutcomeOpen(false) was already the first line of the old handler. Only
 * two synchronous dispatches sharing one commit (both wrapped in a single
 * outer act()) can land before either click's state update commits.
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
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
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

// Real getUserMedia/MediaRecorder don't exist in jsdom, so the recorder
// singleton can never legitimately reach 'recorded' state in this suite
// (see global-recorder-session-race.test.ts's header note) — mock the HOOK
// (not the singleton) so RecordPageView's phase-sync effect renders the
// post-recording "このまま使う" card directly.
const mockResult = { blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 5000 }
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: 'recorded',
    result: mockResult,
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
import {
  RecordPageView,
  type RecordPageViewProps,
} from '@/components/karute/redesign/record/RecordPageView'

afterEach(() => {
  cleanup()
  jest.clearAllMocks()
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

const PRESETS = [{ size: 10, unitPrice: 9900 }]

// F5 (PR-0 fix round): pack.remaining=2 puts resolveOutcomeMode into
// 'repurchase' (REPURCHASE_PROMPT_REMAINING=2), which — unlike a bare
// mid-pack remaining>2 pack, which resolves to 'auto' and skips the dialog
// entirely via the separately-guarded handleAutoFlow (untouched by this fix
// round, per the ledger) — still opens PostSessionResolutionDialog and
// exercises the SAME onResolve handler F1 decoupled. That's the code path
// this suite's "redemption half had zero double-tap coverage" gap is about.
const REPURCHASE_PACK = { id: 'p1', remaining: 2, size: 10 }

async function renderRecordedPage(overrides: Partial<RecordPageViewProps> = {}) {
  const result = render(
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
      packPresets={PRESETS}
      staffCanCustomizePacks
      ticketsEnabled
      {...overrides}
    />,
  )
  // The AI-brief Suspense boundary (StreamingBriefCard, use(aiBriefPromise))
  // always suspends on its first pass even for an already-resolved promise —
  // React needs a microtask to learn the resolved value. Flush it inside
  // act() before interacting, or a later synchronous setState (the outcome
  // dialog opening) races an unsettled Suspense boundary and the click's
  // resulting re-render never commits within the same act() cycle.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return result
}

/** Drive the UI from "recorded" to the outcome dialog's 成約 pack panel, where
 *  保存 is enabled (prefilled from PRESETS[0]) — mirrors a staffer tapping
 *  useRecording then 成約. */
function openDialogAtSuccess() {
  fireEvent.click(screen.getByText('useRecording'))
  fireEvent.click(screen.getByText('success.title'))
}

/** Same drive, but for the 'repurchase' mode dialog (REPURCHASE_PACK) — the
 *  repurchase copy keys are `repurchase.<key>.title` instead of `<key>.title`
 *  (see PostSessionResolutionDialog's KEY/mode mapping). */
function openRepurchaseDialogAtStatus(key: 'success' | 'noDeal' | 'pending') {
  fireEvent.click(screen.getByText('useRecording'))
  fireEvent.click(screen.getByText(`repurchase.${key}.title`))
}

describe('RecordPageView — outcome dialog 保存 single-flight guard', () => {
  it('two 保存 taps landing in the same tick fire createPackAction exactly once', async () => {
    await renderRecordedPage()
    openDialogAtSuccess()
    const saveBtn = screen.getByText('save')

    // Both dispatches share ONE act() commit — the race the ref guard exists
    // for. Two separate fireEvent.click calls (each auto-wrapped in its own
    // act()) cannot reproduce this: the first click's re-render/dialog-close
    // would already have run before the second fires.
    await act(async () => {
      fireEvent.click(saveBtn)
      fireEvent.click(saveBtn)
      // Let the awaited createPackAction/redeemSessionAction calls settle.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockCreatePackAction).toHaveBeenCalledTimes(1)
  })

  // The dialog's `saving`-disables-保存 behavior (verified directly against
  // PostSessionResolutionDialog, unmodified by this fix, in
  // stop-dialog-pack-picker.test.tsx) isn't independently observable THROUGH
  // RecordPageView: onResolve calls setOutcomeOpen(false) synchronously in
  // the same batch as setResolvingOutcome(true) — a design predating this
  // fix (staff aren't blocked waiting on the pack write) — so the dialog is
  // already unmounted by the time `saving` would render. What IS observable
  // and load-bearing here is the re-entry guard itself, proven above.
})

// F1/F2/F5 (PR-0 fix round): the redemption half of onResolve had ZERO
// double-tap coverage before this round (every test above uses
// targetPack=null, so `redeemPack && targetPack && boundCustomerId` was
// always false and mockRedeemSessionAction never fired). These three close
// that gap and pin the decoupling (F1) + open-transition reset (F2).
describe('RecordPageView — outcome dialog redemption half (F1 decouple + F2 open-reset)', () => {
  it('two 保存 taps landing in the same tick fire redeemSessionAction exactly once', async () => {
    await renderRecordedPage({ targetPack: REPURCHASE_PACK })
    // 'pending' — no newPack panel involved, isolates the redemption call.
    openRepurchaseDialogAtStatus('pending')
    const saveBtn = screen.getByText('save')

    await act(async () => {
      fireEvent.click(saveBtn)
      fireEvent.click(saveBtn)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockRedeemSessionAction).toHaveBeenCalledTimes(1)
    expect(mockCreatePackAction).not.toHaveBeenCalled()
  })

  it('a rejecting createPackAction does not skip redemption — redemption still fires, the guard resets, and nothing goes unhandled', async () => {
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      await renderRecordedPage({ targetPack: REPURCHASE_PACK })
      // 'success' — opens the newPack panel too (prefilled valid from
      // PRESETS[0]), so BOTH halves of onResolve fire on one tap.
      openRepurchaseDialogAtStatus('success')
      mockCreatePackAction.mockRejectedValueOnce(new Error('boom'))

      // Take A save, then IMMEDIATELY reopen for take B — same
      // don't-flush-yet reasoning as the take-B test below: handleUseRecording
      // flips `phase` to 'idle' on its own unrelated awaited continuation,
      // which would swap the "useRecording" button away before we can use it
      // to reopen. Both resolves are kicked off synchronously here; the
      // `act()` below is what actually lets everything (take A's rejecting
      // create + resolving redeem, AND take B's resolving redeem) settle.
      fireEvent.click(screen.getByText('save'))
      fireEvent.click(screen.getByText('useRecording'))
      // 'pending' for take B — isolates it to the redemption call, proving
      // the SECOND resolve (guard freshly reset on reopen) goes through.
      fireEvent.click(screen.getByText('repurchase.pending.title'))

      await act(async () => {
        fireEvent.click(screen.getByText('save'))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      // Take A's create rejected — the old sequential-await code let a throw
      // here skip the redemption call entirely.
      expect(mockCreatePackAction).toHaveBeenCalledTimes(1)
      // Take A's redemption (despite the reject) + take B's redemption
      // (guard reset on reopen, not wedged by take A's reject) — two calls.
      expect(mockRedeemSessionAction).toHaveBeenCalledTimes(2)
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
    expect(unhandled).toHaveLength(0)
  })

  it('take B unlocks on reopen even while take A\'s write never settles (F2: reset on OPEN, not just finally)', async () => {
    await renderRecordedPage()
    openDialogAtSuccess()
    // A write that never settles — the finally reset in onResolve can never
    // run for it. Without F2, take B's dialog would stay stuck on 保存中.
    mockCreatePackAction.mockImplementationOnce(() => new Promise(() => {}))

    // Take A: one tap. Deliberately NOT flushed with any await/microtask
    // tick below — every one of onResolve's own state changes (the guard,
    // setOutcomeOpen(false)) is synchronous, so they're already committed by
    // the time this fireEvent.click call returns. (Flushing ticks here would
    // also let handleUseRecording's OWN unrelated awaited continuation flip
    // `phase` to 'idle', which would swap the "useRecording" button out from
    // under Take B for a reason that has nothing to do with the guard under
    // test — so this test deliberately never gives that microtask a turn.)
    fireEvent.click(screen.getByText('save'))

    // Take B: reopen — openOutcomeDialog resets the guard on this OPEN
    // transition regardless of take A's still-pending (in fact, forever-
    // pending) write.
    fireEvent.click(screen.getByText('useRecording'))
    fireEvent.click(screen.getByText('noDeal.title'))

    expect(screen.getByText('save')).toBeInTheDocument()
    expect(screen.getByText('save')).not.toBeDisabled()
    expect(screen.queryByText('saving')).toBeNull()
  })
})

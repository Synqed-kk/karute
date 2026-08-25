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
// P5-A: RecordPageView imports the written-reason discard action; unmocked it
// pulls the ESM SDK into this suite. Not exercised here.
jest.mock('@/actions/recording-discard', () => ({
  discardRecordingWithReason: jest.fn(async () => ({
    ok: true,
    receiptId: 'row-1',
    duplicate: false,
  })),
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
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  stampTakeOutcome: (...a: unknown[]) => mockStampTakeOutcome(...(a as [])),
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
    discard: jest.fn(),
  },
}))

// Real getUserMedia/MediaRecorder don't exist in jsdom, so the recorder
// singleton can never legitimately reach 'recorded' state in this suite
// (see global-recorder-session-race.test.ts's header note) — mock the HOOK
// (not the singleton) so RecordPageView's phase-sync effect renders the
// post-recording "このまま使う" card directly.
const mockResult = { blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 5000 }
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
import {
  RecordPageView,
  type RecordPageViewProps,
} from '@/components/karute/redesign/record/RecordPageView'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

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
  // A factory, not a cached element: React bails out of re-rendering a fiber
  // whose element is REFERENTIALLY the same object as last commit (no
  // scheduled update, no prop change) — reusing one `ui` const across
  // `rerender()` calls would silently no-op every one of them. A fresh
  // element each call has a new (but shallow-equal) props object, which
  // avoids that bailout so a `mockRecState` change is actually picked up.
  const buildUi = () => (
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
    />
  )
  const result = render(buildUi())
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
  return {
    ...result,
    // Re-render with the SAME props (a fresh element) so a `mockRecState`
    // change made between calls is picked up by the next
    // useGlobalRecorder() call — drives the take-lifecycle transitions
    // (recording → recorded) the phase-sync effect reacts to in production.
    // The extra microtask tick (same reasoning as the Suspense flush above)
    // is required for the resulting setPhase(...) inside that effect to
    // actually commit before the caller's next assertion/interaction.
    rerenderSame: async () => {
      await act(async () => {
        result.rerender(buildUi())
        await Promise.resolve()
      })
    },
  }
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
//
// PR-0 round 2 (Greptile P1, #679): F2's open-transition reset was correct
// for a genuinely NEW take but also reset for the SAME take on a re-tap —
// the "take B" scenarios below now go through an actual discard + new
// recording (mockRecState cycled via rerenderSame) instead of an immediate
// reopen of the SAME take, which the new outcomeResolvedRef latch now blocks
// (see the dedicated describe block further down for that regression test).
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

  it('a rejecting createPackAction does not skip redemption — redemption still fires for take A, take B (a genuine new take) resolves independently, and nothing goes unhandled', async () => {
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      const { rerenderSame } = await renderRecordedPage({ targetPack: REPURCHASE_PACK })
      // 'success' — opens the newPack panel too (prefilled valid from
      // PRESETS[0]), so BOTH halves of onResolve fire on one tap.
      openRepurchaseDialogAtStatus('success')
      mockCreatePackAction.mockRejectedValueOnce(new Error('boom'))

      // Take A: resolve, then discard immediately — no flush between the two
      // clicks (handleUseRecording's own unrelated awaited continuation
      // would otherwise flip `phase` to 'idle' on its own and steal the
      // 'discard' button out from under this explicit discard).
      fireEvent.click(screen.getByText('save'))
      fireEvent.click(screen.getByText('discard'))
      // P5-A: 破棄 opens the written-reason gate; the discard itself only
      // happens on confirm, after the reason has landed server-side.
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '録り直します' } })
      fireEvent.click(screen.getByText('discardReason.confirm'))

      await act(async () => {
        for (let i = 0; i < 8; i++) await Promise.resolve()
      })

      // Take B: a brand new recording starts and finishes (the P1 latch —
      // outcomeResolvedRef — was cleared by the discard above, at the same
      // take-lifecycle boundary useRecordingGen already bumps at).
      mockRecState = 'recording'
      await rerenderSame()
      mockRecState = 'recorded'
      await rerenderSame()

      // 'pending' for take B — isolates it to the redemption call, proving
      // the SECOND resolve (a genuinely new take) goes through.
      fireEvent.click(screen.getByText('useRecording'))
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
      // Take A's redemption (despite the reject) + take B's redemption.
      expect(mockRedeemSessionAction).toHaveBeenCalledTimes(2)
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
    expect(unhandled).toHaveLength(0)
  })

  it('a new take (discard + re-record) clears the resolution latch — take B\'s dialog opens even though take A\'s write never settled (F2: reset on OPEN, not just finally)', async () => {
    const { rerenderSame } = await renderRecordedPage()
    openDialogAtSuccess()
    // A write that never settles — the finally reset in onResolve can never
    // run for it. Without F2, take B's dialog would stay stuck on 保存中.
    mockCreatePackAction.mockImplementationOnce(() => new Promise(() => {}))

    // Take A: resolve, then discard immediately — same don't-flush-yet
    // reasoning as above.
    fireEvent.click(screen.getByText('save'))
    fireEvent.click(screen.getByText('discard'))
    // P5-A: the written-reason gate stands between the tap and the discard.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '録り直します' } })
    fireEvent.click(screen.getByText('discardReason.confirm'))

    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    // Take B: a brand new recording starts and finishes.
    mockRecState = 'recording'
    await rerenderSame()
    mockRecState = 'recorded'
    await rerenderSame()

    fireEvent.click(screen.getByText('useRecording'))
    fireEvent.click(screen.getByText('noDeal.title'))

    expect(screen.getByText('save')).toBeInTheDocument()
    expect(screen.getByText('save')).not.toBeDisabled()
    expect(screen.queryByText('saving')).toBeNull()
  })
})

// PR-0 round 2 (Greptile P1, #679): after the first 保存 tap, `phase` stays
// 'recorded' until handleUseRecording's session-id mint await settles (it
// only flips to 'idle' after that), so 録音を使用 stays tappable. Retapping
// it called openOutcomeDialog(), which reset resolvingOutcomeRef
// unconditionally on the open transition (F2 above, correct for a NEW take)
// — reopening the dialog for the SAME take and letting a second 保存 re-fire
// createPackAction/redeemSessionAction with identical inputs. outcomeResolvedRef
// latches per-take to close that window; see RecordPageView.tsx's onResolve
// handler + openOutcomeDialog.
describe('RecordPageView — per-take outcome resolution latch (Greptile P1, #679)', () => {
  it('re-tapping 録音を使用 while the mint promise is still in flight does NOT reopen the dialog — createPackAction/redeemSessionAction each fire exactly once', async () => {
    await renderRecordedPage({ targetPack: REPURCHASE_PACK })
    openRepurchaseDialogAtStatus('success')

    // Take A: one save tap, then IMMEDIATELY re-tap 録音を使用 — no flush in
    // between, so awaitRecordingSessionId's mint promise hasn't resolved and
    // `phase` is still 'recorded' (the button is still mounted). This is the
    // exact P1 window.
    fireEvent.click(screen.getByText('save'))
    fireEvent.click(screen.getByText('useRecording'))

    // Blocked — outcomeResolvedRef latched in onResolve, so the second tap's
    // openOutcomeDialog() early-returns and the dialog never reopens.
    expect(screen.queryByText('repurchase.success.title')).toBeNull()
    expect(screen.queryByText('save')).toBeNull()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockCreatePackAction).toHaveBeenCalledTimes(1)
    expect(mockRedeemSessionAction).toHaveBeenCalledTimes(1)
  })

  // Fresh-eyes P2: the "new take unlocks it" tests above all drive the reset
  // through handleDiscard's own `outcomeResolvedRef.current = false` line.
  // The everyday production loop never touches discard: resolve → the save
  // completes on its own (phase → idle) → the staffer taps the REAL
  // record-start control for the next customer. That path clears the latch
  // in handleStartRecording (and handleStartAnyway), not handleDiscard —
  // pin it directly through the real control, no synthetic calls.
  it('the real record-start control (handleStartRecording, not discard) also clears the latch for the next take', async () => {
    // RecordButtonCard's onStart no-ops while recordingBlocked (consent not
    // granted) — grant it so the click actually reaches handleStartRecording.
    mockGetCustomerConsent.mockResolvedValueOnce({
      consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-01-01' },
    })
    const { rerenderSame } = await renderRecordedPage()
    openDialogAtSuccess()

    // Take A: resolve normally and let handleUseRecording's OWN post-await
    // completion flip `phase` to 'idle' — no explicit discard this time.
    fireEvent.click(screen.getByText('save'))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Idle now — recorderControls (discard/useRecording) is gone, the real
    // record-start button (RecordButtonCard) is on screen instead.
    expect(screen.queryByText('useRecording')).toBeNull()

    // Customer B: tap the REAL start control — this IS handleStartRecording,
    // not a synthetic call to it.
    fireEvent.click(screen.getByLabelText('startAria'))

    // Drive the lifecycle to 'recorded' for take B.
    mockRecState = 'recording'
    await rerenderSame()
    mockRecState = 'recorded'
    await rerenderSame()

    fireEvent.click(screen.getByText('useRecording'))
    fireEvent.click(screen.getByText('noDeal.title'))

    expect(screen.getByText('save')).toBeInTheDocument()
    expect(screen.getByText('save')).not.toBeDisabled()
  })
})

// ── A-3 (PR-B1 fix round 1) — the NORMAL path stamps after the money ───────
//
// The stamp is what recovery reads as "this answer is settled, don't ask
// again". Firing it before the burn/pack-create legs settle certifies money
// that might still fail or be interrupted, and the take is then never
// re-offered — the same class of silent loss R-B3 exists to close, one step
// earlier. Held-open burn: nothing may be stamped yet.
describe('the outcome stamp follows the money (A-3)', () => {
  it('does not stamp while the redemption is still in flight', async () => {
    let settleBurn: (v: { ok: boolean }) => void = () => {}
    mockRedeemSessionAction.mockReturnValueOnce(
      new Promise((r) => {
        settleBurn = r
      }) as unknown as Promise<{ ok: boolean; redemptionId: string }>,
    )
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
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(mockRedeemSessionAction).toHaveBeenCalledTimes(1)
    expect(mockStampTakeOutcome).not.toHaveBeenCalled()

    await act(async () => {
      settleBurn({ ok: true })
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(mockStampTakeOutcome).toHaveBeenCalledWith(
      'take-normal',
      expect.objectContaining({ status: 'pending' }),
    )
  })
})

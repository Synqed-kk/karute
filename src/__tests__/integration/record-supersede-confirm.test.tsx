/**
 * @jest-environment jsdom
 *
 * C-1 (Greptile F1, fix round 3) — starting a SECOND pipeline run while the
 * first is still processing is no longer silent.
 *
 * globalPipeline is single-slot by design: `start()` while a previous run is
 * still processing supersedes it. On the WEB arm that run lives in this tab,
 * so the supersession DROPS its result un-settled — the take survives (the
 * recovery banner re-offers it) but the transcription is thrown away with no
 * word to the staff. On the THIN arm the eligible cohort runs as a CORE JOB
 * that keeps going server-side, so nothing is lost and a dialog would be a
 * lie — a passive notice is the whole fix there.
 *
 * 録音を使用 is the ONE user-reachable caller of pipeline.start on this screen
 * (take-recovery's banner is gated on `!live`), so the gate lives on that tap:
 * before the take is committed to any flow, and before handleAutoFlow /
 * onResolve move any pack money.
 *
 * Mock idiom lifted from record-page-outcome-double-tap.test.tsx (same
 * transitive server-module wall); next-intl is key-echoed, so assertions read
 * as translation keys. The real-ja.json call-site check for these keys lives
 * in record-picker-dialog-messages.test.tsx's sibling — see
 * record-no-own-booking-card.test.tsx for the idiom.
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
jest.mock('@/actions/recording-discard', () => ({ discardRecordingWithReason: jest.fn() }))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
  deleteCustomerPhoto: jest.fn(),
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

jest.mock('sonner', () => ({
  toast: {
    info: jest.fn(),
    warning: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  },
}))

// D-2 (H-1 armor): COUNTS renders of the supersede confirm, mirroring C-2 in
// record-no-target-page-view.test.tsx. The confirm is inline JSX, so its
// countable boundary is its 中断して開始 button — one render of that button is
// one render of the dialog. The point the counter makes that a queryByText
// cannot: the enforcement lives in the RENDER gate (`showSupersedeDialog &&
// pipeline.state === 'processing'`), not in the effect that follows it. An
// effect-only gate ends on the same empty screen while still painting the
// confirm for one commit — a modal flashing over a take there is nothing left
// to supersede, whose 中断して開始 then runs the stop flow for real.
const mockConfirmRenders = { n: 0 }
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  // A REAL <button> so `disabled` is honored natively, same reason
  // record-page-outcome-double-tap.test.tsx does it.
  const button = ({ children, ...rest }: Record<string, unknown> = {}) => {
    if (children === 'supersedeConfirm') mockConfirmRenders.n++
    return createElement('button', rest, children as React.ReactNode)
  }
  return new Proxy(
    {},
    { get: (_target, prop) => (prop === 'Button' ? button : passthrough) },
  )
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
    target: {
      customerId: 'cust-1',
      customerName: '廣瀬浩子',
      karuteNumber: null,
      appointmentId: 'appt-1',
    },
    takeId: 'take-2',
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    pauseRecording: jest.fn(),
    resumeRecording: jest.fn(),
    discardRecording: jest.fn(),
    awaitRecordingSessionId: jest.fn(async () => null),
  }),
}))

// The live singleton, mutable per test: `state` is what a PREVIOUS take's run
// is doing, `serverOwned` is which arm owns it, and `autosaveSettled` /
// `serverSavedRecordId` are whether that run's RESULT is secured yet (fix
// round 5). Declared inside the factory (jest.mock is hoisted above every
// const) and picked up below via requireMock.
jest.mock('@/lib/global-pipeline', () => ({
  globalPipeline: {
    version: 0,
    state: 'idle',
    step: null,
    result: null,
    error: null,
    context: null,
    serverOwned: false,
    autosaveSettled: false,
    serverSavedRecordId: null,
    subscribe: () => () => {},
    start: jest.fn(),
    retry: jest.fn(),
    reset: jest.fn(),
  },
}))

import { useLayoutEffect } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'

/**
 * Fix round 6 — the race window itself, not a simulation of its inputs. The
 * tap the C-1 gate now catches lands in ONE specific gap: after React commits
 * 'autosaving', before that commit's passive effects flush. Everything keyed on
 * pipeline.state is pending in that gap — ProcessingIndicator's autosave AND
 * this page's dialog-hygiene effect — so the tap's setShowSupersedeDialog(true)
 * is followed, in the same hook queue, by whatever those pending effects
 * dispatch. A hygiene effect that still cleared on 'autosaving' put a false
 * behind the tap's true and the confirm never painted: a dead button in exactly
 * the case it exists for.
 *
 * A LAYOUT effect is the deterministic stand-in for the tap — React runs every
 * layout effect of a commit before any passive effect of it — so this pins the
 * ordering with no timer games. (Same technique as the anti-poisoning test in
 * thin-authed-indicators.test.tsx.)
 */
function TapDuringAutosavingCommit({ phase }: { phase: string }) {
  useLayoutEffect(() => {
    if (phase !== 'autosaving') return
    fireEvent.click(screen.getByText('useRecording'))
  }, [phase])
  return null
}

const mockPipeline = (
  jest.requireMock('@/lib/global-pipeline') as {
    globalPipeline: {
      state: string
      serverOwned: boolean
      autosaveSettled: boolean
      serverSavedRecordId: string | null
      start: jest.Mock
    }
  }
).globalPipeline
const mockToastInfo = (jest.requireMock('sonner') as { toast: { info: jest.Mock } }).toast.info

afterEach(() => {
  cleanup()
  jest.clearAllMocks()
  mockPipeline.state = 'idle'
  mockPipeline.serverOwned = false
  mockPipeline.autosaveSettled = false
  mockPipeline.serverSavedRecordId = null
  mockConfirmRenders.n = 0
})

const NEXT_APPOINTMENT = {
  id: 'appt-1',
  customerName: '廣瀬浩子',
  customerId: 'cust-1',
  karuteNumber: null,
  startTime: '2026-08-20T02:00:00.000Z',
  durationMinutes: 60,
  title: null,
  notes: null,
}

const PROPS = {
  customers: [],
  locale: 'ja',
  nextAppointment: NEXT_APPOINTMENT,
  nearbyBookings: [],
  brief: null,
  aiBriefPromise: Promise.resolve(null),
  recentRecordings: [],
  consentDate: null,
  targetPack: null,
  // Tickets OFF → resolveStopFlow is 'save-direct', so 録音を使用 reaches
  // pipeline.start with no outcome dialog in between. The gate under test sits
  // BEFORE that fork, so it covers all three flows.
  ticketsEnabled: false,
}

async function renderRecorded() {
  const view = render(<RecordPageView {...PROPS} />)
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return view
}

// The page plus the tap stand-in above, so the tap can be fired from inside the
// commit that turns 'autosaving' rather than after it.
function RaceHarness({ phase }: { phase: string }) {
  return (
    <>
      <RecordPageView {...PROPS} />
      <TapDuringAutosavingCommit phase={phase} />
    </>
  )
}

async function tapUseRecording() {
  await act(async () => {
    fireEvent.click(screen.getByText('useRecording'))
    await Promise.resolve()
  })
}

describe('C-1 — a second take never silently kills the first', () => {
  it('WEB (in-tab run): asks before superseding, and キャンセル keeps the old run', async () => {
    mockPipeline.state = 'processing'
    mockPipeline.serverOwned = false
    await renderRecorded()

    await tapUseRecording()

    // The confirm, not the handoff.
    expect(screen.getByText('supersedeTitle')).toBeInTheDocument()
    expect(screen.getByText('supersedeDescription')).toBeInTheDocument()
    expect(mockPipeline.start).not.toHaveBeenCalled()
    // No dialog on the path that loses nothing — this one loses the old run.
    expect(mockToastInfo).not.toHaveBeenCalled()

    // キャンセル → the old run lives, the new take is still reviewable.
    await act(async () => {
      fireEvent.click(screen.getByText('cancel'))
      await Promise.resolve()
    })
    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()
    expect(mockPipeline.start).not.toHaveBeenCalled()
    expect(screen.getByText('useRecording')).toBeInTheDocument()
  })

  it('WEB (in-tab run): 中断して開始 supersedes exactly once', async () => {
    mockPipeline.state = 'processing'
    await renderRecorded()

    await tapUseRecording()
    await act(async () => {
      fireEvent.click(screen.getByText('supersedeConfirm'))
      await Promise.resolve()
    })

    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()
    expect(mockPipeline.start).toHaveBeenCalledTimes(1)
  })

  it('THIN (server job): passive notice, no dialog, the handoff proceeds', async () => {
    mockPipeline.state = 'processing'
    mockPipeline.serverOwned = true
    await renderRecorded()

    await tapUseRecording()

    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
    expect(mockToastInfo).toHaveBeenCalledWith('supersedeServerNotice')
    expect(mockPipeline.start).toHaveBeenCalledTimes(1)
  })

  it('the confirm dies with the run it was asking about', async () => {
    // The old run settles while the staffer is still reading the question.
    // There is nothing left to supersede, so the dialog goes — and the flag
    // must go with it, or it springs back open (now untrue) over the NEXT
    // take's run. Same failure B-8 pinned for the customer picker.
    mockPipeline.state = 'processing'
    const { rerender } = await renderRecorded()
    await tapUseRecording()
    expect(screen.getByText('supersedeTitle')).toBeInTheDocument()

    mockPipeline.state = 'idle'
    await act(async () => {
      rerender(<RecordPageView {...PROPS} />)
      await Promise.resolve()
    })
    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()

    // A later take's run starts processing — the dialog stays shut.
    mockPipeline.state = 'processing'
    await act(async () => {
      rerender(<RecordPageView {...PROPS} />)
      await Promise.resolve()
    })
    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()
  })

  it('D-2: the RENDER gate keeps the settled confirm off the screen — zero extra paints', async () => {
    mockPipeline.state = 'processing'
    const { rerender } = await renderRecorded()
    await tapUseRecording()
    expect(screen.getByText('supersedeTitle')).toBeInTheDocument()
    // Everything the confirm paints from here on must be ZERO.
    const rendersAtSettle = mockConfirmRenders.n

    // The old run settles into 'review' — it is off the pipeline's live path,
    // so there is nothing left to ask about. The flag is still true for this
    // commit; only the render gate stands between the staffer and a modal that
    // is now a lie. ('autosaving' is deliberately NOT the settle state here
    // since fix round 5 — an unsettled autosave is exactly what the gate asks
    // about, so the confirm has to survive that transition.)
    mockPipeline.state = 'review'
    await act(async () => {
      rerender(<RecordPageView {...PROPS} />)
      await Promise.resolve()
    })

    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()
    // Not "gone by the end of the commit" — never painted at all.
    expect(mockConfirmRenders.n).toBe(rendersAtSettle)
    expect(mockPipeline.start).not.toHaveBeenCalled()
  })

  // Fix round 5 (Greptile round-3 finding (a)), retimed in round 7 (round-4
  // P1). 'autosaving' is not one state but two: UNSETTLED, where the run holds
  // a result no record exists for yet, and SETTLED, where the karute is
  // persisted and a tap costs nothing. autosaveSettled is which of the two we
  // are in, and it is read off the LIVE singleton because the render snapshot
  // is a commit stale in exactly this window.
  //
  // Unsettled covers BOTH sub-cases — before the autosave effect flushes, and
  // while its save is in flight — and the gate cannot tell them apart by
  // design: an in-flight save can still fail, and a run superseded before that
  // answer arrives has no review fallback (runId-guarded), which is the same
  // silent loss one step later. The in-flight sub-case is pinned against the
  // REAL pipeline in thin-authed-indicators.test.tsx, where dispatch actually
  // happens; here there is one observable, so there is one test.
  it('autosaving while the save is UNSETTLED (pre-dispatch or in flight): asks, and starts nothing', async () => {
    mockPipeline.state = 'autosaving'
    mockPipeline.autosaveSettled = false
    await renderRecorded()

    await tapUseRecording()

    expect(screen.getByText('supersedeTitle')).toBeInTheDocument()
    expect(mockPipeline.start).not.toHaveBeenCalled()
    expect(mockToastInfo).not.toHaveBeenCalled()
  })

  it('autosaving with the save SETTLED: no dialog, straight through', async () => {
    mockPipeline.state = 'autosaving'
    mockPipeline.autosaveSettled = true
    await renderRecorded()

    await tapUseRecording()

    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()
    expect(mockPipeline.start).toHaveBeenCalledTimes(1)
  })

  it('autosaving with the record already saved server-side: no dialog', async () => {
    // The server-job settle branch: the karute exists under this id, so the run
    // has nothing left to lose even with the in-tab settle flag false.
    mockPipeline.state = 'autosaving'
    mockPipeline.autosaveSettled = false
    mockPipeline.serverSavedRecordId = 'record-1'
    await renderRecorded()

    await tapUseRecording()

    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()
    expect(mockPipeline.start).toHaveBeenCalledTimes(1)
  })

  it('the race window itself: a tap landing before the autosave flush still PAINTS the confirm', async () => {
    mockPipeline.state = 'processing'
    const { rerender } = render(<RaceHarness phase="processing" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()

    // The old run reaches 'autosaving' with nothing secured yet, and the tap
    // lands inside that commit — before the autosave effect (which would set
    // autosaveSettled) and before the dialog-hygiene effect have flushed.
    mockPipeline.state = 'autosaving'
    mockPipeline.autosaveSettled = false
    await act(async () => {
      rerender(<RaceHarness phase="autosaving" />)
      await Promise.resolve()
    })

    // Both widenings are load-bearing here: the hygiene effect must not clear
    // the flag the tap just set, and the render gate must let 'autosaving'
    // through. Either one narrow = a dead 録音を使用 button.
    expect(screen.getByText('supersedeTitle')).toBeInTheDocument()
    expect(mockPipeline.start).not.toHaveBeenCalled()
  })

  it('nothing in flight: no dialog, no notice, straight through', async () => {
    await renderRecorded()

    await tapUseRecording()

    expect(screen.queryByText('supersedeTitle')).not.toBeInTheDocument()
    expect(mockToastInfo).not.toHaveBeenCalled()
    expect(mockPipeline.start).toHaveBeenCalledTimes(1)
  })
})

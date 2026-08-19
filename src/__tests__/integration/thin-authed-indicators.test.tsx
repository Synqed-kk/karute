/**
 * @jest-environment jsdom
 *
 * F-8 pin (design-parity inventory, 7/20): the web (app) layout mounts
 * ProcessingIndicator at the layout root, and that component's effect IS the
 * background auto-save executor. The thin tree never mounted it, so on the
 * store binary a booked-customer take with an outcome entered 'autosaving'
 * and hung forever — no saver, no review fallback. These pin the AuthGate
 * mounting: the chip renders over the authed app, and the auto-save actually
 * executes. Both fail on the pre-fix tree (nothing mounted → no chip, no save).
 */
import type { Session } from '@supabase/supabase-js'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { PipelineResult } from '@/lib/ai-pipeline'
import { setSessionState } from '@/lib/auth/mobile/session-store'

// next-intl production-ESM vs CI node 20 (see thin-bottom-nav.test.tsx) —
// mock the hook, feed it the REAL ja.json so label assertions stay honest.
jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    return messages[ns]?.[key] ?? key
  },
}))

// LoginScreen pulls the mobile-auth singleton (thin env → import.meta).
jest.mock('../../../thin/screens/LoginScreen', () => ({
  LoginScreen: () => <div data-testid="login-screen" />,
}))

// The indicators' web-module externals, stubbed at the same seams the thin
// bundle re-wires them (nav port / actions port): the test pins the MOUNTING
// and the save execution, not these transports.
jest.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(props as object)}>{children}</a>
  ),
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}))
jest.mock('@/actions/karute', () => ({
  saveKaruteRecordInline: jest.fn(async () => ({ id: 'saved-1' })),
}))
jest.mock('@/actions/recordings', () => ({
  startRecordingSession: jest.fn(),
}))
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  clearOwnTakes: jest.fn(),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(async () => null),
}))

// Deferred pipeline runs (same pattern as global-pipeline-supersession).
type Deferred = { resolve: (r: PipelineResult) => void; reject: (e: unknown) => void }
const mockDeferreds: Deferred[] = []
jest.mock('@/lib/ai-pipeline', () => ({
  ...jest.requireActual('@/lib/ai-pipeline'),
  runAIPipeline: jest.fn(
    () =>
      new Promise<PipelineResult>((resolve, reject) => {
        mockDeferreds.push({ resolve, reject })
      }),
  ),
}))

import { useLayoutEffect, useRef } from 'react'
import { toast } from 'sonner'
import { saveKaruteRecordInline } from '@/actions/karute'
import { useGlobalPipeline } from '@/hooks/use-global-pipeline'
import { globalPipeline } from '@/lib/global-pipeline'
import { AuthGate } from '../../../thin/AuthGate'

const session = (token: string) => ({ access_token: token }) as Session

const RUN_B_CTX = {
  locale: 'ja',
  customers: [],
  appointmentCustomerId: 'cust-2',
  outcome: { status: 'success' } as never,
}

/**
 * Fix round 5 (Greptile round-3 finding (a), second-order defect). The autosave
 * is a PASSIVE effect: React commits 'autosaving' first and flushes the effect
 * afterwards, so a 録音を使用 tap can land in between and supersede the run —
 * and the pending effect STILL runs, with its closure state stuck at
 * 'autosaving'. A LAYOUT effect on that same commit is the deterministic
 * stand-in for the tap: React runs every layout effect of a commit before any
 * passive effect of it, so this reproduces the exact window with no timer games.
 */
function SupersedeOnAutosavingCommit() {
  const { state } = useGlobalPipeline()
  const firedRef = useRef(false)
  useLayoutEffect(() => {
    if (state !== 'autosaving' || firedRef.current) return
    firedRef.current = true
    globalPipeline.start(new Blob(['b']), RUN_B_CTX)
  }, [state])
  return null
}

beforeEach(() => {
  globalPipeline.reset()
  mockDeferreds.length = 0
  ;(saveKaruteRecordInline as jest.Mock).mockClear()
  // toast is a module-level mock (jest.mock('sonner', ...) factory runs once)
  // — clear it too, or an earlier test's legitimate toast call leaks into a
  // later test's "did NOT toast" assertion (F2 runId-guard tests below).
  ;(toast.success as jest.Mock).mockClear()
  ;(toast.error as jest.Mock).mockClear()
  setSessionState({ status: 'signed-in', session: session('tok') })
})

afterEach(() => {
  // Two-step on purpose (see thin-bottom-nav.test.tsx): only an explicit
  // signed-out clears the store's lastSession.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('AuthGate mounts the recording/processing chrome (F-8)', () => {
  it('shows the processing chip over the authed app while a take transcribes', () => {
    act(() => {
      globalPipeline.start(new Blob(['a']), { locale: 'ja', customers: [] })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    expect(screen.getByTestId('app')).toBeTruthy()
    // ja.json review.transcribing, '...' stripped by the chip
    expect(screen.getByText('文字起こし中')).toBeTruthy()
  })

  it('EXECUTES the background auto-save for a booked customer + outcome', async () => {
    act(() => {
      globalPipeline.start(new Blob(['a']), {
        locale: 'ja',
        customers: [],
        appointmentCustomerId: 'cust-1',
        outcome: { status: 'success' } as never,
      })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      mockDeferreds[0].resolve({ transcript: 't', entries: [], summary: 'S' })
    })
    // Pre-fix tree: state sits in 'autosaving' forever and this never fires.
    await waitFor(() =>
      expect(saveKaruteRecordInline).toHaveBeenCalledTimes(1),
    )
    expect(
      (saveKaruteRecordInline as jest.Mock).mock.calls[0][0],
    ).toMatchObject({ customerId: 'cust-1', summary: 'S' })
    // F2 (packet 12 fix batch): the CURRENT run still toasts — the runId
    // guard added below must not suppress the normal case.
    expect(toast.success).toHaveBeenCalledTimes(1)
    // Fix round 7: the in-tab settle point — the record is persisted, so the
    // C-1 supersession gate stops asking about this run.
    expect(globalPipeline.autosaveSettled).toBe(true)
  })

  // Fix round 7 (Greptile round-4 P1). Round 5 flipped autosaveSettled at
  // DISPATCH, reasoning that an in-flight save can't be lost. It can: the save
  // may answer {error}, and this run's fallback to review is runId-guarded
  // (failAutosaveToReview no-ops on a stale id, as does the error toast), so a
  // run superseded mid-flight and THEN failing is lost with no review screen
  // and no word to the staff. The flag must therefore stay false for the whole
  // in-flight window — that is the exact case the C-1 confirm has to cover.
  it('the save is DISPATCHED but UNSETTLED while in flight — the gate still asks', async () => {
    let resolveSave!: (v: { id: string }) => void
    ;(saveKaruteRecordInline as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    act(() => {
      globalPipeline.start(new Blob(['a']), {
        locale: 'ja',
        customers: [],
        appointmentCustomerId: 'cust-1',
        outcome: { status: 'success' } as never,
      })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      mockDeferreds[0].resolve({ transcript: 't', entries: [], summary: 'S' })
    })

    // Dispatched — and still NOT secured. Nothing is persisted yet.
    expect(saveKaruteRecordInline).toHaveBeenCalledTimes(1)
    expect(globalPipeline.autosaveSettled).toBe(false)

    // The record lands: only now does the gate stop asking.
    await act(async () => {
      resolveSave({ id: 'saved-1' })
    })
    expect(globalPipeline.autosaveSettled).toBe(true)
  })

  it('a FAILED save never marks the run settled (the loss the gate protects)', async () => {
    ;(saveKaruteRecordInline as jest.Mock).mockResolvedValueOnce({
      error: 'save failed',
    })
    act(() => {
      globalPipeline.start(new Blob(['a']), {
        locale: 'ja',
        customers: [],
        appointmentCustomerId: 'cust-1',
        outcome: { status: 'success' } as never,
      })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      mockDeferreds[0].resolve({ transcript: 't', entries: [], summary: 'S' })
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    // Dispatch happened, the save failed, no record exists — "dispatched"
    // would have read as secured here, which is precisely the wrong answer.
    expect(globalPipeline.autosaveSettled).toBe(false)
  })

  it('a late success from a superseded run does not stamp the NEW take as settled', async () => {
    let resolveSave!: (v: { id: string }) => void
    ;(saveKaruteRecordInline as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    act(() => {
      globalPipeline.start(new Blob(['a']), {
        locale: 'ja',
        customers: [],
        appointmentCustomerId: 'cust-1',
        outcome: { status: 'success' } as never,
      })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      mockDeferreds[0].resolve({ transcript: 't', entries: [], summary: 'S' })
    })
    // Take B supersedes while A's save is still in flight; start() clears the
    // flag for the new run.
    act(() => {
      globalPipeline.start(new Blob(['b']), { locale: 'ja', customers: [] })
    })
    // A's save lands LATE. Its record is real, but it is A's — B is still
    // unsettled, and stamping the flag here would drop B's own confirm.
    await act(async () => {
      resolveSave({ id: 'saved-1' })
    })
    expect(globalPipeline.autosaveSettled).toBe(false)
  })

  it('a save resolving AFTER a newer run superseded it does NOT toast (F2 runId guard)', async () => {
    let resolveSave!: (v: { id: string }) => void
    ;(saveKaruteRecordInline as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    act(() => {
      globalPipeline.start(new Blob(['a']), {
        locale: 'ja',
        customers: [],
        appointmentCustomerId: 'cust-1',
        outcome: { status: 'success' } as never,
      })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      mockDeferreds[0].resolve({ transcript: 't', entries: [], summary: 'S' })
    })
    // Now 'autosaving' with saveKaruteRecordInline in-flight (not yet
    // resolved). A NEW recording starts, superseding this run — bumps
    // globalPipeline.runId synchronously.
    act(() => {
      globalPipeline.start(new Blob(['b']), { locale: 'ja', customers: [] })
    })
    // The STALE save resolves only now, after the supersession.
    await act(async () => {
      resolveSave({ id: 'saved-1' })
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  // T2 (packet 12 fix batch round 3, test-attack lens): the error branch's
  // toast guard had zero coverage — only the success branch was pinned above.
  it('a save resolving with {error} on the CURRENT run toasts an error (T2)', async () => {
    ;(saveKaruteRecordInline as jest.Mock).mockResolvedValueOnce({
      error: 'save failed',
    })
    act(() => {
      globalPipeline.start(new Blob(['a']), {
        locale: 'ja',
        customers: [],
        appointmentCustomerId: 'cust-1',
        outcome: { status: 'success' } as never,
      })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      mockDeferreds[0].resolve({ transcript: 't', entries: [], summary: 'S' })
    })
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('a save resolving with {error} AFTER a newer run superseded it does NOT toast (T2, error branch)', async () => {
    let resolveSave!: (v: { error: string }) => void
    ;(saveKaruteRecordInline as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    act(() => {
      globalPipeline.start(new Blob(['a']), {
        locale: 'ja',
        customers: [],
        appointmentCustomerId: 'cust-1',
        outcome: { status: 'success' } as never,
      })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    await act(async () => {
      mockDeferreds[0].resolve({ transcript: 't', entries: [], summary: 'S' })
    })
    // Supersede BEFORE the stale save resolves — same runId-bump pattern as
    // the success-branch test above.
    act(() => {
      globalPipeline.start(new Blob(['b']), { locale: 'ja', customers: [] })
    })
    await act(async () => {
      resolveSave({ error: 'save failed' })
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('a supersession between commit and flush leaves the NEXT run able to autosave', async () => {
    act(() => {
      globalPipeline.start(new Blob(['a']), {
        locale: 'ja',
        customers: [],
        appointmentCustomerId: 'cust-1',
        outcome: { status: 'success' } as never,
      })
    })
    render(
      <AuthGate>
        <SupersedeOnAutosavingCommit />
      </AuthGate>,
    )
    // Run A finishes → 'autosaving' commits → the tap stand-in supersedes it
    // with run B before A's autosave effect ever flushes.
    await act(async () => {
      mockDeferreds[0].resolve({ transcript: 't', entries: [], summary: 'A' })
    })
    expect(saveKaruteRecordInline).not.toHaveBeenCalled()
    expect(globalPipeline.state).toBe('processing')

    // Run B now finishes legitimately. Pre-fix, A's stale flush had already
    // stamped B's runId onto the one-shot ref before the result guard bailed,
    // so THIS save never fired and the chip sat at 保存中 forever.
    await act(async () => {
      mockDeferreds[1].resolve({ transcript: 't', entries: [], summary: 'B' })
    })
    await waitFor(() => expect(saveKaruteRecordInline).toHaveBeenCalledTimes(1))
    expect(
      (saveKaruteRecordInline as jest.Mock).mock.calls[0][0],
    ).toMatchObject({ customerId: 'cust-2', summary: 'B' })
  })

  it('keeps the chrome mounted through an offline-resume spell (recovering w/ known session)', () => {
    act(() => {
      globalPipeline.start(new Blob(['a']), { locale: 'ja', customers: [] })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    // beforeEach signed in → lastSession is known; a resume spell must keep
    // the app AND its chrome (a 60-min take keeps transcribing offline).
    act(() => setSessionState({ status: 'recovering' }))
    expect(screen.getByTestId('app')).toBeTruthy()
    expect(screen.getByText('文字起こし中')).toBeTruthy()
  })

  it('unmounts the chrome on sign-out (login screen stays chrome-free)', () => {
    act(() => {
      globalPipeline.start(new Blob(['a']), { locale: 'ja', customers: [] })
    })
    render(
      <AuthGate>
        <div data-testid="app" />
      </AuthGate>,
    )
    // Chip provably UP first — so its absence after sign-out pins the
    // unmount, not an idle pipeline rendering null anyway.
    expect(screen.getByText('文字起こし中')).toBeTruthy()
    act(() => setSessionState({ status: 'signed-out' }))
    expect(screen.getByTestId('login-screen')).toBeTruthy()
    expect(screen.queryByText('文字起こし中')).toBeNull()
  })
})

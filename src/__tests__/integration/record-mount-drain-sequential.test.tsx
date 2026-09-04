/**
 * @jest-environment jsdom
 *
 * The record page's mount drain — ONE take on the wire at a time (capture
 * pipeline PR3 fix round 7, P2).
 *
 * A take is a whole session recording, tens of megabytes. The drain is
 * deliberately sequential because a staffer with three owed takes on salon wifi
 * would otherwise start three PUTs at once, each starving the others (and the
 * app's own calls) until they all time out.
 *
 * The regression this pins: the effect also fired a SECOND, un-awaited call for
 * the recorder's own stopped take. That take is already on the worklist (onstop
 * stamps the duration the list reads), so the line bought nothing — and because
 * it ran outside the loop it put two whole takes on the wire at once, which is
 * exactly what being sequential exists to prevent.
 *
 * The second describe pins fix round 11: the drain runs MORE THAN ONCE per page
 * life. It used to run only at mount, so a take that failed retryably while the
 * staffer stayed on this page — or one whose stop stamp landed after the effect
 * had read the worklist — waited for a REMOUNT, which on the page the recorder
 * lives on is the whole shift.
 *
 * Module walls mirror session-photo-mount-guard.test.tsx (the documented mock
 * set for mounting RecordPageView under jsdom).
 */
import { render, act } from '@testing-library/react'

/** Every take the drain reached, in order, plus the high-water mark of how many
 *  ran AT ONCE — the whole assertion of this file. */
const secured: string[] = []
let live = 0
let mostAtOnce = 0

/** The worklist the store would answer with. Two owed takes by default — the
 *  recorder's own stopped one (it stamped its duration at onstop, so the
 *  worklist names it) and one left over from an earlier stop. */
let owed: string[] = ['take-own', 'take-older']
/** When the last secure attempt FAILED retryably, modelling take-store's own
 *  cooldown: a failed take is hidden from the ELIGIBLE list for a minute, and
 *  visible on the includeCoolingDown one throughout. null = nothing has failed.
 *  Mirrors SECURE_RETRY_COOLDOWN_MS in src/lib/karute/take-store.ts. */
let failedAt: number | null = null
let secureFails = false
const COOLDOWN_MS = 60_000
/** One tick of the page's re-drain: its REDRAIN_MS plus its whole jitter, and a
 *  millisecond so the boundary is never the question under test. */
const REDRAIN_WINDOW_MS = 65_001

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/sessions',
  Link: ({ children }: { children: unknown }) => children,
}))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/actions/recording-discard', () => ({ discardRecordingWithReason: jest.fn() }))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
  uploadCustomerPhoto: jest.fn(async () => ({ photo: { id: 'p1' } })),
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
  toast: { warning: jest.fn(), success: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  return new Proxy({}, { get: () => passthrough })
})
jest.mock('@/lib/karute/take-store', () => ({
  // A2-2: nothing is owed to a discard record here.
  stampDiscardPending: jest.fn(async () => false),
  listPendingDiscardTakes: jest.fn(async () => []),
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
  // The eligible worklist, and — with the flag — the same list plus whatever the
  // cooldown is hiding, which is the read the re-drain's tick decision uses.
  listOwnStoppedUnsecuredTakeIds: jest.fn(async (includeCoolingDown?: boolean) =>
    includeCoolingDown || failedAt === null || Date.now() - failedAt >= COOLDOWN_MS
      ? owed
      : [],
  ),
  getRecoverableTake: jest.fn(async () => null),
  loadTakeBlob: jest.fn(),
}))
// The upload leg itself is not what this file judges — WHEN it runs is. Each
// call holds its slot across a macrotask, so two started together overlap.
jest.mock('@/lib/recording/secure-take', () => ({
  secureTake: jest.fn(async (_port: unknown, takeId: string) => {
    secured.push(takeId)
    live += 1
    mostAtOnce = Math.max(mostAtOnce, live)
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
    live -= 1
    // What the real leg leaves behind: a finalized take drops off the worklist,
    // a retryable failure stamps the moment and stays on it (cooling down).
    if (secureFails) failedAt = Date.now()
    else owed = owed.filter((id) => id !== takeId)
  }),
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
    recordingSessionId: null,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
    discardRecording: jest.fn(),
    awaitRecordingSessionId: jest.fn(async () => null),
  }),
}))

import { listOwnStoppedUnsecuredTakeIds } from '@/lib/karute/take-store'
import { globalRecorder } from '@/lib/global-recorder'
import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'

const baseProps = {
  customers: [],
  locale: 'ja',
  nextAppointment: null,
  nearbyBookings: [],
  brief: null,
  aiBriefPromise: Promise.resolve(null),
  recentRecordings: [],
  consentDate: null,
}

beforeEach(() => {
  secured.length = 0
  live = 0
  mostAtOnce = 0
  owed = ['take-own', 'take-older']
  failedAt = null
  secureFails = false
  jest.mocked(listOwnStoppedUnsecuredTakeIds).mockClear()
})

afterEach(async () => {
  // The drain lock is MODULE-level since fix round 10 (one drain at a time
  // across MOUNTS, not per mount), so a run still on the wire when a test ends
  // would silently no-op the next test's mount. Let it finish — `live` is the
  // slot itself, and it only reads 0 between takes for a microtask.
  for (let i = 0; i < 200 && live > 0; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  globalRecorder.state = 'idle'
  globalRecorder.takeId = null
})

describe('record page mount drain', () => {
  it('secures the owed takes ONE AT A TIME — the recorder’s own take included', async () => {
    // The page mounts with a take the recorder has just stopped: the shape that
    // used to get a second, un-awaited call of its own.
    globalRecorder.state = 'recorded'
    globalRecorder.takeId = 'take-own'

    render(<RecordPageView {...baseProps} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    // ONE on the wire, ever — the whole reason this loop awaits.
    expect(mostAtOnce).toBe(1)
    // …and the worklist itself, in order, once each.
    expect(secured).toEqual(['take-own', 'take-older'])
  })

  // ⚖ AND ONE DRAIN ACROSS MOUNTS (fix round 10, P3). "One in flight" was per
  // MOUNT: a staffer bouncing between 記録 and this page — or React remounting
  // it — ran a whole second drain beside the first, which puts two takes on the
  // wire at once. Exactly the starvation the sequential loop exists to prevent,
  // reintroduced by the mount it lives in.
  it('a second mount never starts a drain beside the running one', async () => {
    const first = render(<RecordPageView {...baseProps} />)
    const second = render(<RecordPageView {...baseProps} />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    expect(mostAtOnce).toBe(1)
    // The worklist is drained ONCE, not once per mount.
    expect(secured).toEqual(['take-own', 'take-older'])

    first.unmount()
    second.unmount()
  })
})

// ⚖ THE DRAIN RUNS MORE THAN ONCE PER PAGE LIFE (fix round 11). Fake timers
// throughout: the whole subject is WHEN the page looks again, and the delay is a
// minute of it.
describe('record page re-drain', () => {
  const mount = () => render(<RecordPageView {...baseProps} />)
  /** Let the mount drain finish (its secure holds a 1 ms slot). */
  const settle = async () => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10)
    })
  }
  const reads = () => jest.mocked(listOwnStoppedUnsecuredTakeIds).mock.calls.length

  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  // THE regression. A take that fails offline used to sit on the device until
  // the staffer navigated away and back — and this is the page they stay on.
  it('retries a take that failed retryably — no remount', async () => {
    owed = ['take-owed']
    secureFails = true

    const view = mount()
    await settle()
    expect(secured).toEqual(['take-owed'])

    // Nothing remounts, nothing is tapped. The cooldown passes and the page
    // asks again by itself.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(REDRAIN_WINDOW_MS)
    })
    expect(secured).toEqual(['take-owed', 'take-owed'])

    view.unmount()
  })

  // The stop that lands AFTER the mount read the worklist — the other half of
  // "once per page life". The stop path secures it itself, un-awaited; when
  // that leg fails, this is what comes back for it.
  it('a stop that lands while the page stays open gets its own re-drain', async () => {
    owed = []

    const view = mount()
    await settle()
    expect(secured).toEqual([])

    await act(async () => {
      globalRecorder.state = 'recorded'
      // notify() is the recorder's own private fan-out — the transition the
      // page subscribes to. Reached directly because nothing here drives a real
      // MediaRecorder.
      ;(globalRecorder as unknown as { notify: () => void }).notify()
      owed = ['take-just-stopped']
      await jest.advanceTimersByTimeAsync(REDRAIN_WINDOW_MS)
    })
    expect(secured).toEqual(['take-just-stopped'])

    view.unmount()
  })

  // A phone locked mid-upload, a WebView the OS froze, a staffer on another tab.
  it('drains when the page comes back to the front', async () => {
    owed = []

    const view = mount()
    await settle()
    expect(secured).toEqual([])

    // A stop landed while this page was in the background.
    owed = ['take-late']
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await jest.advanceTimersByTimeAsync(10)
    })
    expect(secured).toEqual(['take-late'])

    view.unmount()
  })

  // …and it is a TICK, not a heartbeat: nothing owed, nothing scheduled.
  it('stops ticking once nothing is owed', async () => {
    owed = ['take-owed']

    const view = mount()
    await settle()
    expect(secured).toEqual(['take-owed'])
    const afterMount = reads()

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10 * REDRAIN_WINDOW_MS)
    })
    // The worklist was never read again — the page went quiet.
    expect(reads()).toBe(afterMount)
    expect(secured).toEqual(['take-owed'])

    view.unmount()
  })

  // Every timer and listener dies with the mount.
  it('unmount clears the pending re-drain and its listeners', async () => {
    owed = ['take-owed']
    secureFails = true

    const view = mount()
    await settle()
    expect(secured).toEqual(['take-owed'])

    // The re-drain's own wake-up, and nothing else on this page is pending.
    expect(jest.getTimerCount()).toBe(1)
    view.unmount()
    // Genuinely CLEARED, not merely inert: a timer left behind holds the whole
    // effect closure for a minute after the page is gone.
    expect(jest.getTimerCount()).toBe(0)
    const afterUnmount = reads()

    // Everything that would wake a mounted page: the tick, and a return to the
    // front.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await jest.advanceTimersByTimeAsync(10 * REDRAIN_WINDOW_MS)
    })
    expect(reads()).toBe(afterUnmount)
    expect(secured).toEqual(['take-owed'])
  })

  // ⚖ AND A STOP THAT IS STILL BEING WRITTEN GETS ITS OWN WAKE-UP (fix round
  // 17, AE2). The stop leg HOLDS its take while the tail lands, so it is
  // deliberately absent from both worklists in that window — and a drain that
  // ran there used to be the last one this page ever ran: the duration stamp
  // arrives a moment later and makes the take eligible with nobody looking, so
  // a stop-time upload that missed sat on the device until a remount or a
  // return to the front. The leg's own settle notify is the page's way back.
  //
  // The hold is reached through the singleton the way `notify` already is —
  // nothing here drives a real MediaRecorder, and these two facts (state, and
  // whether a leg is still finishing) are exactly what the page subscribes to.
  const legOf = (id: string) => {
    const rec = globalRecorder as unknown as {
      securingTakeIds: Set<string>
      notify: () => void
    }
    return {
      hold: () => rec.securingTakeIds.add(id),
      release: () => rec.securingTakeIds.delete(id),
      notify: () => rec.notify(),
    }
  }

  it('a stop leg that SETTLES wakes the page — the state never changed', async () => {
    owed = []
    // The page is already sitting on a stopped recorder, so the `recorded`
    // transition below cannot fire: this take became drainable at the SETTLE
    // and nowhere else.
    globalRecorder.state = 'recorded'
    const leg = legOf('take-settling')

    const view = mount()
    await settle()
    expect(secured).toEqual([])
    expect(jest.getTimerCount()).toBe(0) // nothing owed, nothing scheduled

    // The leg takes its hold. Still nothing to do, and nothing scheduled.
    await act(async () => {
      leg.hold()
      leg.notify()
      await jest.advanceTimersByTimeAsync(10)
    })
    expect(jest.getTimerCount()).toBe(0)

    // …and it settles: the stamp has landed (the take is owed now) and the
    // recorder says so. Drop the settled edge and the take stays on the device.
    await act(async () => {
      owed = ['take-settling']
      leg.release()
      leg.notify()
      await jest.advanceTimersByTimeAsync(REDRAIN_WINDOW_MS)
    })
    expect(secured).toEqual(['take-settling'])

    view.unmount()
  })

  // The belt under that signal: while a leg is still holding, the page keeps
  // looking. Without it the tick reads an empty worklist — the held take is not
  // on it — and goes quiet inside the very window the take is owed in.
  it('a drain that runs DURING the hold keeps the page looking', async () => {
    owed = []
    const leg = legOf('take-held')
    leg.hold()

    const view = mount()
    await settle()
    expect(secured).toEqual([])
    // Nothing was owed, and yet the page is still coming back — because a leg
    // is still finishing one.
    expect(jest.getTimerCount()).toBe(1)

    await act(async () => {
      owed = ['take-held']
      leg.release()
      await jest.advanceTimersByTimeAsync(REDRAIN_WINDOW_MS)
    })
    expect(secured).toEqual(['take-held'])

    view.unmount()
  })
})

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
 * Module walls mirror session-photo-mount-guard.test.tsx (the documented mock
 * set for mounting RecordPageView under jsdom).
 */
import { render, act } from '@testing-library/react'

/** Every take the drain reached, in order, plus the high-water mark of how many
 *  ran AT ONCE — the whole assertion of this file. */
const secured: string[] = []
let live = 0
let mostAtOnce = 0

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
  // Two owed takes — the recorder's own stopped one (it stamped its duration at
  // onstop, so the worklist names it) and one left over from an earlier stop.
  listOwnStoppedUnsecuredTakeIds: jest.fn(async () => ['take-own', 'take-older']),
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
})

afterEach(() => {
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
})

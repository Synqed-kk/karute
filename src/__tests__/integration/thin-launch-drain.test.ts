/**
 * @jest-environment jsdom
 *
 * ⚖ THE PHONE DRAINS AT LAUNCH (capture pipeline slice five, packet A / D3).
 *
 * Until now the only drain in the app was the record page's mount effect. On
 * the phone that is a page a staffer may not open for a day, so a take whose
 * stop-time upload lost the network sat on the device — audio that exists
 * nowhere else — until somebody happened to walk back onto 録音. The shell
 * reopens far more often than that page does.
 *
 * Every case here imports the module FRESH (`jest.isolateModules`), because it
 * is a side-effect module: the subscription, the visibility listener and the
 * first run all happen at import.
 */

const drainOwedTakes = jest.fn(async (_isActive?: (takeId: string) => boolean) => ({
  busy: false,
  stillOwed: false,
}))
const sweepDiscardTranscripts = jest.fn(async () => {})
const isActiveTake = jest.fn((_id: string) => false)

/** The session the store answers with, and the listener the module registered.
 *  `subscribeSessionState` is captured rather than re-implemented — what is
 *  under test is what the module does when it is NOTIFIED. */
let session: { user: { id: string } } | null = null
let notify: (() => void) | null = null

jest.mock('@/lib/auth/mobile/session-store', () => ({
  getCurrentSession: () => session,
  subscribeSessionState: (l: () => void) => {
    notify = l
    return () => {}
  },
}))
jest.mock('@/lib/global-recorder', () => ({
  globalRecorder: { isActiveTake: (id: string) => isActiveTake(id) },
}))
jest.mock('@/lib/recording/owed-drain', () => ({
  drainOwedTakes: (...a: unknown[]) => (drainOwedTakes as (...a: unknown[]) => unknown)(...a),
}))
jest.mock('@/lib/recording/discard-transcript', () => ({
  sweepDiscardTranscripts: (...a: unknown[]) =>
    (sweepDiscardTranscripts as (...a: unknown[]) => unknown)(...a),
}))

/** Every visibilitychange listener a load() registered. `jest.isolateModules`
 *  gives each case a fresh module registry but NOT a fresh jsdom document, so
 *  without this the eighth case would see all eight modules answer one
 *  foreground. Torn down in afterEach. */
const registered: Array<() => void> = []

/** Import the side-effect module in its own registry, then let its
 *  fire-and-forget run settle. */
async function load() {
  const add = jest
    .spyOn(document, 'addEventListener')
    .mockImplementation((type, listener, opts) => {
      if (type === 'visibilitychange') registered.push(listener as () => void)
      return Object.getPrototypeOf(document).addEventListener.call(
        document,
        type,
        listener as EventListener,
        opts,
      )
    })
  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../thin/data/launch-drain')
    })
  } finally {
    add.mockRestore()
  }
  await settle()
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** What the WebView reports when it comes back from a pocket. */
function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  session = null
  notify = null
  drainOwedTakes.mockClear()
  sweepDiscardTranscripts.mockClear()
  isActiveTake.mockClear()
  setVisibility('visible')
})

afterEach(() => {
  registered.splice(0).forEach((l) => document.removeEventListener('visibilitychange', l))
})

describe('thin launch drain', () => {
  it('a shell that opens SIGNED OUT drains nothing', async () => {
    await load()
    expect(drainOwedTakes).not.toHaveBeenCalled()
    expect(sweepDiscardTranscripts).not.toHaveBeenCalled()
  })

  it('a session already known at load drains, THEN sweeps the owed discard words', async () => {
    // Order matters: a stopped take is secured WHOLE, and the sweep's own
    // staging is for a take that can never be sealed. Asking in the other order
    // would stage a copy of audio the drain was about to finalize.
    const order: string[] = []
    drainOwedTakes.mockImplementation(async () => {
      order.push('drain')
      return { busy: false, stillOwed: false }
    })
    sweepDiscardTranscripts.mockImplementation(async () => {
      order.push('sweep')
    })
    session = { user: { id: 'staff-A' } }

    await load()

    expect(order).toEqual(['drain', 'sweep'])
  })

  it('the probe it hands the drain is the RECORDER’s own live-take answer', async () => {
    // Not an invented "nothing is live": the singleton is in this bundle
    // already (screen-prefetch imports it), so the belt behind the worklist's
    // stopped-only filter is real.
    session = { user: { id: 'staff-A' } }
    await load()

    drainOwedTakes.mock.calls[0][0]!('take-9')
    expect(isActiveTake).toHaveBeenCalledWith('take-9')
  })

  it('the seed→signed-in notify PAIR for one staffer is ONE run, not two', async () => {
    session = { user: { id: 'staff-A' } }
    await load()
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    notify!() // the boot gate settling on the same session it seeded
    await settle()
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)
  })

  it('a sign-OUT then the SAME staffer back in drains again', async () => {
    // The memo has to be reset by the sign-out, or a staffer who signs out and
    // straight back in — the whole shape of a shared iPad — never drains for
    // the rest of the app's life.
    session = { user: { id: 'staff-A' } }
    await load()
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    session = null
    notify!()
    await settle()
    expect(drainOwedTakes).toHaveBeenCalledTimes(1) // nobody to drain for

    session = { user: { id: 'staff-A' } }
    notify!()
    await settle()
    expect(drainOwedTakes).toHaveBeenCalledTimes(2)
  })

  it('a DIFFERENT staffer signing in drains their own owed takes', async () => {
    session = { user: { id: 'staff-A' } }
    await load()

    session = { user: { id: 'staff-B' } }
    notify!()
    await settle()

    // The worklist is scoped by the store's owner gate — this module never
    // names a take itself.
    expect(drainOwedTakes).toHaveBeenCalledTimes(2)
  })

  it('the app coming back to the FOREGROUND drains; going hidden does not', async () => {
    session = { user: { id: 'staff-A' } }
    await load()
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    await settle()
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    await settle()
    expect(drainOwedTakes).toHaveBeenCalledTimes(2)
  })

  it('nothing it can throw reaches the boot — the run is caught and logged', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    drainOwedTakes.mockRejectedValueOnce(new Error('store is gone'))
    session = { user: { id: 'staff-A' } }

    await load()

    expect(warn).toHaveBeenCalled()
    // …and the sweep never ran, because the drain never returned. Nothing on
    // screen was waiting for either.
    expect(sweepDiscardTranscripts).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

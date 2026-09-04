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
 * ⚖ AND IT RUNS ON AN AUTHORITATIVE SIGN-IN, ONCE, WITH A TICK (fix round 3,
 * F6). The first spelling triggered on a uid and memoised it, so the cold
 * launch it exists for was drained against the PRE-RENDER seed's Bearer — which
 * may be expired — and the fresh token a second later carried the same uid, so
 * nothing ran again. It also had no re-entrancy guard of its own and fell
 * through a busy drain straight into the sweep, putting a second whole take on
 * the wire. The trigger is the store's authoritative GENERATION now, the run is
 * single-flight, a busy drain does not sweep, and a take still owed gets one
 * timer at the record page's own cadence.
 *
 * Every case here imports the module FRESH (`jest.isolateModules`), because it
 * is a side-effect module: the subscription and the visibility listener are
 * registered at import.
 */

/** The real `DrainOutcome` shape: `{busy:true}` carries no `stillOwed` at all,
 *  which is the whole point of the busy case below. */
const drainOwedTakes = jest.fn(
  async (
    _isActive?: (takeId: string) => boolean,
  ): Promise<{ busy: boolean; stillOwed?: boolean }> => ({ busy: false, stillOwed: false }),
)
const sweepDiscardTranscripts = jest.fn(async () => {})
const isActiveTake = jest.fn((_id: string) => false)

/** The store's answers, and the listener the module registered.
 *  `subscribeSessionState` is captured rather than re-implemented — what is
 *  under test is what the module does when it is NOTIFIED. */
let state: { status: string } = { status: 'recovering' }
let generation = 0
let notify: (() => void) | null = null

jest.mock('@/lib/auth/mobile/session-store', () => ({
  getSessionState: () => state,
  currentGeneration: () => generation,
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

/** The record page's own cadence, mirrored by the runner (REDRAIN_MS +
 *  REDRAIN_JITTER_MS). Advancing past the top of the window covers the jitter. */
const REDRAIN_WINDOW_MS = 65_000

/** Every visibilitychange listener a load() registered. `jest.isolateModules`
 *  gives each case a fresh module registry but NOT a fresh jsdom document, so
 *  without this the last case would see every module answer one foreground.
 *  Torn down in afterEach. */
const registered: Array<() => void> = []

/** Import the side-effect module in its own registry, then let anything it
 *  started settle. Nothing runs at import any more — the subscriber is what
 *  starts the first drain — so a case that wants a run signs in below. */
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

/** An AUTHORITATIVE transition, exactly as the store spells it: a new
 *  generation, then the notify. A seed and a token rotation do NOT advance the
 *  generation (session-store.ts), which is what `signedInSameGeneration` below
 *  stands in for. */
async function authoritative(status: 'signed-in' | 'signed-out' | 'recovering') {
  generation += 1
  state = { status }
  notify!()
  await settle()
}

/** A token rotation's settle — `applyTokenRotation` (session-store.ts) applies a
 *  same-user TOKEN_REFRESHED IN PLACE: the status becomes 'signed-in' and the
 *  generation deliberately does NOT move, because a rotation stays inside the
 *  current epoch. The one transition the generation cannot see. */
async function signedInSameGeneration() {
  state = { status: 'signed-in' }
  notify!()
  await settle()
}

/** What the WebView reports when it comes back from a pocket. */
function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  jest.useFakeTimers()
  state = { status: 'recovering' }
  generation = 0
  notify = null
  drainOwedTakes.mockClear()
  drainOwedTakes.mockImplementation(async () => ({ busy: false, stillOwed: false }))
  sweepDiscardTranscripts.mockClear()
  sweepDiscardTranscripts.mockImplementation(async () => {})
  isActiveTake.mockClear()
  setVisibility('visible')
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  registered.splice(0).forEach((l) => document.removeEventListener('visibilitychange', l))
})

describe('thin launch drain', () => {
  it('a shell that opens SIGNED OUT drains nothing — and nothing runs at import', async () => {
    // The module body used to end in a bare `run()` "for a session seeded
    // before this module was imported". The entry cannot produce that: import
    // declarations are hoisted, so this body evaluates before bootMobileAuth()
    // AND before setRecordingPipelinePort — a run there would have drained
    // through the WEB port from inside the WebView.
    await load()
    expect(drainOwedTakes).not.toHaveBeenCalled()
    expect(sweepDiscardTranscripts).not.toHaveBeenCalled()
  })

  it('an authoritative SIGN-IN drains, THEN sweeps the owed discard words', async () => {
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

    await load()
    await authoritative('signed-in')

    expect(order).toEqual(['drain', 'sweep'])
  })

  it('the probe it hands the drain is the RECORDER’s own live-take answer', async () => {
    // Not an invented "nothing is live": the singleton is in this bundle
    // already (screen-prefetch imports it), so the belt behind the worklist's
    // stopped-only filter is real.
    await load()
    await authoritative('signed-in')

    drainOwedTakes.mock.calls[0][0]!('take-9')
    expect(isActiveTake).toHaveBeenCalledWith('take-9')
  })

  it('the SAME generation notifying again is ONE run, not two', async () => {
    // A token rotation mirrors into the store without advancing the generation
    // (applyTokenRotation), and so does the pre-render seed. Neither is a new
    // reason to drain.
    await load()
    await authoritative('signed-in')
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    notify!()
    await settle()
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)
  })

  it('a RECOVERING notify drains nothing — but the settle that follows does', async () => {
    // ⚖ THE EXPIRED-SEED CASE (fix round 3, F6). A cold launch with a persisted
    // session whose token has expired used to drain on the SEED: every mint
    // 401'd, each take went into its 60 s cooldown, and the fresh token a
    // moment later carried the same uid — so the launch this module exists for
    // secured nothing and the audio waited for a foreground cycle. Nothing can
    // upload without a valid Bearer anyway, so 'recovering' simply waits.
    await load()
    await authoritative('recovering')
    expect(drainOwedTakes).not.toHaveBeenCalled()

    await authoritative('signed-in')
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)
  })

  // ⚖ A RUN THAT STARTED WHILE RECOVERING CLAIMS NO GENERATION (fix round 5,
  // H1). The subscriber is not the only door into `run()`: the visibilitychange
  // listener and the retry tick both reach it while the store is still
  // 'recovering'. And the one transition the generation cannot see is exactly
  // the one that follows — `applyTokenRotation` flips recovering → signed-in IN
  // PLACE, without bumping it. So a foreground run during recovery memoized
  // that generation, the settle's notify then read "same generation" and
  // returned, and the sign-in's own pass was lost: healed by the 60 s tick at
  // best, and not at all when the recovering pass threw and armed none.
  it('a run started while RECOVERING does not spend the sign-in’s turn', async () => {
    await load()
    await authoritative('recovering')
    expect(drainOwedTakes).not.toHaveBeenCalled()

    // The phone comes back from a pocket while the boot is still settling.
    setVisibility('visible')
    await settle()
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    // …and the settle lands as a token rotation: signed-in, same generation.
    await signedInSameGeneration()
    expect(drainOwedTakes).toHaveBeenCalledTimes(2)
  })

  it('a sign-OUT then the SAME staffer back in drains again', async () => {
    // A shared iPad hands the phone on. Both transitions are authoritative, so
    // the generation moves twice and the memo cannot hold the second sign-in
    // back.
    await load()
    await authoritative('signed-in')
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    await authoritative('signed-out')
    expect(drainOwedTakes).toHaveBeenCalledTimes(1) // nobody to drain for

    await authoritative('signed-in')
    expect(drainOwedTakes).toHaveBeenCalledTimes(2)
  })

  it('the app coming back to the FOREGROUND drains; going hidden does not', async () => {
    await load()
    await authoritative('signed-in')
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    await settle()
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    await settle()
    expect(drainOwedTakes).toHaveBeenCalledTimes(2)
  })

  it('a BUSY drain does not fall through to the sweep', async () => {
    // The record page's own drain holds the lock and is working this very
    // worklist. The sweep's staging is a whole-take upload of its own, so
    // running it here is the second recording on the wire that lifting the lock
    // to module scope was meant to prevent.
    drainOwedTakes.mockImplementation(async () => ({ busy: true }))

    await load()
    await authoritative('signed-in')

    expect(drainOwedTakes).toHaveBeenCalledTimes(1)
    expect(sweepDiscardTranscripts).not.toHaveBeenCalled()
  })

  it('two triggers landing together are ONE run', async () => {
    // A foreground event arriving while the sign-in's drain is still working.
    let release: (() => void) | null = null
    drainOwedTakes.mockImplementation(async () => {
      await new Promise<void>((r) => {
        release = r
      })
      return { busy: false, stillOwed: false }
    })

    await load()
    void authoritative('signed-in')
    await settle()
    setVisibility('visible')
    await settle()

    expect(drainOwedTakes).toHaveBeenCalledTimes(1)
    release!()
    await settle()
  })

  // ⚖ JOINING A RUN IS NOT HAVING ONE (fix round 4, G1). The shared iPad: A
  // signs out mid-upload, B signs in while A's pass is still in flight. The
  // single-flight guard hands B's trigger A's promise — right, one drain at a
  // time — but A's pass is scoped to A (the worklist is owner-gated), so it
  // never looked at B's owed takes. The memo used to be written by the
  // SUBSCRIBER, so B's generation was marked drained by a run that was never
  // B's, and the only heal left was the `stillOwed` tick at the end of A's pass
  // — which a `busy` outcome also schedules and a THROW does not schedule at
  // all. A delay standing in for a guarantee, on audio that exists nowhere else.
  describe('a sign-in that lands DURING a run', () => {
    /** A drain that does not answer until the case says so — A's pass, held
     *  open across B's sign-in. */
    function heldDrain() {
      let release!: () => void
      const gate = new Promise<void>((r) => {
        release = r
      })
      drainOwedTakes.mockImplementationOnce(async () => {
        await gate
        return { busy: false, stillOwed: false }
      })
      return () => release()
    }

    it('gets its OWN run when the previous staffer’s finishes — no timer, no foreground', async () => {
      const release = heldDrain()
      await load()
      await authoritative('signed-in') // staffer A
      expect(drainOwedTakes).toHaveBeenCalledTimes(1)

      await authoritative('signed-in') // staffer B, while A is still working
      expect(drainOwedTakes).toHaveBeenCalledTimes(1) // joined A's promise

      release()
      await settle()
      // B's own pass, immediately: nothing was foregrounded and no timer ran.
      expect(drainOwedTakes).toHaveBeenCalledTimes(2)
    })

    it('…even when the previous staffer’s run THREW', async () => {
      // The case with no heal at all before this round: a throw schedules no
      // tick, so B's takes waited for a foreground cycle or a walk onto 録音.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      let release!: () => void
      const gate = new Promise<void>((r) => {
        release = r
      })
      drainOwedTakes.mockImplementationOnce(async () => {
        await gate
        throw new Error('store is gone')
      })

      await load()
      await authoritative('signed-in')
      await authoritative('signed-in')
      expect(drainOwedTakes).toHaveBeenCalledTimes(1)

      release()
      await settle()
      expect(drainOwedTakes).toHaveBeenCalledTimes(2)
      warn.mockRestore()
    })

    // ⚖ THE ONE THE GENERATION CANNOT SEE (fix round 6). The settle does not
    // always arrive as a new generation: `applyTokenRotation` flips
    // recovering → signed-in IN PLACE. So a foreground pass that began while
    // the boot was still recovering, and a settle that lands DURING it, differ
    // in status and not in the counter — which is why the runner compares a
    // composite key and not a generation. Round 5 fixed the sequential half of
    // this (the pass finishes, then the settle); this is the concurrent half,
    // where the subscriber's run() joins the pass in flight and is served by
    // its tail instead.
    it('a settle landing DURING a recovering pass still gets its own run', async () => {
      const release = heldDrain()
      await load()
      await authoritative('recovering')
      expect(drainOwedTakes).not.toHaveBeenCalled()

      // The phone comes back from a pocket while the boot is still settling.
      setVisibility('visible')
      await settle()
      expect(drainOwedTakes).toHaveBeenCalledTimes(1)

      // …and the token rotation settles mid-pass: signed-in, same generation.
      await signedInSameGeneration()
      expect(drainOwedTakes).toHaveBeenCalledTimes(1) // joined the pass in flight

      release()
      await settle()
      // Its own pass, immediately — no timer, no second foreground.
      expect(drainOwedTakes).toHaveBeenCalledTimes(2)
    })

    // …and the other direction, which is what stops the key from being a
    // busy-loop: a rotation that changes NOTHING the runner serves (already
    // signed-in, same generation) is nothing new to serve.
    it('a same-generation rotation during a SIGNED-IN pass buys no extra run', async () => {
      const release = heldDrain()
      await load()
      await authoritative('signed-in')
      expect(drainOwedTakes).toHaveBeenCalledTimes(1)

      await signedInSameGeneration()
      release()
      await settle()
      expect(drainOwedTakes).toHaveBeenCalledTimes(1)
    })

    it('a SAME-generation notify during a run buys no extra run', async () => {
      // The memo moved to run(), so this is the case that proves it still does
      // the job it was added for: one sign-in, one pass.
      const release = heldDrain()
      await load()
      await authoritative('signed-in')
      expect(drainOwedTakes).toHaveBeenCalledTimes(1)

      notify!()
      await settle()
      release()
      await settle()
      expect(drainOwedTakes).toHaveBeenCalledTimes(1)
    })

    it('a sign-OUT during a run starts nothing after it', async () => {
      // Nobody to drain for; the worklist's owner gate would answer nothing.
      const release = heldDrain()
      await load()
      await authoritative('signed-in')
      await authoritative('signed-out')

      release()
      await settle()
      expect(drainOwedTakes).toHaveBeenCalledTimes(1)
    })
  })

  it('a take STILL OWED gets exactly one more look, at the page’s own cadence', async () => {
    // The record page has this tick and the launch runner had none, so a boot
    // that drained nothing never asked again.
    drainOwedTakes.mockImplementationOnce(async () => ({ busy: false, stillOwed: true }))

    await load()
    await authoritative('signed-in')
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(REDRAIN_WINDOW_MS)
    expect(drainOwedTakes).toHaveBeenCalledTimes(2)

    // …and the second run answered "nothing owed", so it stops there.
    await jest.advanceTimersByTimeAsync(REDRAIN_WINDOW_MS)
    expect(drainOwedTakes).toHaveBeenCalledTimes(2)
  })

  it('a sign-OUT clears the pending re-look', async () => {
    // Nobody to drain for, and the store's owner gate would answer nothing.
    drainOwedTakes.mockImplementation(async () => ({ busy: false, stillOwed: true }))

    await load()
    await authoritative('signed-in')
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)

    await authoritative('signed-out')
    await jest.advanceTimersByTimeAsync(REDRAIN_WINDOW_MS)
    expect(drainOwedTakes).toHaveBeenCalledTimes(1)
  })

  it('nothing it can throw reaches the boot — the run is caught and logged', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    drainOwedTakes.mockRejectedValueOnce(new Error('store is gone'))

    await load()
    await authoritative('signed-in')

    expect(warn).toHaveBeenCalled()
    // …and the sweep never ran, because the drain never returned. Nothing on
    // screen was waiting for either.
    expect(sweepDiscardTranscripts).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

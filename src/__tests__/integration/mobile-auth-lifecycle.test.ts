/**
 * Mobile auth lifecycle checks (packet-01 points 1, 3, 6):
 *   - config validation fails LOUD with no fallback default
 *   - fresh-install Keychain reset (iOS Keychain survives app deletion)
 *   - background-resume single-flight (rapid foregrounds → one recovery)
 *   - sign-out purges local state REGARDLESS of remote revocation outcome
 */
import { loadAuthClientConfig } from '@/lib/auth/mobile/config'
import { purgeResidualKeychainOnFreshInstall } from '@/lib/auth/mobile/secure-storage'
import {
  createSingleFlight,
  createResumeCoordinator,
} from '@/lib/auth/mobile/background-resume'
import { signOutAndPurge } from '@/lib/auth/mobile/session-lifecycle'

describe('loadAuthClientConfig — no fallback default', () => {
  it('returns url + anonKey when both present', () => {
    expect(
      loadAuthClientConfig({
        AUTH_SUPABASE_URL: 'https://p.supabase.co',
        AUTH_SUPABASE_ANON_KEY: 'anon',
      }),
    ).toEqual({ url: 'https://p.supabase.co', anonKey: 'anon' })
  })
  it('missing URL throws (names the var)', () => {
    expect(() => loadAuthClientConfig({ AUTH_SUPABASE_ANON_KEY: 'anon' })).toThrow(
      /AUTH_SUPABASE_URL/,
    )
  })
  it('missing anon key throws (names the var)', () => {
    expect(() => loadAuthClientConfig({ AUTH_SUPABASE_URL: 'https://p.supabase.co' })).toThrow(
      /AUTH_SUPABASE_ANON_KEY/,
    )
  })
})

describe('purgeResidualKeychainOnFreshInstall', () => {
  it('marker present → NOT a fresh install, no purge', async () => {
    const purge = jest.fn(async () => {})
    const setMarker = jest.fn(async () => {})
    const r = await purgeResidualKeychainOnFreshInstall({
      hasInstallMarker: async () => true,
      setInstallMarker: setMarker,
      purgeSecureStore: purge,
    })
    expect(r.purged).toBe(false)
    expect(purge).not.toHaveBeenCalled()
    expect(setMarker).not.toHaveBeenCalled()
  })
  it('marker absent → purge residual Keychain, then set the marker', async () => {
    const order: string[] = []
    const r = await purgeResidualKeychainOnFreshInstall({
      hasInstallMarker: async () => false,
      purgeSecureStore: async () => { order.push('purge') },
      setInstallMarker: async () => { order.push('mark') },
    })
    expect(r.purged).toBe(true)
    expect(order).toEqual(['purge', 'mark'])
  })
})

describe('createSingleFlight', () => {
  it('coalesces concurrent calls into one invocation; re-invokes after settle', async () => {
    let calls = 0
    const flighted = createSingleFlight(async () => {
      calls++
      return calls
    })
    const ps = [flighted(), flighted(), flighted(), flighted(), flighted()]
    const results = await Promise.all(ps)
    expect(calls).toBe(1) // five concurrent calls → one invocation
    expect(results).toEqual([1, 1, 1, 1, 1]) // all share the same result
    await flighted() // a fresh call after the in-flight settled
    expect(calls).toBe(2)
  })
})

describe('createResumeCoordinator', () => {
  it('rapid foregrounds → ONE recovery, then re-enable with the outcome', async () => {
    let recoveries = 0
    const session = { token: 't' }
    const onResumed = jest.fn()
    const onQuiesce = jest.fn()
    const coord = createResumeCoordinator<typeof session>({
      recover: async () => {
        recoveries++
        return session
      },
      onQuiesce,
      onResumed,
    })
    await Promise.all([coord.onAppActive(), coord.onAppActive(), coord.onAppActive()])
    expect(recoveries).toBe(1)
    expect(onResumed).toHaveBeenCalledWith({ status: 'signed-in', session })
    // The WHOLE resume is single-flighted: a burst runs the lifecycle callbacks
    // once, not once per foreground event (they may not be idempotent).
    expect(onQuiesce).toHaveBeenCalledTimes(1)
    expect(onResumed).toHaveBeenCalledTimes(1)
  })

  it('sequential (non-overlapping) foregrounds still each run a full resume', async () => {
    const onResumed = jest.fn()
    const onQuiesce = jest.fn()
    const coord = createResumeCoordinator<{ token: string }>({
      recover: async () => ({ token: 't' }),
      onQuiesce,
      onResumed,
    })
    await coord.onAppActive()
    await coord.onAppActive()
    expect(onQuiesce).toHaveBeenCalledTimes(2)
    expect(onResumed).toHaveBeenCalledTimes(2)
  })

  it('recovery REJECTS (offline) → recovering, NEVER a forced signed-out', async () => {
    const onResumed = jest.fn()
    const onQuiesce = jest.fn()
    const coord = createResumeCoordinator({
      recover: async () => { throw new Error('offline') },
      onQuiesce,
      onResumed,
    })
    await coord.onAppActive()
    expect(onQuiesce).toHaveBeenCalled()
    expect(onResumed).toHaveBeenCalledWith({ status: 'recovering' })
    expect(onResumed).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'signed-out' }),
    )
  })

  it('recovery HANGS (offline + expired token — the spike behavior) → recovering, never silently stuck', async () => {
    // The gap this closes: boot bounds getSession(), but the resume path reused
    // the same unguarded call. A hang (NOT a reject — the spike's proven offline
    // behavior) would leave the app quiesced forever. The bounded gate must fall
    // through to a VISIBLE recovering state instead.
    const onResumed = jest.fn()
    const onQuiesce = jest.fn()
    const coord = createResumeCoordinator<{ token: string }>({
      recover: () => new Promise(() => {}), // never settles — the hang
      onQuiesce,
      onResumed,
      timeoutMs: 10,
    })
    await coord.onAppActive()
    expect(onQuiesce).toHaveBeenCalled()
    expect(onResumed).toHaveBeenCalledWith({ status: 'recovering' })
  })
})

describe('signOutAndPurge — purge-then-revoke (packet 13 fail-closed reorder)', () => {
  it('order is wipe → purge → flip → remote (rewritten from the old remote-first pin)', async () => {
    const order: string[] = []
    const r = await signOutAndPurge({
      captureSession: async () => ({ accessToken: 'captured-token', uid: 'u1' }),
      wipeLocal: async (uid) => { order.push(`wipe:${uid}`) },
      purgeStorage: async () => { order.push('purge') },
      flip: () => order.push('flip'),
      revokeRemote: async () => { order.push('remote') },
    })
    expect(r.remoteOk).toBe(true)
    expect(order).toEqual(['wipe:u1', 'purge', 'flip', 'remote'])
  })

  it('remote revoke THROWS (offline) → local sequence already complete, remoteOk false', async () => {
    const order: string[] = []
    const r = await signOutAndPurge({
      captureSession: async () => ({ accessToken: 'tok', uid: 'u1' }),
      wipeLocal: async () => { order.push('wipe') },
      purgeStorage: async () => { order.push('purge') },
      flip: () => order.push('flip'),
      revokeRemote: async () => { throw new Error('network down') },
    })
    expect(r.remoteOk).toBe(false)
    // the whole point: never stranded — local sequence ran in full regardless
    expect(order).toEqual(['wipe', 'purge', 'flip'])
  })

  it('a revoke that never resolves does not delay purge/flip', async () => {
    const order: string[] = []
    let releaseRevoke!: () => void
    const revokePending = new Promise<void>((resolve) => {
      releaseRevoke = resolve
    })
    const donePromise = signOutAndPurge({
      captureSession: async () => ({ accessToken: 'tok', uid: 'u1' }),
      wipeLocal: async () => { order.push('wipe') },
      purgeStorage: async () => { order.push('purge') },
      flip: () => order.push('flip'),
      revokeRemote: () => revokePending,
    })
    // Flush microtasks WITHOUT ever resolving the revoke — purge/flip must
    // already have landed by the time the revoke is merely PENDING.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['wipe', 'purge', 'flip'])
    releaseRevoke()
    await donePromise
  })
})

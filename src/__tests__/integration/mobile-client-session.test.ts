/**
 * createMobileAuth composition checks (packet-01 point 1 — the GLUE between
 * auth-js and the gate/lifecycle modules). auth-js reports most
 * failures IN-BAND ({ data, error }), so these tests pin the adapter rules:
 *   - a failed session READ surfaces as transient (recovering), never signed-out
 *   - an explicit null session (no error) is the ONLY signed-out
 *   - sign-out purges local state UNCONDITIONALLY, first, before any remote
 *     revoke attempt (packet 13 — fail-closed is the only path now, success
 *     and failure run the IDENTICAL local sequence)
 */
import { createMobileAuth } from '@/lib/auth/mobile/client-session'

const mockGetSession = jest.fn()
const mockStopAutoRefresh = jest.fn(async () => {})

jest.mock('@supabase/auth-js', () => ({
  // signOut is deliberately NOT on this mock: packet 13's signOut() never
  // calls auth.signOut() (it would re-read the storage this module has
  // already purged). getSession() is used by BOOT only now; the sign-out
  // capture reads storage DIRECTLY (packet 14 P1-a — no getSession, no locks,
  // no unbounded refresh). stopAutoRefresh() is called on sign-out (P1-b).
  GoTrueClient: jest.fn(() => ({
    getSession: (...a: unknown[]) => mockGetSession(...a),
    stopAutoRefresh: () => mockStopAutoRefresh(),
    startAutoRefresh: jest.fn(async () => {}),
  })),
}))

function makeAuth(
  overrides: {
    purge?: jest.Mock
    removeItem?: jest.Mock
    /** Raw persisted-session JSON the sign-out capture will read + parse. */
    storedSession?: string | null
  } = {},
) {
  const onSessionState = jest.fn()
  const purge = overrides.purge ?? jest.fn(async () => {})
  const removeItem = overrides.removeItem ?? jest.fn(async () => {})
  const storedSession = overrides.storedSession ?? null
  const auth = createMobileAuth({
    config: { url: 'https://test.supabase.co', anonKey: 'anon' },
    storage: {
      getItem: async () => storedSession,
      setItem: async () => {},
      removeItem,
    },
    appState: { onActive: () => {} },
    onSessionState,
    purgeLocalCaches: purge,
    bootTimeoutMs: 50,
  })
  return { auth, onSessionState, purge, removeItem }
}

/** Our OWN fixture session, serialized exactly as auth-js persists it (the full
 *  session under the storage key — no userStorage configured). The sign-out
 *  capture reads + parses THIS off storage (packet 14 P1-a); safeguard: tests
 *  assert on this fixture string, never on any real/decoded token. */
function storedSessionFixture(overrides: { accessToken?: string; uid?: string } = {}) {
  return JSON.stringify({
    access_token: overrides.accessToken ?? 'fixture-captured-token',
    user: { id: overrides.uid ?? 'staff-A' },
  })
}

/** Flush pending microtasks without resolving anything real — lets an
 *  in-flight signOut() run past its awaited steps up to (but not through) a
 *  deliberately-never-resolving revoke. */
async function flush(n = 10) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockStopAutoRefresh.mockClear()
})

describe('createMobileAuth — session read adapter', () => {
  it('in-band getSession error + null session → boot holds recovering, NEVER signed-out', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'keychain read failed', name: 'AuthError' },
    })
    const { auth } = makeAuth()
    const state = await auth.boot()
    expect(state).toEqual({ status: 'recovering' })
  })

  it('valid session (no error) → signed-in', async () => {
    const session = { access_token: 't' }
    mockGetSession.mockResolvedValue({ data: { session }, error: null })
    const { auth } = makeAuth()
    const state = await auth.boot()
    expect(state).toEqual({ status: 'signed-in', session })
  })

  it('explicit null session, no error → signed-out (the only legitimate logout)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    const { auth } = makeAuth()
    const state = await auth.boot()
    expect(state).toEqual({ status: 'signed-out' })
  })

  it('error alongside a still-usable session → the session wins (signed-in)', async () => {
    const session = { access_token: 't' }
    mockGetSession.mockResolvedValue({
      data: { session },
      error: { message: 'refresh deferred', name: 'AuthError' },
    })
    const { auth } = makeAuth()
    const state = await auth.boot()
    expect(state).toEqual({ status: 'signed-in', session })
  })
})

describe('createMobileAuth — boot/resume share ONE in-flight recovery', () => {
  it('a resume firing during the boot window joins boot\'s getSession, never a second call', async () => {
    let release!: (v: { data: { session: unknown }; error: null }) => void
    mockGetSession.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const { auth } = makeAuth()
    const coordinator = auth.bindLifecycle()

    const bootP = auth.boot()
    const resumeP = coordinator.onAppActive() // mic-permission prompt scenario

    release({ data: { session: { access_token: 't' } }, error: null })
    await Promise.all([bootP, resumeP])
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })
})

describe('createMobileAuth — sign-out adapter (packet 13: purge-then-revoke, always local)', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  // The core rewrite: success and failure of the remote revoke now produce
  // the IDENTICAL local sequence (purge always runs, unconditionally, first)
  // — remoteOk is purely informational (F1/#572's old asymmetry is gone,
  // there is no longer a separate "fail-closed branch").
  it('clean revoke (2xx) → remoteOk true, SAME local purge as a failure', async () => {
    global.fetch = jest.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch
    const { auth, onSessionState, purge, removeItem } = makeAuth({
      storedSession: storedSessionFixture({ uid: 'staff-A' }),
    })
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(true)
    expect(purge).toHaveBeenCalledWith('staff-A')
    expect(removeItem).toHaveBeenCalledWith('karute.auth.session')
    expect(removeItem).toHaveBeenCalledWith('karute.auth.session-code-verifier')
    expect(removeItem).toHaveBeenCalledWith('karute.auth.session-user')
    expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
  })

  it('remote revoke responds non-2xx (5xx) → IDENTICAL local sequence, remoteOk false', async () => {
    global.fetch = jest.fn(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch
    const { auth, onSessionState, purge, removeItem } = makeAuth({
      storedSession: storedSessionFixture({ uid: 'staff-A' }),
    })
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(false)
    expect(purge).toHaveBeenCalledWith('staff-A')
    expect(removeItem).toHaveBeenCalledTimes(3)
    expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
  })

  // packet 14 P3: 401/403/404 mean the user is already logged out server-side
  // (expired/absent) — auth-js's own _signOut treats them as success
  // (GoTrueClient.js:1762-1766). The direct revoke must not misreport them as
  // remoteOk:false. Only a genuine failure (5xx above, network below) does.
  it.each([401, 403, 404])(
    'revoke %s (expired/absent user) → remoteOk true (tolerant)',
    async (status) => {
      global.fetch = jest.fn(
        async () => new Response(null, { status }),
      ) as unknown as typeof fetch
      const { auth, onSessionState, removeItem } = makeAuth({
        storedSession: storedSessionFixture({ uid: 'staff-A' }),
      })
      const r = await auth.signOut()
      expect(r.remoteOk).toBe(true)
      expect(removeItem).toHaveBeenCalledTimes(3)
      expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
    },
  )

  // packet 14 P1-b: the autorefresh ticker must be stopped on sign-out so a
  // surviving 30s tick can't _saveSession a refreshed token back into the
  // storage the purge just emptied and resurrect the session.
  it('stops the autorefresh ticker on sign-out', async () => {
    global.fetch = jest.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch
    const { auth } = makeAuth({ storedSession: storedSessionFixture() })
    await auth.signOut()
    expect(mockStopAutoRefresh).toHaveBeenCalledTimes(1)
  })

  // packet 14 P2: a stalled-not-erroring revoke (no response, never rejects on
  // its own) must be aborted by the timeout → remoteOk false, and the local
  // purge/flip (which ran BEFORE the revoke) is unaffected. The fetch here only
  // rejects when its abort signal fires — proving the TIMEOUT, not a response,
  // is what ends it. bootTimeoutMs (50ms here) is the revoke bound too.
  it('revoke timeout: a hung revoke aborts → remoteOk false, purge/flip already landed', async () => {
    global.fetch = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    ) as unknown as typeof fetch
    const { auth, onSessionState, purge, removeItem } = makeAuth({
      storedSession: storedSessionFixture({ uid: 'staff-A' }),
    })
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(false)
    expect(purge).toHaveBeenCalledWith('staff-A')
    expect(removeItem).toHaveBeenCalledTimes(3)
    expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
  })

  // (d) offline: the transport REJECTS outright (no response at all, not
  // just a non-2xx one) — same local end state, and no unhandled rejection
  // (the internal try/catch around revokeRemote means this test itself is
  // the proof: an escaping rejection would fail the suite).
  it('(d) offline (transport REJECTS) → identical local end state, no unhandled rejection', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const { auth, onSessionState, purge, removeItem } = makeAuth({
      storedSession: storedSessionFixture({ uid: 'staff-A' }),
    })
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(false)
    expect(purge).toHaveBeenCalledWith('staff-A')
    expect(removeItem).toHaveBeenCalledTimes(3)
    expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
  })

  // (a) the revoke must ride the token captured (off storage) BEFORE the purge,
  // sent AFTER storage is already empty — never a fresh post-purge read (which
  // would find nothing). This also PINS the real capture accessor (packet 14
  // P1-a/P3-test): the header token IS the one parsed off the seeded storage, so
  // any mutation to the storage-read capture fails this test. Header equality is
  // against OUR OWN fixture string only ('fixture-captured-token'), never a
  // real/decoded token — safeguard-compliant.
  it('(a) revoke rides the CAPTURED token, fired only after storage is already empty', async () => {
    const removeItem = jest.fn(async () => {})
    let removalsDoneWhenFetchFired = -1
    const fetchSpy = jest.fn<Promise<Response>, [url: string, init?: RequestInit]>(async () => {
      removalsDoneWhenFetchFired = removeItem.mock.calls.length
      return new Response(null, { status: 204 })
    })
    global.fetch = fetchSpy as unknown as typeof fetch
    const { auth } = makeAuth({
      removeItem,
      storedSession: storedSessionFixture({
        accessToken: 'fixture-captured-token',
        uid: 'staff-A',
      }),
    })
    await auth.signOut()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://test.supabase.co/auth/v1/logout?scope=global')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-captured-token', apikey: 'anon' },
    })
    expect(removalsDoneWhenFetchFired).toBe(3) // all three already landed
  })

  // (b) a revoke that never resolves must not delay the local sequence —
  // purge/flip are already done by the time the revoke is merely PENDING.
  it('(b) a revoke that never resolves does not delay purge/flip', async () => {
    global.fetch = jest.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    const { auth, onSessionState, purge, removeItem } = makeAuth({
      storedSession: storedSessionFixture({ uid: 'staff-A' }),
    })
    void auth.signOut() // deliberately not awaited — the revoke never settles
    await flush()
    expect(purge).toHaveBeenCalledWith('staff-A')
    expect(removeItem).toHaveBeenCalledTimes(3)
    expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
  })

  // (c) the uid threaded into purgeLocalCaches is the one captured from the
  // LIVE session, not stale/undefined — the seam this packet adds. The
  // downstream half (purgeLocalCaches === wipeSessionVault({uid}) deleting
  // the right rows through the REAL take-store) is T4's real-chain proof in
  // take-durability.test.ts, extended there for this exact capture idiom.
  it('(c) the uid captured from the live session threads into purgeLocalCaches', async () => {
    global.fetch = jest.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch
    const { auth, purge } = makeAuth({
      storedSession: storedSessionFixture({ uid: 'staff-B' }),
    })
    await auth.signOut()
    expect(purge).toHaveBeenCalledWith('staff-B')
  })

  // No session found at all (already signed out some other way): nothing to
  // revoke — the network call is skipped entirely, matching auth-js's own
  // _signOut (only calls admin.signOut when a token was found), and local
  // purge still runs unconditionally.
  it('no captured session → revoke skipped entirely, local purge still runs', async () => {
    // storage empty (already signed out some other way) → capture reads null.
    const fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    const { auth, onSessionState, purge, removeItem } = makeAuth()
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(purge).toHaveBeenCalledWith(undefined)
    expect(removeItem).toHaveBeenCalledTimes(3)
    expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
  })

  // T3 (packet 12 fix batch round 3), carried forward: the "onSessionState
  // ALWAYS fires" guarantee — a broken storage adapter must not swallow the
  // sign-out this exists for. No longer tied to a revoke failure (there is
  // no longer a separate fail-closed branch); a broken adapter alone proves it.
  it('storage.removeItem REJECTS → onSessionState STILL fires, signOut still resolves', async () => {
    global.fetch = jest.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch
    const removeItem = jest.fn(async () => {
      throw new Error('storage adapter unavailable')
    })
    const { auth, onSessionState, purge } = makeAuth({
      removeItem,
      storedSession: storedSessionFixture({ uid: 'staff-A' }),
    })
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(true)
    expect(purge).toHaveBeenCalledWith('staff-A')
    // All THREE removals attempted despite the rejections (allSettled,
    // Greptile #572) — one failed delete must not retain the sibling keys.
    expect(removeItem).toHaveBeenCalledTimes(3)
    expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
  })
})

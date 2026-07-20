/**
 * createMobileAuth composition checks (packet-01 point 1 — the GLUE between
 * auth-js and the gate/lifecycle modules). auth-js reports most
 * failures IN-BAND ({ data, error }), so these tests pin the adapter rules:
 *   - a failed session READ surfaces as transient (recovering), never signed-out
 *   - an explicit null session (no error) is the ONLY signed-out
 *   - an in-band sign-out failure yields remoteOk: false; local purge still runs
 */
import { createMobileAuth } from '@/lib/auth/mobile/client-session'

const mockGetSession = jest.fn()
const mockSignOut = jest.fn()

jest.mock('@supabase/auth-js', () => ({
  GoTrueClient: jest.fn(() => ({
    getSession: (...a: unknown[]) => mockGetSession(...a),
    signOut: (...a: unknown[]) => mockSignOut(...a),
  })),
}))

function makeAuth(overrides: { purge?: jest.Mock; removeItem?: jest.Mock } = {}) {
  const onSessionState = jest.fn()
  const purge = overrides.purge ?? jest.fn(async () => {})
  const removeItem = overrides.removeItem ?? jest.fn(async () => {})
  const auth = createMobileAuth({
    config: { url: 'https://test.supabase.co', anonKey: 'anon' },
    storage: {
      getItem: async () => null,
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

beforeEach(() => {
  mockGetSession.mockReset()
  mockSignOut.mockReset()
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

describe('createMobileAuth — sign-out adapter', () => {
  it('in-band signOut error → remoteOk false, local purge STILL runs', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'revocation failed' } })
    const purge = jest.fn(async () => {})
    const { auth } = makeAuth({ purge })
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(false)
    expect(purge).toHaveBeenCalledTimes(1)
  })

  it('clean signOut → remoteOk true, purge runs', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    const purge = jest.fn(async () => {})
    const { auth } = makeAuth({ purge })
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(true)
    expect(purge).toHaveBeenCalledTimes(1)
  })

  // F1 (packet 12 fix batch): a remote revoke that REJECTS (offline/5xx, not
  // just an in-band {error}) used to leave the session store untouched —
  // GoTrueClient's own signOut early-returns without removing storage or
  // emitting SIGNED_OUT on a non-401/403/404 error, so nothing else would
  // flip the store. The adapter now forces a local sign-out in that case.
  it('remote revoke REJECTS (network/5xx) → fail-closed: ALL THREE GoTrue storage keys removed + onSessionState forced signed-out, remoteOk still false', async () => {
    mockSignOut.mockRejectedValue(new Error('network error'))
    const { auth, onSessionState, purge, removeItem } = makeAuth()
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(false)
    expect(purge).toHaveBeenCalledTimes(1)
    expect(removeItem).toHaveBeenCalledWith('karute.auth.session')
    expect(removeItem).toHaveBeenCalledWith('karute.auth.session-code-verifier')
    expect(removeItem).toHaveBeenCalledWith('karute.auth.session-user')
    expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
  })

  it('clean signOut → GoTrue owns storage removal + SIGNED_OUT itself: no manual removeItem, no forced onSessionState', async () => {
    mockSignOut.mockResolvedValue({ error: null })
    const { auth, onSessionState, removeItem } = makeAuth()
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(true)
    expect(removeItem).not.toHaveBeenCalled()
    expect(onSessionState).not.toHaveBeenCalled()
  })

  // T3 (packet 12 fix batch round 3): the "onSessionState ALWAYS fires"
  // guarantee was untested — a broken storage adapter must not swallow the
  // fail-closed sign-out this branch exists for.
  it('storage.removeItem REJECTS too → onSessionState STILL forced signed-out, signOut still resolves with remoteOk:false', async () => {
    mockSignOut.mockRejectedValue(new Error('network error'))
    const removeItem = jest.fn(async () => {
      throw new Error('storage adapter unavailable')
    })
    const { auth, onSessionState, purge } = makeAuth({ removeItem })
    const r = await auth.signOut()
    expect(r.remoteOk).toBe(false)
    expect(purge).toHaveBeenCalledTimes(1)
    expect(onSessionState).toHaveBeenCalledWith({ status: 'signed-out' })
  })
})

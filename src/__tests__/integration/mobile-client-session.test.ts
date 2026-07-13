/**
 * createMobileAuth composition checks (packet-01 point 1 — the GLUE between
 * supabase-js and the gate/lifecycle modules). supabase-js reports most
 * failures IN-BAND ({ data, error }), so these tests pin the adapter rules:
 *   - a failed session READ surfaces as transient (recovering), never signed-out
 *   - an explicit null session (no error) is the ONLY signed-out
 *   - an in-band sign-out failure yields remoteOk: false; local purge still runs
 */
import { createMobileAuth } from '@/lib/auth/mobile/client-session'

const mockGetSession = jest.fn()
const mockSignOut = jest.fn()

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getSession: (...a: unknown[]) => mockGetSession(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
  })),
}))

function makeAuth(overrides: { purge?: jest.Mock } = {}) {
  const onSessionState = jest.fn()
  const purge = overrides.purge ?? jest.fn(async () => {})
  const auth = createMobileAuth({
    config: { url: 'https://test.supabase.co', anonKey: 'anon' },
    storage: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    appState: { onActive: () => {} },
    onSessionState,
    purgeLocalCaches: purge,
    bootTimeoutMs: 50,
  })
  return { auth, onSessionState, purge }
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
})

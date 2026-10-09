/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCoachingConsent } from '@/lib/coaching-consent/hooks'
import { getCoachingConsent, decideCoachingConsent } from '@/actions/coaching-consent'

jest.mock('@/actions/coaching-consent', () => ({ getCoachingConsent: jest.fn(), decideCoachingConsent: jest.fn() }))
let authChanged: (_event: string, session: { user: { id: string } } | null) => void
const unsubscribe = jest.fn()
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (callback: typeof authChanged) => { authChanged = callback; return { data: { subscription: { unsubscribe } } } },
} }) }))
const read = jest.mocked(getCoachingConsent), write = jest.mocked(decideCoachingConsent)
const decision = { id: 'decision', status: 'granted' as const, policy_version: 'v1.0-2026-05', decided_at: '2026-09-08T12:00:00Z' }
const state = { current_policy_version: 'v1.0-2026-05', status: 'unset' as const, decision: null }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  read.mockResolvedValue({ ok: true, data: state })
  write.mockResolvedValue({ ok: true, data: decision })
})

it('loads the server decision and never imports a browser-only grant', async () => {
  window.localStorage.setItem('synqed-karute-coaching-consent', JSON.stringify({ status: 'granted' }))
  const { result, unmount } = renderHook(useCoachingConsent)
  expect(result.current.loading).toBe(true)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.status).toBe('unset')
  expect(write).not.toHaveBeenCalled()
  unmount()
  expect(unsubscribe).toHaveBeenCalled()
})

it('does not show a grant until the server confirms it, and suppresses duplicate clicks', async () => {
  const pending = deferred<Awaited<ReturnType<typeof decideCoachingConsent>>>()
  write.mockReturnValueOnce(pending.promise)
  const { result } = renderHook(useCoachingConsent)
  await waitFor(() => expect(result.current.loading).toBe(false))
  let saving!: Promise<boolean>
  act(() => { saving = result.current.decide('granted') })
  expect(result.current.status).toBe('unset')
  expect(result.current.saving).toBe(true)
  await act(async () => { expect(await result.current.decide('granted')).toBe(false) })
  expect(write).toHaveBeenCalledTimes(1)
  expect(write).toHaveBeenCalledWith({ status: 'granted', policy_version: 'v1.0-2026-05' })
  await act(async () => { pending.resolve({ ok: true, data: decision }); expect(await saving).toBe(true) })
  expect(result.current.status).toBe('granted')
  expect(result.current.saving).toBe(false)
})

it('shows read/save failures and does not report an unsaved decision as successful', async () => {
  read.mockResolvedValueOnce({ ok: false, error: 'failed' })
  const { result } = renderHook(useCoachingConsent)
  await waitFor(() => expect(result.current.error).toBe('loadFailed'))
  expect(result.current.status).toBe('unset')
  await act(async () => { await result.current.reload() })
  write.mockRejectedValueOnce(new Error('Network failed'))
  await act(async () => { expect(await result.current.decide('granted')).toBe(false) })
  expect(result.current.error).toBe('saveFailed')
  expect(result.current.status).toBe('unset')
})

it('reloads changed policy and requires a fresh deliberate decision after conflict', async () => {
  const { result } = renderHook(useCoachingConsent)
  await waitFor(() => expect(result.current.loading).toBe(false))
  write.mockResolvedValueOnce({ ok: false, error: 'policyChanged' })
  read.mockResolvedValueOnce({ ok: true, data: { ...state, current_policy_version: 'policy-two' } })
  await act(async () => { expect(await result.current.decide('granted')).toBe(false) })
  expect(result.current.error).toBe('policyChanged')
  expect(result.current.status).toBe('unset')
  expect(result.current.saving).toBe(false)
  await act(async () => { await result.current.decide('declined') })
  expect(write).toHaveBeenLastCalledWith({ status: 'declined', policy_version: 'policy-two' })
})

it('discards an earlier account response after the login changes', async () => {
  const pending = deferred<Awaited<ReturnType<typeof decideCoachingConsent>>>()
  write.mockReturnValueOnce(pending.promise)
  const { result } = renderHook(useCoachingConsent)
  await waitFor(() => expect(result.current.loading).toBe(false))
  let saving!: Promise<boolean>
  act(() => { saving = result.current.decide('granted') })
  await act(async () => { authChanged('SIGNED_IN', { user: { id: 'second-person' } }) })
  expect(result.current.status).toBe('unset')
  await act(async () => { pending.resolve({ ok: true, data: decision }); expect(await saving).toBe(false) })
  expect(result.current.status).toBe('unset')
})

it('preserves a read failure after policy conflict so retry remains available', async () => {
  const { result } = renderHook(useCoachingConsent)
  await waitFor(() => expect(result.current.loading).toBe(false))
  write.mockResolvedValueOnce({ ok: false, error: 'policyChanged' })
  read.mockResolvedValueOnce({ ok: false, error: 'failed' })
  await act(async () => { expect(await result.current.decide('granted')).toBe(false) })
  expect(result.current.error).toBe('loadFailed')
  expect(result.current.saving).toBe(false)
})

it('refuses agreement to a disclosure this UI cannot display but still allows withdrawal', async () => {
  read.mockResolvedValueOnce({ ok: true, data: { ...state, current_policy_version: 'future-policy' } })
  const { result } = renderHook(useCoachingConsent)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.canGrant).toBe(false)
  await act(async () => { expect(await result.current.decide('granted')).toBe(false) })
  expect(write).not.toHaveBeenCalled()
  await act(async () => { await result.current.decide('declined') })
  expect(write).toHaveBeenCalledWith({ status: 'declined', policy_version: 'future-policy' })
})

/**
 * @jest-environment jsdom
 *
 * getActiveStoreId entry of the thin actions port (design-parity packet 12
 * §B-3 S2). Local read, no network — the SAME store-pref module
 * (thin/chrome/store-pref.ts) setActiveStore already writes to, keyed per
 * signed-in user. jsdom (not node) so window.localStorage is real — split
 * from thin-stores-port.test.ts because jsdom has no global Response, which
 * that file's DataPort-based tests need (same split as
 * thin-store-heal.test.ts vs. thin-org-settings-port.test.ts).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { getActiveStoreId } from '../../../thin/ports/actions.vite'
import { setThinActiveStore } from '../../../thin/chrome/store-pref'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import type { Session } from '@supabase/supabase-js'

beforeEach(() => {
  window.localStorage.clear()
  setSessionState({
    status: 'signed-in',
    session: { access_token: 'tok', user: { id: 'u1' } } as Session,
  })
})

afterEach(() => {
  setSessionState({ status: 'signed-out' })
})

describe('thin actions port — getActiveStoreId', () => {
  it('reads the store-pref module directly, no network call', async () => {
    const apiFetch = jest.fn()
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    setThinActiveStore('store-A')

    await expect(getActiveStoreId()).resolves.toBe('store-A')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('null when unset', async () => {
    const apiFetch = jest.fn()
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(getActiveStoreId()).resolves.toBeNull()
  })
})

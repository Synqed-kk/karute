/** @jest-environment jsdom */
// Greptile #1135 F1 (P1): switching stores on the 予約同期 tab must never let
// the previous store's values reach the new store's Save. The store switcher
// (setActiveStore + router.refresh) re-renders SyncSection with a new storeId
// while its state lives on; the section resets, reloads, and drops a late
// answer for a store that is no longer selected.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { SyncSection } from '@/components/settings/redesign/sections/SyncSection'

jest.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))

type Pending = { url: string; init?: RequestInit; resolve: (body: unknown) => void }
let pending: Pending[] = []
// jsdom has no fetch Response — the section reads only these four members.
const reply = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response
const apiFetch = jest.fn((url: string, init?: RequestInit) => {
  if (init?.method === 'POST') return Promise.resolve(reply({ success: true }))
  return new Promise<Response>((res) => {
    pending.push({ url, init, resolve: (body) => res(reply(body)) })
  })
})

const A = { username: 'daikanyama-login', enabled: true }
const B = { configured: false, qrStoreSlug: '' }
const C = { username: 'ginza-login', enabled: false }

const loginInput = () => screen.getByPlaceholderText('loginIdPlaceholder') as HTMLInputElement
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

beforeEach(() => {
  pending = []
  apiFetch.mockClear()
  setDataPort({ apiFetch } as never)
})

describe('SyncSection — store switch (Greptile #1135 F1)', () => {
  it('switch A → B resets the form, fetches again, and B shows its own first-save fields', async () => {
    const { rerender } = render(<SyncSection storeId="store-a" />)
    pending[0].resolve(A)
    await flush()
    expect(loginInput().value).toBe('daikanyama-login')

    rerender(<SyncSection storeId="store-b" />)
    expect(loginInput().value).toBe('')
    expect(apiFetch).toHaveBeenCalledTimes(2)
    pending[1].resolve(B)
    await flush()
    expect(loginInput().value).toBe('')
    expect(screen.getByPlaceholderText('la-estro')).toBeTruthy()

    // Save for B carries only B's values (nothing from A).
    fireEvent.change(loginInput(), { target: { value: 'b-login' } })
    await act(async () => { fireEvent.click(screen.getByText('saveConfig')) })
    const post = apiFetch.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      username: 'b-login', password: '', enabled: false, qrStoreSlug: '', qrStoreId: '',
    })

    // Back to A reloads A's values.
    rerender(<SyncSection storeId="store-a" />)
    pending[2].resolve(A)
    await flush()
    expect(loginInput().value).toBe('daikanyama-login')
    expect(screen.queryByPlaceholderText('la-estro')).toBeNull()
  })

  it("a late A response after switching to B never populates B's form", async () => {
    const { rerender } = render(<SyncSection storeId="store-a" />)
    rerender(<SyncSection storeId="store-b" />)
    pending[1].resolve(B)
    await flush()
    pending[0].resolve(A) // A answers last
    await flush()
    expect(loginInput().value).toBe('')
    expect(screen.getByPlaceholderText('la-estro')).toBeTruthy()
  })

  it('stress: three quick switches, answers out of order → the form shows the LAST store', async () => {
    const { rerender } = render(<SyncSection storeId="store-a" />)
    rerender(<SyncSection storeId="store-b" />)
    rerender(<SyncSection storeId="store-c" />)
    expect(apiFetch).toHaveBeenCalledTimes(3)
    pending[2].resolve(C)
    await flush()
    pending[0].resolve(A)
    await flush()
    pending[1].resolve(B)
    await flush()
    expect(loginInput().value).toBe('ginza-login')
    expect(screen.queryByPlaceholderText('la-estro')).toBeNull()
  })
})

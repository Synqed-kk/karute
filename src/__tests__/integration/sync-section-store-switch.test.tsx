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

type Pending = { url: string; init?: RequestInit; resolve: (body: unknown, status?: number) => void }
let pending: Pending[] = [] // config loads (GET)
let posts: Pending[] = [] // saves and runs (POST), answered by the test
// jsdom has no fetch Response — the section reads only these four members.
const reply = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response
const apiFetch = jest.fn((url: string, init?: RequestInit) => {
  const queue = init?.method === 'POST' ? posts : pending
  return new Promise<Response>((res) => {
    queue.push({ url, init, resolve: (body, status) => res(reply(body, status)) })
  })
})

const A = { username: 'daikanyama-login', enabled: true }
const B = { configured: false, qrStoreSlug: '' }
const C = { username: 'ginza-login', enabled: false }

const loginInput = () => screen.getByPlaceholderText('loginIdPlaceholder') as HTMLInputElement
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

const button = (label: string) => screen.getByText(label) as HTMLButtonElement

beforeEach(() => {
  pending = []
  posts = []
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
      storeId: 'store-b', username: 'b-login', password: '', enabled: false, qrStoreSlug: '', qrStoreId: '',
    })
    // Each load names the store it is for (fix round 2: never the cookie).
    expect(pending.map((p) => p.url)).toEqual([
      '/api/sync/quickreserve/config?storeId=store-a',
      '/api/sync/quickreserve/config?storeId=store-b',
    ])

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

describe('SyncSection — late save/run answers and unloaded forms (fix round 2)', () => {
  it("a save for 代官山 answering after the switch to 銀座 leaves 銀座's form untouched", async () => {
    const { rerender } = render(<SyncSection storeId="store-a" />)
    pending[0].resolve(A)
    await flush()
    await act(async () => { fireEvent.click(button('saveConfig')) })
    expect(JSON.parse(String(posts[0].init!.body)).storeId).toBe('store-a')

    rerender(<SyncSection storeId="store-b" />)
    pending[1].resolve(B)
    await flush()
    posts[0].resolve({ success: true }) // 代官山's answer lands late
    await flush()
    expect(screen.getByPlaceholderText('la-estro')).toBeTruthy() // 銀座's first-save fields stay
    expect(screen.queryByText('syncSection.configSaved')).toBeNull()

    // 銀座's own first save still names its Quick Reserve store (no 400 dead end).
    await act(async () => { fireEvent.click(button('saveConfig')) })
    expect(JSON.parse(String(posts[1].init!.body))).toMatchObject({ storeId: 'store-b', qrStoreSlug: '', qrStoreId: '' })
  })

  it("a run for 代官山 answering after the switch is never shown under 銀座", async () => {
    const { rerender } = render(<SyncSection storeId="store-a" />)
    pending[0].resolve(A)
    await flush()
    await act(async () => { fireEvent.click(button('syncNow')) })
    expect(JSON.parse(String(posts[0].init!.body))).toEqual({ storeId: 'store-a' })
    rerender(<SyncSection storeId="store-b" />)
    pending[1].resolve(B)
    await flush()
    posts[0].resolve({ created: 7, updated: 0, skipped: 0 })
    await flush()
    expect(screen.queryByText('syncSection.result')).toBeNull()
  })

  it('Save is off while the load is in flight, on again once this store loaded', async () => {
    render(<SyncSection storeId="store-a" />)
    expect(button('saveConfig').disabled).toBe(true)
    pending[0].resolve(A)
    await flush()
    expect(button('saveConfig').disabled).toBe(false)
  })

  it('fix round 3 (Opus S2): with no store, Save stays off even after a load', async () => {
    render(<SyncSection storeId={null} />)
    pending[0].resolve(A)
    await flush()
    expect(loginInput().value).toBe('daikanyama-login')
    expect(button('saveConfig').disabled).toBe(true)
  })

  it('a failed load shows the error line and keeps Save off (no blank form over a live row)', async () => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve({ error: 'could not resolve the sync store: core down' }, 502)
    await flush()
    expect(screen.getByText('bookingSyncUnavailable')).toBeTruthy()
    expect(screen.queryByText(/could not resolve/)).toBeNull()
    expect(button('saveConfig').disabled).toBe(true)
  })

  it('a refused load (409) shows the localized not-ready line and keeps Save off', async () => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve({ error: 'qr_store_not_ready' }, 409)
    await flush()
    expect(screen.getByText('bookingSyncStoreNotReady')).toBeTruthy()
    expect(button('saveConfig').disabled).toBe(true)
  })
})

describe('fix round 4 (Opus S4) — the error style follows the run status, not a text prefix', () => {
  it('a last run "ERROR: …" renders the error style, not the emerald box', async () => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve({ ...A, lastStatus: 'ERROR: Store slug / id missing from QR config', lastRunStatus: 'ERROR' })
    await flush()
    const box = screen.getByText(/Store slug \/ id missing/).closest('div')!
    expect(box.className).toContain('bg-red-500/10')
    expect(box.className).not.toContain('emerald')
  })
})

describe('fix round 4 (Opus N3) — staff never see raw English', () => {
  const loaded = async () => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve(A)
    await flush()
  }
  it('a run answering not_configured shows the localized line, not the English message', async () => {
    await loaded()
    await act(async () => { fireEvent.click(button('syncNow')) })
    posts[0].resolve({ code: 'not_configured', message: 'QR sync not configured — save your Quick Reserve login first.' })
    await flush()
    expect(screen.getByText('bookingSyncNotConfigured')).toBeTruthy()
    expect(screen.queryByText(/QR sync not configured/)).toBeNull()
  })
  it('a run 502 shows ONE generic line; the raw cause stays off screen', async () => {
    await loaded()
    await act(async () => { fireEvent.click(button('syncNow')) })
    posts[0].resolve({ error: 'could not resolve the sync store: core down' }, 502)
    await flush()
    expect(screen.getByText('bookingSyncUnavailable')).toBeTruthy()
    expect(screen.queryByText(/core down/)).toBeNull()
  })
  it('a save and a run that succeed show the localized lines', async () => {
    await loaded()
    await act(async () => { fireEvent.click(button('saveConfig')) })
    posts[0].resolve({ success: true })
    await flush()
    expect(screen.getByText('syncSection.configSaved')).toBeTruthy()
    await act(async () => { fireEvent.click(button('syncNow')) })
    posts[1].resolve({ success: true, created: 1, updated: 0, skipped: 0 })
    await flush()
    expect(screen.getByText('syncSection.result')).toBeTruthy()
  })
})

describe('fix round 4 (Opus N2) — a store that cannot sync has its own line', () => {
  it('409 qr_store_unavailable shows the store-unavailable line, not "no store is selected"', async () => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve({ error: 'qr_store_unavailable' }, 409)
    await flush()
    expect(screen.getByText('bookingSyncStoreUnavailable')).toBeTruthy()
    expect(screen.queryByText('bookingSyncStoreNotReady')).toBeNull()
  })
})

describe('fix round 4 (Opus C3 app side) — a changed login needs its password', () => {
  it('Save is off with the localized line until the password is typed', async () => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve(A)
    await flush()
    fireEvent.change(loginInput(), { target: { value: 'other-login' } })
    expect(button('saveConfig').disabled).toBe(true)
    expect(screen.getByText('bookingSyncPasswordRequired')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pw' } })
    expect(button('saveConfig').disabled).toBe(false)
    expect(screen.queryByText('bookingSyncPasswordRequired')).toBeNull()
  })
})

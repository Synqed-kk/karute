/** @jest-environment jsdom */
// S53 PR-C: the 店舗ごとの同期 list renders ONLY for stores.viewAll callers;
// 編集 drives the store selection the per-store form reloads on (PR-A F1);
// 今すぐ同期 runs one row; すべての店舗を同期 runs rows one at a time and
// continues past a failure.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { SyncSection } from '@/components/settings/redesign/sections/SyncSection'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string, p?: Record<string, unknown>) => (p ? `${k}${JSON.stringify(p)}` : k),
}))
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const reply = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response
const ROW = { enabled: true, lastRunStatus: 'OK', lastRunAt: new Date().toISOString(), lastRunError: null, intervalMinutes: 15, hoursStart: 8, hoursEnd: 22 }
const STORES = [
  { ...ROW, storeId: 'store-a', storeName: '代官山', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 222 },
  { ...ROW, storeId: 'store-b', storeName: '銀座', configured: false, qrStoreSlug: null, qrStoreId: null, enabled: false, lastRunStatus: null, lastRunAt: null, intervalMinutes: null },
  { ...ROW, storeId: 'store-c', storeName: '渋谷', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 250 },
  { ...ROW, storeId: 'store-d', storeName: '恵比寿', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 260 },
]

type Run = { storeId: string; resolve: (r: Response) => void }
let runs: Run[] = []
const apiFetch = jest.fn((url: string, init?: RequestInit) => {
  if (url === '/api/sync/quickreserve/configs') return Promise.resolve(reply({ stores: STORES }))
  if (url === '/api/sync/quickreserve/config') return Promise.resolve(reply({ username: 'form-login', enabled: true }))
  if (url === '/api/sync/quickreserve' && init?.method === 'POST') {
    const { storeId } = JSON.parse(String(init.body))
    return new Promise<Response>((resolve) => runs.push({ storeId, resolve }))
  }
  return Promise.reject(new Error(`unexpected ${url}`))
})
const ok = reply({ success: true, created: 1, updated: 2, cancelled: 3, skipped: 4 })
const loginFail = reply({ error: 'QR login failed: 401' }, 502)
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const selectStore = jest.fn(async () => ({ ok: true as const }))
const configsCalls = () => apiFetch.mock.calls.filter(([u]) => u === '/api/sync/quickreserve/configs').length

beforeEach(() => {
  runs = []
  apiFetch.mockClear()
  selectStore.mockClear()
  refresh.mockClear()
  setDataPort({ apiFetch } as never)
})

describe('store isolation — branch-restricted caller', () => {
  it('renders NO list, never asks for it, and no other store name is in the DOM', async () => {
    render(<SyncSection storeId="store-a" showAllStores={false} selectStore={selectStore} />)
    await flush()
    expect(configsCalls()).toBe(0)
    expect(screen.queryByText('blockTitle')).toBeNull()
    for (const name of ['銀座', '渋谷', '恵比寿', '代官山']) expect(document.body.textContent).not.toContain(name)
    expect(screen.getByText('saveConfig')).toBeTruthy() // PR-A's single-store form is unchanged
  })
})

describe('viewAll caller', () => {
  it('lists every store with its state, Quick Reserve store and schedule', async () => {
    render(<SyncSection storeId="store-a" showAllStores selectStore={selectStore} />)
    await flush()
    expect(screen.getByText('scopeLine{"n":4}')).toBeTruthy()
    const a = within(screen.getByTestId('sync-row-store-a'))
    expect(a.getByText('代官山')).toBeTruthy()
    expect(a.getByText('stateHealthy')).toBeTruthy()
    expect(a.getByText('storeNoCell{"id":222}')).toBeTruthy()
    expect(a.getByText('everyMinutes{"minutes":15}')).toBeTruthy()
    expect(a.getByText('hours{"start":8,"end":22}')).toBeTruthy()
    const b = within(screen.getByTestId('sync-row-store-b'))
    expect(b.getByText('stateNotSet')).toBeTruthy()
    expect(b.getByText('setUp')).toBeTruthy()
    expect(b.queryByText('runNow')).toBeNull()
  })

  it('編集 selects that store, and the per-store form reloads for it (PR-A F1 harness)', async () => {
    const { rerender } = render(<SyncSection storeId="store-a" showAllStores selectStore={selectStore} />)
    await flush()
    const formLoads = () => apiFetch.mock.calls.filter(([u]) => u === '/api/sync/quickreserve/config').length
    expect(formLoads()).toBe(1)
    await act(async () => { fireEvent.click(within(screen.getByTestId('sync-row-store-c')).getByText('edit')) })
    expect(selectStore).toHaveBeenCalledWith('store-c')
    expect(refresh).toHaveBeenCalledTimes(1)
    rerender(<SyncSection storeId="store-c" showAllStores selectStore={selectStore} />)
    await flush()
    expect(formLoads()).toBe(2)
    // 設定する drives the same selection (the form then opens in first-save mode).
    await act(async () => { fireEvent.click(within(screen.getByTestId('sync-row-store-b')).getByText('setUp')) })
    expect(selectStore).toHaveBeenLastCalledWith('store-b')
  })

  it('今すぐ同期 runs that row only: 同期中… while pending, then the result; a login failure shows the fix line', async () => {
    render(<SyncSection storeId="store-a" showAllStores selectStore={selectStore} />)
    await flush()
    const row = () => within(screen.getByTestId('sync-row-store-c'))
    await act(async () => { fireEvent.click(row().getByText('runNow')) })
    expect(runs.map((r) => r.storeId)).toEqual(['store-c'])
    expect(row().getByText('runNowPending')).toBeTruthy()
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    expect(row().getByText('runResult{"created":1,"updated":2,"cancelled":3,"skipped":4}')).toBeTruthy()

    await act(async () => { fireEvent.click(row().getByText('runNow')) })
    await act(async () => { runs[1].resolve(loginFail) })
    await flush()
    expect(row().getByText('reasonLoginFix')).toBeTruthy()
  })

  it('すべての店舗を同期 runs configured stores one at a time, continues past a failure, and reports counts', async () => {
    render(<SyncSection storeId="store-a" showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    expect(screen.getByText('runNowPending')).toBeTruthy()
    // Never in parallel: the next store starts only after the previous answers.
    expect(runs.map((r) => r.storeId)).toEqual(['store-a'])
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual(['store-a', 'store-c'])
    await act(async () => { runs[1].resolve(loginFail) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual(['store-a', 'store-c', 'store-d'])
    await act(async () => { runs[2].resolve(ok) })
    await flush()
    expect(screen.getByText('runAllPartial{"total":3,"failed":1}')).toBeTruthy()
    expect(within(screen.getByTestId('run-all-result-store-c')).getByText(/resultFailed\{"reason":"reasonLogin"\}/)).toBeTruthy()
    expect(within(screen.getByTestId('run-all-result-store-d')).getByText(/runResult/)).toBeTruthy()
    expect(screen.queryByTestId('run-all-result-store-b')).toBeNull() // not configured → not run
  })

  it('all succeed → runAllDone', async () => {
    render(<SyncSection storeId="store-a" showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    for (let i = 0; i < 3; i++) {
      await act(async () => { runs[i].resolve(ok) })
      await flush()
    }
    expect(screen.getByText('runAllDone{"n":3}')).toBeTruthy()
  })
})

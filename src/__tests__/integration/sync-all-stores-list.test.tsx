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
  useLocale: () => 'ja',
}))
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const reply = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response
const SCHEDULE = { intervalMinutes: 15, hoursStart: 8, hoursEnd: 22, timezone: 'Asia/Tokyo' }
const ROW = { enabled: true, lastRunStatus: 'OK', lastRunAt: new Date().toISOString(), lastRunReason: null, lastRunCounts: null, schedule: SCHEDULE }
const STORES = [
  { ...ROW, storeId: 'store-a', storeName: '代官山', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 222 },
  { ...ROW, storeId: 'store-b', storeName: '銀座', configured: false, qrStoreSlug: null, qrStoreId: null, enabled: false, lastRunStatus: null, lastRunAt: null, schedule: null },
  { ...ROW, storeId: 'store-c', storeName: '渋谷', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 250 },
  { ...ROW, storeId: 'store-d', storeName: '恵比寿', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 260 },
]

type Run = { storeId: string; resolve: (r: Response) => void }
let runs: Run[] = []
let extraRows: unknown[] = []
const apiFetch = jest.fn((url: string, init?: RequestInit) => {
  if (url === '/api/sync/quickreserve/configs') return Promise.resolve(reply({ stores: [...STORES, ...extraRows] }))
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
  extraRows = []
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
    expect(a.getByText(/^lastRunToday/)).toBeTruthy()
    expect(b.getByText('stateNotSet')).toBeTruthy()
    expect(b.getByText('notSetFact')).toBeTruthy()
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
    // 同期中… on the row's button and in its 最終同期 cell (mock bLastCell)
    expect(row().getByRole('button', { name: 'runNowPending' })).toBeTruthy()
    expect(row().getAllByText('runNowPending')).toHaveLength(2)
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
    expect(screen.getByRole('button', { name: 'runNowPending' })).toBeTruthy()
    // every row in the run shows 同期中… in its 最終同期 cell (mock bLastCell)
    for (const id of ['store-a', 'store-c', 'store-d']) {
      expect(within(screen.getByTestId(`sync-row-${id}`)).getByText('runNowPending')).toBeTruthy()
    }
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

  it('すべての店舗を同期 skips a store whose auto-sync is OFF (its own 今すぐ同期 stays)', async () => {
    extraRows = [{ ...ROW, storeId: 'store-off', storeName: '銀座', configured: true, enabled: false, qrStoreSlug: 'ginza', qrStoreId: 300 }]
    render(<SyncSection storeId="store-a" showAllStores selectStore={selectStore} />)
    await flush()
    expect(within(screen.getByTestId('sync-row-store-off')).getByText('runNow')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    for (let i = 0; i < 3; i++) {
      await act(async () => { runs[i].resolve(ok) })
      await flush()
    }
    expect(runs.map((r) => r.storeId)).toEqual(['store-a', 'store-c', 'store-d'])
    expect(screen.getByText('runAllDone{"n":3}')).toBeTruthy()
    expect(screen.queryByTestId('run-all-result-store-off')).toBeNull()
  })

  it('never two crawls of one store: a row run blocks すべての店舗を同期, and sync-all blocks every row', async () => {
    render(<SyncSection storeId="store-a" showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(within(screen.getByTestId('sync-row-store-a')).getByText('runNow')) })
    const runAllButton = screen.getByText('runAll').closest('button')!
    expect(runAllButton.disabled).toBe(true)
    await act(async () => { fireEvent.click(runAllButton) })
    expect(runs.map((r) => r.storeId)).toEqual(['store-a']) // the attack's ["a","a"] cannot happen
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    for (const id of ['store-a', 'store-c', 'store-d']) {
      const button = within(screen.getByTestId(`sync-row-${id}`)).getByText('runNow').closest('button')!
      expect(button.disabled).toBe(true)
      await act(async () => { fireEvent.click(button) })
    }
    expect(runs.map((r) => r.storeId)).toEqual(['store-a', 'store-a'])
  })

  it.each([
    ['rejects', () => Promise.reject(new Error('action network fail'))],
    ['answers an error', () => Promise.resolve({ error: 'denied' })],
  ])('編集 whose selection %s shows the generic error line, no refresh', async (_label, impl) => {
    selectStore.mockImplementationOnce(impl as never)
    render(<SyncSection storeId="store-a" showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(within(screen.getByTestId('sync-row-store-c')).getByText('edit')) })
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('somethingWentWrong')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('the state re-ticks while mounted: healthy at load, delayed once the minutes pass', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-06T03:00:00Z') }) // 12:00 JST, inside the window
    try {
      const tick = () => act(async () => { await jest.advanceTimersByTimeAsync(0) })
      extraRows = [{ ...ROW, storeId: 'store-e', storeName: '恵比寿2', configured: true, qrStoreSlug: 'e', qrStoreId: 1, lastRunAt: '2026-10-06T02:31:00Z' }]
      render(<SyncSection storeId="store-a" showAllStores selectStore={selectStore} />)
      await tick()
      const e = () => within(screen.getByTestId('sync-row-store-e'))
      expect(e().getByText('stateHealthy')).toBeTruthy() // 29 min, interval 15
      await act(async () => { await jest.advanceTimersByTimeAsync(2 * 60_000) })
      expect(e().getByText('stateDelayed')).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })
})

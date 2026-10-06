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
  { ...ROW, storeId: '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', storeName: '代官山', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 222 },
  { ...ROW, storeId: '2a7c3d9f-4e5b-4c6d-9e7f-8091a2b3c4d5', storeName: '銀座', configured: false, qrStoreSlug: null, qrStoreId: null, enabled: false, lastRunStatus: null, lastRunAt: null, schedule: null },
  { ...ROW, storeId: '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6', storeName: '渋谷', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 250 },
  { ...ROW, storeId: '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7', storeName: '恵比寿', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 260 },
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
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores={false} selectStore={selectStore} />)
    await flush()
    expect(configsCalls()).toBe(0)
    expect(screen.queryByText('blockTitle')).toBeNull()
    for (const name of ['銀座', '渋谷', '恵比寿', '代官山']) expect(document.body.textContent).not.toContain(name)
    expect(screen.getByText('saveConfig')).toBeTruthy() // PR-A's single-store form is unchanged
  })
})

describe('viewAll caller', () => {
  it('lists every store with its state, Quick Reserve store and schedule', async () => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    expect(screen.getByText('scopeLine{"n":4}')).toBeTruthy()
    const a = within(screen.getByTestId('sync-row-1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'))
    expect(a.getByText('代官山')).toBeTruthy()
    expect(a.getByText('stateHealthy')).toBeTruthy()
    expect(a.getByText('storeNoCell{"id":222}')).toBeTruthy()
    expect(a.getByText('everyMinutes{"minutes":15}')).toBeTruthy()
    expect(a.getByText('hours{"start":8,"end":22}')).toBeTruthy()
    const b = within(screen.getByTestId('sync-row-2a7c3d9f-4e5b-4c6d-9e7f-8091a2b3c4d5'))
    expect(a.getByText(/^lastRunToday/)).toBeTruthy()
    expect(b.getByText('stateNotSet')).toBeTruthy()
    expect(b.getByText('notSetFact')).toBeTruthy()
    expect(b.getByText('setUp')).toBeTruthy()
    expect(b.queryByText('runNow')).toBeNull()
  })

  it('an ON store with an empty 稼働時間帯 (9〜9) reads 停止 with the no-auto-sync line; the hours label stays 9〜9', async () => {
    extraRows = [{ ...ROW, storeId: '7d0e1f2a-3b4c-4d5e-8f60-718293a4b5c6', storeName: '中目黒', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 270,
      schedule: { ...SCHEDULE, hoursStart: 9, hoursEnd: 9 } }]
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    const row = within(screen.getByTestId('sync-row-7d0e1f2a-3b4c-4d5e-8f60-718293a4b5c6'))
    expect(row.getByText('stateStopped')).toBeTruthy()
    expect(row.getByText('windowEmpty')).toBeTruthy()
    expect(row.getByText('hours{"start":9,"end":9}')).toBeTruthy()
    // a normal window never shows it
    expect(within(screen.getByTestId('sync-row-1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4')).queryByText('windowEmpty')).toBeNull()
    // the line says AUTO sync stops (the row's 今すぐ同期 still runs), never that the store cannot sync
    const ja = jest.requireActual('../../../messages/ja.json') as { syncAllStores: { windowEmpty: string } }
    const en = jest.requireActual('../../../messages/en.json') as { syncAllStores: { windowEmpty: string } }
    expect(ja.syncAllStores.windowEmpty).toBe('稼働時間帯の開始と終了が同じため、自動では同期されません')
    expect(en.syncAllStores.windowEmpty).toBe('The start and end of the active hours are the same, so this store does not sync automatically')
  })

  it('the block note writes かかわらず in kana', () => {
    const ja = jest.requireActual('../../../messages/ja.json') as { syncAllStores: { blockNote: string } }
    expect(ja.syncAllStores.blockNote).toContain('にかかわらず、')
    expect(ja.syncAllStores.blockNote).not.toContain('関わらず')
  })

  it('a failed last run shows 失敗 and never counts, even if counts reached the row', async () => {
    extraRows = [{ ...ROW, storeId: '8e1f2a3b-4c5d-4e6f-9a70-8192a3b4c5d6', storeName: '目黒', configured: true, qrStoreSlug: 'la-estro', qrStoreId: 280,
      lastRunStatus: 'ERROR', lastRunReason: 'login', lastRunCounts: { created: 5, updated: 6, cancelled: 7 } }]
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    const row = within(screen.getByTestId('sync-row-8e1f2a3b-4c5d-4e6f-9a70-8192a3b4c5d6'))
    expect(row.getByText('lastRunFailed')).toBeTruthy()
    expect(row.queryByText(/lastRunCounts/)).toBeNull()
  })

  it('編集 selects that store, and the per-store form reloads for it (PR-A F1 harness)', async () => {
    const { rerender } = render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    // PR-A's rule (merged S54): every form load names the store it shows.
    const formLoads = () =>
      apiFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/sync/quickreserve/config?'))
    expect(formLoads()).toEqual(['/api/sync/quickreserve/config?storeId=1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'])
    await act(async () => { fireEvent.click(within(screen.getByTestId('sync-row-3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6')).getByText('edit')) })
    expect(selectStore).toHaveBeenCalledWith('3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6')
    expect(refresh).toHaveBeenCalledTimes(1)
    rerender(<SyncSection storeId="3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6" showAllStores selectStore={selectStore} />)
    await flush()
    expect(formLoads()).toEqual([
      '/api/sync/quickreserve/config?storeId=1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4',
      '/api/sync/quickreserve/config?storeId=3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6',
    ])
    // 設定する drives the same selection (the form then opens in first-save mode).
    await act(async () => { fireEvent.click(within(screen.getByTestId('sync-row-2a7c3d9f-4e5b-4c6d-9e7f-8091a2b3c4d5')).getByText('setUp')) })
    expect(selectStore).toHaveBeenLastCalledWith('2a7c3d9f-4e5b-4c6d-9e7f-8091a2b3c4d5')
  })

  it('今すぐ同期 runs that row only: 同期中… while pending, then the result; a login failure shows the fix line', async () => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    const row = () => within(screen.getByTestId('sync-row-3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6'))
    await act(async () => { fireEvent.click(row().getByText('runNow')) })
    expect(runs.map((r) => r.storeId)).toEqual(['3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6'])
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
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    expect(screen.getByRole('button', { name: 'runNowPending' })).toBeTruthy()
    // every row in the run shows 同期中… in its 最終同期 cell (mock bLastCell)
    for (const id of ['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6', '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7']) {
      expect(within(screen.getByTestId(`sync-row-${id}`)).getByText('runNowPending')).toBeTruthy()
    }
    // Never in parallel: the next store starts only after the previous answers.
    expect(runs.map((r) => r.storeId)).toEqual(['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'])
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual(['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6'])
    await act(async () => { runs[1].resolve(loginFail) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual(['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6', '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7'])
    await act(async () => { runs[2].resolve(ok) })
    await flush()
    expect(screen.getByText('runAllPartial{"total":3,"failed":1}')).toBeTruthy()
    expect(within(screen.getByTestId('run-all-result-3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6')).getByText(/resultFailed\{"reason":"reasonLogin"\}/)).toBeTruthy()
    expect(within(screen.getByTestId('run-all-result-4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7')).getByText(/runResult/)).toBeTruthy()
    expect(screen.queryByTestId('run-all-result-2a7c3d9f-4e5b-4c6d-9e7f-8091a2b3c4d5')).toBeNull() // not configured → not run
  })

  it('all succeed → runAllDone', async () => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    for (let i = 0; i < 3; i++) {
      await act(async () => { runs[i].resolve(ok) })
      await flush()
    }
    expect(screen.getByText('runAllDone{"n":3}')).toBeTruthy()
  })

  it('すべての店舗を同期 skips a store whose auto-sync is OFF (its own 今すぐ同期 stays)', async () => {
    extraRows = [{ ...ROW, storeId: '6eb071d2-829f-4a01-91b3-c4d5e6f70819', storeName: '銀座', configured: true, enabled: false, qrStoreSlug: 'ginza', qrStoreId: 300 }]
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    expect(within(screen.getByTestId('sync-row-6eb071d2-829f-4a01-91b3-c4d5e6f70819')).getByText('runNow')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    // while the run is pending, the OFF row is not in it: its 最終同期 cell never reads 同期中…
    expect(screen.getByRole('button', { name: 'runNowPending' })).toBeTruthy()
    expect(within(screen.getByTestId('sync-row-6eb071d2-829f-4a01-91b3-c4d5e6f70819')).queryByText('runNowPending')).toBeNull()
    for (let i = 0; i < 3; i++) {
      await act(async () => { runs[i].resolve(ok) })
      await flush()
    }
    expect(runs.map((r) => r.storeId)).toEqual(['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6', '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7'])
    expect(screen.getByText('runAllDone{"n":3}')).toBeTruthy()
    expect(screen.queryByTestId('run-all-result-6eb071d2-829f-4a01-91b3-c4d5e6f70819')).toBeNull()
  })

  it('never two crawls of one store: a row run blocks すべての店舗を同期, and sync-all blocks every row', async () => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(within(screen.getByTestId('sync-row-1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4')).getByText('runNow')) })
    const runAllButton = screen.getByText('runAll').closest('button')!
    expect(runAllButton.disabled).toBe(true)
    await act(async () => { fireEvent.click(runAllButton) })
    expect(runs.map((r) => r.storeId)).toEqual(['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4']) // the attack's ["a","a"] cannot happen
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    for (const id of ['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6', '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7']) {
      const button = within(screen.getByTestId(`sync-row-${id}`)).getByText('runNow').closest('button')!
      expect(button.disabled).toBe(true)
      await act(async () => { fireEvent.click(button) })
    }
    expect(runs.map((r) => r.storeId)).toEqual(['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'])
  })

  it.each([
    ['rejects', () => Promise.reject(new Error('action network fail'))],
    ['answers an error', () => Promise.resolve({ error: 'denied' })],
  ])('編集 whose selection %s shows the generic error line, no refresh', async (_label, impl) => {
    selectStore.mockImplementationOnce(impl as never)
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(within(screen.getByTestId('sync-row-3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6')).getByText('edit')) })
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('somethingWentWrong')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('the state re-ticks while mounted: healthy at load, delayed once the minutes pass', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-06T03:00:00Z') }) // 12:00 JST, inside the window
    try {
      const tick = () => act(async () => { await jest.advanceTimersByTimeAsync(0) })
      extraRows = [{ ...ROW, storeId: '5daf60c1-718e-4f90-80a2-b3c4d5e6f708', storeName: '恵比寿2', configured: true, qrStoreSlug: 'e', qrStoreId: 1, lastRunAt: '2026-10-06T02:31:00Z' }]
      render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
      await tick()
      const e = () => within(screen.getByTestId('sync-row-5daf60c1-718e-4f90-80a2-b3c4d5e6f708'))
      expect(e().getByText('stateHealthy')).toBeTruthy() // 29 min, interval 15
      await act(async () => { await jest.advanceTimersByTimeAsync(2 * 60_000) })
      expect(e().getByText('stateDelayed')).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })
})

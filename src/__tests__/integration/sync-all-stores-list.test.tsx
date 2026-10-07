/** @jest-environment jsdom */
// S53 PR-C: the 店舗ごとの同期 list renders ONLY for stores.viewAll callers;
// 編集 drives the store selection the per-store form reloads on (PR-A F1);
// 今すぐ同期 runs one row; すべての店舗を同期 runs rows one at a time and
// continues past a failure.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { SyncSection } from '@/components/settings/redesign/sections/SyncSection'
import { snapshot as inFlightNow } from '@/lib/sync/in-flight'

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
// What the form's saves wrote: the next /configs read shows it (store id → row fields).
let saved: Record<string, Record<string, unknown>> = {}
const apiFetch = jest.fn((url: string, init?: RequestInit) => {
  if (url === '/api/sync/quickreserve/configs')
    return Promise.resolve(reply({ stores: [...STORES, ...extraRows].map((s) => ({ ...(s as object), ...saved[(s as { storeId: string }).storeId] })) }))
  if (url === '/api/sync/quickreserve/config' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as { storeId?: string; enabled: boolean }
    if (body.storeId) saved[body.storeId] = { configured: true, enabled: body.enabled, schedule: SCHEDULE, qrStoreSlug: 'ginza', qrStoreId: 300 }
    return Promise.resolve(reply({ success: true }))
  }
  if (url.startsWith('/api/sync/quickreserve/config?')) return Promise.resolve(reply({ username: 'form-login', enabled: true }))
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
  saved = {}
  apiFetch.mockClear()
  selectStore.mockClear()
  refresh.mockClear()
  setDataPort({ apiFetch } as never)
})

// The in-flight set lives for the page (the module), so a test that leaves a
// run pending answers it here; no store stays claimed into the next test.
afterEach(async () => {
  for (let i = 0; i < runs.length; i++) {
    await act(async () => { runs[i].resolve(ok) })
    await flush()
  }
  expect(inFlightNow().size).toBe(0)
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

  it('the lead text says auto-sync OFF stores are left out of すべての店舗を同期 (each can still run alone)', async () => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    expect(screen.getByText('runAllOffNote')).toBeTruthy()
    const ja = jest.requireActual('../../../messages/ja.json') as { syncAllStores: { runAllOffNote: string } }
    const en = jest.requireActual('../../../messages/en.json') as { syncAllStores: { runAllOffNote: string } }
    expect(ja.syncAllStores.runAllOffNote).toBe('自動同期がオフの店舗は、「すべての店舗を同期」では同期されません。各店舗の「今すぐ同期」から1店舗ずつ同期できます。')
    expect(en.syncAllStores.runAllOffNote).toBe('Stores with auto-sync off are left out of "Sync all stores". You can still sync each one with its own "Sync now".')
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

  it.each([
    ['{ code: not_configured, message }', { code: 'not_configured', message: 'Sync not configured' }, 'runFailed'],
    ['a success that also carries a message', { success: true, message: 'done', created: 1, updated: 2, cancelled: 3, skipped: 4 }, 'runResult{"created":1,"updated":2,"cancelled":3,"skipped":4}'],
  ])('a 2xx run answer %s: not configured is decided by code only', async (_label, body, line) => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    const row = () => within(screen.getByTestId('sync-row-3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6'))
    await act(async () => { fireEvent.click(row().getByText('runNow')) })
    await act(async () => { runs[0].resolve(reply(body)) })
    await flush()
    expect(row().getByText(line)).toBeTruthy()
  })

  it('すべての店舗を同期 runs configured stores one at a time, continues past a failure, and reports counts', async () => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    // the sync-all button reads 同期中… (the store running now also shows it on its row button)
    expect(screen.getAllByRole('button', { name: 'runNowPending' }).filter((el) => !el.closest('table'))).toHaveLength(1)
    // every row in the run shows 同期中… in its 最終同期 cell (mock bLastCell)
    for (const id of ['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6', '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7']) {
      // (the store running now reads 同期中… on its button too: it is in flight)
      expect(within(screen.getByTestId(`sync-row-${id}`)).getAllByText('runNowPending').length).toBeGreaterThanOrEqual(1)
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
    // the sync-all button reads 同期中… (the store running now also shows it on its row button)
    expect(screen.getAllByRole('button', { name: 'runNowPending' }).filter((el) => !el.closest('table'))).toHaveLength(1)
    expect(within(screen.getByTestId('sync-row-6eb071d2-829f-4a01-91b3-c4d5e6f70819')).queryByText('runNowPending')).toBeNull()
    for (let i = 0; i < 3; i++) {
      await act(async () => { runs[i].resolve(ok) })
      await flush()
    }
    expect(runs.map((r) => r.storeId)).toEqual(['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6', '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7'])
    expect(screen.getByText('runAllDone{"n":3}')).toBeTruthy()
    expect(screen.queryByTestId('run-all-result-6eb071d2-829f-4a01-91b3-c4d5e6f70819')).toBeNull()
  })

  it('すべての店舗を同期 re-reads the stores first: a store turned OFF after the list loaded is never crawled', async () => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    // the list loaded with 渋谷 ON; the owner then turns it OFF (the form, another session)
    const shibuya = '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6'
    extraRows = []
    apiFetch.mockImplementationOnce((url: string) => {
      expect(url).toBe('/api/sync/quickreserve/configs')
      return Promise.resolve(reply({ stores: STORES.map((s) => (s.storeId === shibuya ? { ...s, enabled: false } : s)) }))
    })
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    // the list shows the answer the run uses: 渋谷 now reads 停止 (OFF)
    expect(within(screen.getByTestId(`sync-row-${shibuya}`)).getByText('stateStopped')).toBeTruthy()
    for (let i = 0; i < 2; i++) {
      await act(async () => { runs[i].resolve(ok) })
      await flush()
    }
    expect(runs.map((r) => r.storeId)).toEqual(['1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4', '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7'])
    expect(screen.getByText('runAllDone{"n":2}')).toBeTruthy()
  })

  it('すべての店舗を同期 that syncs no store (every store OFF at re-read) shows no result banner', async () => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    apiFetch.mockImplementationOnce(() => Promise.resolve(reply({ stores: STORES.map((s) => ({ ...s, enabled: false })) })))
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    expect(runs).toHaveLength(0)
    expect(screen.queryByText(/^runAllDone/)).toBeNull()
    expect(screen.queryByText(/^runAllPartial/)).toBeNull()
    expect(screen.queryByTestId(/^run-all-result-/)).toBeNull()
  })

  it('すべての店舗を同期 that syncs exactly one store shows the banner with n = 1', async () => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    const daikanyama = '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'
    apiFetch.mockImplementationOnce(() => Promise.resolve(reply({ stores: STORES.map((s) => (s.storeId === daikanyama ? s : { ...s, enabled: false })) })))
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama])
    expect(screen.getByText('runAllDone{"n":1}')).toBeTruthy()
    expect(screen.getByTestId(`run-all-result-${daikanyama}`)).toBeTruthy()
  })

  it.each([
    ['answers 502', () => Promise.resolve(reply({ error: 'core down' }, 502))],
    ['rejects', () => Promise.reject(new Error('network'))],
  ])('すべての店舗を同期 whose store re-read %s runs NOTHING (no run on stale rows)', async (_label, impl) => {
    render(<SyncSection storeId="1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4" showAllStores selectStore={selectStore} />)
    await flush()
    apiFetch.mockImplementationOnce(impl as never)
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    expect(runs).toHaveLength(0)
    expect(screen.getByText('runAll').closest('button')!.disabled).toBe(false)
  })

  it('never two crawls of one store: sync-all skips a store whose row run is in flight, and blocks every row', async () => {
    const daikanyama = '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'
    render(<SyncSection storeId={daikanyama} showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(within(screen.getByTestId(`sync-row-${daikanyama}`)).getByText('runNow')) })
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    // 代官山 is in flight from its row: sync-all goes straight to the next store
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama, '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6'])
    // while sync-all runs, no row can start
    for (const id of [daikanyama, '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6', '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7']) {
      const button = within(screen.getByTestId(`sync-row-${id}`)).getByRole('button', { name: /runNow/ }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      await act(async () => { fireEvent.click(button) })
    }
    expect(runs).toHaveLength(2)
    await act(async () => { runs[0].resolve(ok) })
    await act(async () => { runs[1].resolve(ok) })
    await flush()
    await act(async () => { runs[2].resolve(ok) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama, '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6', '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7'])
    expect(screen.getByText('runAllDone{"n":2}')).toBeTruthy() // the skipped store is not reported
  })

  it("one in-flight set: the form's 今すぐ同期 for a store disables that row and sync-all never POSTs for it", async () => {
    const daikanyama = '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'
    render(<SyncSection storeId={daikanyama} showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'syncNow' })) })
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama])
    const row = within(screen.getByTestId(`sync-row-${daikanyama}`))
    expect((row.getByRole('button', { name: 'runNowPending' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(row.getByRole('button', { name: 'runNowPending' })) })
    expect(runs).toHaveLength(1)
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama, '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6'])
    await act(async () => { runs[1].resolve(ok) })
    await flush()
    await act(async () => { runs[2].resolve(ok) })
    await flush()
    expect(runs.filter((r) => r.storeId === daikanyama)).toHaveLength(1)
    await act(async () => { runs[0].resolve(ok) })
    await flush()
  })

  it("one in-flight set: a row run disables the form's 今すぐ同期 and save for that store until it answers", async () => {
    const daikanyama = '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'
    render(<SyncSection storeId={daikanyama} showAllStores selectStore={selectStore} />)
    await flush()
    expect((screen.getByRole('button', { name: 'syncNow' }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => { fireEvent.click(within(screen.getByTestId(`sync-row-${daikanyama}`)).getByText('runNow')) })
    const formButton = screen.getByRole('button', { name: 'syncing' }) as HTMLButtonElement
    expect(formButton.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'saveConfig' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(formButton) })
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama])
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    expect((screen.getByRole('button', { name: 'syncNow' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('leaving the tab mid-run keeps the claim: a remount never posts the in-flight store again, and the old loop starts no queued store', async () => {
    const daikanyama = '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'
    const shibuya = '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6'
    const ebisu = '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7'
    const first = render(<SyncSection storeId={daikanyama} showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama])
    first.unmount() // the owner leaves the sync tab while 代官山 is posting
    render(<SyncSection storeId={daikanyama} showAllStores selectStore={selectStore} />)
    await flush()
    // back on the tab: 代官山 is still in flight (its form and row read pending)
    expect((screen.getByRole('button', { name: 'syncing' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama, shibuya])
    await act(async () => { runs[0].resolve(ok) }) // the old loop's store answers
    await flush()
    // the abandoned loop starts neither 渋谷 nor 恵比寿
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama, shibuya])
    await act(async () => { runs[1].resolve(ok) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama, shibuya, ebisu])
    await act(async () => { runs[2].resolve(ok) })
    await flush()
    expect(runs.filter((r) => r.storeId === daikanyama)).toHaveLength(1)
    expect(screen.getByText('runAllDone{"n":2}')).toBeTruthy()
  })

  it('すべての店舗を同期 re-reads before EACH store: an OFF save that lands while an earlier store runs skips that store (0 POSTs)', async () => {
    const daikanyama = '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'
    const shibuya = '3b8d4eaf-5f6c-4d7e-af80-91a2b3c4d5e6'
    const ebisu = '4c9e5fb0-607d-4e8f-b091-a2b3c4d5e6f7'
    render(<SyncSection storeId={shibuya} showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama])
    // while 代官山 runs, the owner turns 渋谷's auto-sync OFF in the form and saves
    await act(async () => { fireEvent.click(document.querySelector('button.w-11') as HTMLButtonElement) })
    await act(async () => { fireEvent.click(screen.getByText('saveConfig')) })
    await flush()
    expect(saved[shibuya]).toMatchObject({ enabled: false })
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama, ebisu])
    await act(async () => { runs[1].resolve(ok) })
    await flush()
    expect(runs.filter((r) => r.storeId === shibuya)).toHaveLength(0)
    expect(screen.getByText('runAllDone{"n":2}')).toBeTruthy()
    expect(screen.queryByTestId(`run-all-result-${shibuya}`)).toBeNull()
  })

  it("after the form's save answers, the list reloads: a first setup's row shows 今すぐ同期 instead of 未設定", async () => {
    const ginza = '2a7c3d9f-4e5b-4c6d-9e7f-8091a2b3c4d5'
    render(<SyncSection storeId={ginza} showAllStores selectStore={selectStore} />)
    await flush()
    const row = () => within(screen.getByTestId(`sync-row-${ginza}`))
    expect(row().getByText('stateNotSet')).toBeTruthy()
    expect(row().queryByText('runNow')).toBeNull()
    const before = configsCalls()
    await act(async () => { fireEvent.click(screen.getByText('saveConfig')) })
    await flush()
    expect(configsCalls()).toBe(before + 1)
    expect(row().queryByText('stateNotSet')).toBeNull()
    expect(row().getByText('runNow')).toBeTruthy()
  })

  it("after the form's 今すぐ同期 answers, the list reloads", async () => {
    const daikanyama = '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'
    render(<SyncSection storeId={daikanyama} showAllStores selectStore={selectStore} />)
    await flush()
    const before = configsCalls()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'syncNow' })) })
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    expect(configsCalls()).toBe(before + 1)
  })

  it("an abandoned loop's store is released when its POST answers (the set is empty afterwards)", async () => {
    const daikanyama = '1f6b2c8e-3d4a-4b5c-8d6e-7f8091a2b3c4'
    const first = render(<SyncSection storeId={daikanyama} showAllStores selectStore={selectStore} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByText('runAll')) })
    await flush()
    first.unmount()
    expect([...inFlightNow()]).toEqual([daikanyama])
    await act(async () => { runs[0].resolve(ok) })
    await flush()
    expect(inFlightNow().size).toBe(0)
    expect(runs.map((r) => r.storeId)).toEqual([daikanyama])
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

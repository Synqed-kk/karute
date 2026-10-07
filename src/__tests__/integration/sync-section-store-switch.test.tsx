/** @jest-environment jsdom */
// Greptile #1135 F1 (P1): switching stores on the 予約同期 tab must never let
// the previous store's values reach the new store's Save. The store switcher
// (setActiveStore + router.refresh) re-renders SyncSection with a new storeId
// while its state lives on; the section resets, reloads, and drops a late
// answer for a store that is no longer selected.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { SyncSection } from '@/components/settings/redesign/sections/SyncSection'
import { claim, release, snapshot as inFlightNow } from '@/lib/sync/in-flight'

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

// The in-flight set lives for the page (src/lib/sync/in-flight.ts), so a save
// or run a test leaves pending is answered here; no store stays claimed into
// the next test.
afterEach(async () => {
  for (let i = 0; i < posts.length; i++) {
    await act(async () => { posts[i].resolve({ success: true }) })
    await flush()
  }
  expect(inFlightNow().size).toBe(0)
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

  it('while a run is in flight the login field and the auto-sync toggle are disabled (Greptile P2 on #1140)', async () => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve(A)
    await flush()
    const toggle = () => screen.getByText('autoSyncTitle').parentElement!.parentElement!.querySelector('button') as HTMLButtonElement
    expect(loginInput().disabled).toBe(false)
    expect(toggle().disabled).toBe(false)
    // it LOOKS disabled while dead (Greptile P2): the folder's toggle disabled style
    expect(toggle().className).toContain('disabled:opacity-50')
    expect(toggle().className).toContain('disabled:cursor-not-allowed')
    await act(async () => { fireEvent.click(button('syncNow')) })
    expect(loginInput().disabled).toBe(true)
    expect(toggle().disabled).toBe(true)
    posts[0].resolve({ created: 1, updated: 0, skipped: 0 })
    await flush()
    expect(loginInput().disabled).toBe(false)
    expect(toggle().disabled).toBe(false)
  })

  it.each(['invalid_body', 'invalid_store_id'])('a run refused 400 %s shows the generic localized line, never the raw code', async (code) => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve(A)
    await flush()
    await act(async () => { fireEvent.click(button('syncNow')) })
    posts[0].resolve({ error: code }, 400)
    await flush()
    expect(screen.getByText('bookingSyncUnavailable')).toBeTruthy() // PR-A's failureLine: one generic line for any code it has no copy for
    expect(screen.queryByText(new RegExp(code))).toBeNull()
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

describe('fix round 5 (N-c) — a login that only differs by whitespace is not a login change', () => {
  it("loaded 'owner ' + typed 'owner' → Save on, no password line", async () => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve({ username: 'owner ', enabled: true })
    await flush()
    fireEvent.change(loginInput(), { target: { value: 'owner' } })
    expect(button('saveConfig').disabled).toBe(false)
    expect(screen.queryByText('bookingSyncPasswordRequired')).toBeNull()
  })
})

describe("fix round 6 (Greptile P2) — a run on one store never blocks another store's form", () => {
  const runButton = (label: 'syncNow' | 'syncing') => screen.getByText(label, { selector: 'button' }) as HTMLButtonElement

  async function runOnAThenSwitchToB() {
    const { rerender } = render(<SyncSection storeId="store-a" />)
    pending[0].resolve(A)
    await flush()
    await act(async () => { fireEvent.click(button('syncNow')) })
    expect(runButton('syncing').disabled).toBe(true) // A's run is pending (posts[0])
    rerender(<SyncSection storeId="store-b" />)
    pending[1].resolve(B)
    await flush()
    return rerender
  }

  it("A's run pending, switch to B → once B loads, B's Save and run are enabled", async () => {
    await runOnAThenSwitchToB()
    expect(button('saveConfig').disabled).toBe(false)
    expect(runButton('syncNow').disabled).toBe(false)
  })

  it("back to A while A's run is still pending → A shows 同期中 with its controls off again", async () => {
    const rerender = await runOnAThenSwitchToB()
    rerender(<SyncSection storeId="store-a" />)
    pending[2].resolve(A)
    await flush()
    expect(runButton('syncing').disabled).toBe(true)
    expect(button('saveConfig').disabled).toBe(true)
    // A's run answers → A's controls come back.
    posts[0].resolve({ created: 1, updated: 0, skipped: 0 })
    await flush()
    expect(runButton('syncNow').disabled).toBe(false)
  })

  it("A's run answering while B's own run is in flight leaves B disabled (A's finally never clears B)", async () => {
    await runOnAThenSwitchToB()
    await act(async () => { fireEvent.click(button('syncNow')) })
    expect(JSON.parse(String(posts[1].init!.body))).toEqual({ storeId: 'store-b' })
    expect(runButton('syncing').disabled).toBe(true)
    posts[0].resolve({ created: 7, updated: 0, skipped: 0 }) // A answers first
    await flush()
    expect(runButton('syncing').disabled).toBe(true)
    expect(button('saveConfig').disabled).toBe(true)
    posts[1].resolve({ created: 2, updated: 0, skipped: 0 }) // B answers
    await flush()
    expect(runButton('syncNow').disabled).toBe(false)
  })

  // Fix round 7: one marker held only the LAST store started, so A's own
  // pending run was forgotten once B's run began — A came back enabled and a
  // second concurrent A run could start. Every in-flight store stays marked.
  it("(r7) A's run pending, B's run pending, back to A → A stays disabled; each store frees only on its own answer", async () => {
    const rerender = await runOnAThenSwitchToB()
    await act(async () => { fireEvent.click(button('syncNow')) }) // B's run (posts[1])
    expect(JSON.parse(String(posts[1].init!.body))).toEqual({ storeId: 'store-b' })

    rerender(<SyncSection storeId="store-a" />)
    pending[2].resolve(A)
    await flush()
    expect(runButton('syncing').disabled).toBe(true) // A's own run is still in flight
    expect(button('saveConfig').disabled).toBe(true)

    posts[0].resolve({ created: 1, updated: 0, skipped: 0 }) // A answers
    await flush()
    expect(runButton('syncNow').disabled).toBe(false)

    rerender(<SyncSection storeId="store-b" />)
    pending[3].resolve(B)
    await flush()
    expect(runButton('syncing').disabled).toBe(true) // B's run has not answered
    expect(button('saveConfig').disabled).toBe(true)

    posts[1].resolve({ created: 2, updated: 0, skipped: 0 }) // B answers
    await flush()
    expect(runButton('syncNow').disabled).toBe(false)
  })
})

describe('fix round 8 (attack A-6) — a stale reload can no longer overwrite a login just saved', () => {
  const passwordInput = () => document.querySelector('input[type="password"]') as HTMLInputElement

  it("A's save pending, A → B → A, A's reload answers BEFORE the save → the form keeps the NEW login", async () => {
    const { rerender } = render(<SyncSection storeId="store-a" />)
    pending[0].resolve({ username: 'old-login', enabled: true })
    await flush()
    fireEvent.change(loginInput(), { target: { value: 'new-login' } })
    fireEvent.change(passwordInput(), { target: { value: 'new-pw' } })
    await act(async () => { fireEvent.click(button('saveConfig')) }) // posts[0], pending
    expect(JSON.parse(String(posts[0].init!.body))).toMatchObject({ storeId: 'store-a', username: 'new-login' })

    rerender(<SyncSection storeId="store-b" />)
    pending[1].resolve(B)
    await flush()
    rerender(<SyncSection storeId="store-a" />)
    pending[2].resolve({ username: 'old-login', enabled: true }) // read before core saved
    await flush()

    posts[0].resolve({ success: true }) // the save answers last
    await flush()
    expect(screen.getByText('syncSection.configSaved')).toBeTruthy()
    expect(loginInput().value).toBe('new-login')
    expect(screen.queryByText('bookingSyncPasswordRequired')).toBeNull()
    expect(button('saveConfig').disabled).toBe(false)

    // A later save sends the NEW login, never the old one back.
    await act(async () => { fireEvent.click(button('saveConfig')) })
    expect(JSON.parse(String(posts[1].init!.body))).toMatchObject({ storeId: 'store-a', username: 'new-login' })
  })

  it("a reload sent before the save answered and landing AFTER it is dropped (the save's values stand)", async () => {
    const { rerender } = render(<SyncSection storeId="store-a" />)
    pending[0].resolve({ username: 'old-login', enabled: true })
    await flush()
    fireEvent.change(loginInput(), { target: { value: 'new-login' } })
    fireEvent.change(passwordInput(), { target: { value: 'new-pw' } })
    await act(async () => { fireEvent.click(button('saveConfig')) })
    rerender(<SyncSection storeId="store-b" />)
    pending[1].resolve(B)
    await flush()
    rerender(<SyncSection storeId="store-a" />) // reload pending[2] in flight
    posts[0].resolve({ success: true })
    await flush()
    pending[2].resolve({ username: 'old-login', enabled: true }) // stale, lands last
    await flush()
    expect(loginInput().value).toBe('new-login')
    expect(screen.queryByText('bookingSyncPasswordRequired')).toBeNull()
    expect(button('saveConfig').disabled).toBe(false)
  })
})

describe('no store shown — a list run of any store disables the form', () => {
  const runButton = () => screen.getByRole('button', { name: /^sync(Now|ing)$/ }) as HTMLButtonElement
  const toggle = () => screen.getByRole('switch', { name: 'autoSyncTitle' }) as HTMLButtonElement

  it("storeId undefined + any named claim in flight → the form's 今すぐ同期 and toggle are disabled", async () => {
    render(<SyncSection storeId={undefined} />)
    await flush()
    expect([runButton().disabled, toggle().disabled]).toEqual([false, false])
    act(() => { claim('store-x') })
    expect([runButton().disabled, toggle().disabled]).toEqual([true, true])
    act(() => { release('store-x') })
    expect([runButton().disabled, toggle().disabled]).toEqual([false, false])
  })

  it("storeId defined + another store's claim in flight → NOT disabled (unchanged)", async () => {
    render(<SyncSection storeId="store-a" />)
    pending[0].resolve(A)
    await flush()
    act(() => { claim('store-x') })
    expect([runButton().disabled, toggle().disabled]).toEqual([false, false])
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    act(() => { release('store-x') })
  })
})

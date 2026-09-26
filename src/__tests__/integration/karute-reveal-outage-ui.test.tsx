/** @jest-environment jsdom */
/**
 * Round 3 item 8, first leg (lesson 111): the カルテ list's search-reveal
 * prints an honest line when the check itself could not run.
 *
 * revealNoKaruteCustomer SETTLES on every failure — the web action's catch
 * and the thin port's catch both return `{ error }`, never throw. The list
 * used to read that answer as `'candidate' in result ? … : null`, so a
 * synqed-core outage while staff typed a walk-in's name printed exactly like
 * "nobody matches": no カルテを作成 row, and nothing saying the check never
 * ran. Now `{ error }` puts ONE line (karute.recordList.revealFailed) in the
 * reveal row's slot — never the action's own text, three of whose failure
 * branches are English literals.
 *
 * Harness = karute-reveal-race's (the swappable revealMock, the same render
 * setup and module mocks). One change: next-intl reads the SHIPPED
 * messages/ja.json, so the alert is pinned to the real line, not a key echo.
 */
jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
  const lookup = (path: string[]): unknown =>
    path.reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      ja,
    )
  return {
    useTranslations:
      (ns = '') =>
      (key: string) => {
        const s = lookup([...ns.split('.'), ...key.split('.')].filter(Boolean))
        return typeof s === 'string' ? s : key
      },
    useLocale: () => 'ja',
  }
})
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/ja/karute',
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/ja/karute',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@/components/karute/spike-lifted/list/NewKaruteDialog', () => ({
  NewKaruteDialog: () => null,
}))

const revealMock = jest.fn()
jest.mock('@/actions/karute', () => ({
  revealNoKaruteCustomer: (...args: unknown[]) => revealMock(...args),
}))

import { render, screen, fireEvent, act } from '@testing-library/react'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import ja from '../../../messages/ja.json'

const LIST = ja.karute.recordList as Record<string, unknown>
const REVEAL_FAILED = LIST.revealFailed as string
const REVEAL_CREATE = LIST.revealCreate as string
const EMPTY = LIST.empty as string
const DENIAL_EN = 'You do not have permission to perform this action.'

const candidate = {
  id: 'cust-yamada',
  name: '山田 花子',
  code: '#00042',
  registeredDate: '2026-02-02T00:00:00.000Z',
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const listEl = (storeId: string | null = null) => (
  <KaruteRecordListView
    items={[]}
    monthCount={0}
    total={0}
    storeId={storeId}
    staffList={[]}
    currentStaffId={null}
    customerOptions={[]}
  />
)

const searchInput = () => screen.getByPlaceholderText(LIST.searchPlaceholder as string)

/** Type a query and let its 300 ms debounce fire + the mocked answer land. */
async function search(value: string) {
  fireEvent.change(searchInput(), { target: { value } })
  await act(async () => {
    jest.advanceTimersByTime(300)
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Row (a)'s state — the check could not run for 「山田」 — as a precondition. */
async function outageFor(value = '山田') {
  revealMock.mockResolvedValueOnce({ error: 'x' })
  await search(value)
  expect(screen.getByRole('alert')).toHaveTextContent(REVEAL_FAILED)
}

describe('KaruteRecordListView search-reveal — the check could not run (Round 3 item 8)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    revealMock.mockReset()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('(a) an { error } answer prints the revealFailed line in the row slot, and no カルテを作成 row', async () => {
    render(listEl())
    revealMock.mockResolvedValueOnce({ error: 'x' })
    await search('山田')
    expect(revealMock).toHaveBeenCalledTimes(1)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(REVEAL_FAILED)
    expect(screen.queryByText(REVEAL_CREATE)).not.toBeInTheDocument()
  })

  it('(b) a { candidate } answer renders the row and no alert (unchanged)', async () => {
    render(listEl())
    revealMock.mockResolvedValueOnce({ candidate })
    await search('山田')
    expect(screen.getByText('山田 花子')).toBeInTheDocument()
    expect(screen.getByText(REVEAL_CREATE)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('(c) a { candidate: null } answer renders neither the row nor the alert — the empty state stands (unchanged)', async () => {
    render(listEl())
    revealMock.mockResolvedValueOnce({ candidate: null })
    await search('山田')
    expect(revealMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(REVEAL_CREATE)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(EMPTY)).toBeInTheDocument()
  })

  it('(d) a superseded { error } (query A answering after B was typed) prints nothing — the request-id guard still wins', async () => {
    const dA = deferred<{ error: string }>()
    const dB = deferred<{ candidate: null }>()
    revealMock.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise)
    render(listEl())

    fireEvent.change(searchInput(), { target: { value: '山田A' } })
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    expect(revealMock).toHaveBeenCalledTimes(1)

    // B typed, its debounce still mid-window; A's failure lands NOW.
    fireEvent.change(searchInput(), { target: { value: '山田B' } })
    await act(async () => {
      dA.resolve({ error: 'x' })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    expect(revealMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      dB.resolve({ candidate: null })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('(e) typing a new query clears the line synchronously, before the new debounce fires', async () => {
    render(listEl())
    await outageFor()
    const callsBefore = revealMock.mock.calls.length
    fireEvent.change(searchInput(), { target: { value: '山田太' } })
    // No timer advanced: the new fetch has not gone out yet.
    expect(revealMock.mock.calls.length).toBe(callsBefore)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('(f) clearing the query to empty clears the line', async () => {
    render(listEl())
    await outageFor()
    fireEvent.change(searchInput(), { target: { value: '' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("(g) the line is the key's ja text and NEVER the action's own (English) error text", async () => {
    render(listEl())
    revealMock.mockResolvedValueOnce({ error: DENIAL_EN })
    await search('山田')
    expect(screen.getByRole('alert').textContent).toBe(REVEAL_FAILED)
    expect(screen.queryByText(DENIAL_EN)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(DENIAL_EN)
  })

  it('(h) after a failure, a later { candidate } answer renders the row and no line', async () => {
    render(listEl())
    await outageFor()
    revealMock.mockResolvedValueOnce({ candidate })
    await search('山田花')
    expect(screen.getByText('山田 花子')).toBeInTheDocument()
    expect(screen.getByText(REVEAL_CREATE)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("(i) a store switch clears the line — it described the store that was active when it was fetched", async () => {
    const view = render(listEl('store-A'))
    await outageFor()
    view.rerender(listEl('store-B'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

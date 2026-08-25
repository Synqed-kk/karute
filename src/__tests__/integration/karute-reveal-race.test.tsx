/** @jest-environment jsdom */
/**
 * Search-reveal stale-query race (Greptile PR #776, real finding #1):
 * revealRequestId only advanced when the DEBOUNCED CALLBACK fired, so query
 * A's in-flight response could still render under query B WHILE B is still
 * inside its own 300ms debounce window (B's callback hasn't fired yet, so
 * the id hadn't moved) — worst case, カルテを作成 preselects the WRONG
 * customer. Fix: bump revealRequestId + clear revealCandidate on EVERY
 * query change, synchronously, before (re)scheduling the debounce — so A is
 * already stale the instant the user types past it, whether or not B's own
 * fetch has fired yet.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
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

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('KaruteRecordListView search-reveal — stale-query race (Greptile PR #776)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    revealMock.mockReset()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('query A resolving WHILE query B is still debouncing (B not yet fetched) never renders A\'s candidate', async () => {
    const candidateA = { id: 'wrong-customer', name: '間違い太郎', code: '#00001', registeredDate: '2026-01-01T00:00:00.000Z' }
    const candidateB = { id: 'right-customer', name: '正解花子', code: '#00002', registeredDate: '2026-02-02T00:00:00.000Z' }
    const dA = deferred<{ candidate: typeof candidateA | null }>()
    const dB = deferred<{ candidate: typeof candidateB | null }>()
    revealMock.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise)

    render(
      <KaruteRecordListView
        items={[]}
        monthCount={0}
        total={0}
        staffList={[]}
        currentStaffId={null}
        customerOptions={[]}
      />,
    )
    const input = screen.getByPlaceholderText('searchPlaceholder')

    // Type query A, let its debounce fire (call #1 goes in flight).
    fireEvent.change(input, { target: { value: '坂木A' } })
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    expect(revealMock).toHaveBeenCalledTimes(1)

    // Type query B — its OWN debounce has NOT fired yet (still mid-window).
    // The bug: without invalidating immediately here, revealRequestId is
    // still A's, so A resolving next would still pass the staleness check.
    fireEvent.change(input, { target: { value: '坂木B' } })

    // A resolves NOW, before B's debounce has fired at all.
    await act(async () => {
      dA.resolve({ candidate: candidateA })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByText('間違い太郎')).not.toBeInTheDocument()

    // Let B's debounce finish and resolve — the happy path still works.
    await act(async () => {
      jest.advanceTimersByTime(300)
    })
    expect(revealMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      dB.resolve({ candidate: candidateB })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('正解花子')).toBeInTheDocument()
    // JST-EXPLICIT weekday (fix round 6). registeredDate 2026-02-02 is a
    // MONDAY in Japan. The row anchors the instant to JST midnight but used to
    // read the weekday back with `.getDay()`, i.e. in the BROWSER's zone — so
    // anywhere west of Japan (and on every UTC box, CI included) it rendered
    // 日, the day before. This assertion fails under TZ=UTC without the fix.
    expect(screen.getByText('月')).toBeInTheDocument()
  })
})

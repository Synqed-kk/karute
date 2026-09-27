/** @jest-environment jsdom */
/**
 * The list search bar is the mock's pill on BOTH list tabs (Liam 9/27, on a
 * build-30 screenshot: 「you didn't round the edges of the search bar like in
 * the mock」 — MOCK-LIST-FINAL-v3.html `.search{border-radius:999px}`). The
 * カルテ tab's field lives inside KaruteRecordListView; the 顧客 tab's is
 * CustomerSearchInput. One look: each field's container carries rounded-full,
 * never the app's old 10px.
 */
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'ja',
}))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/ja/karute',
  Link: ({ children, ...rest }: { children?: React.ReactNode; href?: string }) => (
    <a {...rest}>{children}</a>
  ),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/ja/karute',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@/components/karute/spike-lifted/list/NewKaruteDialog', () => ({
  NewKaruteDialog: () => null,
}))
jest.mock('@/actions/karute', () => ({
  revealNoKaruteCustomer: jest.fn(async () => ({ candidate: null })),
  loadKaruteWindow: jest.fn(),
}))

import { render, screen } from '@testing-library/react'
import { KaruteRecordListView } from '@/components/karute/spike-lifted/list/KaruteRecordListView'
import { CustomerSearchInput } from '@/components/customers/redesign/list/CustomerSearchInput'

beforeEach(() => {
  window.localStorage.clear()
})

describe('list search bar — the mock pill', () => {
  it('カルテ: the search field container is rounded-full, not rounded-[10px]', () => {
    render(
      <KaruteRecordListView
        items={[]}
        monthCount={0}
        total={0}
        initialWindowStart="2026-01-01"
        initialHasMore={false}
        staffList={[]}
        currentStaffId="staff-1"
        customerOptions={[]}
      />,
    )
    const field = screen.getByPlaceholderText('searchPlaceholder').closest('label')!
    expect(field).not.toBeNull()
    expect(field).toHaveClass('rounded-full')
    expect(field).not.toHaveClass('rounded-[10px]')
  })

  it('顧客: the search field container is rounded-full, not rounded-[10px]', () => {
    render(<CustomerSearchInput initialQuery="" />)
    const field = screen.getByRole('textbox').closest('label')!
    expect(field).not.toBeNull()
    expect(field).toHaveClass('rounded-full')
    expect(field).not.toHaveClass('rounded-[10px]')
  })
})

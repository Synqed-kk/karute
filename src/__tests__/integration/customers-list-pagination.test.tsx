/**
 * @jest-environment jsdom
 *
 * Render coverage for CustomersListPagination (PR 17, replay/17): the
 * "showing X–Y of Z" status text, the single-page quiet footer, prev/next
 * disabled bounds, page-number elision for large page counts, and the
 * page-change callback.
 */
import { render, screen, fireEvent } from '@testing-library/react'

// next-intl mocked so labels render as their key (or interpolated key for
// messages with params).
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

import { CustomersListPagination } from '@/components/customers/redesign/list/CustomersListPagination'

describe('CustomersListPagination', () => {
  it('renders nothing when there are zero rows', () => {
    const { container } = render(
      <CustomersListPagination total={0} page={0} pageSize={12} onPageChange={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the "showing from–to of total" status text', () => {
    render(<CustomersListPagination total={24} page={0} pageSize={12} onPageChange={jest.fn()} />)
    expect(
      screen.getByText('paginatedShowing:{"from":1,"to":12,"total":24}'),
    ).toBeInTheDocument()
  })

  it('computes the to-bound as the partial last page total, not page*size', () => {
    // 20 rows, page 1 (0-indexed) of pageSize 12 → showing 13–20 of 20.
    render(<CustomersListPagination total={20} page={1} pageSize={12} onPageChange={jest.fn()} />)
    expect(
      screen.getByText('paginatedShowing:{"from":13,"to":20,"total":20}'),
    ).toBeInTheDocument()
  })

  it('renders only the status text (no page buttons) for a single page', () => {
    render(<CustomersListPagination total={5} page={0} pageSize={12} onPageChange={jest.fn()} />)
    // No navigation buttons when there's only one page worth of results.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders page buttons + arrows when there is more than one page', () => {
    render(<CustomersListPagination total={24} page={0} pageSize={12} onPageChange={jest.fn()} />)
    // Page buttons show their 1-indexed labels.
    expect(screen.getByRole('button', { name: 'goToPage:{"n":2}' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'previousPage' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'nextPage' })).toBeInTheDocument()
  })

  it('disables previous on the first page and enables next', () => {
    render(<CustomersListPagination total={36} page={0} pageSize={12} onPageChange={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'previousPage' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'nextPage' })).toBeEnabled()
  })

  it('disables next on the last page and enables previous', () => {
    // 36 rows / 12 = 3 pages → last page index 2.
    render(<CustomersListPagination total={36} page={2} pageSize={12} onPageChange={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'nextPage' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'previousPage' })).toBeEnabled()
  })

  it('marks the active page with aria-current', () => {
    render(<CustomersListPagination total={36} page={1} pageSize={12} onPageChange={jest.fn()} />)
    const active = screen.getByRole('button', { name: 'goToPage:{"n":2}' })
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('emits the next/previous page index through onPageChange', () => {
    const onPageChange = jest.fn()
    render(<CustomersListPagination total={36} page={1} pageSize={12} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'nextPage' }))
    expect(onPageChange).toHaveBeenLastCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'previousPage' }))
    expect(onPageChange).toHaveBeenLastCalledWith(0)
  })

  it('emits the clicked page index (0-based) through onPageChange', () => {
    const onPageChange = jest.fn()
    render(<CustomersListPagination total={36} page={0} pageSize={12} onPageChange={onPageChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'goToPage:{"n":3}' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('clamps an out-of-range page to the last page for the status text', () => {
    // page 99 but only 2 pages (24/12) → safePage clamps to 1 → showing 13–24.
    render(<CustomersListPagination total={24} page={99} pageSize={12} onPageChange={jest.fn()} />)
    expect(
      screen.getByText('paginatedShowing:{"from":13,"to":24,"total":24}'),
    ).toBeInTheDocument()
    // Clamped to last page so next is disabled.
    expect(screen.getByRole('button', { name: 'nextPage' })).toBeDisabled()
  })

  it('shows every page without elision when there are 7 or fewer pages', () => {
    // 7 pages exactly (84/12) → buttons for pages 1..7, no ellipsis.
    render(<CustomersListPagination total={84} page={0} pageSize={12} onPageChange={jest.fn()} />)
    for (let n = 1; n <= 7; n++) {
      expect(screen.getByRole('button', { name: `goToPage:{"n":${n}}` })).toBeInTheDocument()
    }
    expect(screen.queryByText('…')).not.toBeInTheDocument()
  })

  it('elides middle pages with an ellipsis when there are more than 7 pages', () => {
    // 10 pages (120/12), active page 0 → first, neighbor, ellipsis, last.
    render(<CustomersListPagination total={120} page={0} pageSize={12} onPageChange={jest.fn()} />)
    expect(screen.getByText('…')).toBeInTheDocument()
    // First and last pages always present.
    expect(screen.getByRole('button', { name: 'goToPage:{"n":1}' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'goToPage:{"n":10}' })).toBeInTheDocument()
    // A deep middle page is hidden behind the ellipsis.
    expect(screen.queryByRole('button', { name: 'goToPage:{"n":6}' })).not.toBeInTheDocument()
  })

  it('shows ellipses on both sides for a centered active page in a long list', () => {
    // 10 pages, active index 4 → 0 … 3 [4] 5 … 9.
    render(<CustomersListPagination total={120} page={4} pageSize={12} onPageChange={jest.fn()} />)
    expect(screen.getAllByText('…')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'goToPage:{"n":4}' })).toBeInTheDocument() // page index 3
    expect(screen.getByRole('button', { name: 'goToPage:{"n":6}' })).toBeInTheDocument() // page index 5
  })
})

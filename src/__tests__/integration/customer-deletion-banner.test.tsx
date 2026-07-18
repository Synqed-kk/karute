/**
 * @jest-environment jsdom
 *
 * Render coverage for CustomerDeletionBanner (now server-prop driven off core
 * deleted_at — the localStorage stub is gone): conditional render, day-count
 * vs same-day title variants, the amber→red urgency flip in the last 7 days,
 * and the undo path through cancelCustomerDeletion → toast → router.refresh.
 *
 * next-intl is mocked so translation keys + vars render verbatim.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  useLocale: () => 'en',
}))
const refresh = jest.fn()
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh, push: jest.fn() }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/actions/customers', () => ({
  cancelCustomerDeletion: jest.fn(async () => ({ success: true, id: 'cust-1' })),
}))

import { CustomerDeletionBanner } from '@/components/customers/redesign/CustomerDeletionBanner'
import { cancelCustomerDeletion as cancelImport } from '@/actions/customers'
import { toast } from 'sonner'

const cancelCustomerDeletion = cancelImport as jest.Mock
const DAY_MS = 24 * 60 * 60 * 1000
const deletedAt = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY_MS).toISOString()

beforeEach(() => {
  jest.clearAllMocks()
  cancelCustomerDeletion.mockResolvedValue({ success: true, id: 'cust-1' })
})

describe('CustomerDeletionBanner', () => {
  it('renders nothing when deletedAt is null', () => {
    const { container } = render(
      <CustomerDeletionBanner customerId="cust-1" customerName="Aoi" deletedAt={null} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the day-count title from the deleted_at prop', () => {
    // 20 days into the window → 10 days remaining.
    render(
      <CustomerDeletionBanner customerId="cust-1" customerName="Aoi" deletedAt={deletedAt(20)} />,
    )
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('title:{"name":"Aoi","days":10}')).toBeInTheDocument()
  })

  it('flips to the urgent (red) tone in the last 7 days', () => {
    render(
      <CustomerDeletionBanner customerId="cust-1" customerName="Aoi" deletedAt={deletedAt(25)} />,
    )
    expect(screen.getByRole('status').className).toContain('bg-red-50')
  })

  it('stays amber with more than 7 days remaining', () => {
    render(
      <CustomerDeletionBanner customerId="cust-1" customerName="Aoi" deletedAt={deletedAt(5)} />,
    )
    expect(screen.getByRole('status').className).toContain('bg-amber-50')
  })

  it('undo calls cancelCustomerDeletion and refreshes on success', async () => {
    render(
      <CustomerDeletionBanner customerId="cust-1" customerName="Aoi" deletedAt={deletedAt(5)} />,
    )
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(cancelCustomerDeletion).toHaveBeenCalledWith('cust-1'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalled()
  })

  it('treats not_scheduled (already undone elsewhere) as success and refreshes', async () => {
    cancelCustomerDeletion.mockResolvedValue({ success: false, error: 'not_scheduled' })
    render(
      <CustomerDeletionBanner customerId="cust-1" customerName="Aoi" deletedAt={deletedAt(5)} />,
    )
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('surfaces the expired-window error without refreshing', async () => {
    cancelCustomerDeletion.mockResolvedValue({ success: false, error: 'window_expired' })
    render(
      <CustomerDeletionBanner customerId="cust-1" customerName="Aoi" deletedAt={deletedAt(31)} />,
    )
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('undoExpired'))
    expect(refresh).not.toHaveBeenCalled()
  })
})

/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))
jest.mock('@/actions/karute', () => ({ saveKaruteRecord: jest.fn() }))
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({ consent: null })),
  grantCustomerConsent: jest.fn(),
}))
jest.mock('@/lib/karute/draft', () => ({ saveDraft: jest.fn(), clearDraft: jest.fn() }))
jest.mock('@/components/karute/redesign/record/RecordingConsentDialog', () => ({
  RecordingConsentDialog: ({ customerName }: { customerName: string }) => (
    <div role="dialog">{customerName}</div>
  ),
}))

import { ReviewScreen } from '@/components/review/ReviewScreen'
import { getCustomerConsent } from '@/actions/customers'
import { saveKaruteRecord } from '@/actions/karute'

it('shows the picked company-wide customer name in review consent when absent from the preloaded list', async () => {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ suggestions: [] }) })
  const props = {
    transcript: 'hello',
    entries: [],
    summary: 'a summary',
    customers: [{ id: 'local-customer', name: 'Local Customer' }],
    appointmentCustomerId: 'company-wide-customer',
    pickedCustomerName: '遠藤三郎',
    onSaved: jest.fn(),
  }
  render(<ReviewScreen {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'save' }))

  const dialog = within(await screen.findByRole('dialog'))
  expect(dialog.getByText('遠藤三郎')).toBeTruthy()
  expect(dialog.queryByText('Local Customer')).toBeNull()
  expect(getCustomerConsent).toHaveBeenCalledWith('company-wide-customer')
  expect(saveKaruteRecord).not.toHaveBeenCalled()
})

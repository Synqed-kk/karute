/**
 * @jest-environment jsdom
 *
 * SessionPhotoCard — customer-facing toast leak fix (packet 2026-08-09 PR 9b
 * blind-round §6). While PhotoPresentationOverlay is open, `document.body`
 * carries the `customer-presentation-open` class — globals.css hides
 * sonner's toaster under it (sonner's z-index 999999999 would otherwise
 * outstack the overlay's z-[120] shell, leaking a recording-status toast
 * onto the screen a customer is watching). The class comes off on BOTH
 * close and unmount, so it can never get stuck on.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn(async () => null) }))
const mockListCustomerPhotos = jest.fn(async (_id: string) => ({ photos: [] as unknown[] }))
jest.mock('@/actions/customers', () => ({
  uploadCustomerPhoto: jest.fn(),
  listCustomerPhotos: (id: string) => mockListCustomerPhotos(id),
}))
jest.mock('sonner', () => ({
  toast: { warning: jest.fn(), success: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
const mockPhotoPresentationOverlay = jest.fn()
jest.mock('@/components/customers/redesign/profile/PhotoPresentationOverlay', () => ({
  PhotoPresentationOverlay: (props: { photos: unknown[]; onClose: () => void }) => {
    mockPhotoPresentationOverlay(props)
    return null
  },
}))

import { SessionPhotoCard } from '@/components/karute/redesign/record/SessionPhotoCard'

beforeEach(() => {
  jest.clearAllMocks()
  mockListCustomerPhotos.mockResolvedValue({ photos: [] })
  document.body.classList.remove('customer-presentation-open')
})

describe('customer-presentation-open body class (§6)', () => {
  it('opening the presentation overlay adds the class to <body>', async () => {
    render(<SessionPhotoCard customerId="cust-1" takenWithConsent={false} />)
    expect(document.body.classList.contains('customer-presentation-open')).toBe(false)

    fireEvent.click(screen.getByText('presentButton'))
    await waitFor(() => expect(mockPhotoPresentationOverlay).toHaveBeenCalled())
    expect(document.body.classList.contains('customer-presentation-open')).toBe(true)
  })

  it('closing the overlay removes the class', async () => {
    render(<SessionPhotoCard customerId="cust-1" takenWithConsent={false} />)
    fireEvent.click(screen.getByText('presentButton'))
    await waitFor(() => expect(mockPhotoPresentationOverlay).toHaveBeenCalled())
    expect(document.body.classList.contains('customer-presentation-open')).toBe(true)

    const { onClose } = mockPhotoPresentationOverlay.mock.calls[0][0] as { onClose: () => void }
    act(() => onClose())
    expect(document.body.classList.contains('customer-presentation-open')).toBe(false)
  })

  it('unmounting while open removes the class (never stuck on)', async () => {
    const { unmount } = render(<SessionPhotoCard customerId="cust-1" takenWithConsent={false} />)
    fireEvent.click(screen.getByText('presentButton'))
    await waitFor(() => expect(mockPhotoPresentationOverlay).toHaveBeenCalled())
    expect(document.body.classList.contains('customer-presentation-open')).toBe(true)

    unmount()
    expect(document.body.classList.contains('customer-presentation-open')).toBe(false)
  })
})

// Content pin: proves the CSS rule actually exists — a passing body-class
// test alone doesn't prove anything is hidden if the stylesheet rule itself
// were ever accidentally removed.
describe('globals.css content pin (§6)', () => {
  it('hides [data-sonner-toaster] under .customer-presentation-open', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    expect(css).toContain('.customer-presentation-open [data-sonner-toaster]')
  })
})

/**
 * @jest-environment jsdom
 *
 * Customer-facing toast-guard (PR 9b §6, moved 2026-08-09 — the blind photo
 * lens found the guard living in SessionPhotoCard only, so
 * PhotosTabContent's mount of the SAME PhotoPresentationOverlay shipped
 * unguarded: a staff toast could paint over the customer's screen from that
 * caller). The guard now lives on PhotoPresentationOverlay's OWN mount
 * lifecycle, so this file renders the REAL overlay (no stub) from BOTH
 * callers — record-screen SessionPhotoCard and customer-page
 * PhotosTabContent — proving the guard is structural, not caller-owned:
 * `document.body` carries the `customer-presentation-open` class exactly as
 * long as the overlay is mounted; globals.css hides sonner's toaster under
 * it (sonner's z-index 999999999 would otherwise outstack the overlay's
 * z-[120] shell). The class comes off on BOTH close and unmount, so it can
 * never get stuck on.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn(async () => null) }))
const mockListCustomerPhotos = jest.fn(async (_id: string) => ({ photos: [] as unknown[] }))
jest.mock('@/actions/customers', () => ({
  uploadCustomerPhoto: jest.fn(),
  listCustomerPhotos: (id: string) => mockListCustomerPhotos(id),
}))
jest.mock('sonner', () => ({
  toast: { warning: jest.fn(), success: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { SessionPhotoCard } from '@/components/karute/redesign/record/SessionPhotoCard'
import {
  PhotosTabContent,
  type CustomerPhoto,
} from '@/components/customers/redesign/profile/PhotosTabContent'

beforeEach(() => {
  jest.clearAllMocks()
  mockListCustomerPhotos.mockResolvedValue({ photos: [] })
  document.body.classList.remove('customer-presentation-open')
})

// The real overlay's ✕ is press-and-hold in the UI, but Enter closes
// instantly — its documented keyboard escape hatch (the hold timing itself
// is covered by photo-presentation-overlay.test.tsx; this file only cares
// that a close, however triggered, removes the body class).
function closeViaKeyboard() {
  fireEvent.keyDown(screen.getByLabelText('presentCloseHold'), { key: 'Enter' })
}

describe('customer-presentation-open body class (§6) — record-screen caller (SessionPhotoCard)', () => {
  it('opening the presentation overlay adds the class to <body>', async () => {
    render(<SessionPhotoCard customerId="cust-1" takenWithConsent={false} />)
    expect(document.body.classList.contains('customer-presentation-open')).toBe(false)

    fireEvent.click(screen.getByText('presentButton'))
    await screen.findByLabelText('presentCloseHold')
    expect(document.body.classList.contains('customer-presentation-open')).toBe(true)
  })

  it('closing the overlay removes the class', async () => {
    render(<SessionPhotoCard customerId="cust-1" takenWithConsent={false} />)
    fireEvent.click(screen.getByText('presentButton'))
    await screen.findByLabelText('presentCloseHold')
    expect(document.body.classList.contains('customer-presentation-open')).toBe(true)

    closeViaKeyboard()
    expect(document.body.classList.contains('customer-presentation-open')).toBe(false)
  })

  it('unmounting while open removes the class (never stuck on)', async () => {
    const { unmount } = render(
      <SessionPhotoCard customerId="cust-1" takenWithConsent={false} />,
    )
    fireEvent.click(screen.getByText('presentButton'))
    await screen.findByLabelText('presentCloseHold')
    expect(document.body.classList.contains('customer-presentation-open')).toBe(true)

    unmount()
    expect(document.body.classList.contains('customer-presentation-open')).toBe(false)
  })
})

describe('customer-presentation-open body class (§6) — customer-page caller (PhotosTabContent)', () => {
  // The lens's probe shape: open お客様に見せる from the customer page, not
  // the record screen — this is the mount that shipped unguarded.
  const photos: CustomerPhoto[] = [
    { id: 'p1', signedUrl: 'https://example.com/p1.jpg', category: 'before', caption: null },
  ]

  it('opening the presentation overlay adds the class to <body>', async () => {
    render(<PhotosTabContent customerId="cust-2" photos={photos} />)
    expect(document.body.classList.contains('customer-presentation-open')).toBe(false)

    fireEvent.click(screen.getByText('presentButton'))
    await screen.findByLabelText('presentCloseHold')
    expect(document.body.classList.contains('customer-presentation-open')).toBe(true)
  })

  it('closing the overlay removes the class', async () => {
    render(<PhotosTabContent customerId="cust-2" photos={photos} />)
    fireEvent.click(screen.getByText('presentButton'))
    await screen.findByLabelText('presentCloseHold')
    expect(document.body.classList.contains('customer-presentation-open')).toBe(true)

    closeViaKeyboard()
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

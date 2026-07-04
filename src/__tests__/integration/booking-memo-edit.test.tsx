/**
 * @jest-environment jsdom
 *
 * Inline-edit contract for BookingMemoCard (pencil → textarea → 保存/キャンセル).
 *
 * The memo lives on customer.notes and may carry a `QR #<id> | ` back-reference
 * prefix that other code keys QR-origin detection off (qr-notes.ts). The edit
 * flow must:
 *   1. edit only the human CONTENT (prefix stripped in the textarea), and
 *   2. RE-PREPEND that exact prefix byte-for-byte on save,
 * so a staff edit never destroys the sync plumbing. These tests pin the
 * round-trip, the updateCustomer payload, the empty-clear behavior, and that
 * Cancel discards without persisting.
 *
 * next-intl is mocked to echo keys (repo tsx-test convention); the server
 * action + next/navigation + sonner are stubbed so we assert the call the card
 * makes, not the network.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('@/actions/customers', () => ({
  updateCustomer: jest.fn(),
}))

import { BookingMemoCard } from '@/components/customers/redesign/profile/BookingMemoCard'
import { updateCustomer } from '@/actions/customers'
import { toast } from 'sonner'

const mockUpdate = updateCustomer as jest.MockedFunction<typeof updateCustomer>

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdate.mockResolvedValue({ success: true, id: 'c1' })
})

// next-intl is mocked to echo the RAW key passed to t() (ignoring the
// namespace), so the icon-only pencil's accessible name is just 'edit', and the
// action buttons read 'save' / 'cancel'.
function pencil() {
  return screen.getByRole('button', { name: 'edit' })
}
const saveBtn = () => screen.getByRole('button', { name: 'save' })
const cancelBtn = () => screen.getByRole('button', { name: 'cancel' })

describe('BookingMemoCard — inline edit', () => {
  it('renders nothing when there is no memo and not editing', () => {
    const { container } = render(<BookingMemoCard customerId="c1" memo={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the pencil and structured rows for an existing memo', () => {
    render(
      <BookingMemoCard
        customerId="c1"
        memo="▶症状:首の張り▶ゴール:楽になりたい"
      />,
    )
    expect(pencil()).toBeInTheDocument()
    expect(screen.getByText('首の張り')).toBeInTheDocument()
    expect(screen.getByText('楽になりたい')).toBeInTheDocument()
  })

  it('opens the editor with the QR prefix stripped from the textarea', () => {
    render(
      <BookingMemoCard
        customerId="c1"
        memo="QR #328091 | ▶症状:首の張り"
      />,
    )
    fireEvent.click(pencil())
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    // The `QR #328091 | ` plumbing must NOT appear in the editable content.
    expect(textarea.value).toBe('▶症状:首の張り')
    expect(textarea.value).not.toContain('QR #')
  })

  it('re-prepends the exact QR prefix on save (round-trip)', async () => {
    render(
      <BookingMemoCard
        customerId="c1"
        memo="QR #328091 | ▶症状:首の張り"
      />,
    )
    fireEvent.click(pencil())
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: '▶症状:首の張り▶ゴール:改善' },
    })
    fireEvent.click(saveBtn())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    // Prefix preserved byte-for-byte, new content behind it.
    expect(mockUpdate).toHaveBeenCalledWith('c1', {
      notes: 'QR #328091 | ▶症状:首の張り▶ゴール:改善',
    })
    expect(refresh).toHaveBeenCalled()
  })

  it('saves plain content unchanged when there was no QR prefix', async () => {
    render(<BookingMemoCard customerId="c1" memo="▶症状:肩こり" />)
    fireEvent.click(pencil())
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '▶症状:肩こり▶セルフ:ストレッチ' },
    })
    fireEvent.click(saveBtn())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith('c1', {
      notes: '▶症状:肩こり▶セルフ:ストレッチ',
    })
  })

  it('clears the memo (keeping only a bare prefix) when saved empty', async () => {
    render(
      <BookingMemoCard customerId="c1" memo="QR #42 | ▶症状:首の張り" />,
    )
    fireEvent.click(pencil())
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.click(saveBtn())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    // Empty content → the bare QR back-reference survives (trimmed), so the
    // sync can still resolve the reservation; no human memo remains.
    expect(mockUpdate).toHaveBeenCalledWith('c1', { notes: 'QR #42 |' })
  })

  it('cancel discards the draft without calling updateCustomer', () => {
    render(<BookingMemoCard customerId="c1" memo="▶症状:首の張り" />)
    fireEvent.click(pencil())
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '別の内容' },
    })
    fireEvent.click(cancelBtn())

    expect(mockUpdate).not.toHaveBeenCalled()
    // Back in display mode: textarea gone, original rows shown.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('首の張り')).toBeInTheDocument()
  })

  it('surfaces an error toast when the save action fails', async () => {
    mockUpdate.mockResolvedValue({ success: false, error: 'nope' })
    render(<BookingMemoCard customerId="c1" memo="▶症状:首の張り" />)
    fireEvent.click(pencil())
    fireEvent.click(saveBtn())

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(refresh).not.toHaveBeenCalled()
  })
})

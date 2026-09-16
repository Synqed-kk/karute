/**
 * @jest-environment jsdom
 *
 * CustomerCombobox contract (fix/creation-dialogs): the picker must NOT dump
 * the full customer list on mere focus — it only opens once the staff has
 * typed something. Matches by name or phone digits (dashes/spaces ignored on
 * both sides), caps results at 8, and closes on blur.
 */
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import {
  CustomerCombobox,
  type CustomerOption,
  type CustomerSearchOption,
} from '@/components/karute/CustomerCombobox'
import { RecordCustomerPickerDialog } from '@/components/karute/redesign/record/RecordCustomerPickerDialog'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

function customerList(n: number): CustomerOption[] {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Customer ${i}` }))
}

describe('CustomerCombobox', () => {
  it('does not render the listbox on focus alone', () => {
    render(
      <CustomerCombobox
        customers={customerList(3)}
        selectedId={null}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    )
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders a matching option once part of the name is typed', () => {
    render(
      <CustomerCombobox
        customers={[
          { id: 'a', name: '田中花子' },
          { id: 'b', name: '佐藤一郎' },
        ]}
        selectedId={null}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '田中' } })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('田中花子')).toBeInTheDocument()
    expect(screen.queryByText('佐藤一郎')).toBeNull()
  })

  it('matches phone digits with or without dashes', () => {
    const list: CustomerOption[] = [
      { id: 'a', name: '田中花子', phone: '090-1234-5678' },
      { id: 'b', name: '佐藤一郎', phone: '080-0000-0000' },
    ]
    render(
      <CustomerCombobox
        customers={list}
        selectedId={null}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '09012345678' } })
    expect(screen.getByText('田中花子')).toBeInTheDocument()
    expect(screen.queryByText('佐藤一郎')).toBeNull()
  })

  it('matches full-width phone digits (kana keyboard)', () => {
    render(
      <CustomerCombobox
        customers={[
          { id: 'a', name: '田中花子', phone: '090-1234-5678' },
          { id: 'b', name: '佐藤一郎', phone: '080-0000-0000' },
        ]}
        selectedId={null}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '０９０１２３４' } })
    expect(screen.getByText('田中花子')).toBeInTheDocument()
    expect(screen.queryByText('佐藤一郎')).toBeNull()
  })

  it('caps results at 8', () => {
    render(
      <CustomerCombobox
        customers={customerList(20)}
        selectedId={null}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Customer' } })
    expect(screen.getAllByRole('option')).toHaveLength(8)
  })

  it('clears the input when the selection is externally reset', () => {
    const list: CustomerOption[] = [{ id: 'c1', name: '田中花子' }]
    const { rerender } = render(
      <CustomerCombobox
        customers={list}
        selectedId="c1"
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    )
    expect(screen.getByRole('combobox')).toHaveValue('田中花子')
    rerender(
      <CustomerCombobox
        customers={list}
        selectedId={null}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    )
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  it('P3 (⚖ Liam 2026-09-16): appends a debounced remote result below the local ones with a 他店舗 chip', async () => {
    jest.useFakeTimers()
    try {
      const remote: CustomerSearchOption[] = [{ id: 'r1', name: '遠藤三郎', other_store: true }]
      const onRemoteSearch = jest.fn().mockResolvedValue({ options: remote, karute_number_unavailable: false })
      render(
        <CustomerCombobox
          customers={[{ id: 'a', name: '田中花子' }]}
          selectedId={null}
          onSelect={jest.fn()}
          onCreateNew={jest.fn()}
          onRemoteSearch={onRemoteSearch}
        />,
      )
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '遠藤' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(onRemoteSearch).toHaveBeenCalledWith('遠藤')
      expect(screen.getByText('遠藤三郎')).toBeInTheDocument()
      expect(screen.getByText('otherStoreChip')).toBeInTheDocument()
      expect(screen.getByText('otherStoreSection')).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('Greptile fold: stale remote results are cleared the instant the query changes, before the new one returns', async () => {
    jest.useFakeTimers()
    try {
      const onRemoteSearch = jest.fn(async (q: string) => ({
        options: [{ id: `r-${q}`, name: `row-${q}`, other_store: true }] as CustomerSearchOption[],
        karute_number_unavailable: false,
        remote_more: false,
      }))
      render(
        <CustomerCombobox
          customers={[]}
          selectedId={null}
          onSelect={jest.fn()}
          onCreateNew={jest.fn()}
          onRemoteSearch={onRemoteSearch}
        />,
      )
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'A' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(screen.getByText('row-A')).toBeInTheDocument()

      // Query changes to B — A's row must be gone IMMEDIATELY, before B's
      // debounce/request even resolves (not just once B's own row arrives).
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'B' } })
      expect(screen.queryByText('row-A')).toBeNull()
      expect(screen.queryByRole('option', { name: /row-A/ })).toBeNull()

      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(screen.getByText('row-B')).toBeInTheDocument()
      expect(screen.queryByText('row-A')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('Greptile fold: a single-character (non-numeric) query still reaches the remote search — no length floor', async () => {
    jest.useFakeTimers()
    try {
      const onRemoteSearch = jest.fn().mockResolvedValue({ options: [], karute_number_unavailable: false })
      render(
        <CustomerCombobox
          customers={[]}
          selectedId={null}
          onSelect={jest.fn()}
          onCreateNew={jest.fn()}
          onRemoteSearch={onRemoteSearch}
        />,
      )
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '陽' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(onRemoteSearch).toHaveBeenCalledWith('陽')
    } finally {
      jest.useRealTimers()
    }
  })

  it('Greptile fold: other_store:false on a remote row renders no chip, in the normal section', async () => {
    jest.useFakeTimers()
    try {
      const onRemoteSearch = jest.fn().mockResolvedValue({
        options: [{ id: 'r1', name: '遠藤三郎', other_store: false }] as CustomerSearchOption[],
        karute_number_unavailable: false,
      })
      render(
        <CustomerCombobox
          customers={[{ id: 'a', name: '田中花子' }]}
          selectedId={null}
          onSelect={jest.fn()}
          onCreateNew={jest.fn()}
          onRemoteSearch={onRemoteSearch}
        />,
      )
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '遠藤' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(screen.getByText('遠藤三郎')).toBeInTheDocument()
      expect(screen.queryByText('otherStoreChip')).toBeNull()
      expect(screen.queryByText('otherStoreSection')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('Greptile fold round 2: other_store:null (lens read failed) renders the 店舗不明 chip, never presented as own-store', async () => {
    jest.useFakeTimers()
    try {
      const onRemoteSearch = jest.fn().mockResolvedValue({
        options: [{ id: 'r1', name: '遠藤三郎', other_store: null }] as CustomerSearchOption[],
        karute_number_unavailable: false,
      })
      render(
        <CustomerCombobox
          customers={[{ id: 'a', name: '田中花子' }]}
          selectedId={null}
          onSelect={jest.fn()}
          onCreateNew={jest.fn()}
          onRemoteSearch={onRemoteSearch}
        />,
      )
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '遠藤' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(screen.getByText('遠藤三郎')).toBeInTheDocument()
      // The UNKNOWN chip, never the confirmed-other-store one, and never
      // silently merged into the normal (own-store) list.
      expect(screen.getByText('otherStoreUnknownChip')).toBeInTheDocument()
      expect(screen.queryByText('otherStoreChip')).toBeNull()
      expect(screen.getByText('otherStoreSection')).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('Greptile fold round 2: karute_number_unavailable renders a one-line notice', async () => {
    jest.useFakeTimers()
    try {
      const onRemoteSearch = jest.fn().mockResolvedValue({
        options: [],
        karute_number_unavailable: true,
      })
      render(
        <CustomerCombobox
          customers={[]}
          selectedId={null}
          onSelect={jest.fn()}
          onCreateNew={jest.fn()}
          onRemoteSearch={onRemoteSearch}
        />,
      )
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '0042' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(screen.getByText('karuteNumberUnavailable')).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('a remote hit already offered locally is never shown twice', async () => {
    jest.useFakeTimers()
    try {
      const onRemoteSearch = jest.fn().mockResolvedValue({
        options: [{ id: 'a', name: '田中花子', other_store: true }] as CustomerSearchOption[],
        karute_number_unavailable: false,
      })
      render(
        <CustomerCombobox
          customers={[{ id: 'a', name: '田中花子' }]}
          selectedId={null}
          onSelect={jest.fn()}
          onCreateNew={jest.fn()}
          onRemoteSearch={onRemoteSearch}
        />,
      )
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '田中' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(screen.getAllByText('田中花子')).toHaveLength(1)
      expect(screen.queryByText('otherStoreChip')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('F-2 fold (⚖ Liam 2026-09-16): remote_more renders the company-wide overflow disclosure', async () => {
    jest.useFakeTimers()
    try {
      const onRemoteSearch = jest.fn().mockResolvedValue({
        options: [{ id: 'r1', name: '遠藤三郎', other_store: true }] as CustomerSearchOption[],
        karute_number_unavailable: false,
        remote_more: true,
      })
      render(
        <CustomerCombobox
          customers={[]}
          selectedId={null}
          onSelect={jest.fn()}
          onCreateNew={jest.fn()}
          onRemoteSearch={onRemoteSearch}
        />,
      )
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '遠藤' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(screen.getByText('remoteMore')).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('F-2 fold: remote_more:false renders no overflow disclosure', async () => {
    jest.useFakeTimers()
    try {
      const onRemoteSearch = jest.fn().mockResolvedValue({
        options: [{ id: 'r1', name: '遠藤三郎', other_store: true }] as CustomerSearchOption[],
        karute_number_unavailable: false,
        remote_more: false,
      })
      render(
        <CustomerCombobox
          customers={[]}
          selectedId={null}
          onSelect={jest.fn()}
          onCreateNew={jest.fn()}
          onRemoteSearch={onRemoteSearch}
        />,
      )
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '遠藤' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      expect(screen.getByText('遠藤三郎')).toBeInTheDocument()
      expect(screen.queryByText('remoteMore')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('closes the list on blur', () => {
    render(
      <CustomerCombobox
        customers={customerList(3)}
        selectedId={null}
        onSelect={jest.fn()}
        onCreateNew={jest.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Customer' } })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.blur(input)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  // post-#945 follow-up: a customer picked from the company-wide (remote)
  // tier is never in the preloaded `customers` list, so the old
  // `customers.find(selectedId)` lookup came back null and blur/outside-click
  // wiped the name back to '' — a filled form that reads as empty with the
  // save button still enabled. The picker now hands the whole row up via
  // `onSelect(id, customer)` and keeps it, so a lookup miss is never the
  // only source of truth for the current selection.
  it('a remote-only pick keeps its name after blur (onSelect receives the row)', async () => {
    jest.useFakeTimers()
    try {
      const remoteRow: CustomerSearchOption = { id: 'r1', name: '遠藤三郎', other_store: false }
      const onRemoteSearch = jest.fn().mockResolvedValue({
        options: [remoteRow],
        karute_number_unavailable: false,
        remote_more: false,
      })
      const onSelect = jest.fn()
      // A minimal controlled wrapper — real callers (NewBookingDialog etc.)
      // feed onSelect straight into a setState setter, so selectedId tracks
      // the pick exactly like this.
      function Wrapper() {
        const [selectedId, setSelectedId] = useState<string | null>(null)
        return (
          <CustomerCombobox
            customers={[]}
            selectedId={selectedId}
            onSelect={(id, customer) => {
              onSelect(id, customer)
              setSelectedId(id)
            }}
            onCreateNew={jest.fn()}
            onRemoteSearch={onRemoteSearch}
          />
        )
      }
      render(<Wrapper />)
      const input = screen.getByRole('combobox')
      fireEvent.change(input, { target: { value: '遠藤' } })
      await act(async () => {
        jest.advanceTimersByTime(250)
      })
      fireEvent.mouseDown(screen.getByText('遠藤三郎'))
      expect(onSelect).toHaveBeenCalledWith('r1', remoteRow)
      fireEvent.blur(input)
      expect(input).toHaveValue('遠藤三郎')
    } finally {
      jest.useRealTimers()
    }
  })
})

// RecordCustomerPickerDialog has no dedicated test file (`find src -name
// '*RecordCustomerPicker*'` matches only the component) — smallest render
// test lives next to the combobox one it shares onSelect's shape with.
describe('RecordCustomerPickerDialog', () => {
  it('a search-result row click calls onSelectCustomer with (id, name)', () => {
    const onSelectCustomer = jest.fn()
    render(
      <RecordCustomerPickerDialog
        customers={[{ id: 'c1', name: '山田太郎' }]}
        bookings={[]}
        onSelectBooking={jest.fn()}
        onSelectCustomer={onSelectCustomer}
        onClose={jest.fn()}
        cancelLabel="cancel"
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '山田' } })
    fireEvent.click(screen.getByText('山田太郎'))
    expect(onSelectCustomer).toHaveBeenCalledWith('c1', '山田太郎')
  })
})

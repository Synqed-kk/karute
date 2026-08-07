/**
 * @jest-environment jsdom
 *
 * CustomerCombobox contract (fix/creation-dialogs): the picker must NOT dump
 * the full customer list on mere focus — it only opens once the staff has
 * typed something. Matches by name or phone digits (dashes/spaces ignored on
 * both sides), caps results at 8, and closes on blur.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { CustomerCombobox, type CustomerOption } from '@/components/karute/CustomerCombobox'

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
})

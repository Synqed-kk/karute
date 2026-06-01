/**
 * @jest-environment jsdom
 *
 * Render + interaction coverage for ImportScopePicker (PR 23, replay/23): the
 * three-tile scope selector (customers / reservations / karute). next-intl is
 * mocked so labels/descriptions render as their translation KEYs. Selection
 * state is asserted via the tile button class names, and onChange is asserted
 * via fireEvent click.
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { ImportScopePicker } from '@/components/data-import/ImportScopePicker'
import type { ImportScope } from '@/components/data-import/types'

// Each tile's accessible name combines its label key and description key
// (both echoed by the mocked t()). The label key uniquely identifies the tile.
function tileFor(labelKey: string): HTMLElement {
  return screen.getByText(labelKey).closest('button') as HTMLElement
}

describe('ImportScopePicker', () => {
  it('renders all three scope options with label and description keys', () => {
    render(<ImportScopePicker value="customers" onChange={jest.fn()} />)
    for (const key of [
      'scopeCustomers',
      'scopeReservations',
      'scopeKarute',
      'scopeCustomersDesc',
      'scopeReservationsDesc',
      'scopeKaruteDesc',
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument()
    }
  })

  it('marks the selected scope tile as active', () => {
    render(<ImportScopePicker value="reservations" onChange={jest.fn()} />)
    expect(tileFor('scopeReservations').className).toContain('border-blue-400')
    expect(tileFor('scopeReservations').className).toContain('ring-2')
  })

  it('does not mark non-selected tiles as active', () => {
    render(<ImportScopePicker value="reservations" onChange={jest.fn()} />)
    expect(tileFor('scopeCustomers').className).not.toContain('border-blue-400')
    expect(tileFor('scopeKarute').className).not.toContain('border-blue-400')
  })

  it('fires onChange with the clicked scope key', () => {
    const onChange = jest.fn()
    render(<ImportScopePicker value="customers" onChange={onChange} />)
    fireEvent.click(tileFor('scopeKarute'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith<[ImportScope]>('karute')
  })

  it('still fires onChange when the already-selected tile is clicked', () => {
    const onChange = jest.fn()
    render(<ImportScopePicker value="customers" onChange={onChange} />)
    fireEvent.click(tileFor('scopeCustomers'))
    expect(onChange).toHaveBeenCalledWith('customers')
  })

  it('renders the section question prompt', () => {
    render(<ImportScopePicker value="customers" onChange={jest.fn()} />)
    expect(screen.getByText('question')).toBeInTheDocument()
  })
})

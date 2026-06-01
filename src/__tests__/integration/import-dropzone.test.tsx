/**
 * @jest-environment jsdom
 *
 * Render + interaction coverage for ImportDropzone (PR 23, replay/23).
 *
 * The drag-and-drop branch relies on a DragEvent.dataTransfer that jsdom does
 * not implement, so it is NOT exercised here. The equivalent file-selection
 * logic is fully covered through the native <input type="file"> change path,
 * which shares the same handlePickedFile() handler.
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { ImportDropzone } from '@/components/data-import/ImportDropzone'

// Per-scope recommended columns are static and rendered as chips.
const SAMPLE_COLUMNS = {
  customers: ['name', 'age', 'gender', 'phone', 'email', 'preferred_staff'],
  reservations: ['date', 'time', 'customer_name', 'service', 'duration', 'staff_id'],
  karute: ['session_date', 'customer_id', 'staff_id', 'entries', 'summary'],
} as const

describe('ImportDropzone', () => {
  it('renders the dropzone prompt, format cards, and choose-file button', () => {
    render(<ImportDropzone scope="customers" />)
    expect(screen.getByText('dropOrClick')).toBeInTheDocument()
    expect(screen.getByText('chooseFile')).toBeInTheDocument()
    // three format reference cards
    expect(screen.getByText('csvTitle')).toBeInTheDocument()
    expect(screen.getByText('excelTitle')).toBeInTheDocument()
    expect(screen.getByText('jsonTitle')).toBeInTheDocument()
  })

  it('renders the recommended columns for the customers scope', () => {
    render(<ImportDropzone scope="customers" />)
    for (const col of SAMPLE_COLUMNS.customers) {
      expect(screen.getByText(col)).toBeInTheDocument()
    }
  })

  it('renders the recommended columns for the reservations scope', () => {
    render(<ImportDropzone scope="reservations" />)
    for (const col of SAMPLE_COLUMNS.reservations) {
      expect(screen.getByText(col)).toBeInTheDocument()
    }
    // a customers-only column should not be present
    expect(screen.queryByText('preferred_staff')).not.toBeInTheDocument()
  })

  it('renders the recommended columns for the karute scope', () => {
    render(<ImportDropzone scope="karute" />)
    for (const col of SAMPLE_COLUMNS.karute) {
      expect(screen.getByText(col)).toBeInTheDocument()
    }
  })

  it('logs the picked file via the native file input change handler', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {})
    const { container } = render(<ImportDropzone scope="karute" />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    const file = new File(['col1,col2\n1,2'], 'roster.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(info).toHaveBeenCalledWith(
      '[dev] Import file selected',
      expect.objectContaining({ name: 'roster.csv', scope: 'karute' }),
    )
    info.mockRestore()
  })

  it('does not log when the change fires with no file selected', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {})
    const { container } = render(<ImportDropzone scope="customers" />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [] } })

    expect(info).not.toHaveBeenCalled()
    info.mockRestore()
  })

  it('forwards the choose-file button click to the hidden file input', () => {
    const { container } = render(<ImportDropzone scope="customers" />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = jest.spyOn(input, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByText('chooseFile'))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })
})

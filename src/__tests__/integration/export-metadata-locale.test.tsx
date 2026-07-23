/**
 * @jest-environment jsdom
 *
 * Ja-sweep pins (packet 27): the export scope/format/filter/column metadata
 * from src/lib/export/scopes.ts renders its Ja twin at locale="ja" and the
 * existing English at locale="en" — display-only, next-intl mocked
 * key-echo style (matches the suite's convention).
 */
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}))

import { ExportColumnsPicker } from '@/components/export/redesign/sections/ExportColumnsPicker'
import { ExportFormatPicker } from '@/components/export/redesign/sections/ExportFormatPicker'
import { ExportFilterPanel } from '@/components/export/redesign/sections/ExportFilterPanel'
import { ExportScopePicker } from '@/components/export/redesign/sections/ExportScopePicker'

describe('export metadata — locale rendering', () => {
  it('ExportColumnsPicker: ja renders 顧客ID + 識別子, not the English column/group text', () => {
    render(
      <ExportColumnsPicker
        scopeKey="customers"
        selected={['customer_id']}
        onChange={() => {}}
        privacy={false}
        locale="ja"
      />,
    )
    expect(screen.getByText('顧客ID')).toBeTruthy()
    expect(screen.getByText('識別子')).toBeTruthy()
    expect(screen.queryByText('Customer ID')).toBeNull()
    expect(screen.queryByText('Identifiers')).toBeNull()
  })

  it('ExportColumnsPicker: en preserves the English column/group text', () => {
    render(
      <ExportColumnsPicker
        scopeKey="customers"
        selected={['customer_id']}
        onChange={() => {}}
        privacy={false}
        locale="en"
      />,
    )
    expect(screen.getByText('Customer ID')).toBeTruthy()
    expect(screen.getByText('Identifiers')).toBeTruthy()
    expect(screen.queryByText('顧客ID')).toBeNull()
  })

  it('ExportFormatPicker: ja renders the CSV format Ja sub', () => {
    render(
      <ExportFormatPicker scopeKey="customers" value="csv" onChange={() => {}} locale="ja" />,
    )
    expect(screen.getByText('UTF-8（BOM付き）・汎用性が高い')).toBeTruthy()
  })

  it('ExportFormatPicker: en preserves the CSV format English sub', () => {
    render(
      <ExportFormatPicker scopeKey="customers" value="csv" onChange={() => {}} locale="en" />,
    )
    expect(screen.getByText('UTF-8 with BOM · widely compatible')).toBeTruthy()
  })

  it('ExportFilterPanel: ja renders the filter labelJa', () => {
    render(
      <ExportFilterPanel
        scopeKey="customers"
        filters={{}}
        onChange={() => {}}
        range="30d"
        onRangeChange={() => {}}
        locale="ja"
      />,
    )
    expect(screen.getByText('顧客ステータス')).toBeTruthy()
  })

  it('ExportFilterPanel: en preserves the filter label', () => {
    render(
      <ExportFilterPanel
        scopeKey="customers"
        filters={{}}
        onChange={() => {}}
        range="30d"
        onRangeChange={() => {}}
        locale="en"
      />,
    )
    expect(screen.getByText('Signal')).toBeTruthy()
  })

  it('ExportScopePicker: ja renders the scope subJa', () => {
    render(
      <ExportScopePicker
        value="customers"
        onChange={() => {}}
        totals={{ customers: 0, bookings: 0, karute: 0 }}
        locale="ja"
      />,
    )
    expect(screen.getByText('顧客マスタ・連絡先')).toBeTruthy()
  })

  it('ExportFormatPicker: ja disabled-format title uses labelJa (顧客), not "Customers"', () => {
    render(
      <ExportFormatPicker scopeKey="customers" value="csv" onChange={() => {}} locale="ja" />,
    )
    // PDF isn't supported for the customers scope — its title carries the
    // "not available for <scope>" message.
    const pdfButton = screen.getByText('PDF').closest('button') as HTMLButtonElement
    expect(pdfButton.title).toContain('顧客')
    expect(pdfButton.title).not.toContain('Customers')
  })

  it('ExportFormatPicker: en disabled-format title uses the English scope label', () => {
    render(
      <ExportFormatPicker scopeKey="customers" value="csv" onChange={() => {}} locale="en" />,
    )
    const pdfButton = screen.getByText('PDF').closest('button') as HTMLButtonElement
    expect(pdfButton.title).toContain('Customers')
  })

  it('ExportColumnsPicker: ja search matches labelJa (電話番号 finds Phone), and the key still matches', () => {
    render(
      <ExportColumnsPicker
        scopeKey="customers"
        selected={[]}
        onChange={() => {}}
        privacy={false}
        locale="ja"
      />,
    )
    const input = screen.getByPlaceholderText('filterColumns')

    fireEvent.change(input, { target: { value: '電話番号' } })
    expect(screen.getByText('電話番号')).toBeTruthy()
    expect(screen.queryByText('氏名')).toBeNull()

    // The key ('phone') still matches too — unchanged existing behavior.
    fireEvent.change(input, { target: { value: 'phone' } })
    expect(screen.getByText('電話番号')).toBeTruthy()
  })

  it('ExportColumnsPicker: ja chip tooltip uses labelJa + the Ja PII suffix', () => {
    render(
      <ExportColumnsPicker
        scopeKey="customers"
        selected={['phone']}
        onChange={() => {}}
        privacy={false}
        locale="ja"
      />,
    )
    expect(screen.getByTitle('電話番号 · 個人情報を含む')).toBeTruthy()
  })

  it('ExportColumnsPicker: en chip tooltip uses label + the English PII suffix', () => {
    render(
      <ExportColumnsPicker
        scopeKey="customers"
        selected={['phone']}
        onChange={() => {}}
        privacy={false}
        locale="en"
      />,
    )
    expect(screen.getByTitle('Phone · contains PII')).toBeTruthy()
  })
})

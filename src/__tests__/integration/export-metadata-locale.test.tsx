/**
 * @jest-environment jsdom
 *
 * Ja-sweep pins (packet 27): the export scope/format/filter/column metadata
 * from src/lib/export/scopes.ts renders its Ja twin at locale="ja" and the
 * existing English at locale="en" — display-only, next-intl mocked
 * key-echo style (matches the suite's convention).
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { ExportColumnsPicker } from '@/components/export/redesign/sections/ExportColumnsPicker'
import { ExportFormatPicker } from '@/components/export/redesign/sections/ExportFormatPicker'
import { ExportFilterPanel } from '@/components/export/redesign/sections/ExportFilterPanel'

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
})

/**
 * @jest-environment jsdom
 *
 * Render coverage for RecentImportsTable (PR 23, replay/23): row rendering,
 * empty state, status pill styling, and scope/status label mapping.
 *
 * next-intl is mocked so labels render as translation KEYs and interpolation
 * is dropped — i.e. t('successRate', { pct }) renders the bare key
 * "successRate", NOT the formatted percentage. Numeric content (success /
 * total counts, file name/size) is real component output and is asserted as
 * such; the computed successRate percentage is therefore NOT observable
 * through the mocked t() and is left unasserted by design.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { RecentImportsTable } from '@/components/data-import/RecentImportsTable'
import type {
  ImportRecord,
  ImportScope,
  ImportStatus,
} from '@/components/data-import/types'

let seq = 0
function record(over: Partial<ImportRecord> = {}): ImportRecord {
  seq += 1
  return {
    id: `rec-${seq}`,
    scope: 'customers',
    fileName: `file-${seq}.csv`,
    fileSize: '12.4 KB',
    importedAt: '2026-05-01 09:00',
    importedBy: 'Tanaka',
    status: 'completed',
    recordCount: 100,
    successCount: 100,
    errorCount: 0,
    ...over,
  }
}

beforeEach(() => {
  seq = 0
})

describe('RecentImportsTable', () => {
  it('renders the empty state when there are no records', () => {
    render(<RecentImportsTable records={[]} />)
    expect(screen.getByText('emptyState')).toBeInTheDocument()
    // header title + count chip still render
    expect(screen.getByText('title')).toBeInTheDocument()
  })

  it('does not render the empty state when records exist', () => {
    render(<RecentImportsTable records={[record()]} />)
    expect(screen.queryByText('emptyState')).not.toBeInTheDocument()
  })

  it('renders a row per record with file name, size, and importer', () => {
    render(
      <RecentImportsTable
        records={[
          record({ fileName: 'alpha.csv', fileSize: '1.0 KB', importedBy: 'Aoki' }),
          record({ fileName: 'beta.xlsx', fileSize: '2.0 KB', importedBy: 'Sato' }),
        ]}
      />,
    )
    expect(screen.getByText('alpha.csv')).toBeInTheDocument()
    expect(screen.getByText('beta.xlsx')).toBeInTheDocument()
    expect(screen.getByText('1.0 KB')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    // importer + timestamp + scope share one metadata line; importer is real text
    expect(screen.getByText(/Aoki/)).toBeInTheDocument()
    expect(screen.getByText(/Sato/)).toBeInTheDocument()
  })

  it('renders the success and total counts for a row', () => {
    render(
      <RecentImportsTable
        records={[record({ successCount: 87, recordCount: 90 })]}
      />,
    )
    expect(screen.getByText('87')).toBeInTheDocument()
    // total is rendered as "/ 90" alongside the count
    expect(screen.getByText(/\/\s*90/)).toBeInTheDocument()
  })

  it('shows the failed-count fragment only when errorCount > 0', () => {
    const { rerender } = render(
      <RecentImportsTable records={[record({ errorCount: 0 })]} />,
    )
    expect(screen.queryByText('failedCount')).not.toBeInTheDocument()

    rerender(<RecentImportsTable records={[record({ errorCount: 5 })]} />)
    // rendered as "· failedCount" inside one span (the dot is a sibling node)
    expect(screen.getByText(/failedCount/)).toBeInTheDocument()
  })

  const statusCases: { status: ImportStatus; key: string; tone: string }[] = [
    { status: 'completed', key: 'statusCompleted', tone: 'green-50' },
    { status: 'processing', key: 'statusProcessing', tone: 'blue-50' },
    { status: 'failed', key: 'statusFailed', tone: 'red-50' },
    { status: 'validating', key: 'statusValidating', tone: 'yellow-50' },
  ]

  it.each(statusCases)(
    'renders the $status status pill with its label key and tone',
    ({ status, key, tone }) => {
      render(<RecentImportsTable records={[record({ status })]} />)
      const pill = screen.getByText(key)
      expect(pill).toBeInTheDocument()
      expect(pill.className).toContain(`bg-${tone}`)
    },
  )

  const scopeCases: { scope: ImportScope; key: string }[] = [
    { scope: 'customers', key: 'scopeCustomers' },
    { scope: 'reservations', key: 'scopeReservations' },
    { scope: 'karute', key: 'scopeKarute' },
  ]

  it.each(scopeCases)(
    'maps the $scope scope to its label key',
    ({ scope, key }) => {
      render(<RecentImportsTable records={[record({ scope })]} />)
      // scope label is embedded in the metadata line "<scope> · <time> · <by>"
      expect(screen.getByText(new RegExp(key))).toBeInTheDocument()
    },
  )

  it('renders a download button per row', () => {
    render(<RecentImportsTable records={[record(), record()]} />)
    expect(screen.getAllByRole('button', { name: 'downloadAria' })).toHaveLength(2)
  })
})

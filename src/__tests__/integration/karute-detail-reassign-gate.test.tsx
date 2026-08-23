/**
 * @jest-environment jsdom
 *
 * KaruteDetailView — fresh-verify D3 / fix round 5 R5-3: staffCanReassignRecords
 * is threaded all the way to the DTO (pin 8, three test files) but nothing
 * proved the VIEW actually consumes it. Deleting `staffCanReassignRecords &&`
 * from KaruteDetailView.tsx's actions condition passed the entire suite
 * before this pin — the flag existing everywhere except the one place that
 * enforces "hide, never show-and-refuse" (packet §2g / §3) was unpinned.
 *
 * CustomerHeaderCard is stubbed to actually RENDER its `actions` prop
 * (unlike karute-photo-placement.test.tsx's `() => null`, which hides this
 * gate entirely) — real CustomerHeaderCard pulls next-intl navigation
 * (`@/i18n/navigation`), out of scope here. ReassignCustomerAction is
 * stubbed to a sentinel marker — its own internals are covered by
 * reassign-customer-action-copy.test.tsx. Every other sibling card is an
 * inert stub, same house pattern as karute-photo-placement.test.tsx.
 */
import { render, screen } from '@testing-library/react'

jest.mock('@/components/karute/redesign/detail/CustomerHeaderCard', () => ({
  CustomerHeaderCard: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}))
jest.mock('@/components/karute/redesign/detail/ReassignCustomerAction', () => ({
  ReassignCustomerAction: () => <div data-testid="reassign-action">顧客を変更</div>,
}))
jest.mock('@/components/karute/redesign/detail/DetailBreadcrumb', () => ({
  DetailBreadcrumb: () => null,
}))
jest.mock('@/components/karute/redesign/detail/AISummaryCard', () => ({
  AISummaryCard: () => null,
}))
jest.mock('@/components/karute/redesign/detail/CurrentSessionCard', () => ({
  CurrentSessionCard: () => null,
}))
jest.mock('@/components/karute/redesign/detail/RegenerateEntriesButton', () => ({
  RegenerateEntriesButton: () => null,
}))
jest.mock('@/components/karute/redesign/detail/RecordingTranscriptCard', () => ({
  RecordingTranscriptCard: () => null,
}))
jest.mock('@/components/karute/redesign/detail/CustomerMemoryCard', () => ({
  CustomerMemoryCard: () => null,
}))
jest.mock('@/components/karute/redesign/detail/OutcomeCard', () => ({
  OutcomeCard: () => null,
}))
jest.mock('@/components/coaching/redesign/KaruteCoachingPanel', () => ({
  KaruteCoachingPanel: () => null,
}))

import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'

function renderView(staffCanReassignRecords: boolean, customerId: string | null = 'c1') {
  return render(
    <KaruteDetailView
      karuteId="k1"
      customerId={customerId}
      header={{ customerName: 'テスト 太郎', karuteNumber: '#00001' } as never}
      sessionDateLong="August 9, 2026"
      entries={[]}
      summaryBullets={[]}
      transcript={null}
      consentOnFile={false}
      transcriptDurationLabel={null}
      photosSlot={null}
      memory={null}
      bodyPredictionSlot={null}
      suggestedMessageSlot={null}
      outcome={null}
      staffCanReassignRecords={staffCanReassignRecords}
    />,
  )
}

describe('KaruteDetailView — 顧客を変更 hide-gate (fresh D3, R5-4)', () => {
  it('staffCanReassignRecords: false → NO 顧客を変更 entry point in the tree', () => {
    renderView(false)
    expect(screen.queryByTestId('reassign-action')).toBeNull()
  })

  it('staffCanReassignRecords: true → the entry point is present', () => {
    renderView(true)
    expect(screen.getByTestId('reassign-action')).toBeInTheDocument()
  })

  it('staffCanReassignRecords: true but no customerId → still hidden (existing customerId guard)', () => {
    renderView(true, null)
    expect(screen.queryByTestId('reassign-action')).toBeNull()
  })
})

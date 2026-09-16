/**
 * @jest-environment jsdom
 *
 * KaruteDetailView — THE STORE LOCK'S SCREEN HALF (⚖ Liam 2026-09-16).
 *
 * The server refuses every by-id write on a record outside the viewer's store
 * assignment. This pins the other half of the law — hide, never
 * show-and-refuse: the entry pencil, the summary pencil and the 成約 control
 * must not render for such a record, and the record's CONTENT must still read
 * (this is a write lock, not a read one).
 *
 * The three cards are stubbed to ECHO the props that carry the gate, the same
 * shape karute-detail-reassign-gate.test.tsx uses for `actions`/`headerAction`
 * — a `() => null` stub would hide the very thing these cases pin. The pencils
 * themselves are covered by their own suites; what is unpinned without this
 * file is whether the VIEW passes the gate down at all.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))
jest.mock('@/components/karute/redesign/detail/CustomerHeaderCard', () => ({
  CustomerHeaderCard: () => null,
}))
jest.mock('@/components/karute/redesign/detail/DetailBreadcrumb', () => ({
  DetailBreadcrumb: () => null,
}))
// Same inert stubs as karute-detail-reassign-gate.test.tsx — both reach real
// server actions, which drag next's server stream utils into jsdom.
jest.mock('@/components/karute/redesign/detail/ReassignCustomerAction', () => ({
  ReassignCustomerAction: () => null,
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
jest.mock('@/components/coaching/redesign/KaruteCoachingPanel', () => ({
  KaruteCoachingPanel: () => null,
}))

// The entry pencil's seam: an ABSENT karuteRecordId is what disables it
// (CurrentSessionCard's own contract, shared with the R8 discarded door).
jest.mock('@/components/karute/redesign/detail/CurrentSessionCard', () => ({
  CurrentSessionCard: ({ karuteRecordId, entries }: { karuteRecordId?: string; entries: unknown[] }) => (
    <div>
      <div data-testid="entries-count">{entries.length}</div>
      {karuteRecordId ? <div data-testid="entry-pencil">記録を編集</div> : null}
    </div>
  ),
}))
// The summary pencil's seam: the same absent-id contract.
jest.mock('@/components/karute/redesign/detail/AISummaryCard', () => ({
  AISummaryCard: ({ karuteRecordId, bullets }: { karuteRecordId?: string; bullets: string[] }) => (
    <div>
      <div data-testid="summary-text">{bullets.join('/')}</div>
      {karuteRecordId ? <div data-testid="summary-pencil">要約を編集</div> : null}
    </div>
  ),
}))
// The 成約 control's seam: readOnly keeps the chip and drops the button.
jest.mock('@/components/karute/redesign/detail/OutcomeCard', () => ({
  OutcomeCard: ({ readOnly }: { readOnly?: boolean }) => (
    <div>
      <div data-testid="outcome-chip">成約</div>
      {readOnly ? null : <div data-testid="outcome-button">記録</div>}
    </div>
  ),
}))

import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'

function renderView(extra: { staffCanEditRecord?: boolean } = {}) {
  return render(
    <KaruteDetailView
      karuteId="k1"
      customerId="c1"
      header={{ customerName: 'テスト 太郎', karuteNumber: '#00001' } as never}
      sessionDateLong="2026年6月1日(月)"
      entries={[{ id: 'e1' } as never]}
      summaryBullets={['肩こり改善傾向']}
      transcript={null}
      consentOnFile={false}
      transcriptDurationLabel={null}
      photosSlot={null}
      memory={null}
      bodyPredictionSlot={null}
      suggestedMessageSlot={null}
      outcome={null}
      staffCanReassignRecords={false}
      {...extra}
    />,
  )
}

describe('KaruteDetailView — the store lock hides every write control', () => {
  it('staffCanEditRecord: false → no entry pencil, no summary pencil, no 成約 button', () => {
    renderView({ staffCanEditRecord: false })
    expect(screen.queryByTestId('entry-pencil')).toBeNull()
    expect(screen.queryByTestId('summary-pencil')).toBeNull()
    expect(screen.queryByTestId('outcome-button')).toBeNull()
  })

  it('…and the record still READS — this is a write lock, not a read one', () => {
    renderView({ staffCanEditRecord: false })
    expect(screen.getByTestId('entries-count')).toHaveTextContent('1')
    expect(screen.getByTestId('summary-text')).toHaveTextContent('肩こり改善傾向')
    expect(screen.getByTestId('outcome-chip')).toBeInTheDocument()
  })

  it('staffCanEditRecord: true → every control is back', () => {
    renderView({ staffCanEditRecord: true })
    expect(screen.getByTestId('entry-pencil')).toBeInTheDocument()
    expect(screen.getByTestId('summary-pencil')).toBeInTheDocument()
    expect(screen.getByTestId('outcome-button')).toBeInTheDocument()
  })

  // ⚠ ABSENT ≠ DENIED here, unlike staffCanReassignRecords/staffCanRegenerate.
  // A baked shell holding a payload minted before the field existed shows
  // exactly today's screen; the SERVER refuses the write either way, so the
  // cost of the old look is a refused tap, never an unlocked door.
  it('the flag ABSENT → today’s screen, unchanged (baked-shell compatibility)', () => {
    renderView()
    expect(screen.getByTestId('entry-pencil')).toBeInTheDocument()
    expect(screen.getByTestId('summary-pencil')).toBeInTheDocument()
    expect(screen.getByTestId('outcome-button')).toBeInTheDocument()
  })

  it('a DISCARDED record stays read-only regardless of the store flag (R8 still wins)', () => {
    render(
      <KaruteDetailView
        karuteId="k1"
        customerId="c1"
        header={{ customerName: 'テスト 太郎', karuteNumber: '#00001' } as never}
        sessionDateLong="2026年6月1日(月)"
        entries={[{ id: 'e1' } as never]}
        summaryBullets={['肩こり改善傾向']}
        transcript={null}
        consentOnFile={false}
        transcriptDurationLabel={null}
        photosSlot={null}
        memory={null}
        bodyPredictionSlot={null}
        suggestedMessageSlot={null}
        outcome={null}
        staffCanReassignRecords={false}
        staffCanEditRecord
        discarded={{ reason: null, discardedByName: null, discardedAt: null } as never}
      />,
    )
    expect(screen.queryByTestId('entry-pencil')).toBeNull()
  })
})

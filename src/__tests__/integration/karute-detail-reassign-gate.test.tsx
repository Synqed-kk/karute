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
// Renders its `headerAction` (fix round 4): the 再生成 hide-gate lives there,
// and a `() => null` stub would hide the very thing the new cases pin.
jest.mock('@/components/karute/redesign/detail/CurrentSessionCard', () => ({
  CurrentSessionCard: ({ headerAction }: { headerAction?: React.ReactNode }) => (
    <div>{headerAction}</div>
  ),
}))
jest.mock('@/components/karute/redesign/detail/RegenerateEntriesButton', () => ({
  RegenerateEntriesButton: () => <div data-testid="regenerate-action">AIで再生成</div>,
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

function renderView(
  staffCanReassignRecords: boolean,
  customerId: string | null = 'c1',
  extra: { transcript?: string | null; staffCanRegenerate?: boolean } = {},
) {
  return render(
    <KaruteDetailView
      karuteId="k1"
      customerId={customerId}
      header={{ customerName: 'テスト 太郎', karuteNumber: '#00001' } as never}
      sessionDateLong="August 9, 2026"
      entries={[]}
      summaryBullets={[]}
      transcript={extra.transcript ?? null}
      staffCanRegenerate={extra.staffCanRegenerate}
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

// ── ⚖ 再生成 — HIDE, NEVER SHOW-AND-REFUSE (9/3 named grant; fix round 4) ─────
// The control used to render on `transcript` alone. That was safe while READ
// and ACT were the same key; the named grant splits them, so a grantee could
// read a colleague's words, see 「AIで再生成」, tap it, and be told
// 「再生成に失敗しました」 for a thing she simply may not do. The server's own
// answer now rides the DTO and gates the button.
describe('KaruteDetailView — 再生成 hide-gate (fix round 4)', () => {
  const WORDS = '生の文字起こし'

  it('a NAMED GRANTEE — transcript shown, staffCanRegenerate false → NO 再生成 control', () => {
    renderView(false, 'c1', { transcript: WORDS, staffCanRegenerate: false })
    expect(screen.queryByTestId('regenerate-action')).toBeNull()
  })

  it('the owner’s hand / the recorder — transcript shown, staffCanRegenerate true → the control is present', () => {
    renderView(false, 'c1', { transcript: WORDS, staffCanRegenerate: true })
    expect(screen.getByTestId('regenerate-action')).toBeInTheDocument()
  })

  it('an ABSENT flag (a cached shell’s payload) hides it — never shows-and-refuses', () => {
    renderView(false, 'c1', { transcript: WORDS })
    expect(screen.queryByTestId('regenerate-action')).toBeNull()
  })

  it('no transcript → still hidden, whatever the flag says (the existing half)', () => {
    renderView(false, 'c1', { transcript: null, staffCanRegenerate: true })
    expect(screen.queryByTestId('regenerate-action')).toBeNull()
  })
})

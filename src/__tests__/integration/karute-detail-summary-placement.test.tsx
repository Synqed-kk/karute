/**
 * @jest-environment jsdom
 *
 * Pins the 7/29 詳細記録 ruling (PR #643): the summary card renders under its
 * new ja title AND above the AI提案メッセージ slot on the カルテ detail page.
 * Reads the REAL ja messages so a label drift (back to AI要約 or elsewhere)
 * fails here, not in the field.
 */
import { render, screen } from '@testing-library/react'

// useTranslations resolves against the real ja catalog — the title assertion
// below must break if messages/ja.json changes, so no key-echo stub here.
jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
  return {
    useTranslations: (ns: string) => (key: string) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.')) {
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      }
      return typeof cur === 'string' ? cur : `${ns}.${key}`
    },
  }
})
// AISummaryCard (REAL below) imports SummaryEditSheet → '@/actions/karute';
// the real module pulls next/cache → Next server stream-utils → TextEncoder,
// which CI's jsdom lacks (passes locally only because the local node leaks
// the global). Mock the action seam like every sheet test does — the sheet
// itself never mounts here (no summaryRaw prop → no pencil).
jest.mock('@/actions/karute', () => ({
  updateKaruteDetailSummary: jest.fn(),
  listEntryEditHistory: jest.fn(async () => ({ edits: [], truncated: false })),
}))
// Every sibling card is out of scope — stub to inert placeholders so the view
// renders without their server/client deps. AISummaryCard stays REAL.
jest.mock('@/components/karute/redesign/detail/CustomerHeaderCard', () => ({
  CustomerHeaderCard: () => null,
}))
jest.mock('@/components/karute/redesign/detail/DetailBreadcrumb', () => ({
  DetailBreadcrumb: () => null,
}))
jest.mock('@/components/karute/redesign/detail/CurrentSessionCard', () => ({
  CurrentSessionCard: () => <div data-testid="current-session" />,
}))
jest.mock('@/components/karute/redesign/detail/RegenerateEntriesButton', () => ({
  RegenerateEntriesButton: () => null,
}))
jest.mock('@/components/karute/redesign/detail/RecordingTranscriptCard', () => ({
  RecordingTranscriptCard: () => <div data-testid="transcript" />,
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

function renderView() {
  return render(
    <KaruteDetailView
      karuteId="k1"
      customerId="c1"
      header={{ customerName: 'テスト 太郎', karuteNumber: '#00001' } as never}
      sessionDateLong="July 28, 2026"
      entries={[]}
      summaryBullets={['主訴：背中の痛み']}
      transcript={null}
      consentOnFile={false}
      transcriptDurationLabel={null}
      photosSlot={null}
      memory={null}
      bodyPredictionSlot={null}
      suggestedMessageSlot={<div data-testid="suggested-message" />}
      outcome={null}
    />,
  )
}

test('summary card carries the 詳細記録 title (real ja catalog)', () => {
  renderView()
  expect(screen.getByText('詳細記録')).toBeTruthy()
  expect(screen.queryByText('AI要約')).toBeNull()
})

test('詳細記録 renders ABOVE the AI提案メッセージ slot', () => {
  renderView()
  const title = screen.getByText('詳細記録')
  const suggested = screen.getByTestId('suggested-message')
  // DOCUMENT_POSITION_FOLLOWING: suggested comes after the title in the DOM.
  expect(
    title.compareDocumentPosition(suggested) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

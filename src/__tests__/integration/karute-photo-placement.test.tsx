/**
 * @jest-environment jsdom
 *
 * Pins the 8/10 写真記録 placement ruling (Liam, mock frame C):
 *  1. zero linked photos → the section does not mount AT ALL (the old
 *     「このカルテに紐づく写真はまだありません」 box is gone),
 *  2. with photos → it renders directly under 詳細記録, i.e. AFTER the summary
 *     card in DOM order (it used to sit above AI身体予測 near the top).
 * The view is rendered with the REAL PhotoRecordsCard in photosSlot because
 * that is exactly what both surfaces pass (web PhotoRecordsServer, thin
 * KaruteDetailScreen). next-intl resolves against the REAL ja.json (repo
 * convention) so a label/key drift fails here, not in the field.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') {
          throw new Error(`missing ja.json key: ${ns}.${key}`)
        }
        return cur
      },
  }
})
// AISummaryCard (REAL below — it carries the 詳細記録 title we order against)
// imports SummaryEditSheet → '@/actions/karute'; the real module pulls
// next/cache → Next server stream-utils → TextEncoder, which CI's jsdom lacks.
// Same action-seam mock every sheet test uses.
jest.mock('@/actions/karute', () => ({
  updateKaruteDetailSummary: jest.fn(),
  listEntryEditHistory: jest.fn(async () => ({ edits: [], truncated: false })),
}))
// Sibling cards are out of scope — inert stubs so the view mounts without their
// server/client deps. AISummaryCard + PhotoRecordsCard stay REAL.
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
import {
  PhotoRecordsCard,
  type PhotoRecord,
} from '@/components/karute/redesign/detail/PhotoRecordsCard'

function renderView(photos: PhotoRecord[]) {
  return render(
    <KaruteDetailView
      karuteId="k1"
      customerId="c1"
      header={{ customerName: 'テスト 太郎', karuteNumber: '#00001' } as never}
      sessionDateLong="August 9, 2026"
      entries={[]}
      summaryBullets={['主訴：背中の痛み']}
      transcript={null}
      consentOnFile={false}
      transcriptDurationLabel={null}
      photosSlot={<PhotoRecordsCard photos={photos} />}
      memory={null}
      bodyPredictionSlot={null}
      suggestedMessageSlot={<div data-testid="suggested-message" />}
      outcome={null}
    />,
  )
}

const PHOTO: PhotoRecord = {
  id: 'p1',
  signedUrl: 'https://x/p1',
  category: 'before',
  caption: null,
}

test('zero photos → 写真記録 is not in the document at all', () => {
  renderView([])
  expect(screen.queryByText('写真記録')).toBeNull()
  // The old empty-state copy is gone with it (key deleted from ja/en).
  expect(screen.queryByText(/紐づく写真/)).toBeNull()
})

test('with photos → 写真記録 renders AFTER 詳細記録 in DOM order', () => {
  renderView([PHOTO])
  const summary = screen.getByText('詳細記録')
  const photos = screen.getByText('写真記録')
  // DOCUMENT_POSITION_FOLLOWING: the photo section comes after the summary.
  expect(
    summary.compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

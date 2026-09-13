/**
 * @jest-environment jsdom
 *
 * R8 discarded-record door (⚖ Liam 2026-09-13) — KaruteDetailView render
 * pins (A5, A11). Reads the REAL ja messages (same idiom as
 * karute-detail-summary-placement.test.tsx) so the facts block's labels and
 * the withheld line break here, not in the field, if messages/ja.json drifts.
 * Every sibling card is stubbed to a small marker so presence/absence is a
 * DOM query, not a guess about what a real card would render for empty props.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
  const resolve = (path: string) => {
    let cur: unknown = ja
    for (const part of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part]
    return typeof cur === 'string' ? cur : path
  }
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let s = resolve(`${ns}.${key}`)
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
      return s
    },
    useLocale: () => 'ja',
  }
})

jest.mock('@/components/karute/redesign/detail/CustomerHeaderCard', () => ({
  CustomerHeaderCard: () => null,
}))
jest.mock('@/components/karute/redesign/detail/DetailBreadcrumb', () => ({
  DetailBreadcrumb: () => null,
}))
jest.mock('@/components/karute/redesign/detail/OutcomeCard', () => ({
  OutcomeCard: () => <div data-testid="outcome-card" />,
}))
jest.mock('@/components/karute/redesign/detail/ReassignCustomerAction', () => ({
  ReassignCustomerAction: () => <div data-testid="reassign-action" />,
}))
jest.mock('@/components/karute/redesign/detail/RegenerateEntriesButton', () => ({
  RegenerateEntriesButton: () => <div data-testid="regenerate-action" />,
}))
jest.mock('@/components/karute/redesign/detail/AISummaryCard', () => ({
  // The real card's read-only mode is `summaryRaw === null` (canEdit = !!id
  // && raw !== null) — karuteRecordId itself is ALWAYS passed straight
  // through (A5's mechanism for THIS card is nulling summaryRaw, not
  // omitting the id, unlike CurrentSessionCard below).
  AISummaryCard: ({
    bullets,
    summaryRaw,
  }: {
    bullets: string[]
    summaryRaw?: string | null
  }) => <div data-testid="ai-summary">{`${bullets.length}:${summaryRaw === null ? 'no-edit' : 'editable'}`}</div>,
}))
jest.mock('@/components/karute/redesign/detail/CurrentSessionCard', () => ({
  CurrentSessionCard: ({ entries, karuteRecordId }: { entries: unknown[]; karuteRecordId?: string }) => (
    <div data-testid="current-session">{`${entries.length}:${karuteRecordId ?? 'no-id'}`}</div>
  ),
}))
jest.mock('@/components/karute/redesign/detail/RecordingTranscriptCard', () => ({
  RecordingTranscriptCard: ({
    transcript,
    restricted,
    recording,
  }: {
    transcript: string | null
    restricted?: boolean
    recording?: unknown
  }) => <div data-testid="transcript-card">{`${transcript ?? 'null'}:${!!restricted}:${!!recording}`}</div>,
}))
jest.mock('@/components/karute/redesign/detail/CustomerMemoryCard', () => ({
  CustomerMemoryCard: () => null,
}))
jest.mock('@/components/coaching/redesign/KaruteCoachingPanel', () => ({
  KaruteCoachingPanel: () => <div data-testid="coaching-panel" />,
}))

import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'
import type { KaruteDetailScreenDiscarded } from '@/lib/karute/detail-screen'

const DISCARDED: KaruteDetailScreenDiscarded = {
  reason: 'テスト理由',
  discardedByName: '佐藤',
  discardedAt: '2026-06-02T03:00:00Z',
  recordStaffName: '田中',
  durationSeconds: 252,
}

function renderView(opts: {
  discarded?: KaruteDetailScreenDiscarded | null
  contentWithheld?: boolean
  entries?: unknown[]
  summaryBullets?: string[]
  summaryRaw?: string | null
  transcript?: string | null
  transcriptRestricted?: boolean
  recording?: { audioPresent: boolean; durationSeconds: number | null; status: string } | null
}) {
  return render(
    <KaruteDetailView
      karuteId="k1"
      customerId="c1"
      header={{ customerName: 'テスト 太郎', karuteNumber: '#00001' } as never}
      sessionDateLong="2026年6月1日"
      entries={(opts.entries ?? []) as never}
      summaryBullets={opts.summaryBullets ?? []}
      summaryRaw={opts.summaryRaw ?? null}
      transcript={opts.transcript ?? null}
      transcriptRestricted={opts.transcriptRestricted ?? false}
      recording={opts.recording ?? null}
      consentOnFile={false}
      transcriptDurationLabel={null}
      photosSlot={null}
      memory={null}
      bodyPredictionSlot={<div data-testid="body-prediction" />}
      suggestedMessageSlot={<div data-testid="suggested-message" />}
      outcome={null}
      staffCanReassignRecords={false}
      staffCanRegenerate={false}
      discarded={opts.discarded ?? null}
      contentWithheld={opts.contentWithheld ?? false}
    />,
  )
}

describe('KaruteDetailView — R8 discarded-record door (A5)', () => {
  it('a LIVE record (discarded=null) is completely unaffected: OutcomeCard + both AI slots + coaching panel all present', () => {
    renderView({ discarded: null })
    expect(screen.getByTestId('outcome-card')).toBeInTheDocument()
    expect(screen.queryByText('破棄済み')).not.toBeInTheDocument()
    expect(screen.getByTestId('body-prediction')).toBeInTheDocument()
    expect(screen.getByTestId('suggested-message')).toBeInTheDocument()
    expect(screen.getByTestId('coaching-panel')).toBeInTheDocument()
  })

  it('discarded + contentWithheld: facts block replaces OutcomeCard; no reassign/regenerate/AI-slots/coaching; the ONE withheld line shows; every content field is empty/null as the server already blanked it', () => {
    renderView({
      discarded: DISCARDED,
      contentWithheld: true,
      entries: [],
      summaryBullets: [],
      transcript: null,
      transcriptRestricted: true,
      recording: null,
    })
    // Facts block present, OutcomeCard gone.
    expect(screen.getByText('破棄済み')).toBeInTheDocument()
    expect(screen.queryByTestId('outcome-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reassign-action')).not.toBeInTheDocument()
    expect(screen.queryByTestId('regenerate-action')).not.toBeInTheDocument()
    // Facts themselves, native ja labels.
    expect(screen.getByText('理由')).toBeInTheDocument()
    expect(screen.getByText('テスト理由')).toBeInTheDocument()
    expect(screen.getByText('破棄したスタッフ')).toBeInTheDocument()
    expect(screen.getByText('佐藤')).toBeInTheDocument()
    expect(screen.getByText('担当スタッフ')).toBeInTheDocument()
    expect(screen.getByText('田中')).toBeInTheDocument()
    expect(screen.getByText('録音時間')).toBeInTheDocument()
    expect(screen.getByText('4分12秒')).toBeInTheDocument()
    // The ONE withheld line.
    expect(
      screen.getByText('この記録の内容は、記録を担当したスタッフのみ閲覧できます。'),
    ).toBeInTheDocument()
    // Both AI slots + coaching panel hidden.
    expect(screen.queryByTestId('body-prediction')).not.toBeInTheDocument()
    expect(screen.queryByTestId('suggested-message')).not.toBeInTheDocument()
    expect(screen.queryByTestId('coaching-panel')).not.toBeInTheDocument()
    // Content cards receive the already-blanked, server-withheld values.
    expect(screen.getByTestId('ai-summary').textContent).toBe('0:no-edit')
    expect(screen.getByTestId('current-session').textContent).toBe('0:no-id')
    // restricted suppressed to false for a discarded record (the ONE line
    // above covers it) — the stub echoes exactly what KaruteDetailView passed.
    expect(screen.getByTestId('transcript-card').textContent).toBe('null:false:false')
  })

  it('discarded but content NOT withheld (the record’s own staffer, or a viewAll holder): facts block shows, but the shared content still renders — only the write controls are gone', () => {
    renderView({
      discarded: DISCARDED,
      contentWithheld: false,
      entries: [{ id: 'e1' }],
      summaryBullets: ['・肩こり'],
      transcript: 'RAW TEXT',
      transcriptRestricted: false,
      recording: { audioPresent: true, durationSeconds: 90, status: 'COMPLETED' },
    })
    expect(screen.getByText('破棄済み')).toBeInTheDocument()
    // No withheld line — content is visible.
    expect(
      screen.queryByText('この記録の内容は、記録を担当したスタッフのみ閲覧できます。'),
    ).not.toBeInTheDocument()
    // Content cards get the REAL content...
    expect(screen.getByTestId('ai-summary').textContent).toBe('1:no-edit')
    expect(screen.getByTestId('current-session').textContent).toBe('1:no-id')
    expect(screen.getByTestId('transcript-card').textContent).toBe('RAW TEXT:false:true')
    // ...but summaryRaw is forced null (AISummaryCard's own read-only mode)
    // and karuteRecordId is omitted on CurrentSessionCard, so NEITHER card's
    // edit pencil renders — a discarded record is read-only for EVERYONE,
    // owner included (A5), even though the content itself is fully visible.
    // AI slots + coaching panel still hidden — read-only/no-new-AI applies
    // to any discarded record regardless of contentWithheld.
    expect(screen.queryByTestId('body-prediction')).not.toBeInTheDocument()
    expect(screen.queryByTestId('suggested-message')).not.toBeInTheDocument()
    expect(screen.queryByTestId('coaching-panel')).not.toBeInTheDocument()
  })

  it('a missing fact renders 不明 (F9)', () => {
    renderView({
      discarded: { ...DISCARDED, reason: null, discardedByName: null, recordStaffName: null, durationSeconds: null },
      contentWithheld: true,
    })
    expect(screen.getAllByText('不明').length).toBe(4)
  })
})

/**
 * @jest-environment jsdom
 *
 * PR-B commit 4b — the history row says the same thing as the card
 * (RULING-S73-INBOX-ROW R-I1…R-I5 as amended by RULING-S74-AUDIT-REASON
 * R-A1…R-A3). The 録音履歴 row asks the ONE table's damaged-audio leaf
 * (job-errors.ts damagedAudioCode), prints the card's own sentence, offers no
 * 再試行 for those codes, and the audit/notification word follows the row.
 * The first render test is the killer of M-B14 「the history row keeps 再試行
 * for an unreadable job」.
 */
import { render, screen } from '@testing-library/react'
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'
import { RecordingsInboxCard } from '@/components/karute/redesign/record/RecordingsInboxCard'
import {
  deriveInboxRows,
  FAILED_ROW_REASONS,
  type InboxRow,
  type InboxServerSession,
} from '@/lib/recordings/inbox'
import { karuteMissingReasonKey } from '@/lib/audit-labels'

// Real ja.json through a mocked hook; a dotted namespace walks the tree.
jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    let cur: unknown = jest.requireActual('../../../messages/ja.json')
    for (const part of `${ns}.${key}`.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part]
    return typeof cur === 'string' ? cur : key
  },
}))

const NOW = Date.parse('2026-08-25T04:00:00.000Z')
const MIN = 60_000

function failedSession(jobLastError: string): InboxServerSession {
  return {
    recordingSessionId: 's1',
    customerId: 'cust-1',
    createdAt: new Date(NOW - 30 * MIN).toISOString(),
    durationSeconds: 1380,
    karuteRecordId: null,
    jobStatus: 'FAILED',
    jobProbeFailed: false,
    jobLastError,
    serverAudio: 'object',
  }
}
const rowFor = (word: string): InboxRow =>
  deriveInboxRows({ sessions: [failedSession(word)], takes: [], now: NOW })[0]!

function renderRow(row: InboxRow) {
  return render(
    <RecordingsInboxCard
      rows={[row]}
      needsAttention={1}
      serverFailed={false}
      now={NOW}
      locale="ja"
      customerNameById={new Map()}
      onOpenRecord={() => {}}
      onSaveTake={() => {}}
    />,
  )
}
const retryLabel = ja.recording.inbox.action.retry

describe('4b — the row asks the ONE table (R-I1, R-A3)', () => {
  it.each([
    ['audio_unreadable', 'audioUnreadable'],
    ['unreadable_object', 'audioUnreadable'],
    ['audio_partial', 'audioPartial'],
  ])('a FAILED job with %p → reason %p, canRetry false (R-I3)', (word, reason) => {
    const row = rowFor(word)
    expect(row.state).toBe('failed')
    expect(row.reason).toBe(reason)
    expect(row.canRetry).toBe(false)
  })

  it('transcription_failed:x → unchanged: transcriptionFailed, retry as today', () => {
    const row = rowFor('transcription_failed: provider timeout')
    expect(row.reason).toBe('transcriptionFailed')
    expect(row.canRetry).toBe(true)
  })
})

describe('4b — the row prints the card\'s sentence and hides 再試行 (R-I2, R-I3, R-I5)', () => {
  it('an audio_unreadable job → the card\'s string on the row, no 再試行 button (M-B14)', () => {
    renderRow(rowFor('audio_unreadable'))
    expect(screen.getByText(ja.recording.pipelineErrorAudioUnreadable)).toBeTruthy()
    expect(screen.queryByText(retryLabel)).toBeNull()
  })

  it('an audio_partial job → the card\'s string on the row, no 再試行 button', () => {
    renderRow(rowFor('audio_partial'))
    expect(screen.getByText(ja.recording.pipelineErrorAudioPartial)).toBeTruthy()
    expect(screen.queryByText(retryLabel)).toBeNull()
  })

  it('a transcription_failed job keeps its own words and its 再試行', () => {
    renderRow(rowFor('transcription_failed: provider timeout'))
    expect(screen.getByText(ja.recording.inbox.reason.transcriptionFailed)).toBeTruthy()
    expect(screen.getByText(retryLabel)).toBeTruthy()
  })
})

describe('4b — the audit word follows the row (R-A1, R-A2)', () => {
  it('every FAILED_ROW_REASONS entry maps to an audit key present in ja AND en', () => {
    const jaReason = ja.settings.auditLog.reason as Record<string, string>
    const enReason = en.settings.auditLog.reason as Record<string, string>
    for (const reason of FAILED_ROW_REASONS) {
      const key = karuteMissingReasonKey(reason)
      expect(key).not.toBeNull()
      const code = key!.slice('reason.'.length)
      expect(typeof jaReason[code]).toBe('string')
      expect(typeof enReason[code]).toBe('string')
    }
  })
})

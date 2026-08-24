/** @jest-environment jsdom */
// Recording-labels fix (owner field report, 2026-08-25 packet): discarded-
// recording rows (recording.session_cleanup) used to render database jargon
// ("録音セッション行を削除") as the title and a raw session UUID as the
// subtitle — session_cleanup.ts hard-deletes the recording_sessions row, so
// detail.customer_id (stamped at write time) is the only surviving context.
// Same harness as audit-log-section-menu-autostart-detail.test.tsx: renders
// the REAL component with only the server-action boundary mocked.
import { render, waitFor } from '@testing-library/react'
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'

const DICT: Record<string, string> = {
  recordingNoCustomer: '顧客未選択の録音',
  durationSuffix: '（{n}秒）',
}

jest.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign(
      (k: string, vals?: Record<string, unknown>) => {
        if (k === 'durationSuffix') return `（${(vals as { n?: unknown })?.n}秒）`
        if (k in DICT) return DICT[k]
        return vals ? `${k}:${JSON.stringify(vals)}` : k
      },
      { has: (k: string) => k in DICT },
    ),
  useLocale: () => 'ja',
}))

const listAuditLog = jest.fn()
jest.mock('@/actions/audit-log', () => ({
  listAuditLog: (filters: Record<string, unknown>) => listAuditLog(filters),
}))

// AuditLogSection imports listEntryEditHistory unconditionally (the
// karute.entry_edit expand path) — mocked out same as the other
// AuditLogSection detail tests, unused here.
jest.mock('@/actions/karute', () => ({
  listEntryEditHistory: jest.fn(),
}))

import { AuditLogSection } from '@/components/settings/redesign/sections/AuditLogSection'

const RAW_UUID = '00000000-0000-4000-8000-0000000000aa'

function coreEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    at: '2026-08-25T00:00:00.000Z',
    actor_id: 'staff-1',
    actor_type: 'staff',
    category: 'recording',
    action: 'recording.session_cleanup',
    target_type: 'recording',
    target_id: RAW_UUID,
    target_label: null,
    detail: null,
    break_glass: false,
    severity: 'notice',
    ...overrides,
  }
}

async function renderWithEvents(
  events: Array<Record<string, unknown>>,
  targetLabels: Record<string, string> = {},
) {
  listAuditLog.mockResolvedValue({
    ok: true,
    events,
    total: events.length,
    page: 1,
    hasMore: false,
    breakGlassTotal: 0,
    warningsTotal: 0,
    changesTotal: events.length,
    targetLabels,
  })
  const { container } = render(<AuditLogSection staffList={[]} />)
  await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
  return container
}

beforeEach(() => {
  listAuditLog.mockReset()
})

describe('AuditLogSection — recording.session_cleanup rows never show the raw UUID', () => {
  it('a resolved customer_id renders the customer name, not the id', async () => {
    const container = await renderWithEvents(
      [coreEvent({ detail: { customer_id: 'cus-1', had_audio_path: true } })],
      { [RAW_UUID]: '鈴木 一郎' },
    )
    expect(container.textContent).toContain('鈴木 一郎')
    expect(container.textContent).not.toContain(RAW_UUID)
  })

  it('an unresolved customer_id (null) renders the honest no-customer line — the raw UUID appears NOWHERE', async () => {
    const container = await renderWithEvents([
      coreEvent({ detail: { customer_id: null, had_audio_path: false } }),
    ])
    expect(container.textContent).toContain('顧客未選択の録音')
    expect(container.textContent).not.toContain(RAW_UUID)
  })

  it('a resolved name gets the duration suffix appended when duration_seconds is present', async () => {
    const container = await renderWithEvents(
      [coreEvent({ detail: { customer_id: 'cus-1', had_audio_path: true, duration_seconds: 6 } })],
      { [RAW_UUID]: 'ぴあそん りえむ' },
    )
    expect(container.textContent).toContain('ぴあそん りえむ（6秒）')
  })

  it('the no-customer line also gets the duration suffix when present', async () => {
    const container = await renderWithEvents([
      coreEvent({ detail: { customer_id: null, had_audio_path: false, duration_seconds: 6 } }),
    ])
    expect(container.textContent).toContain('顧客未選択の録音（6秒）')
  })

  it('a legacy row without duration_seconds at all renders cleanly — no "undefined秒", no crash', async () => {
    const container = await renderWithEvents(
      [coreEvent({ detail: { customer_id: 'cus-1', had_audio_path: true } })],
      { [RAW_UUID]: '鈴木 一郎' },
    )
    expect(container.textContent).toContain('鈴木 一郎')
    expect(container.textContent).not.toContain('undefined')
    expect(container.textContent).not.toContain('秒')
  })
})

describe('recording-labels fix — pinned dictionary strings (ja + en)', () => {
  it('the exact ja + en values landed as specified', () => {
    expect(ja.settings.auditLog.recordingNoCustomer).toBe('顧客未選択の録音')
    expect(en.settings.auditLog.recordingNoCustomer).toBe('No customer selected')
    expect(ja.settings.auditLog.durationSuffix).toBe('（{n}秒）')
    expect(en.settings.auditLog.durationSuffix).toBe(' · {n}s')
    expect(ja.settings.auditLog.actions.recording.session_cleanup).toBe('録音を破棄')
    expect(en.settings.auditLog.actions.recording.session_cleanup).toBe('Recording discarded')
  })
})

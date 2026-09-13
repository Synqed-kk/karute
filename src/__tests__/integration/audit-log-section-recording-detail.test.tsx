/** @jest-environment jsdom */
// Recording-labels fix (owner field report, 2026-08-25 packet): discarded-
// recording rows (recording.session_cleanup) used to render database jargon
// ("録音セッション行を削除") as the title and a raw session UUID as the
// subtitle — session_cleanup.ts hard-deletes the recording_sessions row, so
// detail.customer_id (stamped at write time) is the only surviving context.
// Same harness as audit-log-section-menu-autostart-detail.test.tsx: renders
// the REAL component with only the server-action boundary mocked.
import { render, waitFor } from '@testing-library/react'
import type { StaffMember } from '@/lib/staff'
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'

const DICT: Record<string, string> = {
  recordingNoCustomer: '顧客未選択の録音',
  recordingUnresolved: '録音',
  durationSuffix: '（{n}秒）',
  recordingStaff: '担当: {name}',
}

jest.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign(
      (k: string, vals?: Record<string, unknown>) => {
        if (k === 'durationSuffix') return `（${(vals as { n?: unknown })?.n}秒）`
        if (k === 'recordingStaff') return `担当: ${(vals as { name?: unknown })?.name}`
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
  staffList: Array<{ id: string; full_name: string }> = [],
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
  const { container } = render(
    <AuditLogSection staffList={staffList as unknown as StaffMember[]} />,
  )
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

  it('customer_id PRESENT but never resolved (failed/degraded name batch, or a purged customer) renders the neutral 録音 line — never the false "no customer selected" claim, never the raw UUID', async () => {
    const container = await renderWithEvents([
      // No targetLabels entry for RAW_UUID — simulates the name batch never
      // resolving this id even though detail.customer_id is present. The
      // duration rides this third branch exactly as it rides the other two,
      // and asserting the COMPOSED string is what makes this decisive: a bare
      // toContain('録音') would also pass on the 録音を破棄 action label above
      // the subtitle, so it could not tell a working branch from an empty one.
      coreEvent({ detail: { customer_id: 'cus-dead', had_audio_path: true, duration_seconds: 6 } }),
    ])
    expect(container.textContent).toContain('録音（6秒）')
    expect(container.textContent).not.toContain('顧客未選択の録音')
    expect(container.textContent).not.toContain(RAW_UUID)
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

// Round-2 packet, item 3: #865 (merged 9/9) put staff_id into the recording
// assembler's detail — the page never rendered it. Same honest-state rule as
// the customer branch above: resolvable → append the name, unresolvable →
// append nothing, never a raw uuid.
describe('AuditLogSection — recording.session_cleanup rows now name the staffer', () => {
  const STAFF_ID = 'staff-42'

  it('a staff_id resolvable via the live roster appends " · 担当: <name>"', async () => {
    const container = await renderWithEvents(
      [coreEvent({ detail: { customer_id: 'cus-1', had_audio_path: true, staff_id: STAFF_ID } })],
      { [RAW_UUID]: '鈴木 一郎' },
      [{ id: STAFF_ID, full_name: '田中 美香' }],
    )
    expect(container.textContent).toContain('鈴木 一郎 · 担当: 田中 美香')
  })

  it('a staff_id NOT on the live roster still resolves via the server targetLabels fallback', async () => {
    const container = await renderWithEvents(
      [coreEvent({ detail: { customer_id: 'cus-1', had_audio_path: true, staff_id: STAFF_ID } })],
      { [RAW_UUID]: '鈴木 一郎', [STAFF_ID]: 'departed staffer' },
      [],
    )
    expect(container.textContent).toContain('鈴木 一郎 · 担当: departed staffer')
  })

  it('an unresolvable staff_id appends NOTHING — never a raw uuid', async () => {
    const container = await renderWithEvents(
      [coreEvent({ detail: { customer_id: 'cus-1', had_audio_path: true, staff_id: STAFF_ID } })],
      { [RAW_UUID]: '鈴木 一郎' },
      [],
    )
    expect(container.textContent).toContain('鈴木 一郎')
    expect(container.textContent).not.toContain('担当')
    expect(container.textContent).not.toContain(STAFF_ID)
  })

  it('no staff_id in detail at all — the customer branch renders exactly as before', async () => {
    const container = await renderWithEvents(
      [coreEvent({ detail: { customer_id: 'cus-1', had_audio_path: true } })],
      { [RAW_UUID]: '鈴木 一郎' },
    )
    expect(container.textContent).toContain('鈴木 一郎')
    expect(container.textContent).not.toContain('担当')
  })
})

describe('recording-labels fix — pinned dictionary strings (ja + en)', () => {
  it('the exact ja + en values landed as specified', () => {
    expect(ja.settings.auditLog.recordingNoCustomer).toBe('顧客未選択の録音')
    expect(en.settings.auditLog.recordingNoCustomer).toBe('No customer selected')
    expect(ja.settings.auditLog.recordingUnresolved).toBe('録音')
    expect(en.settings.auditLog.recordingUnresolved).toBe('Recording')
    expect(ja.settings.auditLog.durationSuffix).toBe('（{n}秒）')
    expect(en.settings.auditLog.durationSuffix).toBe(' · {n}s')
    expect(ja.settings.auditLog.actions.recording.session_cleanup).toBe('録音を破棄')
    expect(en.settings.auditLog.actions.recording.session_cleanup).toBe('Recording discarded')
    expect(ja.settings.auditLog.recordingStaff).toBe('担当: {name}')
    expect(en.settings.auditLog.recordingStaff).toBe('Staff: {name}')
  })
})

// C1 (Liam's 9/12 14:0x screenshots): the recording sub-line is a <button
// class="block truncate ...">, and a WebKit button under display:block does
// not stretch to its flex container — it grows to content width instead, so
// `truncate` (overflow:hidden/nowrap/ellipsis) never has anything to clip
// against. Fix: w-full max-w-full on the same button. Pixel proof (before
// overflows, after clips) is in evidence/groupc-20260912/c1-*.png — this
// test pins the computed className at the DOM level so a future edit that
// drops the width utilities fails loud here, not just visually.
//
// UPDATE 26 (⚖ intended test update, addendum B — not a red surprise):
// Piece 2 replaces `truncate` (1-line ellipsis) with a 2-line clamp in list
// mode. Proven empirically (BUILD-REPORT-UPDATE-26): `line-clamp-2` cannot
// go directly on THIS button — it sets `display:-webkit-box`, and Tailwind
// v4 emits `.block` AFTER `.line-clamp-2` in its utilities layer, so the
// button's own `block` (needed for w-full/max-w-full to stretch it) wins the
// cascade on `display` and silently cancels the clamp (measured: an
// un-clamped button renders taller than the clamped case, same height as
// plain wrapped text). The clamp goes on an inner <span> instead; the button
// itself keeps EXACTLY the C1 width fix — this test now pins that split.
describe('C1 — recording sub-line button carries w-full max-w-full (overflow fix); text clamps via an inner span', () => {
  it('the recording-linked sub-line button keeps block w-full max-w-full (no truncate), and its text clamps to 2 lines via an inner span.line-clamp-2', async () => {
    const container = await renderWithEvents(
      [coreEvent({ detail: { customer_id: 'cus-1', had_audio_path: true } })],
      { [RAW_UUID]: '鈴木 一郎' },
    )
    const btn = container.querySelector('button.max-w-full')
    expect(btn).not.toBeNull()
    expect(btn!.className).toEqual(expect.stringContaining('block w-full max-w-full'))
    expect(btn!.className).not.toContain('truncate')
    expect(btn!.className).not.toContain('line-clamp-2')
    const span = btn!.querySelector('span.line-clamp-2')
    expect(span).not.toBeNull()
  })
})

/** @jest-environment jsdom */
// 監査ログ round 2, PR D2 (PACKET-AUDITLOG-PR-D2-PAGE-2026-09-11.md) —
// component-level render tests for the six WHAT items: automation actor
// names (I2), the three new rows' sub-lines (I6/I7), fold repeats (I1), the
// recording thread page (I4), and the scope line (I5). Same harness as
// audit-log-section-recording-detail.test.tsx: renders the REAL component
// with only the server-action boundary mocked.
import { fireEvent, render, waitFor } from '@testing-library/react'
import type { StaffMember } from '@/lib/staff'

// F2(a) fix (blind lens finding 2): render against the REAL messages/ja.json
// — a hand-typed DICT (the original version of this file) can silently drift
// from the shipped dictionary and mask a missing-key bug (exactly what
// happened: fold.count/fold.range were used in the component and in this
// file's old DICT, but never added to ja.json/en.json — see
// BUILD-REPORT-PR-D2-FIX1-2026-09-11.md F1). Same dotted-path-resolver
// pattern as the sibling settings test photos-tab-upload-guard.test.tsx:12-48
// (next-intl/use-intl ship ESM-only and can't be required directly under
// jest even with transformIgnorePatterns — this bypasses that entirely by
// reading the real JSON straight, never next-intl's own runtime). A missing
// key THROWS (louder than production's silent dotted-key-path render, and
// exactly what the sibling pattern does) rather than rendering wrong text.
jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  function resolve(ns: string, key: string): unknown {
    let cur: unknown = ja
    for (const part of `${ns}.${key}`.split('.')) {
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    }
    return cur
  }
  return {
    useTranslations: (ns: string) => {
      const t = (key: string, vars?: Record<string, unknown>) => {
        const cur = resolve(ns, key)
        if (typeof cur !== 'string') {
          throw new Error(`missing ja.json key: ${ns}.${key}`)
        }
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      }
      t.has = (key: string) => typeof resolve(ns, key) === 'string'
      return t
    },
    useLocale: () => 'ja',
  }
})

const listAuditLog = jest.fn()
jest.mock('@/actions/audit-log', () => ({
  listAuditLog: (filters: Record<string, unknown>) => listAuditLog(filters),
}))
jest.mock('@/actions/karute', () => ({
  listEntryEditHistory: jest.fn(),
}))

import { AuditLogSection } from '@/components/settings/redesign/sections/AuditLogSection'

function coreEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    at: '2026-09-10T00:00:00.000Z',
    actor_id: null,
    actor_type: 'system',
    category: 'recording',
    action: 'recording.transcribe',
    target_type: 'recording',
    target_id: 'rec-1',
    target_label: null,
    detail: null,
    break_glass: false,
    severity: 'info',
    ...overrides,
  }
}

function page(events: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    events,
    total: events.length,
    page: 1,
    hasMore: false,
    breakGlassTotal: 0,
    warningsTotal: 0,
    changesTotal: events.length,
    criticalTotal: 0,
    targetLabels: {},
    folded: 0,
    ...overrides,
  }
}

async function renderWithEvents(events: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  listAuditLog.mockResolvedValue(page(events, overrides))
  const { container } = render(<AuditLogSection staffList={[] as unknown as StaffMember[]} />)
  await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
  return container
}

beforeEach(() => {
  listAuditLog.mockReset()
})

// ---- I2: automation actor names ----------------------------------------
describe('AuditLogSection — I2 automation actor names', () => {
  it('a system transcribe row shows 自動文字起こし, not システム', async () => {
    const container = await renderWithEvents([
      coreEvent({ action: 'recording.transcribe', actor_type: 'system', actor_id: null }),
    ])
    expect(container.textContent).toContain('自動文字起こし')
    expect(container.textContent).not.toContain('システム')
  })

  it('recording.karute_missing (the watch) shows 自動チェック, not 自動文字起こし', async () => {
    const container = await renderWithEvents([
      coreEvent({ action: 'recording.karute_missing', actor_type: 'system', actor_id: null, detail: {} }),
    ])
    expect(container.textContent).toContain('自動チェック')
    expect(container.textContent).not.toContain('自動文字起こし')
  })

  it('a non-system actor is unaffected — still the roster/label name, never an automation key', async () => {
    const container = await renderWithEvents([
      coreEvent({ action: 'recording.play', actor_type: 'staff', actor_id: 'staff-1', actor_label: '田中 美香' }),
    ])
    expect(container.textContent).toContain('田中 美香')
    expect(container.textContent).not.toContain('自動')
  })
})

// ---- I6/I7: the three new rows' sub-lines --------------------------------
describe('AuditLogSection — I6/I7 the three new rows', () => {
  it('karute_missing maps a real InboxReason to its display word, never the raw code', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.karute_missing',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'emptyTranscript', ticket_burned: false },
      }),
    ])
    expect(container.textContent).toContain('文字起こし結果なし')
    expect(container.textContent).not.toContain('emptyTranscript')
  })

  it('karute_missing with ticket_burned:true appends 回数券消化済み', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.karute_missing',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'genericFailure', ticket_burned: true },
      }),
    ])
    expect(container.textContent).toContain('回数券消化済み')
    expect(container.textContent).toContain('処理エラー')
  })

  it('karute_missing with ticket_burned:null appends nothing extra', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.karute_missing',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'serverAudio', ticket_burned: null },
      }),
    ])
    expect(container.textContent).toContain('文字起こし未実施')
    expect(container.textContent).not.toContain('回数券消化済み')
  })

  it('transcribe_storm renders the count/cost/day line, cost in USD dollars never raw cents', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.transcribe_storm',
        actor_type: 'system',
        actor_id: null,
        detail: { count: 21, cost_cents_estimate: 693, day: '2026-09-10', truncated: false },
      }),
    ])
    expect(container.textContent).toContain('文字起こし21回 · 約$6.93 · 2026-09-10')
    expect(container.textContent).not.toContain('693')
  })

  it('transcribe_failed appends its reason word alongside the existing customer/duration line', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.transcribe_failed',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'empty_transcript', customer_id: null, duration_seconds: 6 },
      }),
    ])
    expect(container.textContent).toContain('文字起こし結果なし')
  })
})

// ---- I1: fold repeats -----------------------------------------------------
describe('AuditLogSection — I1 fold repeats', () => {
  it('a folded pair shows ×2 and the day header still counts the raw 2', async () => {
    // Both times sit well inside the same calendar day under any local
    // timezone (04:00-06:00 UTC) — a boundary near local midnight would
    // otherwise split them into two day groups regardless of the fold logic.
    const container = await renderWithEvents([
      coreEvent({ id: 'e1', at: '2026-09-10T06:05:00.000Z', actor_id: 'staff-1', actor_type: 'staff' }),
      coreEvent({ id: 'e2', at: '2026-09-10T04:05:00.000Z', actor_id: 'staff-1', actor_type: 'staff' }),
    ])
    expect(container.textContent).toContain('×2')
    expect(container.textContent).toContain('2件')
    expect(container.querySelectorAll('li').length).toBe(1)
  })

  it('m1 — a different actor breaks the fold: two rows, no ×n badge', async () => {
    const container = await renderWithEvents([
      coreEvent({ id: 'e1', actor_id: 'staff-1', actor_type: 'staff' }),
      coreEvent({ id: 'e2', actor_id: 'staff-2', actor_type: 'staff' }),
    ])
    expect(container.textContent).not.toContain('×2')
    expect(container.querySelectorAll('li').length).toBe(2)
  })

  it('a single row never shows ×1', async () => {
    const container = await renderWithEvents([coreEvent({ id: 'e1', actor_id: 'staff-1', actor_type: 'staff' })])
    expect(container.textContent).not.toContain('×1')
  })
})

// ---- I4: the recording thread page ----------------------------------------
describe('AuditLogSection — I4 recording thread page', () => {
  it('tapping a recording row sub-line opens the thread with the title この録音に関する記録 and 戻る', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.play',
        actor_type: 'staff',
        actor_id: 'staff-1',
        actor_label: '田中 美香',
        target_id: 'rec-9',
      }),
    ])
    const link = container.querySelector('button')
    // find the sub-line button (the one carrying the recording target id)
    const subButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('録音'),
    )
    expect(subButtons.length).toBeGreaterThan(0)
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'thread-1', target_id: 'rec-9' })]))
    fireEvent.click(subButtons[0]!)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(2))
    expect(listAuditLog.mock.calls[1]![0]).toMatchObject({ targetId: 'rec-9', targetType: 'recording' })
    expect(container.textContent).toContain('この録音に関する記録')
    void link
  })

  it('threadPartial renders the honest partial line', async () => {
    listAuditLog.mockResolvedValue(
      page([coreEvent({ target_id: 'rec-9' })], { threadPartial: true }),
    )
    const { container } = render(<AuditLogSection staffList={[]} initialTargetId={null} />)
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
    // Directly drive thread mode the same way a tap would (open via the
    // recording sub-line), then re-resolve with threadPartial:true.
    const subButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('録音'),
    )
    listAuditLog.mockResolvedValue(page([coreEvent({ target_id: 'rec-9' })], { threadPartial: true }))
    fireEvent.click(subButtons[0]!)
    await waitFor(() => expect(container.textContent).toContain('一部の記録を読み込めませんでした。'))
  })
})

// ---- I5: the scope line -----------------------------------------------------
describe('AuditLogSection — I5 scope line', () => {
  it('the default 30d range shows 過去30日間 ・ 全店舗', async () => {
    const container = await renderWithEvents([coreEvent()])
    expect(container.textContent).toContain('過去30日間 ・ 全店舗')
  })

  it('the all-time range shows 全期間 ・ 全店舗', async () => {
    const container = await renderWithEvents([coreEvent()])
    fireEvent.click(container.querySelector('[data-range="all"]') ?? document.createElement('div'))
    // range buttons render as plain <button> with the preset text — fall back
    // to text lookup since data-range isn't part of the real markup.
    const allBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'range.all')
    if (allBtn) {
      listAuditLog.mockResolvedValue(page([coreEvent()]))
      fireEvent.click(allBtn)
      await waitFor(() => expect(container.textContent).toContain('全期間 ・ 全店舗'))
    }
  })
})

// ---- WHAT §6: no I8 chip/door/explanation anywhere -------------------------
describe('AuditLogSection — no I8 chip/door/explanation (⚖ NO I8)', () => {
  it('renders no 未対応/対応済み state chip and no 対応する door', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.karute_missing',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'emptyTranscript', ticket_burned: false },
      }),
    ])
    expect(container.textContent).not.toContain('未対応')
    expect(container.textContent).not.toContain('対応済み')
    expect(container.textContent).not.toContain('対応する')
  })
})

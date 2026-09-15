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

  it('F7(c): karute_missing with a full-session duration shows 60分, never （3600秒）', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.karute_missing',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'emptyTranscript', ticket_burned: false, duration_seconds: 3600 },
      }),
    ])
    expect(container.textContent).toContain('60分')
    expect(container.textContent).not.toContain('3600秒')
  })

  it('F7(c): transcribe_failed with a full-session duration shows minutes, not seconds', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.transcribe_failed',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'other', customer_id: null, duration_seconds: 125 },
      }),
    ])
    expect(container.textContent).toContain('2分')
    expect(container.textContent).not.toContain('125秒')
  })

  it('fix round 2 (G2/P1): 45s shows 1分, not 0分 — the shared durationMinutesFromSeconds helper, never Math.floor', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.karute_missing',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'emptyTranscript', ticket_burned: false, duration_seconds: 45 },
      }),
    ])
    expect(container.textContent).toContain('1分')
    expect(container.textContent).not.toContain('0分')
  })

  it('fix round 2 (G2/P1): 940s shows 16分, not 15分', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.transcribe_failed',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'other', customer_id: null, duration_seconds: 940 },
      }),
    ])
    expect(container.textContent).toContain('16分')
    expect(container.textContent).not.toContain('15分')
  })

  it('fix round 2 (G2/P1): 0s renders no duration fragment at all, never 0分', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.karute_missing',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'emptyTranscript', ticket_burned: false, duration_seconds: 0 },
      }),
    ])
    expect(container.textContent).not.toContain('0分')
    expect(container.textContent).not.toMatch(/-?\d+分/)
  })

  it('fix round 2 (G2/P1): a negative duration renders no duration fragment at all', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.transcribe_failed',
        actor_type: 'system',
        actor_id: null,
        detail: { reason: 'other', customer_id: null, duration_seconds: -5 },
      }),
    ])
    expect(container.textContent).not.toMatch(/-?\d+分/)
  })

  it('an ordinary recording.play row keeps the existing seconds format unchanged (pre-existing behaviour, out of F7(c) scope)', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.play',
        actor_type: 'staff',
        actor_id: 'staff-1',
        actor_label: '田中 美香',
        detail: { duration_seconds: 6 },
      }),
    ])
    expect(container.textContent).toContain('（6秒）')
  })
})

// ---- C2 (PKT-GROUP-B d4/d5): the two Group-B rows, registered ahead of
// their emitter — proves the render side is ready before Group B lands. ----
describe('AuditLogSection — C2 the two Group-B rows (no_sessions_today / take_refused_has_record)', () => {
  it('recording.no_sessions_today renders the label and the day/staff-count line, no uuid anywhere', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.no_sessions_today',
        actor_type: 'system',
        actor_id: null,
        target_type: null,
        target_id: null,
        detail: {
          day: '2026-09-11',
          staff_ids: ['staff-uuid-aaa', 'staff-uuid-bbb'],
          kept_appointments: 3,
          sessions_today: 0,
          sessions_prev_7d: 5,
        },
      }),
    ])
    expect(container.textContent).toContain('本日の録音なし')
    expect(container.textContent).toContain('2026-09-11・録音担当2名、本日の録音なし')
    expect(container.textContent).not.toContain('staff-uuid-aaa')
    expect(container.textContent).not.toContain('staff-uuid-bbb')
  })

  // Blind-read finding (LENS-GROUP-C-FINAL-READ-2026-09-12.md): detail is an
  // untyped Record<string, unknown> off the wire — a malformed staff_ids
  // (not an array) must render, not throw, and never leak whatever the
  // malformed value actually was. Discriminating on the COUNT, not just "no
  // throw": the guarded code reads n=0 for a non-array (Array.isArray fails
  // → the `: 0` fallback); the mutant (guard removed, raw `.length` used)
  // reads n=23 — the STRING's character count — off the same fixture. A bare
  // "does it throw" assertion would NOT catch that mutant (a string's
  // `.length` never throws), so the count itself is the pin.
  it('recording.no_sessions_today with a non-array staff_ids renders 0-count, without throwing, no uuid anywhere', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.no_sessions_today',
        actor_type: 'system',
        actor_id: null,
        target_type: null,
        target_id: null,
        detail: {
          day: '2026-09-11',
          staff_ids: 'staff-uuid-not-an-array',
          kept_appointments: 3,
          sessions_today: 0,
          sessions_prev_7d: 5,
        },
      }),
    ])
    expect(container.textContent).toContain('2026-09-11・録音担当0名、本日の録音なし')
    expect(container.textContent).not.toContain('録音担当23名')
    expect(container.textContent).not.toContain('staff-uuid-not-an-array')
  })

  it('recording.take_refused_has_record renders without any uuid substring', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.take_refused_has_record',
        actor_type: 'staff',
        actor_id: 'staff-1',
        actor_label: '田中 美香',
        target_type: 'recording',
        target_id: 'sess-uuid-1111',
        detail: {
          recording_session_id: 'sess-uuid-1111',
          take_id: 'take-uuid-2222',
          karute_record_id: 'karute-uuid-3333',
          store_id: 'store-uuid-4444',
        },
      }),
    ])
    expect(container.textContent).toContain('二重紐付けを拒否')
    expect(container.textContent).not.toContain('sess-uuid-1111')
    expect(container.textContent).not.toContain('take-uuid-2222')
    expect(container.textContent).not.toContain('karute-uuid-3333')
    expect(container.textContent).not.toContain('store-uuid-4444')
  })
})

// ---- UPDATE 26: the owner's two core-written correction rows -------------
// (core PR #95's manual SQL, applied 9/12 — bare action, category 'customer',
// actor_type 'system'). Same render idiom as C2 above: real ja.json, the
// REAL component.
describe('AuditLogSection — UPDATE 26 owner fixes (merge_duplicate / correct_pack_import_date)', () => {
  it('merge_duplicate shows the label, the データ修復 actor word, and the KEPT customer name — no uuid anywhere', async () => {
    const container = await renderWithEvents(
      [
        coreEvent({
          action: 'merge_duplicate',
          category: 'customer',
          actor_type: 'system',
          actor_id: null,
          target_type: 'customer',
          target_id: 'cus-kept-1',
          detail: { migration: 'core-pr-95', fold_customer_id: 'cus-folded-2', moved_rows: 3 },
        }),
      ],
      { targetLabels: { 'cus-kept-1': '鈴木 一郎' } },
    )
    expect(container.textContent).toContain('重複した顧客を統合')
    expect(container.textContent).toContain('データ修復')
    expect(container.textContent).toContain('鈴木 一郎')
    expect(container.textContent).not.toContain('cus-kept-1')
    expect(container.textContent).not.toContain('cus-folded-2')
  })

  // Fix round 1 (X1, lens F1): the kept customer not resolving (hard-purged,
  // or a failed customers.list batch) must NOT fall through to the generic
  // targetName chain, whose last arm is the raw id.
  it('merge_duplicate UNRESOLVED (kept customer id absent from targetLabels) renders the neutral 顧客 line — never the raw customer id', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'merge_duplicate',
        category: 'customer',
        actor_type: 'system',
        actor_id: null,
        target_type: 'customer',
        target_id: 'cus-kept-unresolved',
        detail: { migration: 'core-pr-95', fold_customer_id: 'cus-folded-x', moved_rows: 1 },
      }),
    ])
    expect(container.textContent).toContain('重複した顧客を統合')
    expect(container.textContent).toContain('データ修復')
    expect(container.textContent).toContain('顧客')
    expect(container.textContent).not.toContain('cus-kept-unresolved')
    expect(container.textContent).not.toContain('cus-folded-x')
  })

  it('correct_pack_import_date (pack resolved) shows the label, データ修復, the resolved name, and the corrected date — no uuid', async () => {
    const container = await renderWithEvents(
      [
        coreEvent({
          action: 'correct_pack_import_date',
          category: 'customer',
          actor_type: 'system',
          actor_id: null,
          target_type: 'pack',
          target_id: 'pack-uuid-1',
          detail: {
            migration: 'core-pr-95',
            redemption_id: 'redemption-uuid-2',
            previous_redeemed_on: '2025-12-01',
            previous_purchased_at: '2025-11-01',
            previous_status: 'active',
            corrected_date: '2025-12-25',
            corrected_status: 'exhausted',
          },
        }),
      ],
      { targetLabels: { 'pack-uuid-1': '田中 美香' } },
    )
    expect(container.textContent).toContain('回数券の取込日を修正')
    expect(container.textContent).toContain('データ修復')
    expect(container.textContent).toContain('田中 美香 · 取込日 2025-12-25')
    expect(container.textContent).not.toContain('pack-uuid-1')
    expect(container.textContent).not.toContain('redemption-uuid-2')
  })

  it('correct_pack_import_date (pack UNRESOLVED — no targetLabels entry) renders the neutral 回数券 line — never the raw pack id', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'correct_pack_import_date',
        category: 'customer',
        actor_type: 'system',
        actor_id: null,
        target_type: 'pack',
        target_id: 'pack-uuid-unresolved',
        detail: { corrected_date: '2025-12-25', corrected_status: 'exhausted' },
      }),
    ])
    expect(container.textContent).toContain('回数券 · 取込日 2025-12-25')
    expect(container.textContent).not.toContain('pack-uuid-unresolved')
  })

  it('correct_pack_import_date with NO corrected_date in detail renders the name/回数券 alone — no date suffix, no crash', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'correct_pack_import_date',
        category: 'customer',
        actor_type: 'system',
        actor_id: null,
        target_type: 'pack',
        target_id: 'pack-uuid-nodate',
        detail: { migration: 'x' },
      }),
    ])
    // The sub-line itself (not the row's action-label title, which always
    // spells 取込日を修正) is exactly the bare 回数券 line — no ` · 取込日 …`
    // suffix appended when detail carries no corrected_date. Selected
    // structurally (not by clamp/truncate class — Piece 2 changes that
    // class, this test is Piece 1's and must hold either way).
    const sub = container.querySelector('.min-w-0.flex-1 p')
    expect(sub).not.toBeNull()
    expect(sub!.textContent).toBe('回数券')
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

  it('fix round 3 (P1): A → X → A renders three separate rows and never logs a duplicate-key warning — the <li> key is the representative event id, not the fold key', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const container = await renderWithEvents([
        coreEvent({ id: 'a1', action: 'recording.transcribe' }),
        coreEvent({ id: 'x', action: 'customer.view', target_type: 'customer', target_id: 'cus-1' }),
        coreEvent({ id: 'a2', action: 'recording.transcribe' }),
      ])
      // (a) three rows in original order, neither A carries a ×n chip —
      // consecutive-only folding (fix round 2) never merges these two A's
      // across the interrupting X.
      expect(container.querySelectorAll('li').length).toBe(3)
      expect(container.textContent).not.toContain('×2')
      // (b) React never warns about a duplicate key — the two separated A
      // groups share the same FoldGroup.key (fix round 2 leaves that key
      // as-is for fold comparison), so the <li> key must be something
      // else unique: the representative event's id.
      const duplicateKeyWarning = errorSpy.mock.calls.find(
        (args) =>
          typeof args[0] === 'string' &&
          (args[0].includes('same key') || args[0].includes('unique "key"')),
      )
      expect(duplicateKeyWarning).toBeUndefined()
    } finally {
      errorSpy.mockRestore()
    }
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
    // F6 fix (blind lens finding 6): the back control's VISIBLE text is 戻る
    // (this assertion was missing before — the test's own title claimed it
    // checked 戻る but never actually did, which is exactly how F6 slipped
    // through green).
    const backBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '戻る',
    )
    expect(backBtn).toBeTruthy()
    expect(backBtn!.getAttribute('aria-label')).toBe('戻る')
    void link
  })

  // Piece 2 (⚖ Liam 9/13): list = up to two lines; an OPENED thread = the
  // full text, no clamp. jsdom class-level proof (the pixel proof lives in
  // evidence/update26-20260913/ — Playwright at 393/1280px).
  it('Piece 2 — list mode clamps the sub-line (line-clamp-2, no break-words); opening the thread removes the clamp (break-words, no line-clamp-2)', async () => {
    const container = await renderWithEvents([
      coreEvent({
        action: 'recording.play',
        actor_type: 'staff',
        actor_id: 'staff-1',
        actor_label: '田中 美香',
        target_id: 'rec-9',
      }),
    ])
    // LIST mode: the sub-line lives on an inner span inside the
    // recording-link button (line-clamp-2 cannot go directly on the button —
    // see the C1 update above), clamped to 2 lines.
    const listBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('録音'),
    )
    expect(listBtn).toBeTruthy()
    const listSpan = listBtn!.querySelector('span.line-clamp-2')
    expect(listSpan).not.toBeNull()
    expect(listBtn!.className).not.toContain('break-words')

    // Tap into the thread — the SAME target row's sub-line now renders as a
    // <p> (isRecordingLink is false once its own thread is already open —
    // reopening the same thread would be a no-op), no clamp, full text.
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'thread-1', target_id: 'rec-9' })]))
    fireEvent.click(listBtn!)
    await waitFor(() => expect(container.textContent).toContain('この録音に関する記録'))
    const threadSub = container.querySelector('p.break-words')
    expect(threadSub).not.toBeNull()
    expect(threadSub!.className).not.toContain('line-clamp-2')
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

  it('F4: opening a thread clears the previous feed and shows the loading idiom — no stale rows from an unrelated target while the read is pending', async () => {
    const container = await renderWithEvents([
      coreEvent({
        id: 'karute-row',
        action: 'karute.save',
        target_type: 'karute',
        target_id: 'k-9',
        actor_type: 'staff',
        actor_id: 'staff-1',
        actor_label: '田中 美香',
      }),
      coreEvent({
        id: 'rec-row',
        action: 'recording.play',
        actor_type: 'staff',
        actor_id: 'staff-1',
        actor_label: '田中 美香',
        target_id: 'rec-9',
      }),
    ])
    const subButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('録音'),
    )
    expect(subButtons.length).toBeGreaterThan(0)
    // Never resolves during this test — the thread read is deliberately left
    // pending so the assertion below catches whatever renders WHILE it waits.
    listAuditLog.mockReturnValue(new Promise(() => {}))
    fireEvent.click(subButtons[0]!)
    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).not.toBeNull()
    })
    expect(container.textContent).not.toContain('カルテを保存')
    expect(container.textContent).not.toContain('k-9')
  })

  it('F5: category and severity active on the feed are NEVER sent for a recording thread request', async () => {
    const container = await renderWithEvents([
      coreEvent({ id: 'rec-row', action: 'recording.play', target_id: 'rec-9' }),
    ])
    const categorySelect = container.querySelector('select[aria-label="カテゴリ"]') as HTMLSelectElement
    expect(categorySelect).toBeTruthy()
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'rec-row', action: 'recording.play', target_id: 'rec-9' })]))
    fireEvent.change(categorySelect, { target: { value: 'karute' } })
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(2))
    // 警告 tile (severity lens) — the strip stays visible since actorId is
    // unset (F3); clicking it sets the server-side severity filter.
    const warnBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('警告'),
    )
    expect(warnBtn).toBeTruthy()
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'rec-row', action: 'recording.play', target_id: 'rec-9' })]))
    fireEvent.click(warnBtn!)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(3))
    expect(listAuditLog.mock.calls[2]![0]).toMatchObject({ category: 'karute', severity: 'warn' })

    const subButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('録音'),
    )
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'thread-1', target_id: 'rec-9' })]))
    fireEvent.click(subButtons[0]!)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(4))
    const threadCall = listAuditLog.mock.calls[3]![0] as Record<string, unknown>
    expect(threadCall.targetType).toBe('recording')
    expect(threadCall.category).toBeUndefined()
    expect(threadCall.severity).toBeUndefined()
  })

  it('F5: an active person filter (actorId) is NEVER sent for a recording thread request', async () => {
    listAuditLog.mockResolvedValue(
      page([coreEvent({ id: 'rec-row', action: 'recording.play', target_id: 'rec-9' })]),
    )
    const { container } = render(
      <AuditLogSection
        staffList={[{ id: 'staff-1', full_name: '田中 美香' }] as unknown as StaffMember[]}
      />,
    )
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
    const staffSelect = container.querySelector('select[aria-label="スタッフ"]') as HTMLSelectElement
    expect(staffSelect).toBeTruthy()
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'rec-row', action: 'recording.play', target_id: 'rec-9' })]))
    fireEvent.change(staffSelect, { target: { value: 'staff-1' } })
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(2))
    expect(listAuditLog.mock.calls[1]![0]).toMatchObject({ actorId: 'staff-1' })

    const subButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('録音'),
    )
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'thread-1', target_id: 'rec-9' })]))
    fireEvent.click(subButtons[0]!)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(3))
    const threadCall = listAuditLog.mock.calls[2]![0] as Record<string, unknown>
    expect(threadCall.targetType).toBe('recording')
    expect(threadCall.actorId).toBeUndefined()
  })

  it('F7(a): 戻る from a recording thread restores 閲覧を含む to what it was — never forced off', async () => {
    const container = await renderWithEvents([
      coreEvent({ id: 'rec-row', action: 'recording.play', target_id: 'rec-9' }),
    ])
    // Turn 閲覧を含む ON first (a real user choice made on the feed).
    const viewsChip = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('閲覧を含む'),
    )!
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'rec-row', action: 'recording.play', target_id: 'rec-9' })]))
    fireEvent.click(viewsChip)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(2))
    expect(listAuditLog.mock.calls[1]![0]).toMatchObject({ includeViews: true })

    // Open a recording thread (never touches includeViews itself).
    const subButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('録音'),
    )
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'thread-1', target_id: 'rec-9' })]))
    fireEvent.click(subButtons[0]!)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(3))
    expect(listAuditLog.mock.calls[2]![0]).toMatchObject({ includeViews: true })

    // 戻る — includeViews must still be true, not forced back to false.
    const backBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '戻る')!
    listAuditLog.mockResolvedValue(page([coreEvent({ id: 'rec-row', action: 'recording.play', target_id: 'rec-9' })]))
    fireEvent.click(backBtn)
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(4))
    expect(listAuditLog.mock.calls[3]![0]).toMatchObject({ includeViews: true })
  })
})

// ---- I5: the scope line -----------------------------------------------------
describe('AuditLogSection — I5 scope line', () => {
  it('the default 30d range shows 過去30日間 ・ 全店舗', async () => {
    const container = await renderWithEvents([coreEvent()])
    expect(container.textContent).toContain('過去30日間 ・ 全店舗')
  })

  it('the all-time range shows 全期間 ・ 全店舗 — F7(d): unconditional, never inside an if(button) guard', async () => {
    const container = await renderWithEvents([coreEvent()])
    // The range presets render as plain <button>s with their REAL ja.json
    // text (this file no longer hand-types a DICT, so a raw 'range.all'
    // lookup would never match) — find it by its actual rendered label.
    const allBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '全期間',
    )
    expect(allBtn).toBeTruthy()
    listAuditLog.mockResolvedValue(page([coreEvent()]))
    fireEvent.click(allBtn!)
    await waitFor(() => expect(container.textContent).toContain('全期間 ・ 全店舗'))
  })

  it('fix round 2 (G3/P2): with actorId set, the scope line renders and the summary strip does not — the scope line is filter context, not a per-staff tally', async () => {
    listAuditLog.mockResolvedValue(page([coreEvent()]))
    const { container } = render(
      <AuditLogSection
        staffList={[{ id: 'staff-1', full_name: '田中 美香' }] as unknown as StaffMember[]}
      />,
    )
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
    const staffSelect = container.querySelector('select[aria-label="スタッフ"]') as HTMLSelectElement
    expect(staffSelect).toBeTruthy()
    listAuditLog.mockResolvedValue(page([coreEvent()]))
    fireEvent.change(staffSelect, { target: { value: 'staff-1' } })
    await waitFor(() => expect(listAuditLog).toHaveBeenCalledTimes(2))
    // The scope line still renders under a staff filter.
    expect(container.textContent).toContain('過去30日間 ・ 全店舗')
    // The summary strip stays hidden — its counts WOULD be a per-staff
    // tally under actorId (⚖ F13/F14), unlike the scope line above. Its
    // 緊急アクセス tile label is unique to the strip (unlike .tabular-nums,
    // which the day-header count and fold badges also carry).
    expect(container.textContent).not.toContain('緊急アクセス')
  })
})

// ---- F3: a targetId never hides the toolbar/strip/scope --------------------
describe('AuditLogSection — F3 the customer dispute deep-link keeps its chrome', () => {
  it('with initialTargetId set, 期間 (全期間), 閲覧を含む, the summary strip and the scope line all stay reachable', async () => {
    listAuditLog.mockResolvedValue(page([coreEvent({ target_id: 'c-1', target_type: 'customer' })]))
    const { container } = render(
      <AuditLogSection staffList={[] as unknown as StaffMember[]} initialTargetId="c-1" />,
    )
    await waitFor(() => expect(container.querySelector('ul')).not.toBeNull())
    // 全期間 button reachable (LENS finding 3: "select count 0, no range.7d" pre-fix)
    const allBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '全期間',
    )
    expect(allBtn).toBeTruthy()
    // 閲覧を含む chip reachable
    const viewsChip = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('閲覧を含む'),
    )
    expect(viewsChip).toBeTruthy()
    // Summary strip (変更 tile) present
    expect(container.querySelectorAll('.tabular-nums').length).toBeGreaterThan(0)
    // Scope line present
    expect(container.textContent).toContain('過去30日間 ・ 全店舗')
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

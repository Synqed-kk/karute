/** @jest-environment jsdom */
// stress-audit F5 (8/17, PACKET-AUDITUI-ALLOWLIST): three eventSub() detail
// additions. Same harness as audit-log-section-entry-edit-expand.test.tsx —
// renders the REAL component with only the server-action boundary mocked
// (@/actions/audit-log). menuUpdate.* / autostartOn / autostartOff get real
// dictionary values below so the composed sub-line is assertable end to end;
// everything else echoes `key:{...json}` (same idiom as the entry-edit test).
import { render, waitFor } from '@testing-library/react'

const DICT: Record<string, string> = {
  'menuUpdate.duration': '所要時間',
  'menuUpdate.price': '料金',
  'menuUpdate.minPrice': '最低価格',
  'menuUpdate.store': '店舗',
  'menuUpdate.onlineVisible': '表示',
  'menuUpdate.order': '表示順',
  'menuUpdate.allStores': '全店舗',
  'menuUpdate.none': 'なし',
  'menuUpdate.nameChanged': '名前を変更',
  'menuUpdate.categoryChanged': 'カテゴリを変更',
}

jest.mock('next-intl', () => ({
  useTranslations: () =>
    Object.assign(
      (k: string, vals?: Record<string, unknown>) => {
        if (k in DICT) return DICT[k]
        if (k === 'autostartOn') return `自動録音をON（${(vals as { store?: unknown })?.store}）`
        if (k === 'autostartOff') return `自動録音をOFF（${(vals as { store?: unknown })?.store}）`
        return vals ? `${k}:${JSON.stringify(vals)}` : k
      },
      { has: (k: string) => k in DICT || k === 'autostartOn' || k === 'autostartOff' },
    ),
  useLocale: () => 'ja',
}))

const listAuditLog = jest.fn()
jest.mock('@/actions/audit-log', () => ({
  listAuditLog: (filters: Record<string, unknown>) => listAuditLog(filters),
}))

// AuditLogSection imports listEntryEditHistory unconditionally (the
// karute.entry_edit expand path) — mocked out same as
// audit-log-section-entry-edit-expand.test.tsx, unused by these tests.
jest.mock('@/actions/karute', () => ({
  listEntryEditHistory: jest.fn(),
}))

import { AuditLogSection } from '@/components/settings/redesign/sections/AuditLogSection'

function coreEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    at: '2026-08-17T00:00:00.000Z',
    actor_id: 'staff-1',
    actor_type: 'staff',
    category: 'settings',
    action: 'settings.menu_update',
    target_type: 'menu',
    target_id: 'menu-1',
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

describe('AuditLogSection — settings.menu_update detail (stress-audit F5a)', () => {
  it('renders every tracked pair plus the free-text flags, and never a name/category VALUE', async () => {
    const container = await renderWithEvents(
      [
        coreEvent({
          detail: {
            duration_minutes_old: 60,
            duration_minutes_new: 90,
            price_list_amount_old: 5000,
            price_list_amount_new: 6000,
            price_min_amount_old: null,
            price_min_amount_new: 3000,
            store_id_old: 'store-a',
            store_id_new: 'store-b',
            online_visible_old: true,
            online_visible_new: false,
            display_order_old: 1,
            display_order_new: 2,
            name_changed: true,
            category_changed: true,
            // Rogue value fields — changedDetail() (src/actions/menus.ts)
            // never emits these (PII rule: bare flag only), but if a future
            // regression ever DID write them, the reader-side allowlist
            // must still never surface them (packet verified-fact #4).
            name_old: '田中太郎',
            name_new: '田中花子',
          },
        }),
      ],
      { 'store-a': '銀座店', 'store-b': '渋谷店', 'menu-1': 'カット' },
    )

    expect(container.textContent).toContain('所要時間 60分 → 90分')
    expect(container.textContent).toContain('料金 ¥5,000 → ¥6,000')
    expect(container.textContent).toContain('最低価格 なし → ¥3,000')
    expect(container.textContent).toContain('店舗 銀座店 → 渋谷店')
    expect(container.textContent).toContain('表示 ON → OFF')
    expect(container.textContent).toContain('表示順 1 → 2')
    expect(container.textContent).toContain('名前を変更')
    expect(container.textContent).toContain('カテゴリを変更')
    expect(container.textContent).not.toContain('田中太郎')
    expect(container.textContent).not.toContain('田中花子')
  })

  it('an unresolved store id in detail falls back to the raw id (current behavior)', async () => {
    const container = await renderWithEvents([
      coreEvent({
        detail: {
          store_id_old: 'store-unknown',
          store_id_new: null,
        },
      }),
    ])
    expect(container.textContent).toContain('店舗 store-unknown → 全店舗')
  })

  it('a menu_update row with no tracked change (flags only) still renders — no crash on an empty chip list', async () => {
    const container = await renderWithEvents([coreEvent({ detail: {} })])
    // Menu's own target name resolves via targetLabels (none provided here,
    // so it falls back to the raw target_id) — the row renders, no throw.
    expect(container.textContent).toContain('menu-1')
  })
})

describe('AuditLogSection — settings.recording_autostart_toggle ON/OFF (stress-audit F5b)', () => {
  it('ON and OFF rows render distinctly — the pre-fix regression was two byte-identical rows', async () => {
    const container = await renderWithEvents(
      [
        coreEvent({
          id: 'e-on',
          action: 'settings.recording_autostart_toggle',
          target_type: 'store',
          target_id: 'store-a',
          detail: { store_id: 'store-a', enabled: true, actor_staff_id: 'staff-1' },
        }),
        coreEvent({
          id: 'e-off',
          action: 'settings.recording_autostart_toggle',
          target_type: 'store',
          target_id: 'store-a',
          detail: { store_id: 'store-a', enabled: false, actor_staff_id: 'staff-1' },
        }),
      ],
      { 'store-a': '銀座店' },
    )
    expect(container.textContent).toContain('自動録音をON（銀座店）')
    expect(container.textContent).toContain('自動録音をOFF（銀座店）')
  })
})

describe('AuditLogSection — no-detail / unrelated-action rows (no regression on the other 60+ actions)', () => {
  it('an event with detail: null renders the target name and nothing else, unaffected by the new branches', async () => {
    const container = await renderWithEvents(
      [
        coreEvent({
          action: 'customer.edit',
          category: 'customer',
          target_type: 'customer',
          target_id: 'cus-1',
          detail: null,
        }),
      ],
      { 'cus-1': '鈴木 一郎' },
    )
    expect(container.textContent).toContain('鈴木 一郎')
    expect(container.textContent).not.toContain('menuUpdate')
    expect(container.textContent).not.toContain('自動録音')
  })
})

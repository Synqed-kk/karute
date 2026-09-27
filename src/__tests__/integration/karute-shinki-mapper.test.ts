/**
 * 新規 chip data path (KARUTE_SWITCHES.shinkiChip) — the app CONSUMES core's
 * per-row `company_first_visit` and derives nothing itself. Pins, hop by hop:
 *   core wire → KaruteListRow.company_first_visit (both normalizers)
 *   → buildSessionsListScreen (the ONE builder) → KaruteListItem.companyFirstVisit
 *   → the windowed facade DTO (phone parse)
 * with the mapping true → true · false → false · null → null · absent → null
 * (and junk → null). The release-17 BARE body must not carry the key at all
 * (byte parity — app-api-screens-sessions.test.ts pins the whole body).
 */
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))

import {
  listSynqedKaruteRowsOrThrow,
  listSynqedKaruteRowsWithTotalOrThrow,
  type KaruteListRow,
} from '@/lib/karute/synqed-records'
import { buildSessionsListScreen } from '@/lib/karute/screen-rows'
import { SessionsScreenDTO, SessionsScreenWindowedDTO } from '@/lib/app-api/sessions-screen-dto'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (list: (...a: unknown[]) => unknown) => ({ karuteRecords: { list } }) as any

/** One core record per wire case; `cfv: 'absent'` omits the key entirely. */
const CASES = [
  { id: 'k-true', cfv: true, expected: true },
  { id: 'k-false', cfv: false, expected: false },
  { id: 'k-null', cfv: null, expected: null },
  { id: 'k-absent', cfv: 'absent', expected: null },
  { id: 'k-junk', cfv: 'yes', expected: null },
] as const

function coreRecord(c: (typeof CASES)[number]) {
  return {
    id: c.id,
    business_id: 'biz',
    customer_id: 'cust-1',
    staff_id: 'staff-1',
    status: 'FINALIZED',
    ai_summary: 'まとめ',
    transcript: null,
    created_at: '2026-09-20T01:00:00Z',
    session_date: '2026-09-20',
    entry_count: 1,
    ...(c.cfv === 'absent' ? {} : { company_first_visit: c.cfv }),
  }
}

const CORE_RESPONSE = { karute_records: CASES.map(coreRecord), total: CASES.length }

function screenFrom(rows: KaruteListRow[]) {
  return buildSessionsListScreen({
    staffList: [{ id: 'staff-1', full_name: '佐藤 美咲' }],
    storeStaffIds: null,
    allCustomersList: {
      customers: [{ id: 'cust-1', name: '山田 花子', phone: null, furigana: null }],
      total: 1,
    } as unknown as Parameters<typeof buildSessionsListScreen>[0]['allCustomersList'],
    currentStaffId: null,
    synqedKaruteRows: rows,
    synqedStaff: { staff: [] } as unknown as Parameters<
      typeof buildSessionsListScreen
    >[0]['synqedStaff'],
    monthCount: 0,
    total: rows.length,
    viewerHoldsViewShared: false,
  })
}

const byId = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id)!

describe('core wire → KaruteListRow.company_first_visit', () => {
  it.each([
    ['listSynqedKaruteRowsWithTotalOrThrow', listSynqedKaruteRowsWithTotalOrThrow],
    ['listSynqedKaruteRowsOrThrow', listSynqedKaruteRowsOrThrow],
  ] as const)('%s: true/false/null/absent/junk → true/false/null/null/null', async (_n, fn) => {
    const out = await fn(asClient(async () => CORE_RESPONSE))
    const rows = Array.isArray(out) ? out : out.rows
    for (const c of CASES) {
      expect(byId(rows, c.id).company_first_visit).toBe(c.expected)
    }
  })
})

describe('buildSessionsListScreen → KaruteListItem.companyFirstVisit', () => {
  it('passes the flag through untouched — false stays false, absent is null', async () => {
    const { rows } = await listSynqedKaruteRowsWithTotalOrThrow(asClient(async () => CORE_RESPONSE))
    const screen = screenFrom(rows)
    for (const c of CASES) {
      const item = byId(screen.items, c.id)
      // The key is ALWAYS present on the item (the field is mapped even while
      // the chip is OFF) — with exactly core's boolean or null.
      expect(Object.prototype.hasOwnProperty.call(item, 'companyFirstVisit')).toBe(true)
      expect(item.companyFirstVisit).toBe(c.expected)
    }
  })

  it('a row the builder receives WITHOUT the key (a pre-field normalizer) maps to null', () => {
    const row: KaruteListRow = {
      id: 'legacy',
      session_date: '2026-09-20',
      created_at: '2026-09-20T01:00:00Z',
      summary: 'まとめ',
      transcript: null,
      staff_profile_id: 'staff-1',
      customer_id: 'biz',
      client_id: 'cust-1',
      entries: [{ count: 1 }],
      status: 'FINALIZED',
    }
    expect(screenFrom([row]).items[0].companyFirstVisit).toBeNull()
  })
})

describe('facade DTO twin', () => {
  const baseItem = {
    id: 'k',
    customerId: 'cust-1',
    customerName: '山田 花子',
    customerInitials: '山田',
    customerKaruteNumber: '#00001',
    date: '2026-09-20',
    weekday: '日',
    service: '—',
    duration: 0,
    staffId: null,
    staffColorKey: null,
    staffName: '—',
    summary: '',
    aiStatus: 'summarized',
    conversionStatus: 'active',
    href: '/karute/k',
  }
  const screenBody = (items: unknown[]) => ({
    items,
    placeholders: [],
    monthCount: 0,
    total: items.length,
    staffList: [],
    currentStaffId: null,
    customerOptions: [],
  })

  it('WINDOWED (phone): true/false/null/absent/junk → true/false/null/null/null', () => {
    const wire: Array<[unknown, boolean | null]> = [
      [true, true],
      [false, false],
      [null, null],
      ['absent', null],
      ['yes', null],
    ]
    const items = wire.map(([v], i) =>
      v === 'absent' ? { ...baseItem, id: `k${i}` } : { ...baseItem, id: `k${i}`, companyFirstVisit: v },
    )
    const dto = SessionsScreenWindowedDTO.parse(screenBody(items))
    wire.forEach(([, expected], i) => {
      expect(dto.items[i].companyFirstVisit).toBe(expected)
    })
  })

  it('BARE (release-17): the key is stripped — the legacy body never carries it', () => {
    const dto = SessionsScreenDTO.parse(screenBody([{ ...baseItem, companyFirstVisit: true }]))
    expect(JSON.stringify(dto)).not.toContain('companyFirstVisit')
  })
})

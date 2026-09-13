/**
 * buildSessionsListScreen — a discarded record's summary is WITHHELD, not
 * merely painted over (R3 repair, 2026-09-13, F3b). Before this fix
 * screen-rows.ts shipped the raw summary for every row regardless of
 * `status`, and KaruteListRow only painted 「破棄済み」 OVER it client-side —
 * so the real text still rode the network payload / React props to every
 * viewer, and KaruteRecordListView's search box (which matches on
 * `i.summary`) could reveal a discarded row's presence by a word that never
 * renders anywhere. screen-rows.ts is the ONE builder every door (web list,
 * thin SessionsScreen via the facade DTO, search) reads through, so blanking
 * it here closes all of them at once — this file pins that builder-level
 * contract; karute-chunk-load.test.tsx pins the search-consumer half.
 */
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))

import { buildSessionsListScreen } from '@/lib/karute/screen-rows'
import type { KaruteListRow } from '@/lib/karute/synqed-records'

const STAFF = [{ id: 'staff-1', full_name: '佐藤 美咲' }]
const CUSTOMER = { id: 'cust-1', name: '山田 花子', phone: null, furigana: null }

function baseArgs(rows: KaruteListRow[]) {
  return {
    staffList: STAFF,
    storeStaffIds: null,
    allCustomersList: { customers: [CUSTOMER], total: 1 } as unknown as Parameters<
      typeof buildSessionsListScreen
    >[0]['allCustomersList'],
    currentStaffId: null,
    synqedKaruteRows: rows,
    synqedStaff: { staff: [] } as unknown as Parameters<
      typeof buildSessionsListScreen
    >[0]['synqedStaff'],
    monthCount: 0,
    total: 0,
  }
}

const HIDDEN_WORD = 'ヒミツの内容タグ'

describe('buildSessionsListScreen — discarded row summary withholding (R3, F3b)', () => {
  it('a DISCARDED row\'s summary is blanked; an ordinary row\'s summary is untouched', () => {
    const rows: KaruteListRow[] = [
      {
        id: 'discarded-1',
        session_date: '2026-09-10',
        created_at: '2026-09-10T00:00:00.000Z',
        summary: HIDDEN_WORD,
        transcript: '発話内容',
        staff_profile_id: 'staff-1',
        customer_id: 'business-1',
        client_id: 'cust-1',
        entries: [{ count: 0 }],
        status: 'DISCARDED',
      },
      {
        id: 'active-1',
        session_date: '2026-09-11',
        created_at: '2026-09-11T00:00:00.000Z',
        summary: '通常のまとめ',
        transcript: '発話',
        staff_profile_id: 'staff-1',
        customer_id: 'business-1',
        client_id: 'cust-1',
        entries: [{ count: 1 }],
        status: 'FINALIZED',
      },
    ]
    const screen = buildSessionsListScreen(baseArgs(rows))

    const discarded = screen.items.find((i) => i.id === 'discarded-1')!
    expect(discarded.isDiscarded).toBe(true)
    expect(discarded.summary).toBe('')

    const active = screen.items.find((i) => i.id === 'active-1')!
    expect(active.isDiscarded).toBeUndefined()
    expect(active.summary).toBe('通常のまとめ')
  })

  it('order preserved: aiStatus still derives from the REAL (pre-blank) summary/transcript on a discarded row', () => {
    // If the blank ever moved ABOVE the aiStatus derivation, a discarded row
    // with a real summary would misread as 'draft' instead of 'summarized' —
    // this pins the order the packet's R3 instruction calls out explicitly.
    const rows: KaruteListRow[] = [
      {
        id: 'discarded-summarized',
        session_date: '2026-09-10',
        created_at: '2026-09-10T00:00:00.000Z',
        summary: HIDDEN_WORD,
        transcript: '発話内容',
        staff_profile_id: null,
        customer_id: 'business-1',
        client_id: 'cust-1',
        entries: [{ count: 0 }],
        status: 'DISCARDED',
      },
    ]
    const screen = buildSessionsListScreen(baseArgs(rows))
    const item = screen.items[0]
    expect(item.aiStatus).toBe('summarized')
    expect(item.summary).toBe('') // withheld regardless
  })
})

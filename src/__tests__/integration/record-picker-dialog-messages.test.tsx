/** @jest-environment jsdom */
/**
 * お客様を選んで録音 dialog v2 — rendered against the REAL ja.json.
 *
 * C-6 (seat 3): every other suite for this dialog key-echoes next-intl, so a
 * call site asking for a key that does not exist renders the key STRING and
 * every assertion still passes — seat 3's deliberate typo probe survived all
 * 4817 tests. This mock (lifted from record-no-own-booking-card.test.tsx)
 * THROWS on a missing key, so one render per branch pins every key the dialog
 * asks for, in both of its lists and in all of its empty states.
 *
 * C-3 (seat 1) rides along here because the honest search count only reads as
 * an assertion with real messages: the header must show how many customers
 * ACTUALLY match, not the 8 that fit on screen, and the overflow gets its own
 * quiet cue line.
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.'))
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_m, v: string) => String(vars?.[v] ?? `{${v}}`))
    },
  }
})

import {
  RecordCustomerPickerDialog,
  type RecordCustomerFact,
} from '@/components/karute/redesign/record/RecordCustomerPickerDialog'
import type { RecordTargetBooking } from '@/components/karute/redesign/record/RecordingTargetCard'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

const BOOKINGS: RecordTargetBooking[] = [
  {
    id: 'a-open',
    start: '10:30',
    end: '11:30',
    customer: '佐藤 美咲',
    customerId: 'c-2',
    initials: '佐藤',
    karute: '#00058',
    service: '新規コース',
    staff: '鈴木',
    staffId: 's-2',
    staffColorKey: null,
    statusKey: 'booked',
    statusLabel: '予約済',
  },
  {
    id: 'a-done',
    start: '15:30',
    end: '16:30',
    customer: '山本 結衣',
    customerId: 'c-3',
    initials: '山本',
    karute: '#00099',
    service: 'パーマ',
    staff: '原',
    staffId: 's-1',
    staffColorKey: null,
    statusKey: 'done',
    statusLabel: '完了',
  },
]

const CUSTOMERS: CustomerOption[] = [
  { id: 'c-1', name: '原 奏恵', furigana: null, phone: null },
  { id: 'c-2', name: '佐藤 美咲', furigana: null, phone: null },
  { id: 'c-4', name: '原田 真央', furigana: null, phone: null },
]

const FACTS: RecordCustomerFact[] = [
  // Every optional field populated — 前回+menu, 残n/m, 担当.
  {
    id: 'c-1',
    karuteNumber: '#00214',
    hasKarute: true,
    pack: { remaining: 5, size: 10 },
    lastVisitDate: '8月2日',
    lastVisitService: 'カット＋カラー',
    staffName: '原 奏恵',
  },
  // 新規 + no karute on file: the OTHER half of the copy.
  { id: 'c-2', karuteNumber: '#00058', isNew: true },
  // 前回 with no menu recorded.
  { id: 'c-4', karuteNumber: '#00301', hasKarute: true, lastVisitDate: '7月5日' },
]

function open(props: Partial<Parameters<typeof RecordCustomerPickerDialog>[0]> = {}) {
  return render(
    <RecordCustomerPickerDialog
      customers={CUSTOMERS}
      bookings={BOOKINGS}
      facts={FACTS}
      onSelectBooking={jest.fn()}
      onSelectCustomer={jest.fn()}
      onClose={jest.fn()}
      cancelLabel="キャンセル"
      {...props}
    />,
  )
}

describe('picker dialog v2 — real ja.json (C-6)', () => {
  it("today's-bookings list: every key on both row shapes", () => {
    open()

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'お客様を選んで録音')
    expect(screen.getByText('お客様を選んで録音')).toBeInTheDocument()
    expect(screen.getByLabelText('閉じる')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('名前・読み・電話・メールで検索...'),
    ).toBeInTheDocument()
    expect(screen.getByText('本日のご予約 (2件)')).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: '録音する予約を選択' })).toBeInTheDocument()

    // Tappable row: duration, 様, 担当, 新規, 残n/m.
    expect(screen.getByText('60分')).toBeInTheDocument()
    expect(screen.getAllByText('様').length).toBeGreaterThan(0)
    expect(screen.getByText('担当 鈴木')).toBeInTheDocument()
    expect(screen.getByText('新規')).toBeInTheDocument()
    // 記録済 row.
    expect(screen.getByText('記録済')).toBeInTheDocument()
  })

  it('search rows: every enrichment key, in both of its shapes', () => {
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '原' } })

    expect(screen.getByText('検索結果 (2件)')).toBeInTheDocument()
    expect(screen.getByLabelText('検索をクリア')).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: '検索結果' })).toBeInTheDocument()
    // 前回 with menu / without / none at all.
    expect(screen.getByText('前回: 8月2日（カット＋カラー）')).toBeInTheDocument()
    expect(screen.getByText('前回: 7月5日')).toBeInTheDocument()
    expect(screen.getByText('残5/10')).toBeInTheDocument()
    expect(screen.getByText('担当 原 奏恵')).toBeInTheDocument()

    // A customer with NO facts row falls to 前回: 来店なし + カルテ未作成.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '佐藤' } })
    expect(screen.getByText('カルテ未作成')).toBeInTheDocument()
    // …and, booked today, carries the 本日 HH:MM chip.
    expect(screen.getByText('本日 10:30')).toBeInTheDocument()
  })

  it('empty states: no bookings today, and a search that matches nobody', () => {
    open({ bookings: [] })
    expect(
      screen.getByText('本日の予約はありません。予約がなくても録音は開始できます。'),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ゾロ' } })
    expect(screen.getByText('検索結果 (0件)')).toBeInTheDocument()
    expect(screen.getByText('顧客が見つかりませんでした')).toBeInTheDocument()
  })

  it('前回: 来店なし renders for a customer with no facts at all', () => {
    open({ facts: [] })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '原' } })
    expect(screen.getAllByText('前回: 来店なし').length).toBe(2)
  })
})

// ── C-3: the header count is the TRUE match count ────────────────────────────
// filterCustomers caps at 8 rows. The header read that capped array, so a
// query matching 20 customers announced 「検索結果 (8件)」 — the staff scrolls
// to the bottom, sees 8 rows, and believes those are all the 原s in the salon.
const MANY: CustomerOption[] = Array.from({ length: 20 }, (_, i) => ({
  id: `m-${i}`,
  name: `原 ${i}`,
  furigana: null,
  phone: null,
}))

describe('picker dialog v2 — honest search count (C-3)', () => {
  it('20 matches: header says 20, 8 rows render, the overflow gets a cue', () => {
    open({ customers: MANY, facts: [] })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '原' } })

    expect(screen.getByText('検索結果 (20件)')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(8)
    expect(screen.getByText('他12件 — さらに入力して絞り込み')).toBeInTheDocument()
  })

  it('a result set that fits shows no cue', () => {
    open({ customers: MANY.slice(0, 8), facts: [] })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '原' } })

    expect(screen.getByText('検索結果 (8件)')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(8)
    expect(screen.queryByText(/さらに入力して絞り込み/)).not.toBeInTheDocument()
  })
})

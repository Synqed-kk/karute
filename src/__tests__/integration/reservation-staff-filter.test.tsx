/**
 * @jest-environment jsdom
 *
 * Render + layout contract for ReservationStaffFilter (予約 tab).
 *
 * ⚖ STAFF CONTROL LOCKED 04:5x (S44): the row is the Day/Week/Month toggle
 * (prependSlot) + ONE two-segment control 自分 | 全スタッフ ⌄ (StaffScopeSegment);
 * the separate 担当 chip is gone. A picked staffer replaces the 全スタッフ label
 * with their FAMILY NAME (Japanese names are family-name-first, whitespace-
 * separated). The chevron opens the shared StaffSelector list. The label says
 * the state, never 担当. The tap rule itself has its own suite
 * (staff-scope-segment.test.tsx).
 *
 * The fetch is the server's (`?staff=`), so this file also pins the two
 * client-side hand-offs the shared lens needs on 予約 (staff-scope.ts): a
 * departed staffer's link is REPLACED with no param (the list then reads
 * everyone, matching the 全スタッフ label), and with no param the remembered
 * pick is REPLACED in. Width step (the lead's pick, shown to Liam): ja = one
 * row at every width; en below 430px = the control on its own row under
 * 日/週/月. Uses the real ja.json strings.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'

let mockLocale = 'ja'
jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.'))
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      },
    useLocale: () => mockLocale,
  }
})

// ── next/navigation: capture pushes/replaces so we can assert URL mutations ──
const push = jest.fn()
const replace = jest.fn()
let mockSearch = ''
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/ja/reservations',
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

import { ReservationStaffFilter } from '@/components/karute/spike-lifted/reservation/ReservationStaffFilter'

const STAFF = [
  { id: 's1', name: '原田 かなみ', initials: '原' },
  { id: 's2', name: '浜野', initials: '浜' },
]
const chevron = () => screen.getByRole('button', { name: 'スタッフで絞り込み' })

describe('ReservationStaffFilter (予約 chrome)', () => {
  beforeEach(() => {
    push.mockClear()
    replace.mockClear()
    mockSearch = ''
    mockLocale = 'ja'
    window.localStorage.clear()
  })

  it('renders nothing with no staff and no self identity', () => {
    const { container } = render(
      <ReservationStaffFilter staffList={[]} selfStaffId={null} selected="all" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('all-selected: 自分 | 全スタッフ ⌄ — no 担当 chip, the word 担当 never shows', () => {
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="all" />)
    expect(screen.getByText('自分')).toBeInTheDocument()
    expect(screen.getByText('全スタッフ')).toBeInTheDocument()
    expect(screen.queryByText('担当')).toBeNull()
    // Roster names live in the (closed) list, not on the row.
    expect(screen.queryByText('原田 かなみ')).toBeNull()
  })

  it('staff selected: the label NAMES the staff (single token → as-is), once', () => {
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="s2" />)
    expect(screen.getAllByText('浜野')).toHaveLength(1)
    expect(screen.queryByText('全スタッフ')).toBeNull()
    expect(screen.queryByText('担当')).toBeNull()
  })

  it('staff selected: only the FAMILY NAME for a spaced name', () => {
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="s1" />)
    expect(screen.getByText('原田')).toBeInTheDocument()
    expect(screen.queryByText('原田 かなみ')).toBeNull()
  })

  it('a full-width space (　) also splits to the family name', () => {
    const fullWidth = [{ id: 'fw', name: 'コヴァリチュク　クリスティナ', initials: 'コ' }]
    render(<ReservationStaffFilter staffList={fullWidth} selfStaffId={null} selected="fw" />)
    expect(screen.getByText('コヴァリチュク')).toBeInTheDocument()
    expect(screen.queryByText('コヴァリチュク　クリスティナ')).toBeNull()
  })

  it('ja: 日/週/月 and the staff control share ONE row that never wraps', () => {
    const { container } = render(
      <ReservationStaffFilter
        staffList={STAFF}
        selfStaffId="s1"
        selected="all"
        prependSlot={<div data-testid="dwm">日週月</div>}
      />,
    )
    const row = container.querySelector('[data-staff-row]')!
    expect(row.getAttribute('data-staff-row')).toBe('ja')
    expect(row.contains(screen.getByTestId('dwm'))).toBe(true)
    expect(row.contains(row.querySelector('[data-staff-scope]'))).toBe(true)
    expect(row.className).toContain('flex-row')
    expect(row.className).toContain('flex-nowrap')
    expect(row.className).not.toContain('flex-wrap ')
  })

  it('en: below 430px the control sits on its own row under 日/週/月 (a defined width step)', () => {
    mockLocale = 'en'
    const { container } = render(
      <ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="all" prependSlot={<div />} />,
    )
    const row = container.querySelector('[data-staff-row]')!
    expect(row.getAttribute('data-staff-row')).toBe('en')
    expect(row.className).toContain('flex-col')
    expect(row.className).toContain('min-[430px]:flex-row')
  })

  it('the chevron opens the list; picking a staff pushes ?staff= and remembers it', () => {
    render(
      <ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="all" operatorId="u1" />,
    )
    fireEvent.click(chevron())
    const listbox = screen.getByRole('listbox')
    fireEvent.click(within(listbox).getByText('原田 かなみ'))
    expect(push).toHaveBeenCalledWith('/ja/reservations?staff=s1')
    expect(window.localStorage.getItem('karute:staffScope:appointments:u1')).toBe('s1')
  })

  it('picking 全スタッフ in the list clears the filter (drops ?staff=)', () => {
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="s2" />)
    fireEvent.click(chevron())
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '全スタッフ' }))
    expect(push).toHaveBeenCalledWith('/ja/reservations')
  })

  it('自分 pushes staff=self; from 自分 the 全スタッフ label is one tap back', () => {
    const { rerender } = render(
      <ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="all" />,
    )
    fireEvent.click(screen.getByText('自分'))
    expect(push).toHaveBeenLastCalledWith('/ja/reservations?staff=self')
    rerender(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="self" />)
    fireEvent.click(screen.getByText('全スタッフ'))
    expect(push).toHaveBeenLastCalledWith('/ja/reservations')
  })

  it('⚖ 退職スタッフのリンク = 全員を表示: an off-roster ?staff= reads 全スタッフ and the URL is replaced to match', () => {
    mockSearch = 'staff=gone-9&view=day'
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="gone-9" />)
    expect(screen.getByRole('button', { name: /全スタッフ/ })).toHaveAttribute('aria-pressed', 'true')
    expect(replace).toHaveBeenCalledWith('/ja/reservations?view=day')
    expect(push).not.toHaveBeenCalled()
  })

  it('no ?staff= on this visit: the remembered pick is replaced in (per viewer)', () => {
    window.localStorage.setItem('karute:staffScope:appointments:u1', 's2')
    render(
      <ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="all" operatorId="u1" />,
    )
    expect(replace).toHaveBeenCalledWith('/ja/reservations?staff=s2')
  })

  it('an explicit ?staff= wins — the remembered pick is not applied', () => {
    window.localStorage.setItem('karute:staffScope:appointments:u1', 's2')
    mockSearch = 'staff=self'
    render(
      <ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="self" operatorId="u1" />,
    )
    expect(replace).not.toHaveBeenCalled()
  })

  it('a remembered staffer who left reads as nothing to restore', () => {
    window.localStorage.setItem('karute:staffScope:appointments:u1', 'gone-9')
    render(
      <ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="all" operatorId="u1" />,
    )
    expect(replace).not.toHaveBeenCalled()
  })

  // P-G (census surface 予約): isManagement threads from ReservationStaffEntry
  // through to the shared StaffSelector's search-reveal (⚖ 2026-09-01).
  describe('経営メンバー search-reveal (P-A/P-B)', () => {
    const MGMT_STAFF = [
      { id: 's1', name: '原田 かなみ', initials: '原' },
      { id: 's2', name: '浜野', initials: '浜', isManagement: true },
    ]

    it('P-A: default list hides the flagged member', () => {
      render(<ReservationStaffFilter staffList={MGMT_STAFF} selfStaffId="s3" selected="all" />)
      fireEvent.click(chevron())
      const listbox = screen.getByRole('listbox')
      expect(within(listbox).getByText('原田 かなみ')).toBeInTheDocument()
      expect(within(listbox).queryByText('浜野')).toBeNull()
    })

    it('P-B: typing reveals the flagged member with the 経営 chip', () => {
      render(<ReservationStaffFilter staffList={MGMT_STAFF} selfStaffId="s3" selected="all" />)
      fireEvent.click(chevron())
      fireEvent.change(screen.getByPlaceholderText('スタッフを検索…'), { target: { value: '浜' } })
      const listbox = screen.getByRole('listbox')
      expect(within(listbox).getByText('浜野')).toBeInTheDocument()
      expect(within(listbox).getByText('経営')).toBeInTheDocument()
    })
  })
})

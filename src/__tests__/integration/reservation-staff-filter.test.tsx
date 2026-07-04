/**
 * @jest-environment jsdom
 *
 * Render + layout contract for ReservationStaffFilter (予約 tab), covering the
 * 2026-07-04 fix: the 担当 chip names the current selection INLINE and stays
 * grouped with the 自分/全スタッフ segment — there is no separate selected-staff
 * pill on its own row. The prependSlot (Day/Week/Month toggle) is a SIBLING of
 * that filter group (own line on mobile), never inside it. Tapping the chip
 * opens the shared dropdown; picking 全スタッフ returns the chip to the plain
 * 担当 label. Uses the real ja.json strings so the assertions track the UI.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'

// ── next-intl: resolve real ja.json keys (same shape as staff-selector.test) ──
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
  }
})

// ── next/navigation: capture pushes so we can assert URL mutations ──
const push = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/ja/reservations',
  useSearchParams: () => new URLSearchParams(''),
}))

import { ReservationStaffFilter } from '@/components/karute/spike-lifted/reservation/ReservationStaffFilter'

const STAFF = [
  { id: 's1', name: '原田 かなみ', initials: '原' },
  { id: 's2', name: '浜野', initials: '浜' },
]

describe('ReservationStaffFilter (予約 chrome)', () => {
  beforeEach(() => push.mockClear())

  it('renders nothing with no staff and no self identity', () => {
    const { container } = render(
      <ReservationStaffFilter staffList={[]} selfStaffId={null} selected="all" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('all-selected: 自分/全スタッフ segment + plain 担当 chip, no inline pill', () => {
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="all" />)
    expect(screen.getByText('自分')).toBeInTheDocument()
    expect(screen.getByText('全スタッフ')).toBeInTheDocument()
    expect(screen.getByText('担当')).toBeInTheDocument()
    // Roster names live in the (closed) dropdown, not on the row.
    expect(screen.queryByText('原田 かなみ')).toBeNull()
  })

  it('staff selected: the chip NAMES the staff inline (no orphan pill row)', () => {
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="s2" />)
    // The selection shows in the chip itself…
    expect(screen.getByText('浜野')).toBeInTheDocument()
    // …and the generic 担当 label is gone (chip took the name).
    expect(screen.queryByText('担当')).toBeNull()
    // Exactly ONE element bears the name while the menu is closed — there is
    // no second, separate selected-staff pill rendered below the chips.
    expect(screen.getAllByText('浜野')).toHaveLength(1)
  })

  it('the Day/Week/Month prependSlot is a SIBLING of the filter group, not inside it', () => {
    render(
      <ReservationStaffFilter
        staffList={STAFF}
        selfStaffId="s1"
        selected="all"
        prependSlot={<div data-testid="dwm">日週月</div>}
      />,
    )
    const dwm = screen.getByTestId('dwm')
    // The scope segment's group must NOT contain the DWM toggle — they live on
    // separate rows (mobile) so the segment + 担当 chip fit one line at 393px.
    const segmentGroup = screen.getByText('全スタッフ').closest('div')?.parentElement
    expect(segmentGroup).not.toBeNull()
    expect(segmentGroup!.contains(dwm)).toBe(false)
  })

  it('tapping the chip opens the dropdown; picking a staff pushes ?staff=', () => {
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="all" />)
    fireEvent.click(screen.getByText('担当'))
    const listbox = screen.getByRole('listbox')
    fireEvent.click(within(listbox).getByText('原田 かなみ'))
    expect(push).toHaveBeenCalledWith('/ja/reservations?staff=s1')
  })

  it('picking 全スタッフ in the dropdown clears the filter (drops ?staff=)', () => {
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="s2" />)
    // open the menu from the (name-bearing) chip
    fireEvent.click(screen.getByText('浜野'))
    const listbox = screen.getByRole('listbox')
    fireEvent.click(within(listbox).getByText('全スタッフ'))
    // 'all' deletes the param → path only, chip returns to 担当 on next render
    expect(push).toHaveBeenCalledWith('/ja/reservations')
  })

  it('the 自分/全スタッフ quick toggles still push their own scope', () => {
    render(<ReservationStaffFilter staffList={STAFF} selfStaffId="s1" selected="all" />)
    fireEvent.click(screen.getByText('自分'))
    expect(push).toHaveBeenCalledWith('/ja/reservations?staff=self')
  })
})

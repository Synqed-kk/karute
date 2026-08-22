/**
 * @jest-environment jsdom
 *
 * Render coverage for CustomersStaffFilter (PR 17, replay/17): the empty-state
 * null render, the self/all scope toggle (self hidden without a staff profile),
 * the per-staff pills, active state, and the "click active pill snaps back to
 * all" selection model.
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import {
  CustomersStaffFilter,
  type StaffFilterEntry,
} from '@/components/customers/redesign/list/CustomersStaffFilter'

const staff: StaffFilterEntry[] = [
  { id: 's-1', name: 'Jon Chan', initials: 'JC' },
  { id: 's-2', name: '佐藤', initials: '佐' },
]

describe('CustomersStaffFilter', () => {
  it('renders nothing when there are no staff and no self profile', () => {
    const { container } = render(
      <CustomersStaffFilter staffList={[]} selfStaffId={null} selected="all" onChange={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the toggle + 担当 trigger; staff names live in the SHEET (option D)', () => {
    render(
      <CustomersStaffFilter
        staffList={staff}
        selfStaffId="s-1"
        selected="all"
        onChange={jest.fn()}
      />,
    )
    expect(screen.getByText('self')).toBeInTheDocument()
    expect(screen.getByText('all')).toBeInTheDocument()
    // no inline pills anymore — one chrome line
    expect(screen.queryByText('Jon Chan')).toBeNull()
    expect(screen.getByText('trigger')).toBeInTheDocument()
    fireEvent.click(screen.getByText('trigger'))
    expect(screen.getByText('Jon Chan')).toBeInTheDocument()
    expect(screen.getByText('佐藤')).toBeInTheDocument()
  })

  it('hides the self segment when the viewer has no staff profile', () => {
    render(
      <CustomersStaffFilter
        staffList={staff}
        selfStaffId={null}
        selected="all"
        onChange={jest.fn()}
      />,
    )
    expect(screen.queryByText('self')).not.toBeInTheDocument()
    expect(screen.getByText('all')).toBeInTheDocument()
  })

  it('still renders the scope toggle (self only) when there is a self but no staff list', () => {
    render(
      <CustomersStaffFilter
        staffList={[]}
        selfStaffId="s-1"
        selected="self"
        onChange={jest.fn()}
      />,
    )
    expect(screen.getByText('self')).toBeInTheDocument()
    expect(screen.getByText('all')).toBeInTheDocument()
    // No staff pills.
    expect(screen.queryByText('Jon Chan')).not.toBeInTheDocument()
  })

  it('marks the selected scope segment with aria-pressed', () => {
    render(
      <CustomersStaffFilter
        staffList={staff}
        selfStaffId="s-1"
        selected="self"
        onChange={jest.fn()}
      />,
    )
    expect(screen.getByText('self').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('all').closest('button')).toHaveAttribute('aria-pressed', 'false')
  })

  it('emits "self" / "all" when the scope segments are clicked', () => {
    const onChange = jest.fn()
    render(
      <CustomersStaffFilter
        staffList={staff}
        selfStaffId="s-1"
        selected="all"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText('self'))
    expect(onChange).toHaveBeenLastCalledWith('self')
    fireEvent.click(screen.getByText('all'))
    expect(onChange).toHaveBeenLastCalledWith('all')
  })

  it('emits the staff id when picked from the sheet', () => {
    const onChange = jest.fn()
    render(
      <CustomersStaffFilter
        staffList={staff}
        selfStaffId="s-1"
        selected="all"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText('trigger'))
    fireEvent.click(screen.getByText('Jon Chan'))
    expect(onChange).toHaveBeenCalledWith('s-1')
  })

  it('snaps back to "all" when the already-active staff is picked in the sheet', () => {
    const onChange = jest.fn()
    render(
      <CustomersStaffFilter
        staffList={staff}
        selfStaffId="s-1"
        selected="s-1"
        onChange={onChange}
      />,
    )
    // trigger names the active staff inline; the sheet row is the last match
    fireEvent.click(screen.getAllByText('Jon Chan')[0])
    fireEvent.click(screen.getAllByText('Jon Chan').at(-1)!)
    expect(onChange).toHaveBeenCalledWith('all')
  })

  it('the trigger NAMES the active staff inline (selected always visible)', () => {
    render(
      <CustomersStaffFilter
        staffList={staff}
        selfStaffId="s-1"
        selected="s-2"
        onChange={jest.fn()}
      />,
    )
    expect(screen.getByText('佐藤')).toBeInTheDocument()
    expect(screen.queryByText('Jon Chan')).toBeNull()
  })

  // P-G (census surfaces 顧客 / カルテ — KaruteRecordListView renders this
  // same component verbatim, no per-surface transform): isManagement carried
  // on StaffFilterEntry reaches the shared StaffSelector's search-reveal
  // (⚖ 2026-09-01 overturn of ruling Ⓒ).
  describe('経営メンバー search-reveal (P-A/P-B/P-E)', () => {
    const mgmtStaff: StaffFilterEntry[] = [
      { id: 's-1', name: 'Jon Chan', initials: 'JC' },
      { id: 's-2', name: '佐藤', initials: '佐', isManagement: true },
    ]

    it('P-A: default sheet list hides the flagged member', () => {
      render(
        <CustomersStaffFilter
          staffList={mgmtStaff}
          selfStaffId="s-3"
          selected="all"
          onChange={jest.fn()}
        />,
      )
      fireEvent.click(screen.getByText('trigger'))
      expect(screen.getByText('Jon Chan')).toBeInTheDocument()
      expect(screen.queryByText('佐藤')).toBeNull()
    })

    it('P-B: typing reveals the flagged member with the management badge', () => {
      render(
        <CustomersStaffFilter
          staffList={mgmtStaff}
          selfStaffId="s-3"
          selected="all"
          onChange={jest.fn()}
        />,
      )
      fireEvent.click(screen.getByText('trigger'))
      fireEvent.change(screen.getByPlaceholderText('searchPlaceholder'), {
        target: { value: '佐' },
      })
      expect(screen.getByText('佐藤')).toBeInTheDocument()
      expect(screen.getByText('managementBadge')).toBeInTheDocument()
    })

    it('P-E: a flagged VIEWER is hidden from the default list too (no self-exception — the 自分 segment covers it), and the 自分 toggle is unaffected', () => {
      const onChange = jest.fn()
      render(
        <CustomersStaffFilter
          staffList={mgmtStaff}
          selfStaffId="s-2"
          selected="all"
          onChange={onChange}
        />,
      )
      // 自分 still renders and still works — the flag never touches it.
      expect(screen.getByText('self')).toBeInTheDocument()
      fireEvent.click(screen.getByText('self'))
      expect(onChange).toHaveBeenLastCalledWith('self')
      // But the viewer's OWN name is absent from the default staff-picker list.
      fireEvent.click(screen.getByText('trigger'))
      expect(screen.getByText('Jon Chan')).toBeInTheDocument()
      expect(screen.queryByText('佐藤')).toBeNull()
    })
  })
})

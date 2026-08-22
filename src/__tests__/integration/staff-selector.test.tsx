/**
 * @jest-environment jsdom
 *
 * 担当トリガー (option D) render contract — real ja.json strings.
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_, v: string) => String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`))
    },
  }
})

import { StaffSelector } from '@/components/staff/StaffSelector'

const STAFF = [
  { id: 's1', name: '原田 かなみ', initials: '原' },
  { id: 's2', name: '浜野', initials: '浜' },
]

describe('StaffSelector (担当トリガー)', () => {
  it('all-selected: generic 担当 trigger', () => {
    render(<StaffSelector staffList={STAFF} selected="all" onChange={() => {}} />)
    expect(screen.getByText('担当')).toBeInTheDocument()
  })
  it('staff selected: trigger reads 担当: 名前 (the approved mock format)', () => {
    render(<StaffSelector staffList={STAFF} selected="s2" onChange={() => {}} />)
    expect(screen.getByText('浜野')).toBeInTheDocument()
    // avatar + name only — no 担当: prefix in the selected state (Liam)
    expect(screen.queryByText('担当:')).toBeNull()
  })
  it('opens the sheet and picking a staff fires onChange + closes', () => {
    const calls: string[] = []
    render(<StaffSelector staffList={STAFF} selected="all" onChange={(n) => calls.push(n)} />)
    fireEvent.click(screen.getByText('担当'))
    expect(screen.getByText('スタッフで絞り込み')).toBeInTheDocument()
    fireEvent.click(screen.getByText('原田 かなみ'))
    expect(calls).toEqual(['s1'])
  })
  it('picking the already-active staff snaps back to all', () => {
    const calls: string[] = []
    render(<StaffSelector staffList={STAFF} selected="s1" onChange={(n) => calls.push(n)} />)
    fireEvent.click(screen.getByRole('button', { name: /原田/ }))
    fireEvent.click(screen.getAllByText('原田 かなみ').at(-1)!)
    expect(calls).toEqual(['all'])
  })
  it('renders as an anchored dropdown (listbox) and closes on outside tap', () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <StaffSelector staffList={STAFF} selected="all" onChange={() => {}} />
      </div>,
    )
    fireEvent.click(screen.getByText('担当'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
  it('全スタッフ row selects all', () => {
    const calls: string[] = []
    render(<StaffSelector staffList={STAFF} selected="s1" onChange={(n) => calls.push(n)} />)
    fireEvent.click(screen.getByRole('button', { name: /原田/ }))
    fireEvent.click(screen.getByText('全スタッフ'))
    expect(calls).toEqual(['all'])
  })
})

// ── search-reveal (⚖ 2026-09-01 build, overturns the 8/18 ruling Ⓒ) ──
const MGMT_STAFF = [
  { id: 's1', name: '原田 かなみ', initials: '原' },
  { id: 's2', name: '浜野', initials: '浜', isManagement: true },
]

describe('StaffSelector — 経営メンバー search-reveal', () => {
  it('P-A: default (no-query) list hides a flagged member', () => {
    render(<StaffSelector staffList={MGMT_STAFF} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    expect(screen.getByText('原田 かなみ')).toBeInTheDocument()
    expect(screen.queryByText('浜野')).toBeNull()
  })

  it('has a search input under the header, placeholder = real ja.json copy', () => {
    render(<StaffSelector staffList={MGMT_STAFF} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    expect(screen.getByPlaceholderText('スタッフを検索…')).toBeInTheDocument()
  })

  it('P-B: typing reveals the flagged member, carrying the 経営 chip; 全スタッフ drops out of the search result', () => {
    render(<StaffSelector staffList={MGMT_STAFF} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    fireEvent.change(screen.getByPlaceholderText('スタッフを検索…'), { target: { value: '浜' } })
    expect(screen.getByText('浜野')).toBeInTheDocument()
    expect(screen.getByText('経営')).toBeInTheDocument()
    expect(screen.queryByText('全スタッフ')).toBeNull()
  })

  it('clearing the query returns the default list', () => {
    render(<StaffSelector staffList={MGMT_STAFF} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    const input = screen.getByPlaceholderText('スタッフを検索…')
    fireEvent.change(input, { target: { value: '浜' } })
    expect(screen.getByText('浜野')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.queryByText('浜野')).toBeNull()
    expect(screen.getByText('全スタッフ')).toBeInTheDocument()
  })

  it('P-D: a currently-selected flagged member still names the trigger (resolves from the FULL array, never the filtered default list)', () => {
    render(<StaffSelector staffList={MGMT_STAFF} selected="s2" onChange={() => {}} />)
    expect(screen.getByText('浜野')).toBeInTheDocument()
    expect(screen.queryByText('担当')).toBeNull()
  })

  it('P-C: search-selecting a flagged member returns their real id, and the connection survives a close/reopen — hidden from the list is not gone from the data', () => {
    const calls: string[] = []
    const { rerender } = render(
      <StaffSelector staffList={MGMT_STAFF} selected="all" onChange={(n) => calls.push(n)} />,
    )
    fireEvent.click(screen.getByText('担当'))
    fireEvent.change(screen.getByPlaceholderText('スタッフを検索…'), { target: { value: '浜野' } })
    fireEvent.click(screen.getByText('浜野'))
    expect(calls).toEqual(['s2'])
    // Parent re-renders with the pick applied against the SAME (never
    // pre-filtered) staffList array — the trigger still resolves them.
    rerender(
      <StaffSelector staffList={MGMT_STAFF} selected="s2" onChange={(n) => calls.push(n)} />,
    )
    expect(screen.getByText('浜野')).toBeInTheDocument()
    // Reopening (query resets on close) shows the default list — the flagged
    // selection is named on the trigger but still absent from the ROWS.
    fireEvent.click(screen.getByText('浜野'))
    expect(screen.getByText('原田 かなみ')).toBeInTheDocument()
    expect(screen.queryAllByText('浜野')).toHaveLength(1)
  })

  it('P-F: fails open — a row with the flag entirely absent stays in the default list', () => {
    const noFlag = [{ id: 's3', name: '江間', initials: '江' }]
    render(<StaffSelector staffList={noFlag} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    expect(screen.getByText('江間')).toBeInTheDocument()
  })
})

/**
 * @jest-environment jsdom
 *
 * 自分 | 全スタッフ ⌄ — the ONE staff control on 予約 and 顧客
 * (⚖ STAFF CONTROL LOCKED 04:5x) and its ⚖ TAP RULE (Liam 04:0x):
 *   - 自分: tap = self; a second tap on 自分 does nothing
 *   - segment 2's label, from 自分 = 全スタッフ (one tap)
 *   - segment 2's label while it is ALREADY active (全スタッフ / a name) = opens the list
 *   - the chevron always opens the list
 * Real ja.json strings.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { useState } from 'react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur
    },
  }
})

import { StaffScopeSegment } from '@/components/staff/StaffScopeSegment'

const STAFF = [
  { id: 's1', name: '原田 かなみ', initials: '原' },
  { id: 's2', name: '勅使河原', initials: '勅使' },
]

function Harness({ initial, self = 'me' as string | null, onChange = () => {} }: {
  initial: string
  self?: string | null
  onChange?: (n: string) => void
}) {
  const [v, setV] = useState(initial)
  return (
    <StaffScopeSegment
      staffList={STAFF}
      selfStaffId={self}
      selected={v}
      onChange={(n) => {
        onChange(n)
        setV(n)
      }}
    />
  )
}

const selfBtn = () => screen.getByRole('button', { name: '自分' })
const labelBtn = () => screen.getByRole('button', { pressed: true, name: /全スタッフ|原田|勅使河原/ })
const chevron = () => screen.getByRole('button', { name: 'スタッフで絞り込み' })

describe('StaffScopeSegment — render states', () => {
  it('all: 全スタッフ pressed, 自分 not, the word 担当 never shows', () => {
    render(<Harness initial="all" />)
    expect(screen.getByRole('button', { name: '全スタッフ' })).toHaveAttribute('aria-pressed', 'true')
    expect(selfBtn()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('担当')).toBeNull()
  })
  it('self: 自分 pressed, segment 2 reads 全スタッフ unpressed', () => {
    render(<Harness initial="self" />)
    expect(selfBtn()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '全スタッフ' })).toHaveAttribute('aria-pressed', 'false')
  })
  it('a picked name replaces the label — family name, pressed (自分 | 原田 ⌄)', () => {
    render(<Harness initial="s1" />)
    const label = screen.getByRole('button', { name: /原田/ })
    expect(label).toHaveAttribute('aria-pressed', 'true')
    expect(within(label).getByText('原田')).toBeInTheDocument()
    expect(within(label).queryByText('原田 かなみ')).toBeNull()
    expect(screen.queryByText('全スタッフ')).toBeNull()
  })
  it('a single-token 4-character name shows whole (勅使河原)', () => {
    render(<Harness initial="s2" />)
    expect(within(screen.getByRole('button', { name: /勅使河原/ })).getByText('勅使河原')).toBeInTheDocument()
  })
  it('no staff profile: no 自分 segment', () => {
    render(<Harness initial="all" self={null} />)
    expect(screen.queryByRole('button', { name: '自分' })).toBeNull()
    expect(screen.getByRole('button', { name: '全スタッフ' })).toBeInTheDocument()
  })
})

describe('StaffScopeSegment — ⚖ TAP RULE', () => {
  it('tap 1 — 自分 from 全スタッフ = self; a second tap on 自分 does nothing', () => {
    const calls: string[] = []
    render(<Harness initial="all" onChange={(n) => calls.push(n)} />)
    fireEvent.click(selfBtn())
    expect(calls).toEqual(['self'])
    fireEvent.click(selfBtn())
    expect(calls).toEqual(['self'])
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('tap 2 — segment 2 label from 自分 = 全スタッフ in one tap, no list', () => {
    const calls: string[] = []
    render(<Harness initial="self" onChange={(n) => calls.push(n)} />)
    fireEvent.click(screen.getByRole('button', { name: '全スタッフ' }))
    expect(calls).toEqual(['all'])
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('tap 3 — segment 2 label while already 全スタッフ opens the list (no change)', () => {
    const calls: string[] = []
    render(<Harness initial="all" onChange={(n) => calls.push(n)} />)
    fireEvent.click(labelBtn())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('tap 3b — segment 2 label while a name is picked opens the list (no change)', () => {
    const calls: string[] = []
    render(<Harness initial="s1" onChange={(n) => calls.push(n)} />)
    fireEvent.click(labelBtn())
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('tap 4 — the chevron opens the list from every state', () => {
    for (const initial of ['all', 'self', 's1']) {
      const { unmount } = render(<Harness initial={initial} />)
      fireEvent.click(chevron())
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(chevron()).toHaveAttribute('aria-expanded', 'true')
      unmount()
    }
  })
})

describe('StaffScopeSegment — the list is StaffSelector’s own panel', () => {
  it('rows: 自分 → 全スタッフ → names, with the panel search', () => {
    render(<Harness initial="all" />)
    fireEvent.click(chevron())
    const listbox = screen.getByRole('listbox')
    const options = within(listbox).getAllByRole('option')
    expect(options).toHaveLength(4)
    ;['自分', '全スタッフ', '原田 かなみ', '勅使河原'].forEach((name, i) =>
      expect(options[i]).toHaveAccessibleName(name),
    )
    expect(screen.getByPlaceholderText('スタッフを検索…')).toBeInTheDocument()
  })

  it('picking a name from the list = that id; the label shows it; the list closes', () => {
    const calls: string[] = []
    render(<Harness initial="all" onChange={(n) => calls.push(n)} />)
    fireEvent.click(chevron())
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '原田 かなみ' }))
    expect(calls).toEqual(['s1'])
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('button', { name: /原田/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('picking 自分 from the list = self', () => {
    const calls: string[] = []
    render(<Harness initial="all" onChange={(n) => calls.push(n)} />)
    fireEvent.click(chevron())
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: '自分' }))
    expect(calls).toEqual(['self'])
  })

  it('tapping 自分 while the list is open closes it', () => {
    render(<Harness initial="all" />)
    fireEvent.click(chevron())
    fireEvent.click(selfBtn())
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('nothing to pick and nobody to be: renders nothing', () => {
    const { container } = render(
      <StaffScopeSegment staffList={[]} selfStaffId={null} selected="all" onChange={() => {}} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('no roster but a self: 自分 | 全スタッフ without a chevron', () => {
    render(<StaffScopeSegment staffList={[]} selfStaffId="me" selected="all" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: '自分' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'スタッフで絞り込み' })).toBeNull()
  })
})

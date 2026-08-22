/**
 * @jest-environment jsdom
 *
 * 担当トリガー (option D) render contract — real ja.json strings.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'

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

  it('P-C: search-selecting a flagged member returns their real id, and the connection survives a close/reopen — reopened, they still show selected (F7)', () => {
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
    // selection now stays IN the ROWS too (F7's selected-leg exception), not
    // just named on the trigger: one 浜野 on the chip, one in the listbox.
    fireEvent.click(screen.getByText('浜野'))
    expect(screen.getByText('原田 かなみ')).toBeInTheDocument()
    expect(screen.queryAllByText('浜野')).toHaveLength(2)
  })

  it('P-F: fails open — a row with the flag entirely absent stays in the default list', () => {
    const noFlag = [{ id: 's3', name: '江間', initials: '江' }]
    render(<StaffSelector staffList={noFlag} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    expect(screen.getByText('江間')).toBeInTheDocument()
  })

  // F7 (fix round 1, 2026-09-01): a selected flagged member must still show
  // (checked, with its 経営 chip) in the reopened DEFAULT list — not just on
  // the trigger chip (P-D already pins that half). Before the fix, the
  // default predicate had no selected-leg exception, so the panel looked
  // like nothing was selected even while the trigger correctly named them.
  it('F7: a selected flagged member still shows, checked, in the open DEFAULT list', () => {
    render(<StaffSelector staffList={MGMT_STAFF} selected="s2" onChange={() => {}} />)
    fireEvent.click(screen.getByText('浜野'))
    const listbox = screen.getByRole('listbox')
    const row = within(listbox).getByText('浜野').closest('button')!
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(within(listbox).getByText('経営')).toBeInTheDocument()
  })

  // F5 (fix round 1, 2026-09-01): a zero-hit search renders the same
  // common.noResults row as StaffCombobox, instead of a blank listbox under
  // the header.
  it('F5: a no-hit search renders the common.noResults row', () => {
    render(<StaffSelector staffList={MGMT_STAFF} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    fireEvent.change(screen.getByPlaceholderText('スタッフを検索…'), {
      target: { value: 'ゼロヒット' },
    })
    expect(screen.getByText('結果が見つかりません')).toBeInTheDocument()
  })

  // F3 (fix round 1, 2026-09-01): Escape delivered mid-IME-conversion must
  // not close the panel — same guard as MenuCombobox.tsx:139. Before the
  // fix, the document-level Escape handler closed the panel unconditionally,
  // nuking the dropdown and the half-typed query out from under a staff
  // correcting a mis-conversion.
  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }],
  ])('F3: Escape mid-IME-conversion (%s) does not close the panel', (_label, ime) => {
    render(<StaffSelector staffList={MGMT_STAFF} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    const input = screen.getByPlaceholderText('スタッフを検索…')
    fireEvent.change(input, { target: { value: '浜' } })
    fireEvent.keyDown(input, { key: 'Escape', ...ime })
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(input).toHaveValue('浜')
  })

  it('a plain (non-IME) Escape still closes the panel', () => {
    render(<StaffSelector staffList={MGMT_STAFF} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    const input = screen.getByPlaceholderText('スタッフを検索…')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  // F2 (fix round 1, 2026-09-01): staffColors must come from the FULL
  // staffList, never the rendered (filtered) list — assignStaffColors hands
  // out hues by SORTED ID position, so computing from the filtered default
  // list would re-hue every stylist sorted after a hidden 経営メンバー.
  // Sorted ids: s1 < s2(flagged, hidden by default) < s3. Colors from the
  // full array: s1=blue(idx0), s2=violet(idx1), s3=teal(idx2). Colors from
  // the filtered [s1, s3] view would instead give s3=violet(idx1).
  it('F2: a hidden flagged member does not re-hue a stylist sorted after it', () => {
    const roster = [
      { id: 's1', name: '秋山', initials: '秋' },
      { id: 's2', name: '浜野', initials: '浜', isManagement: true },
      { id: 's3', name: '善入', initials: '善' },
    ]
    render(<StaffSelector staffList={roster} selected="all" onChange={() => {}} />)
    fireEvent.click(screen.getByText('担当'))
    const row = screen.getByText('善入').closest('button')!
    const avatar = row.querySelector('span[aria-hidden]')!
    expect(avatar.className).toContain('bg-teal-50')
  })

  // F9 (fix round 1, 2026-09-01): search-semantics pins — every existing
  // reveal test queries a single-character prefix, so trim, case-
  // insensitivity and mid-string substring had no coverage.
  describe('search semantics (F9)', () => {
    const SEMANTICS_STAFF = [
      { id: 'sy', name: '鈴木 友梨佳', initials: '鈴' },
      { id: 'lm', name: 'Liam', initials: 'L' },
    ]

    it('trims surrounding whitespace before matching', () => {
      render(<StaffSelector staffList={SEMANTICS_STAFF} selected="all" onChange={() => {}} />)
      fireEvent.click(screen.getByText('担当'))
      fireEvent.change(screen.getByPlaceholderText('スタッフを検索…'), {
        target: { value: '  鈴木  ' },
      })
      expect(screen.getByText('鈴木 友梨佳')).toBeInTheDocument()
    })

    it('matches case-insensitively on a latin name', () => {
      render(<StaffSelector staffList={SEMANTICS_STAFF} selected="all" onChange={() => {}} />)
      fireEvent.click(screen.getByText('担当'))
      fireEvent.change(screen.getByPlaceholderText('スタッフを検索…'), {
        target: { value: 'liam' },
      })
      expect(screen.getByText('Liam')).toBeInTheDocument()
    })

    it('matches a mid-string substring, not just a prefix', () => {
      render(<StaffSelector staffList={SEMANTICS_STAFF} selected="all" onChange={() => {}} />)
      fireEvent.click(screen.getByText('担当'))
      fireEvent.change(screen.getByPlaceholderText('スタッフを検索…'), {
        target: { value: '友梨' },
      })
      expect(screen.getByText('鈴木 友梨佳')).toBeInTheDocument()
    })
  })

  // Greptile fix round 1 (PR #756, 2026-09-01): the panel's list scroller was
  // capped at a static 55vh beneath the fixed search header, so an on-screen
  // keyboard on mobile — which shrinks the visible area but not vh — could
  // clip rows behind it.
  // Greptile fix round 2: the dvh cap lived on the list scroller alone, so
  // the fixed title + search rows sat OUTSIDE the keyboard-aware bound and
  // could still push list results behind the keyboard/screen edge. The cap
  // now bounds the whole panel (title + search + list); the list scroller
  // just flexes to fill whatever room remains. jsdom can't lay out real
  // viewports, so this pins the class strings: a dvh term must be present on
  // the PANEL, and the list scroller must flex inside it — same house
  // pattern as StaffCombobox's 35dvh cap.
  // Greptile fix round 3: the 55dvh ceiling alone could shrink to under one
  // usable list row on a badly squeezed visual viewport (keyboard open on a
  // short phone). max(180px, …) floors the panel so ~2.2 list rows always
  // stay usable — pin that the floor term is present alongside the dvh
  // ceiling.
  it('the panel caps with a dvh term and a usable floor, and the list scroller flexes inside it', () => {
    const { container } = render(
      <StaffSelector staffList={STAFF} selected="all" onChange={() => {}} />,
    )
    fireEvent.click(screen.getByText('担当'))
    const panel = container.querySelector('[role="listbox"]')
    expect(panel?.className).toContain('dvh')
    expect(panel?.className).toContain('max(180px')
    expect(panel?.className).toContain('flex-col')
    const scroller = container.querySelector('.overscroll-contain')
    expect(scroller?.className).toContain('min-h-0')
    expect(scroller?.className).toContain('flex-1')
  })
})

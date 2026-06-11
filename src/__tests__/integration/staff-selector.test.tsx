/**
 * @jest-environment jsdom
 *
 * 担当トリガー (option D) render contract — real ja.json strings.
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = require('../../../messages/ja.json')
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
  it('staff selected: trigger names them with their avatar', () => {
    render(<StaffSelector staffList={STAFF} selected="s2" onChange={() => {}} />)
    expect(screen.getByText('浜野')).toBeInTheDocument()
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
  it('全スタッフ row selects all', () => {
    const calls: string[] = []
    render(<StaffSelector staffList={STAFF} selected="s1" onChange={(n) => calls.push(n)} />)
    fireEvent.click(screen.getByRole('button', { name: /原田/ }))
    fireEvent.click(screen.getByText('全スタッフ'))
    expect(calls).toEqual(['all'])
  })
})

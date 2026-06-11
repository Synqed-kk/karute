/**
 * @jest-environment jsdom
 *
 * Customer-memory pin/edit/delete/add — the buttons that used to open the
 * stale 「Anthonyが実装中」 stub. Real ja.json strings.
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
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/memory', () => ({
  addMemoryItemAction: jest.fn().mockResolvedValue({ ok: true }),
  updateMemoryItemAction: jest.fn().mockResolvedValue({ ok: true }),
  toggleMemoryPinAction: jest.fn().mockResolvedValue({ ok: true }),
  deleteMemoryItemAction: jest.fn().mockResolvedValue({ ok: true }),
}))
const actions = jest.requireMock('@/actions/memory') as Record<string, jest.Mock>

import { CustomerMemoryCard } from '@/components/karute/spike-lifted/memory/CustomerMemoryCard'

const ITEM = {
  id: 'm1', category: 'body' as const, label: '腰痛',
  body: '腰と背中の筋肉が弱っている', source: 'ai' as const,
  pinned: false, suggestTalkingPoint: false,
  capturedAt: '2026-06-11',
}
const MEMORY = {
  items: [ITEM],
  intake: null,
  lastUpdatedAt: '2026-06-11T00:00:00Z',
}

const mount = () =>
  render(
    <CustomerMemoryCard
      customerName="ぴあそん"
      customerId="c1"
      memory={MEMORY as never}
      pastSessionCount={14}
    />,
  )

describe('memory CRUD wiring', () => {
  beforeEach(() => jest.clearAllMocks())
  it('the stale coming-soon dialog is GONE: pin fires the real action', () => {
    mount()
    fireEvent.click(screen.getByLabelText('pin'))
    expect(actions.toggleMemoryPinAction).toHaveBeenCalledWith('m1', true)
    expect(screen.queryByText(/Anthonyが実装中/)).toBeNull()
  })
  it('edit opens the editor prefilled and save fires update', () => {
    mount()
    fireEvent.click(screen.getByLabelText('edit'))
    expect(screen.getByText('メモリーを編集')).toBeInTheDocument()
    expect(screen.getByDisplayValue('腰痛')).toBeInTheDocument()
    fireEvent.click(screen.getByText('保存'))
    expect(actions.updateMemoryItemAction).toHaveBeenCalledWith({
      id: 'm1', label: '腰痛', detail: '腰と背中の筋肉が弱っている',
    })
  })
  it('delete asks first, then fires the soft delete', () => {
    mount()
    fireEvent.click(screen.getByLabelText('remove'))
    expect(screen.getByText('このメモリーを削除しますか？')).toBeInTheDocument()
    expect(actions.deleteMemoryItemAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('削除'))
    expect(actions.deleteMemoryItemAction).toHaveBeenCalledWith('m1')
  })
  it('手動で追加 opens the editor with a category picker; save fires add', () => {
    mount()
    fireEvent.click(screen.getByText('手動で追加'))
    expect(screen.getByText('カテゴリ')).toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue(/プライベート|個人/), { target: { value: 'goal' } })
    const inputs = screen.getAllByRole('textbox')
    fireEvent.change(inputs[0], { target: { value: '夏までに-3kg' } })
    fireEvent.click(screen.getByText('保存'))
    expect(actions.addMemoryItemAction).toHaveBeenCalledWith({
      customerId: 'c1', category: 'goal', label: '夏までに-3kg', detail: '',
    })
  })
})

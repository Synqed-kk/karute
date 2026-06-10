/**
 * @jest-environment jsdom
 *
 * 新しい回数券 picker (Liam-approved mock) — the conservation-law fix for
 * broken link #1: the pack's INPUT moment is the 成約 tap, not a profile
 * errand. Real ja.json strings (missing key throws).
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = require('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      },
  }
})

import {
  PostSessionResolutionDialog,
  type NewPackInput,
} from '@/components/karute/redesign/record/PostSessionResolutionDialog'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

const PRESETS = [
  { size: 3, unitPrice: 8800 },
  { size: 6, unitPrice: 9900 },
  { size: 10, unitPrice: 8800 },
]

function mount(over: Partial<Parameters<typeof PostSessionResolutionDialog>[0]> = {}) {
  const calls: Array<{ outcome: SessionOutcome; redeem: boolean; newPack: NewPackInput | null }> = []
  render(
    <PostSessionResolutionDialog
      open
      customerName="廣瀬浩子"
      isFirstVisit
      packPresets={PRESETS}
      onResolve={(outcome, redeem, newPack) => calls.push({ outcome, redeem, newPack })}
      onCancel={() => {}}
      {...over}
    />,
  )
  return calls
}

describe('新しい回数券 picker', () => {
  it('成約 opens the panel with preset chips; save passes the picked pack', () => {
    const calls = mount()
    fireEvent.click(screen.getByText('成約しました'))
    expect(screen.getByText('🎫 新しい回数券')).toBeInTheDocument()
    fireEvent.click(screen.getByText('10回'))
    fireEvent.click(screen.getByText('¥9,900'))
    fireEvent.click(screen.getByText('保存'))
    expect(calls).toHaveLength(1)
    expect(calls[0].newPack).toEqual({ size: 10, unitPrice: 9900 })
    expect(calls[0].outcome.status).toBe('success')
  })

  it('prefills from the FIRST preset when no previous pack (3回 × ¥8,800)', () => {
    const calls = mount()
    fireEvent.click(screen.getByText('成約しました'))
    fireEvent.click(screen.getByText('保存'))
    expect(calls[0].newPack).toEqual({ size: 3, unitPrice: 8800 })
  })

  it('previousPack beats presets as the prefill', () => {
    const calls = mount({ previousPack: { size: 6, unitPrice: 9900 } })
    fireEvent.click(screen.getByText('成約しました'))
    fireEvent.click(screen.getByText('保存'))
    expect(calls[0].newPack).toEqual({ size: 6, unitPrice: 9900 })
  })

  it('あとで登録 collapses the panel and saves with newPack=null', () => {
    const calls = mount()
    fireEvent.click(screen.getByText('成約しました'))
    fireEvent.click(screen.getByText('あとで登録'))
    fireEvent.click(screen.getByText('保存'))
    expect(calls[0].newPack).toBeNull()
  })

  it('staffCanCustomize=false hides the free-input chips (owner toggle)', () => {
    mount({ staffCanCustomize: false })
    fireEvent.click(screen.getByText('成約しました'))
    expect(screen.queryByText('他…')).toBeNull()
    expect(screen.queryByText('直接入力')).toBeNull()
  })

  it('no presets + custom off → no panel at all (falls back to the toast path)', () => {
    const calls = mount({ packPresets: [], staffCanCustomize: false })
    fireEvent.click(screen.getByText('成約しました'))
    expect(screen.queryByText('🎫 新しい回数券')).toBeNull()
    fireEvent.click(screen.getByText('保存'))
    expect(calls[0].newPack).toBeNull()
  })

  it('不成約 never shows the panel and passes newPack=null', () => {
    const calls = mount()
    fireEvent.click(screen.getByText('今回は不成約でした'))
    expect(screen.queryByText('🎫 新しい回数券')).toBeNull()
    fireEvent.click(screen.getByText('保存'))
    expect(calls[0].newPack).toBeNull()
  })
})

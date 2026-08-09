/**
 * @jest-environment jsdom
 *
 * 新しい回数券 picker (Liam-approved mock) — the conservation-law fix for
 * broken link #1: the pack's INPUT moment is the 成約 tap, not a profile
 * errand. Real ja.json strings (missing key throws).
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
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

describe('保存 — saving prop (fix/post-session-money-guards single-flight guard)', () => {
  it('saving=true disables 保存/キャンセル and shows the saving label — no onResolve call reaches the caller', () => {
    const calls = mount({ saving: true })
    fireEvent.click(screen.getByText('成約しました'))
    const saveBtn = screen.getByText('保存中...')
    expect(saveBtn).toBeDisabled()
    expect(screen.getByText('キャンセル')).toBeDisabled()
    fireEvent.click(saveBtn)
    expect(calls).toHaveLength(0)
  })

  it('saving=false (default) keeps 保存 enabled and labeled 保存', () => {
    mount()
    fireEvent.click(screen.getByText('成約しました'))
    expect(screen.getByText('保存')).not.toBeDisabled()
  })
})

// PR-A — 既存のお客様（通常ご来店）. The gate is `mode==='conversion' &&
// isReturningCustomer===true`; anything else (first visit, UNKNOWN, repurchase)
// must not render the card at all.
const REVISIT = '既存のお客様（通常ご来店）'

describe('revisit card — gate', () => {
  it('conversion mode + returning customer → the card renders, 2nd in the list', () => {
    mount({ isFirstVisit: false, isReturningCustomer: true })
    expect(screen.getByText(REVISIT)).toBeInTheDocument()
    // Approved mock order: 成約 → 既存のお客様 → 不成約 → 後で決める.
    const before = (a: string, b: string) =>
      !!(
        screen.getByText(a).compareDocumentPosition(screen.getByText(b)) &
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    expect(before('成約しました', REVISIT)).toBe(true)
    expect(before(REVISIT, '今回は不成約でした')).toBe(true)
    expect(before('今回は不成約でした', '後で決める')).toBe(true)
  })

  it('carries the mislabeling guard line', () => {
    mount({ isFirstVisit: false, isReturningCustomer: true })
    expect(
      screen.getByText(
        '回数券やメニューのご案内をして断られた場合は「不成約」を選択してください。',
      ),
    ).toBeInTheDocument()
  })

  it('first visit → hidden', () => {
    mount({ isFirstVisit: true, isReturningCustomer: false })
    expect(screen.queryByText(REVISIT)).toBeNull()
  })

  it('UNKNOWN returning signal → hidden (never speculative)', () => {
    mount({ isFirstVisit: false, isReturningCustomer: null })
    expect(screen.queryByText(REVISIT)).toBeNull()
    mount({ isFirstVisit: false }) // prop absent entirely
    expect(screen.queryByText(REVISIT)).toBeNull()
  })

  it('repurchase mode never renders it, even for a returning customer', () => {
    mount({ mode: 'repurchase', isFirstVisit: false, isReturningCustomer: true })
    expect(screen.queryByText(REVISIT)).toBeNull()
    expect(screen.getByText('購入した')).toBeInTheDocument()
  })
})

describe('revisit card — save', () => {
  it("saves status 'revisit' with no reason and no pack write", () => {
    const calls = mount({ isFirstVisit: false, isReturningCustomer: true })
    fireEvent.click(screen.getByText(REVISIT))
    // The 新しい回数券 panel stays gated to 成約 exactly as before.
    expect(screen.queryByText('🎫 新しい回数券')).toBeNull()
    expect(screen.queryByText('理由（任意）')).toBeNull()
    fireEvent.click(screen.getByText('保存'))
    expect(calls).toHaveLength(1)
    expect(calls[0].outcome.status).toBe('revisit')
    expect(calls[0].outcome.reason).toBeNull()
    expect(calls[0].newPack).toBeNull()
  })
})

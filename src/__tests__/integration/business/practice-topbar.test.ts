/**
 * ⚖ PR-3 §v3 V3-5 — the topbar's honesty chip, both ways. Under the practice
 * door it names the practice world (「練習用の事業」, its aria-label the long
 * form); with the switch OFF it is today's 「◈ サンプルデータ」 chip, exactly.
 * The component is called as a function (its three hooks stubbed) and its
 * element tree read — Business territory imports no renderer.
 */
jest.mock('next/navigation', () => ({
  usePathname: () => '/ja/business/settings',
  useSearchParams: () => new URLSearchParams(''),
}))
jest.mock('react', () => ({ ...jest.requireActual('react'), useContext: () => ({ action: null, set: () => {} }) }))

import type { ReactElement, ReactNode } from 'react'
import { BusinessTopbar } from '@/app/[locale]/(business)/BusinessTopbar'

type El = ReactElement<{ className?: string; children?: ReactNode; [k: string]: unknown }>
function find(node: ReactNode, cls: string): El | null {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, cls)
      if (hit) return hit
    }
    return null
  }
  const el = node as El
  if (el.props?.className === cls) return el
  return find(el.props?.children, cls)
}
const chip = (practice: boolean) => {
  const tree = BusinessTopbar({ stores: [{ id: 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f', name: 'テスト東京店' }] as never, syncLabel: 'Reserve同期サンプル 13:12', ...(practice ? { practice: true as const } : {}) })
  const el = find(tree, 'honesty')!
  return { role: el.props.role, aria: el.props['aria-label'], text: el.props.children }
}

describe('⚖ PR-3 §v3 V3-5 — the topbar names the practice world under the door', () => {
  it('OFF: today’s chip', () => {
    expect(chip(false)).toEqual({ role: 'note', aria: 'サンプルデータ — 実データではありません', text: '◈ サンプルデータ' })
  })
  it('ON: 「練習用の事業」, and never サンプルデータ', () => {
    expect(chip(true)).toEqual({ role: 'note', aria: '練習用の事業 — 実在の店舗の予約・お客様ではありません', text: '◈ 練習用の事業' })
  })
})

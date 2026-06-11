/**
 * @jest-environment jsdom
 *
 * 未処理来店 strip render contract (Liam-approved mock) — real ja.json strings.
 */
import { render, screen } from '@testing-library/react'

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
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/packs', () => ({
  redeemSessionAction: jest.fn(), undoRedemptionAction: jest.fn(), dismissVisitReconcileAction: jest.fn(),
}))

import { ReconcileStrip } from '@/components/dashboard/redesign/ReconcileStrip'

const entry = (over = {}) => ({
  customerId: 'c1', appointmentId: 'a1', visitDay: '2026-06-09',
  kind: 'unrecorded' as const, name: '坊垣佳奈', karuteNumber: '#00051',
  remaining: 2, size: 6, packId: 'p1', ...over,
})

describe('ReconcileStrip', () => {
  it('renders NOTHING when empty (housekeeping, not furniture)', () => {
    const { container } = render(<ReconcileStrip data={{ entries: [], truncated: 0 }} />)
    expect(container.firstChild).toBeNull()
  })
  it('記録なし row: chips, pack short, both actions', () => {
    render(<ReconcileStrip data={{ entries: [entry()], truncated: 0 }} />)
    expect(screen.getByText('未処理来店 1件')).toBeInTheDocument()
    expect(screen.getByText('記録なし')).toBeInTheDocument()
    expect(screen.getByText(/残2\/6/)).toBeInTheDocument()
    expect(screen.getByText('この日に消化')).toBeInTheDocument()
    expect(screen.getByText('来店なし')).toBeInTheDocument()
  })
  it('消化のみ未処理 chip for karute-exists rows', () => {
    render(<ReconcileStrip data={{ entries: [entry({ kind: 'unredeemed' })], truncated: 0 }} />)
    expect(screen.getByText('消化のみ未処理')).toBeInTheDocument()
  })
  it('no packId → redeem button hidden, dismiss stays', () => {
    render(<ReconcileStrip data={{ entries: [entry({ packId: null })], truncated: 0 }} />)
    expect(screen.queryByText('この日に消化')).toBeNull()
    expect(screen.getByText('来店なし')).toBeInTheDocument()
  })
  it('honest truncation line', () => {
    render(<ReconcileStrip data={{ entries: [entry()], truncated: 4 }} />)
    expect(screen.getByText(/他4件/)).toBeInTheDocument()
  })
})

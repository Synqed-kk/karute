/**
 * @jest-environment jsdom
 *
 * ticket_packs_enabled gating contract — real ja.json strings.
 * Off → TicketPackCard shows ONLY the lifecycle row (卒業/離客/口コミ is
 * customer state, not a ticket feature); no pack header, no add button.
 * On (default) → full card renders as before.
 */
import { render, screen } from '@testing-library/react'

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
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))
jest.mock('@/actions/packs', () => ({
  redeemSessionAction: jest.fn(),
  undoRedemptionAction: jest.fn(),
  createPackAction: jest.fn(),
  updatePackStatusAction: jest.fn(),
  setPackStatusAction: jest.fn(),
  setLifecycleAction: jest.fn(),
}))

import { TicketPackCard } from '@/components/customers/redesign/profile/TicketPackCard'

const pack = {
  id: 'p1',
  customer_id: 'c1',
  kind: 'pack' as const,
  pack_size: 6,
  unit_price: 9350,
  total_price: 56100,
  purchase_round: 1,
  purchased_at: '2026-06-01',
  source: 'manual' as const,
  status: 'active' as const,
  notes: null,
  redeemedCount: 2,
  remaining: 4,
  unconsumedValue: 37400,
  lastRedeemedOn: '2026-06-20',
}

describe('TicketPackCard × ticket_packs_enabled', () => {
  it('off → lifecycle row only: no 回数券 header, no pack rows', () => {
    render(
      <TicketPackCard
        customerId="c1"
        packs={[pack]}
        lifecycle={null}
        ticketsEnabled={false}
      />,
    )
    // lifecycle chips stay (customer state, not tickets)
    expect(screen.getByText('卒業')).toBeInTheDocument()
    // every pack surface is gone
    expect(screen.queryByText('回数券・サブスク')).not.toBeInTheDocument()
    expect(screen.queryByText(/残り/)).not.toBeInTheDocument()
  })

  it('on (default) → full card renders with the pack', () => {
    render(<TicketPackCard customerId="c1" packs={[pack]} lifecycle={null} />)
    expect(screen.getByText('卒業')).toBeInTheDocument()
    expect(screen.getByText('回数券・サブスク')).toBeInTheDocument()
  })
})

/**
 * @jest-environment jsdom
 *
 * 回数券 update 25, Layer 1, p4 — the card's amber 「残りわずか」 hint is
 * about starting the next-pack conversation. That conversation is moot when
 * a newer active pack already sits above the old 残1 one — suppress it
 * (hasNewerActive is already computed + threaded for the sibling `closed`
 * state; this reuses the same flag, no new copy).
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
  setLifecycleAction: jest.fn(),
}))

import { TicketPackCard } from '@/components/customers/redesign/profile/TicketPackCard'
import type { PackWithUsage } from '@/lib/packs/types'

const LOW_HINT = '残りわずか — 次回ご来店時に次の回数券のご案内を'

const oldPack: PackWithUsage = {
  id: 'old',
  customer_id: 'c1',
  kind: 'pack',
  pack_size: 6,
  unit_price: 9350,
  total_price: 56100,
  purchase_round: 1,
  purchased_at: '2026-04-29',
  source: 'manual',
  status: 'active',
  notes: null,
  redeemedCount: 5,
  remaining: 1,
  unconsumedValue: 9350,
  lastRedeemedOn: '2026-08-01',
}

const newPack: PackWithUsage = {
  id: 'new',
  customer_id: 'c1',
  kind: 'pack',
  pack_size: 10,
  unit_price: 9900,
  total_price: 99000,
  purchase_round: 2,
  purchased_at: '2026-08-30',
  source: 'manual',
  status: 'active',
  notes: null,
  redeemedCount: 0,
  remaining: 10,
  unconsumedValue: 99000,
  lastRedeemedOn: null,
}

const newPackLow: PackWithUsage = {
  id: 'new2',
  customer_id: 'c1',
  kind: 'pack',
  pack_size: 10,
  unit_price: 9900,
  total_price: 99000,
  purchase_round: 2,
  purchased_at: '2026-08-30',
  source: 'manual',
  status: 'active',
  notes: null,
  redeemedCount: 9,
  remaining: 1,
  unconsumedValue: 9900,
  lastRedeemedOn: '2026-09-01',
}

const cancelledPack: PackWithUsage = {
  id: 'cancelled',
  customer_id: 'c1',
  kind: 'pack',
  pack_size: 10,
  unit_price: 9900,
  total_price: 99000,
  purchase_round: 3,
  purchased_at: '2026-09-01',
  source: 'manual',
  status: 'cancelled',
  notes: null,
  redeemedCount: 0,
  remaining: 10,
  unconsumedValue: 99000,
  lastRedeemedOn: null,
}

describe('TicketPackCard — 残りわずか suppressed when a newer active pack exists', () => {
  it('old 残1 alone → the hint renders', () => {
    render(<TicketPackCard customerId="c1" packs={[oldPack]} lifecycle={null} />)
    expect(screen.getByText(LOW_HINT)).toBeInTheDocument()
  })

  it('old 残1 + a newer active pack → no hint on the old pack', () => {
    render(<TicketPackCard customerId="c1" packs={[newPack, oldPack]} lifecycle={null} />)
    expect(screen.queryByText(LOW_HINT)).not.toBeInTheDocument()
  })

  // p5 — the hint is the SAME total-balance rule the stop dialog uses
  // (resolveOutcomeMode), not "any newer active pack exists": two packs each
  // at 残1 sum to the repurchase decision point (total 2), same as the
  // dialog, so BOTH must ask — never both silenced.
  it('TWO active packs each at 残1 (total 2) → BOTH show the hint (the dialog asks at total 2)', () => {
    render(<TicketPackCard customerId="c1" packs={[oldPack, newPackLow]} lifecycle={null} />)
    expect(screen.getAllByText(LOW_HINT)).toHaveLength(2)
  })

  // p5 (B2's sibling on the phone side) — a cancelled pack never counts
  // toward the total, however many sessions it still shows on paper.
  it('old 残1 + a cancelled pack with sessions left → hint still renders (cancelled never counts)', () => {
    render(<TicketPackCard customerId="c1" packs={[oldPack, cancelledPack]} lifecycle={null} />)
    expect(screen.getByText(LOW_HINT)).toBeInTheDocument()
  })
})

// UPDATE 26 (CORE-12): a 'void' pack is its own inactive word — never the
// false 「停止」(cancelled) claim. Same active/inactive split as the
// cancelled-pack test above; this pins the THIRD status arm.
const voidPack: PackWithUsage = {
  id: 'voided',
  customer_id: 'c1',
  kind: 'pack',
  pack_size: 10,
  unit_price: 9900,
  total_price: 99000,
  purchase_round: 4,
  purchased_at: '2026-09-01',
  source: 'manual',
  status: 'void',
  notes: null,
  redeemedCount: 0,
  remaining: 10,
  unconsumedValue: 99000,
  lastRedeemedOn: null,
}

describe('TicketPackCard — UPDATE 26 void pack status renders 無効, never 停止', () => {
  it('a void pack in the inactive list shows 無効 — never 停止 (cancelled) or 使い切り (exhausted)', () => {
    render(<TicketPackCard customerId="c1" packs={[voidPack]} lifecycle={null} />)
    expect(screen.getByText('無効')).toBeInTheDocument()
    expect(screen.queryByText('停止')).not.toBeInTheDocument()
    expect(screen.queryByText('使い切り')).not.toBeInTheDocument()
  })

  it('void + cancelled side by side each keep their own word', () => {
    render(<TicketPackCard customerId="c1" packs={[voidPack, cancelledPack]} lifecycle={null} />)
    expect(screen.getByText('無効')).toBeInTheDocument()
    expect(screen.getByText('停止')).toBeInTheDocument()
  })
})

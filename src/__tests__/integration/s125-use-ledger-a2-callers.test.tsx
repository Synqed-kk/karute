/** @jest-environment jsdom */
/**
 * S125 A6 + § 6a (builder 4, S126): the web callers read the use state.
 * pending = success with the mock's toast 「消化を記録しました」 (MOCK-HANEI-MACHI-S123
 * :251, shown on a pending use at :580); held = 「確認待ち」 (:429/:452), info, never
 * error styling, the row moves on; refused keeps today's toasts. TicketPackCard
 * shows 「残数確認中」 (:235) when the ledger read failed; the use button stays live.
 * Plus 今月消化 ¥: a pending ledger use prices into monthlyBurnByCustomer.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }))
jest.mock('@/actions/packs', () => ({
  redeemSessionAction: jest.fn(),
  undoRedemptionAction: jest.fn(),
  dismissVisitReconcileAction: jest.fn(),
  createPackAction: jest.fn(),
  updatePackStatusAction: jest.fn(),
  setPackStatusAction: jest.fn(),
  setLifecycleAction: jest.fn(),
}))

import { toast } from 'sonner'
import { redeemSessionAction } from '@/actions/packs'
import { TicketPackCard } from '@/components/customers/redesign/profile/TicketPackCard'
import { ReconcileStrip } from '@/components/dashboard/redesign/ReconcileStrip'
import { TodoCard } from '@/components/dashboard/redesign/TodoCard'
import { ledgerBurnRows, monthlyBurnByCustomer } from '@/lib/packs/burn'

const redeem = redeemSessionAction as jest.Mock
const ts = toast as unknown as { success: jest.Mock; error: jest.Mock; info: jest.Mock }

const pack = {
  id: 'p1', customer_id: 'c1', kind: 'pack' as const, pack_size: 10, unit_price: 9900,
  total_price: 99000, purchase_round: 2, purchased_at: '2026-06-01', source: 'manual' as const,
  status: 'active' as const, notes: null, redeemedCount: 4, remaining: 6, unconsumedValue: 59400,
  lastRedeemedOn: '2026-09-20',
}
const entry = {
  customerId: 'c1', appointmentId: 'a1', visitDay: '2026-10-10', kind: 'unrecorded' as const,
  name: '山田 花子', karuteNumber: '#00051', remaining: 6, size: 10, packId: 'p1',
}

const RESULTS = {
  pending: { ok: true, state: 'pending', intentId: 'i1' },
  held: { ok: true, state: 'held', intentId: 'i2', heldAgainst: 'i1' },
  refused: { ok: false, state: 'refused', error: 'core_refused' },
} as const

type Caller = { name: string; mount: () => void; tap: () => Promise<void>; refusedToast: string }
const callers: Caller[] = [
  {
    name: 'TicketPackCard',
    mount: () => render(<TicketPackCard customerId="c1" packs={[pack]} lifecycle={null} />),
    tap: async () => {
      fireEvent.click(screen.getByText('1回消化'))
      fireEvent.click(await screen.findByText('記録する'))
    },
    refusedToast: '記録できませんでした',
  },
  {
    name: 'ReconcileStrip',
    mount: () => render(<ReconcileStrip data={{ entries: [entry], truncated: 0 }} />),
    tap: async () => { fireEvent.click(screen.getByText('この日に消化')) },
    refusedToast: '消化できませんでした',
  },
  {
    name: 'TodoCard',
    mount: () => render(<TodoCard karuteTodos={[]} redeemTodos={[entry]} />),
    tap: async () => {
      const ja = jest.requireActual('../../../messages/ja.json')
      fireEvent.click(screen.getByText(ja.dashboard.flow.redeemCta))
    },
    refusedToast: '消化に失敗しました',
  },
]

beforeEach(() => jest.clearAllMocks())

describe.each(callers)('S125 A6 — $name reads the use state', (c) => {
  it('pending → success with the mock toast 「消化を記録しました」, no error', async () => {
    redeem.mockResolvedValueOnce(RESULTS.pending)
    c.mount()
    await c.tap()
    await waitFor(() => expect(ts.success).toHaveBeenCalledWith('消化を記録しました'))
    expect(ts.error).not.toHaveBeenCalled()
  })
  it('held → 「確認待ち」 as info (no error styling), moves on', async () => {
    redeem.mockResolvedValueOnce(RESULTS.held)
    c.mount()
    await c.tap()
    await waitFor(() => expect(ts.info).toHaveBeenCalledWith('確認待ち'))
    expect(ts.error).not.toHaveBeenCalled()
    expect(ts.success).not.toHaveBeenCalled()
  })
  it("refused → today's error toast", async () => {
    redeem.mockResolvedValueOnce(RESULTS.refused)
    c.mount()
    await c.tap()
    await waitFor(() => expect(ts.error).toHaveBeenCalledWith(c.refusedToast))
    expect(ts.success).not.toHaveBeenCalled()
  })
})

describe('§ 6a TicketPackCard 残数確認中 (test 19, card half)', () => {
  it('ledgerUnreadable → 「残数確認中」 replaces the number; the use button stays live and the server gate runs', async () => {
    redeem.mockResolvedValueOnce(RESULTS.refused)
    render(<TicketPackCard customerId="c1" packs={[pack]} lifecycle={null} ledgerUnreadable />)
    expect(screen.getByText('残数確認中')).toBeInTheDocument()
    expect(screen.queryByText('残り6回')).not.toBeInTheDocument()
    const use = screen.getByText('1回消化').closest('button')!
    expect(use).not.toBeDisabled()
    fireEvent.click(use)
    fireEvent.click(await screen.findByText('記録する'))
    await waitFor(() => expect(redeem).toHaveBeenCalledWith({ packId: 'p1', customerId: 'c1' }))
  })
  it('a readable ledger → the folded remaining number', () => {
    render(<TicketPackCard customerId="c1" packs={[pack]} lifecycle={null} />)
    expect(screen.getByText('残り6回')).toBeInTheDocument()
    expect(screen.queryByText('残数確認中')).not.toBeInTheDocument()
  })
})

describe('§ 6b consumer 7 — 今月消化 ¥ counts a pending ledger use', () => {
  it('a pending use prices as its pack unit_price into this month', () => {
    const now = new Date('2026-10-10T05:00:00Z')
    const usage = new Map([
      ['c1', { ledgerBurns: [{ customer_id: 'c1', redeemed_on: '2026-10-10', unit_price: 9900 }] }],
      ['c2', {}],
    ])
    const rows = [{ customer_id: 'c1', redeemed_on: '2026-10-02', unit_price: 9900 }]
    expect(monthlyBurnByCustomer(rows, now).byCustomer.c1.mtd).toBe(9900)
    expect(monthlyBurnByCustomer([...rows, ...ledgerBurnRows(usage)], now).byCustomer.c1.mtd).toBe(19800)
    expect(ledgerBurnRows(null)).toEqual([])
  })
  it('an unpriced pending use hides the stat (never a partial sum)', () => {
    const now = new Date('2026-10-10T05:00:00Z')
    const usage = new Map([['c1', { ledgerBurns: [{ customer_id: 'c1', redeemed_on: '2026-10-10', unit_price: null }] }]])
    expect(monthlyBurnByCustomer(ledgerBurnRows(usage), now).unpricedCustomers).toEqual(['c1'])
  })
})

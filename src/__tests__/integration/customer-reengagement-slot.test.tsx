/**
 * @jest-environment jsdom
 *
 * CustomerReengagementSlot — the AIBodyPredictionSlot pattern: renders the
 * real card when the generator returns a draft, else the placeholder
 * (CustomerReengagementPreview, still carrying the amber 対応予定 pill).
 */
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

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
        if (typeof cur !== 'string') {
          throw new Error(`missing ja.json key: ${ns}.${key}`)
        }
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      },
  }
})
jest.mock('@/components/messaging/MessageComposeDialog', () => ({
  MessageComposeDialog: () => null,
}))

const getReengagementDraft = jest.fn()
jest.mock('@/lib/karute/ai-reengagement', () => ({
  getReengagementDraft: (...args: unknown[]) => getReengagementDraft(...args),
}))

import { CustomerReengagementSlot } from '@/components/customers/redesign/profile/CustomerReengagementSlot'

const PARAMS = {
  customerId: 'cust-1',
  customerName: '田中 花子',
  status: 'dormant' as const,
  visitCount: 5,
  lastVisitAgoDays: 95,
  preferredStaffName: null,
  hasUpcomingBooking: false,
  locale: 'ja',
}

beforeEach(() => {
  getReengagementDraft.mockReset()
})

describe('CustomerReengagementSlot', () => {
  it('generator null → renders the placeholder (対応予定 pill present)', async () => {
    getReengagementDraft.mockResolvedValueOnce(null)
    const element = await CustomerReengagementSlot(PARAMS)
    render(element)
    expect(screen.getByText('対応予定')).toBeInTheDocument()
  })

  it('generator returns a draft → renders the real card (draft body visible, no 対応予定 pill)', async () => {
    getReengagementDraft.mockResolvedValueOnce({
      draft: 'SLOT-DRAFT-MARKER',
      reasoning: 'r',
      signals: [],
      tier: 'dormant',
    })
    const element = await CustomerReengagementSlot(PARAMS)
    render(element)
    expect(screen.getByText('SLOT-DRAFT-MARKER')).toBeInTheDocument()
    expect(screen.queryByText('対応予定')).not.toBeInTheDocument()
  })

  it('threads the exact params through to the generator (never re-derived client-side)', async () => {
    getReengagementDraft.mockResolvedValueOnce(null)
    await CustomerReengagementSlot(PARAMS)
    expect(getReengagementDraft).toHaveBeenCalledWith(PARAMS)
  })
})

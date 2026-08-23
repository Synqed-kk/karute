/**
 * @jest-environment jsdom
 *
 * ReassignCustomerAction — fix round 4 nit 3 (+ the round-2 carried
 * observation): two copy couplings with no dedicated pin. Every server-side
 * reassign test only asserts the KEY/param shape passed to t() — never the
 * rendered string — so a locale-copy regression (R3-2's day-scoped
 * burnTitle) or a broken error-string match (errorStoreScope vs the
 * errorGeneric catch-all) could ship silently. next-intl mocked as a REAL
 * lookup against messages/ja.json (login-form.test.tsx / voice-
 * enrollment.test.tsx idiom), so editing the locale file changes what this
 * test renders — JA only, matching both sibling tests' convention.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'

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
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/actions/karute', () => ({
  listReassignCustomerOptions: jest.fn(),
  reassignKaruteCustomer: jest.fn(),
}))

import { ReassignCustomerAction } from '@/components/karute/redesign/detail/ReassignCustomerAction'

const ja = jest.requireActual('../../../messages/ja.json').karuteDetail.reassign
const common = jest.requireActual('../../../messages/ja.json').common
const karuteActions = jest.requireMock('@/actions/karute') as {
  listReassignCustomerOptions: jest.Mock
  reassignKaruteCustomer: jest.Mock
}

const ROSTER = [{ id: 'cust-TO', name: '佐藤 花子', furigana: null, phone: null }]

beforeEach(() => {
  jest.clearAllMocks()
  karuteActions.listReassignCustomerOptions.mockResolvedValue({ customers: ROSTER })
})

// Common lead-in for both pins: open the picker, pick the one roster
// customer, and submit the preview request (confirmed:false).
async function openPickAndSubmit() {
  render(<ReassignCustomerAction karuteId="kar-1" customerName="田中 美咲" />)
  await act(async () => {
    fireEvent.click(screen.getByText(ja.action))
  })
  await act(async () => {
    fireEvent.click(await screen.findByText('佐藤 花子'))
  })
  await act(async () => {
    fireEvent.click(screen.getByText(common.next))
  })
}

describe('ReassignCustomerAction — copy couplings (fix round 4, R4-2)', () => {
  it('the confirm panel renders the DAY-SCOPED burn title, real locale copy (R3-2)', async () => {
    karuteActions.reassignKaruteCustomer.mockResolvedValueOnce({
      requiresConfirm: true,
      fromCustomerId: 'cust-FROM',
      fromName: '田中 美咲',
      toName: '佐藤 花子',
      burnCount: 2,
      photoCount: 0,
    })
    await openPickAndSubmit()
    expect(await screen.findByText(ja.confirmTitle)).toBeInTheDocument()
    // Literal pinned copy, NOT `ja.burnTitle` — asserting against the same
    // messages/ja.json the mock reads would make this tautological (a
    // regression in the file would move both sides together and the test
    // would stay green). This is the actual R3-2 day-scoped string; the
    // pre-R3-2 unscoped copy was "回数券の消化 2件" (no この日の prefix).
    expect(screen.getByText('この日の回数券の消化 2件')).toBeInTheDocument()
  })

  it("the server's store-scope refusal maps to errorStoreScope, not errorGeneric", async () => {
    karuteActions.reassignKaruteCustomer.mockResolvedValueOnce({
      error: 'that customer is outside your assigned store',
    })
    await openPickAndSubmit()
    // Literal pinned copy for the same reason as above.
    expect(await screen.findByText('そのお客様は担当店舗の対象外です。')).toBeInTheDocument()
    expect(screen.queryByText('顧客を変更できませんでした。もう一度お試しください。')).toBeNull()
  })
})

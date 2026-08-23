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
 *
 * Fix round 5 additions (fresh-verify D1/D2): the picker's search-overflow
 * behavior (R5-2) and the two-phase UI wiring — which {confirmed} value each
 * button actually sends (R5-3). Both live here because they need the same
 * render harness this file already built.
 *
 * Fix round 6 (Liam's live preview review): the entry is now icon-only
 * (aria-label, no visible text — getByText(ja.action) no longer finds it)
 * and opens a NEW disclaimer step before the picker, so every open-flow
 * helper below clicks the icon by its accessible name, then clicks 続ける.
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

// R6-2: click the icon-only entry (by accessible name), through the new
// disclaimer step's 続ける, into the picker.
async function openThroughDisclaimer() {
  render(<ReassignCustomerAction karuteId="kar-1" customerName="田中 美咲" />)
  await act(async () => {
    fireEvent.click(screen.getByLabelText(ja.action))
  })
  await act(async () => {
    fireEvent.click(screen.getByText(ja.disclaimerContinue))
  })
}

// Common lead-in for both pins: open through the disclaimer, pick the one
// roster customer, and submit the preview request (confirmed:false).
async function openPickAndSubmit() {
  await openThroughDisclaimer()
  await act(async () => {
    fireEvent.click(await screen.findByText('佐藤 花子'))
  })
  await act(async () => {
    fireEvent.click(screen.getByText(common.next))
  })
}

describe('ReassignCustomerAction — copy couplings (fix round 4, R4-2)', () => {
  // R11-1 (fix round 11, Greptile round-6 closure, packet pin 3): three
  // branches, never conflated. Literal pinned copy throughout, NOT
  // `ja.burnTitle*` — asserting against the same messages/ja.json the mock
  // reads would make this tautological (a regression in the file would move
  // both sides together and the test would stay green).
  it('linkedBurnCount > 0 renders the CONFIDENT burn title (no day-scoped hedge), even when sameDayBurnCount is also > 0', async () => {
    karuteActions.reassignKaruteCustomer.mockResolvedValueOnce({
      requiresConfirm: true,
      fromCustomerId: 'cust-FROM',
      fromName: '田中 美咲',
      toName: '佐藤 花子',
      linkedBurnCount: 2,
      sameDayBurnCount: 5,
      photoCount: 0,
    })
    await openPickAndSubmit()
    expect(await screen.findByText(ja.confirmTitle)).toBeInTheDocument()
    expect(screen.getByText('回数券の消化 2件')).toBeInTheDocument()
    expect(screen.queryByText(/この日の回数券の消化/)).toBeNull()
  })

  it('sameDayBurnCount > 0 ALONE (linkedBurnCount 0) renders the day-scoped, explicitly UNCONFIRMED title (R3-2 lineage, R11-1 split)', async () => {
    karuteActions.reassignKaruteCustomer.mockResolvedValueOnce({
      requiresConfirm: true,
      fromCustomerId: 'cust-FROM',
      fromName: '田中 美咲',
      toName: '佐藤 花子',
      linkedBurnCount: 0,
      sameDayBurnCount: 2,
      photoCount: 0,
    })
    await openPickAndSubmit()
    expect(await screen.findByText(ja.confirmTitle)).toBeInTheDocument()
    // This is the actual R11-1 day-scoped, unconfirmed string; the pre-R11-1
    // copy was "この日の回数券の消化 2件" with no 紐付けは未確定 suffix.
    expect(screen.getByText('この日の回数券の消化 2件（この施術との紐付けは未確定）')).toBeInTheDocument()
  })

  it('both counts 0 renders the honesty なし row, not a hidden row', async () => {
    karuteActions.reassignKaruteCustomer.mockResolvedValueOnce({
      requiresConfirm: true,
      fromCustomerId: 'cust-FROM',
      fromName: '田中 美咲',
      toName: '佐藤 花子',
      linkedBurnCount: 0,
      sameDayBurnCount: 0,
      photoCount: 0,
    })
    await openPickAndSubmit()
    expect(await screen.findByText(ja.confirmTitle)).toBeInTheDocument()
    expect(screen.getByText('回数券の消化 なし')).toBeInTheDocument()
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

// ── R5-2 (fresh D1) — picker search overflow ─────────────────────────────
// D1: filterCustomers used to cap INSIDE the filter with no overflow signal.
// Mirrors RecordCustomerPickerDialog's C-3 fix: match everything, cap the
// display, name what's hidden.

const MANY_SATO = Array.from({ length: 12 }, (_, i) => ({
  id: `cust-sato-${i}`,
  name: `佐藤${i}`,
  furigana: null,
  phone: null,
}))

describe('ReassignCustomerAction — search overflow (fix round 5, R5-2)', () => {
  it('12 same-prefix customers → 8 rendered rows + a hidden-count line for the other 4', async () => {
    karuteActions.listReassignCustomerOptions.mockResolvedValue({ customers: MANY_SATO })
    await openThroughDisclaimer()
    // Wait for the (uncapped, browse-mode) roster to land before searching.
    await screen.findAllByRole('option')
    await act(async () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '佐藤' } })
    })
    expect(screen.getAllByRole('option')).toHaveLength(8)
    // Literal pinned copy — ja.hiddenMatches with {n} substituted to 4.
    expect(screen.getByText('他4件 — さらに入力して絞り込み')).toBeInTheDocument()
  })
})

// ── R5-3 (fresh D2) — two-phase UI wiring ────────────────────────────────
// D2: nothing pinned WHICH {confirmed} value each button sends — a swapped
// argument either writes on the first click or makes the commit button a
// permanent no-op, both silently (M28/M29 survived the full 6,107-test
// suite pre-round-5).

describe('ReassignCustomerAction — two-phase wiring (fresh D2, R5-3)', () => {
  it('次へ calls the action with confirmed:false and nothing else', async () => {
    karuteActions.reassignKaruteCustomer.mockResolvedValueOnce({
      requiresConfirm: true,
      fromCustomerId: 'cust-FROM',
      fromName: '田中 美咲',
      toName: '佐藤 花子',
      linkedBurnCount: 0,
      sameDayBurnCount: 0,
      photoCount: 0,
    })
    await openPickAndSubmit()
    expect(karuteActions.reassignKaruteCustomer).toHaveBeenCalledTimes(1)
    expect(karuteActions.reassignKaruteCustomer).toHaveBeenCalledWith('kar-1', 'cust-TO', { confirmed: false })
  })

  it('変更を確定 calls the action with confirmed:true and nothing else', async () => {
    karuteActions.reassignKaruteCustomer
      .mockResolvedValueOnce({
        requiresConfirm: true,
        fromCustomerId: 'cust-FROM',
        fromName: '田中 美咲',
        toName: '佐藤 花子',
        linkedBurnCount: 0,
        sameDayBurnCount: 0,
        photoCount: 0,
      })
      .mockResolvedValueOnce({ success: true, linkedBurnCount: 0, sameDayBurnCount: 0, photoCount: 0 })
    await openPickAndSubmit()
    await screen.findByText(ja.confirmTitle)
    await act(async () => {
      fireEvent.click(screen.getByText(ja.confirmButton))
    })
    expect(karuteActions.reassignKaruteCustomer).toHaveBeenCalledTimes(2)
    expect(karuteActions.reassignKaruteCustomer).toHaveBeenNthCalledWith(2, 'kar-1', 'cust-TO', { confirmed: true })
  })
})

// ── R6-2 pins — disclaimer/consent step (fix round 6) ────────────────────
// Liam's live preview review: a new client-only pre-step, roster fetch
// deferred until 続ける. Server two-phase flow is untouched (no pin needed
// here — that's the existing R3/R5 suites).

describe('ReassignCustomerAction — disclaimer step (fix round 6, R6-2)', () => {
  it('pin 1: clicking the icon shows the disclaimer and does NOT show the picker or fetch the roster yet', async () => {
    render(<ReassignCustomerAction karuteId="kar-1" customerName="田中 美咲" />)
    await act(async () => {
      fireEvent.click(screen.getByLabelText(ja.action))
    })
    // Literal pinned copy — same reason as the burnTitle/errorStoreScope
    // pins above (asserting against ja.disclaimerTitle would be
    // tautological against the same file this mock reads).
    expect(screen.getByText('カルテを別の顧客へ変更')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(karuteActions.listReassignCustomerOptions).not.toHaveBeenCalled()
  })

  it('pin 2: 続ける moves to the picker (combobox visible, roster fetched)', async () => {
    await openThroughDisclaimer()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(karuteActions.listReassignCustomerOptions).toHaveBeenCalledWith('kar-1')
  })

  it('キャンセル on the disclaimer resets to idle — no picker, no roster fetch', async () => {
    render(<ReassignCustomerAction karuteId="kar-1" customerName="田中 美咲" />)
    await act(async () => {
      fireEvent.click(screen.getByLabelText(ja.action))
    })
    await act(async () => {
      fireEvent.click(screen.getByText(common.cancel))
    })
    expect(screen.queryByText('カルテを別の顧客へ変更')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(karuteActions.listReassignCustomerOptions).not.toHaveBeenCalled()
  })
})

describe('ReassignCustomerAction — icon-only entry a11y (fix round 6, R6-1, pin 5)', () => {
  it('the icon-only control carries the accessible name (顧客を変更), no visible label', async () => {
    render(<ReassignCustomerAction karuteId="kar-1" customerName="田中 美咲" />)
    // getByRole with an accessible-name match is the house pattern for
    // pinning an icon-only control's a11y name (AISummaryCard's edit
    // button follows the same aria-label idiom).
    const entry = screen.getByRole('button', { name: ja.action })
    expect(entry).toBeInTheDocument()
    // No visible text node reading 顧客を変更 — it's icon-only (an
    // aria-label match alone doesn't prove that; getByText must fail).
    expect(screen.queryByText(ja.action)).toBeNull()
  })
})

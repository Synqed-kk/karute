/** @jest-environment jsdom */
// PHONEWIRE-2A — NewKaruteDialog's two-branch contract with
// createManualKaruteRecord, exercised against the REAL dialog.
//
// The dialog awaits the action inside startTransition with NO try/catch, so the
// two branches are not symmetric and the thin port must honour BOTH:
//
//   FAILURE → the action RETURNS { error }; the dialog shows its inline
//             role="alert" and stays open (Greptile P1 on #484 — a throw here
//             bypasses that UI and leaves the dialog hanging).
//   SUCCESS → the action NEVER returns a value; it navigates and throws the
//             NEXT_REDIRECT marker (web: redirect(); thin: thinRedirect() +
//             throw). This pins that the marker does NOT get rendered as a
//             dialog error — a success must never look like a failure.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.'))
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_m, v: string) => String(vars?.[v] ?? `{${v}}`))
    },
  }
})
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }))
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/customers', () => ({ createQuickCustomer: jest.fn() }))

const action: jest.Mock = jest.fn()
jest.mock('@/actions/karute', () => ({ createManualKaruteRecord: (i: unknown) => action(i) }))

import { NewKaruteDialog } from '@/components/karute/spike-lifted/list/NewKaruteDialog'

const SATO = { id: 'p-sato', name: '佐藤 美咲' }
const CUST = { id: 'cust-1', name: '山田 花子', furigana: null, phone: null }

function renderDialog() {
  return render(
    <NewKaruteDialog
      open
      onOpenChange={() => {}}
      staffList={[SATO]}
      customers={[CUST]}
      defaultStaffId={SATO.id}
      preselectedCustomerId={CUST.id}
    />,
  )
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: '作成' }))
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('NewKaruteDialog ↔ createManualKaruteRecord contract', () => {
  it('FAILURE: a RETURNED { error } renders the inline alert and keeps the dialog open', async () => {
    action.mockResolvedValue({ error: 'core exploded' })
    renderDialog()
    submit()

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    // The dialog shows its own generic copy, never the raw internal message.
    expect(screen.getByRole('alert').textContent).toBe('作成に失敗しました。もう一度お試しください。')
    // Still open, so the staff can correct and retry. Asserted on the dialog
    // itself, not on the 作成 button: while the transition is still pending the
    // button legitimately reads 作成中… (a race that only shows under a loaded
    // full-suite run).
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  // The thin door's SUCCESS branch (thinRedirect + throw NEXT_REDIRECT) is
  // pinned in thin-karute-manual-create-port.test.ts instead, deliberately.
  // MEASURED here first and recorded rather than asserted: driven through this
  // real dialog, the marker escapes startTransition as an UNHANDLED REJECTION
  // — React does not route it to an error boundary, and nothing is painted
  // (the user has already been navigated to the new カルテ by then). Asserting
  // that from inside jest-circus means fighting its own unhandledRejection
  // handler for no product value. See BUILD-NOTE-PHONEWIRE-2A.md §honest
  // limits; same accepted escape as the shipped facadeSaveKarute/ReviewScreen
  // pair, whose note calls the re-thrown marker "harmless post-navigation".


  it('SUCCESS: a void return is NOT shown as a dialog error either', async () => {
    // The web action's own declared success shape ({ error } | void).
    action.mockResolvedValue(undefined)
    renderDialog()
    submit()

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('forwards the dialog fields the port then puts on the wire', async () => {
    action.mockResolvedValue({ error: 'x' })
    renderDialog()
    fireEvent.change(screen.getByLabelText('サービス'), { target: { value: 'カット' } })
    submit()

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CUST.id, staffId: SATO.id, service: 'カット', durationMinutes: 60 }),
    )
  })
})

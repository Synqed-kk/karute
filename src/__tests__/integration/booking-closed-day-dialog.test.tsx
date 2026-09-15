/** @jest-environment jsdom */
// ⚖ PKT-1c-C PROOF — what the STAFFER actually reads when the door closes.
//
// The refusal is only as good as the line on screen, so this drives the REAL
// NewBookingDialog against the REAL ja.json (a call-site key typo throws in the
// next-intl stub below) and reads the toast.
//
// WHY A FIXTURE POLICY, not the live e2e tenant: the Dev Salon e2e tenant is
// empty and single-store, and nothing in the app can set a store's closed
// weekday yet — `storePolicies.set` is HQ-gated and has never been called from
// this repo (⚖ ADJUDICATION-STORE-HOURS item 2; the writer is 1c-D). Writing a
// booking to a REAL store to prove a refusal is forbidden outright. So the
// refusal is driven through the shape both doors return, which the server-side
// suites pin against a real policy fixture
// (booking-closed-day-door.test.ts · app-api-appointments-mutations.test.ts).
//
// This is the ONE dialog BOTH doors render: the phone shell swaps only the
// action port (thin/vite.config.ts rewrites src/actions/** to the facade
// proxy), so proving the line here proves it on the computer and the phone.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

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
const toastError = jest.fn()
jest.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: jest.fn() } }))
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/customers', () => ({ createQuickCustomer: jest.fn() }))

const createAppointment = jest.fn(async (): Promise<unknown> => ({ id: 'appt-1' }))
jest.mock('@/actions/appointments', () => ({
  createAppointment: (...args: unknown[]) => createAppointment(...(args as [])),
}))

import { NewBookingDialog } from '@/components/appointments/NewBookingDialog'
import ja from '../../../messages/ja.json'

const CUSTOMER = { id: 'cust-1', name: '佐藤 花子' }
const STAFF = [{ id: 'staff-1', name: '田中 美咲' }]
const LINES = ja.reservation.errors

function mount() {
  cleanup()
  render(
    <NewBookingDialog
      open
      onOpenChange={() => {}}
      customers={[CUSTOMER]}
      staff={STAFF}
      initialClientId={CUSTOMER.id}
    />,
  )
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mount()
})

describe('what the staffer reads when the door closes', () => {
  it("names THIS STORE's own hours when the store's week closed the day", async () => {
    createAppointment.mockResolvedValue({
      error: 'This day is closed — pick another day.',
      code: 'closed_day',
      level: 'store',
      kind: 'weekday',
    })

    await save()

    expect(toastError).toHaveBeenCalledWith(LINES.closedDayStore)
    // Never the developer-facing fallback the server carries for its own logs.
    expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining('This day is closed'))
  })

  it('names 臨時休業 when it was an ad-hoc closed date', async () => {
    createAppointment.mockResolvedValue({
      error: 'This day is closed — pick another day.',
      code: 'closed_day',
      level: 'store',
      kind: 'closed_date',
    })

    await save()

    expect(toastError).toHaveBeenCalledWith(LINES.closedDayDate)
  })

  it('names the company-wide default when THAT is what closed the day', async () => {
    createAppointment.mockResolvedValue({
      error: 'This day is closed — pick another day.',
      code: 'closed_day',
      level: 'org',
      kind: 'weekday',
    })

    await save()

    expect(toastError).toHaveBeenCalledWith(LINES.closedDayOrg)
  })

  it('leaves every other error exactly as it was — the server string, verbatim', async () => {
    createAppointment.mockResolvedValue({
      error: 'This time slot overlaps with an existing booking.',
    })

    await save()

    expect(toastError).toHaveBeenCalledWith('This time slot overlaps with an existing booking.')
  })
})

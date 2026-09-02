/**
 * @jest-environment jsdom
 *
 * PHONEWIRE-1 — CustomerForm must SAY SOMETHING when the save action rejects.
 *
 * The hang class this pins: `createCustomer` was a `notWired` stub on phones
 * (and can still reject on any surface — a facade transport failure, a missing
 * session), and onSubmit awaited it with no try/catch. The rejection escaped
 * unhandled, the dialog sat there saying nothing, and the typed 顧客 was lost.
 *
 * HONEST SCOPE, verified against react-hook-form's own handleSubmit (it sets
 * isSubmitting back to false in every path before rethrowing): the button was
 * never actually STUCK. What was missing was the telling — so both halves are
 * asserted here, and the toast is the half that goes red without the fix.
 *
 * next-intl mocked key-echo style (the suite's convention).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const toastError = jest.fn()
const toastWarning = jest.fn()
jest.mock('sonner', () => ({
  toast: { error: (m: string) => toastError(m), warning: (m: string) => toastWarning(m) },
}))

const createCustomer = jest.fn()
const updateCustomer = jest.fn()
const createQuickCustomer = jest.fn()
jest.mock('@/actions/customers', () => ({
  createCustomer: (...args: unknown[]) => createCustomer(...args),
  updateCustomer: (...args: unknown[]) => updateCustomer(...args),
  createQuickCustomer: (...args: unknown[]) => createQuickCustomer(...args),
}))

import { CustomerForm } from '@/components/customers/CustomerForm'
import { QuickCreateCustomer } from '@/components/karute/QuickCreateCustomer'

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('form.familyNamePlaceholder'), {
    target: { value: '山田' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'form.create' }))
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('CustomerForm — a rejecting save action', () => {
  it('shows the generic error toast instead of failing silently', async () => {
    createCustomer.mockRejectedValue(
      new Error('[thin] server action "createCustomer" is not wired to a facade endpoint yet'),
    )

    render(<CustomerForm />)
    fillAndSubmit()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('toast.error'))
    // The RAW internal message never reaches the staff.
    expect(toastError).not.toHaveBeenCalledWith(expect.stringContaining('not wired'))
  })

  it('leaves the submit button usable again (never stuck on 保存中)', async () => {
    createCustomer.mockRejectedValue(new Error('network down'))

    render(<CustomerForm />)
    fillAndSubmit()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    const button = screen.getByRole('button', { name: 'form.create' })
    expect(button).not.toBeDisabled()
  })

  it('does not call onSuccess when the action rejects (the dialog stays open)', async () => {
    createCustomer.mockRejectedValue(new Error('network down'))
    const onSuccess = jest.fn()

    render(<CustomerForm onSuccess={onSuccess} />)
    fillAndSubmit()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('a soft { success: false } still toasts its own message (unchanged path)', async () => {
    createCustomer.mockResolvedValue({ success: false, error: 'メールアドレスが重複しています' })

    render(<CustomerForm />)
    fillAndSubmit()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('メールアドレスが重複しています'))
  })

  it('a success still calls onSuccess and surfaces the duplicate warning (unchanged path)', async () => {
    createCustomer.mockResolvedValue({ success: true, id: 'cust-1', duplicateWarning: '同名の顧客がいます' })
    const onSuccess = jest.fn()

    render(<CustomerForm onSuccess={onSuccess} />)
    fillAndSubmit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(toastWarning).toHaveBeenCalledWith('同名の顧客がいます')
    expect(toastError).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────
// The offline message is LOCALIZED, on BOTH doors (PHONEWIRE-3)
// ─────────────────────────────────────────────────────────────
// The thin port substitutes for these server actions, and on a transport
// rejection it resolves { success: false, error: '' } — empty because the port
// has no i18n and both consumers DISPLAY this field, so any literal there
// reaches a Japanese staffer in English (Greptile #816). The contract only
// holds if BOTH consumers treat an empty message as "use my own localized
// generic", so both halves are pinned here. next-intl is key-echo mocked, so
// 'toast.error' standing in for エラーが発生しました / Something went wrong is
// the proof the LOCALIZED string is what renders.
describe('an offline failure with no message of its own', () => {
  it('CustomerForm toasts the localized generic, never an empty toast', async () => {
    createCustomer.mockResolvedValue({ success: false, error: '' })

    render(<CustomerForm />)
    fillAndSubmit()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('toast.error'))
    expect(toastError).not.toHaveBeenCalledWith('')
  })

  it('QuickCreateCustomer shows the localized generic, never a silent failure', async () => {
    createQuickCustomer.mockResolvedValue({ success: false, error: '' })

    render(<QuickCreateCustomer onCreated={jest.fn()} onCancel={jest.fn()} initialName="山田" />)
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }))

    // role=alert is the whole point: an empty string is falsy, so before the
    // fallback this element did not render AT ALL and the save died in silence.
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('toast.error')
  })

  it('QuickCreateCustomer still shows a REAL server message verbatim', async () => {
    createQuickCustomer.mockResolvedValue({ success: false, error: '名前を入力してください' })

    render(<QuickCreateCustomer onCreated={jest.fn()} onCancel={jest.fn()} initialName="山田" />)
    fireEvent.click(screen.getByRole('button', { name: 'form.create' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('名前を入力してください')
  })
})

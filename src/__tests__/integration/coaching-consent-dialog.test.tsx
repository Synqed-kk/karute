/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCoachingConsent } from '@/lib/coaching-consent/hooks'
import { getCoachingConsent } from '@/actions/coaching-consent'
import { CoachingConsentDialog } from '@/components/coaching/redesign/CoachingConsentDialog'

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

it('requires a fresh checkbox and closes only after a successful server save', async () => {
  let resolve!: (value: boolean) => void
  const onConsent = jest.fn(() => new Promise<boolean>(done => { resolve = done }))
  const onOpenChange = jest.fn()
  render(<CoachingConsentDialog open onOpenChange={onOpenChange} onConsent={onConsent} />)
  expect(screen.getByRole('button', { name: 'agree' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'agree' }))
  expect(onConsent).toHaveBeenCalledWith(true)
  expect(onOpenChange).not.toHaveBeenCalled()
  await act(async () => { resolve(false) })
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'decline' }))
  await act(async () => { resolve(true) })
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

it('disables decisions while saving and shows an actionable save error', () => {
  render(<CoachingConsentDialog open saving error="Please try saving again" onOpenChange={jest.fn()} onConsent={jest.fn()} />)
  expect(screen.getByRole('button', { name: 'decline' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'agree' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Please try saving again')
})

jest.mock('@/actions/coaching-consent', () => ({ getCoachingConsent: jest.fn(), decideCoachingConsent: jest.fn() }))
let authChanged: (_event: string, session: { user: { id: string } } | null) => void
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (callback: typeof authChanged) => { authChanged = callback; return { data: { subscription: { unsubscribe: jest.fn() } } } },
} }) }))

function ConnectedDialog() {
  const consent = useCoachingConsent()
  return <CoachingConsentDialog key={`${consent.identityRevision}:${consent.currentPolicyVersion}`} open
    unavailable={consent.loading} grantUnavailable={!consent.canGrant}
    onOpenChange={jest.fn()} onConsent={granted => consent.decide(granted ? 'granted' : 'declined')} />
}

it.each(['login', 'policy'])('clears acknowledgement when the %s changes while the dialog is open', async kind => {
  const read = jest.mocked(getCoachingConsent)
  read.mockResolvedValue({ ok: true, data: { current_policy_version: 'v1.0-2026-05', status: 'unset', decision: null } })
  render(<ConnectedDialog />)
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeDisabled())
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: 'agree' })).not.toBeDisabled()
  if (kind === 'login') {
    await act(async () => { authChanged('SIGNED_IN', { user: { id: 'different-person' } }) })
  } else {
    read.mockResolvedValue({ ok: true, data: { current_policy_version: 'future-policy', status: 'unset', decision: null } })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
  }
  await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked())
  expect(screen.getByRole('button', { name: 'agree' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'decline' })).not.toBeDisabled()
})

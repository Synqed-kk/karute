/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
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

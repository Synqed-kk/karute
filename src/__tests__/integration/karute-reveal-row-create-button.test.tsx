/**
 * @jest-environment jsdom
 *
 * PHONEWIRE-3 — NoKaruteRevealRow shows カルテを作成 on BOTH doors
 * (⚖ Liam 2026-09-02).
 *
 * The phone used to render the row as a plain Link to the customer hub,
 * because the shell had no wired create action; PHONEWIRE-2A wired it
 * (POST /api/app/v1/karute/manual) and the ruling made the surfaces identical.
 * isNativeShell() is mocked TRUE here on purpose: the pin has to be that the
 * button survives the shell branch, so re-adding the suppression turns this
 * red. The web door is covered by the same assertions with the mock false.
 */
import { render, screen, fireEvent } from '@testing-library/react'

let mockNative = true
jest.mock('@/lib/platform', () => ({
  isNativeShell: () => mockNative,
}))
jest.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: unknown }) => (
    <a href={typeof href === 'string' ? href : undefined}>{children}</a>
  ),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

import { NoKaruteRevealRow } from '@/components/karute/spike-lifted/list/KaruteListRow'

const CANDIDATE = {
  id: 'cust-1',
  name: '山田 花子',
  code: 'K-0001',
  registeredDate: '2026-08-01T00:00:00+09:00',
}

describe.each([
  ['the phone (native shell)', true],
  ['the computer (web)', false],
])('NoKaruteRevealRow on %s', (_label, native) => {
  beforeEach(() => {
    mockNative = native
  })

  it('renders the カルテを作成 button, and it calls onCreateClick', () => {
    const onCreateClick = jest.fn()
    render(<NoKaruteRevealRow candidate={CANDIDATE} onCreateClick={onCreateClick} />)

    const button = screen.getByRole('button', { name: 'revealCreate' })
    fireEvent.click(button)
    expect(onCreateClick).toHaveBeenCalledTimes(1)
  })

  it('the row itself is NOT a link — the button is the action', () => {
    const { container } = render(
      <NoKaruteRevealRow candidate={CANDIDATE} onCreateClick={jest.fn()} />,
    )
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('山田 花子')).toBeTruthy()
  })
})

/**
 * @jest-environment jsdom
 *
 * ThinBottomNav coverage (packet-09 F-7 cause 3): the store binary shipped
 * with NO top-level navigation — /ask-ai had zero inbound links and the
 * record/karute cluster was unreachable. Pins: the bar renders exactly the
 * four routes the thin router serves, only while the app is mounted
 * (signed-in, or recovering with a known session — AuthGate's condition).
 */
import type { Session } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import { setSessionState } from '@/lib/auth/mobile/session-store'
import { ThinBottomNav } from '../../../thin/ThinBottomNav'

// next-intl's react-client entry ships production ESM that CI's node 20 jest
// can't parse untransformed (local node 24 masks it via require(esm)). The
// component only needs useTranslations('sidebar'), so mock the hook and feed
// it the REAL ja.json values — the label assertions below stay honest.
jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    return messages[ns]?.[key] ?? key
  },
}))

const session = (token: string) => ({ access_token: token }) as Session

function renderNav() {
  return render(<ThinBottomNav />)
}

describe('ThinBottomNav (F-7 cause 3)', () => {
  afterEach(() => {
    // Two-step on purpose: only an explicit signed-out clears the store's
    // lastSession (recovering alone keeps it, by design — offline resume).
    // Dropping the first step would leak hasKnownSession()=true into the
    // next test and flip the "renders nothing" assertion.
    setSessionState({ status: 'signed-out' })
    setSessionState({ status: 'recovering' })
    history.replaceState({}, '', '/')
  })

  it('renders nothing while signed out (login screen stays chrome-free)', () => {
    setSessionState({ status: 'signed-out' })
    const { container } = renderNav()
    expect(container.innerHTML).toBe('')
  })

  it('renders exactly the four thin routes while signed in', () => {
    setSessionState({ status: 'signed-in', session: session('tok') })
    renderNav()
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/customers',
      '/karute',
      '/sessions',
      '/ask-ai',
    ])
    // every tab reachable by its accessible name — AI相談 especially had
    // ZERO inbound links in the F-7 binary
    for (const label of ['顧客', 'カルテ', '録音', 'AI相談']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy()
    }
  })

  it('stays visible through an offline-resume spell (recovering w/ known session)', () => {
    setSessionState({ status: 'signed-in', session: session('tok') })
    setSessionState({ status: 'recovering' })
    renderNav()
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })
})

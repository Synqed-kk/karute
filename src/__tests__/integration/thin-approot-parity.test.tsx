/** @jest-environment jsdom */
// AppRoot parity (packet-02 build #3). The thin target never renders layout.tsx,
// so AppRoot must re-supply the same provider contract. This proves: safe-area /
// lang / theme document setup, theme provider, notifications (toaster), children
// mount, and fatal-error recovery — plus a source-parity lock so AppRoot's LANG /
// DATA_THEME can't silently drift from layout.tsx.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Session } from '@supabase/supabase-js'
import { act, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { sameOriginDataPort } from '@/lib/ports/data-port'
import { LANG, DATA_THEME } from '@/lib/app-root/document-setup'
import { setSessionState } from '@/lib/auth/mobile/session-store'

// next-intl ships ESM that this repo's jest transform doesn't unwrap; mock it to
// test AppRoot's OWN provider contract in isolation while still capturing the
// locale props it wires (locale parity assertion below).
const intlProps: Record<string, unknown> = {}
jest.mock('next-intl', () => ({
  NextIntlClientProvider: (props: { children: React.ReactNode }) => {
    Object.assign(intlProps, props)
    return props.children
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppRoot } = require('@/lib/app-root/AppRoot') as typeof import('@/lib/app-root/AppRoot')

// next-themes (enableSystem) and sonner touch matchMedia, which jsdom omits.
beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList)
})

function renderRoot(children: React.ReactNode) {
  return render(
    <AppRoot dataPort={sameOriginDataPort} locale="ja" messages={{}}>
      {children}
    </AppRoot>,
  )
}

afterEach(() => {
  // Two-step, same as thin-splash-gate.test.tsx: only an explicit signed-out
  // clears the store's lastSession.
  setSessionState({ status: 'signed-out' })
  setSessionState({ status: 'recovering' })
})

describe('AppRoot provider contract', () => {
  it('mounts children synchronously (first paint not gated on data)', () => {
    renderRoot(<div data-testid="screen">screen</div>)
    expect(screen.getByTestId('screen')).toBeTruthy()
  })

  it('applies safe-area / lang / theme document setup (layout.tsx <html> parity)', () => {
    renderRoot(<div />)
    expect(document.documentElement.lang).toBe('ja')
    expect(document.documentElement.dataset.theme).toBe('karute')
    const viewport = document.querySelector('meta[name="viewport"]')
    expect(viewport?.getAttribute('content')).toContain('viewport-fit=cover')
  })

  it('mounts the theme provider (next-themes class) and toaster (notifications) while signed in', () => {
    // The toaster is session-gated (F2, packet 12 fix batch) — see the
    // SessionGatedToaster describe block below for the gate itself.
    setSessionState({
      status: 'signed-in',
      session: { access_token: 't' } as Session,
    })
    renderRoot(<div />)
    // next-themes (attribute="class", defaultTheme="light") stamps the class.
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(
      document.querySelector('section[aria-label*="Notifications"]'),
    ).toBeTruthy()
  })

  it('recovers from a fatal child error (global-error.tsx parity)', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => {
      throw new Error('boom')
    }
    renderRoot(<Boom />)
    expect(screen.getByText('問題が発生しました')).toBeTruthy()
    spy.mockRestore()
  })

  it('wires the locale provider (locale parity)', () => {
    renderRoot(<div />)
    expect(intlProps.locale).toBe('ja')
  })

  it('LANG / DATA_THEME still match layout.tsx (source-parity lock)', () => {
    const layout = readFileSync(
      join(process.cwd(), 'src/app/layout.tsx'),
      'utf8',
    )
    expect(layout).toContain(`lang="${LANG}"`)
    expect(layout).toContain(`data-theme="${DATA_THEME}"`)
  })
})

describe('SessionGatedToaster (F2, packet 12 fix batch — no toast may render over LoginScreen)', () => {
  it('does not render the toaster before/without a signed-in session', () => {
    renderRoot(<div />)
    expect(
      document.querySelector('section[aria-label*="Notifications"]'),
    ).toBeNull()
  })

  it('renders the toaster once signed in, and dismisses + unmounts it on sign-out', async () => {
    renderRoot(<div />)
    expect(
      document.querySelector('section[aria-label*="Notifications"]'),
    ).toBeNull()

    act(() => {
      setSessionState({
        status: 'signed-in',
        session: { access_token: 't' } as Session,
      })
    })
    await waitFor(() =>
      expect(
        document.querySelector('section[aria-label*="Notifications"]'),
      ).toBeTruthy(),
    )

    const dismissSpy = jest.spyOn(toast, 'dismiss')
    act(() => {
      setSessionState({ status: 'signed-out' })
    })
    expect(dismissSpy).toHaveBeenCalledTimes(1)
    expect(
      document.querySelector('section[aria-label*="Notifications"]'),
    ).toBeNull()
    dismissSpy.mockRestore()
  })

  it('a live resume blip (recovering WITH a known session) keeps the toaster mounted, no dismiss (B1, packet 12 fix batch round 3)', async () => {
    // Round-2's "dismiss both directions" fix is GONE (its premise was
    // false against the installed sonner — see the AppRoot.tsx doc comment)
    // — this pins the real invariant instead: the toaster gate mirrors
    // AuthGate's live-app contract, so a signed-in↔recovering blip (offline
    // resume) is not a gate transition at all.
    renderRoot(<div />)
    act(() => {
      setSessionState({
        status: 'signed-in',
        session: { access_token: 't' } as Session,
      })
    })
    await waitFor(() =>
      expect(
        document.querySelector('section[aria-label*="Notifications"]'),
      ).toBeTruthy(),
    )

    const dismissSpy = jest.spyOn(toast, 'dismiss')
    // Two-step, same pattern the suite already uses elsewhere (e.g.
    // thin-splash-gate.test.tsx): 'recovering' alone doesn't clear
    // lastSession — only an explicit signed-out does — so this reproduces
    // an offline resume with a KNOWN session, not a fresh boot.
    act(() => {
      setSessionState({ status: 'recovering' })
    })
    expect(dismissSpy).not.toHaveBeenCalled()
    expect(
      document.querySelector('section[aria-label*="Notifications"]'),
    ).toBeTruthy()

    // Back to signed-in: still mounted, still no dismiss.
    act(() => {
      setSessionState({
        status: 'signed-in',
        session: { access_token: 't' } as Session,
      })
    })
    expect(dismissSpy).not.toHaveBeenCalled()
    expect(
      document.querySelector('section[aria-label*="Notifications"]'),
    ).toBeTruthy()
    dismissSpy.mockRestore()
  })

  it('a toast fired while the toaster is unmounted never renders after a later mount (sonner no-replay tripwire)', async () => {
    // The gate's dismiss-on-exit-only design RESTS on installed sonner's
    // no-replay semantics: Toaster seeds useState([]) and only receives
    // toasts published while subscribed. This is a version-bump tripwire —
    // if a future sonner starts replaying queued toasts to a fresh mount,
    // this fails and the gate needs a dismiss-on-entry again.
    renderRoot(<div />)
    toast.success('signed-out leftover')
    act(() => {
      setSessionState({
        status: 'signed-in',
        session: { access_token: 't' } as Session,
      })
    })
    await waitFor(() =>
      expect(
        document.querySelector('section[aria-label*="Notifications"]'),
      ).toBeTruthy(),
    )
    expect(screen.queryByText('signed-out leftover')).toBeNull()
  })
})

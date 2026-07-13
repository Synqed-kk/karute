/** @jest-environment jsdom */
// AppRoot parity (packet-02 build #3). The thin target never renders layout.tsx,
// so AppRoot must re-supply the same provider contract. This proves: safe-area /
// lang / theme document setup, theme provider, notifications (toaster), children
// mount, and fatal-error recovery — plus a source-parity lock so AppRoot's LANG /
// DATA_THEME can't silently drift from layout.tsx.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { sameOriginDataPort } from '@/lib/ports/data-port'
import { LANG, DATA_THEME } from '@/lib/app-root/document-setup'

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

  it('mounts the theme provider (next-themes class) and toaster (notifications)', () => {
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

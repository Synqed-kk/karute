/** @jest-environment jsdom */
// 8/17 staff-lockout regression. Links that LEAVE the device (staff invite,
// password-reset redirect, signup confirm) were composed from
// window.location.origin — which inside the local shell bundle is
// `capacitor://localhost`, so every generated link was inert for its recipient.
// This locks the runtime rule: shell → public origin, open web → own origin.

import { PUBLIC_SITE_ORIGIN, publicSiteOrigin } from '@/lib/platform'

function setCapacitor(isNativePlatform: () => boolean) {
  ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform }
}

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor
})

describe('publicSiteOrigin', () => {
  it('returns the browser origin on the open web (no Capacitor runtime)', () => {
    expect(publicSiteOrigin()).toBe(window.location.origin)
  })

  it('returns the PUBLIC origin inside the native shell — never the shell origin', () => {
    setCapacitor(() => true)
    expect(publicSiteOrigin()).toBe(PUBLIC_SITE_ORIGIN)
    expect(publicSiteOrigin()).not.toBe(window.location.origin)
  })

  it('returns the browser origin when Capacitor is present but not native', () => {
    setCapacitor(() => false)
    expect(publicSiteOrigin()).toBe(window.location.origin)
  })
})

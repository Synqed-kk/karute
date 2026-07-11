'use client'

import { useEffect } from 'react'

// Native-shell handshake. The iPhone/Android app shell holds its launch screen
// up (SplashScreen.launchAutoHide=false in the shell's capacitor.config.ts)
// until the site has actually hydrated — this effect IS that signal, so the
// user goes straight from the branded launch screen to a painted page with no
// white gap. The SplashScreen plugin proxy is injected into the page by the
// shell itself, so the web bundle needs no Capacitor dependency; in a normal
// browser the global is absent and this is a no-op. The shell also force-hides
// at +8s (CookieVC failsafe) if this call never arrives.
export function SplashHide() {
  useEffect(() => {
    const cap = (
      window as {
        Capacitor?: {
          Plugins?: { SplashScreen?: { hide?: () => Promise<void> } }
        }
      }
    ).Capacitor
    void cap?.Plugins?.SplashScreen?.hide?.()
  }, [])
  return null
}

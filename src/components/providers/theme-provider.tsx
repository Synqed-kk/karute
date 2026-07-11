'use client'

import { useEffect } from 'react'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
    >
      {children}
      <StatusBarSync />
    </NextThemesProvider>
  )
}

// Native-shell handshake (same pattern as the splash hide): tell the shell
// which status-bar text color matches the site's theme, else dark pages get
// invisible black status text in the app. Plugin enum verified from
// @capacitor/status-bar definitions: DARK style = light text (for dark
// pages), LIGHT style = dark text (for light pages). The plugin proxy is
// injected by the shell itself; normal browsers no-op on the first check.
// Re-fires on every theme change and on load (per-user stored theme).
function StatusBarSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    if (!resolvedTheme) return
    const apply = () => {
      const cap = (
        window as {
          Capacitor?: {
            Plugins?: {
              StatusBar?: { setStyle?: (o: { style: string }) => Promise<void> }
            }
          }
        }
      ).Capacitor
      void cap?.Plugins?.StatusBar?.setStyle?.({
        style: resolvedTheme === 'dark' ? 'DARK' : 'LIGHT',
      })
    }
    apply()
    // iOS re-applies the plugin's DEFAULT style whenever a native view
    // controller round-trips (camera sheet from a file input, share sheet…)
    // — StatusBar.swift resets on every capacitorViewDidAppear. Re-assert
    // whenever the page becomes visible again so the style survives those.
    const onVisible = () => {
      if (document.visibilityState === 'visible') apply()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [resolvedTheme])
  return null
}

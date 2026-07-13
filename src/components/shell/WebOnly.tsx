'use client'

import { useEffect, useState } from 'react'
import { isNativeShell } from '@/lib/platform'

// Renders children ONLY once we're confirmed to be on the open web — never
// during SSR, never inside the native app shell. Purchase surfaces must not
// exist in the shell even for one frame (app-store canon), and isNativeShell
// is client-only knowledge: the SSR HTML must therefore omit the children and
// let the web pop them in at hydration (acceptable) rather than SSR-render
// them and hide-after-hydration in the shell (a visible flash — the audit's
// #444×#437 finding: the faster splash drop widened that flash to ~1s).
export function WebOnly({ children }: { children: React.ReactNode }) {
  const [web, setWeb] = useState(false)
  useEffect(() => {
    if (!isNativeShell()) setWeb(true)
  }, [])
  return web ? <>{children}</> : null
}

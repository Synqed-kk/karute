import { useRef, type ReactNode } from 'react'

import { useStandardIOSGestures } from './gestures'

// ThinShell — ROOT-SCROLLER layout: the PAGE is the vertical scroller.
//
// The web (app) layout clamps every screen inside an inner scrolling <main>
// (h-dvh + overflow-hidden, main overflow-y-auto). The shell deliberately does
// NOT reproduce that anymore: an inner scroller pins the page at offset 0
// forever, so iOS's built-in status-bar-tap scroll-to-top has nothing to
// scroll (device-dead in 1.1(4), and the native catcher workaround proved
// fragile). Here <main> grows with its content, the document scrolls, and the
// WKWebView's own scroller is live — the status-bar tap works natively, no
// custom code on either side.
//
// The clamp's OTHER job — containing mobile full-bleed elements (e.g.
// CustomerTabBar's `-mx-4`) so the DOCUMENT never widens and WKWebView never
// shrink-to-fits the page (the follow-up-f zoomed rendering) — moved to the
// TRUE root: `html { overflow-x: hidden }` in thin/index.html (html ONLY —
// on body it would break MobileHeader's sticky pinning; see the comment
// there). Root-level so portaled dialogs (Base UI portals to <body>, outside
// any wrapper) are clamped too. Vertical scrolling is untouched by it.
//
// The bottom nav is pinned by the shell-owned fixed wrapper below; the
// nav-clearance bottom padding lives in ThinChromeContent's content frame
// (chrome-gated, so the chrome-free branches — login, boot loading — keep
// their exact-viewport centering with no phantom scroll). In the WEB layout
// the bar stays a flex sibling under the h-dvh clamp (bottom-nav.tsx's
// flex-column comment describes the web); that arrangement needs the
// fixed-height column this shell gave up.
// Safe-area / Dynamic-Island: unchanged — the chrome owns the insets
// (MobileHeader pads top, BottomNav pads bottom), per parity P-A.

export function ThinShell({
  children,
  nav,
}: {
  children: ReactNode
  nav?: ReactNode
}) {
  // Standard iOS tab swipe lives on <main> — see thin/gestures.ts for the
  // full contract. (Status-bar tap needs no wiring: native, see above.)
  const mainRef = useRef<HTMLElement | null>(null)
  useStandardIOSGestures(mainRef)
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-bg)]">
      <main ref={mainRef} className="relative flex-1">{children}</main>
      {/* Pinned to the viewport now that the page scrolls — the bar must not
       *  scroll away with content. It still carries its own safe-area inset. */}
      <div className="fixed inset-x-0 bottom-0 z-40">{nav}</div>
    </div>
  )
}
